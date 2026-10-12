/** DocxView: docx-view-painter.ts — fungsi bagian dari kelas (`this: DocxView`), dipasang di kelas sebagai properti agar API publik tidak berubah. */
import type { DocxView } from "./docx-view";
import { flatLength } from "./docx-text";
import { applyFormat } from "./docx-ops";
import { findAll, type SearchOpts, type SearchResult } from "./docx-search";

export function cancelPainter(this: DocxView) {
  this.painter = null;
  this.pagesEl.classList.remove("dx-painter");
  this.hooks.painter(null);
}

export function applyPainter(this: DocxView) {
  const pn = this.painter;
  const book = this.book;
  if (!pn || !book) return;
  const sp = this.spans();
  if (!sp.length) return;
  const collapsed = sp.length === 1 && sp[0].a === sp[0].b;
  const sel = this.captureSel();
  const targets = sp.map(s => ({ ...s, whole: collapsed }));
  const para = collapsed || sp.length > 1 || sp.some(s => s.a === 0 && s.b === flatLength(s.p));
  applyFormat(book, targets, pn.clip, { char: true, para });
  for (const s of sp) this.rerenderPara(s.p);
  this.refreshNums(); this.restoreSel(sel);
  this.commit("hist.painter"); this.schedulePaginate();
  if (!pn.sticky) this.cancelPainter();
}

export function search(this: DocxView, o: SearchOpts): SearchResult {
  const r = this.book ? findAll(this.book, o) : { hits: [], truncated: false, paragraphs: 0 };
  this.findHits = r.hits;
  this.findCur = -1;
  this.applyHighlights();
  return r;
}
