/** PptxView: pptx-view-textedit.ts — fungsi bagian dari kelas (`this: PptxView`), dipasang di kelas sebagai properti agar API publik tidak berubah. */
import type { PptxView } from "./pptx-view";
import * as P from "@office-kit/pptx";
import type { SlideShapeData, TextFormat, ReadTextFormat } from "@office-kit/pptx";
import { themeColor } from "./pptx-render";
import { setRunAlpha } from "./pptx-alpha";
import { parseCssColor } from "../editor-kit/color-util";

export function startEdit(this: PptxView, shape: SlideShapeData, cell?: { row: number; col: number }) {
  if (this.readonly || this.editing) return;
  const dom = this.ctx.domOf.get(shape);
  if (!dom) return;
  let host: HTMLElement | null = null;
  if (cell) host = dom.querySelector<HTMLElement>(`td[data-r="${cell.row}"][data-c="${cell.col}"]`);
  else {
    host = dom.querySelector<HTMLElement>(".px-text");
    if (!host) { host = document.createElement("div"); host.className = "px-text"; host.style.cssText = "padding:4px 8px;justify-content:flex-start;"; dom.appendChild(host); }
    host.querySelector(".px-prompt")?.remove();
  }
  if (!host) return;
  const props: P.ParagraphProperties[] = [];
  let baseFmt: ReadTextFormat | null = null;
  if (!cell) {
    const n = P.getShapeParagraphCount(shape);
    for (let i = 0; i < n; i++) { props.push(P.getParagraphPropertiesEffective(this.deck!.pres, shape, i)); if (!baseFmt && P.getShapeRunCount(shape, i) > 0) baseFmt = P.getShapeRunFormatEffective(this.deck!.pres, shape, i, 0); }
    if (!host.querySelector(".px-p")) { const p = document.createElement("div"); p.className = "px-p"; p.style.cssText = "line-height:1.2;"; p.innerHTML = "<br>"; host.appendChild(p); }
  }
  host.contentEditable = "true";
  host.classList.add("px-editing");
  host.spellcheck = true;
  this.editing = { shape, host, cell, before: host.innerHTML, props, baseFmt, changed: false };
  host.addEventListener("input", this.onEditInput);
  this.overlay.querySelectorAll(".px-sel").forEach(e => e.remove());
  host.focus();
  const r = document.createRange(); r.selectNodeContents(host); const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r);
  this.emit();
}

export function rgbHex(this: PptxView, c: string): string | null { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c); return m ? "#" + [m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, "0")).join("").toUpperCase() : null; }

/** DOM yang disunting → daftar paragraf berformat (hanya selisih terhadap format dasar). */
export function parseEdit(this: PptxView, host: HTMLElement, base: ReadTextFormat | null, scale = 1): { align: string | null; runs: { text: string; format: TextFormat; href?: string; alpha?: number }[] }[] {
  const root = host;
  const paras: HTMLElement[] = [];
  const loose: Node[] = [];
  const flushLoose = () => { if (loose.length) { const d = document.createElement("div"); for (const n of loose) d.appendChild(n.cloneNode(true)); paras.push(d); loose.length = 0; } };
  for (const n of [...root.childNodes]) {
    if (n instanceof HTMLElement && /^(DIV|P|LI)$/.test(n.tagName) && !n.classList.contains("px-prompt")) { flushLoose(); paras.push(n); }
    else if (n instanceof HTMLElement && n.tagName === "BR") { loose.push(n); flushLoose(); }
    else loose.push(n);
  }
  flushLoose();
  const result: { align: string | null; runs: { text: string; format: TextFormat; href?: string; alpha?: number }[] }[] = [];
  for (const p of paras) {
    const runs: { text: string; format: TextFormat; href?: string; alpha?: number }[] = [];
    const cs = getComputedStyle(p);
    const align = p.style.textAlign || (cs.textAlign && cs.textAlign !== "start" ? cs.textAlign : null);
    const walk = (n: Node) => {
      if (n instanceof HTMLElement && (n.classList.contains("px-bullet") || n.classList.contains("px-prompt"))) return;
      if (n instanceof HTMLElement && n.tagName === "BR") { return; }
      if (n.nodeType === 3) {
        const text = (n.nodeValue ?? "").replace(/​/g, "");
        if (!text) return;
        const st = getComputedStyle(n.parentElement!);
        const f: TextFormat = {};
        // Setiap run ditulis dengan format efektifnya (ukuran, huruf, warna, gaya): `setShapeParagraphs` mereset properti run,
        // jadi format yang hanya "sama dengan run pertama" akan hilang dan jatuh ke bawaan layout.
        const px = parseFloat(st.fontSize);
        if (px > 0) f.size = Math.round(((px * 72) / 96 / scale) * 10) / 10;
        const src = n.parentElement!.closest<HTMLElement>("[data-font],[data-clr]");
        const fam = (st.fontFamily.split(",")[0] ?? "").trim().replace(/^['"]|['"]$/g, "");
        if (fam) {
          const orig = src?.dataset.font;
          const origName = orig?.startsWith("+mj") ? this.ctx.fonts?.majorLatin ?? "Calibri Light" : orig?.startsWith("+mn") ? this.ctx.fonts?.minorLatin ?? "Calibri" : orig;
          f.font = orig && origName === fam ? orig : fam;
        }
        f.bold = parseInt(st.fontWeight) >= 600;
        f.italic = st.fontStyle === "italic";
        f.underline = /underline/.test(st.textDecorationLine);
        f.strike = /line-through/.test(st.textDecorationLine);
        const col = this.rgbHex(st.color);
        if (col) {
          const tok = src?.dataset.clr;
          f.color = (tok && themeColor(this.ctx, tok)?.toUpperCase() === col ? tok : col) as P.Color;
        }
        const al = parseCssColor(st.color)?.alpha;
        const alpha = al !== undefined && al < 1 ? Math.round(al * 1000) / 1000 : undefined;
        const lk = n.parentElement!.closest<HTMLElement>("a[href],[data-href]");
        const href = lk?.getAttribute("href") ?? lk?.dataset.href ?? undefined;
        // run bertautan memakai tampilan tautan dari tema: jangan membakar warna/garis bawah ke dalam run
        if (href) { delete f.underline; delete f.color; }
        const prev = runs[runs.length - 1];
        if (prev && JSON.stringify(prev.format) === JSON.stringify(f) && prev.href === href && prev.alpha === alpha) prev.text += text; else runs.push({ text, format: f, href, alpha });
        return;
      }
      n.childNodes.forEach(walk);
    };
    p.childNodes.forEach(walk);
    result.push({ align, runs });
  }
  return result;
}

export function commitEdit(this: PptxView) {
  const ed = this.editing;
  if (!ed) return;
  this.editing = null;
  ed.host.removeEventListener("input", this.onEditInput);
  ed.host.contentEditable = "false";
  ed.host.classList.remove("px-editing");
  window.getSelection()?.removeAllRanges();
  const dirty = ed.changed || ed.host.innerHTML !== ed.before;
  if (dirty && this.deck) {
    try {
      const fit = P.getShapeTextAutoFitParams(ed.shape);
      const parsed = this.parseEdit(ed.host, ed.baseFmt, fit?.fontScale ?? 1);
      if (ed.cell) {
        const cell = P.getTableCell(ed.shape, ed.cell.row, ed.cell.col);
        P.setTableCellParagraphs(cell, parsed.map(p => ({ align: this.toAlign(p.align), runs: p.runs.length ? p.runs : [{ text: "", format: {} }] })));
      } else {
        P.setShapeParagraphs(ed.shape, parsed.map(p => ({ align: this.toAlign(p.align), runs: p.runs.map(r => ({ text: r.text, format: r.format })) })));
        parsed.forEach((p, pi) => p.runs.forEach((r, ri) => {
          try {
            if (r.href) P.setShapeRunHyperlink(ed.shape, pi, ri, r.href);
            if (r.alpha !== undefined) setRunAlpha(ed.shape, pi, ri, r.alpha);
          } catch { /* abaikan */ }
        }));
        // pulihkan properti paragraf (bullet, level, spasi, perataan)
        parsed.forEach((p, i) => {
          const pr = ed.props[Math.min(i, ed.props.length - 1)];
          if (!pr) return;
          try {
            if (pr.bullet) P.setParagraphBullet(ed.shape, i, pr.bullet);
            if (pr.level) P.setParagraphLevel(ed.shape, i, pr.level);
            if (pr.align && !p.align) P.setParagraphAlignment(ed.shape, i, pr.align);
            if (pr.lineSpacing) P.setParagraphLineSpacing(ed.shape, i, pr.lineSpacing);
            if (pr.spcBefPts || pr.spcAftPts) P.setParagraphSpacing(ed.shape, i, { beforePts: pr.spcBefPts, afterPts: pr.spcAftPts });
          } catch { /* abaikan */ }
        });
      }
      this.changed("hist.text");
      this.hooks.thumbs([this.slideIdx]);
    } catch (e) { this.hooks.log("error", "log.opFail", { op: "edit", msg: e instanceof Error ? e.message : String(e) }); }
  }
  this.render();
}

export function toAlign(this: PptxView, a: string | null): P.ParagraphAlignment | undefined { return a === "center" ? "center" : a === "right" ? "right" : a === "justify" ? "justify" : a === "left" ? "left" : undefined; }

export function execFormat(this: PptxView, f: TextFormat) {
  if (!this.editing) return;
  const ex = (c: string, v?: string) => document.execCommand(c, false, v);
  if (f.bold !== undefined && f.bold !== document.queryCommandState("bold")) ex("bold");
  if (f.italic !== undefined && f.italic !== document.queryCommandState("italic")) ex("italic");
  if (f.underline !== undefined && !!f.underline !== document.queryCommandState("underline")) ex("underline");
  if (f.strike !== undefined && !!f.strike !== document.queryCommandState("strikeThrough")) ex("strikeThrough");
  const fa = f as TextFormat & { alpha?: number };
  if (f.color === null) { ex("styleWithCSS", "true"); ex("foreColor", getComputedStyle(this.editing.host).color || "#000000"); }
  else if (f.color) {
    ex("styleWithCSS", "true");
    const a = fa.alpha !== undefined && fa.alpha < 1 ? fa.alpha : null;
    const p = /^#?([0-9a-f]{6})$/i.exec(String(f.color));
    ex("foreColor", a !== null && p ? `rgba(${parseInt(p[1].slice(0, 2), 16)}, ${parseInt(p[1].slice(2, 4), 16)}, ${parseInt(p[1].slice(4, 6), 16)}, ${a})` : String(f.color));
  }
  if (f.size) {
    ex("fontSize", "7");
    this.editing.host.querySelectorAll<HTMLElement>("font[size='7']").forEach(el => { el.removeAttribute("size"); el.style.fontSize = `${(f.size! * 96) / 72}px`; });
  }
  this.editing.changed = true;
}

export function addSlide(this: PptxView, layoutName?: string, at?: number): boolean {
  if (this.readonly || !this.deck) return false;
  const pres = this.deck.pres;
  const layouts = P.getSlideLayouts(pres);
  const layout = layoutName ? layouts.find(l => P.getSlideLayoutName(l) === layoutName) : (this.slide ? P.getSlideLayout(this.slide) : null) ?? layouts[layouts.length - 1];
  if (!layout) return false;
  const pos = at === undefined ? this.slideIdx + 1 : Math.max(0, Math.min(this.slides.length, Math.floor(at)));
  P.addSlideAt(pres, pos, { layout });
  this.changed("hist.slide");
  this.slideIdx = pos;
  this.hooks.slide(this.slideIdx); this.render(false); this.hooks.thumbs("all");
  return true;
}
