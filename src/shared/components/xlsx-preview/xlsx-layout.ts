/**
 * Perhitungan geometri worksheet: lebar kolom, tinggi baris, hidden, freeze panes, posisi gambar.
 * Semua ukuran dalam piksel layar (sudah dikalikan zoom).
 */
import type { Worksheet } from "@office-kit/xlsx/worksheet";
import { getCellExtent } from "@office-kit/xlsx/worksheet";

export const HEADER_W = 48;
export const HEADER_H = 24;
export const DEFAULT_COL_PX = 64;
export const DEFAULT_ROW_PX = 20;
export const MAX_ROWS = 1048576;
export const MAX_COLS = 16384;
const EMU_PER_PX = 9525;

export interface Layout {
  zoom: number;
  maxRow: number;
  maxCol: number;
  /** colStart[c] = x awal kolom c (1-based). Panjang maxCol + 2. */
  colStart: Float64Array;
  rowStart: Float64Array;
  hiddenCols: Set<number>;
  hiddenRows: Set<number>;
  /** Jumlah baris/kolom yang dibekukan. */
  fr: number;
  fc: number;
}

export interface LayoutOptions {
  zoom: number;
  showHidden: boolean;
  /** Baris yang disembunyikan oleh autofilter (di luar atribut hidden di file). */
  filterHidden?: Set<number>;
  /** Rentang baris data autofilter; atribut hidden pada baris di dalam rentang diabaikan bila filter aktif. */
  filterRange?: { minRow: number; maxRow: number } | undefined;
  /** Tinggi otomatis (px, sebelum zoom) untuk baris tanpa tinggi eksplisit, mis. karena font besar. */
  autoHeightPx?: (row: number) => number | undefined;
}

export function colWidthPx(chars: number): number {
  return Math.max(0, Math.round(chars * 7));
}
export function pxToColChars(px: number): number {
  return Math.max(0, px / 7);
}
export function ptToPx(pt: number): number {
  return (pt * 96) / 72;
}
export function pxToPt(px: number): number {
  return (px * 72) / 96;
}

export function getFreeze(ws: Worksheet): { rows: number; cols: number } {
  const p = ws.views?.[0]?.pane;
  if (!p || (p.state !== "frozen" && p.state !== "frozenSplit")) return { rows: 0, cols: 0 };
  return { rows: Math.max(0, Math.floor(p.ySplit ?? 0)), cols: Math.max(0, Math.floor(p.xSplit ?? 0)) };
}

export function defaultColWidthChars(ws: Worksheet): number | undefined {
  return ws.defaultColumnWidth;
}

export function baseColPx(ws: Worksheet): number {
  if (ws.defaultColumnWidth) return colWidthPx(ws.defaultColumnWidth);
  if (ws.baseColWidth) return colWidthPx(ws.baseColWidth + 5 / 7);
  return DEFAULT_COL_PX;
}
export function baseRowPx(ws: Worksheet): number {
  return ptToPx(ws.defaultRowHeight ?? 15);
}

/** Batas bawah tampilan: menampilkan sedikit area kosong di luar data seperti Excel. */
export function computeExtent(ws: Worksheet): { maxRow: number; maxCol: number } {
  const ext = getCellExtent(ws);
  let maxRow = ext?.maxRow ?? 0;
  let maxCol = ext?.maxCol ?? 0;
  for (const m of ws.mergedCells ?? []) {
    maxRow = Math.max(maxRow, (m as any).maxRow ?? 0);
    maxCol = Math.max(maxCol, (m as any).maxCol ?? 0);
  }
  for (const d of ws.columnDimensions.values()) {
    // dimensi berformat penuh (min..max=16384) tidak boleh menggelembungkan jumlah kolom
    if (d.max < 200) maxCol = Math.max(maxCol, d.max);
  }
  for (const k of ws.rowDimensions.keys()) if (k < 5000) maxRow = Math.max(maxRow, k);
  for (const it of ws.drawing?.items ?? []) {
    const a: any = it.anchor;
    if (a.kind === "oneCell") {
      maxCol = Math.max(maxCol, a.from.col + 1 + Math.ceil(a.ext.cx / EMU_PER_PX / DEFAULT_COL_PX));
      maxRow = Math.max(maxRow, a.from.row + 1 + Math.ceil(a.ext.cy / EMU_PER_PX / DEFAULT_ROW_PX));
    } else if (a.kind === "twoCell") {
      maxCol = Math.max(maxCol, a.to.col + 1);
      maxRow = Math.max(maxRow, a.to.row + 1);
    }
  }
  const f = getFreeze(ws);
  maxRow = Math.max(maxRow + 40, f.rows + 30, 100);
  maxCol = Math.max(maxCol + 6, f.cols + 10, 26);
  return { maxRow: Math.min(maxRow, MAX_ROWS), maxCol: Math.min(maxCol, MAX_COLS) };
}

export function buildLayout(ws: Worksheet, opt: LayoutOptions): Layout {
  const { maxRow, maxCol } = computeExtent(ws);
  const z = opt.zoom;
  const baseW = baseColPx(ws);
  const baseH = baseRowPx(ws);
  const widths = new Float64Array(maxCol + 2).fill(baseW);
  const hiddenCols = new Set<number>();
  for (const d of ws.columnDimensions.values()) {
    const hi = Math.min(d.max, maxCol);
    for (let c = Math.max(1, d.min); c <= hi; c++) {
      if (d.width !== undefined && d.width > 0) widths[c] = colWidthPx(d.width);
      if (d.hidden) hiddenCols.add(c);
    }
  }
  const colStart = new Float64Array(maxCol + 2);
  let x = 0;
  for (let c = 1; c <= maxCol; c++) {
    colStart[c] = x;
    const hidden = hiddenCols.has(c) && !opt.showHidden;
    x += hidden ? 0 : widths[c]! * z;
  }
  colStart[maxCol + 1] = x;

  const hiddenRows = new Set<number>();
  const rowStart = new Float64Array(maxRow + 2);
  let y = 0;
  for (let r = 1; r <= maxRow; r++) {
    rowStart[r] = y;
    const dim = ws.rowDimensions.get(r);
    const hidden = !!dim?.hidden || !!opt.filterHidden?.has(r);
    if (hidden) hiddenRows.add(r);
    let h: number;
    if (dim?.height !== undefined && dim.height > 0) h = ptToPx(dim.height);
    else { const a = opt.autoHeightPx?.(r); h = a && a > baseH ? a : baseH; }
    y += hidden && !opt.showHidden ? 0 : h * z;
  }
  rowStart[maxRow + 1] = y;

  const f = getFreeze(ws);
  return { zoom: z, maxRow, maxCol, colStart, rowStart, hiddenCols, hiddenRows, fr: Math.min(f.rows, maxRow), fc: Math.min(f.cols, maxCol) };
}

export const colW = (l: Layout, c: number) => l.colStart[c + 1]! - l.colStart[c]!;
export const rowH = (l: Layout, r: number) => l.rowStart[r + 1]! - l.rowStart[r]!;

/** Indeks terbesar i di [1,max] sehingga starts[i] <= x (pencarian biner). */
export function locate(starts: Float64Array, x: number, max: number): number {
  let lo = 1, hi = max;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= x) lo = mid; else hi = mid - 1;
  }
  return lo;
}

export interface PxRect { x: number; y: number; w: number; h: number }

/** Posisi (koordinat sheet, sudah di-zoom) sebuah anchor drawing. */
export function anchorRect(l: Layout, anchor: any): PxRect {
  const z = l.zoom;
  const colX = (col0: number, off: number) => {
    const c = col0 + 1;
    const base = c <= l.maxCol + 1 ? l.colStart[c]! : l.colStart[l.maxCol + 1]! + (c - l.maxCol - 1) * DEFAULT_COL_PX * z;
    return base + (off / EMU_PER_PX) * z;
  };
  const rowY = (row0: number, off: number) => {
    const r = row0 + 1;
    const base = r <= l.maxRow + 1 ? l.rowStart[r]! : l.rowStart[l.maxRow + 1]! + (r - l.maxRow - 1) * DEFAULT_ROW_PX * z;
    return base + (off / EMU_PER_PX) * z;
  };
  if (anchor.kind === "absolute") {
    return { x: (anchor.pos.x / EMU_PER_PX) * z, y: (anchor.pos.y / EMU_PER_PX) * z, w: (anchor.ext.cx / EMU_PER_PX) * z, h: (anchor.ext.cy / EMU_PER_PX) * z };
  }
  const x = colX(anchor.from.col, anchor.from.colOff);
  const y = rowY(anchor.from.row, anchor.from.rowOff);
  if (anchor.kind === "oneCell") {
    return { x, y, w: (anchor.ext.cx / EMU_PER_PX) * z, h: (anchor.ext.cy / EMU_PER_PX) * z };
  }
  const x2 = colX(anchor.to.col, anchor.to.colOff);
  const y2 = rowY(anchor.to.row, anchor.to.rowOff);
  return { x, y, w: Math.max(2, x2 - x), h: Math.max(2, y2 - y) };
}

/** Kolom/baris (1-based) tempat sudut kiri-atas anchor berada. */
export function anchorCell(anchor: any): { row: number; col: number } {
  if (anchor.kind === "absolute") return { row: 1, col: 1 };
  return { row: anchor.from.row + 1, col: anchor.from.col + 1 };
}

let measureCtx: CanvasRenderingContext2D | null | undefined;
export function measureTextPx(text: string, font: string): number {
  if (measureCtx === undefined) {
    try { measureCtx = document.createElement("canvas").getContext("2d"); } catch { measureCtx = null; }
  }
  if (!measureCtx) return text.length * 7;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

/** Kebalikan anchorRect: konversi rect (koordinat sheet ter-zoom) menjadi anchor OOXML, mempertahankan jenis anchor lama. */
export function rectToAnchor(l: Layout, rect: PxRect, old: any): any {
  const z = l.zoom;
  const x = Math.max(0, rect.x), y = Math.max(0, rect.y);
  const w = Math.max(4, rect.w), h = Math.max(4, rect.h);
  const marker = (px: number, py: number) => {
    const col = locate(l.colStart, px, l.maxCol), row = locate(l.rowStart, py, l.maxRow);
    return {
      col: col - 1, colOff: Math.max(0, Math.round(((px - l.colStart[col]!) / z) * EMU_PER_PX)),
      row: row - 1, rowOff: Math.max(0, Math.round(((py - l.rowStart[row]!) / z) * EMU_PER_PX)),
    };
  };
  const ext = { cx: Math.round((w / z) * EMU_PER_PX), cy: Math.round((h / z) * EMU_PER_PX) };
  if (old?.kind === "absolute") return { kind: "absolute", pos: { x: Math.round((x / z) * EMU_PER_PX), y: Math.round((y / z) * EMU_PER_PX) }, ext };
  if (old?.kind === "twoCell") return { ...old, from: marker(x, y), to: marker(x + w, y + h) };
  return { kind: "oneCell", from: marker(x, y), ext };
}
