/**
 * Renderer XML → DOM. Menerapkan style OOXML (docDefaults, style paragraf/karakter/tabel, numbering, tema) menjadi CSS inline.
 *
 * Konvensi DOM (dipakai docx-dom.ts untuk memetakan seleksi ke offset model):
 *  - node teks: panjang = panjang string;  `[data-skip]`: tidak dihitung;  `[data-u="n"]`: dihitung n karakter (gambar, objek, tab-break, …)
 *  - `<br>` tanpa `data-u` (placeholder paragraf kosong) tidak dihitung.
 */
import { attr, descend, descendAll, els, first, isEl, is, num, textOf, val, deepText, type XEl } from "./docx-xml";
import { REL, type DocxBook } from "./docx-model";
import {
  borderCss, cssDiff, emuPx, lineBaseFor, mergeP, mergeR, pCss, ptPx, rCss, readP, readR, readShd, readMar, readTableLook, resolveColor, twipPx,
  type Borders, type Css, type PProps, type RProps, type TCond,
} from "./docx-style";
import { buildGrid, gridWidths, type Grid } from "./docx-table";
import { drawingContent, readDrawing, type ImgInfo } from "./docx-image";
import { runPieces } from "./docx-text";

export interface RenderOpts {
  readonly: boolean;
  showMarks: boolean;
  showRevisions: boolean;
  /** Mode ekspor: semua tak-editable, gambar sebagai data URI. */
  forExport?: boolean;
}

export class Registry {
  elOf = new WeakMap<Node, XEl>();
  domOf = new WeakMap<XEl, HTMLElement>();
  set(dom: HTMLElement, el: XEl) { this.elOf.set(dom, el); this.domOf.set(el, dom); }
}

export interface FieldInfo { id: string; num: number; kind: "footnotes" | "endnotes" }

export interface RenderCtx {
  book: DocxBook;
  reg: Registry;
  opts: RenderOpts;
  doc: Document;
  contentW: number;
  editable: boolean;
  fnRefs: FieldInfo[];
  /** Nomor catatan kaki saat merender isi catatan. */
  noteNum?: number;
  /** Sumber relasi (part) untuk resolusi gambar/hyperlink — default dokumen utama. */
  source: string;
  badImages: Set<string>;
  onImageError?: (info: string) => void;
}

const px = (n: number) => `${Math.round(n * 100) / 100}px`;
function mkEl<K extends keyof HTMLElementTagNameMap>(ctx: RenderCtx, tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const e = ctx.doc.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
function setCss(e: HTMLElement, css: Css) { for (const k in css) e.style.setProperty(k, css[k]); }

// ───────── paragraf ─────────

interface ParaState {
  baseR: RProps;
  baseCss: Css;
  fields: { el: HTMLElement; instr: string; phase: "instr" | "result" }[];
  hasUnits: boolean;
  pageBreak: boolean;
  startsWithBreak: boolean;
  seenContent: boolean;
  tabStops: boolean;
}

export interface ParaResolved { p: PProps; r: RProps; baseCss: Css; sid: string | undefined; numLabel?: { text: string; bullet: boolean; fonts: RProps; suff: string; hanging: number; jc?: string } }

/** Hitung properti paragraf + label daftar (menaikkan penghitung numbering!). */
export function resolveParagraph(book: DocxBook, p: XEl, tcond?: TCond, advanceNumbering = true): ParaResolved {
  const st = book.styles;
  const pPr = first(p, "pPr");
  const sid = val(pPr, "pStyle");
  const base = st.paraBase(sid, tcond);
  const direct = readP(pPr, st.theme);
  let numId = direct.numId ?? base.p.numId;
  const ilvl = direct.ilvl ?? base.p.ilvl ?? 0;
  let pr = base.p;
  let numLabel: ParaResolved["numLabel"];
  if (numId !== undefined && numId > 0 && book.numbering.has(numId)) {
    const lvl = book.numbering.lvl(numId, ilvl);
    if (lvl) {
      pr = mergeP(pr, lvl.p);
      if (advanceNumbering) {
        const lab = book.numbering.next(numId, ilvl);
        if (lab) {
          const hanging = (mergeP(pr, direct).indHanging ?? 0);
          const mr: RProps = { ...lab.lvl.r };
          if (lab.bullet) { delete mr.fAscii; delete mr.fHAnsi; delete mr.fEa; delete mr.fCs; }
          numLabel = { text: lab.text, bullet: lab.bullet, fonts: mr, suff: lab.lvl.suff, hanging, jc: lab.lvl.jc };
        }
      }
    }
  } else numId = undefined;
  pr = mergeP(pr, direct);
  const r = base.r;
  return { p: pr, r, baseCss: rCss(r), sid: base.styleId, numLabel };
}

function paragraphHasUnits(p: XEl): boolean { return runsOf(p).some(r => runPieces(r).length > 0); }
function runsOf(p: XEl): XEl[] {
  const out: XEl[] = [];
  const walk = (e: XEl) => { for (const c of e.children) if (isEl(c)) { if (c.name.local === "r") out.push(c); else if (c.name.local !== "del" && c.name.local !== "pPr") walk(c); } };
  walk(p);
  return out;
}

/** Isi (ulang) elemen paragraf `div` dari XML `p`. */
export function fillParagraph(ctx: RenderCtx, div: HTMLElement, p: XEl, tcond?: TCond, region: "body" | "readonly" = "body") {
  const { book } = ctx;
  const res = resolveParagraph(book, p, tcond);
  const st: ParaState = { baseR: res.r, baseCss: res.baseCss, fields: [], hasUnits: false, pageBreak: false, startsWithBreak: false, seenContent: false, tabStops: !!res.p.tabs?.length };
  div.textContent = "";
  div.removeAttribute("style");
  div.className = "dx-p";
  for (const k of ["pbb", "pba", "kn", "kl", "lvl", "style", "sectEnd", "tabs"]) delete div.dataset[k];
  ctx.reg.set(div, p);
  const empty = !paragraphHasUnits(p);
  let css: Css = { ...res.baseCss, ...pCss(res.p, lineBaseFor(res.r.fAscii ?? res.r.fHAnsi)) };
  if (empty) {
    const mark = readR(first(first(p, "pPr"), "rPr"), book.styles.theme);
    if (Object.keys(mark).length) css = { ...css, ...rCss(mergeR(res.r, mark)) };
  }
  if (!res.p.jc && res.p.bidi) css["text-align"] = "right";
  setCss(div, css);
  if (res.p.pageBreakBefore) div.dataset.pbb = "1";
  if (res.p.keepNext) div.dataset.kn = "1";
  if (res.p.keepLines) div.dataset.kl = "1";
  const hd = book.styles.isHeading(res.sid);
  const ol = res.p.outline !== undefined ? res.p.outline + 1 : hd !== undefined ? hd : undefined;
  if (ol !== undefined && ol > 0) div.dataset.lvl = String(ol);
  else if (hd === 0) div.dataset.lvl = "0";
  if (res.sid) div.dataset.style = res.sid;
  const editable = ctx.editable && region === "body" && !ctx.opts.readonly && !ctx.opts.forExport;
  if (editable) { div.contentEditable = "true"; div.spellcheck = true; }
  else div.contentEditable = "false";
  if (st.tabStops) div.dataset.tabs = JSON.stringify(res.p.tabs!.map(t => ({ x: twipPx(t.pos), v: t.val, l: t.leader })));

  // penanda daftar
  if (res.numLabel) {
    const nl = res.numLabel;
    const mk = mkEl(ctx, "span", "dx-num");
    mk.contentEditable = "false";
    mk.dataset.skip = "1";
    mk.textContent = nl.text;
    const mcss = rCss(mergeR(res.r, nl.fonts));
    setCss(mk, cssDiff(mcss, res.baseCss));
    if (nl.suff === "tab") { mk.style.display = "inline-block"; mk.style.minWidth = px(twipPx(nl.hanging || 360)); mk.style.textIndent = "0"; }
    else if (nl.suff === "space") mk.textContent = nl.text + " ";
    if (nl.jc === "right") mk.style.textAlign = "right";
    div.appendChild(mk);
  }

  renderInlineChildren(ctx, p, div, st, p);
  for (const f of st.fields) f.el.dataset.open = "1";

  if (empty || (!div.hasChildNodes()) || (div.lastChild instanceof HTMLElement && div.lastChild.classList.contains("dx-num"))) {
    const br = mkEl(ctx, "br", "dx-pad"); br.dataset.skip = "1";
    div.appendChild(br);
  }
  if (st.pageBreak) {
    // jeda halaman di awal paragraf yang masih berisi → paragraf pindah ke halaman berikutnya; selain itu jeda terjadi sesudahnya
    if (st.startsWithBreak && st.seenContent) div.dataset.pbb = "1";
    else { div.dataset.pba = "1"; if (!st.seenContent) div.classList.add("dx-pbonly"); }
  }
  const sect = first(first(p, "pPr"), "sectPr");
  if (sect) div.dataset.sectEnd = "1";
  // tab default
  div.style.tabSize = px(twipPx(book.defaultTab()));
}

export function renderParagraph(ctx: RenderCtx, p: XEl, tcond?: TCond, region: "body" | "readonly" = "body"): HTMLElement {
  const div = mkEl(ctx, "div", "dx-p");
  fillParagraph(ctx, div, p, tcond, region);
  return div;
}

// ───────── inline ─────────

const WRAP = new Set(["smartTag", "customXml", "dir", "bdo", "moveTo"]);

function renderInlineChildren(ctx: RenderCtx, parent: XEl, out: Node, st: ParaState, para: XEl) {
  for (const c of parent.children) {
    if (!isEl(c)) continue;
    const l = c.name.local;
    const target = () => (st.fields.length && st.fields[st.fields.length - 1].phase === "result" ? st.fields[st.fields.length - 1].el : out);
    if (l === "pPr") continue;
    if (l === "r") renderRun(ctx, c, out, st, para);
    else if (l === "hyperlink") {
      const a = mkEl(ctx, "a", "dx-link");
      const rid = attr(c, "id");
      const anchor = attr(c, "anchor");
      let href = "#";
      if (rid) { const r = ctx.book.rel(rid, ctx.source); if (r) href = r.target; }
      else if (anchor) href = `#${anchor}`;
      if (anchor && rid) href += `#${anchor}`;
      a.setAttribute("href", href);
      a.dataset.href = href;
      a.title = (attr(c, "tooltip") ?? href) + " — Ctrl+klik";
      a.rel = "noopener noreferrer";
      a.draggable = false;
      target().appendChild(a);
      renderInlineChildren(ctx, c, a, st, para);
    } else if (l === "ins") {
      const s = mkEl(ctx, "span", ctx.opts.showRevisions ? "dx-ins" : "");
      const au = attr(c, "author"); if (au && ctx.opts.showRevisions) s.title = `${au} ${attr(c, "date") ?? ""}`;
      target().appendChild(s);
      renderInlineChildren(ctx, c, s, st, para);
    } else if (l === "del" || l === "moveFrom") {
      if (ctx.opts.showRevisions) {
        const s = mkEl(ctx, "span", "dx-del");
        s.dataset.skip = "1"; s.contentEditable = "false";
        const au = attr(c, "author"); if (au) s.title = `${au} ${attr(c, "date") ?? ""}`;
        s.textContent = deepText(c) + descendAll(c, "delText").map(t => textOf(t)).join("");
        target().appendChild(s);
      }
    } else if (l === "sdt") {
      const sc = first(c, "sdtContent");
      const pr = first(c, "sdtPr");
      const s = mkEl(ctx, "span", "dx-sdt");
      const alias = val(pr, "alias"); if (alias) s.title = alias;
      if (first(pr, "showingPlcHdr")) s.classList.add("dx-plc");
      target().appendChild(s);
      if (sc) renderInlineChildren(ctx, sc, s, st, para);
    } else if (l === "fldSimple") {
      const instr = attr(c, "instr") ?? "";
      const s = mkEl(ctx, "span", "dx-field");
      markField(s, instr);
      target().appendChild(s);
      renderInlineChildren(ctx, c, s, st, para);
    } else if (WRAP.has(l)) renderInlineChildren(ctx, c, target(), st, para);
    else if (l === "bookmarkStart") {
      const s = mkEl(ctx, "span", "dx-bm");
      s.dataset.skip = "1"; s.contentEditable = "false";
      const n = attr(c, "name"); if (n) { s.dataset.bm = n; s.id = `bm-${n}`; }
      target().appendChild(s);
    } else if (l === "oMath" || l === "oMathPara") {
      const s = mkEl(ctx, "span", "dx-math");
      s.dataset.u = "1"; s.contentEditable = "false";
      s.textContent = descendAll(c, "t").map(t => textOf(t)).join("") || "∑";
      s.title = "Equation (OMML)";
      ctx.reg.set(s, c);
      target().appendChild(s);
      st.hasUnits = true;
    }
  }
}

function markField(s: HTMLElement, instr: string) {
  const m = /^\s*([A-Za-z]+)/.exec(instr);
  const f = m ? m[1].toUpperCase() : "";
  s.dataset.fi = instr.trim();
  if (f === "PAGE" || f === "NUMPAGES" || f === "SECTIONPAGES" || f === "SECTION") s.dataset.f = f;
  else if (f === "DATE" || f === "TIME" || f === "SAVEDATE" || f === "CREATEDATE") s.dataset.f = f;
}

function renderRun(ctx: RenderCtx, run: XEl, out: Node, st: ParaState, para: XEl) {
  const { book } = ctx;
  const rPr = first(run, "rPr");
  const rs = val(rPr, "rStyle");
  const merged = mergeR(mergeR(st.baseR, rs ? book.styles.charLayer(rs) : undefined), readR(rPr, book.styles.theme));
  const css = cssDiff(rCss(merged), st.baseCss);

  const top = st.fields.length ? st.fields[st.fields.length - 1] : undefined;
  // hasil field dialihkan ke elemen field, kecuali `out` memang sudah berada di dalamnya
  const sink = (): Node => (top && top.phase === "result" && !top.el.contains(out) ? top.el : out);

  const span = mkEl(ctx, "span", "dx-r");
  setCss(span, css);
  if (merged.vanish) span.classList.add("dx-hidden");
  if (merged.lang) span.lang = merged.lang;
  ctx.reg.set(span, run);
  let appended = 0;

  for (const c of run.children) {
    if (!isEl(c)) continue;
    const l = c.name.local;
    switch (l) {
      case "fldChar": {
        const t = attr(c, "fldCharType");
        if (t === "begin") {
          const f = mkEl(ctx, "span", "dx-field");
          sink().appendChild(f);
          st.fields.push({ el: f, instr: "", phase: "instr" });
        } else if (t === "separate") {
          const f = st.fields[st.fields.length - 1];
          if (f) { f.phase = "result"; markField(f.el, f.instr); }
        } else if (t === "end") {
          st.fields.pop();
        }
        break;
      }
      case "instrText": { const f = st.fields[st.fields.length - 1]; if (f) f.instr += textOf(c); break; }
      case "t": {
        if (top && top.phase === "instr") break;
        const s = textOf(c);
        if (s) { span.appendChild(ctx.doc.createTextNode(s)); st.hasUnits = true; st.seenContent = true; appended++; }
        break;
      }
      case "tab": case "ptab": {
        if (top && top.phase === "instr") break;
        const t = mkEl(ctx, "span", "dx-tab");
        t.textContent = "\t";
        span.appendChild(t); st.hasUnits = true; st.seenContent = true; appended++;
        break;
      }
      case "br": case "cr": {
        const bt = attr(c, "type");
        if (bt === "page" || bt === "column") {
          const m = mkEl(ctx, "span", "dx-pb");
          m.dataset.u = "1"; m.contentEditable = "false";
          m.title = bt === "page" ? "Page break" : "Column break";
          span.appendChild(m);
          if (!st.seenContent) st.startsWithBreak = true;
          st.pageBreak = true; st.hasUnits = true; appended++;
        } else {
          const b = mkEl(ctx, "br"); b.dataset.u = "1";
          span.appendChild(b); st.hasUnits = true; st.seenContent = true; appended++;
        }
        break;
      }
      case "noBreakHyphen": span.appendChild(ctx.doc.createTextNode("‑")); st.hasUnits = true; appended++; break;
      case "softHyphen": span.appendChild(ctx.doc.createTextNode("­")); st.hasUnits = true; appended++; break;
      case "sym": {
        const u = runPieces(run).find(x => x.piece === c);
        if (u) { span.appendChild(ctx.doc.createTextNode(u.text)); st.hasUnits = true; st.seenContent = true; appended++; }
        break;
      }
      case "drawing": {
        const d = renderDrawing(ctx, c, run, para);
        if (d) { span.appendChild(d); st.hasUnits = true; st.seenContent = true; appended++; }
        break;
      }
      case "AlternateContent": {
        const choice = first(c, "Choice") ?? first(c, "Fallback");
        const drawing = descend(choice, "drawing");
        let d: HTMLElement | null = null;
        if (drawing) d = renderDrawing(ctx, drawing, run, para);
        else { const pict = descend(c, "pict"); if (pict) d = renderPict(ctx, pict, run); }
        if (!d) { d = renderPlaceholder(ctx, "◻", "AlternateContent", 96, 48); ctx.reg.set(d, c); }
        span.appendChild(d); st.hasUnits = true; st.seenContent = true; appended++;
        break;
      }
      case "pict": { const d = renderPict(ctx, c, run); span.appendChild(d); st.hasUnits = true; st.seenContent = true; appended++; break; }
      case "object": { const d = renderObject(ctx, c, run); span.appendChild(d); st.hasUnits = true; st.seenContent = true; appended++; break; }
      case "footnoteReference": case "endnoteReference": {
        const id = attr(c, "id") ?? "";
        const kind = l === "footnoteReference" ? "footnotes" : "endnotes";
        const n = ctx.fnRefs.filter(f => f.kind === kind).length + 1;
        ctx.fnRefs.push({ id, num: n, kind });
        const sup = mkEl(ctx, "sup", "dx-fnref");
        sup.dataset.u = "1"; sup.contentEditable = "false"; sup.dataset.note = `${kind}:${id}`;
        sup.textContent = kind === "endnotes" ? romanLower(n) : String(n);
        span.appendChild(sup); st.hasUnits = true; st.seenContent = true; appended++;
        break;
      }
      case "footnoteRef": case "endnoteRef": {
        const sup = mkEl(ctx, "sup", "dx-fnref");
        sup.dataset.skip = "1"; sup.contentEditable = "false";
        sup.textContent = ctx.noteNum !== undefined ? (l === "endnoteRef" ? romanLower(ctx.noteNum) : String(ctx.noteNum)) : "";
        span.appendChild(sup);
        break;
      }
      case "commentReference": {
        const id = attr(c, "id");
        const cm = ctx.book.comments().find(x => x.id === id);
        const b = mkEl(ctx, "span", "dx-cmt");
        b.dataset.skip = "1"; b.contentEditable = "false";
        b.textContent = "💬"; b.title = cm ? `${cm.author}: ${cm.text}` : "Comment";
        span.appendChild(b);
        break;
      }
      case "pgNum": {
        const s = mkEl(ctx, "span", "dx-field"); s.dataset.f = "PAGE"; s.textContent = "1"; span.appendChild(s);
        break;
      }
      default: break;
    }
  }
  if (span.childNodes.length) {
    // jika field begin menaruh span ke dalam sink, jangan duplikasi
    if (!span.parentNode) sink().appendChild(span);
  }
  void appended;
}

const romanLower = (n: number) => { const r: [number, string][] = [[10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]]; let s = ""; for (const [v, t] of r) while (n >= v) { s += t; n -= v; } return s; };

// ───────── gambar, shape, objek ─────────

function renderPlaceholder(ctx: RenderCtx, icon: string, label: string, w: number, h: number): HTMLElement {
  const s = mkEl(ctx, "span", "dx-img dx-img-ph");
  s.dataset.u = "1"; s.contentEditable = "false";
  s.style.width = px(w); s.style.height = px(h);
  s.textContent = `${icon} ${label}`;
  return s;
}

function schemeColor(ctx: RenderCtx, el: XEl | undefined): string | undefined {
  if (!el) return undefined;
  const srgb = first(el, "srgbClr");
  if (srgb) return `#${attr(srgb, "val")}`;
  const sch = first(el, "schemeClr");
  if (sch) {
    const m: Record<string, string> = { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2" };
    const k = attr(sch, "val") ?? "";
    const c = ctx.book.styles.theme.colors[m[k] ?? k];
    if (c) return `#${c}`;
  }
  return undefined;
}

export function applyAnchorCss(ctx: RenderCtx, wrap: HTMLElement, info: ImgInfo, w: number, h: number) {
  const d = info.dist;
  wrap.dataset.anchor = "1";
  const m = `${px(emuPx(d.t))} ${px(emuPx(d.r))} ${px(emuPx(d.b))} ${px(emuPx(d.l))}`;
  if (info.wrap === "square" || info.wrap === "tight" || info.wrap === "through") {
    const h0 = info.posH;
    const mid = ctx.contentW / 2;
    let side: "left" | "right" = "left";
    if (h0?.align === "right" || h0?.align === "outside") side = "right";
    else if (h0?.align === "left" || h0?.align === "inside") side = "left";
    else if (h0?.off !== undefined) {
      const base = h0.rel === "page" ? 0 : 0;
      side = emuPx(h0.off) + base + w / 2 > mid ? "right" : "left";
    } else if (h0?.align === "center") side = "left";
    wrap.style.float = side;
    wrap.style.margin = m;
    wrap.dataset.wrap = "float";
  } else if (info.wrap === "topBottom") {
    wrap.style.display = "block";
    wrap.style.clear = "both";
    wrap.style.margin = m;
    const a = info.posH?.align;
    wrap.style.marginLeft = a === "right" ? "auto" : a === "center" || !a ? "auto" : px(emuPx(d.l));
    wrap.style.marginRight = a === "left" ? "auto" : a === "center" || !a ? "auto" : px(emuPx(d.r));
    wrap.dataset.wrap = "block";
  } else {
    wrap.style.position = "absolute";
    wrap.style.zIndex = info.behind ? "-1" : "5";
    wrap.style.left = "0"; wrap.style.top = "0";
    wrap.dataset.wrap = "abs";
  }
  void h;
}

function renderDrawing(ctx: RenderCtx, drawing: XEl, run: XEl, _para: XEl): HTMLElement | null {
  void run;
  const info = readDrawing(drawing);
  if (!info) return null;
  const w = emuPx(info.cx) || 1, h = emuPx(info.cy) || 1;
  const wrap = mkEl(ctx, "span", "dx-img");
  wrap.dataset.u = "1"; wrap.contentEditable = "false";
  wrap.style.width = px(w); wrap.style.height = px(h);
  ctx.reg.set(wrap, drawing);
  const kind = info.content;
  if (kind === "pic") {
    const src = info.relId ? ctx.opts.forExport ? ctx.book.imageDataUri(info.relId, ctx.source) : ctx.book.imageUrl(info.relId, ctx.source)?.url : undefined;
    const meta = info.relId ? ctx.book.mediaPart(info.relId, ctx.source) : undefined;
    const unsupported = meta && /emf|wmf|tiff|x-pict|jxr|wdp/i.test(meta.contentType);
    if (!src || unsupported) {
      const fmt = meta ? meta.contentType.replace("image/", "").replace("x-", "") : "?";
      wrap.classList.add("dx-img-ph");
      wrap.textContent = !src ? `🖼 ${info.name || "image"} (missing)` : `🖼 ${info.name || "image"} (${fmt})`;
      wrap.title = unsupported ? `Format ${fmt} tidak dapat ditampilkan browser` : "Gambar tidak ditemukan";
      if (unsupported && meta && !ctx.badImages.has(meta.name)) { ctx.badImages.add(meta.name); ctx.onImageError?.(`format:${fmt}:${meta.name}`); }
    } else {
      const img = mkEl(ctx, "img");
      img.src = src; img.alt = info.descr; img.draggable = false;
      img.style.display = "block";
      const cr = info.crop;
      if (cr && (cr.l || cr.t || cr.r || cr.b)) {
        const vw = 1 - (cr.l + cr.r) / 100000, vh = 1 - (cr.t + cr.b) / 100000;
        wrap.style.overflow = "hidden";
        img.style.position = "absolute";
        img.style.width = px(w / Math.max(0.01, vw)); img.style.height = px(h / Math.max(0.01, vh));
        img.style.left = px(-(cr.l / 100000) * (w / Math.max(0.01, vw))); img.style.top = px(-(cr.t / 100000) * (h / Math.max(0.01, vh)));
        img.style.maxWidth = "none";
      } else { img.style.width = "100%"; img.style.height = "100%"; }
      img.onerror = () => {
        wrap.textContent = ""; wrap.classList.add("dx-img-ph"); wrap.textContent = `🖼 ${info.name || "image"} (error)`;
        if (meta && !ctx.badImages.has(meta.name)) { ctx.badImages.add(meta.name); ctx.onImageError?.(`decode:${meta.contentType}:${meta.name}`); }
      };
      wrap.appendChild(img);
    }
  } else if (kind === "shape" || kind === "group") {
    renderShape(ctx, wrap, drawing, info, w, h);
  } else {
    wrap.classList.add("dx-img-ph");
    wrap.textContent = kind === "chart" ? "📊 Chart" : kind === "diagram" ? "🔷 SmartArt" : kind === "ole" ? "📎 OLE" : "◻";
    wrap.title = kind;
    if (kind === "chart" || kind === "diagram") ctx.onImageError?.(`placeholder:${kind}`);
  }
  if (info.rot || info.flipH || info.flipV) wrap.style.transform = `rotate(${info.rot}deg) scale(${info.flipH ? -1 : 1}, ${info.flipV ? -1 : 1})`;
  if (info.descr) wrap.title = info.descr;
  if (info.kind === "anchor") applyAnchorCss(ctx, wrap, info, w, h);
  else { wrap.style.display = "inline-block"; wrap.style.verticalAlign = "baseline"; wrap.dataset.wrap = "inline"; }
  return wrap;
}

function renderShape(ctx: RenderCtx, wrap: HTMLElement, drawing: XEl, info: ImgInfo, w: number, h: number) {
  const host = info.host;
  const wsp = descend(host, "wsp");
  const spPr = first(wsp, "spPr") ?? descend(host, "spPr");
  wrap.classList.add("dx-shape");
  if (info.content === "group") {
    // grup: posisikan anak berdasarkan xfrm grup
    const grp = descend(host, "grpSpPr");
    const xf = first(grp, "xfrm");
    const chOff = first(xf, "chOff"), chExt = first(xf, "chExt");
    const cox = num(attr(chOff, "x")) ?? 0, coy = num(attr(chOff, "y")) ?? 0;
    const cw = num(attr(chExt, "cx")) || info.cx || 1, ch = num(attr(chExt, "cy")) || info.cy || 1;
    wrap.style.position = wrap.style.position || "relative";
    const grpEl = descend(host, "wgp");
    for (const child of grpEl ? els(grpEl) : []) {
      if (child.name.local !== "wsp" && child.name.local !== "pic") continue;
      const sp = child.name.local === "wsp" ? first(child, "spPr") : first(child, "spPr");
      const x = first(sp, "xfrm");
      const off = first(x, "off"), ext = first(x, "ext");
      const box = mkEl(ctx, "div", "dx-shape-child");
      box.style.position = "absolute";
      box.style.left = px(emuPx(((num(attr(off, "x")) ?? 0) - cox) * (info.cx / cw)));
      box.style.top = px(emuPx(((num(attr(off, "y")) ?? 0) - coy) * (info.cy / ch)));
      box.style.width = px(emuPx((num(attr(ext, "cx")) ?? 0) * (info.cx / cw)));
      box.style.height = px(emuPx((num(attr(ext, "cy")) ?? 0) * (info.cy / ch)));
      styleShapeBox(ctx, box, sp);
      const txbx = descend(child, "txbxContent");
      if (txbx) fillBlocks(ctx, box, txbx, true);
      wrap.appendChild(box);
    }
    return;
  }
  styleShapeBox(ctx, wrap, spPr);
  const txbx = descend(wsp ?? host, "txbxContent");
  if (txbx) {
    const inner = mkEl(ctx, "div", "dx-txbx");
    const savedW = ctx.contentW;
    ctx.contentW = Math.max(40, w - 14);
    fillBlocks(ctx, inner, txbx, true);
    ctx.contentW = savedW;
    wrap.appendChild(inner);
  } else if (!spPr) { wrap.classList.add("dx-img-ph"); wrap.textContent = "◻ shape"; }
  void h; void drawing;
}

function styleShapeBox(ctx: RenderCtx, box: HTMLElement, spPr: XEl | undefined) {
  if (!spPr) return;
  const fill = first(spPr, "solidFill");
  const fc = schemeColor(ctx, fill);
  if (fc) box.style.backgroundColor = fc;
  const ln = first(spPr, "ln");
  if (ln && !first(ln, "noFill")) {
    const lw = emuPx(num(attr(ln, "w")) ?? 9525);
    const lc = schemeColor(ctx, first(ln, "solidFill")) ?? "#000";
    box.style.border = `${px(Math.max(1, lw))} solid ${lc}`;
  }
  const geom = attr(first(spPr, "prstGeom"), "prst");
  if (geom === "ellipse") box.style.borderRadius = "50%";
  else if (geom === "roundRect") box.style.borderRadius = "10px";
}

function renderPict(ctx: RenderCtx, pict: XEl, run: XEl): HTMLElement {
  void run;
  const shape = descend(pict, "shape") ?? descend(pict, "rect");
  const style = attr(shape, "style") ?? "";
  const dim = (name: string) => { const m = new RegExp(`${name}\\s*:\\s*([\\d.]+)\\s*(pt|px|in|cm|mm)?`, "i").exec(style); if (!m) return undefined; const v = Number(m[1]); const u = (m[2] || "pt").toLowerCase(); return u === "pt" ? ptPx(v) : u === "px" ? v : u === "in" ? v * 96 : u === "cm" ? (v * 96) / 2.54 : (v * 96) / 25.4; };
  const w = dim("width") ?? 96, h = dim("height") ?? 48;
  const idata = descend(pict, "imagedata");
  const rid = attr(idata, "id") ?? attr(idata, "relid");
  if (idata && rid) {
    const wrap = mkEl(ctx, "span", "dx-img");
    wrap.dataset.u = "1"; wrap.contentEditable = "false";
    wrap.style.width = px(w); wrap.style.height = px(h); wrap.style.display = "inline-block";
    const meta = ctx.book.mediaPart(rid, ctx.source);
    const src = ctx.opts.forExport ? ctx.book.imageDataUri(rid, ctx.source) : ctx.book.imageUrl(rid, ctx.source)?.url;
    if (!src || (meta && /emf|wmf|tiff/i.test(meta.contentType))) {
      wrap.classList.add("dx-img-ph"); wrap.textContent = `🖼 VML (${meta?.contentType.replace("image/", "") ?? "?"})`;
    } else {
      const img = mkEl(ctx, "img"); img.src = src; img.style.width = "100%"; img.style.height = "100%"; img.draggable = false;
      wrap.appendChild(img);
    }
    ctx.reg.set(wrap, pict);
    return wrap;
  }
  const ph = renderPlaceholder(ctx, "◻", attr(shape, "type") ? "VML shape" : "VML", w, h);
  const txbx = descend(pict, "txbxContent");
  if (txbx) { ph.textContent = ""; ph.classList.remove("dx-img-ph"); ph.classList.add("dx-shape"); const inner = mkEl(ctx, "div", "dx-txbx"); fillBlocks(ctx, inner, txbx, true); ph.appendChild(inner); }
  ctx.reg.set(ph, pict);
  return ph;
}

function renderObject(ctx: RenderCtx, obj: XEl, run: XEl): HTMLElement {
  void run;
  const ole = descend(obj, "OLEObject");
  const progId = attr(ole, "ProgID") ?? "";
  const shape = descend(obj, "shape");
  const style = attr(shape, "style") ?? "";
  const m1 = /width\s*:\s*([\d.]+)pt/i.exec(style), m2 = /height\s*:\s*([\d.]+)pt/i.exec(style);
  const w = m1 ? ptPx(Number(m1[1])) : 96, h = m2 ? ptPx(Number(m2[1])) : 64;
  const wrap = mkEl(ctx, "span", "dx-img dx-ole");
  wrap.dataset.u = "1"; wrap.contentEditable = "false";
  wrap.dataset.ole = attr(ole, "id") ?? "";
  wrap.dataset.prog = progId;
  wrap.style.width = px(w); wrap.style.height = px(h); wrap.style.display = "inline-block"; wrap.style.verticalAlign = "baseline";
  const idata = descend(obj, "imagedata");
  const rid = attr(idata, "id");
  const meta = rid ? ctx.book.mediaPart(rid, ctx.source) : undefined;
  const src = rid && meta && !/emf|wmf|tiff/i.test(meta.contentType) ? (ctx.opts.forExport ? ctx.book.imageDataUri(rid, ctx.source) : ctx.book.imageUrl(rid, ctx.source)?.url) : undefined;
  if (src) { const img = mkEl(ctx, "img"); img.src = src; img.style.width = "100%"; img.style.height = "100%"; img.draggable = false; wrap.appendChild(img); }
  else { wrap.classList.add("dx-img-ph"); wrap.textContent = `📎 ${progId || "OLE"}`; }
  const badge = mkEl(ctx, "span", "dx-ole-badge");
  badge.textContent = "OLE"; badge.contentEditable = "false";
  wrap.appendChild(badge);
  wrap.title = `OLE: ${progId || "?"} — double-click`;
  ctx.reg.set(wrap, obj);
  return wrap;
}

// ───────── tabel ─────────

function pickSide(b: Borders | undefined, side: "top" | "left" | "bottom" | "right", edge: boolean) {
  if (!b) return undefined;
  if (edge) return b[side];
  return side === "top" || side === "bottom" ? b.insideH ?? undefined : b.insideV ?? undefined;
}

export function renderTable(ctx: RenderCtx, tbl: XEl, region: "body" | "readonly" = "body"): HTMLElement {
  const { book } = ctx;
  const theme = book.styles.theme;
  const g = buildGrid(tbl);
  const tblPr = first(tbl, "tblPr");
  const sid = val(tblPr, "tblStyle");
  const def = book.styles.tableStyle(sid);
  const look = readTableLook(tblPr);
  let widths = gridWidths(g).map(twipPx);
  const sum = widths.reduce((a, b) => a + b, 0) || 1;
  const tw = first(tblPr, "tblW");
  const twT = attr(tw, "type"), twV = num(attr(tw, "w")) ?? 0;
  let target = sum;
  if (twT === "dxa" && twV > 0) target = twipPx(twV);
  else if (twT === "pct" && twV > 0) target = (ctx.contentW * twV) / 5000;
  if (Math.abs(target - sum) / sum > 0.01) widths = widths.map(w => (w * target) / sum);
  const total = widths.reduce((a, b) => a + b, 0);

  const table = mkEl(ctx, "table", "dx-tbl");
  table.style.width = px(total);
  table.style.tableLayout = "fixed";
  table.style.borderCollapse = "collapse";
  table.style.borderSpacing = "0";
  ctx.reg.set(table, tbl);
  const jc = val(tblPr, "jc");
  const ind = twipPx(num(attr(first(tblPr, "tblInd"), "w")) ?? 0);
  if (jc === "center") table.style.alignSelf = "center";
  else if (jc === "right" || jc === "end") table.style.alignSelf = "flex-end";
  else { table.style.alignSelf = "flex-start"; if (ind) table.style.marginLeft = px(ind); }
  const cg = mkEl(ctx, "colgroup");
  for (const w of widths) { const c = mkEl(ctx, "col"); c.style.width = px(w); cg.appendChild(c); }
  table.appendChild(cg);
  const tbody = mkEl(ctx, "tbody");
  table.appendChild(tbody);

  const directBorders = readBordersLocal(first(tblPr, "tblBorders"), theme);
  const tblShd = readShd(first(tblPr, "shd"), theme);
  const defMar = { top: 0, left: 108, bottom: 0, right: 108, ...def.cellMar, ...readMar(first(tblPr, "tblCellMar")) };
  const nRows = g.rows.length;

  g.rows.forEach((tr, r) => {
    const trEl = mkEl(ctx, "tr");
    ctx.reg.set(trEl, tr);
    const trPr = first(tr, "trPr");
    const hEl = first(trPr, "trHeight");
    if (first(trPr, "hidden")) trEl.style.display = "none";
    if (first(trPr, "tblHeader")) trEl.dataset.hdr = "1";
    if (first(trPr, "cantSplit")) trEl.dataset.cs = "1";
    const rowH = num(attr(hEl, "val"));
    const exact = attr(hEl, "hRule") === "exact";
    if (rowH) trEl.style.height = px(twipPx(rowH));
    const gridBefore = num(val(trPr, "gridBefore")) ?? 0;
    if (gridBefore > 0) { const td = mkEl(ctx, "td"); td.colSpan = gridBefore; td.style.border = "none"; td.style.padding = "0"; td.dataset.skip = "1"; trEl.appendChild(td); }
    for (const cell of g.cells.filter(c => c.row === r)) {
      if (cell.vm === "continue") continue;
      const tc = cell.el;
      const td = mkEl(ctx, "td", "dx-td");
      ctx.reg.set(td, tc);
      td.colSpan = cell.colspan;
      if (cell.rowspan > 1) td.rowSpan = cell.rowspan;
      const tcPr = first(tc, "tcPr");
      const cond = book.styles.cellCond(def, look, r, cell.col, nRows, g.ncols);
      let w = 0; for (let k = 0; k < cell.colspan; k++) w += widths[cell.col + k] ?? 0;
      td.style.width = px(w);
      // border
      const direct = readBordersLocal(first(tcPr, "tcBorders"), theme);
      const lastRow = r + cell.rowspan - 1 === nRows - 1;
      const lastCol = cell.col + cell.colspan - 1 === g.ncols - 1;
      for (const side of ["top", "left", "bottom", "right"] as const) {
        const edge = (side === "top" && r === 0) || (side === "bottom" && lastRow) || (side === "left" && cell.col === 0) || (side === "right" && lastCol);
        let b = pickSide(def.borders, side, edge);
        const cb = pickSide(cond.borders, side, edge) ?? (cond.borders?.[side]);
        if (cb) b = cb;
        const tb = pickSide(directBorders, side, edge);
        if (tb) b = tb;
        const db = direct?.[side] ?? (direct ? pickSide(direct, side, false) : undefined);
        if (db) b = db;
        const css = borderCss(b);
        if (css) td.style.setProperty(`border-${side}`, css);
      }
      // shading
      const shd = readShd(first(tcPr, "shd"), theme) ?? cond.shd ?? tblShd;
      if (shd?.fill) td.style.backgroundColor = `#${shd.fill}`;
      // margin
      const mar = { ...defMar, ...cond.mar, ...readMar(first(tcPr, "tcMar")) };
      td.style.padding = `${px(twipPx(mar.top ?? 0))} ${px(twipPx(mar.right ?? 108))} ${px(twipPx(mar.bottom ?? 0))} ${px(twipPx(mar.left ?? 108))}`;
      const va = val(tcPr, "vAlign") ?? cond.vAlign;
      td.style.verticalAlign = va === "center" ? "middle" : va === "bottom" ? "bottom" : "top";
      const dir = val(tcPr, "textDirection");
      if (first(tcPr, "noWrap")) td.style.whiteSpace = "nowrap";
      const inner = mkEl(ctx, "div", "dx-cellc");
      if (dir && dir !== "lrTb" && dir !== "lrTbV") {
        // teks vertikal: tbRl (searah jarum jam), btLr (berlawanan; diputar 180° dari vertical-rl), tbLrV
        inner.classList.add("dx-vert");
        inner.style.display = "block";
        inner.style.writingMode = dir === "tbLrV" ? "vertical-lr" : "vertical-rl";
        if (dir === "btLr") inner.style.transform = "rotate(180deg)";
        inner.style.maxHeight = "320px";
      }
      if (exact && rowH) { inner.style.maxHeight = px(twipPx(rowH)); inner.style.overflow = "hidden"; }
      const savedW = ctx.contentW;
      ctx.contentW = Math.max(30, w - twipPx((mar.left ?? 108) + (mar.right ?? 108)));
      fillBlocks(ctx, inner, tc, region === "readonly", cond);
      ctx.contentW = savedW;
      td.appendChild(inner);
      trEl.appendChild(td);
    }
    tbody.appendChild(trEl);
  });
  void is;
  return table;
}

function readBordersLocal(el: XEl | undefined, theme: import("./docx-style").Theme): Borders | undefined {
  // Pemakaian ulang readBorders tanpa impor melingkar
  if (!el) return undefined;
  const out: Borders = {};
  const rd = (n: string): import("./docx-style").Border | undefined => {
    const e = first(el, n);
    if (!e) return undefined;
    const v = attr(e, "val");
    if (!v) return undefined;
    return { val: v, sz: num(attr(e, "sz")) ?? 4, color: resolveColor(e, theme, "color"), space: num(attr(e, "space")) };
  };
  const map: [keyof Borders, string[]][] = [["top", ["top"]], ["left", ["left", "start"]], ["bottom", ["bottom"]], ["right", ["right", "end"]], ["insideH", ["insideH"]], ["insideV", ["insideV"]]];
  for (const [k, ns] of map) for (const n of ns) { const b = rd(n); if (b) { out[k] = b; break; } }
  return Object.keys(out).length ? out : undefined;
}

// ───────── blok ─────────

/** Render anak blok (p, tbl, sdt) dari `container` ke `out`; mengembalikan elemen blok tingkat atas. */
export function fillBlocks(ctx: RenderCtx, out: HTMLElement, container: XEl, readonly = false, tcond?: TCond): HTMLElement[] {
  const blocks: HTMLElement[] = [];
  const region = readonly ? "readonly" : "body";
  const walk = (parent: XEl) => {
    for (const c of parent.children) {
      if (!isEl(c)) continue;
      const l = c.name.local;
      if (l === "p") { const d = renderParagraph(ctx, c, tcond, region); if (parent !== container) ctx.book.setParent(c, parent); out.appendChild(d); blocks.push(d); }
      else if (l === "tbl") { const t = renderTable(ctx, c, region); out.appendChild(t); blocks.push(t); }
      else if (l === "sdt") { const sc = first(c, "sdtContent"); if (sc) walk(sc); }
    }
  };
  walk(container);
  return blocks;
}

/** Format kondisional style tabel untuk sel `tc` (null bila tidak ada tabel induk). */
export function condForCell(book: DocxBook, tc: XEl): TCond | undefined {
  const tr = book.parentOf(tc);
  const tbl = tr ? book.parentOf(tr) : undefined;
  if (!tbl) return undefined;
  const g = buildGrid(tbl);
  const cell = g.cells.find(c => c.el === tc);
  if (!cell) return undefined;
  const tblPr = first(tbl, "tblPr");
  const def = book.styles.tableStyle(val(tblPr, "tblStyle"));
  return book.styles.cellCond(def, readTableLook(tblPr), cell.row, cell.col, g.rows.length, g.ncols);
}
export function condForParagraph(book: DocxBook, p: XEl): TCond | undefined {
  const par = book.parentOf(p);
  return par && par.name.local === "tc" ? condForCell(book, par) : undefined;
}

/** Penomoran ulang label daftar untuk seluruh body (setelah edit struktur). */
export function refreshNumbering(ctx: RenderCtx, onNeedsRerender?: (p: XEl) => void) {
  const { book, reg } = ctx;
  book.numbering.reset();
  for (const { p } of book.paragraphs()) {
    const dom = reg.domOf.get(p);
    if (!dom || !dom.isConnected) continue;
    const pPr = first(p, "pPr");
    const base = book.styles.paraBase(val(pPr, "pStyle"));
    const direct = readP(pPr, book.styles.theme);
    const numId = direct.numId ?? base.p.numId;
    const ilvl = direct.ilvl ?? base.p.ilvl ?? 0;
    const has = numId !== undefined && numId > 0 && book.numbering.has(numId);
    let marker: HTMLElement | null = null;
    for (let c = dom.firstChild; c; c = c.nextSibling) if (c instanceof HTMLElement && c.classList.contains("dx-num")) { marker = c; break; }
    if (!has) { if (marker) onNeedsRerender?.(p); continue; }
    const lab = book.numbering.next(numId!, ilvl);
    if (!lab) continue;
    if (!marker) { onNeedsRerender?.(p); continue; }
    marker.textContent = lab.lvl.suff === "space" ? lab.text + " " : lab.text;
  }
}

export { drawingContent, REL };
