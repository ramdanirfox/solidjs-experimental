/** PptxView: pptx-view-slide.ts — fungsi bagian dari kelas (`this: PptxView`), dipasang di kelas sebagai properti agar API publik tidak berubah. */
import type { PptxView } from "./pptx-view";
import * as P from "@office-kit/pptx";
import type { SlideShapeData, PresetShape } from "@office-kit/pptx";
import { PX, topShapes } from "./pptx-render";
import type { PptxFormatTarget } from "./pptx-view-shared";

export function duplicateSlide(this: PptxView) { if (this.readonly || !this.slide) return; P.duplicateSlideAt(this.deck!.pres, this.slideIdx + 1, this.slide); this.changed("hist.slide"); this.slideIdx += 1; this.hooks.slide(this.slideIdx); this.render(false); this.hooks.thumbs("all"); }

export function deleteSlide(this: PptxView) { if (this.readonly || !this.slide || this.slides.length < 2) return; P.removeSlide(this.deck!.pres, this.slide); this.changed("hist.slide"); this.slideIdx = Math.min(this.slideIdx, this.slides.length - 1); this.hooks.slide(this.slideIdx); this.render(false); this.hooks.thumbs("all"); }

export function moveSlide(this: PptxView, from: number, to: number) { if (this.readonly || from === to || !this.deck) return; const s = this.slides[from]; if (!s) return; P.moveSlide(this.deck.pres, s, to); this.changed("hist.slide"); this.slideIdx = to; this.hooks.slide(to); this.render(false); this.hooks.thumbs("all"); }

// ── struktur via bus (`slide.*`, `shape.*`) ──
export function slideSummaries(this: PptxView): { index: number; title: string; layout: string | null; hidden: boolean; shapes: number; notes: boolean }[] {
  return this.slides.map((s, index) => {
    const l = P.getSlideLayout(s);
    let title = ""; try { title = P.getSlideTitle(s) ?? ""; } catch { /* abaikan */ }
    return { index, title, layout: l ? P.getSlideLayoutName(l) : null, hidden: P.isSlideHidden(s), shapes: P.getSlideShapes(s).length, notes: !!(P.getSlideNotes(s) ?? "") };
  });
}

export function layoutNames(this: PptxView): string[] { return this.deck ? P.getSlideLayouts(this.deck.pres).map(l => P.getSlideLayoutName(l)) : []; }

/** Pindah ke slide `i` (default: slide aktif); false bila di luar jangkauan. */
export function slideAt(this: PptxView, i?: number): boolean {
  if (!this.deck || this.readonly) return false;
  if (i === undefined) return !!this.slide;
  if (!Number.isInteger(i) || i < 0 || i >= this.slides.length) return false;
  if (i !== this.slideIdx) this.goTo(i);
  return true;
}

export function slideDuplicate(this: PptxView, i?: number): boolean { if (!this.slideAt(i)) return false; this.duplicateSlide(); return true; }

export function slideRemove(this: PptxView, i?: number): boolean { if (!this.slideAt(i) || this.slides.length < 2) return false; this.deleteSlide(); return true; }

export function slideMove(this: PptxView, from: number, to: number): boolean {
  const n = this.slides.length;
  if (!this.deck || this.readonly || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= n || to >= n || from === to) return false;
  this.moveSlide(from, to); return true;
}

export function slideSetBackground(this: PptxView, color: string | null, i?: number): boolean { if (!this.slideAt(i)) return false; this.setBackground(color); return true; }

export function slideSetNotes(this: PptxView, text: string, i?: number): boolean { if (!this.slideAt(i)) return false; this.setNotes(text); return true; }

export function slideSetHidden(this: PptxView, h: boolean, i?: number): boolean { if (!this.slideAt(i)) return false; this.hideSlide(h); return true; }

export function slideSetLayout(this: PptxView, name: string, i?: number): boolean {
  if (!this.slideAt(i) || !this.deck) return false;
  const l = P.getSlideLayouts(this.deck.pres).find(x => P.getSlideLayoutName(x) === name);
  if (!l) return false;
  P.setSlideLayout(this.slide!, l); this.changed("hist.slide"); this.render(false); this.hooks.thumbs("all"); return true;
}

export function shapeSummaries(this: PptxView, slide?: number): { id: number; name: string; kind: string; text: string; x: number; y: number; w: number; h: number; hidden: boolean }[] {
  const s = this.slides[slide ?? this.slideIdx];
  if (!s || !this.deck) return [];
  return topShapes(s).map(sh => { const b = this.boundsOf(sh); return { id: P.getShapeId(sh), name: P.getShapeName(sh), kind: P.getShapeKind(sh), text: P.getShapeKind(sh) === "shape" ? P.getShapeText(sh) : "", x: Math.round(b.x / PX), y: Math.round(b.y / PX), w: Math.round(b.w / PX), h: Math.round(b.h / PX), hidden: P.isShapeHidden(sh) }; });
}

/** Tambah bentuk lewat bus. Posisi/ukuran dalam px slide. Mengembalikan id bentuk baru. */
export function shapeAdd(this: PptxView, spec: { type: "textbox" | "shape" | "line" | "table" | "chart"; slide?: number; x?: number; y?: number; w?: number; h?: number; text?: string; preset?: PresetShape; rows?: number; cols?: number; chart?: P.ChartKind; arrow?: boolean; fill?: string; fontSize?: number }): number | undefined {
  if (!this.slideAt(spec.slide)) return undefined;
  const slide = this.slide!, px = (v: number) => Math.round(v * PX) as P.Emu;
  const x = spec.x ?? 100, y = spec.y ?? 100;
  let shape: SlideShapeData | undefined;
  if (spec.type === "table") { const before = new Set(topShapes(slide)); this.insertTable(Math.max(1, spec.rows ?? 3), Math.max(1, spec.cols ?? 3)); shape = topShapes(this.slide!).find(s => !before.has(s)); return shape ? P.getShapeId(shape) : undefined; }
  if (spec.type === "chart") { const before = new Set(topShapes(slide)); this.insertChart(spec.chart ?? "bar"); shape = topShapes(this.slide!).find(s => !before.has(s)); return shape ? P.getShapeId(shape) : undefined; }
  if (spec.type === "line") {
    shape = P.addSlideLine(slide, { from: { x: px(x), y: px(y) }, to: { x: px(x + (spec.w ?? 200)), y: px(y + (spec.h ?? 0)) }, color: "#1F2937", widthEmu: 28575 });
    if (spec.arrow) P.setShapeStrokeArrow(shape, "tail", { type: "triangle" });
  } else if (spec.type === "textbox") {
    shape = P.addSlideTextBox(slide, { x: px(x), y: px(y), w: px(spec.w ?? 360), h: px(spec.h ?? 60), text: spec.text ?? "" });
    P.setShapeTextFormat(shape, { size: spec.fontSize ?? 24 });
  } else {
    shape = P.addSlideShape(slide, { preset: spec.preset ?? "rect", x: px(x), y: px(y), w: px(spec.w ?? 220), h: px(spec.h ?? 140), text: spec.text ?? "" });
    P.setShapeFill(shape, (spec.fill ?? this.ctx.theme?.accent1 ?? "#4F81BD") as P.Color);
    P.setShapeStroke(shape, { color: "#FFFFFF", widthEmu: 12700 });
  }
  this.changed("hist.insert"); this.render(false);
  this.sel = [shape]; this.updateOverlay(); this.emit(); this.hooks.thumbs([this.slideIdx]);
  return P.getShapeId(shape);
}

export function shapesFor(this: PptxView, t?: PptxFormatTarget): SlideShapeData[] | undefined {
  if (this.readonly || !this.deck) return undefined;
  const list = this.resolveFormatShapes(t).filter(s => this.ctx.domOf.has(s));
  if (!list.length) return undefined;
  this.select(list);
  return list;
}

export function shapeRemove(this: PptxView, t?: PptxFormatTarget): number { const l = this.shapesFor(t); if (!l) return 0; this.deleteSelected(); return l.length; }

export function shapeDuplicate(this: PptxView, t?: PptxFormatTarget): number { const l = this.shapesFor(t); if (!l) return 0; this.duplicateSelected(); return l.length; }

export function shapeAlign(this: PptxView, mode: Parameters<PptxView["alignShapes"]>[0], t?: PptxFormatTarget): boolean { if (!this.shapesFor(t)) return false; this.alignShapes(mode); return true; }

export function shapeOrder(this: PptxView, op: "front" | "back" | "forward" | "backward", t?: PptxFormatTarget): boolean { if (!this.shapesFor(t)) return false; this.zOrder(op); return true; }

export function shapeGroup(this: PptxView, t?: PptxFormatTarget): boolean { const l = this.shapesFor(t); if (!l || l.length < 2) return false; this.group(); return true; }

export function shapeUngroup(this: PptxView, t?: PptxFormatTarget): boolean { if (!this.shapesFor(t)) return false; this.ungroup(); return true; }

export function hideSlide(this: PptxView, h: boolean) { if (this.readonly || !this.slide) return; P.setSlideHidden(this.slide, h); this.changed("hist.slide"); this.emit(); this.hooks.thumbs([this.slideIdx]); }

export function changeLayout(this: PptxView, name: string) { if (this.readonly || !this.slide) return; const l = P.findSlideLayout(this.deck!.pres, name); if (!l) return; P.setSlideLayout(this.slide, l); this.changed("hist.layout"); this.render(false); this.hooks.thumbs([this.slideIdx]); }

export function setBackground(this: PptxView, color: string | null) { if (this.readonly || !this.slide) return; if (color) P.setSlideBackground(this.slide, color as P.Color); else P.clearSlideBackground(this.slide); this.changed("hist.background"); this.render(); this.hooks.thumbs([this.slideIdx]); }

export async function setBackgroundImage(this: PptxView, f: File) { if (this.readonly || !this.slide) return; P.setSlideBackgroundImage(this.slide, new Uint8Array(await f.arrayBuffer())); this.changed("hist.background"); this.render(); this.hooks.thumbs([this.slideIdx]); }

export function setNotes(this: PptxView, text: string) { if (this.readonly || !this.slide) return; P.setSlideNotes(this.slide, text); this.changed("hist.notes", "hist.notes"); }

export function setTransition(this: PptxView, o: P.TransitionOptions | null) { if (this.readonly || !this.slide) return; if (o) P.setSlideTransition(this.slide, o); else P.clearSlideTransition(this.slide); this.changed("hist.transition"); this.emit(); }

export function applyTransitionAll(this: PptxView) { if (this.readonly || !this.slide) return; const t = P.getSlideTransition(this.slide); for (const s of this.slides) { if (t) P.setSlideTransition(s, t as P.TransitionOptions); else P.clearSlideTransition(s); } this.changed("hist.transition"); }

export async function insertImage(this: PptxView, f: File, at?: { x: number; y: number }): Promise<boolean> {
  if (this.readonly || !this.slide) return false;
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    let nat = { w: 400, h: 300 };
    try { const bmp = await createImageBitmap(f); nat = { w: bmp.width, h: bmp.height }; bmp.close(); } catch { /* svg dll. */ }
    const size = P.getSlideSize(this.deck!.pres)!;
    const maxW = size.width * 0.6, maxH = size.height * 0.7;
    const k = Math.min(1, maxW / (nat.w * PX * 0.75), maxH / (nat.h * PX * 0.75));
    const w = Math.round(nat.w * PX * 0.75 * k), h = Math.round(nat.h * PX * 0.75 * k);
    const x = at ? Math.round(at.x * PX - w / 2) : Math.round((size.width - w) / 2), y = at ? Math.round(at.y * PX - h / 2) : Math.round((size.height - h) / 2);
    const s = P.addSlideImage(this.slide, bytes, { x: Math.max(0, x) as P.Emu, y: Math.max(0, y) as P.Emu, w: w as P.Emu, h: h as P.Emu, name: f.name.replace(/\.[^.]+$/, "") });
    this.changed("hist.insert"); this.render(false); this.sel = [s]; this.updateOverlay(); this.emit(); this.hooks.thumbs([this.slideIdx]);
    return true;
  } catch (e) { this.hooks.log("error", "log.imgInsertFail", { msg: e instanceof Error ? e.message : String(e) }); this.hooks.toast("toast.imgFail", { name: f.name }); return false; }
}
