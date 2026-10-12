/**
 * Daftar isi (Table of Contents) DOCX: deteksi field `TOC` yang sudah ada, bangun ulang entri dari judul (heading)
 * lengkap dengan bookmark `_Toc…`, hyperlink internal, field `PAGEREF`, dan nomor halaman — struktur yang sama dengan
 * yang ditulis Word sehingga dapat diperbarui lagi di Word.
 *
 * Struktur hasil (dibungkus SDT "Table of Contents" saat disisipkan):
 *   [judul]  ¶ TOC1: {begin}{instr TOC \o "1-3" \h \z \u}{separate} <hyperlink anchor=_Toc…>teks ⇥ {PAGEREF _Toc… \h → n}</hyperlink>
 *            ¶ TOC2: <hyperlink …/>
 *            ¶ {end}
 */
import { attr, descendAll, els, first, isEl, mk, mkText, num, removeNode, setAttr, textOf, val, NS, type XEl, type XNode } from "./docx-xml";
import { flatText } from "./docx-text";
import type { DocxBook } from "./docx-model";

export type TocLeader = "dot" | "hyphen" | "underscore" | "none";

export interface TocOptions {
  /** Level judul terkecil / terbesar yang disertakan (1–9). */
  from: number;
  to: number;
  /** Entri berupa hyperlink internal (`\h`). */
  hyperlinks: boolean;
  /** Tampilkan nomor halaman (kebalikan dari `\n`). */
  pageNumbers: boolean;
  /** Nomor halaman rata kanan dengan tab stop. */
  rightAlign: boolean;
  leader: TocLeader;
  /** Judul di atas daftar isi; null = tanpa judul. */
  title: string | null;
}

export const DEFAULT_TOC: TocOptions = { from: 1, to: 3, hyperlinks: true, pageNumbers: true, rightAlign: true, leader: "dot", title: "Table of Contents" };

export interface TocHeading { p: XEl; level: number; text: string }

export interface TocField {
  /** Indeks urut dalam dokumen. */
  index: number;
  /** Paragraf pertama s.d. terakhir milik field (inklusif). */
  paras: XEl[];
  /** Wadah paragraf (body atau `sdtContent`). */
  container: XEl;
  /** SDT pembungkus (galeri "Table of Contents") bila ada. */
  sdt?: XEl;
  instr: string;
  options: TocOptions;
  /** Jumlah entri (paragraf berhyperlink/bergaya TOCn). */
  entries: number;
}

const TOC_STYLES: { id: string; name: string; level: number }[] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => ({ id: `TOC${n}`, name: `toc ${n}`, level: n }));

/** Opsi dari instruksi field: `TOC \o "1-3" \h \z \u \n`. */
export function parseTocInstr(instr: string): Partial<TocOptions> {
  const o: Partial<TocOptions> = {};
  const m = /\\o\s+"(\d+)\s*-\s*(\d+)"/i.exec(instr);
  if (m) { o.from = Math.max(1, Math.min(9, +m[1])); o.to = Math.max(o.from, Math.min(9, +m[2])); }
  o.hyperlinks = /\\h\b/i.test(instr);
  if (/\\n\b/i.test(instr)) o.pageNumbers = false;
  return o;
}
export function buildTocInstr(o: TocOptions): string {
  return ` TOC \\o "${o.from}-${o.to}" ${o.hyperlinks ? "\\h " : ""}\\z \\u${o.pageNumbers ? "" : " \\n"} `;
}

type FldEvent = { t: "begin" | "separate" | "end" } | { t: "instr"; text: string };

function fieldEvents(p: XEl): FldEvent[] {
  const out: FldEvent[] = [];
  const walk = (e: XEl) => {
    for (const c of e.children) {
      if (!isEl(c)) continue;
      if (c.name.local === "fldChar") { const t = attr(c, "fldCharType"); if (t === "begin" || t === "separate" || t === "end") out.push({ t }); }
      else if (c.name.local === "instrText") out.push({ t: "instr", text: textOf(c) });
      else if (c.name.local !== "drawing" && c.name.local !== "pict") walk(c);
    }
  };
  walk(p);
  return out;
}

/** Semua field TOC kompleks pada dokumen, dalam urutan dokumen. */
export function findTocs(book: DocxBook): TocField[] {
  const all = [...book.paragraphs()];
  const found: TocField[] = [];
  const stack: { instr: string; start: number; sep: boolean }[] = [];
  all.forEach(({ p }, i) => {
    for (const ev of fieldEvents(p)) {
      if (ev.t === "begin") stack.push({ instr: "", start: i, sep: false });
      else if (ev.t === "instr") { const top = stack[stack.length - 1]; if (top && !top.sep) top.instr += ev.text; }
      else if (ev.t === "separate") { const top = stack[stack.length - 1]; if (top) top.sep = true; }
      else if (ev.t === "end") {
        const f = stack.pop();
        if (f && !stack.length && /^\s*TOC\b/i.test(f.instr)) {
          const paras = all.slice(f.start, i + 1).map(x => x.p);
          const container = all[f.start].parent;
          const holder = book.parentOf(container);
          const sdt = holder && holder.name.local === "sdt" ? holder : undefined;
          const entries = paras.filter(q => { const sid = val(first(q, "pPr"), "pStyle"); return /^TOC\d$/i.test(sid ?? "") || !!first(q, "hyperlink"); }).length;
          found.push({ index: found.length, paras, container, sdt, instr: f.instr.trim(), options: { ...DEFAULT_TOC, ...parseTocInstr(f.instr), title: null }, entries });
        }
      }
    }
  });
  return found;
}

const run = (children: XNode[]) => mk("r", undefined, children);
const fld = (t: "begin" | "separate" | "end") => run([mk("fldChar", { fldCharType: t })]);
const instrRun = (s: string) => run([mkText("instrText", s)]);

function makeEntry(book: DocxBook, h: TocHeading, bm: string, page: number | string | undefined, o: TocOptions, tabPos: number, firstEntry: boolean, instr: string): XEl {
  const pPrKids: XNode[] = [];
  if (book.styles.has(`TOC${h.level}`)) pPrKids.push(mk("pStyle", { val: `TOC${h.level}` }));
  if (o.pageNumbers && o.rightAlign) pPrKids.push(mk("tabs", undefined, [mk("tab", { val: "right", ...(o.leader !== "none" ? { leader: o.leader } : {}), pos: tabPos })]));
  pPrKids.push(mk("spacing", { after: 100 }));
  pPrKids.push(mk("ind", { left: (h.level - 1) * 240 }));
  const kids: XNode[] = [mk("pPr", undefined, pPrKids)];
  if (firstEntry) kids.push(fld("begin"), instrRun(instr), fld("separate"));
  const inner: XNode[] = [run([mkText("t", h.text)])];
  if (o.pageNumbers) {
    inner.push(run([mk("tab")]));
    if (o.hyperlinks) inner.push(fld("begin"), instrRun(` PAGEREF ${bm} \\h `), fld("separate"));
    inner.push(run([mkText("t", page === undefined ? "" : String(page))]));
    if (o.hyperlinks) inner.push(fld("end"));
  }
  if (o.hyperlinks) kids.push(mk("hyperlink", { anchor: bm, history: 1 }, inner));
  else kids.push(...inner);
  return mk("p", undefined, kids);
}

/** Pastikan judul punya bookmark `_Toc…`; kembalikan nama bookmark. */
export function ensureTocBookmark(book: DocxBook, p: XEl, seed: number): string {
  for (const bs of els(p, "bookmarkStart")) { const n = attr(bs, "name"); if (n && /^_Toc/i.test(n)) return n; }
  let maxId = 0;
  for (const b of descendAll(book.body, "bookmarkStart")) maxId = Math.max(maxId, num(attr(b, "id")) ?? 0);
  const name = `_Toc${String(100000000 + seed * 7 + (maxId % 1000)).slice(-9)}${seed}`;
  const id = maxId + 1;
  const start = mk("bookmarkStart", { id, name }), end = mk("bookmarkEnd", { id });
  const at = first(p, "pPr") ? 1 : 0;
  p.children.splice(at, 0, start);
  p.children.push(end);
  p.selfClosing = false;
  return name;
}

export function headingText(p: XEl): string { return flatText(p).replace(/[￼\f\n\t]/g, " ").replace(/\s+/g, " ").trim(); }

/** Judul yang masuk daftar isi (tidak termasuk paragraf di dalam field TOC itu sendiri). */
export function tocHeadings(book: DocxBook, outline: { p: XEl; level: number; text: string }[], o: TocOptions, skip: Set<XEl>): TocHeading[] {
  void book;
  return outline.filter(h => h.level >= o.from && h.level <= o.to && !skip.has(h.p)).map(h => ({ p: h.p, level: h.level, text: headingText(h.p) })).filter(h => h.text);
}

/** Pastikan style TOC1–3 / TOCHeading ada (nama bawaan Word). Mengembalikan true bila ada yang ditambahkan. */
export function ensureTocStyles(book: DocxBook, addStyle: (o: { type: "paragraph"; styleId: string; name: string; basedOn?: string; next?: string; uiPriority?: number; bold?: boolean; fontSizeHalfPoints?: number; color?: string }) => void): boolean {
  let added = false;
  for (const s of TOC_STYLES.slice(0, 3)) {
    if (!book.styles.has(s.id)) { addStyle({ type: "paragraph", styleId: s.id, name: s.name, basedOn: book.styles.defaultPara, next: book.styles.defaultPara, uiPriority: 39 }); added = true; }
  }
  if (!book.styles.has("TOCHeading")) { addStyle({ type: "paragraph", styleId: "TOCHeading", name: "TOC Heading", basedOn: book.styles.defaultPara, next: book.styles.defaultPara, uiPriority: 39, bold: true, fontSizeHalfPoints: 32, color: "2F5496" }); added = true; }
  return added;
}

export interface BuildTocArgs {
  book: DocxBook;
  headings: TocHeading[];
  options: TocOptions;
  pageOf: (p: XEl) => number | string | undefined;
  /** Lebar area konten (twip) untuk posisi tab nomor halaman. */
  contentTw: number;
  emptyText: string;
}

/** Paragraf entri daftar isi (field TOC dimulai di paragraf pertama dan ditutup di paragraf kosong terakhir). */
export function buildTocParagraphs(a: BuildTocArgs): XEl[] {
  const { book, headings, options: o } = a;
  const instr = buildTocInstr(o);
  const paras: XEl[] = [];
  headings.forEach((h, i) => {
    const bm = ensureTocBookmark(book, h.p, i + 1);
    paras.push(makeEntry(book, h, bm, a.pageOf(h.p), o, a.contentTw, i === 0, instr));
  });
  if (!paras.length) {
    paras.push(mk("p", undefined, [fld("begin"), instrRun(instr), fld("separate"), run([mkText("t", a.emptyText)])]));
  }
  paras.push(mk("p", undefined, [fld("end")]));
  return paras;
}

/** Judul daftar isi (paragraf bergaya TOCHeading, dengan format langsung agar tampil sama tanpa style). */
export function buildTocTitle(book: DocxBook, text: string): XEl {
  const pPr: XNode[] = [];
  if (book.styles.has("TOCHeading")) pPr.push(mk("pStyle", { val: "TOCHeading" }));
  pPr.push(mk("spacing", { before: 240, after: 120 }));
  return mk("p", undefined, [mk("pPr", undefined, pPr), run([mk("rPr", undefined, [mk("b"), mk("color", { val: "2F5496" }), mk("sz", { val: 32 })]), mkText("t", text)])]);
}

/** Bungkus SDT galeri "Table of Contents" (dikenali Word sebagai daftar isi bawaan). */
export function wrapTocSdt(children: XEl[]): XEl {
  const sdtPr = mk("sdtPr", undefined, [mk("docPartObj", undefined, [mk("docPartGallery", { val: "Table of Contents" }), mk("docPartUnique")])]);
  return mk("sdt", undefined, [sdtPr, mk("sdtContent", undefined, children)]);
}

export function isTocSdt(sdt: XEl): boolean {
  const g = descendAll(first(sdt, "sdtPr"), "docPartGallery")[0];
  return !!g && /table of contents/i.test(attr(g, "val") ?? "");
}

function parentIn(root: XEl, node: XEl): XEl | undefined {
  for (const c of root.children) {
    if (c === node) return root;
    if (isEl(c)) { const r = parentIn(c, node); if (r) return r; }
  }
  return undefined;
}

/** Hapus field TOC dari dokumen (beserta SDT pembungkus dan judulnya). Bookmark `_Toc…` pada judul dibiarkan. */
export function removeTocField(book: DocxBook, f: TocField): void {
  if (f.sdt && isTocSdt(f.sdt)) {
    const parent = parentIn(book.body, f.sdt);
    if (parent) { removeNode(parent, f.sdt); return; }
  }
  for (const p of f.paras) removeNode(f.container, p);
}
