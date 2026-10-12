/** PptxView: pptx-view-domimport.ts — fungsi bagian dari kelas (`this: PptxView`), dipasang di kelas sebagai properti agar API publik tidak berubah. */
import { type FindOpts } from "./pptx-view";
import type { PptxView } from "./pptx-view";
import * as P from "@office-kit/pptx";
import { textAlphaOf } from "./pptx-alpha";

/** Opasitas isi / garis / teks bentuk terpilih (null = opak atau tidak seragam). */
export function alphaInfo(this: PptxView): { fill: number | null; stroke: number | null; text: number | null } {
  const s = this.sel[0];
  if (!s) return { fill: null, stroke: null, text: null };
  return { fill: P.getShapeFillOpacity(s) ?? null, stroke: P.getShapeStrokeOpacity(s) ?? null, text: textAlphaOf(s) };
}

export function compile(this: PptxView, o: FindOpts): { re: RegExp | null; error?: string } {
  if (!o.query) return { re: null };
  try {
    let src = o.regex ? o.query : o.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (o.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
    return { re: new RegExp(src, "gu" + (o.caseSensitive ? "" : "i")) };
  } catch (e) { return { re: null, error: e instanceof Error ? e.message : String(e) }; }
}
