/**
 * Operasi penyuntingan tingkat tinggi (tautan, gambar, daftar, indentasi, format painter, revisi, tempel teks, hapus lintas paragraf).
 * Semuanya bekerja pada pohon XML; pembaruan DOM dilakukan oleh controller.
 */
import { attr, cloneEl, els, first, insertAfter, isEl, mk, removeNode, setChild, val, type XEl, type XNode } from "./docx-xml";
import {
  applyParaPatch, applyRunPatch, deleteRange, flatLength, flatText, insertRunAt, insertText, markProps, mergeParagraphs, newRun, normalize, paragraphNum, runProps, runsInRange, splitParagraph, units,
  type PPatch, type RunPatch, type Unit,
} from "./docx-text";
import { createTable } from "./docx-table";
import { readP, readR, type PProps, type RProps } from "./docx-style";
import type { DocxBook } from "./docx-model";

// ───────── hyperlink ─────────

export function linkAt(p: XEl, off: number): XEl | undefined {
  const us = units(p);
  const u = us.find(x => x.start < off && off <= x.end) ?? us.find(x => x.start === off && x.end > x.start);
  return u && u.container.name.local === "hyperlink" ? u.container : undefined;
}

function unwrap(parent: XEl, wrapper: XEl) {
  const i = parent.children.indexOf(wrapper);
  if (i < 0) return;
  parent.children.splice(i, 1, ...wrapper.children);
}

/** Lepas semua hyperlink yang beririsan dengan [a,b) (a==b → tautan di posisi itu). */
export function unlinkRange(book: DocxBook | undefined, p: XEl, a: number, b: number): number {
  let n = 0;
  const us = units(p);
  const links = new Set<XEl>();
  for (const u of us) {
    if (u.container.name.local !== "hyperlink") continue;
    const hit = a === b ? u.start < a && a <= u.end : u.end > a && u.start < b;
    if (hit) links.add(u.container);
  }
  for (const l of links) {
    for (const r of els(l, "r")) {
      const rp = first(r, "rPr");
      if (rp && val(rp, "rStyle") === "Hyperlink") applyRunPatch(r, { rStyle: null });
    }
    unwrap(p, l); n++;
  }
  void book;
  return n;
}

export function wrapRunsInLink(book: DocxBook, p: XEl, a: number, b: number, url: string, tooltip?: string): XEl | undefined {
  if (b <= a) return undefined;
  unlinkRange(book, p, a, b);
  const spans = runsInRange(p, a, b).filter(s => s.container === p);
  if (!spans.length) return undefined;
  const rid = url.startsWith("#") ? undefined : book.linkRel(url);
  const link = url.startsWith("#") ? mk("hyperlink", { anchor: url.slice(1), history: 1, tooltip }) : mk("hyperlink", { "r:id": rid, history: 1, tooltip });
  const i0 = p.children.indexOf(spans[0].run);
  const i1 = p.children.indexOf(spans[spans.length - 1].run);
  const moved = p.children.splice(i0, i1 - i0 + 1);
  link.children = moved; link.selfClosing = false;
  p.children.splice(i0, 0, link);
  for (const s of spans) {
    if (book.styles.has("Hyperlink")) applyRunPatch(s.run, { rStyle: "Hyperlink" });
    else applyRunPatch(s.run, { color: "0563C1", u: "single" });
  }
  return link;
}

// ───────── sisip ─────────

export function insertPageBreak(p: XEl, off: number) {
  const run = mk("r", undefined, [mk("br", { type: "page" })]);
  insertRunAt(p, off, run);
}
export function insertLineBreak(p: XEl, off: number) {
  const src = units(p).find(u => u.end === off && u.end > u.start)?.run;
  insertRunAt(p, off, newRun(src ? runProps(src) : undefined, [mk("br")]));
}

export function insertImageAt(book: DocxBook, p: XEl, off: number, bytes: Uint8Array, wPx: number, hPx: number, name?: string, contentType?: string): XEl {
  const drawing = book.createImageDrawing(bytes, Math.round(wPx * 9525), Math.round(hPx * 9525), { name: name ?? "Picture", contentType });
  const run = mk("r", undefined, [mk("rPr", undefined, [mk("noProof")]), drawing]);
  insertRunAt(p, off, run);
  return drawing;
}

export function insertParagraphAfter(parent: XEl, ref: XEl, text = ""): XEl {
  const p = mk("p");
  parent.children.splice(parent.children.indexOf(ref) + 1, 0, p);
  if (text) insertText(p, 0, text);
  return p;
}

export function insertTableAfter(book: DocxBook, parent: XEl, ref: XEl, rows: number, cols: number, widthTwips: number, header = true): XEl {
  const tbl = createTable({ rows, cols, widthTwips, header, borders: true });
  const refHasText = ref.name.local === "p" && flatLength(ref) > 0;
  const idx = parent.children.indexOf(ref);
  parent.children.splice(idx + 1, 0, tbl);
  // tabel harus diikuti paragraf (syarat OOXML untuk akhir body / sel)
  const next = parent.children[idx + 2];
  if (!isEl(next) || next.name.local === "tbl") parent.children.splice(idx + 2, 0, mk("p"));
  void book; void refHasText;
  return tbl;
}

export function deleteBlock(parent: XEl, el: XEl): XEl | undefined {
  const i = parent.children.indexOf(el);
  if (i < 0) return undefined;
  parent.children.splice(i, 1);
  if (parent.name.local === "tc" && !parent.children.some(c => isEl(c) && (c.name.local === "p" || c.name.local === "tbl"))) parent.children.push(mk("p"));
  if (parent.name.local === "tc" && isEl(parent.children[parent.children.length - 1]) && (parent.children[parent.children.length - 1] as XEl).name.local === "tbl") parent.children.push(mk("p"));
  return parent.children.filter(isEl).find((_, k) => k >= Math.max(0, i - 1)) as XEl | undefined;
}

/** Tempel teks polos: baris baru → paragraf baru. Mengembalikan posisi caret akhir. */
export function insertPlainText(parent: XEl, p: XEl, off: number, text: string): { p: XEl; off: number } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length === 1) { insertText(p, off, lines[0]); return { p, off: off + lines[0].length }; }
  const tail = splitParagraph(parent, p, off);
  insertText(p, off, lines[0]);
  let prev = p;
  for (let i = 1; i < lines.length - 1; i++) {
    const np = mk("p");
    const pPr = first(p, "pPr");
    if (pPr) { const c = cloneEl(pPr); setChild(c, null, "sectPr"); np.children.push(c); }
    parent.children.splice(parent.children.indexOf(prev) + 1, 0, np);
    insertText(np, 0, lines[i]);
    prev = np;
  }
  const last = lines[lines.length - 1];
  insertText(tail, 0, last);
  return { p: tail, off: last.length };
}

/** Hapus dari (p1,o1) sampai (p2,o2). Mengembalikan paragraf tempat caret berada. */
export function deleteSpan(book: DocxBook, p1: XEl, o1: number, p2: XEl, o2: number): XEl {
  if (p1 === p2) { deleteRange(p1, o1, o2); return p1; }
  const par1 = book.parentOf(p1), par2 = book.parentOf(p2);
  deleteRange(p1, o1, flatLength(p1));
  deleteRange(p2, 0, o2);
  if (par1 && par1 === par2) {
    const i1 = par1.children.indexOf(p1), i2 = par1.children.indexOf(p2);
    if (i1 >= 0 && i2 > i1) par1.children.splice(i1 + 1, i2 - i1 - 1);
    mergeParagraphs(par1, p1, p2);
  }
  return p1;
}

// ───────── daftar & indentasi ─────────

export function isBulletList(book: DocxBook, p: XEl): boolean | undefined {
  const base = book.styles.paraBase(val(first(p, "pPr"), "pStyle"));
  const direct = readP(first(p, "pPr"), book.styles.theme);
  const numId = direct.numId ?? base.p.numId;
  if (!numId) return undefined;
  const lvl = book.numbering.lvl(numId, direct.ilvl ?? base.p.ilvl ?? 0);
  return lvl ? lvl.fmt === "bullet" : undefined;
}

export function toggleList(book: DocxBook, ps: XEl[], kind: "bullet" | "number"): boolean {
  const all = ps.every(p => { const b = isBulletList(book, p); return b !== undefined && (kind === "bullet" ? b : !b); });
  if (all) {
    for (const p of ps) {
      const fromStyle = book.styles.paraBase(val(first(p, "pPr"), "pStyle")).p.numId;
      applyParaPatch(p, { num: fromStyle ? { numId: 0, ilvl: 0 } : null });
    }
    return false;
  }
  const numId = book.ensureList(kind);
  for (const p of ps) {
    const cur = paragraphNum(p);
    applyParaPatch(p, { num: { numId, ilvl: cur?.ilvl ?? 0 } });
    if (book.styles.has("ListParagraph") && !val(first(p, "pPr"), "pStyle")) applyParaPatch(p, { style: "ListParagraph" });
  }
  return true;
}

export function changeIndent(book: DocxBook, ps: XEl[], deltaTwips: number) {
  for (const p of ps) {
    const num = paragraphNum(p);
    const direct = readP(first(p, "pPr"), book.styles.theme);
    const base = book.styles.paraBase(val(first(p, "pPr"), "pStyle")).p;
    const inList = (direct.numId ?? base.numId ?? 0) > 0;
    if (inList && (num || base.numId)) {
      const il = Math.max(0, Math.min(8, (direct.ilvl ?? base.ilvl ?? 0) + (deltaTwips > 0 ? 1 : -1)));
      applyParaPatch(p, { num: { numId: direct.numId ?? base.numId!, ilvl: il } });
    } else {
      const cur = direct.indLeft ?? base.indLeft ?? 0;
      applyParaPatch(p, { indLeft: Math.max(0, cur + deltaTwips) });
    }
  }
}

// ───────── format ─────────

export function clearFormatRange(p: XEl, a: number, b: number) {
  for (const s of runsInRange(p, a, b)) removeNode(s.run, first(s.run, "rPr")!);
  normalize(p);
}

export function transformText(p: XEl, a: number, b: number, fn: (s: string) => string) {
  runsInRange(p, a, b);
  for (const u of units(p)) {
    if (u.kind !== "t" || u.end <= a || u.start >= b) continue;
    const s = Math.max(a, u.start) - u.start, e = Math.min(b, u.end) - u.start;
    const nt = u.text.slice(0, s) + fn(u.text.slice(s, e)) + u.text.slice(e);
    u.piece.children = [{ kind: "text", value: nt }];
  }
}

export interface FormatClip {
  rPr?: XEl;
  pPr?: XEl;
  desc: { char: [string, string][]; para: [string, string][] };
}

/** Salin format karakter (run di posisi) + paragraf. */
export function captureFormat(book: DocxBook, p: XEl, off: number, forward = false): FormatClip {
  const us = units(p);
  // seleksi: format karakter pertama yang terpilih; caret: format karakter sebelum caret
  const u = (forward ? us.find(x => x.start <= off && off < x.end) : undefined) ?? us.find(x => x.start < off && off <= x.end) ?? us.find(x => x.start >= off && x.end > x.start) ?? us[us.length - 1];
  const rPr = u ? runProps(u.run) : markProps(p);
  const pPr = first(p, "pPr");
  const theme = book.styles.theme;
  const sid = val(pPr, "pStyle");
  const base = book.styles.paraBase(sid);
  const r: RProps = { ...base.r, ...(rPr ? readR(rPr, theme) : {}) };
  if (u) { const rs = val(rPr, "rStyle"); if (rs) Object.assign(r, readR(rPr, theme), book.styles.charLayer(rs)); }
  const pr: PProps = { ...base.p, ...readP(pPr, theme) };
  const char: [string, string][] = [];
  const f = r.fAscii ?? r.fHAnsi; if (f) char.push(["font", f]);
  if (r.sz) char.push(["size", `${r.sz / 2} pt`]);
  if (r.b) char.push(["bold", "✓"]); if (r.i) char.push(["italic", "✓"]);
  if (r.u && r.u !== "none") char.push(["underline", r.u]); if (r.strike) char.push(["strike", "✓"]);
  if (r.color && r.color !== "auto") char.push(["color", `#${r.color}`]);
  if (r.highlight) char.push(["highlight", r.highlight]);
  if (r.vert && r.vert !== "baseline") char.push(["vert", r.vert]);
  if (r.caps) char.push(["caps", "✓"]); if (r.smallCaps) char.push(["smallCaps", "✓"]);
  const para: [string, string][] = [];
  para.push(["style", book.styles.name(base.styleId) ?? "Normal"]);
  if (pr.jc) para.push(["align", pr.jc]);
  if (pr.indLeft) para.push(["indLeft", `${Math.round((pr.indLeft / 1440) * 254) / 100} cm`]);
  if (pr.before !== undefined || pr.after !== undefined) para.push(["spacing", `${(pr.before ?? 0) / 20}/${(pr.after ?? 0) / 20} pt`]);
  if (pr.line) para.push(["line", pr.lineRule && pr.lineRule !== "auto" ? `${pr.line / 20} pt` : `${Math.round((pr.line / 240) * 100) / 100}×`]);
  if (pr.numId) para.push(["list", "✓"]);
  if (pr.shd?.fill) para.push(["shading", `#${pr.shd.fill}`]);
  const pp = pPr ? cloneEl(pPr) : undefined;
  if (pp) { setChild(pp, null, "sectPr"); setChild(pp, null, "numPr"); setChild(pp, null, "rPr"); }
  return { rPr: rPr ? cloneEl(rPr) : undefined, pPr: pp, desc: { char, para } };
}

export function applyFormat(book: DocxBook, targets: { p: XEl; a: number; b: number; whole?: boolean }[], clip: FormatClip, opts: { char: boolean; para: boolean }) {
  void book;
  for (const t of targets) {
    if (opts.char) {
      const a = t.whole ? 0 : t.a, b = t.whole ? flatLength(t.p) : t.b;
      if (b > a) {
        for (const s of runsInRange(t.p, a, b)) {
          removeNode(s.run, first(s.run, "rPr")!);
          if (clip.rPr) { const c = cloneEl(clip.rPr); s.run.children.unshift(c); s.run.selfClosing = false; }
        }
        normalize(t.p);
      } else if (clip.rPr) {
        // paragraf kosong: simpan di tanda paragraf
        const pPr = first(t.p, "pPr") ?? mk("pPr");
        if (!first(t.p, "pPr")) t.p.children.unshift(pPr);
        setChild(pPr, cloneEl(clip.rPr), "rPr");
      }
    }
    if (opts.para) {
      const old = first(t.p, "pPr");
      const keepNum = old ? first(old, "numPr") : undefined;
      const keepSect = old ? first(old, "sectPr") : undefined;
      const keepMark = old ? first(old, "rPr") : undefined;
      removeNode(t.p, old!);
      if (clip.pPr) {
        const c = cloneEl(clip.pPr);
        if (keepNum) setChild(c, cloneEl(keepNum));
        if (keepMark) setChild(c, cloneEl(keepMark));
        if (keepSect) setChild(c, cloneEl(keepSect));
        t.p.children.unshift(c); t.p.selfClosing = false;
      } else if (keepNum || keepSect) {
        const c = mk("pPr");
        if (keepNum) setChild(c, cloneEl(keepNum)); if (keepSect) setChild(c, cloneEl(keepSect));
        t.p.children.unshift(c); t.p.selfClosing = false;
      }
    }
  }
}

export { applyParaPatch, applyRunPatch };
export type { PPatch, RunPatch, Unit };

// ───────── revisi ─────────

/** Terima/tolak semua revisi (ins/del/move + *PrChange). Mengembalikan jumlah revisi yang diselesaikan. */
export function resolveRevisions(root: XEl, mode: "accept" | "reject"): number {
  let n = 0;
  const walk = (parent: XEl) => {
    for (let i = 0; i < parent.children.length; i++) {
      const c = parent.children[i];
      if (!isEl(c)) continue;
      const l = c.name.local;
      const keep = mode === "accept" ? (l === "ins" || l === "moveTo") : (l === "del" || l === "moveFrom");
      const drop = mode === "accept" ? (l === "del" || l === "moveFrom") : (l === "ins" || l === "moveTo");
      if (/Change$/.test(l) && /^(rPr|pPr|tblPr|trPr|tcPr|sectPr|tblGrid|numPr)Change$/.test(l)) { parent.children.splice(i--, 1); n++; continue; }
      if (drop) { parent.children.splice(i--, 1); n++; continue; }
      if (keep) {
        if (mode === "reject") for (const t of descendDel(c)) { t.name = { ...t.name, local: t.name.local === "delInstrText" ? "instrText" : "t" }; }
        parent.children.splice(i, 1, ...c.children);
        n++; i--;
        continue;
      }
      walk(c);
    }
  };
  walk(root);
  return n;
}
function descendDel(e: XEl, out: XEl[] = []): XEl[] {
  for (const c of e.children) if (isEl(c)) { if (c.name.local === "delText" || c.name.local === "delInstrText") out.push(c); else descendDel(c, out); }
  return out;
}

export { flatText, insertAfter, attr };
export type { XNode };

// ───────── salin / tempel internal (format dipertahankan) ─────────

/** Salinan paragraf (klon) yang dipangkas ke rentang pilihan. Blok di antara ikut diklon. */
export function extractFragment(book: DocxBook, p1: XEl, o1: number, p2: XEl, o2: number): XEl[] {
  const trim = (c: XEl, a: number, b: number) => { deleteRange(c, b, flatLength(c)); deleteRange(c, 0, a); return c; };
  if (p1 === p2) return [trim(cloneEl(p1), o1, o2)];
  const par = book.parentOf(p1);
  const out: XEl[] = [];
  if (par && par === book.parentOf(p2)) {
    const kids = par.children.filter(isEl);
    const i1 = kids.indexOf(p1), i2 = kids.indexOf(p2);
    for (let i = i1; i <= i2; i++) {
      const k = kids[i];
      if (k === p1) out.push(trim(cloneEl(k), o1, flatLength(k)));
      else if (k === p2) out.push(trim(cloneEl(k), 0, o2));
      else out.push(cloneEl(k));
    }
  } else {
    out.push(trim(cloneEl(p1), o1, flatLength(p1)), trim(cloneEl(p2), 0, o2));
  }
  return out;
}

/** Tempel fragmen pada (p, off). Mengembalikan posisi caret akhir. */
export function pasteFragment(parent: XEl, p: XEl, off: number, frag: XEl[]): { p: XEl; off: number } {
  const body = (c: XEl) => c.children.filter(k => !(isEl(k) && k.name.local === "pPr"));
  const insertNodes = (target: XEl, at: number, nodes: XNode[]) => {
    let pos = at;
    for (const n of nodes) {
      if (!isEl(n)) continue;
      const tmp = mk("p", undefined, [n]);
      const len = flatLength(tmp);
      insertRunAt(target, pos, n);
      pos += len;
    }
    return pos;
  };
  if (frag.length === 1 || frag.every(f => f.name.local !== "p")) {
    const f = frag[0];
    if (!f || f.name.local !== "p") return { p, off };
    return { p, off: insertNodes(p, off, body(f)) };
  }
  const tail = splitParagraph(parent, p, off);
  const first0 = frag[0];
  if (first0.name.local === "p") insertNodes(p, off, body(first0));
  let prev: XEl = p;
  for (let i = 1; i < frag.length - 1; i++) {
    const c = cloneEl(frag[i]);
    parent.children.splice(parent.children.indexOf(prev) + 1, 0, c);
    prev = c;
  }
  const last = frag[frag.length - 1];
  let endOff = 0;
  if (last.name.local === "p") endOff = insertNodes(tail, 0, body(last));
  else parent.children.splice(parent.children.indexOf(prev) + 1, 0, cloneEl(last));
  return { p: tail, off: endOff };
}
