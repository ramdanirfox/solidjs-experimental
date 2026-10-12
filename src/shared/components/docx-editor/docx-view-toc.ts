/** DocxView: docx-view-toc.ts — fungsi bagian dari kelas (`this: DocxView`), dipasang di kelas sebagai properti agar API publik tidak berubah. */
import { DEFAULT_TOC } from "./docx-toc";
import type { DocxView } from "./docx-view";
import { insertAfter, removeNode, type XEl } from "./docx-xml";
import { addStyle } from "@office-kit/docx";
import { buildTocParagraphs, buildTocTitle, ensureTocStyles as ensureTocStylesOp, findTocs, removeTocField, tocHeadings, wrapTocSdt, type TocField, type TocOptions } from "./docx-toc";

export function tocList(this: DocxView): TocField[] { return this.book ? findTocs(this.book) : []; }

/** Nomor halaman tampil (sesuai `pgNumType`: mulai dari / format) tempat paragraf berada. */
export function pageOfPara(this: DocxView, p: XEl): string | undefined {
  return this.reg.domOf.get(p)?.closest<HTMLElement>(".dx-page")?.dataset.disp || undefined;
}

export function tocContentTw(this: DocxView): number {
  const sc = this.book!.sections()[0];
  return Math.max(1440, sc.w - sc.ml - sc.mr);
}

export function ensureTocStyles(this: DocxView) {
  const book = this.book!;
  if (ensureTocStylesOp(book, o => addStyle(book.doc, o))) book.rebuildEngines();
}

/** Sisipkan daftar isi di kursor (setelah paragraf aktif). Mengembalikan false bila tidak ada dokumen / readonly. */
export function insertToc(this: DocxView, partial: Partial<TocOptions> = {}): boolean {
  const book = this.book;
  if (!book || this.readonly) return false;
  const o: TocOptions = { ...DEFAULT_TOC, title: this.tocText.title, ...partial };
  this.ensureTocStyles();
  const pt = this.selPoints();
  const ref = pt?.b.p;
  const container = (ref && book.parentOf(ref)) || book.body;
  const skip = new Set<XEl>();
  const headings = tocHeadings(book, this.outline(), o, skip);
  const paras = buildTocParagraphs({ book, headings, options: o, pageOf: p => this.pageOfPara(p), contentTw: this.tocContentTw(), emptyText: this.tocText.empty });
  const kids = [...(o.title ? [buildTocTitle(book, o.title)] : []), ...paras];
  const sdt = wrapTocSdt(kids);
  if (ref && book.parentOf(ref)) insertAfter(container, ref, sdt);
  else { container.children.push(sdt); container.selfClosing = false; }
  book.reindex();
  this.renderAll({ sel: null });
  this.refreshTocPages();
  this.commit("hist.toc");
  return true;
}

/** Perbarui daftar isi (semua, atau satu menurut indeks) dari judul saat ini + nomor halaman terbaru. Mengembalikan jumlah yang diperbarui. */
export function updateToc(this: DocxView, which?: number): number {
  const book = this.book;
  if (!book || this.readonly) return 0;
  const tocs = findTocs(book);
  if (!tocs.length || (which !== undefined && !tocs[which])) return 0;
  this.ensureTocStyles();
  this.rebuildTocs(which);
  this.renderAll({ sel: null });
  this.refreshTocPages(which);
  this.commit("hist.toc");
  return which === undefined ? tocs.length : 1;
}

export function rebuildTocs(this: DocxView, which?: number) {
  const book = this.book!;
  const tocs = findTocs(book);
  const skip = new Set<XEl>(tocs.flatMap(t => t.paras));
  const outline = this.outline();
  for (const f of [...tocs].reverse()) {
    if (which !== undefined && f.index !== which) continue;
    const headings = tocHeadings(book, outline, f.options, skip);
    const paras = buildTocParagraphs({ book, headings, options: f.options, pageOf: p => this.pageOfPara(p), contentTw: this.tocContentTw(), emptyText: this.tocText.empty });
    const at = f.container.children.indexOf(f.paras[0]);
    for (const p of f.paras) removeNode(f.container, p);
    f.container.children.splice(Math.max(0, at), 0, ...paras);
    f.container.selfClosing = false;
  }
  book.reindex();
}

/** Nomor halaman bergantung pada tata letak; ulangi (maks. 3 kali) sampai stabil. */
export function refreshTocPages(this: DocxView, which?: number) {
  const book = this.book!;
  const sig = () => this.outline().map(h => this.pageOfPara(h.p) ?? 0).join(",");
  let last = sig();
  for (let i = 0; i < 3; i++) {
    this.rebuildTocs(which);
    this.renderAll({ sel: null });
    const now = sig();
    if (now === last) break;
    last = now;
  }
  void book;
}

/** Hapus daftar isi (semua, atau satu menurut indeks). Mengembalikan jumlah yang dihapus. */
export function removeToc(this: DocxView, which?: number): number {
  const book = this.book;
  if (!book || this.readonly) return 0;
  const tocs = findTocs(book);
  let n = 0;
  for (const f of [...tocs].reverse()) {
    if (which !== undefined && f.index !== which) continue;
    removeTocField(book, f); n++;
  }
  if (!n) return 0;
  book.reindex();
  this.renderAll({ sel: null });
  this.commit("hist.toc");
  return n;
}
