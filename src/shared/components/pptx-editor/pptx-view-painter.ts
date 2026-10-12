/** PptxView: pptx-view-painter.ts — fungsi bagian dari kelas (`this: PptxView`), dipasang di kelas sebagai properti agar API publik tidak berubah. */
import type { PptxView } from "./pptx-view";
import * as P from "@office-kit/pptx";
import type { SlideShapeData, TextFormat } from "@office-kit/pptx";

export function cancelPainter(this: PptxView) { this.painterClip = null; this.host.classList.remove("px-painter"); this.hooks.painter(null); }

export function applyPainter(this: PptxView, target: SlideShapeData) {
  const c = this.painterClip;
  if (!c) return;
  try {
    if (c.fill) P.setShapeFill(target, c.fill as P.Color); else if (P.getShapeKind(target) === "shape") P.setShapeNoFill(target);
    if (c.stroke) P.setShapeStroke(target, { color: c.stroke as P.Color, widthEmu: c.strokeW ?? 12700 }); else P.setShapeNoStroke(target);
    if (c.fmt && P.getShapeKind(target) === "shape") {
      const f: TextFormat = { font: c.fmt.font, size: c.fmt.size, bold: !!c.fmt.bold, italic: !!c.fmt.italic, underline: !!c.fmt.underline, color: (c.fmt.color ?? undefined) as P.Color | undefined };
      P.setShapeTextFormat(target, f);
      if (c.align) P.setShapeAlignment(target, (c.align === "ctr" ? "center" : c.align === "r" ? "right" : c.align === "l" ? "left" : c.align) as P.ParagraphAlignment);
    }
  } catch (e) { this.hooks.log("error", "log.opFail", { op: "painter", msg: e instanceof Error ? e.message : String(e) }); }
  this.cancelPainter();
  this.changed("hist.painter"); this.rerenderShape(target); this.select([target]); this.hooks.thumbs([this.slideIdx]);
}
