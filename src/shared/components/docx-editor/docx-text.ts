/**
 * Operasi teks murni di atas pohon XML paragraf (tanpa DOM): pemetaan "unit" karakter, sisip/hapus rentang,
 * pecah run, pecah/gabung paragraf, dan penerapan properti run/paragraf dengan urutan skema yang benar.
 *
 * Satu "unit" = satu elemen konten run. Teks `<w:t>` bernilai panjang string-nya; tab/br/gambar/simbol bernilai 1 karakter
 * (U+0009, U+000A, U+FFFC, …). Urutan ini harus identik dengan teks DOM hasil `docx-render` (lihat `domFlat` di docx-view).
 */
import { NS, attr, cloneEl, ensureProps, first, insertAfter, is, isEl, isText, mk, mkText, num, onOff, pruneProps, removeKids, removeNode, setAttr, setChild, shallowClone, textOf, val, type XEl, type XNode } from "./docx-xml";
import { bulletChar } from "./docx-numbering";

export type UnitKind = "t" | "tab" | "br" | "pb" | "obj" | "sym" | "hyph" | "shy" | "ref" | "math";
export interface Unit {
  kind: UnitKind;
  run: XEl;
  piece: XEl;
  text: string;
  start: number;
  end: number;
  container: XEl;
}

export const OBJ = "￼";
const WRAPPERS = new Set(["hyperlink", "ins", "smartTag", "fldSimple", "customXml", "dir", "bdo", "moveTo"]);
const SKIP_PIECES = new Set(["rPr", "fldChar", "instrText", "delText", "delInstrText", "commentReference", "annotationRef", "lastRenderedPageBreak", "footnoteRef", "endnoteRef", "separator", "continuationSeparator", "pgNum", "yearShort", "yearLong", "monthShort", "monthLong", "dayShort", "dayLong"]);

function pieceUnit(c: XEl): { kind: UnitKind; text: string } | undefined {
  const l = c.name.local;
  if (SKIP_PIECES.has(l)) return undefined;
  switch (l) {
    case "t": return { kind: "t", text: textOf(c) };
    case "tab": case "ptab": return { kind: "tab", text: "\t" };
    case "br": { const t = attr(c, "type"); return t === "page" || t === "column" ? { kind: "pb", text: "\f" } : { kind: "br", text: "\n" }; }
    case "cr": return { kind: "br", text: "\n" };
    case "noBreakHyphen": return { kind: "hyph", text: "‑" };
    case "softHyphen": return { kind: "shy", text: "­" };
    case "sym": {
      const code = parseInt(attr(c, "char") ?? "", 16);
      const ch = Number.isFinite(code) ? String.fromCodePoint(code) : "?";
      return { kind: "sym", text: bulletChar(ch, attr(c, "font")) };
    }
    case "footnoteReference": case "endnoteReference": return { kind: "ref", text: OBJ };
    case "drawing": case "pict": case "object": case "AlternateContent": case "ole": return { kind: "obj", text: OBJ };
    default: return undefined;
  }
}

/** Unit konten milik satu run. */
export function runPieces(run: XEl): { piece: XEl; kind: UnitKind; text: string }[] {
  const out: { piece: XEl; kind: UnitKind; text: string }[] = [];
  for (const c of run.children) {
    if (!isEl(c)) continue;
    const u = pieceUnit(c);
    if (u) out.push({ piece: c, ...u });
  }
  return out;
}

export function units(p: XEl): Unit[] {
  const out: Unit[] = [];
  let pos = 0;
  const walk = (container: XEl) => {
    for (const c of container.children) {
      if (!isEl(c)) continue;
      const l = c.name.local;
      if (l === "r") {
        for (const pc of runPieces(c)) {
          out.push({ kind: pc.kind, run: c, piece: pc.piece, text: pc.text, start: pos, end: pos + pc.text.length, container });
          pos += pc.text.length;
        }
      } else if (WRAPPERS.has(l)) walk(c);
      else if (l === "sdt") { const sc = first(c, "sdtContent"); if (sc) walk(sc); }
      else if (l === "oMath" || l === "oMathPara") {
        out.push({ kind: "math", run: c, piece: c, text: OBJ, start: pos, end: pos + 1, container });
        pos += 1;
      }
    }
  };
  walk(p);
  return out;
}

export function flatText(p: XEl): string { return units(p).map(u => u.text).join(""); }
export const flatLength = (p: XEl) => { const u = units(p); return u.length ? u[u.length - 1].end : 0; };
/** Teks tampil untuk ekspor/pencarian: gambar/objek menjadi kosong, tab tetap tab, `br` menjadi newline. */
export function plainText(p: XEl): string { return units(p).map(u => (u.kind === "obj" || u.kind === "ref" || u.kind === "math" ? "" : u.kind === "pb" ? "\n" : u.text)).join(""); }

// ───────── elemen & properti run ─────────

const preserveIfNeeded = (el: XEl, s: string) => {
  const need = /^\s|\s$|\s\s|[\t\n]/.test(s);
  setAttr(el, "space", need ? "preserve" : undefined, NS.xml, "xml");
  el.xmlSpace = need ? "preserve" : "default";
};
export function setPieceText(piece: XEl, s: string) {
  piece.children = s === "" ? [] : [{ kind: "text", value: s }];
  piece.selfClosing = s === "";
  preserveIfNeeded(piece, s);
}
export function makePieces(text: string): XEl[] {
  const out: XEl[] = [];
  let buf = "";
  const flush = () => { if (buf) { out.push(mkText("t", buf)); buf = ""; } };
  for (const ch of text) {
    if (ch === "\t") { flush(); out.push(mk("tab")); }
    else if (ch === "\n") { flush(); out.push(mk("br")); }
    else if (ch === "\r") continue;
    else buf += ch;
  }
  flush();
  return out;
}

export function newRun(rPr?: XEl, pieces: XEl[] = []): XEl {
  const r = mk("r", undefined, []);
  if (rPr && rPr.children.length) r.children.push(cloneEl(rPr));
  for (const p of pieces) r.children.push(p);
  r.selfClosing = r.children.length === 0;
  return r;
}
export const runProps = (run: XEl): XEl | undefined => first(run, "rPr");
/** rPr "tanda paragraf" (pPr/rPr) — dipakai untuk paragraf kosong. */
export const markProps = (p: XEl): XEl | undefined => first(first(p, "pPr"), "rPr");

function runIsEmpty(run: XEl): boolean { return !run.children.some(c => isEl(c) && c.name.local !== "rPr"); }

/** Pecah run sebelum `piece`; bagian setelahnya menjadi run baru (rPr dan atribut disalin). Mengembalikan run baru. */
export function splitRunBefore(run: XEl, piece: XEl, container: XEl): XEl {
  const idx = run.children.indexOf(piece);
  const tail = run.children.splice(idx);
  const nr = shallowClone(run);
  const rp = first(run, "rPr");
  nr.children = rp ? [cloneEl(rp), ...tail] : tail;
  nr.selfClosing = false;
  run.selfClosing = run.children.length === 0;
  insertAfter(container, run, nr);
  return nr;
}

/** Pastikan ada batas run pada offset `off` (membelah teks `<w:t>` bila perlu). */
export function splitAt(p: XEl, off: number) {
  const us = units(p);
  if (us.length === 0 || off <= 0 || off >= us[us.length - 1].end) return;
  for (let i = 0; i < us.length; i++) {
    const u = us[i];
    if (u.start < off && off < u.end && u.kind === "t") {
      const left = u.text.slice(0, off - u.start);
      const right = u.text.slice(off - u.start);
      const np = mkText("t", right);
      setPieceText(u.piece, left);
      const idx = u.run.children.indexOf(u.piece);
      u.run.children.splice(idx + 1, 0, np);
      splitRunBefore(u.run, np, u.container);
      return;
    }
    if (u.start === off) {
      const prev = us[i - 1];
      if (prev && prev.run === u.run) splitRunBefore(u.run, u.piece, u.container);
      return;
    }
  }
}

export interface RunSpan { run: XEl; start: number; end: number; container: XEl }
/** Run yang sepenuhnya berada di [a,b) setelah pemecahan batas. */
export function runsInRange(p: XEl, a: number, b: number): RunSpan[] {
  if (b <= a) return [];
  splitAt(p, a); splitAt(p, b);
  const map = new Map<XEl, RunSpan>();
  for (const u of units(p)) {
    if (u.end <= a || u.start >= b) continue;
    const s = map.get(u.run);
    if (s) s.end = u.end; else map.set(u.run, { run: u.run, start: u.start, end: u.end, container: u.container });
  }
  return [...map.values()];
}

// ───────── sisip / hapus ─────────

function removeRunIfEmpty(run: XEl, container: XEl) { if (runIsEmpty(run)) removeNode(container, run); }

export function deleteRange(p: XEl, a: number, b: number) {
  if (b <= a) return;
  const us = units(p);
  for (let i = us.length - 1; i >= 0; i--) {
    const u = us[i];
    if (u.end <= a || u.start >= b) continue;
    if (u.kind === "math") { removeNode(u.container, u.run); continue; }
    if (u.kind === "t") {
      const s = Math.max(a, u.start) - u.start;
      const e = Math.min(b, u.end) - u.start;
      const nt = u.text.slice(0, s) + u.text.slice(e);
      if (nt === "") { removeNode(u.run, u.piece); removeRunIfEmpty(u.run, u.container); } else setPieceText(u.piece, nt);
    } else {
      removeNode(u.run, u.piece);
      removeRunIfEmpty(u.run, u.container);
    }
  }
}

/** Letakkan `node` (run) pada offset `off` di paragraf. */
export function insertRunAt(p: XEl, off: number, run: XEl, srcRun?: XEl) {
  splitAt(p, off);
  const us = units(p);
  const next = us.find(u => u.start >= off && u.end > u.start);
  const prev = [...us].reverse().find(u => u.end <= off && u.end > u.start);
  if (next && next.start === off) {
    const c = next.container;
    // jangan masukkan run ke dalam run lain
    c.children.splice(c.children.indexOf(next.run), 0, run);
    c.selfClosing = false;
  } else if (prev) {
    insertAfter(prev.container, prev.run, run);
  } else {
    const pPrIdx = p.children.findIndex(c => isEl(c) && c.name.local === "pPr");
    p.children.splice(pPrIdx + 1, 0, run);
    p.selfClosing = false;
  }
  void srcRun;
}

/** Sisipkan teks (dengan \t dan \n) pada offset `a`. `srcRun` = run sumber format (mis. dari DOM). */
export function insertText(p: XEl, a: number, text: string, srcRun?: XEl, opts?: { rPr?: XEl }): XEl | undefined {
  if (!text) return undefined;
  const us = units(p);
  const prev = [...us].reverse().find(u => u.end === a && u.end > u.start);
  const next = us.find(u => u.start === a && u.end > u.start);
  const plain = !/[\t\n\r]/.test(text);

  let host: XEl | undefined;
  if (srcRun && (srcRun === prev?.run || srcRun === next?.run)) host = srcRun;
  else if (!srcRun) host = prev?.run ?? next?.run;

  if (host) {
    if (prev && host === prev.run) {
      if (plain && prev.kind === "t") { setPieceText(prev.piece, prev.text + text); return host; }
      const idx = host.children.indexOf(prev.piece) + 1;
      host.children.splice(idx, 0, ...makePieces(text));
      return host;
    }
    if (next && host === next.run) {
      if (plain && next.kind === "t") { setPieceText(next.piece, text + next.text); return host; }
      const idx = host.children.indexOf(next.piece);
      host.children.splice(idx, 0, ...makePieces(text));
      return host;
    }
  }
  // run baru
  const base = srcRun ? runProps(srcRun) : opts?.rPr ?? (prev ? runProps(prev.run) : next ? runProps(next.run) : undefined) ?? markProps(p) ?? lastRunProps(p);
  const nr = newRun(base, makePieces(text));
  insertRunAt(p, a, nr);
  return nr;
}
function lastRunProps(p: XEl): XEl | undefined {
  for (let i = p.children.length - 1; i >= 0; i--) { const c = p.children[i]; if (isEl(c) && c.name.local === "r") { const r = runProps(c); if (r) return r; } }
  return undefined;
}

export function replaceRange(p: XEl, a: number, b: number, text: string, srcRun?: XEl): XEl | undefined {
  // pada penggantian ambil format dari run di awal rentang
  let src = srcRun;
  if (!src && b > a) { const u = units(p).find(x => x.end > a && x.start < b); src = u?.run; }
  const srcProps = src ? runProps(src) : undefined;
  deleteRange(p, a, b);
  const host = src && units(p).some(u => u.run === src) ? src : undefined;
  return insertText(p, a, text, host, host ? undefined : { rPr: srcProps });
}

/** Normalisasi: gabungkan run bersebelahan dengan rPr identik (hanya t/tab/br) dan buang run kosong. */
export function normalize(p: XEl) {
  const walk = (container: XEl) => {
    for (let i = 0; i < container.children.length; i++) {
      const c = container.children[i];
      if (!isEl(c)) continue;
      if (WRAPPERS.has(c.name.local)) { walk(c); continue; }
      if (c.name.local !== "r") continue;
      if (runIsEmpty(c) && !c.children.length) { container.children.splice(i--, 1); continue; }
      const nx = container.children[i + 1];
      if (isEl(nx) && nx.name.local === "r" && mergeable(c) && mergeable(nx) && sameProps(c, nx)) {
        for (const k of nx.children) if (isEl(k) && k.name.local !== "rPr") c.children.push(k);
        // gabung <w:t> berurutan
        for (let j = c.children.length - 1; j > 0; j--) {
          const a2 = c.children[j - 1]; const b2 = c.children[j];
          if (isEl(a2) && isEl(b2) && a2.name.local === "t" && b2.name.local === "t") { setPieceText(a2, textOf(a2) + textOf(b2)); c.children.splice(j, 1); }
        }
        container.children.splice(i + 1, 1);
        i--;
      }
    }
  };
  walk(p);
}
function mergeable(r: XEl): boolean {
  return r.children.every(c => !isEl(c) || c.name.local === "rPr" || c.name.local === "t" || c.name.local === "tab" || (c.name.local === "br" && !attr(c, "type")));
}
function sameProps(a: XEl, b: XEl): boolean {
  const ra = runProps(a), rb = runProps(b);
  const sa = ra ? JSON.stringify(strip(ra)) : "";
  const sb = rb ? JSON.stringify(strip(rb)) : "";
  return sa === sb;
}
const strip = (e: XEl): unknown => ({ n: e.name.local, a: e.attrs.map(x => [x.name.local, x.value]), c: e.children.filter(isEl).map(strip) });

// ───────── paragraf ─────────

export const isParagraph = (n: XNode | undefined): n is XEl => is(n, "p", NS.w);

export function pProps(p: XEl, create = false): XEl | undefined { return create ? ensureProps(p, "pPr") : first(p, "pPr"); }

function pathTo(container: XEl, target: XEl): { container: XEl; child: XNode }[] | undefined {
  for (const c of container.children) {
    if (c === target) return [{ container, child: c }];
    if (isEl(c) && (WRAPPERS.has(c.name.local) || c.name.local === "sdt" || c.name.local === "sdtContent")) {
      const sub = pathTo(c, target);
      if (sub) return [{ container, child: c }, ...sub];
    }
  }
  return undefined;
}

/** Lepas `run` beserta semua node setelahnya (termasuk di dalam wrapper hyperlink/sdt) dari paragraf; wrapper dikloning. */
function detachTail(p: XEl, run: XEl): XNode[] {
  const path = pathTo(p, run);
  if (!path) return [];
  let carry: XNode[] = [];
  for (let k = path.length - 1; k >= 0; k--) {
    const { container, child } = path[k];
    const idx = container.children.indexOf(child);
    if (k === path.length - 1) { carry = container.children.splice(idx); continue; }
    const after = container.children.splice(idx + 1);
    const w = child as XEl;
    const clone = shallowClone(w);
    const extra = w.name.local === "sdt" ? w.children.filter(c => isEl(c) && c.name.local !== "sdtContent").map(c => cloneEl(c)) : [];
    clone.children = [...extra, ...carry];
    clone.selfClosing = false;
    if (!w.children.some(c => isEl(c) && !(w.name.local === "sdt" && c.name.local === "sdtPr"))) removeNode(container, w);
    carry = [clone, ...after];
  }
  return carry;
}

/**
 * Pecah paragraf pada offset `off`. Paragraf baru disisipkan setelah `p` pada `parent`.
 * Properti paragraf disalin; `sectPr` (akhir section) berpindah ke paragraf kedua.
 */
export function splitParagraph(parent: XEl, p: XEl, off: number, opts?: { nextStyle?: string }): XEl {
  splitAt(p, off);
  const us = units(p);
  const next = us.find(u => u.start >= off && u.end > u.start);
  const atEnd = !next;
  const tail = next ? detachTail(p, next.run) : [];
  const np = shallowClone(p);
  np.attrs = np.attrs.filter(a => a.name.local !== "paraId" && a.name.local !== "textId");
  const kids: XNode[] = [];
  const pPr = first(p, "pPr");
  if (pPr) {
    const c = cloneEl(pPr);
    removeKids(pPr, "sectPr"); // akhir section ikut paragraf kedua (salinan c)
    if (atEnd) {
      const lr = lastRunProps(p);
      if (lr && !first(c, "rPr")) setChild(c, cloneEl(lr));
    }
    kids.push(c);
  } else if (atEnd) {
    const lr = lastRunProps(p);
    if (lr) kids.push(mk("pPr", undefined, [mk("rPr", undefined, cloneEl(lr).children)]));
  }
  np.children = [...kids, ...tail];
  np.selfClosing = false;
  if (atEnd && opts?.nextStyle) setChild(ensureProps(np, "pPr"), mk("pStyle", { val: opts.nextStyle }));
  parent.children.splice(parent.children.indexOf(p) + 1, 0, np);
  return np;
}

/** Gabungkan isi `p2` ke akhir `p1` lalu hapus `p2`. */
export function mergeParagraphs(parent: XEl, p1: XEl, p2: XEl) {
  const kids = p2.children.filter(c => !(isEl(c) && c.name.local === "pPr"));
  // pPr/sectPr dari p2 harus tetap ada bila p2 mengakhiri section
  const sect = first(first(p2, "pPr"), "sectPr");
  const empty1 = flatLength(p1) === 0;
  p1.children.push(...kids);
  p1.selfClosing = false;
  if (sect) { const pp = ensureProps(p1, "pPr"); setChild(pp, cloneEl(sect)); }
  if (empty1 && flatLength(p2) > 0) { /* pertahankan pPr p1 */ }
  removeNode(parent, p2);
  normalize(p1);
}

// ───────── penerapan properti ─────────

export type RunPatch = Partial<{
  b: boolean | null; i: boolean | null; strike: boolean | null; caps: boolean | null; smallCaps: boolean | null; vanish: boolean | null;
  u: string | null; color: string | null; highlight: string | null; sz: number | null; font: string | null;
  vert: "superscript" | "subscript" | "baseline" | null; spacing: number | null; rStyle: string | null; shd: string | null;
}>;

const toggleEl = (rPr: XEl, local: string, v: boolean | null | undefined) => {
  if (v === undefined) return;
  if (v === null) setChild(rPr, null, local);
  else setChild(rPr, mk(local, v ? undefined : { val: "0" }));
};

export function applyRunPatch(run: XEl, patch: RunPatch) {
  const rPr = ensureProps(run, "rPr");
  toggleEl(rPr, "b", patch.b); if (patch.b !== undefined) toggleEl(rPr, "bCs", patch.b);
  toggleEl(rPr, "i", patch.i); if (patch.i !== undefined) toggleEl(rPr, "iCs", patch.i);
  toggleEl(rPr, "strike", patch.strike); toggleEl(rPr, "caps", patch.caps); toggleEl(rPr, "smallCaps", patch.smallCaps); toggleEl(rPr, "vanish", patch.vanish);
  if (patch.u !== undefined) setChild(rPr, patch.u === null ? null : mk("u", { val: patch.u }), "u");
  if (patch.color !== undefined) setChild(rPr, patch.color === null ? null : mk("color", { val: patch.color.replace("#", "").toUpperCase() }), "color");
  if (patch.highlight !== undefined) { removeKids(rPr, "shd"); setChild(rPr, patch.highlight === null ? null : mk("highlight", { val: patch.highlight }), "highlight"); }
  if (patch.shd !== undefined) setChild(rPr, patch.shd === null ? null : mk("shd", { val: "clear", color: "auto", fill: patch.shd.replace("#", "").toUpperCase() }), "shd");
  if (patch.sz !== undefined) { if (patch.sz === null) { setChild(rPr, null, "sz"); setChild(rPr, null, "szCs"); } else { setChild(rPr, mk("sz", { val: Math.round(patch.sz) })); setChild(rPr, mk("szCs", { val: Math.round(patch.sz) })); } }
  if (patch.font !== undefined) {
    if (patch.font === null) setChild(rPr, null, "rFonts");
    else setChild(rPr, mk("rFonts", { ascii: patch.font, hAnsi: patch.font, eastAsia: patch.font, cs: patch.font }));
  }
  if (patch.vert !== undefined) setChild(rPr, patch.vert === null ? null : mk("vertAlign", { val: patch.vert }), "vertAlign");
  if (patch.spacing !== undefined) setChild(rPr, patch.spacing === null ? null : mk("spacing", { val: Math.round(patch.spacing) }), "spacing");
  if (patch.rStyle !== undefined) setChild(rPr, patch.rStyle === null ? null : mk("rStyle", { val: patch.rStyle }), "rStyle");
  pruneProps(run, "rPr");
}

/** Terapkan patch ke tanda paragraf (pPr/rPr) agar paragraf kosong mewarisi format. */
export function applyMarkPatch(p: XEl, patch: RunPatch) {
  const pPr = ensureProps(p, "pPr");
  const holder = mk("r", undefined, [first(pPr, "rPr") ?? mk("rPr")]);
  applyRunPatch(holder, patch);
  const rp = first(holder, "rPr");
  setChild(pPr, rp ?? null, "rPr");
}

export function clearRunFormat(run: XEl) { removeKids(run, "rPr"); }

// ───────── properti paragraf ─────────

export type PPatch = Partial<{
  style: string | null; jc: string | null;
  indLeft: number | null; indRight: number | null; indFirst: number | null; indHanging: number | null;
  before: number | null; after: number | null; line: number | null; lineRule: "auto" | "exact" | "atLeast";
  keepNext: boolean | null; keepLines: boolean | null; pageBreakBefore: boolean | null;
  shd: string | null; num: { numId: number; ilvl: number } | null; outline: number | null;
  borders: { top?: string; left?: string; bottom?: string; right?: string } | null;
}>;

export function applyParaPatch(p: XEl, patch: PPatch) {
  const pPr = ensureProps(p, "pPr");
  if (patch.style !== undefined) setChild(pPr, patch.style === null ? null : mk("pStyle", { val: patch.style }), "pStyle");
  if (patch.jc !== undefined) setChild(pPr, patch.jc === null ? null : mk("jc", { val: patch.jc }), "jc");
  for (const k of ["keepNext", "keepLines", "pageBreakBefore"] as const) {
    const v = patch[k];
    if (v !== undefined) setChild(pPr, v === null ? null : v ? mk(k) : mk(k, { val: "0" }), k);
  }
  if ("indLeft" in patch || "indRight" in patch || "indFirst" in patch || "indHanging" in patch) {
    const old = first(pPr, "ind");
    const get = (n: string) => attr(old, n);
    const ind = mk("ind");
    const set = (n: string, v: number | null | undefined, old2: string | undefined) => {
      const nv = v === undefined ? old2 : v === null ? undefined : String(Math.round(v));
      if (nv !== undefined) ind.attrs.push({ name: { uri: NS.w, local: n, prefix: "w" }, value: nv, isNamespaceDecl: false });
    };
    set("left", patch.indLeft, get("left") ?? get("start"));
    set("right", patch.indRight, get("right") ?? get("end"));
    // firstLine & hanging saling meniadakan
    if (patch.indHanging != null) set("hanging", patch.indHanging, undefined);
    else if (patch.indFirst != null) set("firstLine", patch.indFirst, undefined);
    else if (!("indFirst" in patch) && !("indHanging" in patch)) { set("firstLine", undefined, get("firstLine")); set("hanging", undefined, get("hanging")); }
    setChild(pPr, ind.attrs.length ? ind : null, "ind");
  }
  if ("before" in patch || "after" in patch || "line" in patch || "lineRule" in patch) {
    const old = first(pPr, "spacing");
    const sp = mk("spacing");
    const put = (n: string, v: number | string | null | undefined, o: string | undefined) => {
      const nv = v === undefined ? o : v === null ? undefined : String(Math.round(Number(v)));
      if (nv !== undefined) sp.attrs.push({ name: { uri: NS.w, local: n, prefix: "w" }, value: nv, isNamespaceDecl: false });
    };
    put("before", patch.before, attr(old, "before"));
    put("after", patch.after, attr(old, "after"));
    put("line", patch.line, attr(old, "line"));
    const lr = patch.lineRule ?? attr(old, "lineRule");
    if (lr && patch.line !== null) sp.attrs.push({ name: { uri: NS.w, local: "lineRule", prefix: "w" }, value: lr, isNamespaceDecl: false });
    setChild(pPr, sp.attrs.length ? sp : null, "spacing");
  }
  if (patch.shd !== undefined) setChild(pPr, patch.shd === null ? null : mk("shd", { val: "clear", color: "auto", fill: patch.shd.replace("#", "").toUpperCase() }), "shd");
  if (patch.num !== undefined) setChild(pPr, patch.num === null ? null : mk("numPr", undefined, [mk("ilvl", { val: patch.num.ilvl }), mk("numId", { val: patch.num.numId })]), "numPr");
  if (patch.outline !== undefined) setChild(pPr, patch.outline === null ? null : mk("outlineLvl", { val: patch.outline }), "outlineLvl");
  if (patch.borders !== undefined) {
    if (patch.borders === null) setChild(pPr, null, "pBdr");
    else {
      const bd = mk("pBdr");
      for (const side of ["top", "left", "bottom", "right"] as const) {
        const v = patch.borders[side];
        if (v) bd.children.push(mk(side, { val: "single", sz: 6, space: 1, color: v.replace("#", "") }));
      }
      bd.selfClosing = bd.children.length === 0;
      setChild(pPr, bd.children.length ? bd : null, "pBdr");
    }
  }
  pruneProps(p, "pPr");
}

export function paragraphStyleId(p: XEl): string | undefined { return val(first(p, "pPr"), "pStyle"); }
export function paragraphNum(p: XEl): { numId: number; ilvl: number } | undefined {
  const np = first(first(p, "pPr"), "numPr");
  if (!np) return undefined;
  const n = num(val(np, "numId"));
  return n === undefined ? undefined : { numId: n, ilvl: num(val(np, "ilvl")) ?? 0 };
}

export function paragraphSectPr(p: XEl): XEl | undefined { return first(first(p, "pPr"), "sectPr"); }

export { isText, onOff };
