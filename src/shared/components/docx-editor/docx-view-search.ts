/** DocxView: docx-view-search.ts — fungsi bagian dari kelas (`this: DocxView`), dipasang di kelas sebagai properti agar API publik tidak berubah. */
import { type DocxNavTarget } from "./docx-view-shared";
import type { DocxView } from "./docx-view";
import { attr, descendAll, els, setAttr, type XEl } from "./docx-xml";
import { rangeFromFlat } from "./docx-dom";
import { flatLength, normalize } from "./docx-text";
import { compileFind, replaceInString } from "../editor-kit/find-replace";
import { findAll, replaceHits, type Hit, type SearchOpts } from "./docx-search";
import { DOCX_REPLACE_KINDS, findFills, findFonts, findInHeaderFooter, findInSideParts, findTextColors, listLinks, removeLink, sideRefParagraph, replaceFills, replaceFonts, replaceInHeaderFooter, replaceInHeaderFooterAt, replaceInSideHitAt, replaceInSideParts, replaceLinkUrls, replaceTextColors, setLinkTarget, toLinkItem, type DocxLink } from "./docx-nav";
import { isValueKind, makeReport, type FindMatch, type FindResult, type FindSpec, type NavEvent, type ReplaceKind, type ReplaceReport, type ReplaceSpec } from "../editor-kit/find-replace";
import type { LinkItem } from "../editor-kit/hyperlink";
import { searchOpts } from "./docx-view-shared";

export function clearSearch(this: DocxView) { this.findHits = []; this.findCur = -1; this.clearHighlights(); }

export function pageOfHit(this: DocxView, h: Hit): number { return Number(this.reg.domOf.get(h.p)?.closest<HTMLElement>(".dx-page")?.dataset.no ?? 0); }

export function gotoHit(this: DocxView, i: number) {
  const h = this.findHits[i];
  if (!h) return;
  this.findCur = i;
  const d = this.reg.domOf.get(h.p);
  if (!d) return;
  this.applyHighlights();
  const r = rangeFromFlat(d, h.start, h.end);
  if (typeof r.getBoundingClientRect === "function") {
    const rect = r.getBoundingClientRect();
    const hr = this.host.getBoundingClientRect();
    if (rect.top < hr.top + 40 || rect.bottom > hr.bottom - 40) this.host.scrollTop += rect.top - hr.top - hr.height / 3;
    if (rect.left < hr.left || rect.right > hr.right) this.host.scrollLeft += rect.left - hr.left - 60;
  }
  window.getSelection()?.setBaseAndExtent(r.startContainer, r.startOffset, r.endContainer, r.endOffset);
}

export function clearHighlights(this: DocxView) {
  const hl = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  hl?.delete("dx-find"); hl?.delete("dx-find-cur");
}

export function applyHighlights(this: DocxView) {
  const hl = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  const H = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!hl || !H) return;
  this.clearHighlights();
  if (!this.findHits.length) return;
  const all: Range[] = []; let cur: Range | undefined;
  this.findHits.forEach((h, i) => {
    const d = this.reg.domOf.get(h.p);
    if (!d || !d.isConnected) return;
    const r = rangeFromFlat(d, h.start, h.end);
    if (i === this.findCur) cur = r; else all.push(r);
  });
  hl.set("dx-find", new H(...all));
  if (cur) hl.set("dx-find-cur", new H(cur));
}

export function replaceHitsBy(this: DocxView, hits: Hit[], o: SearchOpts, replacement: string): number {
  if (!this.book || this.readonly || !hits.length) return 0;
  const n = replaceHits(hits, o, replacement);
  for (const p of new Set(hits.map(h => h.p))) { normalize(p); this.rerenderPara(p); }
  this.commit("hist.replace"); this.schedulePaginate(30);
  return n;
}

/** Cari lintas jenis (`text`, `headerFooter`, `link`; default semuanya). Hasil pertama disorot kecuali `select === false`. */
export function findMatches(this: DocxView, spec: FindSpec): FindResult {
  const book = this.book;
  const empty: FindResult = { query: spec.query, count: 0, matches: [], current: -1 };
  if (!book || !spec.query) { this.clearSearch(); this.findCursor.clear(); return empty; }
  const kinds = (spec.kinds?.length ? spec.kinds : ["text", "headerFooter", "link"]) as ReplaceKind[];
  const limit = spec.limit ?? 2000;
  const items: { m: FindMatch; hit?: number; link?: DocxLink }[] = [];
  let error: string | undefined, truncated = false;
  const add = (m: Omit<FindMatch, "index">, extra: { hit?: number; link?: DocxLink }) => { if (items.length < limit) items.push({ m: { ...m, index: items.length }, ...extra }); else truncated = true; };
  if (kinds.includes("text")) {
    const r = this.search({ query: spec.query, regex: !!spec.regex, caseSensitive: !!spec.caseSensitive, wholeWord: !!spec.wholeWord });
    error = r.error; truncated ||= r.truncated;
    r.hits.forEach((h, i) => add({
      kind: "text", text: h.text, before: h.before, after: h.after,
      location: h.where.kind === "table" ? `¶${h.where.para} · T${h.where.table} r${h.where.row} c${h.where.col}` : `¶${h.where.para}`,
      target: { kind: "paragraph", index: h.where.para, start: h.start, end: h.end },
    }, { hit: i }));
  } else this.clearSearch();
  if (kinds.includes("headerFooter")) {
    for (const h of findInHeaderFooter(book, spec, limit)) add({ kind: "headerFooter", text: h.text, before: h.before, after: h.after, location: h.part, target: { kind: "page", page: 1 } }, {});
  }
  for (const sk of ["notes", "comment"] as const) {
    if (!kinds.includes(sk)) continue;
    for (const h of findInSideParts(book, sk, spec, limit)) {
      const para = sideRefParagraph(book, h.part, h.id);
      add({ kind: sk, text: h.text, before: h.before, after: h.after, location: `${h.part === "comments" ? "Comment" : h.part === "endnotes" ? "Endnote" : "Footnote"} ${h.id}${h.author ? ` · ${h.author}` : ""}`, target: para ? { kind: "paragraph", index: para } : { kind: "page", page: 1 } }, {});
    }
  }
  if (kinds.includes("link")) {
    const { re } = compileFind(spec);
    if (re) for (const l of listLinks(book)) {
      re.lastIndex = 0;
      if (re.test(l.url)) add({ kind: "link", text: l.url, before: "", after: l.text, location: `¶${l.para}`, target: { kind: "link", id: l.id } }, { link: l });
    }
  }
  this.findCursor.set(items, -1);
  const res: FindResult = { query: spec.query, count: items.length, matches: items.map(i => i.m), error, truncated, current: -1 };
  if (spec.select !== false && items.length) res.current = this.findStep(1)?.index ?? -1;
  return res;
}

/** Maju/mundur ke hasil cari berikutnya (berputar) dan fokuskan. */
export function findStep(this: DocxView, dir: 1 | -1): FindMatch | undefined {
  const it = this.findCursor.step(dir);
  if (!it) return undefined;
  if (it.hit !== undefined) this.gotoHit(it.hit);
  else if (it.link) { this.focusPara(it.link.p, 0, true); }
  else this.gotoPage(1);
  return it.m;
}

export function findClear(this: DocxView) { this.findCursor.clear(); this.clearSearch(); }

export function gotoPage(this: DocxView, n: number): boolean {
  const pages = [...this.pagesEl.querySelectorAll<HTMLElement>(".dx-page")];
  const pg = pages.find(p => Number(p.dataset.no) === n);
  if (!pg) return false;
  pg.scrollIntoView({ block: "start", behavior: "auto" });
  const firstP = pg.querySelector<HTMLElement>(".dx-p");
  const p = firstP ? this.reg.elOf.get(firstP) : undefined;
  if (p && this.isBodyPara(p)) { this.focusPara(p, 0, false); }
  return true;
}

export function firstParaOfCell(this: DocxView, tc: XEl): XEl | undefined { return this.firstParaIn(tc); }

/** Pindahkan fokus/viewport ke target. Mengembalikan hasil (ok=false bila target tidak ditemukan). */
export function gotoTarget(this: DocxView, t: DocxNavTarget): NavEvent {
  const book = this.book;
  const fail = (): NavEvent => ({ target: t, ok: false });
  if (!book) return fail();
  const paras = () => [...book.paragraphs()].map(x => x.p);
  const toPara = (p: XEl | undefined, start?: number, end?: number, label?: string): NavEvent => {
    if (!p) return fail();
    if (start !== undefined && end !== undefined && end > start) { this.focusPara(p, start, true); this.selectRange(p, start, end); }
    else this.focusPara(p, start ?? 0, true);
    return { target: t, ok: true, label };
  };
  switch (t.kind) {
    case "page": {
      const n = Math.max(1, Math.min(this.paginator.count || 1, Math.round(t.page)));
      return this.gotoPage(n) ? { target: t, ok: true, label: `${n}/${this.paginator.count}` } : fail();
    }
    case "paragraph": { const l = paras(); return toPara(l[Math.round(t.index) - 1], t.start, t.end, `¶${t.index}/${l.length}`); }
    case "heading": {
      const o = this.outline();
      const h = t.index !== undefined ? o[t.index] : t.text ? o.find(x => x.text.toLowerCase() === t.text!.toLowerCase()) ?? o.find(x => x.text.toLowerCase().includes(t.text!.toLowerCase())) : undefined;
      return toPara(h?.p, 0, undefined, h?.text);
    }
    case "bookmark": {
      const bs = descendAll(book.body, "bookmarkStart").find(b => attr(b, "name") === t.name);
      if (!bs) return fail();
      const p = paras().find(q => descendAll(q, "bookmarkStart").includes(bs));
      return p ? toPara(p, 0, undefined, t.name) : (this.scrollToBookmark(t.name), { target: t, ok: true, label: t.name });
    }
    case "table": {
      const tbl = book.tables()[Math.round(t.index) - 1];
      if (!tbl) return fail();
      const rows = els(tbl, "tr");
      const tr = rows[Math.max(0, Math.min(rows.length - 1, (t.row ?? 1) - 1))];
      const cells = tr ? els(tr, "tc") : [];
      const tc = cells[Math.max(0, Math.min(cells.length - 1, (t.col ?? 1) - 1))];
      return toPara(tc ? this.firstParaOfCell(tc) : undefined, 0, undefined, `T${t.index}`);
    }
    case "toc": { const f = this.tocList()[t.index ?? 0]; return toPara(f?.paras[0], 0, undefined, "TOC"); }
    case "link": { const l = listLinks(book).find(x => x.id === t.id); return toPara(l?.p, 0, undefined, l?.url); }
    case "search": {
      const r = this.findMatches({ query: t.query, regex: t.regex, caseSensitive: t.caseSensitive, wholeWord: t.wholeWord, kinds: ["text"], select: false });
      const i = t.occurrence ?? 0;
      if (!r.count || i < 0 || i >= r.count) return fail();
      this.findCursor.index = i - 1;
      const m = this.findStep(1);
      return { target: t, ok: !!m, label: `${i + 1}/${r.count}` };
    }
    case "match": {
      const m = this.findCursor.items[t.index];
      if (!m) return fail();
      this.findCursor.index = t.index - 1;
      this.findStep(1);
      return { target: t, ok: true, label: `${t.index + 1}/${this.findCursor.items.length}` };
    }
    case "start": { const p = paras()[0]; return toPara(p, 0, undefined, "start"); }
    case "end": { const l = paras(); const p = l[l.length - 1]; return toPara(p, p ? flatLength(p) : 0, undefined, "end"); }
  }
}

/** Daftar hyperlink dokumen (body). */
export function linkItems(this: DocxView): LinkItem[] { return this.book ? listLinks(this.book).map(toLinkItem) : []; }

/** Pasang/ubah tautan pada hyperlink hasil `linkItems()` (id). */
export function updateLink(this: DocxView, id: string, patch: { url?: string; tooltip?: string }): boolean {
  const book = this.book;
  if (!book || this.readonly) return false;
  const l = listLinks(book).find(x => x.id === id);
  if (!l) return false;
  if (patch.url !== undefined) setLinkTarget(book, l.el, patch.url, patch.tooltip);
  else if (patch.tooltip !== undefined) { l.el.attrs = l.el.attrs.filter(a => a.name.local !== "tooltip"); if (patch.tooltip) setAttr(l.el, "tooltip", patch.tooltip); }
  this.rerenderPara(l.p);
  this.commit("hist.link");
  return true;
}

export function removeLinkById(this: DocxView, id: string): boolean {
  const book = this.book;
  if (!book || this.readonly) return false;
  const l = listLinks(book).find(x => x.id === id);
  if (!l) return false;
  removeLink(book, l);
  this.rerenderPara(l.p);
  this.commit("hist.link");
  return true;
}

/** Ganti URL massal (substring/regex pada URL tautan). Mengembalikan jumlah tautan yang berubah. */
export function replaceLinks(this: DocxView, spec: { query: string; regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean }, replacement: string): number {
  const book = this.book;
  if (!book || this.readonly) return 0;
  const n = replaceLinkUrls(book, spec, replacement);
  if (n) { this.renderAll({ sel: null }); this.commit("hist.link"); }
  return n;
}

/**
 * Ganti berdasarkan jenis (satu riwayat undo untuk seluruh permintaan).
 * `text`/`headerFooter`/`link`: `query` teks/regex; `font`/`color`/`fill`: `query` nilai persis, `replacement` kosong = hapus (warna).
 */
export function replaceKinds(this: DocxView, spec: ReplaceSpec, onlyCurrent = false): ReplaceReport {
  const book = this.book;
  const kinds = (spec.kinds?.length ? spec.kinds : ["text"]) as ReplaceKind[];
  const rep = (counts: Partial<Record<ReplaceKind, number>>) => makeReport(kinds, DOCX_REPLACE_KINDS, counts);
  if (!book || this.readonly || !spec.query) return { ...rep({}), error: this.readonly ? "readonly" : undefined };
  const counts: Partial<Record<ReplaceKind, number>> = {};
  const touched = new Set<XEl>();
  let structural = false;
  const supported = kinds.filter(k => DOCX_REPLACE_KINDS.includes(k));
  if (onlyCurrent && supported.every(k => !isValueKind(k))) {
    // satu hasil saja: yang aktif (atau pertama) menurut jenis yang diminta
    if (!this.findCursor.items.length) this.findMatches({ ...spec, kinds: supported, select: false });
    const cur = this.findCursor.current ?? this.findCursor.items[0];
    if (!cur) return rep({});
    if (cur.hit !== undefined) {
      const hit = this.findHits[cur.hit];
      if (hit) { counts.text = replaceHits([hit], searchOpts(spec), spec.replacement); normalize(hit.p); touched.add(hit.p); }
    } else if (cur.link) {
      const { re } = compileFind(spec);
      if (re) { const r = replaceInString(cur.link.url, re, spec.replacement, !!spec.regex); if (r.count && r.text.trim()) { setLinkTarget(book, cur.link.el, r.text); counts.link = 1; structural = true; } }
    } else if (cur.m.kind === "notes" || cur.m.kind === "comment") {
      const sk = cur.m.kind;
      const all = findInSideParts(book, sk, spec);
      const idx = this.findCursor.items.filter(x => x.m.kind === sk).indexOf(cur);
      if (all[idx]) { counts[sk] = replaceInSideHitAt(book, all[idx], spec, spec.replacement); structural = true; }
    } else if (cur.m.kind === "headerFooter") {
      // hasil header/footer tunggal: ganti kemunculan pertama pada urutan yang sama dengan pencarian
      const all = findInHeaderFooter(book, spec);
      const idx = this.findCursor.items.filter(x => x.m.kind === "headerFooter").indexOf(cur);
      if (all[idx]) { counts.headerFooter = replaceInHeaderFooterAt(book, all[idx], spec, spec.replacement); structural = true; }
    }
  } else {
    for (const k of supported) {
      if (k === "text") {
        const r = findAll(book, searchOpts(spec));
        counts.text = replaceHits(r.hits, searchOpts(spec), spec.replacement);
        for (const h of r.hits) { normalize(h.p); touched.add(h.p); }
      } else if (k === "headerFooter") { counts.headerFooter = replaceInHeaderFooter(book, spec, spec.replacement); structural ||= !!counts.headerFooter; }
      else if (k === "notes" || k === "comment") { counts[k] = replaceInSideParts(book, k, spec, spec.replacement); structural ||= !!counts[k]; }
      else if (k === "link") { counts.link = replaceLinkUrls(book, spec, spec.replacement); structural ||= !!counts.link; }
      else if (k === "font") { counts.font = replaceFonts(book, spec.query, spec.replacement); structural ||= !!counts.font; }
      else if (k === "color") { counts.color = replaceTextColors(book, spec.query, spec.replacement); structural ||= !!counts.color; }
      else if (k === "fill") { counts.fill = replaceFills(book, spec.query, spec.replacement); structural ||= !!counts.fill; }
    }
  }
  const report = rep(counts);
  if (report.total) {
    if (structural) this.renderAll({ sel: null });
    else for (const p of touched) this.rerenderPara(p);
    this.commit("hist.replace");
    this.schedulePaginate(30);
    this.findCursor.clear(); this.clearSearch();
  }
  return report;
}

/** Hitungan nilai (font/warna/isi) untuk pratinjau sebelum mengganti. */
export function countValue(this: DocxView, kind: "font" | "color" | "fill", value: string): number {
  const b = this.book;
  if (!b) return 0;
  return kind === "font" ? findFonts(b, value) : kind === "color" ? findTextColors(b, value) : findFills(b, value);
}
