/** Pencarian teks: biasa, kata utuh, dan ekspresi regular — dengan jumlah hit dan lokasi (tabel/baris/kolom/paragraf). */
import { els, type XEl } from "./docx-xml";
import { flatText, replaceRange } from "./docx-text";
import type { DocxBook } from "./docx-model";

export interface SearchOpts {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  /** Flag regex tambahan (mis. "s" agar . cocok newline). Hanya untuk mode regex. */
  flags?: string;
}
export interface Where { kind: "body" | "table"; para: number; table?: number; row?: number; col?: number; depth: number }
export interface Hit {
  index: number;
  p: XEl;
  start: number;
  end: number;
  text: string;
  before: string;
  after: string;
  groups: string[];
  where: Where;
}
export interface SearchResult { hits: Hit[]; error?: string; truncated: boolean; paragraphs: number }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function compileQuery(o: SearchOpts): { re: RegExp | null; error?: string } {
  if (!o.query) return { re: null };
  try {
    let src = o.regex ? o.query : escapeRe(o.query);
    if (o.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
    let flags = "gu" + (o.caseSensitive ? "" : "i");
    if (o.regex && o.flags) for (const f of o.flags) if (!flags.includes(f) && "msy".includes(f)) flags += f;
    return { re: new RegExp(src, flags) };
  } catch (e) {
    return { re: null, error: e instanceof Error ? e.message : String(e) };
  }
}

const clean = (s: string) => s.replace(/[￼\f]/g, "·").replace(/\n/g, "↵").replace(/\t/g, "→");

export function whereOf(book: DocxBook, p: XEl, paraIdx: number, tableIndex: Map<XEl, number>): Where {
  let depth = 0;
  let w: Where = { kind: "body", para: paraIdx, depth: 0 };
  let par = book.parentOf(p);
  while (par) {
    if (par.name.local === "tc") {
      const tr = book.parentOf(par);
      const tbl = tr ? book.parentOf(tr) : undefined;
      if (tr && tbl) {
        depth++;
        const row = els(tbl, "tr").indexOf(tr) + 1;
        const col = els(tr, "tc").indexOf(par) + 1;
        // lokasi yang dilaporkan = tabel terluar
        w = { kind: "table", para: paraIdx, table: (tableIndex.get(tbl) ?? 0) + 1, row, col, depth };
        par = book.parentOf(tbl);
        continue;
      }
    }
    par = book.parentOf(par);
  }
  return w;
}

export function findAll(book: DocxBook, o: SearchOpts, limit = 5000): SearchResult {
  const { re, error } = compileQuery(o);
  if (!re) return { hits: [], error, truncated: false, paragraphs: 0 };
  const hits: Hit[] = [];
  const tIndex = new Map<XEl, number>();
  book.tables().forEach((t, i) => tIndex.set(t, i));
  let paraIdx = 0;
  let truncated = false;
  for (const { p } of book.paragraphs()) {
    paraIdx++;
    const text = flatText(p);
    if (!text) continue;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let where: Where | undefined;
    while ((m = re.exec(text))) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      where ??= whereOf(book, p, paraIdx, tIndex);
      const s = m.index, e = s + m[0].length;
      hits.push({ index: hits.length, p, start: s, end: e, text: clean(m[0]), before: clean(text.slice(Math.max(0, s - 28), s)), after: clean(text.slice(e, e + 28)), groups: m.slice(1).map(x => x ?? ""), where });
      if (hits.length >= limit) { truncated = true; break; }
    }
    if (truncated) break;
  }
  return { hits, error, truncated, paragraphs: paraIdx };
}

/** Ganti hit yang diberikan. Mengembalikan jumlah penggantian. */
export function replaceHits(hits: Hit[], o: SearchOpts, replacement: string): number {
  const { re } = compileQuery(o);
  if (!re) return 0;
  const single = new RegExp(re.source, re.flags.replace("g", ""));
  const byP = new Map<XEl, Hit[]>();
  for (const h of hits) { const a = byP.get(h.p) ?? []; a.push(h); byP.set(h.p, a); }
  let n = 0;
  for (const [p, hs] of byP) {
    const text = flatText(p);
    for (const h of [...hs].sort((a, b) => b.start - a.start)) {
      const cur = text.slice(h.start, h.end);
      const rep = o.regex ? cur.replace(single, replacement) : replacement;
      replaceRange(p, h.start, h.end, rep);
      n++;
    }
  }
  return n;
}
