/**
 * XlsxBook: fasad non-reaktif di atas @office-kit/xlsx. Menggabungkan workbook, evaluator formula,
 * resolver style, conditional formatting, gambar, filter, pencarian, undo, export, dan laporan log.
 * Reaktivitas dikelola komponen (signal "version").
 */
import { loadWorkbook, workbookToBytes, fromArrayBuffer } from "@office-kit/xlsx/io";
import { setFullCalcOnLoad, type Workbook, type SheetRef } from "@office-kit/xlsx/workbook";
import { ensureCell, getFreezePanes, getCellExtent, countCellsByKind, type Worksheet } from "@office-kit/xlsx/worksheet";
import { setCellValue, makeFormula, type Cell, type CellValue } from "@office-kit/xlsx/cell";
import { getCellAlignment, getCellBorder, getCellDisplayText, getCellNumberFormat, setBold, setCellAlignment, setCellBackgroundColor, setCellBorder, setCellNumberFormat, setFontColor, setFontName, setFontSize, setItalic, setStrikethrough, setUnderline, clearCellBackground, clearCellStyle } from "@office-kit/xlsx/styles";
import { OpenXmlError, OpenXmlUnsupportedFormatError, rangeBoundaries, columnIndexFromLetter, tupleToCoordinate } from "@office-kit/xlsx/utils";
import { Evaluator, isErr, toCellValue, type Scalar } from "./xlsx-formula";
import { StyleResolver, type ResolvedStyle } from "./xlsx-style";
import { CfEngine } from "./xlsx-cf";
import { anchorCell } from "./xlsx-layout";
import { repairPackage } from "./xlsx-repair";
import { OleStore, applyOlePatches } from "./xlsx-ole";
import { type ShapeGroup } from "./xlsx-shapes";
import { parseVbaProject, type VbaProject } from "./xlsx-vba";
import * as xlsx_model_oleMod from "./xlsx-model-ole";
import * as xlsx_model_styleMod from "./xlsx-model-style";
import * as xlsx_model_sheetsMod from "./xlsx-model-sheets";
import * as xlsx_model_linksMod from "./xlsx-model-links";
import * as xlsx_model_mergeMod from "./xlsx-model-merge";
import * as xlsx_model_drawingsMod from "./xlsx-model-drawings";
import * as xlsx_model_filterMod from "./xlsx-model-filter";
import * as xlsx_model_csvMod from "./xlsx-model-csv";
import * as xlsx_model_searchMod from "./xlsx-model-search";

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
  kind: "picture" | "chart" | "shape" | "unsupported" | "ole";
  /** Model render shape (kind "shape"). */
  shape?: ShapeGroup;
  /** Id objek OLE (kind "ole"). */
  oleId?: string;
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





export interface FilterState {
  range: { minRow: number; minCol: number; maxRow: number; maxCol: number };
  selected: Map<number, Set<string>>; // kolom absolut -> nilai yang ditampilkan ("" = kosong)
  hiddenRows: Set<number>;
  /** Baris yang disembunyikan oleh filter kita pada ekspor sebelumnya (agar bisa dibuka lagi). */
  written: Set<number>;
  touched: boolean;
}

export const BLANK_LABEL = "(Kosong)";


export function addr(row: number, col: number, abs = false): string {
  return tupleToCoordinate(col, row, abs ? { absoluteCol: true, absoluteRow: true } : undefined);
}
export function selAddr(s: Sel): string {
  const a = addr(Math.min(s.r1, s.r2), Math.min(s.c1, s.c2));
  const b = addr(Math.max(s.r1, s.r2), Math.max(s.c1, s.c2));
  return a === b ? a : `${a}:${b}`;
}
export const normSel = (s: Sel): Sel => ({ r1: Math.min(s.r1, s.r2), c1: Math.min(s.c1, s.c2), r2: Math.max(s.r1, s.r2), c2: Math.max(s.c1, s.c2) });

/** Nama sheet untuk dipakai dalam rumus: diberi apostrof bila perlu. */
export const quoteSheetName = (n: string) => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(n) && !/^[A-Za-z]{1,3}\d+$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`);

/** Ganti referensi `Lama!` / `'Lama'!` menjadi nama baru pada teks rumus (literal string "..." dibiarkan). */
export function rewriteSheetRefs(formula: string, oldT: string, newT: string): string {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^A-Za-z0-9_.'])${esc(oldT)}!|'${esc(oldT.replace(/'/g, "''"))}'!`, "g");
  return formula.split(/("(?:[^"]|"")*")/).map((part, i) => (i % 2 ? part : part.replace(re, (m, pre) => (m.startsWith("'") ? "" : pre ?? "") + quoteSheetName(newT) + "!"))).join("");
}

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
  filters = new Map<Worksheet, FilterState | null>();
  drawings = new WeakMap<Worksheet, DrawingView[]>();
  urls: string[] = [];
  imageUrls = new WeakMap<Uint8Array, string>();
  undoStack: EditRecord[][] = [];
  redoStack: EditRecord[][] = [];

  constructor(public wb: Workbook, public fileName: string, public byteSize: number) {
    this.ev = new Evaluator(wb);
    this.styles = new StyleResolver(wb);
    this.cf = new CfEngine({ wb, ev: this.ev, styles: this.styles, textAt: (ws, r, c) => this.textAt(ws, r, c) });
    this.ev.onUnsupported = fn => this.log(logEntry("warn", "Formula", `Fungsi ${fn}() belum didukung mesin evaluasi; nilai cache dari file dipakai bila ada, selain itu #NAME?`));
    this.cf.onUnsupported = t => this.log(logEntry("warn", "Conditional formatting", `Aturan tipe "${t}" belum dirender`));
  }

  private vbaCache?: { project?: VbaProject; error?: string };
  /** Isi proyek VBA (read-only, tanpa eksekusi); di-cache. */
  vba(): { project?: VbaProject; error?: string } | undefined {
    const bin = this.wb.vbaProject;
    if (!bin) return undefined;
    if (!this.vbaCache) {
      try { this.vbaCache = { project: parseVbaProject(bin) }; }
      catch (e) { this.vbaCache = { error: (e as Error).message }; }
    }
    return this.vbaCache;
  }

  get isMacro(): boolean { return !!this.wb.vbaProject || /\.(xlsm|xltm)$/i.test(this.fileName); }

  dispose() { for (const u of this.urls) URL.revokeObjectURL(u); this.urls = []; }

  // ───── objek OLE ─────
  /** Objek OLE: yang ada di berkas (dipindai saat dibuka), sisipan baru, dan perbaruan — ditulis ke paket saat `toBytes()`. */
  ole = new OleStore();
  scanOle = xlsx_model_oleMod.scanOle;
  oleList = xlsx_model_oleMod.oleList;
  wsByTitle = xlsx_model_oleMod.wsByTitle;
  insertOle = xlsx_model_oleMod.insertOle;
  oleBytes = xlsx_model_oleMod.oleBytes;
  moveOle = xlsx_model_oleMod.moveOle;
  updateOle = xlsx_model_oleMod.updateOle;

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
  snap(cell: Cell | undefined): CellSnap | null {
    return cell ? { value: cell.value, styleId: cell.styleId } : null;
  }

  writeSnap(ws: Worksheet, r: number, c: number, s: CellSnap | null) {
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

  applyStyleId = xlsx_model_styleMod.applyStyleId;

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  undo = xlsx_model_styleMod.undo;
  redo = xlsx_model_styleMod.redo;

  step = xlsx_model_styleMod.step;

  // ───── struktur sheet (dengan undo) ─────
  nameScopes = xlsx_model_styleMod.nameScopes;
  restoreNames = xlsx_model_sheetsMod.restoreNames;
  shiftNames = xlsx_model_sheetsMod.shiftNames;
  sheetRec = xlsx_model_sheetsMod.sheetRec;
  validTitle = xlsx_model_sheetsMod.validTitle;
  addSheet = xlsx_model_sheetsMod.addSheet;
  renameSheetTo = xlsx_model_sheetsMod.renameSheetTo;
  removeSheetByTitle = xlsx_model_sheetsMod.removeSheetByTitle;
  moveSheetTo = xlsx_model_sheetsMod.moveSheetTo;
  setSheetVisible = xlsx_model_sheetsMod.setSheetVisible;

  findSheet = xlsx_model_sheetsMod.findSheet;

  resizeColumn = xlsx_model_sheetsMod.resizeColumn;
  resizeRow = xlsx_model_sheetsMod.resizeRow;

  freeze = xlsx_model_sheetsMod.freeze;

  // ───── gambar ─────
  drawingsOf = xlsx_model_sheetsMod.drawingsOf;

  // ───── hyperlink & komentar ─────
  linkMaps = new WeakMap<Worksheet, { links: Map<number, any>; notes: Map<number, any> }>();
  maps = xlsx_model_linksMod.maps;
  invalidateLinks = xlsx_model_linksMod.invalidateLinks;
  hyperlinkAt = xlsx_model_linksMod.hyperlinkAt;
  commentAt = xlsx_model_linksMod.commentAt;

  // ───── merge ─────
  mergeMaps = new WeakMap<Worksheet, { anchors: Map<number, any>; covered: Map<number, any>; list: any[] }>();
  mergeIndex = xlsx_model_mergeMod.mergeIndex;

  invalidateMerges = xlsx_model_mergeMod.invalidateMerges;
  invalidateDrawings = xlsx_model_mergeMod.invalidateDrawings;

  mergeAt = xlsx_model_mergeMod.mergeAt;

  expandSel = xlsx_model_mergeMod.expandSel;

  rangeStr = xlsx_model_mergeMod.rangeStr;

  mergeSelection = xlsx_model_mergeMod.mergeSelection;

  unmergeSelection = xlsx_model_mergeMod.unmergeSelection;

  // ───── gambar mengambang: pindah / ubah ukuran / hapus / sisip ─────
  moveDrawing = xlsx_model_mergeMod.moveDrawing;

  deleteDrawing = xlsx_model_drawingsMod.deleteDrawing;

  insertImage = xlsx_model_drawingsMod.insertImage;

  // ───── autofilter ─────
  filterOf = xlsx_model_drawingsMod.filterOf;

  enableFilter = xlsx_model_filterMod.enableFilter;

  disableFilter = xlsx_model_filterMod.disableFilter;

  recomputeFilter = xlsx_model_filterMod.recomputeFilter;

  setFilterColumn = xlsx_model_filterMod.setFilterColumn;

  uniqueValues = xlsx_model_filterMod.uniqueValues;

  private flushFilters = xlsx_model_filterMod.flushFilters;

  // ───── simpan ─────
  refreshFormulaCaches = xlsx_model_filterMod.refreshFormulaCaches;

  async toBytes(): Promise<Uint8Array> {
    this.flushFilters();
    if (this.dirty) {
      this.refreshFormulaCaches();
      try { setFullCalcOnLoad(this.wb, true); } catch { /* abaikan */ }
    }
    const raw = await workbookToBytes(this.wb);
    // Library menulis beberapa elemen di luar urutan skema & mempertahankan calcChain usang → Excel meminta "recover".
    const fixed = await repairPackage(raw);
    let finalBytes = fixed.bytes;
    if (this.ole.hasChanges) {
      finalBytes = await applyOlePatches(fixed.bytes, this.ole.patches());
      this.log(logEntry("info", "Simpan", `Objek OLE ditulis ke paket: ${this.ole.inserts.length} baru, ${this.ole.updates.size} diperbarui`));
    }
    if (fixed.report.changed) {
      const parts = [
        ...fixed.report.reordered.map(r => `${r.part.replace(/^xl\//, "")}: ${r.moved.join(", ")}`),
        ...fixed.report.removed.map(r => `${r} dibuang (dibangun ulang Excel)`),
        ...fixed.report.fixedXml.map(r => `${r.part.replace(/^xl\//, "")}: ${r.detail}`),
      ];
      this.log(logEntry("info", "Simpan", `Paket disesuaikan agar dapat dibuka Excel tanpa recover (${parts.length} perbaikan)`, parts.join(String.fromCharCode(10))));
    }
    return finalBytes;
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

  toTsv = xlsx_model_csvMod.toTsv;

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
  search = xlsx_model_csvMod.search;

  searchAsync = xlsx_model_searchMod.searchAsync;

  searchGen = xlsx_model_searchMod.searchGen;
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
    await book.scanOle();
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
    const v = book.vba();
    if (v?.error) L("error", "Makro (VBA)", `vbaProject.bin ada (${formatBytes(wb.vbaProject.length)}) tetapi kodenya tidak dapat dibaca: ${v.error}. Biner tetap dipertahankan saat disimpan.`);
    else L("warn", "Makro (VBA)", `VBA project ditemukan (${formatBytes(wb.vbaProject.length)}${wb.vbaSignature ? ", bertanda tangan digital" : ""}). Makro TIDAK dieksekusi; kodenya dapat dilihat (read-only) pada panel Makro. Biner dipertahankan apa adanya saat disimpan sebagai .xlsm.`);
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
    const drawn = dv.filter(d => d.kind === "shape");
    if (drawn.length) {
      const n = drawn.reduce((a, d) => a + d.shape!.shapes.length, 0);
      const approx = drawn.filter(d => d.shape!.approx);
      L(approx.length ? "info" : "ok", `Sheet «${w.title}»`, `${n} shape/textbox dirender (SVG)${approx.length ? `; ${approx.length} memakai geometri kustom/tak dikenal yang disederhanakan` : ""}`);
    }
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
        { label: "Gambar / Grafik / Shape / Lainnya", value: `${dv.filter(d => d.kind === "picture").length} / ${dv.filter(d => d.kind === "chart").length} / ${dv.filter(d => d.kind === "shape").length} / ${dv.filter(d => d.kind === "unsupported").length}` },
      ],
    },
  ];
}


