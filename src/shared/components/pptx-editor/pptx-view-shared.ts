
import * as P from "@office-kit/pptx";



/** Tipe, konstanta, dan util kecil bersama untuk pptx-view dan modul pecahannya (pptx-view-*.ts). */
/** Target `format.apply` PPTX: bentuk pada slide (default: seleksi). */
export interface PptxFormatTarget { slide?: number; id?: number; ids?: number[]; name?: string; all?: boolean }

/** Kunci `format.*` yang dipahami PPTX (umum + khusus). */
export const PPTX_FORMAT_KEYS = ["bold", "italic", "underline", "strike", "fontFamily", "fontSize", "color", "colorAlpha", "fill", "fillAlpha", "stroke", "align", "valign", "opacity", "link", "rotation", "hidden", "name", "alt", "shadow", "bounds"] as const;

/** Target `goto` untuk editor PPTX. Indeks slide berbasis 0. */
export type PptxNavTarget =
  | { kind: "slide"; index: number }
  | { kind: "first" } | { kind: "last" } | { kind: "next" } | { kind: "prev" }
  | { kind: "shape"; slide?: number; id?: number; name?: string }
  | { kind: "notes"; slide?: number }
  | { kind: "link"; id: string }
  | { kind: "search"; query: string; regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean; occurrence?: number }
  | { kind: "match"; index: number };

export const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;

export const IN = (n: number) => P.inches(n);

export type Bounds = { x: number; y: number; w: number; h: number };
