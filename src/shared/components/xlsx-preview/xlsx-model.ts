/**
 * XlsxBook: fasad non-reaktif di atas @office-kit/xlsx. Menggabungkan workbook, evaluator formula,
 * resolver style, conditional formatting, gambar, filter, pencarian, undo, export, dan laporan log.
 * Reaktivitas dikelola komponen (signal "version").
 */
import { loadWorkbook, workbookToBytes, fromArrayBuffer } from "@office-kit/xlsx/io";
import { setFullCalcOnLoad, type Workbook, type SheetRef } from "@office-kit/xlsx/workbook";
import { addImageAt, loadImage } from "@office-kit/xlsx/drawing";
import {
  ensureCell, getFreezePanes, setAutoFilter, setFreezePanes, setRowDimension, getCellExtent,
  setColumnWidth, setRowHeight, countCellsByKind, mergeCells, unmergeCells,
  type Worksheet,
} from "@office-kit/xlsx/worksheet";
import { setCellValue, makeFormula, type Cell, type CellValue } from "@office-kit/xlsx/cell";
import {
  getCellAlignment, getCellBorder, getCellDisplayText, getCellNumberFormat, setBold, setCellAlignment, setCellBackgroundColor, setCellBorder, setCellNumberFormat,
  setFontColor, setFontName, setFontSize, setItalic, setStrikethrough, setUnderline, clearCellBackground, clearCellStyle,
} from "@office-kit/xlsx/styles";
import { OpenXmlError, OpenXmlUnsupportedFormatError, rangeBoundaries, columnIndexFromLetter, tupleToCoordinate } from "@office-kit/xlsx/utils";
import { Evaluator, isErr, toCellValue, type Scalar } from "./xlsx-formula";
import { StyleResolver, type ResolvedStyle } from "./xlsx-style";
import { CfEngine } from "./xlsx-cf";
import { anchorCell } from "./xlsx-layout";
import { repairPackage } from "./xlsx-repair";

// ───────────────────────── log ─────────────────────────
export type LogLevel = "ok" | "info" | "warn" | "error";
export interface LogEntry { id: number; ts: number; level: LogLevel; area: string; message: string; detail?: string }

let logSeq = 1;
export function logEntry(level: LogLevel, area: string, message: string, detail?: string): LogEntry {
  return { id: logSeq++, ts: Date.now(), level, area, message, detail };
}

// ───────────────────────── tipe ─────────────────────────
export interface CellSnap { value: CellValue; styleId: number }
export interface EditRecord {
  sheet: string; row: number; col: number; before: CellSnap | null; after: CellSnap | null;
  /** Operasi non-sel (merge, gambar): dijalankan saat undo/redo menggantikan snapshot sel. */
  undo?: () => void;
  redo?: () => void;
}
export interface Sel { r1: number; c1: number; r2: number; c2: number }

export interface StylePatch {
  clear?: boolean;
  bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean;
  fontName?: string; fontSize?: number;
  /** "#rrggbb"; null = hitam/otomatis */
  fontColor?: string | null;
  /** "#rrggbb"; null = tanpa isi */
  fill?: string | null;
  h?: "general" | "left" | "center" | "right" | "justify" | "fill" | "centerContinuous" | "distributed";
  v?: "top" | "center" | "bottom" | "justify" | "distributed";
  wrap?: boolean;
  indentDelta?: number;
  numFmt?: string;
  border?: { kind: "all" | "outer" | "none" | "top" | "bottom" | "left" | "right"; style?: string; color?: string };
}

export interface DrawingView {
  key: string;
  /** Indeks item pada ws.drawing.items. */
  index: number;
  kind: "picture" | "chart" | "unsupported";
  anchor: any;
  name?: string;
  descr?: string;
  url?: string;
  format?: string;
  bytes?: number;
  hidden: boolean;
  note?: string;
  /** Teks di dalam shape/textbox (bila ada). */
  text?: string;
  anchorCell: { row: number; col: number };
}

function collectText(n: any, out: string[] = []): string[] {
  if (!n) return out;
  if (typeof n.name === "string" && n.name.replace(/^\{[^}]*\}/, "") === "t" && n.text) out.push(n.text);
  for (const c of n.children ?? []) collectText(c, out);
  return out;
}

export interface FilterState {
  range: { minRow: number; minCol: number; maxRow: number; maxCol: number };
  selected: Map<number, Set<string>>; // kolom absolut -> nilai yang ditampilkan ("" = kosong)
  hiddenRows: Set<number>;
  /** Baris yang disembunyikan oleh filter kita pada ekspor sebelumnya (agar bisa dibuka lagi). */
  written: Set<number>;
  touched: boolean;
}

export const BLANK_LABEL = "(Kosong)";
const IMG_MIME: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", svg: "image/svg+xml" };

export function addr(row: number, col: number, abs = false): string {
  return tupleToCoordinate(col, row, abs ? { absoluteCol: true, absoluteRow: true } : undefined);
}
export function selAddr(s: Sel): string {
  const a = addr(Math.min(s.r1, s.r2), Math.min(s.c1, s.c2));
  const b = addr(Math.max(s.r1, s.r2), Math.max(s.c1, s.c2));
  return a === b ? a : `${a}:${b}`;
}
export const normSel = (s: Sel): Sel => ({ r1: Math.min(s.r1, s.r2), c1: Math.min(s.c1, s.c2), r2: Math.max(s.r1, s.r2), c2: Math.max(s.c1, s.c2) });

export function parseAddress(text: string): Sel | undefined {
  const t = text.trim().replace(/\$/g, "");
  try {
    const b = rangeBoundaries(t.includes(":") ? t : `${t}:${t}`);
    return { r1: b.minRow, c1: b.minCol, r2: b.maxRow, c2: b.maxCol };
  } catch { return undefined; }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

// ───────────────────────── XlsxBook ─────────────────────────
export class XlsxBook {
  readonly ev: Evaluator;
  readonly styles: StyleResolver;
  readonly cf: CfEngine;
  dirty = false;
  /** Bytes berkas asli persis seperti dimuat (untuk "Unduh file sumber"). */
  sourceBytes?: Uint8Array;
  log: (e: LogEntry) => void = () => {};

  private textCache = new Map<Worksheet, Map<number, string>>();
  private filters = new Map<Worksheet, FilterState | null>();
  private drawings = new WeakMap<Worksheet, DrawingView[]>();
  private urls: string[] = [];
  private imageUrls = new WeakMap<Uint8Array, string>();
  private undoStack: EditRecord[][] = [];
  private redoStack: EditRecord[][] = [];

  constructor(public wb: Workbook, public fileName: string, public byteSize: number) {
    this.ev = new Evaluator(wb);
    this.styles = new StyleResolver(wb);
    this.cf = new CfEngine({ wb, ev: this.ev, styles: this.styles, textAt: (ws, r, c) => this.textAt(ws, r, c) });
    this.ev.onUnsupported = fn => this.log(logEntry("warn", "Formula", `Fungsi ${fn}() belum didukung mesin evaluasi; nilai cache dari file dipakai bila ada, selain itu #NAME?`));
    this.cf.onUnsupported = t => this.log(logEntry("warn", "Conditional formatting", `Aturan tipe "${t}" belum dirender`));
  }

  get isMacro(): boolean { return !!this.wb.vbaProject || /\.(xlsm|xltm)$/i.test(this.fileName); }

  dispose() { for (const u of this.urls) URL.revokeObjectURL(u); this.urls = []; }

  // ───── sheet ─────
  get sheets(): SheetRef[] { return this.wb.sheets; }
  worksheetAt(i: number): Worksheet | undefined { const s = this.wb.sheets[i]; return s?.kind === "worksheet" ? s.sheet : undefined; }

  // ───── nilai & teks ─────
  invalidate() {
    this.ev.invalidate();
    this.cf.invalidate();
    this.textCache.clear();
  }

  /** Teks tampilan sebuah sel sesuai number format (dan hasil formula bila mode live). */
  textAt(ws: Worksheet, r: number, c: number, showFormulas = false): string {
    const cell = ws.rows.get(r)?.get(c);
    if (!cell) return "";
    return this.cellText(ws, cell, showFormulas);
  }

  cellText(ws: Worksheet, cell: Cell, showFormulas = false): string {
    const v = cell.value as any;
    const isF = v && typeof v === "object" && v.kind === "formula";
    if (isF && showFormulas) return "=" + (v.formula ?? "");
    const key = cell.row * 16385 + cell.col;
    let m = this.textCache.get(ws);
    if (!m) { m = new Map(); this.textCache.set(ws, m); }
    const hit = m.get(key);
    if (hit !== undefined) return hit;
    if (m.size > 150000) m.clear(); // batasi memori pada sheet sangat besar
    let text: string;
    try {
      if (isF && this.ev.live) {
        const s = this.ev.evalFormulaCell(ws, cell.row, cell.col);
        text = getCellDisplayText(this.wb, { row: cell.row, col: cell.col, styleId: cell.styleId, value: toCellValue(s) } as Cell);
      } else text = getCellDisplayText(this.wb, cell);
    } catch { text = String((cell.value as any) ?? ""); }
    m.set(key, text);
    return text;
  }

  /** Nilai efektif (hasil formula bila perlu) sebagai skalar. */
  valueAt(ws: Worksheet, r: number, c: number): Scalar { return this.ev.cellValue(ws, r, c); }

  /** Jenis nilai untuk alignment default. */
  kindOf(ws: Worksheet, cell: Cell): "empty" | "number" | "string" | "bool" | "error" {
    const s = this.ev.cellValue(ws, cell.row, cell.col);
    if (s === null) return "empty";
    if (isErr(s)) return "error";
    return typeof s === "number" ? "number" : typeof s === "boolean" ? "bool" : "string";
  }

  rawInputText(cell: Cell | undefined): string {
    if (!cell) return "";
    const v = cell.value as any;
    if (v === null || v === undefined) return "";
    if (typeof v === "object" && v.kind === "formula") return "=" + (v.formula ?? "");
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === "object" && v.kind === "rich-text") return (v.runs as any[]).map(r => r.text).join("");
    if (typeof v === "object" && v.kind === "error") return v.code;
    if (typeof v === "object" && v.kind === "duration") return String(v.ms / 86400000);
    return String(v);
  }

  styleOf(ws: Worksheet, cell: Cell | undefined): ResolvedStyle {
    return this.styles.get(cell?.styleId ?? 0);
  }

  // ───── edit ─────
  private snap(cell: Cell | undefined): CellSnap | null {
    return cell ? { value: cell.value, styleId: cell.styleId } : null;
  }

  private writeSnap(ws: Worksheet, r: number, c: number, s: CellSnap | null) {
    if (!s) { ws.rows.get(r)?.delete(c); if (ws.rows.get(r)?.size === 0) ws.rows.delete(r); return; }
    const cell = ensureCell(ws, r, c);
    cell.value = s.value;
    cell.styleId = s.styleId;
  }

  /** Terjemahkan input pengguna menjadi nilai sel. */
  parseInput(text: string): CellValue {
    if (text === "") return null;
    if (text.startsWith("'")) return text.slice(1);
    if (text.startsWith("=") && text.length > 1) return makeFormula(text.slice(1));
    const t = text.trim();
    if (/^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
    const pct = /^([-+]?\d+(?:\.\d+)?)%$/.exec(t);
    if (pct) return Number(pct[1]) / 100;
    if (/^true$/i.test(t)) return true;
    if (/^false$/i.test(t)) return false;
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (iso) { const d = new Date(Date.UTC(+iso[1]!, +iso[2]! - 1, +iso[3]!)); if (!isNaN(+d)) return d; }
    return text;
  }

  /** Terapkan input teks ke sel; mengembalikan record untuk undo. */
  setInput(ws: Worksheet, r: number, c: number, text: string): EditRecord {
    const before = this.snap(ws.rows.get(r)?.get(c));
    const value = this.parseInput(text);
    const cell = ensureCell(ws, r, c);
    setCellValue(cell, value);
    if (value instanceof Date && getCellNumberFormat(this.wb, cell) === "General") {
      try { setCellNumberFormat(this.wb, cell, "yyyy-mm-dd"); this.styles.clear(); } catch { /* abaikan */ }
    }
    return { sheet: ws.title, row: r, col: c, before, after: this.snap(cell) };
  }

  setValueRaw(ws: Worksheet, r: number, c: number, value: CellValue, styleId?: number): EditRecord {
    const before = this.snap(ws.rows.get(r)?.get(c));
    const cell = ensureCell(ws, r, c);
    cell.value = value;
    if (styleId !== undefined) cell.styleId = styleId;
    return { sheet: ws.title, row: r, col: c, before, after: this.snap(cell) };
  }

  clearRange(ws: Worksheet, s: Sel): EditRecord[] {
    const n = normSel(s);
    const out: EditRecord[] = [];
    for (let r = n.r1; r <= n.r2; r++) {
      const row = ws.rows.get(r);
      if (!row) continue;
      for (let c = n.c1; c <= n.c2; c++) {
        const cell = row.get(c);
        if (cell && cell.value !== null) out.push(this.setValueRaw(ws, r, c, null));
      }
    }
    return out;
  }

  commit(records: EditRecord[], opts?: { styleOnly?: boolean }) {
    if (!records.length) return;
    this.undoStack.push(records);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    this.dirty = true;
    if (!opts?.styleOnly) this.ev.live = true; // perubahan murni style tidak mengubah nilai formula
    this.invalidate();
  }

  // ───── styling sel (OOXML styles.xml) ─────
  /**
   * Terapkan patch style ke seluruh sel pada rentang. Style baru didaftarkan ke stylesheet (dengan dedup)
   * dan dihitung sekali per kombinasi (styleId lama, posisi border) sehingga cepat untuk rentang besar.
   */
  applyStyle(ws: Worksheet, sel: Sel, patch: StylePatch): EditRecord[] & { capped?: boolean } {
    const n = normSel(sel);
    const area = (n.r2 - n.r1 + 1) * (n.c2 - n.c1 + 1);
    const recs: EditRecord[] & { capped?: boolean } = [];
    const cache = new Map<string, number>();
    const wb = this.wb;
    const borderMode = patch.border?.kind;
    const compute = (orig: number, flags: number): number => {
      const key = `${orig}|${borderMode ? flags : 0}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const tmp = { row: 1, col: 1, value: null, styleId: orig } as Cell;
      if (patch.clear) clearCellStyle(wb, tmp);
      if (patch.bold !== undefined) setBold(wb, tmp, patch.bold);
      if (patch.italic !== undefined) setItalic(wb, tmp, patch.italic);
      if (patch.strike !== undefined) setStrikethrough(wb, tmp, patch.strike);
      if (patch.underline !== undefined) setUnderline(wb, tmp, patch.underline ? "single" : "none");
      if (patch.fontName) setFontName(wb, tmp, patch.fontName);
      if (patch.fontSize) setFontSize(wb, tmp, patch.fontSize);
      if (patch.fontColor) setFontColor(wb, tmp, { rgb: "FF" + patch.fontColor.replace("#", "").toUpperCase() });
      if (patch.fontColor === null) setFontColor(wb, tmp, { rgb: "FF000000" });
      if (patch.fill !== undefined) {
        if (patch.fill === null) clearCellBackground(wb, tmp);
        else setCellBackgroundColor(wb, tmp, { rgb: "FF" + patch.fill.replace("#", "").toUpperCase() });
      }
      if (patch.h !== undefined || patch.v !== undefined || patch.wrap !== undefined || patch.indentDelta) {
        const a: any = getCellAlignment(wb, tmp);
        const next: any = { ...a };
        if (patch.h !== undefined) next.horizontal = patch.h;
        if (patch.v !== undefined) next.vertical = patch.v;
        if (patch.wrap !== undefined) next.wrapText = patch.wrap;
        if (patch.indentDelta) {
          next.indent = Math.max(0, (a.indent ?? 0) + patch.indentDelta);
          if (next.indent > 0 && (!next.horizontal || next.horizontal === "general")) next.horizontal = "left";
        }
        setCellAlignment(wb, tmp, next);
      }
      if (patch.numFmt !== undefined) setCellNumberFormat(wb, tmp, patch.numFmt);
      if (patch.border) {
        const b: any = patch.border;
        const color = { rgb: "FF" + (b.color ?? "#000000").replace("#", "").toUpperCase() };
        const side = (style: string | undefined) => (style ? { style, color } : { style: "none" });
        const st = b.style ?? "thin";
        const cur: any = getCellBorder(wb, tmp);
        let next: any = { ...cur };
        const T = flags & 1, B = flags & 2, L = flags & 4, R = flags & 8;
        switch (b.kind) {
          case "none": next = { ...cur, left: side(undefined), right: side(undefined), top: side(undefined), bottom: side(undefined) }; break;
          case "all": next = { ...cur, left: side(st), right: side(st), top: side(st), bottom: side(st) }; break;
          case "outer": if (T) next.top = side(st); if (B) next.bottom = side(st); if (L) next.left = side(st); if (R) next.right = side(st); break;
          case "top": if (T) next.top = side(st); break;
          case "bottom": if (B) next.bottom = side(st); break;
          case "left": if (L) next.left = side(st); break;
          case "right": if (R) next.right = side(st); break;
        }
        setCellBorder(wb, tmp, next);
      }
      cache.set(key, tmp.styleId);
      return tmp.styleId;
    };
    const flagsFor = (r: number, c: number) => (r === n.r1 ? 1 : 0) | (r === n.r2 ? 2 : 0) | (c === n.c1 ? 4 : 0) | (c === n.c2 ? 8 : 0);
    const touch = (r: number, c: number, cell: Cell | undefined) => {
      const orig = cell?.styleId ?? 0;
      const nid = compute(orig, flagsFor(r, c));
      if (nid === orig) return;
      const before = this.snap(cell);
      const target = cell ?? ensureCell(ws, r, c);
      target.styleId = nid;
      recs.push({ sheet: ws.title, row: r, col: c, before, after: this.snap(target) });
    };
    if (area <= 60000) {
      for (let r = n.r1; r <= n.r2; r++) for (let c = n.c1; c <= n.c2; c++) touch(r, c, ws.rows.get(r)?.get(c));
    } else {
      // rentang sangat besar (mis. seluruh kolom): hanya sel yang sudah ada
      recs.capped = true;
      const rows = n.r2 - n.r1 > ws.rows.size ? [...ws.rows.keys()].filter(r => r >= n.r1 && r <= n.r2) : Array.from({ length: n.r2 - n.r1 + 1 }, (_, i) => n.r1 + i);
      for (const r of rows) {
        const row = ws.rows.get(r); if (!row) continue;
        for (const [c, cell] of [...row.entries()]) if (c >= n.c1 && c <= n.c2) touch(r, c, cell);
      }
    }
    return recs;
  }

  /** Format painter: salin styleId ke seluruh rentang. */
  applyStyleId(ws: Worksheet, sel: Sel, styleId: number): EditRecord[] {
    const n = normSel(sel);
    const recs: EditRecord[] = [];
    if ((n.r2 - n.r1 + 1) * (n.c2 - n.c1 + 1) > 60000) return recs;
    for (let r = n.r1; r <= n.r2; r++) for (let c = n.c1; c <= n.c2; c++) {
      const cell = ws.rows.get(r)?.get(c);
      if ((cell?.styleId ?? 0) === styleId) continue;
      const before = this.snap(cell);
      const t = cell ?? ensureCell(ws, r, c);
      t.styleId = styleId;
      recs.push({ sheet: ws.title, row: r, col: c, before, after: this.snap(t) });
    }
    return recs;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  undo(): EditRecord[] | undefined { return this.step(this.undoStack, this.redoStack, "before"); }
  redo(): EditRecord[] | undefined { return this.step(this.redoStack, this.undoStack, "after"); }

  private step(from: EditRecord[][], to: EditRecord[][], side: "before" | "after"): EditRecord[] | undefined {
    const recs = from.pop();
    if (!recs) return undefined;
    for (const rec of [...recs].reverse()) {
      const custom = side === "before" ? rec.undo : rec.redo;
      if (custom) { custom(); continue; }
      const ws = this.findSheet(rec.sheet);
      if (ws) this.writeSnap(ws, rec.row, rec.col, rec[side]);
    }
    to.push(recs);
    this.dirty = true;
    this.invalidate();
    return recs;
  }

  findSheet(title: string): Worksheet | undefined {
    for (const s of this.wb.sheets) if (s.kind === "worksheet" && s.sheet.title === title) return s.sheet;
    return undefined;
  }

  resizeColumn(ws: Worksheet, col: number, chars: number) { setColumnWidth(ws, col, Math.max(0.5, chars)); this.dirty = true; }
  resizeRow(ws: Worksheet, row: number, pt: number) { setRowHeight(ws, row, Math.max(2, pt)); this.dirty = true; }

  freeze(ws: Worksheet, rows: number, cols: number) {
    setFreezePanes(ws, rows === 0 && cols === 0 ? undefined : { rows, cols });
    this.dirty = true;
  }

  // ───── gambar ─────
  drawingsOf(ws: Worksheet): DrawingView[] {
    let d = this.drawings.get(ws);
    if (d) return d;
    d = [];
    (ws.drawing?.items ?? []).forEach((it: any, i: number) => {
      const key = `${ws.title}#${i}`;
      const content = it.content;
      const base = { key, index: i, anchor: it.anchor, anchorCell: anchorCell(it.anchor) };
      if (content.kind === "picture") {
        const p = content.picture;
        const img = p.image;
        const mime = img ? IMG_MIME[img.format] : undefined;
        let url: string | undefined;
        if (img && mime) {
          url = this.imageUrls.get(img.bytes);
          if (!url) {
            try { url = URL.createObjectURL(new Blob([img.bytes as BlobPart], { type: mime })); this.urls.push(url); this.imageUrls.set(img.bytes, url); } catch { /* abaikan */ }
          }
        }
        d!.push({ ...base, kind: "picture", name: p.name, descr: p.descr, url, format: img?.format, bytes: img?.bytes.length, hidden: !!p.hidden, note: img ? (mime ? undefined : `Format ${img.format.toUpperCase()} tidak dapat dirender browser`) : "Data gambar tidak ditemukan" });
      } else if (content.kind === "chart") {
        d!.push({ ...base, kind: "chart", name: content.chart.isCx ? "Chart (chartex)" : "Chart", hidden: false, note: "Grafik belum dirender pada preview ini" });
      } else {
        const tag = String(content.rawTag).replace(/^\{[^}]*\}/, "");
        const text = collectText(it.raw).join(" ").trim();
        d!.push({ ...base, kind: "unsupported", name: tag, text: text || undefined, hidden: false, note: tag === "sp" ? "Shape/textbox — hanya teks & kotak yang ditampilkan" : `Objek drawing "${tag}" belum dirender` });
      }
    });
    this.drawings.set(ws, d);
    return d;
  }

  // ───── hyperlink & komentar ─────
  private linkMaps = new WeakMap<Worksheet, { links: Map<number, any>; notes: Map<number, any> }>();
  private maps(ws: Worksheet) {
    let m = this.linkMaps.get(ws);
    if (m) return m;
    const links = new Map<number, any>(), notes = new Map<number, any>();
    const expand = (ref: string, fn: (r: number, c: number) => void) => {
      const b = parseAddress(ref); if (!b) return;
      if ((b.r2 - b.r1 + 1) * (b.c2 - b.c1 + 1) > 5000) return;
      for (let r = b.r1; r <= b.r2; r++) for (let c = b.c1; c <= b.c2; c++) fn(r, c);
    };
    for (const h of ws.hyperlinks ?? []) expand(h.ref, (r, c) => links.set(r * 16385 + c, h));
    for (const cm of ws.legacyComments ?? []) expand(cm.ref, (r, c) => notes.set(r * 16385 + c, cm));
    m = { links, notes };
    this.linkMaps.set(ws, m);
    return m;
  }
  hyperlinkAt(ws: Worksheet, r: number, c: number) { return this.maps(ws).links.get(r * 16385 + c); }
  commentAt(ws: Worksheet, r: number, c: number) { return this.maps(ws).notes.get(r * 16385 + c); }

  // ───── merge ─────
  private mergeMaps = new WeakMap<Worksheet, { anchors: Map<number, any>; covered: Map<number, any>; list: any[] }>();
  mergeIndex(ws: Worksheet) {
    let m = this.mergeMaps.get(ws);
    if (m && m.list === ws.mergedCells) return m;
    const anchors = new Map<number, any>(), covered = new Map<number, any>();
    for (const g of ws.mergedCells ?? []) {
      anchors.set(g.minRow * 16385 + g.minCol, g);
      if ((g.maxRow - g.minRow + 1) * (g.maxCol - g.minCol + 1) <= 100000) {
        for (let r = g.minRow; r <= g.maxRow; r++) for (let c = g.minCol; c <= g.maxCol; c++) if (r !== g.minRow || c !== g.minCol) covered.set(r * 16385 + c, g);
      }
    }
    m = { anchors, covered, list: ws.mergedCells };
    this.mergeMaps.set(ws, m);
    return m;
  }

  invalidateMerges() { this.mergeMaps = new WeakMap(); this.invalidate(); }
  invalidateDrawings(ws: Worksheet) { this.drawings.delete(ws); }

  mergeAt(ws: Worksheet, r: number, c: number): { minRow: number; minCol: number; maxRow: number; maxCol: number } | undefined {
    if (!ws.mergedCells?.length) return undefined;
    const m = this.mergeIndex(ws);
    const k = r * 16385 + c;
    return m.covered.get(k) ?? m.anchors.get(k);
  }

  /** Perluas seleksi agar selalu mencakup seluruh merge yang beririsan (perilaku Excel). Orientasi anchor/focus dipertahankan. */
  expandSel(ws: Worksheet, sel: Sel): Sel {
    const list = ws.mergedCells;
    if (!list?.length) return sel;
    let n = normSel(sel);
    for (let guard = 0, changed = true; changed && guard < 50; guard++) {
      changed = false;
      for (const g of list) {
        if (g.maxRow < n.r1 || g.minRow > n.r2 || g.maxCol < n.c1 || g.minCol > n.c2) continue;
        if (g.minRow < n.r1 || g.maxRow > n.r2 || g.minCol < n.c1 || g.maxCol > n.c2) {
          n = { r1: Math.min(n.r1, g.minRow), c1: Math.min(n.c1, g.minCol), r2: Math.max(n.r2, g.maxRow), c2: Math.max(n.c2, g.maxCol) };
          changed = true;
        }
      }
    }
    const fr = sel.r1 <= sel.r2, fc = sel.c1 <= sel.c2;
    return { r1: fr ? n.r1 : n.r2, r2: fr ? n.r2 : n.r1, c1: fc ? n.c1 : n.c2, c2: fc ? n.c2 : n.c1 };
  }

  private rangeStr(g: { minRow: number; minCol: number; maxRow: number; maxCol: number }) {
    return `${addr(g.minRow, g.minCol)}:${addr(g.maxRow, g.maxCol)}`;
  }

  /** Gabungkan sel pada seleksi. Nilai selain sel kiri-atas dibuang (seperti Excel). */
  mergeSelection(ws: Worksheet, sel: Sel): { records: EditRecord[]; lost: number } | { error: string } {
    const n = normSel(this.expandSel(ws, sel));
    if (n.r1 === n.r2 && n.c1 === n.c2) return { error: "Pilih lebih dari satu sel untuk digabung" };
    const inner = (ws.mergedCells ?? []).filter(g => g.minRow >= n.r1 && g.maxRow <= n.r2 && g.minCol >= n.c1 && g.maxCol <= n.c2).map(g => ({ ...g }));
    if (inner.length === 1 && inner[0]!.minRow === n.r1 && inner[0]!.maxRow === n.r2 && inner[0]!.minCol === n.c1 && inner[0]!.maxCol === n.c2) return { error: "Rentang ini sudah digabung" };
    const records: EditRecord[] = [];
    let lost = 0;
    for (const [r, row] of ws.rows) {
      if (r < n.r1 || r > n.r2) continue;
      for (const [c, cell] of [...row.entries()]) {
        if (c < n.c1 || c > n.c2 || (r === n.r1 && c === n.c1) || cell.value === null) continue;
        records.push(this.setValueRaw(ws, r, c, null)); lost++;
      }
    }
    const target = this.rangeStr({ minRow: n.r1, minCol: n.c1, maxRow: n.r2, maxCol: n.c2 });
    const apply = () => { for (const g of inner) unmergeCells(ws, this.rangeStr(g)); mergeCells(ws, target); this.invalidateMerges(); };
    const revert = () => { unmergeCells(ws, target); for (const g of inner) mergeCells(ws, this.rangeStr(g)); this.invalidateMerges(); };
    apply();
    records.push({ sheet: ws.title, row: n.r1, col: n.c1, before: null, after: null, undo: revert, redo: apply });
    return { records, lost };
  }

  unmergeSelection(ws: Worksheet, sel: Sel): { records: EditRecord[]; count: number } | { error: string } {
    const n = normSel(sel);
    const hit = (ws.mergedCells ?? []).filter(g => !(g.maxRow < n.r1 || g.minRow > n.r2 || g.maxCol < n.c1 || g.minCol > n.c2)).map(g => ({ ...g }));
    if (!hit.length) return { error: "Tidak ada sel gabungan pada seleksi" };
    const apply = () => { for (const g of hit) unmergeCells(ws, this.rangeStr(g)); this.invalidateMerges(); };
    const revert = () => { for (const g of hit) mergeCells(ws, this.rangeStr(g)); this.invalidateMerges(); };
    apply();
    return { records: [{ sheet: ws.title, row: n.r1, col: n.c1, before: null, after: null, undo: revert, redo: apply }], count: hit.length };
  }

  // ───── gambar mengambang: pindah / ubah ukuran / hapus / sisip ─────
  /** Hanya gambar (picture) yang dapat diedit; shape & grafik dipertahankan apa adanya. */
  moveDrawing(ws: Worksheet, index: number, anchor: any): EditRecord | undefined {
    const item: any = ws.drawing?.items[index];
    if (!item || item.content.kind !== "picture") return undefined;
    const old = item.anchor;
    const oldRaw = item.raw;
    const set = (a: any) => { item.anchor = a; item.raw = undefined; this.invalidateDrawings(ws); };
    set(anchor);
    return { sheet: ws.title, row: 0, col: 0, before: null, after: null, undo: () => { item.anchor = old; item.raw = oldRaw; this.invalidateDrawings(ws); }, redo: () => set(anchor) };
  }

  deleteDrawing(ws: Worksheet, index: number): EditRecord | undefined {
    const items: any[] | undefined = ws.drawing?.items;
    const item = items?.[index];
    if (!items || !item || item.content.kind !== "picture") return undefined;
    items.splice(index, 1);
    this.invalidateDrawings(ws);
    return {
      sheet: ws.title, row: 0, col: 0, before: null, after: null,
      undo: () => { items.splice(Math.min(index, items.length), 0, item); this.invalidateDrawings(ws); },
      redo: () => { const i = items.indexOf(item); if (i >= 0) items.splice(i, 1); this.invalidateDrawings(ws); },
    };
  }

  insertImage(ws: Worksheet, bytes: Uint8Array, row: number, col: number): { record: EditRecord; index: number; width: number; height: number } {
    const img = loadImage(bytes);
    let w = img.width || 240, h = img.height || 160;
    const max = 480;
    if (w > max) { h = (h * max) / w; w = max; }
    const item: any = addImageAt(ws, addr(row, col), img, { widthPx: Math.max(8, Math.round(w)), heightPx: Math.max(8, Math.round(h)) });
    const items: any[] = ws.drawing!.items;
    const index = items.indexOf(item);
    this.invalidateDrawings(ws);
    return {
      index, width: Math.round(w), height: Math.round(h),
      record: {
        sheet: ws.title, row, col, before: null, after: null,
        undo: () => { const i = items.indexOf(item); if (i >= 0) items.splice(i, 1); this.invalidateDrawings(ws); },
        redo: () => { if (!items.includes(item)) items.splice(Math.min(index, items.length), 0, item); this.invalidateDrawings(ws); },
      },
    };
  }

  // ───── autofilter ─────
  filterOf(ws: Worksheet): FilterState | undefined {
    if (this.filters.has(ws)) return this.filters.get(ws) ?? undefined;
    const af = ws.autoFilter ?? ws.tables?.find(t => t.autoFilter)?.autoFilter ?? undefined;
    const ref = af?.ref ?? ws.tables?.[0]?.ref;
    let st: FilterState | null = null;
    if (ref && (ws.autoFilter || ws.tables?.length)) {
      const b = parseAddress(ref);
      if (b) {
        st = { range: { minRow: b.r1, minCol: b.c1, maxRow: b.r2, maxCol: b.c2 }, selected: new Map(), hiddenRows: new Set(), written: new Set(), touched: false };
        for (const fc of af?.filterColumns ?? []) {
          if ((fc as any).kind === "filters") {
            const vals = new Set<string>((fc as any).values as string[]);
            if ((fc as any).blank) vals.add("");
            st.selected.set(b.c1 + fc.colId, vals);
          }
        }
        if (st.selected.size) {
          // filter aktif dari file: atribut hidden pada baris data adalah hasil filter -> dihitung ulang oleh model
          for (let r = b.r1 + 1; r <= b.r2; r++) { const d = ws.rowDimensions.get(r); if (d?.hidden) st.written.add(r); }
          this.recomputeFilter(ws, st);
          for (const r of st.written) setRowDimension(ws, r, { hidden: false });
        }
      }
    }
    this.filters.set(ws, st);
    return st ?? undefined;
  }

  enableFilter(ws: Worksheet, sel: Sel): FilterState | undefined {
    const n = normSel(sel);
    let range = { minRow: n.r1, minCol: n.c1, maxRow: n.r2, maxCol: n.c2 };
    if (n.r1 === n.r2 && n.c1 === n.c2) {
      // satu sel: otomatis perluas ke seluruh blok data (current region)
      const ext = getCellExtent(ws);
      if (!ext) return undefined;
      range = { minRow: n.r1, minCol: ext.minCol, maxRow: ext.maxRow, maxCol: ext.maxCol };
    }
    const st: FilterState = { range, selected: new Map(), hiddenRows: new Set(), written: new Set(), touched: true };
    this.filters.set(ws, st);
    this.dirty = true;
    return st;
  }

  disableFilter(ws: Worksheet) {
    this.filters.set(ws, null);
    setAutoFilter(ws, undefined);
    const keepTables = ws.tables?.length;
    if (keepTables) for (const t of ws.tables) t.autoFilter = undefined as any;
    this.dirty = true;
  }

  recomputeFilter(ws: Worksheet, st: FilterState) {
    st.hiddenRows = new Set();
    const active = [...st.selected.entries()];
    if (!active.length) return;
    for (let r = st.range.minRow + 1; r <= st.range.maxRow; r++) {
      for (const [col, allowed] of active) {
        const t = this.textAt(ws, r, col);
        if (!allowed.has(t)) { st.hiddenRows.add(r); break; }
      }
    }
  }

  setFilterColumn(ws: Worksheet, st: FilterState, col: number, allowed: Set<string> | null) {
    if (allowed === null) st.selected.delete(col); else st.selected.set(col, allowed);
    st.touched = true;
    this.dirty = true;
    this.recomputeFilter(ws, st);
  }

  uniqueValues(ws: Worksheet, st: FilterState, col: number): { value: string; count: number }[] {
    const m = new Map<string, number>();
    for (let r = st.range.minRow + 1; r <= st.range.maxRow; r++) {
      const t = this.textAt(ws, r, col);
      m.set(t, (m.get(t) ?? 0) + 1);
    }
    return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => {
      const na = Number(a.value), nb = Number(b.value);
      if (a.value !== "" && b.value !== "" && !isNaN(na) && !isNaN(nb)) return na - nb;
      return a.value.localeCompare(b.value, undefined, { numeric: true, sensitivity: "base" });
    });
  }

  /** Tulis keadaan filter ke model OOXML sebelum disimpan. */
  private flushFilters() {
    for (const [ws, st] of this.filters) {
      if (!st || !st.touched) continue;
      const ref = `${addr(st.range.minRow, st.range.minCol)}:${addr(st.range.maxRow, st.range.maxCol)}`;
      const filterColumns = [...st.selected.entries()].map(([col, vals]) => ({
        kind: "filters" as const,
        colId: col - st.range.minCol,
        values: [...vals].filter(v => v !== ""),
        ...(vals.has("") ? { blank: true } : {}),
      }));
      setAutoFilter(ws, { ref, filterColumns } as any);
      for (let r = st.range.minRow + 1; r <= st.range.maxRow; r++) {
        if (st.hiddenRows.has(r)) { setRowDimension(ws, r, { hidden: true }); st.written.add(r); }
        else if (st.written.has(r)) { setRowDimension(ws, r, { hidden: false }); st.written.delete(r); }
      }
    }
  }

  // ───── simpan ─────
  /** Isi ulang cache nilai formula agar viewer lain (tanpa kalkulasi) menampilkan hasil terbaru. */
  refreshFormulaCaches(): number {
    const prev = this.ev.live;
    this.ev.live = true;
    this.ev.invalidate();
    let n = 0;
    for (const s of this.wb.sheets) {
      if (s.kind !== "worksheet") continue;
      for (const [r, row] of s.sheet.rows) for (const [c, cell] of row) {
        const f: any = cell.value;
        if (!f || f.kind !== "formula") continue;
        const res = this.ev.evalFormulaCell(s.sheet, r, c);
        if (isErr(res) && (res.code === "#NAME?" || res.code === "#CIRC!")) continue;
        const next: any = { ...f };
        if (isErr(res)) { next.cachedValue = res.code; next.cachedValueType = "error"; }
        else if (res === null) { delete next.cachedValue; delete next.cachedValueType; }
        else { next.cachedValue = res; delete next.cachedValueType; }
        cell.value = next;
        n++;
      }
    }
    this.ev.live = prev;
    this.ev.invalidate();
    return n;
  }

  async toBytes(): Promise<Uint8Array> {
    this.flushFilters();
    if (this.dirty) {
      this.refreshFormulaCaches();
      try { setFullCalcOnLoad(this.wb, true); } catch { /* abaikan */ }
    }
    const raw = await workbookToBytes(this.wb);
    // Library menulis beberapa elemen di luar urutan skema & mempertahankan calcChain usang → Excel meminta "recover".
    const fixed = await repairPackage(raw);
    if (fixed.report.changed) {
      const parts = [
        ...fixed.report.reordered.map(r => `${r.part.replace(/^xl\//, "")}: ${r.moved.join(", ")}`),
        ...fixed.report.removed.map(r => `${r} dibuang (dibangun ulang Excel)`),
      ];
      this.log(logEntry("info", "Simpan", `Paket disesuaikan agar dapat dibuka Excel tanpa recover (${parts.length} perbaikan)`, parts.join(String.fromCharCode(10))));
    }
    return fixed.bytes;
  }

  get saveName(): string {
    const base = this.fileName.replace(/\.(xlsx|xlsm|xltx|xltm)$/i, "");
    const ext = this.isMacro ? "xlsm" : "xlsx";
    return `${base}${this.dirty ? "-edited" : ""}.${ext}`;
  }

  // ───── CSV ─────
  toCsv(ws: Worksheet, opts: { sel?: Sel; raw?: boolean; skipHidden?: boolean; separator?: string; bom?: boolean; hiddenRows?: Set<number>; hiddenCols?: Set<number> } = {}): string {
    const ext = getCellExtent(ws);
    if (!ext && !opts.sel) return "";
    const n = opts.sel ? normSel(opts.sel) : { r1: ext!.minRow > 0 ? 1 : 1, c1: 1, r2: ext!.maxRow, c2: ext!.maxCol };
    const sep = opts.separator ?? ",";
    const esc = (s: string) => (/[",\r\n]/.test(s) || s.includes(sep) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines: string[] = [];
    for (let r = n.r1; r <= n.r2; r++) {
      if (opts.skipHidden && (opts.hiddenRows?.has(r) || ws.rowDimensions.get(r)?.hidden)) continue;
      const cells: string[] = [];
      for (let c = n.c1; c <= n.c2; c++) {
        if (opts.skipHidden && opts.hiddenCols?.has(c)) continue;
        const cell = ws.rows.get(r)?.get(c);
        if (!cell) { cells.push(""); continue; }
        if (opts.raw) {
          const v = this.ev.cellValue(ws, r, c);
          cells.push(esc(isErr(v) ? v.code : v === null ? "" : String(v)));
        } else cells.push(esc(this.cellText(ws, cell)));
      }
      lines.push(cells.join(sep));
    }
    return (opts.bom === false ? "" : "﻿") + lines.join("\r\n");
  }

  toTsv(ws: Worksheet, sel: Sel): string {
    const n = normSel(sel);
    const rows: string[] = [];
    for (let r = n.r1; r <= n.r2; r++) {
      const cells: string[] = [];
      for (let c = n.c1; c <= n.c2; c++) {
        const t = this.textAt(ws, r, c);
        cells.push(/[\t\r\n"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
      }
      rows.push(cells.join("\t"));
    }
    return rows.join("\r\n");
  }

  /** Paste: baris TSV → array 2D (menangani kutipan Excel). */
  static parseTsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [], cur = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"' && cur === "") q = true;
      else if (ch === "\t") { row.push(cur); cur = ""; }
      else if (ch === "\n") { row.push(cur.replace(/\r$/, "")); rows.push(row); row = []; cur = ""; }
      else cur += ch;
    }
    if (cur !== "" || row.length) { row.push(cur.replace(/\r$/, "")); rows.push(row); }
    return rows;
  }

  // ───── pencarian ─────
  search(opts: SearchOptions): SearchResult {
    const g = this.searchGen(opts);
    let r = g.next();
    while (!r.done) r = g.next();
    return r.value;
  }

  /** Pencarian bertahap: berhenti sejenak tiap ±16 ribu sel agar UI tidak membeku pada sheet raksasa. */
  async searchAsync(opts: SearchOptions, cancelled: () => boolean, progress?: (scanned: number) => void): Promise<SearchResult | undefined> {
    const g = this.searchGen(opts);
    let scanned = 0;
    for (;;) {
      const r = g.next();
      if (r.done) return r.value;
      scanned += 16384;
      progress?.(scanned);
      await new Promise(res => setTimeout(res, 0));
      if (cancelled()) return undefined;
    }
  }

  private *searchGen(opts: SearchOptions): Generator<void, SearchResult, void> {
    const started = performance.now();
    const results: SearchHit[] = [];
    const q = opts.query;
    if (!q) return { hits: [], truncated: false, ms: 0, perSheet: new Map() };
    let re: RegExp | undefined;
    if (opts.regex) { try { re = new RegExp(q, opts.matchCase ? "" : "i"); } catch { return { hits: [], truncated: false, ms: 0, perSheet: new Map(), error: "Regex tidak valid" }; } }
    const needle = opts.matchCase ? q : q.toLowerCase();
    const cols = opts.columns ? parseColumnSpec(opts.columns) : undefined;
    const limit = opts.limit ?? 3000;
    let truncated = false;
    let scanned = 0;
    const perSheet = new Map<string, number>();
    const targets = opts.allSheets ? this.wb.sheets.filter(s => s.kind === "worksheet").map(s => (s as any).sheet as Worksheet) : opts.sheet ? [opts.sheet] : [];
    outer: for (const ws of targets) {
      const rowKeys = [...ws.rows.keys()].sort((a, b) => a - b);
      for (const r of rowKeys) {
        const row = ws.rows.get(r)!;
        if (opts.selection && opts.sheet === ws && (r < opts.selection.r1 || r > opts.selection.r2)) continue;
        for (const c of [...row.keys()].sort((a, b) => a - b)) {
          if (cols && !cols.has(c)) continue;
          if (opts.selection && opts.sheet === ws && (c < opts.selection.c1 || c > opts.selection.c2)) continue;
          const cell = row.get(c)!;
          if ((++scanned & 0x3fff) === 0) yield;
          if (cell.value === null) continue;
          const f: any = cell.value;
          const isF = f && typeof f === "object" && f.kind === "formula";
          const shown = this.cellText(ws, cell);
          const fText = isF ? "=" + f.formula : "";
          const candidates = opts.inFormulas && isF ? [shown, fText] : [shown];
          let hitText: string | undefined;
          for (const cand of candidates) {
            const hay = opts.matchCase ? cand : cand.toLowerCase();
            const ok = re ? re.test(cand) : opts.wholeCell ? hay === needle : hay.includes(needle);
            if (ok) { hitText = cand; break; }
          }
          if (hitText === undefined) continue;
          results.push({ sheet: ws.title, row: r, col: c, address: addr(r, c), text: shown, formula: isF ? fText : undefined, matchedIn: hitText === fText && isF ? "formula" : "value" });
          perSheet.set(ws.title, (perSheet.get(ws.title) ?? 0) + 1);
          if (results.length >= limit) { truncated = true; break outer; }
        }
      }
    }
    return { hits: results, truncated, ms: performance.now() - started, perSheet };
  }
}

export interface SearchOptions {
  query: string;
  sheet?: Worksheet;
  allSheets?: boolean;
  selection?: Sel;
  matchCase?: boolean;
  wholeCell?: boolean;
  regex?: boolean;
  inFormulas?: boolean;
  /** Spesifikasi kolom: "A", "A,C:E", dst. */
  columns?: string;
  limit?: number;
}
export interface SearchHit { sheet: string; row: number; col: number; address: string; text: string; formula?: string; matchedIn: "value" | "formula" }
export interface SearchResult { hits: SearchHit[]; truncated: boolean; ms: number; perSheet: Map<string, number>; error?: string }

export function parseColumnSpec(spec: string): Set<number> | undefined {
  const out = new Set<number>();
  for (const part of spec.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^([A-Za-z]{1,3})(?::([A-Za-z]{1,3}))?$/.exec(part);
    if (!m) continue;
    const a = columnIndexFromLetter(m[1]!.toUpperCase());
    const b = m[2] ? columnIndexFromLetter(m[2].toUpperCase()) : a;
    for (let c = Math.min(a, b); c <= Math.max(a, b); c++) out.add(c);
  }
  return out.size ? out : undefined;
}

// ───────────────────────── load ─────────────────────────
export interface LoadOutcome { book?: XlsxBook; entries: LogEntry[] }

export async function loadBook(bytes: ArrayBuffer | Uint8Array, fileName: string): Promise<LoadOutcome> {
  const entries: LogEntry[] = [];
  const t0 = performance.now();
  const size = bytes.byteLength;
  try {
    const wb = await loadWorkbook(fromArrayBuffer(bytes));
    const book = new XlsxBook(wb, fileName, size);
    book.sourceBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    entries.push(logEntry("ok", "Load", `Berkas "${fileName}" (${formatBytes(size)}) berhasil dibaca dalam ${(performance.now() - t0).toFixed(0)} ms`));
    entries.push(...buildLoadReport(book));
    return { book, entries };
  } catch (e: any) {
    let msg = e?.message ?? String(e);
    let hint = "";
    if (e instanceof OpenXmlUnsupportedFormatError) {
      const f = (e as any).format;
      hint = f === "encrypted-xlsx" ? "Berkas terenkripsi/diproteksi password — dekripsi terlebih dahulu." : f === "legacy-xls" ? "Format .xls (BIFF) lama — simpan ulang sebagai .xlsx." : "Format Office lain.";
    } else if (e instanceof OpenXmlError) hint = `Kesalahan OOXML (${e.constructor.name})`;
    entries.push(logEntry("error", "Load", `Gagal membaca "${fileName}": ${msg}`, hint || e?.stack));
    return { entries };
  }
}

const PASSTHROUGH_KINDS: [RegExp, string][] = [
  [/pivotTables?\//i, "Pivot table"], [/pivotCache/i, "Pivot cache"], [/externalLinks?\//i, "External link"],
  [/customXml\//i, "Custom XML"], [/threadedComments?\//i, "Threaded comment"], [/persons?\//i, "Persons (komentar berutas)"],
  [/slicers?\//i, "Slicer"], [/timelines?\//i, "Timeline"], [/queryTables?\//i, "Query table / Power Query"], [/connections\.xml/i, "Data connections"],
  [/ctrlProps\//i, "Form control"], [/activeX\//i, "ActiveX"], [/embeddings\//i, "Embedded object (OLE)"], [/customUI\//i, "Custom UI ribbon"],
  [/printerSettings\//i, "Printer settings"], [/metadata\.xml/i, "Metadata (dynamic array)"], [/richData\//i, "Rich data"], [/calcChain/i, "Calc chain"],
  [/vbaProject/i, "VBA project"], [/macrosheets?\//i, "Macro sheet (XLM)"], [/dialogsheets?\//i, "Dialog sheet"],
];

/** Laporan "apa yang berhasil dibaca / tidak" setelah load. */
export function buildLoadReport(book: XlsxBook): LogEntry[] {
  const wb = book.wb;
  const out: LogEntry[] = [];
  const L = (level: LogLevel, area: string, msg: string, detail?: string) => out.push(logEntry(level, area, msg, detail));

  const sheets = wb.sheets;
  const ws = sheets.filter(s => s.kind === "worksheet");
  const cs = sheets.filter(s => s.kind === "chartsheet");
  L("ok", "Workbook", `${ws.length} worksheet${cs.length ? `, ${cs.length} chartsheet` : ""} terbaca`, sheets.map(s => `${s.sheet.title} [${s.state}]`).join("\n"));
  if (cs.length) L("warn", "Chartsheet", `${cs.length} chartsheet ditampilkan sebagai placeholder (grafik belum dirender)`);
  const hidden = sheets.filter(s => s.state !== "visible");
  if (hidden.length) L("info", "Workbook", `${hidden.length} sheet tersembunyi: ${hidden.map(s => `${s.sheet.title} (${s.state})`).join(", ")}`);

  L("ok", "Style", `Stylesheet: ${wb.styles.fonts.length} font, ${wb.styles.fills.length} fill, ${wb.styles.borders.length} border, ${(wb.styles as any).cellXfs?.length ?? "?"} xf`);
  L(book.styles.themeFromFile ? "ok" : "info", "Tema", book.styles.themeFromFile ? "Palet warna tema dibaca dari theme1.xml" : "theme1.xml tidak ada/tidak terbaca — memakai palet Office default");

  // Makro
  if (wb.vbaProject) {
    L("warn", "Makro (VBA)", `VBA project ditemukan (${formatBytes(wb.vbaProject.length)}${wb.vbaSignature ? ", bertanda tangan digital" : ""}). Makro TIDAK dieksekusi maupun ditampilkan kodenya; biner dipertahankan apa adanya saat disimpan sebagai .xlsm.`);
  } else if (/\.(xlsm|xltm)$/i.test(book.fileName)) {
    L("info", "Makro (VBA)", "Ekstensi .xlsm tetapi tidak ada vbaProject.bin di dalam paket.");
  }

  // Part yang dipertahankan tetapi tidak dirender
  const kinds = new Map<string, number>();
  for (const k of wb.passthrough?.keys() ?? []) {
    const hit = PASSTHROUGH_KINDS.find(([re]) => re.test(k));
    const label = hit ? hit[1] : "Part lain";
    kinds.set(label, (kinds.get(label) ?? 0) + 1);
  }
  for (const [label, n] of kinds) {
    if (label === "Calc chain" || label === "Printer settings") { L("info", "Passthrough", `${label}: ${n} part dipertahankan`); continue; }
    L("warn", "Passthrough", `${label}: ${n} part dipertahankan byte-per-byte saat simpan, tetapi tidak dirender di preview`);
  }
  if (wb.pivotCaches?.length) L("warn", "Pivot", `${wb.pivotCaches.length} pivot cache — tabel pivot tampil sebagai nilai terakhir yang tersimpan`);
  if (wb.externalReferences?.length) L("info", "External link", `${wb.externalReferences.length} referensi eksternal; nilai cache dipakai`);
  if (wb.workbookProtection) L("info", "Proteksi", "Struktur workbook diproteksi (tidak ditegakkan oleh preview ini)");

  // Defined names
  if (wb.definedNames?.length) L("ok", "Defined name", `${wb.definedNames.length} nama terdefinisi`, wb.definedNames.map(d => `${d.name} = ${d.value}`).join("\n"));

  // Per sheet
  for (const s of sheets) {
    if (s.kind !== "worksheet") continue;
    const w = s.sheet;
    const ext = getCellExtent(w);
    const kinds = countCellsByKind(w);
    L("ok", `Sheet «${w.title}»`, ext ? `${ext.maxRow} baris × ${ext.maxCol} kolom; ${kinds.formula} formula, ${kinds.string} teks, ${kinds.number} angka, ${kinds.date} tanggal, ${kinds.error} error` : "Sheet kosong");
    if (ext && ext.maxRow >= 100000) L("info", `Sheet «${w.title}»`, `Sheet besar (${ext.maxRow.toLocaleString()} baris): grid tervirtualisasi — hanya baris yang terlihat yang dirender; scroll dipetakan bila melebihi batas tinggi elemen browser`);
    const freeze = getFreezePanes(w);
    if (freeze) L("ok", `Sheet «${w.title}»`, `Freeze panes pada ${freeze}`);
    const hc = [...w.columnDimensions.values()].filter(d => d.hidden).length;
    const hr = [...w.rowDimensions.values()].filter(d => d.hidden).length;
    if (hc || hr) L("ok", `Sheet «${w.title}»`, `Tersembunyi: ${hc} kelompok kolom, ${hr} baris`);
    if (w.mergedCells?.length) L("ok", `Sheet «${w.title}»`, `${w.mergedCells.length} merged range`);
    if (w.autoFilter) L("ok", `Sheet «${w.title}»`, `AutoFilter ${w.autoFilter.ref}${w.autoFilter.filterColumns.length ? ` (${w.autoFilter.filterColumns.length} kolom terfilter)` : ""}`);
    if (w.tables?.length) L("ok", `Sheet «${w.title}»`, `${w.tables.length} tabel (${w.tables.map(t => t.displayName).join(", ")}); gaya tabel Excel disederhanakan`);
    if (w.legacyComments?.length) L("ok", `Sheet «${w.title}»`, `${w.legacyComments.length} komentar`);
    if (w.hyperlinks?.length) L("ok", `Sheet «${w.title}»`, `${w.hyperlinks.length} hyperlink`);
    if (w.dataValidations?.length) L("info", `Sheet «${w.title}»`, `${w.dataValidations.length} data validation terbaca (dropdown/validasi input belum ditegakkan di preview)`);
    if (w.conditionalFormatting?.length) {
      const types = new Map<string, number>();
      for (const cf of w.conditionalFormatting) for (const r of cf.rules) types.set(r.type, (types.get(r.type) ?? 0) + 1);
      const unsupported = [...types.keys()].filter(t => t === "iconSet" || t === "timePeriod");
      L(unsupported.length ? "warn" : "ok", `Sheet «${w.title}»`, `Conditional formatting: ${[...types].map(([t, n]) => `${t}×${n}`).join(", ")}${unsupported.length ? ` — ${unsupported.join(", ")} belum dirender` : ""}`);
    }
    if (w.sheetProtection) L("info", `Sheet «${w.title}»`, "Sheet diproteksi (editing tetap diizinkan di preview)");
    if (w.oleObjects?.length || w.controls?.length) L("warn", `Sheet «${w.title}»`, `${w.oleObjects?.length ?? 0} objek OLE & ${w.controls?.length ?? 0} form control tidak dirender`);
    const dv = book.drawingsOf(w);
    const pics = dv.filter(d => d.kind === "picture");
    const okPics = pics.filter(d => d.url);
    if (pics.length) L(okPics.length === pics.length ? "ok" : "warn", `Sheet «${w.title}»`, `${okPics.length}/${pics.length} gambar mengambang dirender`, pics.filter(d => !d.url).map(d => d.note).join("\n") || undefined);
    const charts = dv.filter(d => d.kind === "chart").length;
    if (charts) L("warn", `Sheet «${w.title}»`, `${charts} grafik: ditampilkan sebagai placeholder`);
    const shapes = dv.filter(d => d.kind === "unsupported");
    if (shapes.length) L("warn", `Sheet «${w.title}»`, `${shapes.length} objek drawing tidak didukung (${[...new Set(shapes.map(s => s.name))].join(", ")})`);
    const extras = w.bodyExtras;
    const extraNames = [...(extras?.beforeSheetData ?? []), ...(extras?.afterSheetData ?? [])].map(n => n.name.replace(/^\{[^}]*\}/, ""));
    if (extraNames.length) L("info", `Sheet «${w.title}»`, `Elemen tambahan dipertahankan: ${[...new Set(extraNames)].join(", ")}`, extraNames.includes("extLst") ? "extLst dapat memuat sparkline / conditional format x14 yang tidak dirender." : undefined);
  }
  return out;
}

// ───────────────────────── info (panel) ─────────────────────────
export interface InfoRow { label: string; value: string }
export interface InfoGroup { title: string; rows: InfoRow[] }

export function workbookInfo(book: XlsxBook): InfoGroup[] {
  const wb = book.wb;
  const p: any = wb.properties ?? {};
  const a: any = wb.appProperties ?? {};
  const stats = (() => {
    let cells = 0, formulas = 0, comments = 0, links = 0, merges = 0, tables = 0;
    for (const s of wb.sheets) if (s.kind === "worksheet") {
      const k = countCellsByKind(s.sheet);
      formulas += k.formula;
      for (const row of s.sheet.rows.values()) cells += row.size;
      comments += s.sheet.legacyComments?.length ?? 0;
      links += s.sheet.hyperlinks?.length ?? 0;
      merges += s.sheet.mergedCells?.length ?? 0;
      tables += s.sheet.tables?.length ?? 0;
    }
    return { cells, formulas, comments, links, merges, tables };
  })();
  const yes = (b: unknown) => (b ? "Ya" : "Tidak");
  return [
    {
      title: "Berkas",
      rows: [
        { label: "Nama", value: book.fileName },
        { label: "Ukuran", value: formatBytes(book.byteSize) },
        { label: "Jenis", value: book.isMacro ? "Workbook macro-enabled (.xlsm)" : "Workbook (.xlsx)" },
        { label: "Perubahan belum disimpan", value: yes(book.dirty) },
      ],
    },
    {
      title: "Properti dokumen",
      rows: [
        ["Judul", p.title], ["Subjek", p.subject], ["Pembuat", p.creator], ["Terakhir diubah oleh", p.lastModifiedBy],
        ["Dibuat", p.created], ["Diubah", p.modified], ["Kata kunci", p.keywords], ["Kategori", p.category],
        ["Aplikasi", a.application], ["Versi aplikasi", a.appVersion], ["Perusahaan", a.company],
      ].filter(([, v]) => v).map(([label, value]) => ({ label: label as string, value: String(value) })),
    },
    {
      title: "Isi workbook",
      rows: [
        { label: "Sheet", value: String(wb.sheets.length) },
        { label: "Sel berisi", value: stats.cells.toLocaleString() },
        { label: "Formula", value: stats.formulas.toLocaleString() },
        { label: "Komentar", value: String(stats.comments) },
        { label: "Hyperlink", value: String(stats.links) },
        { label: "Merged range", value: String(stats.merges) },
        { label: "Tabel", value: String(stats.tables) },
        { label: "Defined names", value: String(wb.definedNames?.length ?? 0) },
        { label: "Sistem tanggal", value: wb.date1904 ? "1904" : "1900" },
        { label: "Mode kalkulasi", value: (wb.calcProperties as any)?.calcMode ?? "auto" },
        { label: "VBA project", value: wb.vbaProject ? formatBytes(wb.vbaProject.length) : "—" },
        { label: "Part passthrough", value: String(wb.passthrough?.size ?? 0) },
      ],
    },
  ];
}

export function sheetInfo(book: XlsxBook, ws: Worksheet): InfoGroup[] {
  const ext = getCellExtent(ws);
  const kinds = countCellsByKind(ws);
  const view: any = ws.views?.[0] ?? {};
  const state = book.wb.sheets.find(s => s.sheet === ws)?.state ?? "visible";
  const tab = (ws.sheetProperties as any)?.tabColor;
  const dv = book.drawingsOf(ws);
  return [
    {
      title: `Worksheet «${ws.title}»`,
      rows: [
        { label: "Status", value: state },
        { label: "Used range", value: ext ? `A1:${addr(ext.maxRow, ext.maxCol)} (${ext.maxRow} × ${ext.maxCol})` : "kosong" },
        { label: "Freeze panes", value: getFreezePanes(ws) ?? "—" },
        { label: "Zoom", value: `${view.zoomScale ?? 100}%` },
        { label: "Gridlines", value: view.showGridLines === false ? "disembunyikan" : "tampil" },
        { label: "Lebar kolom default", value: ws.defaultColumnWidth ? `${ws.defaultColumnWidth} char` : "bawaan" },
        { label: "Tinggi baris default", value: ws.defaultRowHeight ? `${ws.defaultRowHeight} pt` : "bawaan (15 pt)" },
        { label: "Dimensi kolom custom", value: String(ws.columnDimensions.size) },
        { label: "Dimensi baris custom", value: String(ws.rowDimensions.size) },
        { label: "Warna tab", value: tab ? JSON.stringify(tab) : "—" },
        { label: "Proteksi sheet", value: ws.sheetProtection ? "Ya" : "Tidak" },
      ],
    },
    {
      title: "Isi sheet",
      rows: [
        { label: "Angka", value: String(kinds.number) }, { label: "Teks", value: String(kinds.string) }, { label: "Tanggal", value: String(kinds.date) },
        { label: "Boolean", value: String(kinds.boolean) }, { label: "Error", value: String(kinds.error) }, { label: "Formula", value: String(kinds.formula) },
        { label: "Rich text", value: String(kinds["rich-text"]) },
        { label: "Merged range", value: String(ws.mergedCells?.length ?? 0) },
        { label: "Komentar", value: String(ws.legacyComments?.length ?? 0) },
        { label: "Hyperlink", value: String(ws.hyperlinks?.length ?? 0) },
        { label: "Data validation", value: String(ws.dataValidations?.length ?? 0) },
        { label: "Conditional format", value: String(ws.conditionalFormatting?.length ?? 0) },
        { label: "Tabel", value: ws.tables?.map(t => `${t.displayName} (${t.ref})`).join(", ") || "—" },
        { label: "AutoFilter", value: ws.autoFilter?.ref ?? "—" },
        { label: "Gambar / Grafik / Lainnya", value: `${dv.filter(d => d.kind === "picture").length} / ${dv.filter(d => d.kind === "chart").length} / ${dv.filter(d => d.kind === "unsupported").length}` },
      ],
    },
  ];
}


