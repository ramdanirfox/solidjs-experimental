/** PptxView: pptx-view-ole.ts — fungsi bagian dari kelas (`this: PptxView`), dipasang di kelas sebagai properti agar API publik tidak berubah. */
import type { PptxView } from "./pptx-view";
import * as P from "@office-kit/pptx";
import { PX } from "./pptx-render";
import { updateOleFrame, type UpdatedOleFrame } from "./pptx-ole";
import type { PreparedOle } from "../office-shared/ole-embed";

/** Ganti isi objek OLE `shapeId` pada slide `slideIndex` (posisi & ukuran tetap). */
export async function updateOle(this: PptxView, slideIndex: number, shapeId: number, prep: PreparedOle): Promise<UpdatedOleFrame | undefined> {
  const deck = this.deck;
  if (!deck || this.readonly) return undefined;
  this.commitEdit();
  const res = await deck.mutatePackage("hist.oleUpdate", pres => updateOleFrame(pres, slideIndex, shapeId, prep));
  this.afterRestore([shapeId], slideIndex);
  this.hooks.changed("hist.oleUpdate"); // riwayat sudah dicatat oleh mutatePackage/commit
  return res;
}

/** Ubah ukuran bingkai (px slide) dan catat riwayat. */
export async function resizeOle(this: PptxView, slideIndex: number, shapeId: number, wPx: number, hPx: number): Promise<boolean> {
  const deck = this.deck;
  const slide = deck && !this.readonly ? P.getSlides(deck.pres)[slideIndex] : undefined;
  const sh = slide ? P.findShapeById(slide, shapeId) : undefined;
  if (!deck || !sh || !(wPx > 4) || !(hPx > 4)) return false;
  this.commitEdit();
  const b = P.getShapeBounds(sh);
  if (!b) return false;
  P.setShapeBounds(sh, { x: b.x, y: b.y, w: Math.round(wPx * PX) as P.Emu, h: Math.round(hPx * PX) as P.Emu });
  await deck.commit("hist.oleSize");
  this.afterRestore([shapeId], slideIndex);
  this.hooks.changed("hist.oleSize"); // riwayat sudah dicatat oleh mutatePackage/commit
  return true;
}

/** Kotak slide pada layar + ukuran slide (px dokumen) — dasar penggaris. */
export function slideBox(this: PptxView): { rect: DOMRect; width: number; height: number } | null {
  if (!this.slideEl) return null;
  return { rect: this.slideEl.getBoundingClientRect(), width: this.slideEl.offsetWidth, height: this.slideEl.offsetHeight };
}

export function setZoom(this: PptxView, z: number, fit = false) {
  this.fit = fit;
  this.zoom = Math.max(0.1, Math.min(4, z));
  this.zoomEl.style.transform = `scale(${this.zoom})`;
  this.zoomEl.style.setProperty("--z", String(this.zoom));
  const w = this.zoomEl.offsetWidth * this.zoom, h = this.zoomEl.offsetHeight * this.zoom;
  this.stage.style.width = `${Math.ceil(w + 48)}px`; this.stage.style.height = `${Math.ceil(h + 48)}px`;
  this.zoomEl.style.left = "24px"; this.zoomEl.style.top = "24px";
  this.updateOverlay();
}
