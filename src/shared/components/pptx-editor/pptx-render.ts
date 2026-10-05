/**
 * Renderer slide → DOM. Semua nilai (posisi tertaut layout/master, fill, stroke, format run, properti paragraf, ...) diambil dari getter
 * "Effective" `@office-kit/pptx`, sehingga pewarisan placeholder → layout → master → tema ditangani library.
 * Satuan: 1 px = 9525 EMU (slide 16:9 = 1280 × 720 px).
 */
import * as P from "@office-kit/pptx";
import type { PresentationData, SlideData, SlideShapeData, ReadTextFormat, TableCellData } from "@office-kit/pptx";
import { customPath, presetPath } from "./pptx-geom";
import { chartSvg } from "./pptx-chart";
import { oleFramePreview, readOleFrame, scanSlideOle, type RawOleFrame } from "./pptx-ole";

export const PX = 9525;
export const emuPx = (e: number) => e / PX;
const pt2px = (pt: number) => (pt * 96) / 72;
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface RenderLog { (key: string, params?: Record<string, string | number>): void }

export interface RenderCtx {
  pres: PresentationData;
  doc: Document;
  /** DOM → bentuk (hanya bentuk tingkat-atas yang dapat dipilih). */
  reg: WeakMap<Element, SlideShapeData>;
  domOf: Map<SlideShapeData, HTMLElement>;
  imgUrl: (bytes: Uint8Array, format: string) => string;
  interactive: boolean;
  /** Teks placeholder kosong, mis. { title: "Click to add title" } */
  prompts: Record<string, string>;
  log?: RenderLog;
  theme: ReturnType<typeof P.getPresentationTheme>;
  fonts: ReturnType<typeof P.getPresentationFonts>;
  seenIssues: Set<string>;
}

const SCHEME: Record<string, string> = { tx1: "dark1", bg1: "light1", tx2: "dark2", bg2: "light2", dk1: "dark1", lt1: "light1", dk2: "dark2", lt2: "light2", accent1: "accent1", accent2: "accent2", accent3: "accent3", accent4: "accent4", accent5: "accent5", accent6: "accent6", hlink: "hyperlink", folHlink: "followedHyperlink" };

export function themeColor(ctx: RenderCtx, c: string | null | undefined): string | null {
  if (!c) return null;
  if (c.startsWith("#")) return c.length === 4 ? "#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c;
  if (/^[0-9a-fA-F]{6}$/.test(c)) return "#" + c;
  const k = SCHEME[c.replace(/^scheme:/, "")];
  const t = ctx.theme as unknown as Record<string, string> | null;
  return k && t && t[k] ? t[k] : null;
}
export function paletteOf(ctx: RenderCtx): string[] {
  const t = ctx.theme;
  return t ? [t.accent1, t.accent2, t.accent3, t.accent4, t.accent5, t.accent6] : ["#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47"];
}

function issue(ctx: RenderCtx, key: string, params?: Record<string, string | number>) {
  const id = key + JSON.stringify(params ?? {});
  if (ctx.seenIssues.has(id)) return;
  ctx.seenIssues.add(id);
  ctx.log?.(key, params);
}

function el<K extends keyof HTMLElementTagNameMap>(ctx: RenderCtx, tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const e = ctx.doc.createElement(tag as string) as HTMLElementTagNameMap[K];
  if (cls) (e as HTMLElement).className = cls;
  return e;
}

// ───────── fill / stroke ─────────

interface Paint { fill: string; defs: string; opacity?: number }
let gid = 0;

function fillPaint(ctx: RenderCtx, shape: SlideShapeData): Paint {
  const none: Paint = { fill: "none", defs: "" };
  try {
    const f = P.getShapeFillEffective(ctx.pres, shape);
    if (f.kind === "solid") return { fill: themeColor(ctx, f.color) ?? "#000", defs: "", opacity: P.getShapeFillOpacity(shape) ?? undefined };
    if (f.kind === "gradient") {
      const g = P.getShapeGradientFillEffective(ctx.pres, shape);
      if (g) {
        const id = `g${++gid}`;
        const stops = g.stops.map(s => `<stop offset="${r2(s.offset * 100)}%" stop-color="${themeColor(ctx, s.color) ?? "#888"}"/>`).join("");
        if (g.path && g.path !== "linear") return { fill: `url(#${id})`, defs: `<radialGradient id="${id}" cx="50%" cy="50%" r="70%">${stops}</radialGradient>` };
        const a = ((g.angleDeg ?? 90) * Math.PI) / 180;
        return { fill: `url(#${id})`, defs: `<linearGradient id="${id}" x1="${r2(50 - 50 * Math.cos(a))}%" y1="${r2(50 - 50 * Math.sin(a))}%" x2="${r2(50 + 50 * Math.cos(a))}%" y2="${r2(50 + 50 * Math.sin(a))}%">${stops}</linearGradient>` };
      }
    }
    if (f.kind === "pattern") {
      const pf = P.getShapePatternFill(ctx.pres, shape);
      return { fill: themeColor(ctx, pf?.background) ?? themeColor(ctx, pf?.foreground) ?? "#ccc", defs: "" };
    }
    if (f.kind === "image") {
      const bytes = P.getShapeImageFillBytes(shape);
      if (bytes) { const id = `i${++gid}`; return { fill: `url(#${id})`, defs: `<pattern id="${id}" width="1" height="1" patternContentUnits="objectBoundingBox"><image href="${ctx.imgUrl(bytes, "png")}" width="1" height="1" preserveAspectRatio="none"/></pattern>` }; }
    }
  } catch { /* bentuk tanpa fill terbaca */ }
  return none;
}

interface Line { color: string; width: number; dash?: string; head?: string; tail?: string; opacity?: number }
function linePaint(ctx: RenderCtx, shape: SlideShapeData): Line | null {
  try {
    const s = P.getShapeStrokeEffective(ctx.pres, shape);
    if (s.kind !== "solid") return null;
    const dashTok = P.getShapeStrokeDash(shape);
    const w = Math.max(0.5, emuPx(s.widthEmu ?? 12700));
    const dash = !dashTok || dashTok === "solid" ? undefined : ({ dot: `${w} ${w * 2}`, sysDot: `${w} ${w}`, dash: `${w * 4} ${w * 3}`, sysDash: `${w * 3} ${w}`, lgDash: `${w * 8} ${w * 3}`, dashDot: `${w * 4} ${w * 2} ${w} ${w * 2}`, lgDashDot: `${w * 8} ${w * 3} ${w} ${w * 3}` } as Record<string, string>)[dashTok] ?? `${w * 4} ${w * 3}`;
    const head = P.getShapeStrokeArrow(shape, "head")?.type, tail = P.getShapeStrokeArrow(shape, "tail")?.type;
    return { color: themeColor(ctx, s.color) ?? "#000", width: w, dash, head: head && head !== "none" ? head : undefined, tail: tail && tail !== "none" ? tail : undefined, opacity: P.getShapeStrokeOpacity(shape) ?? undefined };
  } catch { return null; }
}

function shadowCss(ctx: RenderCtx, shape: SlideShapeData): string | undefined {
  try {
    const e = P.getShapeEffectsEffective(ctx.pres, shape).find(x => x.kind === "outerShdw");
    if (!e || e.kind !== "outerShdw") return undefined;
    const a = (e.angleDeg * Math.PI) / 180, d = emuPx(e.distEmu);
    const col = themeColor(ctx, e.color) ?? "#000";
    return `drop-shadow(${r2(d * Math.cos(a))}px ${r2(d * Math.sin(a))}px ${r2(emuPx(e.blurEmu) / 2)}px ${col}${Math.round((e.opacity ?? 0.5) * 255).toString(16).padStart(2, "0")})`;
  } catch { return undefined; }
}

function geometrySvg(ctx: RenderCtx, shape: SlideShapeData, w: number, h: number, connector: boolean): string {
  const prst = P.getShapePreset(shape);
  let geo = prst !== null || connector ? presetPath(prst ?? "line", w, h, P.getShapeAdjustValues(shape)) : null;
  if (!geo) { const cg = P.getShapeCustomGeometry(shape); geo = cg ? customPath(cg, w, h) : presetPath("rect", w, h); }
  if (!geo.known && prst) issue(ctx, "log.preset", { prst });
  const paint = connector || geo.open ? { fill: "none", defs: "" } : fillPaint(ctx, shape);
  const ln = linePaint(ctx, shape) ?? (connector ? { color: "#000", width: 1 } : null);
  let defs = paint.defs;
  const mk = (id: string, type: string, color: string) => {
    const t = type;
    const path = t === "oval" ? "<circle cx='5' cy='5' r='4'/>" : t === "diamond" ? "<path d='M5 0L10 5L5 10L0 5Z'/>" : "<path d='M0 0L10 5L0 10Z'/>";
    return `<marker id="${id}" viewBox="0 0 10 10" refX="${t === "arrow" ? 7 : 5}" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse" fill="${t === "arrow" ? "none" : color}" stroke="${color}">${path}</marker>`;
  };
  let marks = "";
  if (ln?.head) { const id = `mh${++gid}`; defs += mk(id, ln.head, ln.color); marks += ` marker-start="url(#${id})"`; }
  if (ln?.tail) { const id = `mt${++gid}`; defs += mk(id, ln.tail, ln.color); marks += ` marker-end="url(#${id})"`; }
  const stroke = ln ? ` stroke="${ln.color}" stroke-width="${r2(ln.width)}"${ln.dash ? ` stroke-dasharray="${ln.dash}"` : ""}${ln.opacity !== undefined ? ` stroke-opacity="${ln.opacity}"` : ""} stroke-linejoin="round"` : "";
  const fo = paint.opacity !== undefined ? ` fill-opacity="${paint.opacity}"` : "";
  const vw = Math.max(1, r2(w)), vh = Math.max(1, r2(h)); // garis lurus punya tinggi/lebar 0: SVG berdimensi 0 tidak digambar
  return `<svg class="px-geom" width="${vw}" height="${vh}" viewBox="0 0 ${vw} ${vh}" overflow="visible"><defs>${defs}</defs><path d="${geo.d}" fill="${paint.fill}"${fo} fill-rule="evenodd"${stroke}${marks}/></svg>`;
}

// ───────── teks ─────────

function fontFamily(ctx: RenderCtx, name: string | undefined): string | undefined {
  if (!name) return undefined;
  let n = name;
  if (n.startsWith("+mj")) n = ctx.fonts?.majorLatin ?? "Calibri Light";
  else if (n.startsWith("+mn")) n = ctx.fonts?.minorLatin ?? "Calibri";
  const q = `'${n.replace(/'/g, "")}'`;
  if (/mono|courier|consol/i.test(n)) return `${q}, monospace`;
  if (/times|georgia|garamond|cambria|serif/i.test(n) && !/sans/i.test(n)) return `${q}, serif`;
  return `${q}, Calibri, Carlito, Arial, sans-serif`;
}

function runCss(ctx: RenderCtx, f: ReadTextFormat | null, scale: number): string {
  if (!f) return "";
  const css: string[] = [];
  const ff = fontFamily(ctx, f.font);
  if (ff) css.push(`font-family:${ff}`);
  if (f.size) css.push(`font-size:${r2(pt2px(f.size * scale))}px`);
  if (f.bold) css.push("font-weight:700");
  if (f.italic) css.push("font-style:italic");
  const deco: string[] = [];
  if (f.underline) deco.push("underline");
  if (f.strike && f.strike !== "noStrike") deco.push("line-through");
  if (deco.length) css.push(`text-decoration:${deco.join(" ")}`);
  const c = themeColor(ctx, f.color);
  if (c) css.push(`color:${c}`);
  const hl = themeColor(ctx, f.highlight);
  if (hl) css.push(`background:${hl}`);
  if (f.spc) css.push(`letter-spacing:${r2(pt2px(f.spc / 100))}px`);
  if (f.baseline) css.push(`vertical-align:${f.baseline > 0 ? "super" : "sub"};font-size:${r2(pt2px((f.size ?? 18) * scale * 0.65))}px`);
  if (f.cap === "all") css.push("text-transform:uppercase");
  else if (f.cap === "small") css.push("font-variant:small-caps");
  return css.join(";");
}

function toAlpha(n: number, upper: boolean) { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return upper ? s : s.toLowerCase(); }
function toRoman(n: number) { const t: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]]; let s = ""; for (const [v, r] of t) while (n >= v) { s += r; n -= v; } return s; }
export function autoNum(scheme: string, n: number): string {
  const wrap = (s: string) => (/ParenBoth/.test(scheme) ? `(${s})` : /ParenR/.test(scheme) ? `${s})` : /Period/.test(scheme) ? `${s}.` : s);
  if (/^alphaLc/.test(scheme)) return wrap(toAlpha(n, false));
  if (/^alphaUc/.test(scheme)) return wrap(toAlpha(n, true));
  if (/^romanLc/.test(scheme)) return wrap(toRoman(n).toLowerCase());
  if (/^romanUc/.test(scheme)) return wrap(toRoman(n));
  return wrap(String(n));
}

interface TextArea { shape: SlideShapeData; w: number; h: number; rotated?: boolean }

/** Isi `host` dengan paragraf teks bentuk. Mengembalikan jumlah paragraf. */
export function renderParagraphs(ctx: RenderCtx, shape: SlideShapeData, host: HTMLElement, opt?: { forceDefaultSize?: number }): number {
  let n = 0;
  try { n = P.getShapeParagraphCount(shape); } catch { return 0; }
  const fit = (() => { try { return P.getShapeTextAutoFitParams(shape); } catch { return null; } })();
  const scale = fit?.fontScale ?? 1;
  const counters: number[] = [];
  let firstRunFmt: ReadTextFormat | null = null;
  for (let i = 0; i < n; i++) {
    try { if (P.getShapeRunCount(shape, i) > 0) { firstRunFmt = P.getShapeRunFormatEffective(ctx.pres, shape, i, 0); break; } } catch { /* abaikan */ }
  }
  for (let i = 0; i < n; i++) {
    const pEl = el(ctx, "div", "px-p");
    let props: ReturnType<typeof P.getParagraphPropertiesEffective> | null = null;
    try { props = P.getParagraphPropertiesEffective(ctx.pres, shape, i); } catch { /* abaikan */ }
    const els: ReturnType<typeof P.getShapeParagraphElements> = (() => { try { return P.getShapeParagraphElements(shape, i); } catch { return []; } })();
    const lvl = props?.level ?? 0;
    const st: string[] = [];
    const al = props?.align;
    st.push(`text-align:${al === "ctr" || al === "center" ? "center" : al === "r" || al === "right" ? "right" : al === "just" || al === "dist" || al === "justify" || al === "justLow" ? "justify" : "left"}`);
    const marL = props?.marL ?? 0, ind = props?.indent ?? 0;
    const bullet = props?.bullet && props.bullet !== "none" ? props.bullet : null;
    st.push(`margin-left:${r2(emuPx(marL))}px`);
    if (bullet) st.push(`text-indent:${r2(emuPx(ind))}px`);
    if (props?.spcBefPts) st.push(`margin-top:${r2(pt2px(props.spcBefPts))}px`);
    if (props?.spcAftPts) st.push(`margin-bottom:${r2(pt2px(props.spcAftPts))}px`);
    const ls = props?.lineSpacing;
    if (ls) st.push(ls.kind === "pct" ? `line-height:${r2(Math.max(0.5, ls.value - (fit?.lnSpcReduction ?? 0)) * 1.2)}` : `line-height:${r2(pt2px(ls.value))}px`);
    else st.push("line-height:1.2");
    if (props?.rtl) st.push("direction:rtl");
    pEl.setAttribute("style", st.join(";"));
    // penanda
    let runIdx = 0;
    let baseFmt: ReadTextFormat | null = null;
    const firstR = els.findIndex(e => e.kind === "r");
    if (firstR >= 0) { try { baseFmt = P.getShapeRunFormatEffective(ctx.pres, shape, i, 0); } catch { /* abaikan */ } }
    const fmtForMarker = baseFmt ?? firstRunFmt;
    if (bullet) {
      counters.length = lvl + 1;
      let txt = "•";
      if (typeof bullet === "object" && "char" in bullet) { counters[lvl] = 0; txt = bullet.char; }
      else if (typeof bullet === "object" && "autoNum" in bullet) { counters[lvl] = (counters[lvl] ?? 0) + 1; txt = autoNum(bullet.autoNum, counters[lvl]); }
      else if (bullet === "number") { counters[lvl] = (counters[lvl] ?? 0) + 1; txt = autoNum("arabicPeriod", counters[lvl]); }
      else { counters[lvl] = 0; txt = "•"; }
      const m = el(ctx, "span", "px-bullet");
      m.textContent = txt;
      m.setAttribute("style", `display:inline-block;min-width:${r2(Math.max(10, -emuPx(ind)))}px;text-indent:0;${runCss(ctx, fmtForMarker ? { ...fmtForMarker, underline: false, bold: false, italic: false } : null, scale)}`);
      m.contentEditable = "false";
      pEl.appendChild(m);
    } else { counters.length = 0; }
    let visible = false;
    for (const e of els) {
      if (e.kind === "br") { pEl.appendChild(ctx.doc.createElement("br")); continue; }
      let fmt: ReadTextFormat | null = e.format;
      if (e.kind === "r") {
        try { fmt = P.getShapeRunFormatEffective(ctx.pres, shape, i, runIdx); } catch { /* pakai format eksplisit */ }
        runIdx++;
      }
      const span = el(ctx, "span", "px-r");
      span.textContent = e.text;
      let link: string | null = null;
      if (e.kind === "r") { try { link = P.getShapeRunHyperlink(shape, i, runIdx - 1); } catch { /* abaikan */ } }
      let css = runCss(ctx, opt?.forceDefaultSize ? { ...(fmt ?? {}), size: opt.forceDefaultSize } : fmt, scale);
      if (link) { css += ";text-decoration:underline"; if (!/color:/.test(css)) css += `;color:${themeColor(ctx, ctx.theme?.hyperlink) ?? "#0563c1"}`; span.dataset.href = link; span.title = link; }
      span.setAttribute("style", css);
      if (e.text) visible = true;
      pEl.appendChild(span);
    }
    if (!visible && !pEl.querySelector("br")) {
      // paragraf kosong: pertahankan tinggi baris dengan ukuran akhir paragraf
      let endFmt: ReadTextFormat | null = null;
      try { endFmt = P.getParagraphEndFormat(shape, i); } catch { /* abaikan */ }
      const size = endFmt?.size ?? fmtForMarker?.size ?? 18;
      const sp = el(ctx, "span", "px-r px-empty");
      sp.setAttribute("style", `font-size:${r2(pt2px(size * scale))}px`);
      sp.innerHTML = "&#8203;";
      pEl.appendChild(sp);
    }
    host.appendChild(pEl);
  }
  return n;
}

function renderText(ctx: RenderCtx, shape: SlideShapeData, box: HTMLElement, w: number, h: number, placeholder: boolean) {
  const body = (() => { try { return P.getShapeBodyPrEffective(ctx.pres, shape); } catch { return null; } })();
  const m = body?.margins;
  const t = el(ctx, "div", "px-text");
  const pad = [m?.top ?? 45720, m?.right ?? 91440, m?.bottom ?? 45720, m?.left ?? 91440].map(v => r2(emuPx(v))).join("px ") + "px";
  const anchor = body?.anchor ?? (placeholder ? null : "top");
  t.setAttribute("style", `padding:${pad};justify-content:${anchor === "center" ? "center" : anchor === "bottom" ? "flex-end" : "flex-start"};${body?.wrap === "none" ? "white-space:nowrap;" : ""}`);
  const dir = body?.vert;
  if (dir) t.style.writingMode = dir === "vert270" ? "vertical-lr" : "vertical-rl";
  const n = renderParagraphs(ctx, shape, t);
  const text = (() => { try { return P.getShapeText(shape); } catch { return ""; } })();
  if (n === 0 || (!text && placeholder && ctx.interactive)) {
    const type = P.getShapePlaceholderType(shape);
    if (placeholder && ctx.interactive && type) {
      const prompt = el(ctx, "div", "px-prompt");
      prompt.textContent = ctx.prompts[type] ?? ctx.prompts.default ?? "";
      prompt.dataset.skip = "1";
      t.appendChild(prompt);
    }
  }
  if (t.childNodes.length) box.appendChild(t);
  void w; void h;
}

// ───────── gambar ─────────

const MIME: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", tiff: "image/tiff", webp: "image/webp", svg: "image/svg+xml" };
export const imgMime = (f: string) => MIME[f] ?? "image/png";

/** Bingkai OLE: tampilkan gambar pratinjau + lencana. Mengembalikan false bila shape bukan objek OLE. */
function renderOleFrame(ctx: RenderCtx, shape: SlideShapeData, box: HTMLElement): boolean {
  let info: ReturnType<typeof readOleFrame> = null;
  try { info = readOleFrame(shape); } catch { return false; }
  if (!info) return false;
  box.classList.add("px-ole");
  box.dataset.progId = info.progId;
  const pv = oleFramePreview(ctx.pres, P.getShapeSlide(shape), info);
  if (pv) {
    const img = el(ctx, "img");
    img.draggable = false;
    img.src = ctx.imgUrl(pv.bytes, pv.format);
    img.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:fill";
    box.appendChild(img);
  } else {
    const ph = el(ctx, "div", "px-ph");
    ph.textContent = `📎 ${info.progId || "OLE"}`;
    box.appendChild(ph);
    issue(ctx, "log.olePreview", { name: P.getShapeName(shape) });
  }
  const badge = el(ctx, "span", "px-ole-badge");
  badge.textContent = "OLE";
  box.appendChild(badge);
  box.title = `OLE: ${info.progId || "?"}${info.linked ? " (link)" : ""}`;
  return true;
}

function renderPicture(ctx: RenderCtx, shape: SlideShapeData, box: HTMLElement, w: number, h: number) {
  const bytes = P.getShapeImageBytes(shape);
  const fmt = P.getShapeImageFormat(shape) ?? "png";
  let media: ReturnType<typeof P.getShapeMedia> = null;
  try { media = P.getShapeMedia(shape); } catch { /* bukan media */ }
  if (!bytes || fmt === "tiff") {
    const ph = el(ctx, "div", "px-ph");
    ph.textContent = `🖼 ${P.getShapeName(shape)}${fmt === "tiff" ? " (tiff)" : ""}`;
    box.appendChild(ph);
    if (fmt === "tiff") issue(ctx, "log.imgFormat", { fmt });
    return;
  }
  const wrap = el(ctx, "div", "px-pic");
  wrap.style.overflow = "hidden";
  const img = el(ctx, "img");
  img.draggable = false;
  img.src = ctx.imgUrl(bytes, fmt);
  const crop = P.getShapeImageCrop(shape);
  const l = crop?.left ?? 0, t = crop?.top ?? 0, r = crop?.right ?? 0, b = crop?.bottom ?? 0;
  const vw = 1 - l - r, vh = 1 - t - b;
  img.style.cssText = `position:absolute;max-width:none;width:${r2(w / Math.max(0.01, vw))}px;height:${r2(h / Math.max(0.01, vh))}px;left:${r2(-(l / Math.max(0.01, vw)) * w)}px;top:${r2(-(t / Math.max(0.01, vh)) * h)}px;`;
  const filters: string[] = [];
  const br = P.getShapeImageBrightness(shape), ct = P.getShapeImageContrast(shape);
  if (br) filters.push(`brightness(${r2(1 + br)})`);
  if (ct) filters.push(`contrast(${r2(1 + ct)})`);
  if (P.isShapeImageGrayscale(shape)) filters.push("grayscale(1)");
  if (filters.length) img.style.filter = filters.join(" ");
  const op = P.getShapeImageOpacity(shape);
  if (op !== null && op < 1) img.style.opacity = String(op);
  wrap.appendChild(img);
  box.appendChild(wrap);
  if (media) {
    const badge = el(ctx, "div", "px-media");
    badge.textContent = media.kind === "online" ? "▶ online" : media.kind === "audio" ? "♪" : "▶";
    box.appendChild(badge);
  }
  // bingkai gambar (outline) bila ada
  const ln = linePaint(ctx, shape);
  if (ln) box.style.outline = `${r2(ln.width)}px solid ${ln.color}`;
}

// ───────── tabel ─────────

function renderTable(ctx: RenderCtx, shape: SlideShapeData, box: HTMLElement, w: number, h: number) {
  const dims = P.getTableDimensions(shape);
  const cols = P.getTableColumnWidths(shape).map(emuPx), rows = P.getTableRowHeights(shape).map(emuPx);
  const flags = P.getTableStyleFlags(shape);
  const acc = themeColor(ctx, ctx.theme?.accent1) ?? "#4472C4";
  const tbl = el(ctx, "table", "px-table");
  const sumW = cols.reduce((a, b) => a + b, 0) || w;
  tbl.style.cssText = `width:${r2(sumW)}px;height:${r2(Math.max(h, rows.reduce((a, b) => a + b, 0)))}px;table-layout:fixed;border-collapse:collapse;`;
  const cg = el(ctx, "colgroup");
  for (const c of cols) { const col = ctx.doc.createElement("col"); col.style.width = `${r2(c)}px`; cg.appendChild(col); }
  tbl.appendChild(cg);
  const cells = P.getTableCells(shape);
  for (let r = 0; r < dims.rows; r++) {
    const tr = ctx.doc.createElement("tr");
    tr.style.height = `${r2(rows[r] ?? 30)}px`;
    for (let c = 0; c < dims.cols; c++) {
      const cell = cells[r]?.[c] as TableCellData;
      if (!cell) continue;
      const span = P.getTableCellSpan(cell);
      if (span.hMerge || span.vMerge) continue;
      const td = ctx.doc.createElement("td");
      if (span.gridSpan > 1) td.colSpan = span.gridSpan;
      if (span.rowSpan > 1) td.rowSpan = span.rowSpan;
      const fill = P.getTableCellFill(cell);
      const isHead = flags.firstRow && r === 0;
      const band = flags.bandRow && r > 0 && r % 2 === 1;
      let css = `padding:${r2(emuPx((P.getTableCellMargins(cell).top ?? 45720)))}px ${r2(emuPx(P.getTableCellMargins(cell).right ?? 91440))}px ${r2(emuPx(P.getTableCellMargins(cell).bottom ?? 45720))}px ${r2(emuPx(P.getTableCellMargins(cell).left ?? 91440))}px;vertical-align:${P.getTableCellAnchor(cell) === "center" ? "middle" : P.getTableCellAnchor(cell) === "bottom" ? "bottom" : "top"};overflow:hidden;`;
      const bg = themeColor(ctx, fill) ?? (isHead ? acc : band ? acc + "33" : (r > 0 ? acc + "1a" : undefined));
      if (bg) css += `background:${bg};`;
      const bd = P.getTableCellBorders(ctx.pres, cell);
      for (const [k, v] of [["left", bd.left], ["right", bd.right], ["top", bd.top], ["bottom", bd.bottom]] as const) {
        css += v ? `border-${k}:${r2(Math.max(1, emuPx(v.widthEmu ?? 12700)))}px solid ${themeColor(ctx, v.color) ?? "#000"};` : `border-${k}:1px solid ${isHead || fill ? "#ffffff66" : "#ffffffcc"};`;
      }
      td.setAttribute("style", css);
      td.dataset.r = String(r); td.dataset.c = String(c);
      for (const p of P.getTableCellParagraphs(cell)) {
        const pe = el(ctx, "div", "px-p");
        pe.style.cssText = `text-align:${p.align === "ctr" ? "center" : p.align === "r" ? "right" : "left"};line-height:1.2;`;
        let any = false;
        for (const e of p.elements) {
          if (e.kind === "br") { pe.appendChild(ctx.doc.createElement("br")); continue; }
          const fm: ReadTextFormat = { size: 18, color: isHead ? "#FFFFFF" : "#000000", bold: isHead, ...Object.fromEntries(Object.entries(e.format ?? {}).filter(([, v]) => v !== undefined && v !== null)) };
          const sp = el(ctx, "span", "px-r");
          sp.textContent = e.text;
          sp.setAttribute("style", runCss(ctx, fm, 1));
          if (e.text) any = true;
          pe.appendChild(sp);
        }
        if (!any) { const sp = el(ctx, "span", "px-r"); sp.setAttribute("style", `font-size:${pt2px(p.endFormat?.size ?? 18)}px`); sp.innerHTML = "&#8203;"; pe.appendChild(sp); }
        td.appendChild(pe);
      }
      tr.appendChild(td);
    }
    tbl.appendChild(tr);
  }
  box.appendChild(tbl);
}

// ───────── satu bentuk ─────────

export interface Rect { x: number; y: number; w: number; h: number }
type MapRect = (b: { x: number; y: number; w: number; h: number }) => Rect;

export function renderShape(ctx: RenderCtx, shape: SlideShapeData, parent: HTMLElement, map: MapRect, top: boolean, resolved = true): HTMLElement | null {
  let kind: ReturnType<typeof P.getShapeKind>;
  try { kind = P.getShapeKind(shape); } catch { return null; }
  if (P.isShapeHidden(shape) && !ctx.interactive) return null;
  const b = resolved ? P.getShapeBoundsResolved(ctx.pres, shape) : P.getShapeBounds(shape);
  if (!b) return null;
  const rc = map({ x: b.x, y: b.y, w: b.w, h: b.h });
  const box = el(ctx, "div", `px-shape px-k-${kind}`);
  box.dataset.id = String(P.getShapeId(shape));
  const rot = P.getShapeRotation(shape), flip = P.getShapeFlip(shape);
  let tf = "";
  if (rot) tf += `rotate(${rot}deg) `;
  if (flip && (flip.horizontal || flip.vertical)) tf += `scale(${flip.horizontal ? -1 : 1},${flip.vertical ? -1 : 1})`;
  box.setAttribute("style", `left:${r2(rc.x)}px;top:${r2(rc.y)}px;width:${r2(rc.w)}px;height:${r2(rc.h)}px;${tf ? `transform:${tf};` : ""}`);
  if (P.isShapeHidden(shape)) box.classList.add("px-hidden");
  const sh = shadowCss(ctx, shape);
  if (sh) box.style.filter = sh;
  const placeholder = P.isShapePlaceholder(shape);
  try {
    if (kind === "group") {
      const gt = P.getGroupTransform(shape);
      const inner = gt?.inner ?? b;
      const sx = inner.w ? rc.w / emuPx(inner.w) : 1, sy = inner.h ? rc.h / emuPx(inner.h) : 1;
      for (const ch of P.getGroupChildren(shape)) renderShape(ctx, ch, box, bb => ({ x: (emuPx(bb.x) - emuPx(inner.x)) * sx, y: (emuPx(bb.y) - emuPx(inner.y)) * sy, w: emuPx(bb.w) * sx, h: emuPx(bb.h) * sy }), false, false);
    } else if (kind === "picture") renderPicture(ctx, shape, box, rc.w, rc.h);
    else if (kind === "graphicFrame") {
      if (P.isTableShape(shape)) renderTable(ctx, shape, box, rc.w, rc.h);
      else if (P.isChartShape(shape)) {
        const spec = P.getShapeChartSpec(shape);
        const c = el(ctx, "div", "px-chart");
        if (spec) c.innerHTML = chartSvg(spec, Math.max(40, rc.w), Math.max(40, rc.h), paletteOf(ctx));
        else c.textContent = "📊";
        box.appendChild(c);
      } else if (!renderOleFrame(ctx, shape, box)) {
        const ph = el(ctx, "div", "px-ph");
        ph.textContent = `◻ ${P.getShapeName(shape)}`;
        box.appendChild(ph);
        issue(ctx, "log.frame", { name: P.getShapeName(shape) });
      }
    } else {
      box.insertAdjacentHTML("afterbegin", geometrySvg(ctx, shape, rc.w, rc.h, kind === "connector"));
      if (kind === "shape") renderText(ctx, shape, box, rc.w, rc.h, placeholder);
    }
  } catch (e) {
    issue(ctx, "log.shapeFail", { name: P.getShapeName(shape), msg: e instanceof Error ? e.message : String(e) });
  }
  if (placeholder && top && ctx.interactive) box.classList.add("px-placeholder");
  parent.appendChild(box);
  if (top) { ctx.reg.set(box, shape); ctx.domOf.set(shape, box); }
  return box;
}

// ───────── latar & slide ─────────

function backgroundCss(ctx: RenderCtx, slide: SlideData): string {
  const layout = P.getSlideLayout(slide);
  const pick = (): string | null => {
    const tryBg = (bg: { kind: string; color?: string }, grad: () => ReturnType<typeof P.getSlideBackgroundGradientFill>, img: () => Uint8Array | null, pat: () => { preset: string; foreground: string; background: string } | null): string | null => {
      if (bg.kind === "solid") return themeColor(ctx, bg.color) ?? "#fff";
      if (bg.kind === "gradient") { const g = grad(); if (g) return `linear-gradient(${90 + (g.angleDeg ?? 90)}deg, ${g.stops.map(s => `${themeColor(ctx, s.color)} ${r2(s.offset * 100)}%`).join(",")})`; }
      if (bg.kind === "image") { const b = img(); if (b) return `url(${ctx.imgUrl(b, "png")}) center/cover no-repeat`; }
      if (bg.kind === "pattern") { const p = pat(); if (p) return themeColor(ctx, p.background) ?? "#fff"; }
      return null;
    };
    const s = tryBg(P.getSlideBackground(slide), () => P.getSlideBackgroundGradientFill(slide), () => P.getSlideBackgroundImageBytes(slide), () => P.getSlideBackgroundPatternFill(ctx.pres, slide));
    if (s) return s;
    if (layout) {
      const l = tryBg(P.getSlideLayoutBackground(layout), () => P.getSlideLayoutBackgroundGradientFill(layout), () => P.getSlideLayoutBackgroundImageBytes(ctx.pres, layout), () => P.getSlideLayoutBackgroundPatternFill(ctx.pres, layout));
      if (l) return l;
      const m = tryBg(P.getSlideMasterBackground(ctx.pres, layout), () => P.getSlideMasterBackgroundGradientFill(ctx.pres, layout), () => P.getSlideMasterBackgroundImageBytes(ctx.pres, layout), () => P.getSlideMasterBackgroundPatternFill(ctx.pres, layout));
      if (m) return m;
    }
    return null;
  };
  try { return pick() ?? "#ffffff"; } catch { return "#ffffff"; }
}

/** Bentuk tingkat-atas saja: `getSlideShapes` meratakan anak grup, sehingga anak-anak (turunan) dibuang di sini. */
export function topShapes(slide: SlideData): SlideShapeData[] {
  const all = P.getSlideShapes(slide);
  const nested = new Set<number>();
  const walk = (g: SlideShapeData) => { for (const c of P.getGroupChildren(g)) { nested.add(P.getShapeId(c)); if (P.getShapeKind(c) === "group") walk(c); } };
  for (const s of all) if (P.getShapeKind(s) === "group") walk(s);
  return nested.size ? all.filter(s => !nested.has(P.getShapeId(s))) : [...all];
}

/** Render seluruh slide ke elemen `.px-slide` (ukuran px = EMU/9525). */
export function renderSlide(ctx: RenderCtx, slide: SlideData): HTMLElement {
  const size = P.getSlideSize(ctx.pres) ?? { width: 12192000, height: 6858000 };
  const W = emuPx(size.width), H = emuPx(size.height);
  const root = el(ctx, "div", "px-slide");
  root.style.width = `${r2(W)}px`;
  root.style.height = `${r2(H)}px`;
  root.style.background = backgroundCss(ctx, slide);
  const identity: MapRect = b => ({ x: emuPx(b.x), y: emuPx(b.y), w: emuPx(b.w), h: emuPx(b.h) });
  // bentuk layout & master (non-placeholder) di bawah
  const under = el(ctx, "div", "px-layer px-under");
  const layout = P.getSlideLayout(slide);
  if (layout) {
    const saveInteractive = ctx.interactive;
    ctx.interactive = false;
    try {
      for (const s of P.getSlideMasterShapes(ctx.pres, layout)) if (!P.isShapePlaceholder(s)) renderShape(ctx, s, under, identity, false, false);
      for (const s of P.getSlideLayoutShapes(ctx.pres, layout)) if (!P.isShapePlaceholder(s)) renderShape(ctx, s, under, identity, false, false);
    } catch (e) { issue(ctx, "log.layoutFail", { msg: e instanceof Error ? e.message : String(e) }); }
    ctx.interactive = saveInteractive;
  }
  root.appendChild(under);
  const layer = el(ctx, "div", "px-layer px-shapes");
  for (const s of topShapes(slide)) renderShape(ctx, s, layer, identity, true, true);
  // objek OLE buatan PowerPoint dibungkus mc:AlternateContent dan tidak dikenal library sebagai shape → kotak statis (dapat diganti isinya, belum dapat dipindah)
  try {
    for (const f of scanSlideOle(slide)) if (!f.direct) renderStaticOle(ctx, slide, f, layer);
  } catch (e) { issue(ctx, "log.shapeFail", { name: "OLE", msg: e instanceof Error ? e.message : String(e) }); }
  root.appendChild(layer);
  return root;
}

function renderStaticOle(ctx: RenderCtx, slide: SlideData, f: RawOleFrame, parent: HTMLElement) {
  const box = el(ctx, "div", "px-shape px-ole px-ole-static");
  box.dataset.oleId = String(f.id);
  box.dataset.progId = f.progId;
  box.style.cssText = `position:absolute;left:${r2(emuPx(f.bounds.x))}px;top:${r2(emuPx(f.bounds.y))}px;width:${r2(emuPx(f.bounds.w))}px;height:${r2(emuPx(f.bounds.h))}px`;
  const pv = oleFramePreview(ctx.pres, slide, f);
  if (pv) {
    const img = el(ctx, "img");
    img.draggable = false;
    img.src = ctx.imgUrl(pv.bytes, pv.format);
    img.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:fill";
    box.appendChild(img);
  } else {
    const ph = el(ctx, "div", "px-ph");
    ph.textContent = `📎 ${f.progId || "OLE"}`;
    box.appendChild(ph);
    issue(ctx, "log.olePreview", { name: f.name || `Object ${f.id}` });
  }
  const badge = el(ctx, "span", "px-ole-badge");
  badge.textContent = "OLE";
  box.appendChild(badge);
  box.title = `OLE: ${f.progId || "?"}${f.linked ? " (link)" : ""}`;
  parent.appendChild(box);
}

