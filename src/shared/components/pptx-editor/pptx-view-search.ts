/** PptxView: pptx-view-search.ts — fungsi bagian dari kelas (`this: PptxView`), dipasang di kelas sebagai properti agar API publik tidak berubah. */
import { snippet } from "../editor-kit/find-replace";
import { type FindOpts, type FindHit } from "./pptx-view";
import type { PptxView } from "./pptx-view";
import * as P from "@office-kit/pptx";
import type { SlideShapeData } from "@office-kit/pptx";
import { topShapes } from "./pptx-render";
import { PPTX_REPLACE_KINDS, collectUnits, countValues, listLinks, replaceValues, type PptxUnit } from "./pptx-nav";
import { compileFind, isValueKind, makeReport, matchRanges, replaceInString, type FindMatch, type FindResult, type FindSpec, type NavEvent, type ReplaceKind, type ReplaceReport, type ReplaceSpec } from "../editor-kit/find-replace";
import type { LinkItem } from "../editor-kit/hyperlink";
import type { PptxNavTarget } from "./pptx-view-shared";

/** Cari lintas jenis: `text` (run/sel tabel), `notes`, `link` (URL), `name`. Hasil pertama disorot kecuali `select === false`. */
export function findMatches(this: PptxView, spec: FindSpec): FindResult {
  const empty: FindResult = { query: spec.query, count: 0, matches: [], current: -1 };
  if (!this.deck || !spec.query) { this.clearSearch(); this.fcur.clear(); return empty; }
  const all: ReplaceKind[] = ["text", "notes", "link", "name"];
  const kinds = (spec.kinds?.length ? spec.kinds.filter(k => all.includes(k)) : all) as ReplaceKind[];
  const { re, error } = compileFind(spec);
  if (!re) return { ...empty, error };
  const limit = spec.limit ?? 2000;
  const items: { m: FindMatch; unit: PptxUnit; start: number; end: number }[] = [];
  let truncated = false;
  outer: for (const u of collectUnits(this.slides, kinds, topShapes)) {
    for (const r of matchRanges(u.text, re)) {
      if (items.length >= limit) { truncated = true; break outer; }
      items.push({
        m: { index: items.length, kind: u.kind, text: u.text.slice(r.start, r.end), ...snippet(u.text, r.start, r.end), location: `Slide ${u.slide + 1} · ${u.where}`, target: u.kind === "notes" ? { kind: "notes", slide: u.slide } : { kind: "shape", slide: u.slide, id: u.shapeId } },
        unit: u, start: r.start, end: r.end,
      });
    }
  }
  this.fcur.set(items, -1);
  this.hits = items.map((it, i) => ({ index: i, slide: it.unit.slide, shapeId: it.unit.shapeId, where: it.unit.where, text: it.m.text, before: it.m.before, after: it.m.after, start: it.start, end: it.end }));
  this.hitCur = -1; this.markHits();
  const res: FindResult = { query: spec.query, count: items.length, matches: items.map(i => i.m), truncated, current: -1 };
  if (spec.select !== false && items.length) res.current = this.findStep(1)?.index ?? -1;
  return res;
}

export function findStep(this: PptxView, dir: 1 | -1): FindMatch | undefined {
  const it = this.fcur.step(dir);
  if (!it) return undefined;
  this.gotoHit(this.fcur.index);
  return it.m;
}

export function findClear(this: PptxView) { this.fcur.clear(); this.clearSearch(); }

/** Pindahkan fokus ke slide/bentuk/catatan/tautan/hasil cari. */
export function gotoTarget(this: PptxView, t: PptxNavTarget): NavEvent {
  const fail = (): NavEvent => ({ target: t, ok: false });
  if (!this.deck) return fail();
  const n = this.slides.length;
  const toSlide = (i: number): boolean => { if (!Number.isInteger(i) || i < 0 || i >= n) return false; this.goTo(i); return true; };
  const toShape = (si: number, id?: number, name?: string): SlideShapeData | undefined => {
    const slide = this.slides[si];
    if (!slide) return undefined;
    let sh: SlideShapeData | undefined = id !== undefined && id >= 0 ? P.findShapeById(slide, id) ?? undefined : undefined;
    if (!sh && name) sh = P.getSlideShapes(slide).find(s => P.getShapeName(s).toLowerCase() === name.toLowerCase()) ?? P.getSlideShapes(slide).find(s => P.getShapeName(s).toLowerCase().includes(name.toLowerCase()));
    return sh;
  };
  const focus = (si: number, sh?: SlideShapeData): boolean => {
    if (!toSlide(si)) return false;
    if (sh) { const top = topShapes(this.slide!).find(x => x === sh || (P.getShapeKind(x) === "group" && P.getGroupChildren(x).includes(sh))); if (top && this.ctx.domOf.has(top)) this.select([top]); }
    else this.select([]);
    return true;
  };
  switch (t.kind) {
    case "slide": return toSlide(t.index) ? { target: t, ok: true, label: `${t.index + 1}/${n}` } : fail();
    case "first": return toSlide(0) ? { target: t, ok: true, label: `1/${n}` } : fail();
    case "last": return toSlide(n - 1) ? { target: t, ok: true, label: `${n}/${n}` } : fail();
    case "next": return toSlide(Math.min(n - 1, this.slideIdx + 1)) ? { target: t, ok: true, label: `${this.slideIdx + 1}/${n}` } : fail();
    case "prev": return toSlide(Math.max(0, this.slideIdx - 1)) ? { target: t, ok: true, label: `${this.slideIdx + 1}/${n}` } : fail();
    case "shape": {
      const si = t.slide ?? this.slideIdx;
      const sh = toShape(si, t.id, t.name);
      return sh && focus(si, sh) ? { target: t, ok: true, label: `${si + 1}/${n} · ${P.getShapeName(sh)}` } : fail();
    }
    case "notes": { const si = t.slide ?? this.slideIdx; return focus(si) ? { target: t, ok: true, label: `${si + 1}/${n} · notes` } : fail(); }
    case "link": {
      const l = listLinks(this.slides, topShapes).find(x => x.id === t.id);
      const tg = l?.target as { slide?: number; id?: number } | undefined;
      if (!l || tg?.slide === undefined) return fail();
      return focus(tg.slide, toShape(tg.slide, tg.id)) ? { target: t, ok: true, label: l.url } : fail();
    }
    case "search": {
      const r = this.findMatches({ query: t.query, regex: t.regex, caseSensitive: t.caseSensitive, wholeWord: t.wholeWord, select: false });
      const i = t.occurrence ?? 0;
      if (!r.count || i < 0 || i >= r.count) return fail();
      this.fcur.index = i - 1;
      this.findStep(1);
      return { target: t, ok: true, label: `${i + 1}/${r.count}` };
    }
    case "match": {
      if (!this.fcur.items[t.index]) return fail();
      this.fcur.index = t.index - 1;
      this.findStep(1);
      return { target: t, ok: true, label: `${t.index + 1}/${this.fcur.items.length}` };
    }
  }
}

/**
 * Ganti berdasarkan jenis, satu entri riwayat. `text`/`notes`/`link`/`name`: `query` teks/regex (cocokkan per run — teks yang terbelah
 * antar run tidak terganti). `font`/`color`/`fill`/`stroke`: `query` nilai persis, `replacement` kosong = hapus warna.
 */
export function replaceKinds(this: PptxView, spec: ReplaceSpec, onlyCurrent = false): ReplaceReport {
  const kinds = (spec.kinds?.length ? spec.kinds : ["text"]) as ReplaceKind[];
  const rep = (counts: Partial<Record<ReplaceKind, number>>) => makeReport(kinds, PPTX_REPLACE_KINDS, counts);
  if (!this.deck || this.readonly || !spec.query) return { ...rep({}), error: this.readonly ? "readonly" : undefined };
  this.commitEdit();
  const supported = kinds.filter(k => PPTX_REPLACE_KINDS.includes(k));
  const strKinds = supported.filter(k => !isValueKind(k));
  const valKinds = supported.filter(isValueKind) as ("font" | "color" | "fill" | "stroke")[];
  const counts: Partial<Record<ReplaceKind, number>> = {};
  const { re } = compileFind(spec);
  const sub = (text: string) => (re ? replaceInString(text, re, spec.replacement, !!spec.regex) : { text, count: 0 });
  if (onlyCurrent && !valKinds.length) {
    if (!this.fcur.items.length) this.findMatches({ ...spec, kinds: strKinds, select: false });
    const cur = this.fcur.current ?? this.fcur.items[0];
    if (!cur || !re) return rep({});
    const single = new RegExp(re.source, re.flags.replace("g", ""));
    const seg = cur.unit.text.slice(cur.start, cur.end);
    const out = cur.unit.text.slice(0, cur.start) + (spec.regex ? seg.replace(single, spec.replacement) : spec.replacement) + cur.unit.text.slice(cur.end);
    if ((cur.unit.kind === "link" || cur.unit.kind === "name") && !out.trim()) return rep({});
    cur.unit.set(out);
    counts[cur.unit.kind] = 1;
  } else {
    if (strKinds.length && re) {
      for (const u of collectUnits(this.slides, strKinds, topShapes)) {
        const r = sub(u.text);
        if (!r.count || r.text === u.text) continue;
        if ((u.kind === "link" || u.kind === "name") && !r.text.trim()) continue;
        u.set(r.text);
        counts[u.kind] = (counts[u.kind] ?? 0) + r.count;
      }
    }
    for (const k of valKinds) counts[k] = replaceValues(this.deck.pres, this.slides, topShapes, this.resolveColor, k, spec.query, spec.replacement);
  }
  const report = rep(counts);
  if (report.total) { this.changed("hist.replace"); this.fcur.clear(); this.clearSearch(); this.render(); this.hooks.thumbs("all"); }
  return report;
}

export function countValue(this: PptxView, kind: "font" | "color" | "fill" | "stroke", value: string): number {
  return this.deck ? countValues(this.deck.pres, this.slides, topShapes, this.resolveColor, kind, value) : 0;
}

export function linkItems(this: PptxView): LinkItem[] { return this.deck ? listLinks(this.slides, topShapes) : []; }

export function search(this: PptxView, o: FindOpts): { hits: FindHit[]; error?: string } {
  this.hits = []; this.hitCur = -1;
  const { re, error } = this.compile(o);
  if (!re || !this.deck) { this.markHits(); return { hits: [], error }; }
  const slides = this.slides;
  const push = (si: number, shape: SlideShapeData | null, where: string, text: string) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      const s = m.index, e = s + m[0].length;
      this.hits.push({ index: this.hits.length, slide: si, shapeId: shape ? P.getShapeId(shape) : -1, where, text: m[0], before: text.slice(Math.max(0, s - 24), s).replace(/\s+/g, " "), after: text.slice(e, e + 24).replace(/\s+/g, " "), start: s, end: e });
      if (this.hits.length >= 3000) return;
    }
  };
  slides.forEach((slide, si) => {
    for (const s of topShapes(slide)) {
      if (this.hits.length >= 3000) return;
      try {
        if (P.isTableShape(s)) { const d = P.getTableDimensions(s); for (let r = 0; r < d.rows; r++) for (let c = 0; c < d.cols; c++) push(si, s, `T ${r + 1}×${c + 1}`, P.getTableCellText(P.getTableCell(s, r, c))); }
        else if (P.getShapeKind(s) === "group") for (const ch of P.getGroupChildren(s)) push(si, s, P.getShapeName(ch), P.getShapeText(ch));
        else push(si, s, P.getShapeName(s), P.getShapeText(s));
      } catch { /* abaikan */ }
    }
    const notes = P.getSlideNotes(slide);
    if (notes) push(si, null, "notes", notes);
  });
  this.markHits();
  return { hits: this.hits };
}

export function clearSearch(this: PptxView) { this.hits = []; this.hitCur = -1; this.markHits(); }

export function gotoHit(this: PptxView, i: number) {
  const h = this.hits[i];
  if (!h) return;
  this.hitCur = i;
  if (h.slide !== this.slideIdx) this.goTo(h.slide);
  const shape = h.shapeId >= 0 ? P.findShapeById(this.slide!, h.shapeId) : null;
  if (shape && this.ctx.domOf.has(shape)) this.select([shape]);
  this.markHits();
}

export function markHits(this: PptxView) {
  this.slideEl?.querySelectorAll(".px-hit,.px-hit-cur").forEach(e => e.classList.remove("px-hit", "px-hit-cur"));
  if (!this.slideEl || !this.hits.length) return;
  this.hits.forEach((h, i) => {
    if (h.slide !== this.slideIdx || h.shapeId < 0) return;
    const shape = P.findShapeById(this.slide!, h.shapeId);
    const dom = shape ? this.ctx.domOf.get(shape) : null;
    dom?.classList.add(i === this.hitCur ? "px-hit-cur" : "px-hit");
  });
}

export function replaceHits(this: PptxView, hits: FindHit[], o: FindOpts, repl: string): number {
  if (this.readonly || !this.deck) return 0;
  const { re } = this.compile(o);
  if (!re) return 0;
  const one = new RegExp(re.source, re.flags.replace("g", ""));
  let n = 0;
  const doShape = (shape: SlideShapeData) => {
    const np = P.getShapeParagraphCount(shape);
    for (let p = 0; p < np; p++) for (let r = 0; r < P.getShapeRunCount(shape, p); r++) {
      const t = P.getShapeRunText(shape, p, r);
      re.lastIndex = 0;
      const nt = t.replace(re, m => { n++; return o.regex ? m.replace(one, repl) : repl; });
      if (nt !== t) P.setShapeRunText(shape, p, r, nt);
    }
  };
  const seen = new Set<string>();
  for (const h of hits) {
    const key = `${h.slide}:${h.shapeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const slide = this.slides[h.slide];
    if (!slide) continue;
    if (h.shapeId < 0) { const nt = (P.getSlideNotes(slide) ?? "").replace(re, m => { n++; return o.regex ? m.replace(one, repl) : repl; }); P.setSlideNotes(slide, nt); continue; }
    const shape = P.findShapeById(slide, h.shapeId);
    if (!shape) continue;
    if (P.isTableShape(shape)) { const d = P.getTableDimensions(shape); for (let r = 0; r < d.rows; r++) for (let c = 0; c < d.cols; c++) { const cell = P.getTableCell(shape, r, c); const t = P.getTableCellText(cell); re.lastIndex = 0; const nt = t.replace(re, m => { n++; return o.regex ? m.replace(one, repl) : repl; }); if (nt !== t) P.setTableCellText(cell, nt); } }
    else if (P.getShapeKind(shape) === "group") for (const ch of P.getGroupChildren(shape)) doShape(ch);
    else doShape(shape);
  }
  this.changed("hist.replace"); this.render(); this.hooks.thumbs("all");
  return n;
}

export function debug(this: PptxView): Record<string, unknown> {
  const deck = this.deck;
  if (!deck) return {};
  const out: Record<string, unknown> = { slide: this.slideIdx + 1, slides: this.slides.length, zoom: this.zoom, selection: this.sel.map(s => P.getShapeId(s)), history: { index: deck.histIdx, length: deck.hist.length, max: deck.maxHistory }, readonly: this.readonly };
  if (this.slide) out.slideXml = P.getSlideXmlString(this.slide).slice(0, 6000);
  if (this.sel[0]) { const s = this.sel[0]; out.shapeXml = P.getShapeXmlString(s).slice(0, 5000); try { out.effective = { bounds: P.getShapeBoundsResolved(deck.pres, s), fill: P.getShapeFillEffective(deck.pres, s), stroke: P.getShapeStrokeEffective(deck.pres, s), effects: P.getShapeEffectsEffective(deck.pres, s), body: P.getShapeBodyPrEffective(deck.pres, s) }; } catch { /* abaikan */ } }
  return out;
}
