/** DocxView: docx-view-image.ts — fungsi bagian dari kelas (`this: DocxView`), dipasang di kelas sebagai properti agar API publik tidak berubah. */
import { type ImgSelInfo, type Point } from "./docx-view";
import type { DocxView } from "./docx-view";
import { cloneEl, descendAll } from "./docx-xml";
import { flatToDomPos } from "./docx-dom";
import { deleteRange, flatLength, insertRunAt, normalize, units } from "./docx-text";
import { insertImageAt } from "./docx-ops";
import { cloneDrawing, maxDocPrId, readDrawing, setAlt, setCrop, setLockAspect, setPosition, setRotation, setSize, setWrapMode, sniffImageSize, type WrapMode } from "./docx-image";
import { createOleRun, type DocxOleRef } from "./docx-ole-edit";
import type { PreparedOle } from "../office-shared/ole-embed";
import { MAX_IMG_W, decodeImageSize, insertTextRunDrawing } from "./docx-view-shared";

export function selectImageEl(this: DocxView, el: HTMLElement | undefined | null) {
  if (!el || el.classList.contains("dx-ole")) { this.clearImageSel(); return; }
  const dr = this.reg.elOf.get(el);
  if (!dr || dr.name.local !== "drawing") { this.clearImageSel(); return; }
  this.imgSel = { el, drawing: dr };
  this.lockAspect = readDrawing(dr)?.lockAspect ?? this.lockAspect;
  // pindahkan caret tepat sebelum gambar agar info paragraf/tabel di status bar mengikuti gambar (bukan seleksi lama)
  const pd = el.closest<HTMLElement>(".dx-p");
  const pp = pd ? this.reg.elOf.get(pd) : undefined;
  if (pp && this.isBodyPara(pp)) {
    const u = units(pp).find(x => x.piece === dr || descendAll(x.piece, "drawing").includes(dr));
    this.saved = { a: { p: pp, off: u?.start ?? 0 }, b: { p: pp, off: u?.start ?? 0 } };
    this.cellSel = null;
    this.applyCellSelVisual();
    const f = flatToDomPos(pd!, u?.start ?? 0);
    window.getSelection()?.setBaseAndExtent(f.node, f.offset, f.node, f.offset);
  }
  this.updateOverlay();
  this.scheduleSelection();
  el.classList.add("dx-selected");
}

export function clearImageSel(this: DocxView) { if (this.imgSel) { this.imgSel.el.classList.remove("dx-selected"); this.imgSel = null; this.updateOverlay(); this.scheduleSelection(); } }

export function updateOverlay(this: DocxView) {
  this.overlay.querySelectorAll(".dx-imgsel").forEach(e => e.remove());
  const s = this.imgSel;
  if (!s || !s.el.isConnected) return;
  const r = s.el.getBoundingClientRect(), o = this.stage.getBoundingClientRect();
  const box = document.createElement("div");
  box.className = "dx-imgsel";
  box.style.cssText = `left:${r.left - o.left}px;top:${r.top - o.top}px;width:${r.width}px;height:${r.height}px;`;
  if (!this.readonly) for (const h of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
    const hd = document.createElement("div");
    hd.className = `dx-h dx-h-${h}`; hd.dataset.h = h;
    hd.addEventListener("mousedown", ev => { ev.preventDefault(); ev.stopPropagation(); this.imgDragStart(h, ev); });
    box.appendChild(hd);
  }
  const label = document.createElement("div");
  label.className = "dx-imglabel";
  label.textContent = `${Math.round(s.el.offsetWidth)} × ${Math.round(s.el.offsetHeight)} px`;
  box.appendChild(label);
  if (s.el.dataset.wrap === "abs" && !this.readonly) {
    box.style.pointerEvents = "auto"; box.style.cursor = "move";
    box.addEventListener("mousedown", ev => { if ((ev.target as HTMLElement).classList.contains("dx-h")) return; ev.preventDefault(); this.imgDragStart("move", ev); });
  }
  this.overlay.appendChild(box);
}

export function imgDragStart(this: DocxView, handle: string, e: MouseEvent) {
  const s = this.imgSel;
  if (!s) return;
  const w0 = s.el.offsetWidth, h0 = s.el.offsetHeight;
  this.imgDrag = { mode: handle === "move" ? "move" : "resize", handle, sx: e.clientX, sy: e.clientY, w0, h0, l0: parseFloat(s.el.style.left) || 0, t0: parseFloat(s.el.style.top) || 0, ratio: w0 / Math.max(1, h0), el: s.el, drawing: s.drawing };
}

export function imgDragMove(this: DocxView, e: MouseEvent) {
  const d = this.imgDrag!;
  const dx = (e.clientX - d.sx) / this.zoom, dy = (e.clientY - d.sy) / this.zoom;
  if (d.mode === "move") {
    let l = d.l0 + dx, t = d.t0 + dy;
    d.el.style.left = `${l}px`; d.el.style.top = `${t}px`;
    if (this.snapGuides && !e.altKey) { // menempel ke garis bantu penggaris (Alt = tanpa snap)
      const sn = this.snapGuides(d.el.getBoundingClientRect());
      if (sn.dx || sn.dy) { l += sn.dx; t += sn.dy; d.el.style.left = `${l}px`; d.el.style.top = `${t}px`; }
    }
    this.updateOverlay();
    return;
  }
  const h = d.handle;
  let w = d.w0, hh = d.h0;
  if (h.includes("e")) w = d.w0 + dx; if (h.includes("w")) w = d.w0 - dx;
  if (h.includes("s")) hh = d.h0 + dy; if (h.includes("n")) hh = d.h0 - dy;
  const lock = this.lockAspect !== e.shiftKey;
  const corner = h.length === 2;
  if (lock) {
    if (corner) { const sx = w / d.w0, sy = hh / d.h0; const k = Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy; w = d.w0 * k; hh = d.h0 * k; }
    else if (h === "e" || h === "w") hh = w / d.ratio;
    else w = hh * d.ratio;
  }
  w = Math.max(12, w); hh = Math.max(12, hh);
  d.el.style.width = `${w}px`; d.el.style.height = `${hh}px`;
  if (d.el.dataset.wrap === "abs") { if (h.includes("w")) d.el.style.left = `${d.l0 + (d.w0 - w)}px`; if (h.includes("n")) d.el.style.top = `${d.t0 + (d.h0 - hh)}px`; }
  this.updateOverlay();
}

export function imgDragEnd(this: DocxView) {
  const d = this.imgDrag!;
  this.imgDrag = null;
  const book = this.book!;
  const info = readDrawing(d.drawing);
  if (d.mode === "move") {
    const fr = info ? this.paginator.anchorBase(d.el, info) : undefined;
    if (info && fr) {
      const x = fr.px0 + (parseFloat(d.el.style.left) || 0), y = fr.py0 + (parseFloat(d.el.style.top) || 0);
      const relH = info.posH?.rel ?? "page", relV = info.posV?.rel ?? "page";
      setPosition(d.drawing, (x - fr.baseX(relH)[0]) * 9525, (y - fr.baseY(relV)[0]) * 9525, relH, relV);
      const hfm = this.hfOf(d.el);
      if (hfm) this.book!.touchHF(hfm);
      this.commit("hist.imgMove");
      this.paginator.layoutAnchors();
    }
    this.updateOverlay();
    return;
  }
  const w = d.el.offsetWidth, h = d.el.offsetHeight;
  if (Math.abs(w - d.w0) < 1 && Math.abs(h - d.h0) < 1) return;
  setSize(d.drawing, w * 9525, h * 9525);
  void book;
  this.afterImageChange("hist.imgResize");
}

/** relId header/footer tempat elemen berada (undefined bila di body). */
export function hfOf(this: DocxView, el: HTMLElement): string | undefined { return el.closest<HTMLElement>("[data-hf]")?.dataset.hf; }

/** Perubahan pada gambar di header/footer: simpan ke pohon header, gambar ulang semua halaman, pilih ulang gambar. */
export function afterHFImageChange(this: DocxView, label: string, relId: string, reselect: boolean) {
  const drawing = this.imgSel?.drawing;
  this.book!.touchHF(relId);
  this.commit(label);
  this.paginate();
  this.selectImageEl(reselect && drawing ? this.reg.domOf.get(drawing) : null);
}

export function afterImageChange(this: DocxView, label: string, reselect = true) {
  const hf = this.imgSel ? this.hfOf(this.imgSel.el) : undefined;
  if (hf) { this.afterHFImageChange(label, hf, reselect); return; }
  const s = this.imgSel;
  const p = s ? this.reg.elOf.get(this.drawingParaEl(s.el) ?? s.el) : undefined;
  const drawing = s?.drawing;
  if (p) this.rerenderPara(p);
  if (reselect && drawing) this.selectImageEl(this.reg.domOf.get(drawing));
  this.commit(label);
  this.schedulePaginate(30);
}

export function imgInfo(this: DocxView): ImgSelInfo | undefined {
  const s = this.imgSel;
  if (!s || !this.book) return undefined;
  const i = readDrawing(s.drawing);
  if (!i) return undefined;
  let natural: { w: number; h: number } | undefined;
  let format = "";
  if (i.relId) {
    const part = this.book.mediaPart(i.relId);
    if (part) { const z = sniffImageSize(part.data); if (z) natural = { w: z.w, h: z.h }; format = part.contentType.replace("image/", "") + ` · ${Math.round(part.data.length / 1024)} KB`; }
  }
  return { name: i.name, descr: i.descr, wPx: Math.round(i.cx / 9525), hPx: Math.round(i.cy / 9525), wrap: i.wrap, lock: this.lockAspect, rot: i.rot, content: i.content, floating: i.kind === "anchor", format, relId: i.relId, natural };
}

export function imgSetSize(this: DocxView, wPx: number | null, hPx: number | null) {
  const s = this.imgSel;
  if (!s || this.readonly) return;
  const i = readDrawing(s.drawing);
  if (!i) return;
  let w = wPx ?? i.cx / 9525, h = hPx ?? i.cy / 9525;
  if (this.lockAspect) { const r = i.cx / Math.max(1, i.cy); if (wPx !== null && hPx === null) h = w / r; else if (hPx !== null && wPx === null) w = h * r; }
  setSize(s.drawing, Math.max(8, w) * 9525, Math.max(8, h) * 9525);
  this.afterImageChange("hist.imgResize");
}

export function imgSetLock(this: DocxView, on: boolean) { this.lockAspect = on; if (this.imgSel) setLockAspect(this.imgSel.drawing, on); this.updateOverlay(); this.scheduleSelection(); }

export function imgSetWrap(this: DocxView, mode: WrapMode, h?: "left" | "center" | "right") {
  const s = this.imgSel;
  if (!s || this.readonly) return;
  setWrapMode(s.drawing, mode, { h, rel: mode === "behind" || mode === "front" ? "margin" : undefined });
  this.afterImageChange("hist.imgWrap");
}

export function imgSetAlt(this: DocxView, descr: string, title?: string) { if (this.imgSel && !this.readonly) { setAlt(this.imgSel.drawing, descr, title); this.afterImageChange("hist.imgAlt"); } }

export function imgRotate(this: DocxView, deg: number) { const s = this.imgSel; if (!s || this.readonly) return; setRotation(s.drawing, deg); this.afterImageChange("hist.imgRotate"); }

export function imgFlip(this: DocxView, axis: "h" | "v") { const s = this.imgSel; if (!s || this.readonly) return; const i = readDrawing(s.drawing)!; setRotation(s.drawing, i.rot, axis === "h" ? !i.flipH : i.flipH, axis === "v" ? !i.flipV : i.flipV); this.afterImageChange("hist.imgRotate"); }

export function imgCrop(this: DocxView, c: { l: number; t: number; r: number; b: number } | null) { const s = this.imgSel; if (!s || this.readonly) return; setCrop(s.drawing, c ? { l: c.l * 1000, t: c.t * 1000, r: c.r * 1000, b: c.b * 1000 } : null); this.afterImageChange("hist.imgCrop"); }

export function imgReset(this: DocxView) {
  const s = this.imgSel; const i = s && readDrawing(s.drawing);
  if (!s || !i?.relId || this.readonly) return;
  const part = this.book!.mediaPart(i.relId);
  const z = part && sniffImageSize(part.data);
  if (!z) return;
  setSize(s.drawing, z.w * 9525 * 0.75, z.h * 9525 * 0.75);
  setCrop(s.drawing, null); setRotation(s.drawing, 0, false, false);
  this.afterImageChange("hist.imgResize");
}

export function imgNudge(this: DocxView, dx: number, dy: number) {
  const s = this.imgSel; const i = s && readDrawing(s.drawing);
  if (!s || !i || i.kind !== "anchor") return;
  const fr = this.paginator.anchorBase(s.el, i);
  if (!fr) return;
  const x = fr.px0 + (parseFloat(s.el.style.left) || 0) + dx, y = fr.py0 + (parseFloat(s.el.style.top) || 0) + dy;
  const relH = i.posH?.rel ?? "page", relV = i.posV?.rel ?? "page";
  setPosition(s.drawing, (x - fr.baseX(relH)[0]) * 9525, (y - fr.baseY(relV)[0]) * 9525, relH, relV);
  this.paginator.layoutAnchors(); this.updateOverlay(); this.commit("hist.imgMove", "hist.imgMove");
}

export function imgDelete(this: DocxView) {
  const s = this.imgSel;
  if (!s || this.readonly || !this.book) return;
  const p = this.reg.elOf.get(this.drawingParaEl(s.el) ?? s.el);
  if (!p) return;
  const u = units(p).find(x => x.piece === s.drawing || descendAll(x.piece, "drawing").includes(s.drawing));
  if (!u) return;
  const hf = this.hfOf(s.el);
  deleteRange(p, u.start, u.end);
  normalize(p);
  if (hf) { this.afterHFImageChange("hist.imgDelete", hf, false); return; }
  this.imgSel = null;
  this.rerenderPara(p);
  this.setCaret(p, u.start);
  this.updateOverlay();
  this.commit("hist.imgDelete"); this.schedulePaginate(30);
}

export function imgDuplicate(this: DocxView) { if (this.imgSel) { this.imgClip = cloneEl(this.imgSel.drawing); this.imgPaste(); } }

export function imgPaste(this: DocxView) {
  const book = this.book;
  const s = this.selPoints();
  if (!book || !this.imgClip || this.readonly) return;
  let pt: Point | null = s ? { p: s.a.p, off: s.a.off } : null;
  if (!pt && this.imgSel) { const p = this.reg.elOf.get(this.drawingParaEl(this.imgSel.el) ?? this.imgSel.el); if (p) pt = { p, off: flatLength(p) }; }
  if (!pt) return;
  if (s && !s.collapsed) { const d = this.deleteSelection(); if (d) pt = d; }
  const nd = cloneDrawing(this.imgClip, maxDocPrId(book.body) + 1);
  insertTextRunDrawing(pt.p, pt.off, nd);
  this.rerenderPara(pt.p);
  this.selectImageEl(this.reg.domOf.get(nd));
  this.commit("hist.imgInsert"); this.schedulePaginate(30);
}

export async function insertImageFile(this: DocxView, file: File): Promise<boolean> {
  const book = this.book;
  if (!book || this.readonly) return false;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let size = sniffImageSize(bytes);
    if (!size) size = await decodeImageSize(file);
    if (!size) { this.hooks.toast("toast.imgUnsupported", { name: file.name }); return false; }
    const s = this.selPoints();
    const ps = [...book.paragraphs()];
    let pt: Point | null = s ? { p: s.a.p, off: s.a.off } : ps.length ? { p: ps[ps.length - 1].p, off: flatLength(ps[ps.length - 1].p) } : null;
    if (!pt) return false;
    if (s && !s.collapsed) { const d = this.deleteSelection(); if (d) pt = d; }
    const sec = this.sectionOfPara(pt.p);
    const maxW = Math.min(MAX_IMG_W, sec ? ((sec.w - sec.ml - sec.mr) * 96) / 1440 : MAX_IMG_W);
    const maxH = sec ? ((sec.h - sec.mt - sec.mb) * 96) / 1440 * 0.9 : 800;
    let w = size.w * 0.75 > 4 ? size.w * 0.75 : size.w, h = size.h * 0.75 > 4 ? size.h * 0.75 : size.h;
    const k = Math.min(1, maxW / w, maxH / h);
    w = Math.max(8, w * k); h = Math.max(8, h * k);
    const drawing = insertImageAt(book, pt.p, pt.off, bytes, w, h, file.name.replace(/\.[^.]+$/, ""), file.type || size.type);
    this.rerenderPara(pt.p);
    this.selectImageEl(this.reg.domOf.get(drawing));
    this.commit("hist.imgInsert"); this.schedulePaginate(30);
    return true;
  } catch (err) {
    this.hooks.log("error", "images", "log.imgInsertFail", { msg: err instanceof Error ? err.message : String(err) });
    this.hooks.toast("toast.imgFail", { name: file.name });
    return false;
  }
}

/** Sisipkan objek OLE di kursor (mengganti seleksi bila ada). */
export function insertOle(this: DocxView, prep: PreparedOle, size?: { wPx: number; hPx: number }): (DocxOleRef & { paragraph: number }) | undefined {
  const book = this.book;
  if (!book || this.readonly) return undefined;
  const s = this.selPoints();
  const ps = [...book.paragraphs()];
  let pt: Point | null = s ? { p: s.a.p, off: s.a.off } : ps.length ? { p: ps[ps.length - 1].p, off: flatLength(ps[ps.length - 1].p) } : null;
  if (!pt) return undefined;
  if (s && !s.collapsed) { const d = this.deleteSelection(); if (d) pt = d; }
  const sec = this.sectionOfPara(pt.p);
  const maxW = sec ? ((sec.w - sec.ml - sec.mr) * 96) / 1440 : MAX_IMG_W;
  const w = Math.min(size?.wPx ?? prep.previewWidth, maxW), h = (size?.hPx ?? prep.previewHeight) * (w / (size?.wPx ?? prep.previewWidth));
  const { run, ref } = createOleRun(book, prep, { wPx: w, hPx: h });
  insertRunAt(pt.p, pt.off, run);
  this.rerenderPara(pt.p);
  this.commit("hist.oleInsert");
  this.schedulePaginate(30);
  return { ...ref, paragraph: [...book.paragraphs()].findIndex(x => x.p === pt!.p) + 1 };
}
