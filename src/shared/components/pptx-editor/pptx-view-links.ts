/** PptxView: pptx-view-links.ts — fungsi bagian dari kelas (`this: PptxView`), dipasang di kelas sebagai properti agar API publik tidak berubah. */
import type { PptxView } from "./pptx-view";
import * as P from "@office-kit/pptx";
import type { SlideShapeData } from "@office-kit/pptx";
import { PX, topShapes } from "./pptx-render";
import { setFillAlpha } from "./pptx-alpha";
import { collectUnits, type PptxUnit } from "./pptx-nav";
import { elementToPng, loadImageBytes, planDom, type DomImportOptions, type DomImportResult } from "./pptx-dom-import";

export function linkUnit(this: PptxView, id: string): PptxUnit | undefined {
  const units = collectUnits(this.slides, ["link"], topShapes);
  const i = Number(id.split(":")[2]);
  const u = units[i];
  return u && id.startsWith(`${u.slide}:${u.shapeId}:`) ? u : undefined;
}

export function updateLink(this: PptxView, id: string, patch: { url?: string }): boolean {
  if (this.readonly || !patch.url) return false;
  const u = this.linkUnit(id);
  if (!u) return false;
  u.set(patch.url);
  this.changed("hist.link"); this.render(false); this.hooks.thumbs([u.slide]);
  return true;
}

export function removeLinkById(this: PptxView, id: string): boolean {
  if (this.readonly) return false;
  const u = this.linkUnit(id);
  if (!u) return false;
  u.set("");
  this.changed("hist.link"); this.render(false); this.hooks.thumbs([u.slide]);
  return true;
}

/** Ganti URL massal. Mengembalikan jumlah tautan yang berubah. */
export function replaceLinks(this: PptxView, spec: { query: string; regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean }, replacement: string): number {
  if (this.readonly) return 0;
  const r = this.replaceKinds({ ...spec, replacement, kinds: ["link"] });
  return r.byKind.link ?? 0;
}

/**
 * Impor elemen DOM (selector CSS atau Element) ke slide sebagai gambar (`image`), bentuk asli (`shapes`), atau otomatis.
 * Tanpa `x/y/w/h`, hasil dimuat ke slide dengan margin 5% dan di tengah.
 */
export async function importDom(this: PptxView, source: string | Element, o: DomImportOptions = {}): Promise<DomImportResult> {
  if (this.readonly) throw new Error("Mode baca-saja: impor DOM tidak diizinkan.");
  if (!this.deck) throw new Error("Tidak ada presentasi yang terbuka.");
  const el = typeof source === "string" ? document.querySelector(source) : source;
  if (!el) throw new Error(`Elemen tidak ditemukan: ${String(source)}`);
  this.commitEdit();
  const si = o.slide ?? this.slideIdx;
  if (si < 0 || si >= this.slides.length) throw new Error(`Slide ${si} tidak ada.`);
  if (si !== this.slideIdx) this.goTo(si);
  const slide = this.slide!;
  const size = P.getSlideSize(this.deck.pres)!;
  const SW = size.width / PX, SH = size.height / PX;
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) throw new Error("Elemen tidak terlihat (ukuran 0).");
  const bw = o.w ?? SW * 0.9, bh = o.h ?? SH * 0.9;
  const fit = o.fit !== false;
  const kx = bw / rect.width, ky = bh / rect.height;
  const k = fit ? Math.min(kx, ky) : kx;
  const w = rect.width * k, h = fit ? rect.height * k : rect.height * ky;
  const x = o.x ?? (SW - w) / 2, y = o.y ?? (SH - h) / 2;
  const emu = (v: number) => Math.round(v * PX) as P.Emu;
  const maxShapes = o.maxShapes ?? 250;
  let mode: "image" | "shapes";
  const plan = o.mode === "image" ? null : planDom(el, maxShapes);
  if (o.mode === "image") mode = "image";
  else if (o.mode === "shapes") mode = "shapes";
  else mode = plan && !plan.complex && plan.items.length > 0 && plan.items.length <= maxShapes ? "shapes" : "image";
  const added: SlideShapeData[] = [];
  const sel = typeof source === "string" ? source : undefined;
  if (mode === "image") {
    const png = await elementToPng(el, { pixelRatio: o.pixelRatio, background: o.background });
    added.push(P.addSlideImage(slide, png.bytes, { x: emu(x), y: emu(y), w: emu(w), h: emu(h), name: o.name ?? (sel ? `DOM ${sel}` : "DOM") }));
  } else {
    for (const it of plan!.items) {
      const ix = x + it.x * k, iy = y + it.y * (fit ? k : ky), iw = Math.max(1, it.w * k), ih = Math.max(1, it.h * (fit ? k : ky));
      try {
        if (it.type === "rect") {
          const s = P.addSlideShape(slide, { preset: it.round ? "roundRect" : "rect", x: emu(ix), y: emu(iy), w: emu(iw), h: emu(ih) });
          if (it.fill) { P.setShapeFill(s, it.fill as P.Color); if (it.fillAlpha < 1) setFillAlpha(s, it.fillAlpha); } else P.setShapeNoFill(s);
          if (it.stroke) P.setShapeStroke(s, { color: it.stroke as P.Color, widthEmu: Math.max(3175, Math.round(it.strokeW * k * PX)) }); else P.setShapeNoStroke(s);
          added.push(s);
        } else if (it.type === "text") {
          const s = P.addSlideTextBox(slide, { x: emu(ix), y: emu(iy), w: emu(iw), h: emu(ih), text: it.text });
          added.push(s);
          P.setShapeTextFormat(s, { size: Math.max(6, Math.round(it.sizePt * k * 2) / 2), bold: it.bold, italic: it.italic, underline: it.underline, color: it.color as P.Color, ...(it.font ? { font: it.font } : {}) });
          P.setShapeAlignment(s, it.align);
        } else if (it.type === "image") {
          const bytes = await loadImageBytes(it.src, it.svg, iw, ih);
          if (bytes) added.push(P.addSlideImage(slide, bytes, { x: emu(ix), y: emu(iy), w: emu(iw), h: emu(ih), name: "DOM image" }));
        } else if (it.type === "table") {
          const cols = Math.max(...it.rows.map(r => r.length), 1);
          const rows = it.rows.map(r => Array.from({ length: cols }, (_, c) => r[c] ?? ""));
          added.push(P.addSlideTable(slide, { x: emu(ix), y: emu(iy), w: emu(iw), h: emu(ih), rows, firstRow: true, bandRow: true }));
        }
      } catch (e) { this.hooks.log("error", "log.opFail", { op: "import-dom", msg: e instanceof Error ? e.message : String(e) }); }
    }
    if (!added.length) throw new Error("Tidak ada konten yang dapat diimpor dari elemen ini.");
  }
  const ids = added.map(s => P.getShapeId(s));
  let result: SlideShapeData[] = added;
  if (mode === "shapes" && added.length > 1 && o.group !== false) { try { result = [P.groupShapes(added)]; } catch { /* biarkan tanpa grup */ } }
  this.changed("hist.import"); this.render(false);
  this.sel = result.filter(s => this.ctx.domOf.has(s)); this.updateOverlay(); this.emit(); this.hooks.thumbs([this.slideIdx]);
  return { mode, added: added.length, slide: this.slideIdx, selector: sel, ids };
}
