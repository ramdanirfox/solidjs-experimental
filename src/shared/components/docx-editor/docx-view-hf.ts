/** DocxView: docx-view-hf.ts — fungsi bagian dari kelas (`this: DocxView`), dipasang di kelas sebagai properti agar API publik tidak berubah. */
import type { DocxView } from "./docx-view";
import { first, mk, val, type XEl } from "./docx-xml";
import { type Section } from "./docx-model";
import { condForParagraph } from "./docx-render";
import { normalize, runProps } from "./docx-text";
import { insertRunsAt } from "./docx-text";
import { mergeR, readR, type RProps } from "./docx-style";
import { ps0 } from "./docx-view-shared";

/** Jenis header/footer yang berlaku untuk halaman `pageNo` (mengikuti `titlePg` dan ganjil/genap). */
export function hfTypeFor(this: DocxView, pageNo: number): { sec: number; type: "default" | "first" | "even" } {
  const pg = [...this.pagesEl.querySelectorAll<HTMLElement>(".dx-page")];
  const el = pg.find(p => Number(p.dataset.no) === pageNo) ?? pg[0];
  const sec = Number(el?.dataset.sec ?? 0);
  const s = this.book!.sections()[sec];
  const inSec = pg.filter(p => Number(p.dataset.sec) === sec && Number(p.dataset.no) <= pageNo).length;
  const type = s?.titlePg && inSec === 1 ? "first" : this.book!.evenAndOdd() && pageNo % 2 === 0 ? "even" : "default";
  return { sec, type };
}

/** Halaman tempat kursor berada (1 bila tidak ada). */
export function currentPageNo(this: DocxView): number {
  const s = this.selPoints();
  const d = s ? this.reg.domOf.get(s.a.p) : undefined;
  return Number(d?.closest<HTMLElement>(".dx-page")?.dataset.no ?? 1);
}

/** Masuk mode sunting header/footer pada halaman `pageNo` (default: halaman kursor); membuat header/footer bila belum ada. */
export function editHeaderFooter(this: DocxView, kind: "hdr" | "ftr", pageNo = this.currentPageNo()): boolean {
  const book = this.book;
  if (!book || this.readonly) return false;
  if (this.hfEdit) this.exitHF();
  const { sec, type } = this.hfTypeFor(pageNo);
  const had = this.hfRelFor(sec, kind, type);
  const relId = book.ensureHF(sec, kind, type);
  const root = relId ? book.hf(relId) : undefined;
  if (!relId || !root) return false;
  if (!had) this.commit("hist.hf");
  book.hfActive = root;
  book.reindex();
  this.hfEdit = { relId, kind, page: pageNo, sec };
  this.pagesEl.classList.add("dx-hf-editing");
  this.imgSel = null; this.cellSel = null; this.pending = null;
  this.renderAll({ sel: null });
  this.focusHFStart();
  this.hooks.changed("hf.enter");
  return true;
}

export function hfRelFor(this: DocxView, sec: number, kind: "hdr" | "ftr", type: "default" | "first" | "even"): string | undefined {
  const s = this.book!.sections()[sec];
  return (kind === "hdr" ? s?.hdrRefs : s?.ftrRefs)?.[type];
}

export function focusHFStart(this: DocxView) {
  const box = this.pagesEl.querySelector<HTMLElement>("[data-edit]");
  const d = box?.querySelector<HTMLElement>(".dx-p");
  const p = d ? this.reg.elOf.get(d) : undefined;
  this.bindActiveHF();
  if (p) this.focusPara(p, 0, true);
}

/** Pastikan paragraf header/footer terdaftar ke DOM kotak yang dapat disunting (salinan di halaman lain memakai paragraf yang sama). */
export function bindActiveHF(this: DocxView) {
  if (!this.hfEdit) return;
  const box = this.pagesEl.querySelector<HTMLElement>("[data-edit]");
  if (!box) return;
  for (const d of box.querySelectorAll<HTMLElement>(".dx-p")) { const el = this.reg.elOf.get(d); if (el) this.reg.set(d, el); }
}

/** Keluar dari mode sunting header/footer dan gambar ulang semua salinannya. */
export function exitHF(this: DocxView) {
  const book = this.book;
  if (!book || !this.hfEdit) return;
  clearTimeout(this.normTimer);
  book.hfActive = undefined;
  book.reindex();
  this.hfEdit = null;
  this.pagesEl.classList.remove("dx-hf-editing");
  window.getSelection()?.removeAllRanges();
  this.saved = null; this.pending = null;
  book.hfRev++;
  this.paginator.invalidateHF();
  this.paginate();
  this.hooks.changed("hf.exit");
  this.scheduleSelection();
}

/** Sisipkan field (halaman, jumlah halaman, tanggal…) di kursor. Hasil cache ditampilkan hingga dirender ulang pada header/footer. */
export function insertField(this: DocxView, kind: "PAGE" | "NUMPAGES" | "SECTIONPAGES" | "DATE" | "TIME"): boolean {
  const s = this.selPoints();
  if (!this.book || this.readonly || !s) return false;
  const { p } = s.a;
  let off = s.a.off;
  if (!s.collapsed) { const d = this.deleteSelection(); if (!d) return false; off = d.off; }
  const now = new Date();
  const cached = kind === "DATE" ? now.toLocaleDateString() : kind === "TIME" ? now.toLocaleTimeString() : "1";
  const instr = kind === "DATE" ? ' DATE \\@ "dd/MM/yyyy" ' : kind === "TIME" ? ' TIME \\@ "HH:mm" ' : ` ${kind} `;
  const fc = (t: string) => mk("r", undefined, [mk("fldChar", { fldCharType: t })]);
  const instrRun = mk("r", undefined, [mk("instrText", { "xml:space": "preserve" }, [{ kind: "text", value: instr }])]);
  const result = mk("r", undefined, [mk("t", undefined, [{ kind: "text", value: cached }])]);
  insertRunsAt(p, off, [fc("begin"), instrRun, fc("separate"), result, fc("end")]);
  normalize(p);
  this.rerenderPara(p);
  this.setCaret(p, off + cached.length);
  this.commit("hist.field");
  this.schedulePaginate(30);
  return true;
}

/** Section aktif (halaman kursor / halaman yang disunting). */
export function currentSection(this: DocxView): number { return this.hfEdit?.sec ?? this.hfTypeFor(this.currentPageNo()).sec; }

/** Opsi header/footer untuk section aktif. */
export function hfOptions(this: DocxView): { section: number; sections: number; titlePg: boolean; evenOdd: boolean; pgStart?: number; pgFmt: string; editing: { kind: "hdr" | "ftr"; page: number } | null; has: { hdr: string[]; ftr: string[] } } {
  const book = this.book!;
  const secs = book.sections();
  const sec = Math.min(this.currentSection(), secs.length - 1);
  const s = secs[sec];
  return {
    section: sec, sections: secs.length, titlePg: !!s?.titlePg, evenOdd: book.evenAndOdd(), pgStart: s?.pgNum?.start, pgFmt: s?.pgNum?.fmt ?? "decimal",
    editing: this.hfEdit ? { kind: this.hfEdit.kind, page: this.hfEdit.page } : null,
    has: { hdr: Object.keys(s?.hdrRefs ?? {}), ftr: Object.keys(s?.ftrRefs ?? {}) },
  };
}

export function setDifferentFirstPage(this: DocxView, on: boolean) {
  if (!this.book || this.readonly) return;
  const sec = this.currentSection();
  this.exitHF();
  this.book.setTitlePg(sec, on);
  this.commit("hist.hf"); this.paginate();
}

export function setDifferentOddEven(this: DocxView, on: boolean): boolean {
  if (!this.book || this.readonly) return false;
  this.exitHF();
  const ok = this.book.setEvenOdd(on);
  if (ok) { this.commit("hist.hf"); this.paginate(); }
  return ok;
}

/** Penomoran halaman section aktif (atau semua). `start: null` = lanjutkan; `fmt` = decimal/upperRoman/lowerRoman/upperLetter/lowerLetter. */
export function setPageNumbering(this: DocxView, o: { start?: number | null; fmt?: string | null }, allSections = false) {
  if (!this.book || this.readonly) return;
  const secs = this.book.sections();
  const target = allSections ? secs.map((_, i) => i) : [this.currentSection()];
  this.exitHF();
  for (const i of target) this.book.setPageNumbering(i, o);
  this.commit("hist.pgnum"); this.paginate();
  if (this.tocList().length) this.updateToc();
}

/** Hapus header/footer jenis `type` pada section aktif. */
export function removeHeaderFooter(this: DocxView, kind: "hdr" | "ftr", type: "default" | "first" | "even" = "default"): boolean {
  if (!this.book || this.readonly) return false;
  const sec = this.currentSection();
  this.exitHF();
  const ok = this.book.removeHF(sec, kind, type);
  if (ok) { this.commit("hist.hf"); this.paginator.invalidateHF(); this.paginate(); }
  return ok;
}

export function openLink(this: DocxView, href: string) {
  if (!href) return;
  if (href.startsWith("#")) { this.scrollToBookmark(href.slice(1)); return; }
  const i = href.indexOf("#");
  if (/^(https?:|mailto:|tel:|ftp:)/i.test(href)) window.open(i > 0 && !/^https?:\/\/[^#]*#/.test(href) ? href : href, "_blank", "noopener,noreferrer");
  else this.hooks.toast("toast.linkBlocked", { href });
}

export function scrollToBookmark(this: DocxView, name: string) {
  const el = this.pagesEl.querySelector<HTMLElement>(`[data-bm="${CSS.escape(name)}"]`);
  if (el) el.scrollIntoView({ block: "center" });
  else this.hooks.toast("toast.noBookmark", { name });
}

export function scrollToNote(this: DocxView, key: string) {
  const [kind, id] = key.split(":");
  const idx = this.fnRefs.findIndex(f => f.kind === kind && f.id === id);
  const note = this.notesEl?.querySelectorAll(".dx-note")[idx];
  (note as HTMLElement | undefined)?.scrollIntoView({ block: "center" });
}

export function onContext(this: DocxView, e: MouseEvent) {
  if (!this.book) return;
  const t = e.target as HTMLElement;
  const img = t.closest<HTMLElement>(".dx-img");
  if (img) { e.preventDefault(); if (this.imgSel?.el !== img) this.selectImageEl(img); this.hooks.context(e.clientX, e.clientY, "image"); return; }
  const c = this.cellAt(t);
  if (c) {
    if (!this.cellSel) { const pt = this.pointOf(window.getSelection()?.anchorNode ?? null, 0); if (!pt) { const p = ps0(c.tc, this.book); if (p) this.setCaret(p, 0); } }
    e.preventDefault(); this.hooks.context(e.clientX, e.clientY, "table"); return;
  }
  if (!this.readonly) { e.preventDefault(); this.hooks.context(e.clientX, e.clientY, "text"); }
}

/** Properti run terselesaikan (style paragraf + tabel + style karakter + langsung). */
export function runResolved(this: DocxView, p: XEl, run: XEl | undefined): RProps {
  const book = this.book!;
  const base = book.styles.paraBase(val(first(p, "pPr"), "pStyle"), condForParagraph(book, p)).r;
  if (!run) return mergeR(base, readR(first(first(p, "pPr"), "rPr"), book.styles.theme));
  const rPr = runProps(run);
  const rs = val(rPr, "rStyle");
  return mergeR(mergeR(base, rs ? book.styles.charLayer(rs) : undefined), readR(rPr, book.styles.theme));
}
