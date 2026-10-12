/** DocxView: docx-view-ole.ts — fungsi bagian dari kelas (`this: DocxView`), dipasang di kelas sebagai properti agar API publik tidak berubah. */
import type { DocxView } from "./docx-view";
import { captureFormat } from "./docx-ops";
import { readDrawing, replaceBlip } from "./docx-image";
import { findOleObject, oleSize, setOleSize, updateOleObject } from "./docx-ole-edit";
import type { PreparedOle } from "../office-shared/ole-embed";

/** Ganti isi objek OLE `relId`. Mengembalikan referensi baru (relId berubah agar undo tetap benar). */
export function updateOle(this: DocxView, relId: string, prep: PreparedOle, opts: { keepPreview?: boolean } = {}): ReturnType<typeof updateOleObject> | undefined {
  const book = this.book;
  if (!book || this.readonly) return undefined;
  const found = findOleObject(book, relId);
  if (!found) return undefined;
  const res = updateOleObject(book, relId, prep, opts);
  this.rerenderPara(found.p);
  this.commit("hist.oleUpdate");
  this.schedulePaginate(30);
  return res;
}

/** Ubah ukuran tampilan objek OLE (px CSS). */
export function resizeOle(this: DocxView, relId: string, wPx: number, hPx: number): boolean {
  const book = this.book;
  if (!book || this.readonly || !(wPx > 4) || !(hPx > 4)) return false;
  const found = findOleObject(book, relId);
  if (!found || !setOleSize(book, relId, wPx, hPx)) return false;
  this.rerenderPara(found.p);
  this.commit("hist.oleSize");
  this.schedulePaginate(30);
  return true;
}

export function oleDisplaySize(this: DocxView, relId: string) { return this.book ? oleSize(this.book, relId) : undefined; }

/** Halaman yang paling dekat dengan pusat area gulir beserta ukuran & margin (px dokumen) — dasar penggaris. */
export function pageGeometry(this: DocxView): { el: HTMLElement; width: number; height: number; ml: number; mr: number; mt: number; mb: number; no: number } | null {
  const pages = [...this.pagesEl.querySelectorAll<HTMLElement>(".dx-page")];
  if (!pages.length) return null;
  const sr = this.host.getBoundingClientRect(); // area gulir yang terlihat (bukan stage: tingginya seluruh dokumen)
  const mid = sr.top + sr.height / 2;
  let best = pages[0], bd = Infinity;
  for (const p of pages) {
    const r = p.getBoundingClientRect();
    const d = mid >= r.top && mid <= r.bottom ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid));
    if (d < bd) { bd = d; best = p; }
  }
  const secs = this.book?.sections();
  const sec = secs?.[Math.min(Number(best.dataset.sec ?? 0), (secs?.length ?? 1) - 1)];
  const k = 96 / 1440;
  return {
    el: best, width: best.offsetWidth, height: best.offsetHeight, no: Number(best.dataset.no ?? 0),
    ml: sec ? (sec.ml + sec.gutter) * k : 96, mr: sec ? sec.mr * k : 96, mt: sec ? sec.mt * k : 96, mb: sec ? sec.mb * k : 96,
  };
}

export async function imgReplace(this: DocxView, file: File) {
  const s = this.imgSel; const book = this.book;
  if (!s || !book || this.readonly) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const i = readDrawing(s.drawing);
  const tmp = book.createImageDrawing(bytes, i?.cx ?? 914400, i?.cy ?? 914400, { name: i?.name, contentType: file.type || undefined });
  const rid = readDrawing(tmp)?.relId;
  if (rid) replaceBlip(s.drawing, rid);
  this.afterImageChange("hist.imgReplace");
}

export function startPainter(this: DocxView, sticky = false) {
  const book = this.book;
  const s = this.selPoints();
  if (!book || !s || this.readonly) return;
  const clip = captureFormat(book, s.a.p, s.a.off, !s.collapsed);
  this.painter = { clip, sticky };
  this.pagesEl.classList.add("dx-painter");
  this.hooks.painter({ char: clip.desc.char, para: clip.desc.para, sticky });
}
