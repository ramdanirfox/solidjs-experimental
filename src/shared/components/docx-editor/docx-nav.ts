/**
 * Operasi cari/ganti lintas-jenis dan pengelolaan hyperlink untuk dokumen DOCX (tanpa DOM).
 * Dipanggil oleh `DocxView` (find/replace via bus) dan `DocxEditor` (panel tautan).
 */
import { NS, attr, descendAll, els, first, isEl, setAttr, textOf, val, type XEl } from "./docx-xml";
import { flatText, replaceRange, units } from "./docx-text";
import { unlinkRange } from "./docx-ops";
import { walkBlocks, type DocxBook } from "./docx-model";
import { classifyLink, type LinkItem } from "../editor-kit/hyperlink";
import { compileFind, matchRanges, replaceInString, sameColor, sameFont, snippet, normHex, type ReplaceKind } from "../editor-kit/find-replace";

export interface SearchLike { query: string; regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean }

// ───────── header & footer ─────────

export interface HfHit { relId: string; p: XEl; start: number; end: number; text: string; before: string; after: string; part: "header" | "footer" }

function hfRelIds(book: DocxBook): { relId: string; part: "header" | "footer" }[] {
  const out: { relId: string; part: "header" | "footer" }[] = [];
  const seen = new Set<string>();
  for (const s of book.sections()) {
    for (const [refs, part] of [[s.hdrRefs, "header"], [s.ftrRefs, "footer"]] as const) {
      for (const relId of Object.values(refs)) if (relId && !seen.has(relId)) { seen.add(relId); out.push({ relId, part }); }
    }
  }
  return out;
}
function hfParagraphs(root: XEl): XEl[] {
  const out: XEl[] = [];
  walkBlocks(root, (el) => { if (el.name.local === "p") out.push(el); });
  return out;
}

export function findInHeaderFooter(book: DocxBook, o: SearchLike, limit = 2000): HfHit[] {
  const { re } = compileFind(o);
  if (!re) return [];
  const hits: HfHit[] = [];
  for (const { relId, part } of hfRelIds(book)) {
    const root = book.hf(relId);
    if (!root) continue;
    for (const p of hfParagraphs(root)) {
      const text = flatText(p);
      if (!text) continue;
      for (const m of matchRanges(text, re)) {
        hits.push({ relId, p, start: m.start, end: m.end, text: text.slice(m.start, m.end), ...snippet(text, m.start, m.end), part });
        if (hits.length >= limit) return hits;
      }
    }
  }
  return hits;
}

export function replaceInHeaderFooter(book: DocxBook, o: SearchLike, replacement: string): number {
  const { re } = compileFind(o);
  if (!re) return 0;
  let n = 0;
  for (const { relId } of hfRelIds(book)) {
    const root = book.hf(relId);
    if (!root) continue;
    let touched = false;
    for (const p of hfParagraphs(root)) {
      const text = flatText(p);
      const ranges = matchRanges(text, re).reverse();
      for (const r of ranges) {
        const cur = text.slice(r.start, r.end);
        const rep = o.regex ? replaceInString(cur, re, replacement, true).text : replacement;
        replaceRange(p, r.start, r.end, rep);
        n++; touched = true;
      }
    }
    if (touched) book.touchHF(relId);
  }
  return n;
}

/** Ganti satu hasil header/footer (hasil dari `findInHeaderFooter`). */
export function replaceInHeaderFooterAt(book: DocxBook, hit: HfHit, o: SearchLike, replacement: string): number {
  const { re } = compileFind(o);
  if (!re) return 0;
  const cur = flatText(hit.p).slice(hit.start, hit.end);
  replaceRange(hit.p, hit.start, hit.end, o.regex ? replaceInString(cur, re, replacement, true).text : replacement);
  book.touchHF(hit.relId);
  return 1;
}

// ───────── catatan kaki/akhir & komentar ─────────
// Bagian-bagian ini punya relasi dokumen seperti header/footer, jadi memakai mekanisme yang sama (`book.hf` / `touchHF`):
// ikut riwayat undo dan ditulis ulang saat simpan.

export type SidePart = "footnotes" | "endnotes" | "comments";
export interface SideHit { relId: string; p: XEl; start: number; end: number; text: string; before: string; after: string; part: SidePart; id: string; author?: string }

const SIDE_ITEM: Record<SidePart, string> = { footnotes: "footnote", endnotes: "endnote", comments: "comment" };
const SIDE_REF: Record<SidePart, string> = { footnotes: "footnoteReference", endnotes: "endnoteReference", comments: "commentReference" };

/** Pasangan (part, relId) sesuai jenis `notes` / `comment`. */
export function sideParts(book: DocxBook, kind: "notes" | "comment"): { part: SidePart; relId: string }[] {
  const parts: SidePart[] = kind === "notes" ? ["footnotes", "endnotes"] : ["comments"];
  const out: { part: SidePart; relId: string }[] = [];
  for (const part of parts) { const relId = book.sideRelId(part); if (relId) out.push({ part, relId }); }
  return out;
}

function sideItems(book: DocxBook, part: SidePart, relId: string): { id: string; author?: string; paras: XEl[] }[] {
  const root = book.hf(relId);
  if (!root) return [];
  const out: { id: string; author?: string; paras: XEl[] }[] = [];
  for (const n of els(root, SIDE_ITEM[part])) {
    const type = attr(n, "type");
    if (type === "separator" || type === "continuationSeparator" || type === "continuationNotice") continue;
    out.push({ id: attr(n, "id") ?? "", author: attr(n, "author"), paras: hfParagraphs(n) });
  }
  return out;
}

export function findInSideParts(book: DocxBook, kind: "notes" | "comment", o: SearchLike, limit = 2000): SideHit[] {
  const { re } = compileFind(o);
  if (!re) return [];
  const hits: SideHit[] = [];
  for (const { part, relId } of sideParts(book, kind)) {
    for (const item of sideItems(book, part, relId)) {
      for (const p of item.paras) {
        const text = flatText(p);
        if (!text) continue;
        for (const m of matchRanges(text, re)) {
          hits.push({ relId, p, start: m.start, end: m.end, text: text.slice(m.start, m.end), ...snippet(text, m.start, m.end), part, id: item.id, author: item.author });
          if (hits.length >= limit) return hits;
        }
      }
    }
  }
  return hits;
}

export function replaceInSideParts(book: DocxBook, kind: "notes" | "comment", o: SearchLike, replacement: string): number {
  const { re } = compileFind(o);
  if (!re) return 0;
  let n = 0;
  for (const { part, relId } of sideParts(book, kind)) {
    let touched = false;
    for (const item of sideItems(book, part, relId)) for (const p of item.paras) {
      const text = flatText(p);
      for (const r of matchRanges(text, re).reverse()) {
        const cur = text.slice(r.start, r.end);
        replaceRange(p, r.start, r.end, o.regex ? replaceInString(cur, re, replacement, true).text : replacement);
        n++; touched = true;
      }
    }
    if (touched) book.touchHF(relId);
  }
  return n;
}

export function replaceInSideHitAt(book: DocxBook, hit: SideHit, o: SearchLike, replacement: string): number {
  const { re } = compileFind(o);
  if (!re) return 0;
  const cur = flatText(hit.p).slice(hit.start, hit.end);
  replaceRange(hit.p, hit.start, hit.end, o.regex ? replaceInString(cur, re, replacement, true).text : replacement);
  book.touchHF(hit.relId);
  return 1;
}

/** Nomor paragraf (1-based) di body yang memuat penanda rujukan catatan/komentar `id`; undefined bila tak ditemukan. */
export function sideRefParagraph(book: DocxBook, part: SidePart, id: string): number | undefined {
  let i = 0;
  for (const { p } of book.paragraphs()) {
    i++;
    if (descendAll(p, SIDE_REF[part]).some(r => attr(r, "id") === id)) return i;
  }
  return undefined;
}

// ───────── hyperlink ─────────

export interface DocxLink { id: string; el: XEl; p: XEl; parent: XEl; url: string; text: string; tooltip?: string; para: number }

function linkUrl(book: DocxBook, h: XEl): string {
  const rid = attr(h, "id");
  const anchor = attr(h, "anchor");
  if (rid) { const t = book.rel(rid)?.target ?? ""; return anchor ? `${t}#${anchor}` : t; }
  return anchor ? `#${anchor}` : "";
}

export function listLinks(book: DocxBook): DocxLink[] {
  const out: DocxLink[] = [];
  let pi = 0;
  for (const { p } of book.paragraphs()) {
    pi++;
    let n = 0;
    for (const h of descendAll(p, "hyperlink")) {
      const parent = findParent(p, h) ?? p;
      out.push({ id: `${pi}:${n++}`, el: h, p, parent, url: linkUrl(book, h), text: descendAll(h, "t").map(t => textOf(t)).join(""), tooltip: attr(h, "tooltip"), para: pi });
    }
  }
  return out;
}
function findParent(root: XEl, node: XEl): XEl | undefined {
  for (const c of root.children) {
    if (c === node) return root;
    if (isEl(c)) { const r = findParent(c, node); if (r) return r; }
  }
  return undefined;
}

export function toLinkItem(l: DocxLink): LinkItem {
  return {
    id: l.id, url: l.url, text: l.text, tooltip: l.tooltip, kind: classifyLink(l.url), location: `¶${l.para}`,
    target: { kind: "paragraph", index: l.para },
  };
}

/** Ubah target satu hyperlink. URL eksternal memakai relasi baru (relasi lama mungkin dipakai tautan lain). */
export function setLinkTarget(book: DocxBook, h: XEl, url: string, tooltip?: string) {
  const strip = (name: string) => { h.attrs = h.attrs.filter(a => a.name.local !== name); };
  if (url.startsWith("#")) {
    strip("id");
    setAttr(h, "anchor", url.slice(1));
  } else {
    strip("anchor");
    const rid = book.linkRel(url);
    if (rid) setAttr(h, "id", rid, NS.r, "r");
  }
  if (tooltip !== undefined) { strip("tooltip"); if (tooltip) setAttr(h, "tooltip", tooltip); }
}

export function removeLink(book: DocxBook, l: DocxLink): void {
  const us = units(l.p).filter(u => u.container === l.el);
  if (us.length) unlinkRange(book, l.p, us[0].start, us[us.length - 1].end);
  else {
    const i = l.parent.children.indexOf(l.el);
    if (i >= 0) l.parent.children.splice(i, 1, ...l.el.children);
  }
}

export function replaceLinkUrls(book: DocxBook, o: SearchLike, replacement: string): number {
  const { re } = compileFind(o);
  if (!re) return 0;
  let n = 0;
  for (const l of listLinks(book)) {
    const r = replaceInString(l.url, re, replacement, !!o.regex);
    if (r.count && r.text !== l.url && r.text.trim()) { setLinkTarget(book, l.el, r.text); n++; }
  }
  return n;
}

// ───────── nilai: font / warna / isi ─────────

const FONT_ATTRS = ["ascii", "hAnsi", "eastAsia", "cs"] as const;

/** Ganti nama font persis (tanpa beda huruf) pada format run (dan font default paragraf). Mengembalikan jumlah elemen yang berubah. */
export function replaceFonts(book: DocxBook, from: string, to: string): number {
  let n = 0;
  for (const rf of descendAll(book.body, "rFonts")) {
    let hit = false;
    for (const a of rf.attrs) if ((FONT_ATTRS as readonly string[]).includes(a.name.local) && sameFont(a.value, from)) { a.value = to; hit = true; }
    if (hit) n++;
  }
  return n;
}
export function findFonts(book: DocxBook, name: string): number {
  let n = 0;
  for (const rf of descendAll(book.body, "rFonts")) if (rf.attrs.some(a => (FONT_ATTRS as readonly string[]).includes(a.name.local) && sameFont(a.value, name))) n++;
  return n;
}

/** Pasangan (anak bernama `child`, pemilik) di bawah salah satu elemen `owners` di seluruh body. */
function collectProps(book: DocxBook, owners: string[], child: string): [XEl, XEl][] {
  const out: [XEl, XEl][] = [];
  const walk = (e: XEl) => {
    for (const c of e.children) {
      if (!isEl(c)) continue;
      if (owners.includes(e.name.local) && c.name.local === child && c.name.uri === NS.w) out.push([c, e]);
      walk(c);
    }
  };
  walk(book.body);
  return out;
}
const colorEls = (book: DocxBook) => collectProps(book, ["rPr"], "color");

/** Ganti warna teks persis; `to` kosong = hapus warna (kembali ke warna style). */
export function replaceTextColors(book: DocxBook, from: string, to: string): number {
  let n = 0;
  const target = normHex(to);
  for (const [c, owner] of colorEls(book)) {
    if (!sameColor(attr(c, "val"), from)) continue;
    if (!to) { owner.children = owner.children.filter(k => k !== c); n++; }
    else if (target) { setAttr(c, "val", target); n++; }
  }
  return n;
}
export function findTextColors(book: DocxBook, hex: string): number { return colorEls(book).filter(([c]) => sameColor(attr(c, "val"), hex)).length; }

/** Ganti warna isi (shading paragraf/sel/run) persis. `to` kosong = hapus shading. */
export function replaceFills(book: DocxBook, from: string, to: string): number {
  let n = 0;
  const target = normHex(to);
  for (const [shd, owner] of collectProps(book, ["pPr", "tcPr", "rPr"], "shd")) {
    if (!sameColor(attr(shd, "fill"), from)) continue;
    if (!to) { owner.children = owner.children.filter(k => k !== shd); n++; }
    else if (target) { setAttr(shd, "fill", target); n++; }
  }
  return n;
}
export function findFills(book: DocxBook, hex: string): number { return descendAll(book.body, "shd").filter(s => sameColor(attr(s, "fill"), hex)).length; }

// ───────── ringkasan jenis ─────────

export const DOCX_REPLACE_KINDS: readonly ReplaceKind[] = ["text", "headerFooter", "notes", "comment", "link", "font", "color", "fill"];

/** Pembantu: apakah paragraf punya teks tampil (untuk lokasi). */
export function paraLabel(p: XEl): string { return flatText(p).replace(/[￼\f\n\t]/g, " ").trim().slice(0, 40); }

export { els, first, val };
