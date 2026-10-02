/**
 * Mesin evaluasi formula Excel (subset yang umum dipakai) untuk preview XLSX.
 * - Parser Pratt: angka, teks, boolean, error literal, referensi sel/rentang (lintas sheet), nama terdefinisi, array konstan,
 *   operator aritmatika/teks/perbandingan, persen, fungsi.
 * - Evaluator malas (lazy) dengan memo + deteksi referensi melingkar.
 * - Mode "trace" untuk fitur Evaluate Formula (nilai tiap sub-ekspresi).
 */
import type { Workbook } from "@office-kit/xlsx/workbook";
import type { Worksheet } from "@office-kit/xlsx/worksheet";
import type { Cell, CellValue } from "@office-kit/xlsx/cell";
import { makeCell } from "@office-kit/xlsx/cell";
import { createWorkbook } from "@office-kit/xlsx/workbook";
import { getCellDisplayText, setCellNumberFormat } from "@office-kit/xlsx/styles";
import { columnIndexFromLetter, columnLetterFromIndex } from "@office-kit/xlsx/utils";

// ───────────────────────── tipe nilai ─────────────────────────
export interface XErr { kind: "error"; code: string }
export type Scalar = number | string | boolean | null | XErr;
export interface RangeVal { kind: "range"; ws: Worksheet; r1: number; c1: number; r2: number; c2: number }
export interface ArrVal { kind: "array"; rows: Scalar[][] }
export type Val = Scalar | RangeVal | ArrVal;

export const err = (code: string): XErr => ({ kind: "error", code });
export const isErr = (v: unknown): v is XErr => !!v && typeof v === "object" && (v as any).kind === "error";
const isRange = (v: Val): v is RangeVal => !!v && typeof v === "object" && (v as any).kind === "range";
const isArr = (v: Val): v is ArrVal => !!v && typeof v === "object" && (v as any).kind === "array";
const isMulti = (v: Val): v is RangeVal | ArrVal => isRange(v) || isArr(v);

const MAX_R = 1048576;
const MAX_C = 16384;

// ───────────────────────── AST ─────────────────────────
export type Node =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "err"; v: string }
  | { t: "ref"; sheet?: string; r1: number; c1: number; r2: number; c2: number; text: string }
  | { t: "name"; name: string }
  | { t: "call"; fn: string; args: Node[] }
  | { t: "un"; op: string; e: Node }
  | { t: "pct"; e: Node }
  | { t: "bin"; op: string; l: Node; r: Node }
  | { t: "arr"; rows: Node[][] }
  | { t: "empty" };

type Tok =
  | { k: "num"; v: number } | { k: "str"; v: string } | { k: "bool"; v: boolean } | { k: "err"; v: string }
  | { k: "ref"; sheet?: string; r1: number; c1: number; r2: number; c2: number; text: string }
  | { k: "id"; v: string } | { k: "fn"; v: string } | { k: "op"; v: string } | { k: "eof" };

const REF_RE = /^((?:'(?:[^']|'')+'|[\p{L}\p{N}_.]+)!)?(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?\d+:\$?\d+)(?![\p{L}\p{N}_.(])/u;
const ERR_RE = /^#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|SPILL!|CALC!)/i;

function parseCellPart(s: string): { r: number; c: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(s);
  if (!m) return null;
  const c = columnIndexFromLetter(m[1]!.toUpperCase());
  const r = parseInt(m[2]!, 10);
  if (c < 1 || c > MAX_C || r < 1 || r > MAX_R) return null;
  return { r, c };
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) { i++; continue; }
    const rest = src.slice(i);
    if (ch === '"') {
      let j = i + 1, s = "";
      while (j < src.length) {
        if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue; } break; }
        s += src[j++];
      }
      if (j >= src.length) throw new Error("Teks tidak ditutup");
      out.push({ k: "str", v: s }); i = j + 1; continue;
    }
    if (ch === "#") {
      const m = ERR_RE.exec(rest);
      if (m) { out.push({ k: "err", v: m[0].toUpperCase() }); i += m[0].length; continue; }
    }
    const nm = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    if (nm && !/^[\p{L}_]/u.test(rest.slice(nm[0].length, nm[0].length + 1))) {
      // angka murni (bukan awal referensi seperti 1:1)
      const rm = REF_RE.exec(rest);
      if (!rm) { out.push({ k: "num", v: parseFloat(nm[0]) }); i += nm[0].length; continue; }
    }
    const rm = REF_RE.exec(rest);
    if (rm) {
      const sheetRaw = rm[1] ? rm[1].slice(0, -1) : undefined;
      const sheet = sheetRaw ? (sheetRaw.startsWith("'") ? sheetRaw.slice(1, -1).replace(/''/g, "'") : sheetRaw) : undefined;
      const body = rm[2]!;
      let ok = true;
      let r1 = 1, c1 = 1, r2 = MAX_R, c2 = MAX_C;
      const parts = body.split(":");
      if (/^\$?[A-Za-z]+\$?\d+$/.test(parts[0]!)) {
        const a = parseCellPart(parts[0]!);
        const b = parts[1] ? parseCellPart(parts[1]) : a;
        if (!a || !b) ok = false; else { r1 = Math.min(a.r, b.r); r2 = Math.max(a.r, b.r); c1 = Math.min(a.c, b.c); c2 = Math.max(a.c, b.c); }
      } else if (/^\$?[A-Za-z]+$/.test(parts[0]!)) {
        const a = columnIndexFromLetter(parts[0]!.replace("$", "").toUpperCase());
        const b = columnIndexFromLetter(parts[1]!.replace("$", "").toUpperCase());
        if (a < 1 || b < 1 || a > MAX_C || b > MAX_C) ok = false; else { c1 = Math.min(a, b); c2 = Math.max(a, b); }
      } else {
        const a = parseInt(parts[0]!.replace("$", ""), 10), b = parseInt(parts[1]!.replace("$", ""), 10);
        if (!(a >= 1 && b >= 1)) ok = false; else { r1 = Math.min(a, b); r2 = Math.max(a, b); }
      }
      if (ok) { out.push({ k: "ref", sheet, r1, c1, r2, c2, text: rm[0] }); i += rm[0].length; continue; }
    }
    const im = /^[\p{L}_\\][\p{L}\p{N}_.\\]*/u.exec(rest);
    if (im) {
      const word = im[0];
      const after = src[i + word.length];
      if (after === "(") { out.push({ k: "fn", v: word.replace(/^_xl(?:fn|ws)\./i, "").toUpperCase() }); i += word.length + 1; continue; }
      const up = word.toUpperCase();
      if (up === "TRUE" || up === "FALSE") { out.push({ k: "bool", v: up === "TRUE" }); i += word.length; continue; }
      out.push({ k: "id", v: word }); i += word.length; continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<>" || two === "<=" || two === ">=") { out.push({ k: "op", v: two }); i += 2; continue; }
    if ("+-*/^&=<>%(),;{}:@".includes(ch)) { if (ch !== "@") out.push({ k: "op", v: ch }); i++; continue; }
    throw new Error(`Karakter tidak dikenal "${ch}" pada posisi ${i}`);
  }
  out.push({ k: "eof" });
  return out;
}

class Parser {
  private p = 0;
  constructor(private toks: Tok[]) {}
  private peek() { return this.toks[this.p]!; }
  private next() { return this.toks[this.p++]!; }
  private isOp(v: string) { const t = this.peek(); return t.k === "op" && t.v === v; }
  private expectOp(v: string) { if (!this.isOp(v)) throw new Error(`Diharapkan "${v}"`); this.p++; }

  parse(): Node {
    const n = this.cmp();
    if (this.peek().k !== "eof") throw new Error("Token berlebih setelah ekspresi");
    return n;
  }
  private cmp(): Node {
    let l = this.concat();
    while (this.peek().k === "op" && ["=", "<>", "<", ">", "<=", ">="].includes((this.peek() as any).v)) {
      const op = (this.next() as any).v;
      l = { t: "bin", op, l, r: this.concat() };
    }
    return l;
  }
  private concat(): Node {
    let l = this.add();
    while (this.isOp("&")) { this.p++; l = { t: "bin", op: "&", l, r: this.add() }; }
    return l;
  }
  private add(): Node {
    let l = this.mul();
    while (this.isOp("+") || this.isOp("-")) { const op = (this.next() as any).v; l = { t: "bin", op, l, r: this.mul() }; }
    return l;
  }
  private mul(): Node {
    let l = this.pow();
    while (this.isOp("*") || this.isOp("/")) { const op = (this.next() as any).v; l = { t: "bin", op, l, r: this.pow() }; }
    return l;
  }
  private pow(): Node {
    let l = this.unary();
    while (this.isOp("^")) { this.p++; l = { t: "bin", op: "^", l, r: this.unary() }; }
    return l;
  }
  private unary(): Node {
    if (this.isOp("-") || this.isOp("+")) { const op = (this.next() as any).v; return { t: "un", op, e: this.unary() }; }
    return this.postfix();
  }
  private postfix(): Node {
    let e = this.rangeOp();
    while (this.isOp("%")) { this.p++; e = { t: "pct", e }; }
    return e;
  }
  private rangeOp(): Node {
    let e = this.primary();
    while (this.isOp(":")) { this.p++; e = { t: "bin", op: ":", l: e, r: this.primary() }; }
    return e;
  }
  private primary(): Node {
    const t = this.next();
    switch (t.k) {
      case "num": return { t: "num", v: t.v };
      case "str": return { t: "str", v: t.v };
      case "bool": return { t: "bool", v: t.v };
      case "err": return { t: "err", v: t.v };
      case "ref": return { t: "ref", sheet: t.sheet, r1: t.r1, c1: t.c1, r2: t.r2, c2: t.c2, text: t.text };
      case "id": return { t: "name", name: t.v };
      case "fn": {
        const args: Node[] = [];
        if (this.isOp(")")) { this.p++; return { t: "call", fn: t.v, args }; }
        for (;;) {
          if (this.isOp(",") || this.isOp(";")) args.push({ t: "empty" });
          else if (this.isOp(")")) { args.push({ t: "empty" }); }
          else args.push(this.cmp());
          if (this.isOp(",") || this.isOp(";")) { this.p++; if (this.isOp(")")) { args.push({ t: "empty" }); this.p++; break; } continue; }
          this.expectOp(")");
          break;
        }
        return { t: "call", fn: t.v, args };
      }
      case "op":
        if (t.v === "(") { const e = this.cmp(); this.expectOp(")"); return e; }
        if (t.v === "{") {
          const rows: Node[][] = [[]];
          for (;;) {
            rows[rows.length - 1]!.push(this.cmp());
            if (this.isOp(",")) { this.p++; continue; }
            if (this.isOp(";")) { this.p++; rows.push([]); continue; }
            this.expectOp("}");
            break;
          }
          return { t: "arr", rows };
        }
        throw new Error(`Operator tak terduga "${t.v}"`);
      default:
        throw new Error("Ekspresi tidak lengkap");
    }
  }
}


/** Posisi referensi sel/rentang pada teks formula (untuk penyorotan & mode "point"). Teks dalam tanda kutip diabaikan. */
export function extractRefs(text: string): { start: number; end: number; sheet?: string; r1: number; c1: number; r2: number; c2: number; text: string }[] {
  const out: ReturnType<typeof extractRefs> = [];
  const strRanges: [number, number][] = [];
  for (const m of text.matchAll(/"(?:[^"]|"")*"/g)) strRanges.push([m.index!, m.index! + m[0].length]);
  const re = /((?:'(?:[^']|'')+'|[\p{L}\p{N}_.]+)!)?(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)(?![\p{L}\p{N}_.(])/gu;
  for (const m of text.matchAll(re)) {
    const start = m.index!;
    if (strRanges.some(([a, b]) => start >= a && start < b)) continue;
    const prev = text[start - 1];
    if (!m[1] && prev && /[\p{L}\p{N}_.]/u.test(prev)) continue;
    const parts = m[2]!.split(":");
    const a = parseCellPart(parts[0]!), b = parts[1] ? parseCellPart(parts[1]) : a;
    if (!a || !b) continue;
    const sheetRaw = m[1] ? m[1].slice(0, -1) : undefined;
    const sheet = sheetRaw ? (sheetRaw.startsWith("'") ? sheetRaw.slice(1, -1).replace(/''/g, "'") : sheetRaw) : undefined;
    out.push({ start, end: start + m[0].length, sheet, r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c), text: m[0] });
  }
  return out;
}

export function parseFormula(text: string): Node {
  const src = text.startsWith("=") ? text.slice(1) : text;
  return new Parser(tokenize(src)).parse();
}

export function nodeToString(n: Node): string {
  switch (n.t) {
    case "num": return String(n.v);
    case "str": return `"${n.v.replace(/"/g, '""')}"`;
    case "bool": return n.v ? "TRUE" : "FALSE";
    case "err": return n.v;
    case "ref": return n.text;
    case "name": return n.name;
    case "empty": return "";
    case "call": return `${n.fn}(${n.args.map(nodeToString).join(", ")})`;
    case "un": return n.op + nodeToString(n.e);
    case "pct": return nodeToString(n.e) + "%";
    case "bin": return `${nodeToString(n.l)}${n.op === ":" ? "" : " "}${n.op}${n.op === ":" ? "" : " "}${nodeToString(n.r)}`;
    case "arr": return "{" + n.rows.map(r => r.map(nodeToString).join(",")).join(";") + "}";
  }
}

// ───────────────────────── helper konversi ─────────────────────────
export function toNumber(v: Scalar): number | XErr {
  if (isErr(v)) return v;
  if (v === null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const s = v.trim();
  if (s === "") return err("#VALUE!");
  const pct = /^(-?[\d.,]+(?:[eE][+-]?\d+)?)%$/.exec(s);
  if (pct) { const n = Number(pct[1]!.replace(/,/g, "")); return Number.isFinite(n) ? n / 100 : err("#VALUE!"); }
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : err("#VALUE!");
}
export function toText(v: Scalar): string {
  if (isErr(v)) return v.code;
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return numToStr(v);
  return v;
}
function numToStr(n: number): string {
  if (!Number.isFinite(n)) return "#NUM!";
  const s = String(+n.toPrecision(15));
  return s.includes("e") ? s.replace("e+", "E+").replace("e-", "E-") : s;
}
function toBool(v: Scalar): boolean | XErr {
  if (isErr(v)) return v;
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const u = v.trim().toUpperCase();
  if (u === "TRUE") return true;
  if (u === "FALSE") return false;
  return err("#VALUE!");
}

const EPOCH = Date.UTC(1899, 11, 30);
export const dateToSerial = (d: Date) => (d.getTime() - EPOCH) / 86400000;
export const serialToDate = (s: number) => new Date(EPOCH + Math.round(s * 86400000));

function rank(v: Scalar): number { return typeof v === "number" ? 0 : typeof v === "string" ? 1 : typeof v === "boolean" ? 2 : -1; }
function compareScalars(a: Scalar, b: Scalar): number {
  if (a === null) a = typeof b === "string" ? "" : typeof b === "boolean" ? false : 0;
  if (b === null) b = typeof a === "string" ? "" : typeof a === "boolean" ? false : 0;
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === "number") return a - (b as number);
  if (typeof a === "string") { const x = a.toLowerCase(), y = (b as string).toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
  return Number(a) - Number(b);
}

function wildcardRe(p: string): RegExp {
  const src = p.replace(/~([*?~])/g, "\u0000$1").split("").map(ch => ch).join("");
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === "\u0000") { out += src[++i]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
    else if (ch === "*") out += ".*";
    else if (ch === "?") out += ".";
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + out + "$", "i");
}

function makeCriteria(crit: Scalar): (v: Scalar) => boolean {
  if (typeof crit === "number") return v => (typeof v === "number" ? v === crit : typeof v === "string" && Number(v) === crit);
  if (typeof crit === "boolean") return v => v === crit;
  if (crit === null) return v => v === null || v === "";
  if (isErr(crit)) return v => isErr(v) && v.code === crit.code;
  const m = /^(>=|<=|<>|>|<|=)?(.*)$/s.exec(crit)!;
  const op = m[1] ?? "=";
  const operand = m[2]!;
  const num = operand.trim() !== "" && Number.isFinite(Number(operand)) ? Number(operand) : undefined;
  if (num !== undefined) {
    return v => {
      const n = typeof v === "number" ? v : undefined;
      if (op === "=") return n === num;
      if (op === "<>") return n !== num;
      if (n === undefined) return false;
      return op === ">" ? n > num : op === "<" ? n < num : op === ">=" ? n >= num : n <= num;
    };
  }
  if (op === "=" || op === "<>") {
    const re = wildcardRe(operand);
    const empty = operand === "";
    return v => {
      const s = v === null ? "" : typeof v === "string" ? v : isErr(v) ? v.code : toText(v);
      const hit = empty ? (v === null || v === "") : re.test(s);
      return op === "=" ? hit : !hit;
    };
  }
  return v => {
    if (typeof v !== "string") return false;
    const c = compareScalars(v, operand);
    return op === ">" ? c > 0 : op === "<" ? c < 0 : op === ">=" ? c >= 0 : c <= 0;
  };
}

// ───────────────────────── evaluator ─────────────────────────
export interface EvalContext { ws: Worksheet; row: number; col: number }
export type TraceFn = (node: Node, value: Val) => void;

let scratchWb: ReturnType<typeof createWorkbook> | undefined;
export function formatWithCode(value: number | string | boolean, code: string): string {
  scratchWb ??= createWorkbook();
  const cell = makeCell(1, 1, null);
  setCellNumberFormat(scratchWb, cell, code);
  cell.value = value as CellValue;
  return getCellDisplayText(scratchWb, cell);
}

export function toCellValue(s: Scalar): CellValue {
  return isErr(s) ? { kind: "error", code: s.code as any } : s;
}

export class Evaluator {
  /** true = formula dihitung ulang dari dependensi; false = nilai cache dari file dipakai untuk sel lain. */
  live = false;
  onUnsupported?: (fn: string) => void;
  private memo = new Map<Worksheet, Map<number, Scalar>>();
  private extents = new Map<Worksheet, { r: number; c: number }>();
  private parsed = new Map<string, Node | Error>();
  private stack = new Set<string>();
  private reported = new Set<string>();

  constructor(public wb: Workbook) {}

  invalidate() { this.memo.clear(); this.extents.clear(); }

  private extent(ws: Worksheet) {
    let e = this.extents.get(ws);
    if (!e) {
      let r = 0, c = 0;
      for (const [rk, row] of ws.rows) { if (rk > r) r = rk; for (const ck of row.keys()) if (ck > c) c = ck; }
      e = { r, c }; this.extents.set(ws, e);
    }
    return e;
  }

  getSheet(name: string): Worksheet | undefined {
    const lower = name.toLowerCase();
    for (const s of this.wb.sheets) if (s.kind === "worksheet" && s.sheet.title.toLowerCase() === lower) return s.sheet;
    return undefined;
  }

  private sheetIndex(ws: Worksheet) { return this.wb.sheets.findIndex(s => s.sheet === ws); }

  parseCached(text: string): Node | Error {
    let n = this.parsed.get(text);
    if (!n) {
      try { n = parseFormula(text); } catch (e) { n = e as Error; }
      this.parsed.set(text, n);
    }
    return n;
  }

  /** Nilai sel sebagaimana dilihat oleh formula lain. */
  cellValue(ws: Worksheet, r: number, c: number): Scalar {
    const cell = ws.rows.get(r)?.get(c);
    if (!cell) return null;
    return this.valueOfCell(ws, cell);
  }

  private valueOfCell(ws: Worksheet, cell: Cell): Scalar {
    const v = cell.value as any;
    if (v === null || v === undefined) return null;
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
    if (v instanceof Date) return this.wb.date1904 ? (v.getTime() - Date.UTC(1904, 0, 1)) / 86400000 : dateToSerial(v);
    switch (v.kind) {
      case "formula": {
        if (this.live) return this.evalFormulaCell(ws, cell.row, cell.col);
        return this.cached(v);
      }
      case "error": return err(v.code);
      case "duration": return v.ms / 86400000;
      case "rich-text": return (v.runs as any[]).map(r => r.text).join("");
    }
    return null;
  }

  private cached(f: any): Scalar {
    if (f.cachedValue === undefined) return null;
    if (f.cachedValueType === "error") return err(String(f.cachedValue));
    return f.cachedValue as Scalar;
  }

  /** Hitung formula pada sel ini (memo + deteksi siklus). */
  evalFormulaCell(ws: Worksheet, r: number, c: number): Scalar {
    const key = r * 16385 + c;
    let m = this.memo.get(ws);
    if (!m) { m = new Map(); this.memo.set(ws, m); }
    if (m.has(key)) return m.get(key)!;
    const cell = ws.rows.get(r)?.get(c);
    const f: any = cell?.value;
    if (!f || f.kind !== "formula") return this.cellValue(ws, r, c);
    const sk = `${this.sheetIndex(ws)}!${key}`;
    if (this.stack.has(sk)) return err("#CIRC!");
    this.stack.add(sk);
    let res: Scalar;
    try {
      res = this.evalText(f.formula ?? "", { ws, row: r, col: c });
      // array formula bukan master: pakai cache apabila hasil null
    } finally { this.stack.delete(sk); }
    if (res && isErr(res) && res.code === "#NAME?" && f.cachedValue !== undefined) res = this.cached(f);
    m.set(key, res);
    return res;
  }

  /** Evaluasi teks formula dalam konteks sel; hasil selalu skalar. */
  evalText(text: string, ctx: EvalContext, trace?: TraceFn): Scalar {
    const n = this.parseCached(text);
    if (n instanceof Error) return err("#NAME?");
    const s = this.scalar(this.ev(n, ctx, trace));
    return s === null ? 0 : s; // referensi ke sel kosong menghasilkan 0 pada Excel
  }

  evalTextRaw(text: string, ctx: EvalContext, trace?: TraceFn): Val {
    const n = parseFormula(text);
    return this.ev(n, ctx, trace);
  }

  scalar(v: Val): Scalar {
    if (isRange(v)) return this.cellValue(v.ws, v.r1, v.c1);
    if (isArr(v)) return v.rows[0]?.[0] ?? null;
    return v;
  }

  rangeRows(v: Val): Scalar[][] {
    if (isArr(v)) return v.rows;
    if (!isRange(v)) return [[v]];
    const e = this.extent(v.ws);
    const r2 = Math.min(v.r2, Math.max(e.r, v.r1)), c2 = Math.min(v.c2, Math.max(e.c, v.c1));
    const rows: Scalar[][] = [];
    for (let r = v.r1; r <= r2; r++) {
      const row: Scalar[] = [];
      for (let c = v.c1; c <= c2; c++) row.push(this.cellValue(v.ws, r, c));
      rows.push(row);
    }
    return rows;
  }

  private ev(n: Node, ctx: EvalContext, trace?: TraceFn): Val {
    const out = this.ev0(n, ctx, trace);
    if (trace) trace(n, out);
    return out;
  }

  private ev0(n: Node, ctx: EvalContext, trace?: TraceFn): Val {
    switch (n.t) {
      case "num": case "str": case "bool": return n.v;
      case "err": return err(n.v);
      case "empty": return null;
      case "ref": {
        const ws = n.sheet ? this.getSheet(n.sheet) : ctx.ws;
        if (!ws) return err("#REF!");
        return { kind: "range", ws, r1: n.r1, c1: n.c1, r2: n.r2, c2: n.c2 };
      }
      case "name": return this.resolveName(n.name, ctx, trace);
      case "arr": return { kind: "array", rows: n.rows.map(r => r.map(x => this.scalar(this.ev(x, ctx, trace)))) };
      case "un": {
        const v = this.ev(n.e, ctx, trace);
        return this.map1(v, s => { const x = toNumber(s); return isErr(x) ? x : n.op === "-" ? -x : x; });
      }
      case "pct": return this.map1(this.ev(n.e, ctx, trace), s => { const x = toNumber(s); return isErr(x) ? x : x / 100; });
      case "bin": {
        if (n.op === ":") {
          const a = this.ev(n.l, ctx, trace), b = this.ev(n.r, ctx, trace);
          if (isRange(a) && isRange(b) && a.ws === b.ws)
            return { kind: "range", ws: a.ws, r1: Math.min(a.r1, b.r1), c1: Math.min(a.c1, b.c1), r2: Math.max(a.r2, b.r2), c2: Math.max(a.c2, b.c2) };
          return err("#VALUE!");
        }
        return this.binary(n.op, this.ev(n.l, ctx, trace), this.ev(n.r, ctx, trace));
      }
      case "call": return this.call(n, ctx, trace);
    }
  }

  private resolveName(name: string, ctx: EvalContext, trace?: TraceFn): Val {
    const idx = this.sheetIndex(ctx.ws);
    const defs = this.wb.definedNames ?? [];
    const lower = name.toLowerCase();
    const def = defs.find(d => d.name.toLowerCase() === lower && d.scope === idx) ?? defs.find(d => d.name.toLowerCase() === lower && (d.scope === undefined || d.scope === null));
    if (!def) return err("#NAME?");
    const sk = `name:${def.name}`;
    if (this.stack.has(sk)) return err("#CIRC!");
    this.stack.add(sk);
    try {
      const n = this.parseCached(def.value);
      if (n instanceof Error) return err("#NAME?");
      return this.ev(n, ctx, trace);
    } finally { this.stack.delete(sk); }
  }

  private map1(v: Val, f: (s: Scalar) => Scalar): Val {
    if (isMulti(v)) return { kind: "array", rows: this.rangeRows(v).map(r => r.map(f)) };
    return f(v);
  }

  private binary(op: string, a: Val, b: Val): Val {
    const f = (x: Scalar, y: Scalar): Scalar => {
      if (isErr(x)) return x;
      if (isErr(y)) return y;
      switch (op) {
        case "&": return toText(x) + toText(y);
        case "=": return compareScalars(x, y) === 0;
        case "<>": return compareScalars(x, y) !== 0;
        case "<": return compareScalars(x, y) < 0;
        case ">": return compareScalars(x, y) > 0;
        case "<=": return compareScalars(x, y) <= 0;
        case ">=": return compareScalars(x, y) >= 0;
      }
      const p = toNumber(x), q = toNumber(y);
      if (isErr(p)) return p;
      if (isErr(q)) return q;
      switch (op) {
        case "+": return p + q;
        case "-": return p - q;
        case "*": return p * q;
        case "/": return q === 0 ? err("#DIV/0!") : p / q;
        case "^": { const r = Math.pow(p, q); return Number.isFinite(r) ? r : err("#NUM!"); }
      }
      return err("#VALUE!");
    };
    if (isMulti(a) || isMulti(b)) {
      const A = this.rangeRows(a), B = this.rangeRows(b);
      const R = Math.max(A.length, B.length), C = Math.max(A[0]?.length ?? 1, B[0]?.length ?? 1);
      const rows: Scalar[][] = [];
      for (let i = 0; i < R; i++) {
        const row: Scalar[] = [];
        for (let j = 0; j < C; j++) {
          const x = A.length === 1 ? A[0]![A[0]!.length === 1 ? 0 : j] : A[i]?.[A[i]!.length === 1 ? 0 : j];
          const y = B.length === 1 ? B[0]![B[0]!.length === 1 ? 0 : j] : B[i]?.[B[i]!.length === 1 ? 0 : j];
          row.push(x === undefined || y === undefined ? err("#N/A") : f(x, y));
        }
        rows.push(row);
      }
      return { kind: "array", rows };
    }
    return f(a, b);
  }

  // ───── pemanggilan fungsi ─────
  private call(n: Extract<Node, { t: "call" }>, ctx: EvalContext, trace?: TraceFn): Val {
    const a = n.args;
    const E = (i: number): Val => (a[i] ? this.ev(a[i]!, ctx, trace) : null);
    const S = (i: number): Scalar => this.scalar(E(i));
    switch (n.fn) {
      case "IF": {
        const c = toBool(S(0)); if (isErr(c)) return c;
        return c ? (a.length > 1 ? E(1) : true) : (a.length > 2 ? E(2) : false);
      }
      case "IFERROR": { const v = E(0); const s = this.scalar(v); return isErr(s) ? E(1) : v; }
      case "IFNA": { const v = E(0); const s = this.scalar(v); return isErr(s) && s.code === "#N/A" ? E(1) : v; }
      case "IFS": {
        for (let i = 0; i + 1 < a.length; i += 2) { const c = toBool(S(i)); if (isErr(c)) return c; if (c) return E(i + 1); }
        return err("#N/A");
      }
      case "SWITCH": {
        const x = S(0);
        for (let i = 1; i + 1 < a.length; i += 2) if (compareScalars(x, S(i)) === 0) return E(i + 1);
        return a.length % 2 === 0 ? E(a.length - 1) : err("#N/A");
      }
      case "CHOOSE": {
        const i = toNumber(S(0)); if (isErr(i)) return i;
        const k = Math.trunc(i);
        return k >= 1 && k < a.length ? E(k) : err("#VALUE!");
      }
      case "ROW": { if (!a.length) return ctx.row; const v = E(0); return isRange(v) ? v.r1 : err("#VALUE!"); }
      case "COLUMN": { if (!a.length) return ctx.col; const v = E(0); return isRange(v) ? v.c1 : err("#VALUE!"); }
      case "ROWS": { const v = E(0); return isRange(v) ? Math.min(v.r2, this.extent(v.ws).r || 1) - v.r1 + 1 : isArr(v) ? v.rows.length : 1; }
      case "COLUMNS": { const v = E(0); return isRange(v) ? Math.min(v.c2, this.extent(v.ws).c || 1) - v.c1 + 1 : isArr(v) ? (v.rows[0]?.length ?? 0) : 1; }
      case "ISBLANK": { const v = E(0); return isRange(v) ? this.cellValue(v.ws, v.r1, v.c1) === null : v === null; }
    }
    const fn = FUNCS[n.fn];
    if (!fn) {
      if (!this.reported.has(n.fn)) { this.reported.add(n.fn); this.onUnsupported?.(n.fn); }
      return err("#NAME?");
    }
    const args = a.map((_, i) => E(i));
    try { return fn(args, this, ctx); } catch (e) { return err("#VALUE!"); }
  }
}

// ───────────────────────── fungsi ─────────────────────────
type Fn = (args: Val[], ev: Evaluator, ctx: EvalContext) => Val;

function* scalarsOf(ev: Evaluator, args: Val[], skipNonNumericInRanges = true): Generator<Scalar> {
  for (const a of args) {
    if (isMulti(a)) { for (const row of ev.rangeRows(a)) for (const s of row) { if (skipNonNumericInRanges && typeof s !== "number" && !isErr(s)) continue; yield s; } }
    else yield a;
  }
}

/** Kumpulkan angka sesuai semantik SUM/AVERAGE. */
function collectNums(ev: Evaluator, args: Val[]): number[] | XErr {
  const out: number[] = [];
  for (const a of args) {
    if (isMulti(a)) {
      for (const row of ev.rangeRows(a)) for (const s of row) { if (isErr(s)) return s; if (typeof s === "number") out.push(s); }
    } else {
      if (a === null) continue;
      const n = toNumber(a);
      if (isErr(n)) return n;
      out.push(n);
    }
  }
  return out;
}

const num = (ev: Evaluator, v: Val | undefined, dflt?: number): number | XErr => {
  if (v === undefined) return dflt === undefined ? err("#VALUE!") : dflt;
  return toNumber(ev.scalar(v));
};
const str = (ev: Evaluator, v: Val | undefined): string | XErr => {
  const s = ev.scalar(v ?? null);
  return isErr(s) ? s : toText(s);
};

function math1(f: (x: number) => number): Fn {
  return (args, ev) => {
    const a = args[0];
    if (a !== undefined && isMulti(a)) return { kind: "array", rows: ev.rangeRows(a).map(r => r.map(s => { const x = toNumber(s); if (isErr(x)) return x; const y = f(x); return Number.isFinite(y) ? y : err("#NUM!"); })) };
    const x = num(ev, a); if (isErr(x)) return x;
    const y = f(x); return Number.isFinite(y) ? y : err("#NUM!");
  };
}

function roundTo(x: number, d: number, mode: "round" | "up" | "down"): number {
  const m = Math.pow(10, d);
  const v = x * m;
  const r = mode === "round" ? Math.sign(v) * Math.round(Math.abs(v) + 1e-12) : mode === "up" ? Math.sign(v) * Math.ceil(Math.abs(v) - 1e-12) : Math.trunc(v);
  return r / m;
}

function critRange(ev: Evaluator, rangeArg: Val, critArg: Val): { vals: Scalar[]; test: (v: Scalar) => boolean } {
  return { vals: ev.rangeRows(rangeArg).flat(), test: makeCriteria(ev.scalar(critArg)) };
}

function lookupCompare(a: Scalar, b: Scalar) { return compareScalars(a, b); }

const FUNCS: Record<string, Fn> = {
  SUM: (a, ev) => { const n = collectNums(ev, a); return isErr(n) ? n : n.reduce((x, y) => x + y, 0); },
  PRODUCT: (a, ev) => { const n = collectNums(ev, a); return isErr(n) ? n : n.reduce((x, y) => x * y, 1); },
  AVERAGE: (a, ev) => { const n = collectNums(ev, a); return isErr(n) ? n : n.length ? n.reduce((x, y) => x + y, 0) / n.length : err("#DIV/0!"); },
  MIN: (a, ev) => { const n = collectNums(ev, a); return isErr(n) ? n : n.length ? Math.min(...n) : 0; },
  MAX: (a, ev) => { const n = collectNums(ev, a); return isErr(n) ? n : n.length ? Math.max(...n) : 0; },
  MEDIAN: (a, ev) => { const n = collectNums(ev, a); if (isErr(n)) return n; if (!n.length) return err("#NUM!"); n.sort((x, y) => x - y); const m = n.length >> 1; return n.length % 2 ? n[m]! : (n[m - 1]! + n[m]!) / 2; },
  COUNT: (a, ev) => { let k = 0; for (const s of scalarsOf(ev, a)) if (typeof s === "number") k++; return k; },
  COUNTA: (a, ev) => { let k = 0; for (const s of scalarsOf(ev, a, false)) if (s !== null) k++; return k; },
  COUNTBLANK: (a, ev) => { let k = 0; for (const s of scalarsOf(ev, a, false)) if (s === null || s === "") k++; return k; },
  LARGE: (a, ev) => { const n = collectNums(ev, [a[0]!]); const k = num(ev, a[1]); if (isErr(n)) return n; if (isErr(k)) return k; n.sort((x, y) => y - x); return n[Math.trunc(k) - 1] ?? err("#NUM!"); },
  SMALL: (a, ev) => { const n = collectNums(ev, [a[0]!]); const k = num(ev, a[1]); if (isErr(n)) return n; if (isErr(k)) return k; n.sort((x, y) => x - y); return n[Math.trunc(k) - 1] ?? err("#NUM!"); },
  STDEV: (a, ev) => { const n = collectNums(ev, a); if (isErr(n)) return n; if (n.length < 2) return err("#DIV/0!"); const m = n.reduce((x, y) => x + y, 0) / n.length; return Math.sqrt(n.reduce((s, x) => s + (x - m) ** 2, 0) / (n.length - 1)); },
  VAR: (a, ev) => { const n = collectNums(ev, a); if (isErr(n)) return n; if (n.length < 2) return err("#DIV/0!"); const m = n.reduce((x, y) => x + y, 0) / n.length; return n.reduce((s, x) => s + (x - m) ** 2, 0) / (n.length - 1); },
  RANK: (a, ev) => { const x = num(ev, a[0]); const n = collectNums(ev, [a[1]!]); if (isErr(x)) return x; if (isErr(n)) return n; const asc = a[2] !== undefined && ev.scalar(a[2]) ? Number(ev.scalar(a[2])) !== 0 : false; const idx = n.filter(v => (asc ? v < x : v > x)).length + 1; return n.includes(x) ? idx : err("#N/A"); },

  ABS: math1(Math.abs), SQRT: math1(Math.sqrt), EXP: math1(Math.exp), LN: math1(Math.log), LOG10: math1(Math.log10),
  SIN: math1(Math.sin), COS: math1(Math.cos), TAN: math1(Math.tan), ATAN: math1(Math.atan), ASIN: math1(Math.asin), ACOS: math1(Math.acos),
  INT: math1(Math.floor), SIGN: math1(Math.sign), DEGREES: math1(x => (x * 180) / Math.PI), RADIANS: math1(x => (x * Math.PI) / 180),
  PI: () => Math.PI,
  LOG: (a, ev) => { const x = num(ev, a[0]); const b = num(ev, a[1], 10); if (isErr(x)) return x; if (isErr(b)) return b; const r = Math.log(x) / Math.log(b); return Number.isFinite(r) ? r : err("#NUM!"); },
  POWER: (a, ev) => { const x = num(ev, a[0]), y = num(ev, a[1]); if (isErr(x)) return x; if (isErr(y)) return y; const r = Math.pow(x, y); return Number.isFinite(r) ? r : err("#NUM!"); },
  MOD: (a, ev) => { const x = num(ev, a[0]), y = num(ev, a[1]); if (isErr(x)) return x; if (isErr(y)) return y; return y === 0 ? err("#DIV/0!") : x - y * Math.floor(x / y); },
  QUOTIENT: (a, ev) => { const x = num(ev, a[0]), y = num(ev, a[1]); if (isErr(x)) return x; if (isErr(y)) return y; return y === 0 ? err("#DIV/0!") : Math.trunc(x / y); },
  ROUND: (a, ev) => { const x = num(ev, a[0]), d = num(ev, a[1], 0); if (isErr(x)) return x; if (isErr(d)) return d; return roundTo(x, Math.trunc(d), "round"); },
  ROUNDUP: (a, ev) => { const x = num(ev, a[0]), d = num(ev, a[1], 0); if (isErr(x)) return x; if (isErr(d)) return d; return roundTo(x, Math.trunc(d), "up"); },
  ROUNDDOWN: (a, ev) => { const x = num(ev, a[0]), d = num(ev, a[1], 0); if (isErr(x)) return x; if (isErr(d)) return d; return roundTo(x, Math.trunc(d), "down"); },
  TRUNC: (a, ev) => { const x = num(ev, a[0]), d = num(ev, a[1], 0); if (isErr(x)) return x; if (isErr(d)) return d; return roundTo(x, Math.trunc(d), "down"); },
  CEILING: (a, ev) => { const x = num(ev, a[0]), s = num(ev, a[1], 1); if (isErr(x)) return x; if (isErr(s)) return s; return s === 0 ? 0 : Math.ceil(x / s) * s; },
  FLOOR: (a, ev) => { const x = num(ev, a[0]), s = num(ev, a[1], 1); if (isErr(x)) return x; if (isErr(s)) return s; return s === 0 ? 0 : Math.floor(x / s) * s; },
  EVEN: math1(x => { const r = Math.ceil(Math.abs(x) / 2) * 2; return x < 0 ? -r : r; }),
  ODD: math1(x => { let r = Math.ceil(Math.abs(x)); if (r % 2 === 0) r++; return x < 0 ? -r : r; }),
  RAND: () => Math.random(),
  RANDBETWEEN: (a, ev) => { const lo = num(ev, a[0]), hi = num(ev, a[1]); if (isErr(lo)) return lo; if (isErr(hi)) return hi; return Math.floor(lo + Math.random() * (hi - lo + 1)); },
  SUMPRODUCT: (a, ev) => {
    const arrs = a.map(x => ev.rangeRows(x).flat());
    const len = arrs[0]?.length ?? 0;
    if (arrs.some(x => x.length !== len)) return err("#VALUE!");
    let sum = 0;
    for (let i = 0; i < len; i++) { let p = 1; for (const arr of arrs) { const s = arr[i]!; if (isErr(s)) return s; p *= typeof s === "number" ? s : typeof s === "boolean" ? 0 : 0; } sum += p; }
    return sum;
  },

  AND: (a, ev) => { let r = true; let any = false; for (const s of scalarsOf(ev, a, false)) { if (s === null || (typeof s === "string" && !isMultiTextBool(s))) continue; const b = toBool(s); if (isErr(b)) return b; any = true; r = r && b; } return any ? r : err("#VALUE!"); },
  OR: (a, ev) => { let r = false; let any = false; for (const s of scalarsOf(ev, a, false)) { if (s === null || (typeof s === "string" && !isMultiTextBool(s))) continue; const b = toBool(s); if (isErr(b)) return b; any = true; r = r || b; } return any ? r : err("#VALUE!"); },
  XOR: (a, ev) => { let r = false; for (const s of scalarsOf(ev, a, false)) { const b = toBool(s); if (isErr(b)) return b; r = r !== b; } return r; },
  NOT: (a, ev) => { const b = toBool(ev.scalar(a[0] ?? null)); return isErr(b) ? b : !b; },
  TRUE: () => true, FALSE: () => false,

  ISNUMBER: (a, ev) => typeof ev.scalar(a[0] ?? null) === "number",
  ISTEXT: (a, ev) => typeof ev.scalar(a[0] ?? null) === "string",
  ISNONTEXT: (a, ev) => typeof ev.scalar(a[0] ?? null) !== "string",
  ISLOGICAL: (a, ev) => typeof ev.scalar(a[0] ?? null) === "boolean",
  ISERROR: (a, ev) => isErr(ev.scalar(a[0] ?? null)),
  ISERR: (a, ev) => { const s = ev.scalar(a[0] ?? null); return isErr(s) && s.code !== "#N/A"; },
  ISNA: (a, ev) => { const s = ev.scalar(a[0] ?? null); return isErr(s) && s.code === "#N/A"; },
  ISEVEN: (a, ev) => { const x = num(ev, a[0]); return isErr(x) ? x : Math.trunc(x) % 2 === 0; },
  ISODD: (a, ev) => { const x = num(ev, a[0]); return isErr(x) ? x : Math.trunc(x) % 2 !== 0; },
  NA: () => err("#N/A"),
  N: (a, ev) => { const s = ev.scalar(a[0] ?? null); return typeof s === "number" ? s : typeof s === "boolean" ? Number(s) : isErr(s) ? s : 0; },
  T: (a, ev) => { const s = ev.scalar(a[0] ?? null); return typeof s === "string" ? s : ""; },
  VALUE: (a, ev) => { const s = ev.scalar(a[0] ?? null); const n = toNumber(typeof s === "string" ? s : s); return n; },

  LEN: (a, ev) => { const s = str(ev, a[0]); return isErr(s) ? s : s.length; },
  UPPER: (a, ev) => { const s = str(ev, a[0]); return isErr(s) ? s : s.toUpperCase(); },
  LOWER: (a, ev) => { const s = str(ev, a[0]); return isErr(s) ? s : s.toLowerCase(); },
  PROPER: (a, ev) => { const s = str(ev, a[0]); return isErr(s) ? s : s.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_m, p, c) => p + c.toUpperCase()); },
  TRIM: (a, ev) => { const s = str(ev, a[0]); return isErr(s) ? s : s.trim().replace(/ +/g, " "); },
  CLEAN: (a, ev) => { const s = str(ev, a[0]); return isErr(s) ? s : s.replace(/[\x00-\x1f]/g, ""); },
  LEFT: (a, ev) => { const s = str(ev, a[0]), n = num(ev, a[1], 1); if (isErr(s)) return s; if (isErr(n)) return n; return n < 0 ? err("#VALUE!") : s.slice(0, Math.trunc(n)); },
  RIGHT: (a, ev) => { const s = str(ev, a[0]), n = num(ev, a[1], 1); if (isErr(s)) return s; if (isErr(n)) return n; return n < 0 ? err("#VALUE!") : n === 0 ? "" : s.slice(-Math.trunc(n)); },
  MID: (a, ev) => { const s = str(ev, a[0]), st = num(ev, a[1]), n = num(ev, a[2]); if (isErr(s)) return s; if (isErr(st)) return st; if (isErr(n)) return n; return st < 1 || n < 0 ? err("#VALUE!") : s.substr(Math.trunc(st) - 1, Math.trunc(n)); },
  CONCAT: (a, ev) => { let out = ""; for (const s of scalarsOf(ev, a, false)) { if (isErr(s)) return s; out += toText(s); } return out; },
  CONCATENATE: (a, ev) => { let out = ""; for (const x of a) { const s = ev.scalar(x); if (isErr(s)) return s; out += toText(s); } return out; },
  TEXTJOIN: (a, ev) => {
    const d = str(ev, a[0]); const ign = toBool(ev.scalar(a[1] ?? null)); if (isErr(d)) return d; if (isErr(ign)) return ign;
    const parts: string[] = [];
    for (const s of scalarsOf(ev, a.slice(2), false)) { if (isErr(s)) return s; const t = toText(s); if (ign && t === "") continue; parts.push(t); }
    return parts.join(d);
  },
  REPT: (a, ev) => { const s = str(ev, a[0]), n = num(ev, a[1]); if (isErr(s)) return s; if (isErr(n)) return n; return n < 0 ? err("#VALUE!") : s.repeat(Math.trunc(n)); },
  EXACT: (a, ev) => { const x = str(ev, a[0]), y = str(ev, a[1]); if (isErr(x)) return x; if (isErr(y)) return y; return x === y; },
  CODE: (a, ev) => { const s = str(ev, a[0]); return isErr(s) ? s : s.length ? s.charCodeAt(0) : err("#VALUE!"); },
  CHAR: (a, ev) => { const n = num(ev, a[0]); return isErr(n) ? n : String.fromCharCode(Math.trunc(n)); },
  SUBSTITUTE: (a, ev) => {
    const s = str(ev, a[0]), o = str(ev, a[1]), n = str(ev, a[2]); if (isErr(s)) return s; if (isErr(o)) return o; if (isErr(n)) return n;
    if (o === "") return s;
    if (a[3] === undefined) return s.split(o).join(n);
    const k = num(ev, a[3]); if (isErr(k)) return k;
    let idx = -1, count = 0, pos = 0;
    while ((pos = s.indexOf(o, pos)) !== -1) { count++; if (count === k) { idx = pos; break; } pos += o.length; }
    return idx < 0 ? s : s.slice(0, idx) + n + s.slice(idx + o.length);
  },
  REPLACE: (a, ev) => { const s = str(ev, a[0]), st = num(ev, a[1]), n = num(ev, a[2]), t = str(ev, a[3]); if (isErr(s)) return s; if (isErr(st)) return st; if (isErr(n)) return n; if (isErr(t)) return t; return s.slice(0, Math.trunc(st) - 1) + t + s.slice(Math.trunc(st) - 1 + Math.trunc(n)); },
  FIND: (a, ev) => { const f = str(ev, a[0]), s = str(ev, a[1]), st = num(ev, a[2], 1); if (isErr(f)) return f; if (isErr(s)) return s; if (isErr(st)) return st; const i = s.indexOf(f, Math.trunc(st) - 1); return i < 0 ? err("#VALUE!") : i + 1; },
  SEARCH: (a, ev) => {
    const f = str(ev, a[0]), s = str(ev, a[1]), st = num(ev, a[2], 1); if (isErr(f)) return f; if (isErr(s)) return s; if (isErr(st)) return st;
    const re = new RegExp(wildcardRe(f).source.slice(1, -1), "i"); const m = re.exec(s.slice(Math.trunc(st) - 1));
    return m ? m.index + Math.trunc(st) : err("#VALUE!");
  },
  TEXT: (a, ev) => {
    const v = ev.scalar(a[0] ?? null); const f = str(ev, a[1]); if (isErr(v)) return v; if (isErr(f)) return f;
    try { return formatWithCode(v === null ? 0 : v, f); } catch { return err("#VALUE!"); }
  },
  FIXED: (a, ev) => { const x = num(ev, a[0]), d = num(ev, a[1], 2); if (isErr(x)) return x; if (isErr(d)) return d; return x.toLocaleString("en-US", { minimumFractionDigits: Math.max(0, d), maximumFractionDigits: Math.max(0, d) }); },

  SUMIF: (a, ev) => {
    const { vals, test } = critRange(ev, a[0]!, a[1]!);
    const sumVals = a[2] ? ev.rangeRows(a[2]).flat() : vals;
    let s = 0; vals.forEach((v, i) => { if (test(v)) { const x = sumVals[i]; if (typeof x === "number") s += x; } }); return s;
  },
  COUNTIF: (a, ev) => { const { vals, test } = critRange(ev, a[0]!, a[1]!); return vals.filter(test).length; },
  AVERAGEIF: (a, ev) => {
    const { vals, test } = critRange(ev, a[0]!, a[1]!); const avg = a[2] ? ev.rangeRows(a[2]).flat() : vals;
    let s = 0, k = 0; vals.forEach((v, i) => { if (test(v)) { const x = avg[i]; if (typeof x === "number") { s += x; k++; } } }); return k ? s / k : err("#DIV/0!");
  },
  SUMIFS: (a, ev) => multiIfs(ev, a, 1, "sum"),
  COUNTIFS: (a, ev) => multiIfs(ev, a, 0, "count"),
  AVERAGEIFS: (a, ev) => multiIfs(ev, a, 1, "avg"),
  MAXIFS: (a, ev) => multiIfs(ev, a, 1, "max"),
  MINIFS: (a, ev) => multiIfs(ev, a, 1, "min"),

  VLOOKUP: (a, ev) => {
    const key = ev.scalar(a[0] ?? null); const tbl = ev.rangeRows(a[1]!); const ci = num(ev, a[2]); if (isErr(key)) return key; if (isErr(ci)) return ci;
    const approx = a[3] === undefined ? true : toBool(ev.scalar(a[3])); if (isErr(approx)) return approx;
    const col = Math.trunc(ci) - 1; if (col < 0 || col >= (tbl[0]?.length ?? 0)) return err("#REF!");
    let hit = -1;
    if (approx) { for (let i = 0; i < tbl.length; i++) { const c = lookupCompare(tbl[i]![0]!, key); if (c <= 0 && rank(tbl[i]![0]!) === rank(key)) hit = i; else if (c > 0) break; } }
    else hit = tbl.findIndex(r => typeof key === "string" && typeof r[0] === "string" ? wildcardRe(key).test(r[0]) : compareScalars(r[0]!, key) === 0 && rank(r[0]!) === rank(key));
    return hit < 0 ? err("#N/A") : tbl[hit]![col]!;
  },
  HLOOKUP: (a, ev) => {
    const key = ev.scalar(a[0] ?? null); const tbl = ev.rangeRows(a[1]!); const ri = num(ev, a[2]); if (isErr(key)) return key; if (isErr(ri)) return ri;
    const approx = a[3] === undefined ? true : toBool(ev.scalar(a[3])); if (isErr(approx)) return approx;
    const row = Math.trunc(ri) - 1; if (row < 0 || row >= tbl.length) return err("#REF!");
    const head = tbl[0] ?? []; let hit = -1;
    if (approx) { for (let i = 0; i < head.length; i++) { if (compareScalars(head[i]!, key) <= 0 && rank(head[i]!) === rank(key)) hit = i; else break; } }
    else hit = head.findIndex(v => compareScalars(v, key) === 0 && rank(v) === rank(key));
    return hit < 0 ? err("#N/A") : tbl[row]![hit]!;
  },
  INDEX: (a, ev) => {
    const rows = ev.rangeRows(a[0]!); const r = num(ev, a[1], 0), c = num(ev, a[2], 0); if (isErr(r)) return r; if (isErr(c)) return c;
    const flat1d = rows.length === 1 || (rows[0]?.length ?? 0) === 1;
    let ri = Math.trunc(r), ci = Math.trunc(c);
    if (flat1d && a[2] === undefined) { if (rows.length === 1) { ci = ri; ri = 1; } else ci = 1; }
    if (ri === 0 && ci === 0) return err("#VALUE!");
    if (ri === 0) return { kind: "array", rows: rows.map(row => [row[ci - 1] ?? err("#REF!")]) };
    if (ci === 0) return { kind: "array", rows: [rows[ri - 1] ?? [err("#REF!")]] };
    const v = rows[ri - 1]?.[ci - 1];
    return v === undefined ? err("#REF!") : v;
  },
  MATCH: (a, ev) => {
    const key = ev.scalar(a[0] ?? null); const arr = ev.rangeRows(a[1]!).flat(); const mt = num(ev, a[2], 1); if (isErr(key)) return key; if (isErr(mt)) return mt;
    if (mt === 0) { const i = arr.findIndex(v => typeof key === "string" && typeof v === "string" ? wildcardRe(key).test(v) : compareScalars(v, key) === 0 && rank(v) === rank(key)); return i < 0 ? err("#N/A") : i + 1; }
    let hit = -1;
    for (let i = 0; i < arr.length; i++) { const c = compareScalars(arr[i]!, key); if (rank(arr[i]!) !== rank(key)) continue; if (mt > 0 ? c <= 0 : c >= 0) hit = i; else break; }
    return hit < 0 ? err("#N/A") : hit + 1;
  },
  XLOOKUP: (a, ev) => {
    const key = ev.scalar(a[0] ?? null); const look = ev.rangeRows(a[1]!); const ret = ev.rangeRows(a[2]!); if (isErr(key)) return key;
    const flatL = look.flat(); const i = flatL.findIndex(v => compareScalars(v, key) === 0 && rank(v) === rank(key));
    if (i < 0) return a[3] !== undefined ? (a[3] as Val) : err("#N/A");
    if (look.length === 1) return ret.length === 1 ? ret[0]![i] ?? err("#N/A") : { kind: "array", rows: ret.map(r => [r[i]!]) };
    return ret[i]?.length === 1 ? ret[i]![0]! : { kind: "array", rows: [ret[i] ?? []] };
  },
  LOOKUP: (a, ev) => {
    const key = ev.scalar(a[0] ?? null); const look = ev.rangeRows(a[1]!).flat(); const res = a[2] ? ev.rangeRows(a[2]).flat() : look; if (isErr(key)) return key;
    let hit = -1; for (let i = 0; i < look.length; i++) { if (rank(look[i]!) === rank(key) && compareScalars(look[i]!, key) <= 0) hit = i; else if (compareScalars(look[i]!, key) > 0) break; }
    return hit < 0 ? err("#N/A") : res[hit] ?? err("#N/A");
  },
  TRANSPOSE: (a, ev) => { const r = ev.rangeRows(a[0]!); return { kind: "array", rows: (r[0] ?? []).map((_, j) => r.map(row => row[j]!)) }; },
  ADDRESS: (a, ev) => { const r = num(ev, a[0]), c = num(ev, a[1]); if (isErr(r)) return r; if (isErr(c)) return c; return `$${columnLetterFromIndex(Math.trunc(c))}$${Math.trunc(r)}`; },

  TODAY: () => Math.floor(dateToSerial(new Date())),
  NOW: () => dateToSerial(new Date()),
  DATE: (a, ev) => { const y = num(ev, a[0]), m = num(ev, a[1]), d = num(ev, a[2]); if (isErr(y)) return y; if (isErr(m)) return m; if (isErr(d)) return d; return Math.round(Date.UTC(Math.trunc(y), Math.trunc(m) - 1, Math.trunc(d)) / 86400000 + 25569); },
  YEAR: (a, ev) => { const s = num(ev, a[0]); return isErr(s) ? s : serialToDate(s).getUTCFullYear(); },
  MONTH: (a, ev) => { const s = num(ev, a[0]); return isErr(s) ? s : serialToDate(s).getUTCMonth() + 1; },
  DAY: (a, ev) => { const s = num(ev, a[0]); return isErr(s) ? s : serialToDate(s).getUTCDate(); },
  HOUR: (a, ev) => { const s = num(ev, a[0]); return isErr(s) ? s : Math.floor(((s % 1) + 1) % 1 * 24 + 1e-9); },
  MINUTE: (a, ev) => { const s = num(ev, a[0]); return isErr(s) ? s : Math.floor((((s * 24) % 1) + 1) % 1 * 60 + 1e-9); },
  WEEKDAY: (a, ev) => { const s = num(ev, a[0]), t = num(ev, a[1], 1); if (isErr(s)) return s; if (isErr(t)) return t; const d = serialToDate(s).getUTCDay(); return t === 2 ? ((d + 6) % 7) + 1 : t === 3 ? (d + 6) % 7 : d + 1; },
  EDATE: (a, ev) => { const s = num(ev, a[0]), m = num(ev, a[1]); if (isErr(s)) return s; if (isErr(m)) return m; const d = serialToDate(s); d.setUTCMonth(d.getUTCMonth() + Math.trunc(m)); return Math.floor(dateToSerial(d)); },
  EOMONTH: (a, ev) => { const s = num(ev, a[0]), m = num(ev, a[1]); if (isErr(s)) return s; if (isErr(m)) return m; const d = serialToDate(s); return Math.floor(dateToSerial(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + Math.trunc(m) + 1, 0)))); },
  DATEDIF: (a, ev) => {
    const s = num(ev, a[0]), e = num(ev, a[1]), u = str(ev, a[2]); if (isErr(s)) return s; if (isErr(e)) return e; if (isErr(u)) return u;
    const d1 = serialToDate(s), d2 = serialToDate(e); if (e < s) return err("#NUM!");
    const months = (d2.getUTCFullYear() - d1.getUTCFullYear()) * 12 + d2.getUTCMonth() - d1.getUTCMonth() - (d2.getUTCDate() < d1.getUTCDate() ? 1 : 0);
    switch (u.toUpperCase()) { case "D": return Math.floor(e - s); case "M": return months; case "Y": return Math.floor(months / 12); default: return err("#NUM!"); }
  },
};

function isMultiTextBool(s: string) { const u = s.toUpperCase(); return u === "TRUE" || u === "FALSE"; }

function multiIfs(ev: Evaluator, a: Val[], sumArgs: 0 | 1, kind: "sum" | "count" | "avg" | "max" | "min"): Val {
  const base = sumArgs ? ev.rangeRows(a[0]!).flat() : null;
  const pairs: { vals: Scalar[]; test: (v: Scalar) => boolean }[] = [];
  for (let i = sumArgs; i + 1 < a.length; i += 2) pairs.push(critRange(ev, a[i]!, a[i + 1]!));
  const len = pairs[0]?.vals.length ?? 0;
  if (pairs.some(p => p.vals.length !== len)) return err("#VALUE!");
  const hits: number[] = [];
  for (let i = 0; i < len; i++) if (pairs.every(p => p.test(p.vals[i]!))) hits.push(i);
  if (kind === "count") return hits.length;
  const nums = hits.map(i => base![i]).filter((x): x is number => typeof x === "number");
  switch (kind) {
    case "sum": return nums.reduce((x, y) => x + y, 0);
    case "avg": return nums.length ? nums.reduce((x, y) => x + y, 0) / nums.length : err("#DIV/0!");
    case "max": return nums.length ? Math.max(...nums) : 0;
    case "min": return nums.length ? Math.min(...nums) : 0;
  }
}

export const SUPPORTED_FUNCTIONS: string[] = [...Object.keys(FUNCS), "IF", "IFERROR", "IFNA", "IFS", "SWITCH", "CHOOSE", "ROW", "COLUMN", "ROWS", "COLUMNS", "ISBLANK"].sort();
