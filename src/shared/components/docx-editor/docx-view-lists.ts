/** DocxView: docx-view-lists.ts — fungsi bagian dari kelas (`this: DocxView`), dipasang di kelas sebagai properti agar API publik tidak berubah. */
import type { DocxView } from "./docx-view";
import { attr, first, setAttr, val, type XEl } from "./docx-xml";
import { applyParaPatch } from "./docx-text";
import { linkAt, toggleList as toggleListOp, unlinkRange, wrapRunsInLink } from "./docx-ops";
import { LIST_PRESETS, abstractIdOf, createList, listInfo, listOf, type ListInfo } from "./docx-lists";

/** Ringkasan daftar pada kursor (undefined bila bukan daftar). */
export function listInfoAtCaret(this: DocxView): ListInfo | undefined {
  const s = this.selPoints();
  return this.book && s ? listInfo(this.book, s.a.p) : undefined;
}

export function listParas(this: DocxView): XEl[] { return [...new Set(this.spans().map(s => s.p))]; }

export function afterListChange(this: DocxView, sel: ReturnType<DocxView["captureSel"]>) {
  this.refreshNums();
  this.restoreSel(sel);
  this.commit("hist.list");
  this.schedulePaginate();
}

/**
 * Terapkan gaya daftar dari galeri. Seleksi yang sudah berada dalam SATU daftar → gaya daftar itu diganti (seluruh item);
 * selain itu seleksi menjadi daftar baru (penomoran mulai dari awal).
 */
export function applyListPreset(this: DocxView, presetId: string): boolean {
  const book = this.book;
  const ps = this.listParas();
  if (!book || this.readonly || !ps.length || !LIST_PRESETS.some(p => p.id === presetId)) return false;
  const sel = this.captureSel();
  const infos = ps.map(p => listOf(book, p));
  const one = infos[0] && infos.every(i => i && i.numId === infos[0]!.numId) ? infos[0]!.numId : undefined;
  if (one !== undefined) {
    // gaya seluruh daftar berganti: definisi baru + pindahkan semua itemnya (referensi numPr berada di body sehingga ikut undo)
    const numId = createList(book, presetId);
    this.moveToList([...book.paragraphs()].map(x => x.p).filter(p => listOf(book, p)?.numId === one), numId);
  } else {
    const numId = createList(book, presetId);
    ps.forEach((p, i) => {
      applyParaPatch(p, { num: { numId, ilvl: infos[i]?.ilvl ?? 0 } });
      if (book.styles.has("ListParagraph") && !val(first(p, "pPr"), "pStyle")) applyParaPatch(p, { style: "ListParagraph" });
      this.rerenderPara(p);
    });
  }
  this.afterListChange(sel);
  return true;
}

/** Paragraf pertama terpilih beserta semua paragraf berikutnya dalam daftar (numId) yang sama. */
export function listTail(this: DocxView): { numId: number; paras: XEl[]; first: XEl } | undefined {
  const book = this.book;
  const ps = this.listParas();
  const l = book && ps.length ? listOf(book, ps[0]) : undefined;
  if (!book || !l) return undefined;
  const all = [...book.paragraphs()].map(x => x.p);
  const start = all.indexOf(ps[0]);
  return { numId: l.numId, first: ps[0], paras: all.slice(start).filter(p => listOf(book, p)?.numId === l.numId) };
}

export function moveToList(this: DocxView, paras: XEl[], numId: number) {
  for (const p of paras) { const l = listOf(this.book!, p); applyParaPatch(p, { num: { numId, ilvl: l?.ilvl ?? 0 } }); }
}

/** Mulai ulang penomoran pada paragraf terpilih (dan item berikutnya dalam daftar yang sama) dari `start` (default 1). */
export function restartList(this: DocxView, start = 1): boolean {
  const t = this.listTail();
  const book = this.book;
  if (!t || !book || this.readonly) return false;
  const abs = abstractIdOf(book, t.numId);
  if (abs === undefined) return false;
  const sel = this.captureSel();
  const numId = createList(book, "num-dot", { abstractId: abs, start: Math.max(0, Math.floor(start)) });
  this.moveToList(t.paras, numId);
  this.afterListChange(sel);
  return true;
}

/** Lanjutkan penomoran dari daftar bernomor terdekat di atas paragraf terpilih. */
export function continueList(this: DocxView): boolean {
  const t = this.listTail();
  const book = this.book;
  if (!t || !book || this.readonly) return false;
  const all = [...book.paragraphs()].map(x => x.p);
  let prevNum: number | undefined;
  for (let i = all.indexOf(t.first) - 1; i >= 0; i--) {
    const l = listOf(book, all[i]);
    if (l && l.numId !== t.numId && book.numbering.lvl(l.numId, 0)?.fmt !== "bullet") { prevNum = l.numId; break; }
  }
  if (prevNum === undefined) return false;
  const sel = this.captureSel();
  this.moveToList(t.paras, prevNum);
  this.afterListChange(sel);
  return true;
}

/** Nilai awal daftar pada paragraf terpilih (sama dengan mulai ulang dari `n`). */
export function setListStart(this: DocxView, n: number): boolean { return this.restartList(n); }

export function toggleList(this: DocxView, kind: "bullet" | "number") {
  if (this.readonly || !this.book) return;
  const sp = this.spans();
  if (!sp.length) return;
  const sel = this.captureSel();
  const ps = [...new Set(sp.map(s => s.p))];
  toggleListOp(this.book, ps, kind);
  for (const p of ps) this.rerenderPara(p);
  this.refreshNums(); this.restoreSel(sel); this.commit("hist.list"); this.schedulePaginate();
}

export function setLink(this: DocxView, url: string | null, tooltip?: string) {
  const book = this.book;
  const sp = this.spans();
  if (!book || !sp.length || this.readonly) return;
  const sel = this.captureSel();
  for (const s of sp) {
    if (url === null) unlinkRange(book, s.p, s.a, s.b);
    else if (s.b > s.a) wrapRunsInLink(book, s.p, s.a, s.b, url, tooltip);
    else {
      const l = linkAt(s.p, s.a);
      if (l) { const rid = attr(l, "id"); if (rid) book.setLinkTarget(rid, url); else setAttr(l, "anchor", url.replace(/^#/, "")); }
    }
    this.rerenderPara(s.p);
  }
  this.restoreSel(sel); this.commit("hist.link"); this.schedulePaginate();
}
