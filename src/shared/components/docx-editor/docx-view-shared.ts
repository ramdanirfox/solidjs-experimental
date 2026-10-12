/** Konstanta, tipe, dan util kecil bersama untuk docx-view dan modul pecahannya (docx-view-*.ts). */
import { mk, serialize, type XEl } from "./docx-xml";
import { walkBlocks, type DocxBook } from "./docx-model";
import { insertRunAt } from "./docx-text";
import type { Point } from "./docx-view";

export interface Sel2 { a: Point; b: Point }

export const searchOpts = (s: { query: string; regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean }) => ({ query: s.query, regex: !!s.regex, caseSensitive: !!s.caseSensitive, wholeWord: !!s.wholeWord });

export const PX_PER_TWIP = 96 / 1440;

export const MAX_IMG_W = 6.5 * 96;

// ───────── util ─────────

export function serializeShort(el: XEl, max = 1200): string { const s = serialize(el); return s.length > max ? s.slice(0, max) + `… (+${s.length - max})` : s; }

export function ps0(tc: XEl, book: DocxBook): XEl | undefined { let r: XEl | undefined; walkBlocks(tc, el => { if (!r && el.name.local === "p") r = el; }); void book; return r; }

export function insertTextRunDrawing(p: XEl, off: number, drawing: XEl) {
  insertRunAt(p, off, mk("r", undefined, [mk("rPr", undefined, [mk("noProof")]), drawing]));
}

export async function decodeImageSize(file: Blob): Promise<{ w: number; h: number; type: string } | undefined> {
  try {
    const bmp = await createImageBitmap(file);
    const r = { w: bmp.width, h: bmp.height, type: file.type };
    bmp.close();
    return r;
  } catch { return undefined; }
}

/** Target `goto` untuk editor DOCX. Nomor paragraf/tabel/halaman berbasis 1; indeks judul/daftar isi berbasis 0. */
/** Target `format.apply` DOCX: seleksi saat ini, seluruh dokumen, rentang paragraf, bagian tabel, atau target navigasi apa pun (cari, judul, penanda, …). */
export type DocxFormatTarget =
  | { kind: "selection" }
  | { kind: "all" }
  | { kind: "paragraph"; index: number; to?: number; start?: number; end?: number }
  | { kind: "table"; index: number; row?: number; col?: number; toRow?: number; toCol?: number }
  | Exclude<DocxNavTarget, { kind: "paragraph" } | { kind: "table" } | { kind: "start" } | { kind: "end" } | { kind: "page" } | { kind: "toc" }>;

export const DOCX_FORMAT_KEYS = [
  "bold", "italic", "underline", "strike", "fontFamily", "fontSize", "color", "colorAlpha", "fill", "fillAlpha", "stroke", "align", "valign", "wrap", "link",
  "highlight", "superscript", "subscript", "caps", "smallCaps", "letterSpacing", "style", "lineSpacing", "spaceBefore", "spaceAfter", "indentLeft", "indentRight", "indentFirst", "keepNext", "pageBreakBefore",
] as const;

export const DOCX_TABLE_OPS = [
  "insertRowAbove", "insertRowBelow", "insertColLeft", "insertColRight", "deleteRows", "deleteCols", "deleteTable", "merge", "split", "shade", "valign", "noWrap", "direction", "cellMargins",
  "borders", "align", "style", "look", "layout", "width", "rowHeight", "headerRow", "distCols", "caption",
] as const;

export type DocxNavTarget =
  | { kind: "page"; page: number }
  | { kind: "paragraph"; index: number; start?: number; end?: number }
  | { kind: "heading"; index?: number; text?: string }
  | { kind: "bookmark"; name: string }
  | { kind: "table"; index: number; row?: number; col?: number }
  | { kind: "toc"; index?: number }
  | { kind: "link"; id: string }
  | { kind: "search"; query: string; regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean; occurrence?: number }
  | { kind: "match"; index: number }
  | { kind: "start" }
  | { kind: "end" };
