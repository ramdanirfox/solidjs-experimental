/**
 * Resolusi style OOXML (docDefaults → style chain → table style → numbering → direct) menjadi properti terstruktur
 * dan CSS. Mencakup tema (warna + font), tint/shade, border/shading, dan conditional formatting style tabel.
 */
import { NS, attr, els, first, num, onOff, parseXmlString, val, type XEl } from "./docx-xml";

export const twipPx = (tw: number) => (tw * 96) / 1440;
export const ptPx = (pt: number) => (pt * 96) / 72;
export const emuPx = (emu: number) => emu / 9525;
export const pxEmu = (px: number) => Math.round(px * 9525);
export const pxTwip = (px: number) => Math.round((px * 1440) / 96);

export interface Border { val: string; sz: number; color?: string; space?: number }
export interface Shd { fill?: string; val?: string; color?: string }
export interface Borders { top?: Border; left?: Border; bottom?: Border; right?: Border; insideH?: Border; insideV?: Border; between?: Border; bar?: Border }
export interface TabStop { pos: number; val: string; leader?: string }

export interface PProps {
  jc?: string;
  indLeft?: number; indRight?: number; indFirst?: number; indHanging?: number;
  before?: number; after?: number; line?: number; lineRule?: string; beforeAuto?: boolean; afterAuto?: boolean;
  keepNext?: boolean; keepLines?: boolean; pageBreakBefore?: boolean; widow?: boolean;
  shd?: Shd; bdr?: Borders;
  numId?: number; ilvl?: number;
  tabs?: TabStop[];
  outline?: number; ctxSpacing?: boolean; bidi?: boolean;
}
export interface RProps {
  b?: boolean; i?: boolean; strike?: boolean; dstrike?: boolean; caps?: boolean; smallCaps?: boolean; vanish?: boolean;
  u?: string; uColor?: string; color?: string; sz?: number;
  fAscii?: string; fHAnsi?: string; fEa?: string; fCs?: string;
  highlight?: string; shd?: Shd; vert?: string; spacing?: number; position?: number; scale?: number;
  rtl?: boolean; emboss?: boolean; imprint?: boolean; outline?: boolean; shadow?: boolean; lang?: string; border?: Border;
}
export interface Mar { top?: number; left?: number; bottom?: number; right?: number }
export interface TCond { p?: PProps; r?: RProps; borders?: Borders; shd?: Shd; mar?: Mar; vAlign?: string }

export interface Theme { colors: Record<string, string>; major?: string; minor?: string; majorEa?: string; minorEa?: string }

const THEME_MAP: Record<string, string> = {
  dark1: "dk1", light1: "lt1", dark2: "dk2", light2: "lt2", text1: "dk1", background1: "lt1", text2: "dk2", background2: "lt2",
  accent1: "accent1", accent2: "accent2", accent3: "accent3", accent4: "accent4", accent5: "accent5", accent6: "accent6",
  hyperlink: "hlink", followedHyperlink: "folHlink",
};

export function parseTheme(xml: string | undefined): Theme {
  const t: Theme = { colors: { dk1: "000000", lt1: "FFFFFF", dk2: "44546A", lt2: "E7E6E6", accent1: "4472C4", accent2: "ED7D31", accent3: "A5A5A5", accent4: "FFC000", accent5: "5B9BD5", accent6: "70AD47", hlink: "0563C1", folHlink: "954F72" } };
  if (!xml) return t;
  try {
    const root = parseXmlString(xml);
    const te = first(root, "themeElements");
    const cs = first(te, "clrScheme");
    if (cs) for (const c of els(cs)) {
      const k = c.name.local;
      const s = first(c, "srgbClr");
      const sys = first(c, "sysClr");
      const v = s ? attr(s, "val") : sys ? attr(sys, "lastClr") ?? attr(sys, "val") : undefined;
      if (v && /^[0-9a-fA-F]{6}$/.test(v)) t.colors[k] = v.toUpperCase();
    }
    const fs = first(te, "fontScheme");
    if (fs) {
      t.major = attr(first(first(fs, "majorFont"), "latin"), "typeface") || undefined;
      t.minor = attr(first(first(fs, "minorFont"), "latin"), "typeface") || undefined;
      t.majorEa = attr(first(first(fs, "majorFont"), "ea"), "typeface") || undefined;
      t.minorEa = attr(first(first(fs, "minorFont"), "ea"), "typeface") || undefined;
    }
  } catch { /* tema rusak: pakai default */ }
  return t;
}

const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
function applyTintShade(rgb: string, tint?: string, shade?: string): string {
  let r = parseInt(rgb.slice(0, 2), 16), g = parseInt(rgb.slice(2, 4), 16), b = parseInt(rgb.slice(4, 6), 16);
  if (tint) { const t = parseInt(tint, 16) / 255; r = 255 - (255 - r) * t; g = 255 - (255 - g) * t; b = 255 - (255 - b) * t; }
  if (shade) { const s = parseInt(shade, 16) / 255; r *= s; g *= s; b *= s; }
  return (hex(r) + hex(g) + hex(b)).toUpperCase();
}
/** Warna OOXML (hex / themeColor + tint/shade) → "RRGGBB" atau "auto". */
export function resolveColor(el: XEl | undefined, theme: Theme, valAttr = "val"): string | undefined {
  if (!el) return undefined;
  const tc = attr(el, "themeColor");
  if (tc) {
    const base = theme.colors[THEME_MAP[tc] ?? tc];
    if (base) return applyTintShade(base, attr(el, "themeTint"), attr(el, "themeShade"));
  }
  const v = attr(el, valAttr);
  if (!v) return undefined;
  if (v === "auto") return "auto";
  return /^[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : undefined;
}
export function resolveFill(el: XEl | undefined, theme: Theme): string | undefined {
  if (!el) return undefined;
  const tc = attr(el, "themeFill");
  if (tc) {
    const base = theme.colors[THEME_MAP[tc] ?? tc];
    if (base) return applyTintShade(base, attr(el, "themeFillTint"), attr(el, "themeFillShade"));
  }
  const v = attr(el, "fill");
  if (!v || v === "auto") return undefined;
  return /^[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : undefined;
}

export const HIGHLIGHT: Record<string, string> = {
  yellow: "#ffff00", green: "#00ff00", cyan: "#00ffff", magenta: "#ff00ff", blue: "#0000ff", red: "#ff0000", darkBlue: "#000080", darkCyan: "#008080",
  darkGreen: "#008000", darkMagenta: "#800080", darkRed: "#800000", darkYellow: "#808000", darkGray: "#808080", lightGray: "#c0c0c0", black: "#000000", white: "#ffffff",
};

function readBorder(el: XEl | undefined, theme: Theme): Border | undefined {
  if (!el) return undefined;
  const v = attr(el, "val");
  if (!v) return undefined;
  return { val: v, sz: num(attr(el, "sz")) ?? 4, color: resolveColor(el, theme, "color"), space: num(attr(el, "space")) };
}
export function readBorders(el: XEl | undefined, theme: Theme): Borders | undefined {
  if (!el) return undefined;
  const o: Borders = {};
  const m: [keyof Borders, string[]][] = [["top", ["top"]], ["left", ["left", "start"]], ["bottom", ["bottom"]], ["right", ["right", "end"]], ["insideH", ["insideH"]], ["insideV", ["insideV"]], ["between", ["between"]], ["bar", ["bar"]]];
  for (const [k, names] of m) for (const n of names) { const b = readBorder(first(el, n), theme); if (b) { o[k] = b; break; } }
  return Object.keys(o).length ? o : undefined;
}
export function readShd(el: XEl | undefined, theme: Theme): Shd | undefined {
  if (!el) return undefined;
  return { fill: resolveFill(el, theme), val: attr(el, "val"), color: resolveColor(el, theme, "color") };
}
export function readMar(el: XEl | undefined): Mar | undefined {
  if (!el) return undefined;
  const g = (a: string, b?: string) => num(attr(first(el, a) ?? (b ? first(el, b) : undefined), "w"));
  const m: Mar = { top: g("top"), left: g("left", "start"), bottom: g("bottom"), right: g("right", "end") };
  return Object.values(m).some(v => v !== undefined) ? m : undefined;
}

export function readP(pPr: XEl | undefined, theme: Theme): PProps {
  const o: PProps = {};
  if (!pPr) return o;
  const jc = val(pPr, "jc");
  if (jc) o.jc = jc;
  const ind = first(pPr, "ind");
  if (ind) {
    o.indLeft = num(attr(ind, "left") ?? attr(ind, "start"));
    o.indRight = num(attr(ind, "right") ?? attr(ind, "end"));
    o.indFirst = num(attr(ind, "firstLine"));
    o.indHanging = num(attr(ind, "hanging"));
    if (o.indHanging !== undefined && o.indFirst === undefined) o.indFirst = undefined;
    if (o.indFirst !== undefined && o.indHanging === undefined) o.indHanging = 0;
  }
  const sp = first(pPr, "spacing");
  if (sp) {
    o.before = num(attr(sp, "before")); o.after = num(attr(sp, "after")); o.line = num(attr(sp, "line")); o.lineRule = attr(sp, "lineRule");
    if (attr(sp, "beforeAutospacing") === "1") o.beforeAuto = true;
    if (attr(sp, "afterAutospacing") === "1") o.afterAuto = true;
  }
  o.keepNext = onOff(pPr, "keepNext"); o.keepLines = onOff(pPr, "keepLines"); o.pageBreakBefore = onOff(pPr, "pageBreakBefore");
  o.widow = onOff(pPr, "widowControl"); o.ctxSpacing = onOff(pPr, "contextualSpacing"); o.bidi = onOff(pPr, "bidi");
  const shd = first(pPr, "shd"); if (shd) o.shd = readShd(shd, theme);
  const bdr = readBorders(first(pPr, "pBdr"), theme); if (bdr) o.bdr = bdr;
  const np = first(pPr, "numPr");
  if (np) { o.numId = num(val(np, "numId")); o.ilvl = num(val(np, "ilvl")); }
  const tabs = first(pPr, "tabs");
  if (tabs) o.tabs = els(tabs, "tab").map(t => ({ pos: num(attr(t, "pos")) ?? 0, val: attr(t, "val") ?? "left", leader: attr(t, "leader") }));
  const ol = num(val(pPr, "outlineLvl")); if (ol !== undefined) o.outline = ol;
  return o;
}

export function readR(rPr: XEl | undefined, theme: Theme): RProps {
  const o: RProps = {};
  if (!rPr) return o;
  o.b = onOff(rPr, "b"); o.i = onOff(rPr, "i"); o.strike = onOff(rPr, "strike"); o.dstrike = onOff(rPr, "dstrike");
  o.caps = onOff(rPr, "caps"); o.smallCaps = onOff(rPr, "smallCaps"); o.vanish = onOff(rPr, "vanish");
  o.rtl = onOff(rPr, "rtl"); o.emboss = onOff(rPr, "emboss"); o.imprint = onOff(rPr, "imprint"); o.outline = onOff(rPr, "outline"); o.shadow = onOff(rPr, "shadow");
  const u = first(rPr, "u"); if (u) { o.u = attr(u, "val") ?? "single"; const uc = resolveColor(u, theme, "color"); if (uc) o.uColor = uc; }
  const c = first(rPr, "color"); if (c) o.color = resolveColor(c, theme);
  const sz = num(val(rPr, "sz")); if (sz !== undefined) o.sz = sz;
  const rf = first(rPr, "rFonts");
  if (rf) {
    const th = (n: string | undefined, ea = false) => !n ? undefined : n.startsWith("major") ? (ea ? theme.majorEa : theme.major) : n.startsWith("minor") ? (ea ? theme.minorEa : theme.minor) : undefined;
    o.fAscii = attr(rf, "ascii") ?? th(attr(rf, "asciiTheme"));
    o.fHAnsi = attr(rf, "hAnsi") ?? th(attr(rf, "hAnsiTheme"));
    o.fEa = attr(rf, "eastAsia") ?? th(attr(rf, "eastAsiaTheme"), true);
    o.fCs = attr(rf, "cs") ?? th(attr(rf, "cstheme"));
  }
  const hl = val(rPr, "highlight"); if (hl) o.highlight = hl;
  const shd = first(rPr, "shd"); if (shd) o.shd = readShd(shd, theme);
  const vert = val(rPr, "vertAlign"); if (vert) o.vert = vert;
  const sp = num(val(rPr, "spacing")); if (sp !== undefined) o.spacing = sp;
  const pos = num(val(rPr, "position")); if (pos !== undefined) o.position = pos;
  const w = num(val(rPr, "w")); if (w !== undefined) o.scale = w;
  const lang = first(rPr, "lang"); if (lang) o.lang = attr(lang, "val") ?? attr(lang, "eastAsia");
  const bd = readBorder(first(rPr, "bdr"), theme); if (bd) o.border = bd;
  return o;
}

const defined = <T extends object>(o: T): Partial<T> => { const r: Partial<T> = {}; for (const k in o) if (o[k] !== undefined) r[k] = o[k]; return r; };
export function mergeR(a: RProps, b: RProps | undefined): RProps { return b ? { ...a, ...defined(b) } : a; }
export function mergeP(a: PProps, b: PProps | undefined): PProps {
  if (!b) return a;
  const o = { ...a, ...defined(b) };
  if (a.bdr || b.bdr) o.bdr = { ...a.bdr, ...b.bdr };
  if (a.tabs || b.tabs) {
    const m = new Map<number, TabStop>();
    for (const t of a.tabs ?? []) m.set(t.pos, t);
    for (const t of b.tabs ?? []) { if (t.val === "clear") m.delete(t.pos); else m.set(t.pos, t); }
    o.tabs = [...m.values()].sort((x, y) => x.pos - y.pos);
  }
  if (b.indLeft !== undefined || b.indFirst !== undefined || b.indHanging !== undefined) {
    // firstLine & hanging saling meniadakan
    if (b.indHanging !== undefined && b.indHanging > 0) o.indFirst = undefined;
    else if (b.indFirst !== undefined && b.indFirst > 0) o.indHanging = undefined;
  }
  return o;
}
export function mergeBorders(a: Borders | undefined, b: Borders | undefined): Borders | undefined {
  if (!a) return b; if (!b) return a;
  return { ...a, ...b };
}

// ───────── font ─────────

const FONT_MAP: [RegExp, string][] = [
  [/^calibri/i, "Calibri, Carlito, 'Segoe UI', Arial, sans-serif"],
  [/^cambria/i, "Cambria, Caladea, Georgia, serif"],
  [/^times new roman/i, "'Times New Roman', Times, 'Liberation Serif', serif"],
  [/^arial/i, "Arial, Helvetica, 'Liberation Sans', sans-serif"],
  [/^courier new/i, "'Courier New', Courier, 'Liberation Mono', monospace"],
  [/^consolas/i, "Consolas, 'Courier New', monospace"],
  [/^segoe ui/i, "'Segoe UI', Tahoma, Arial, sans-serif"],
  [/^verdana/i, "Verdana, Geneva, sans-serif"],
  [/^tahoma/i, "Tahoma, Geneva, sans-serif"],
  [/^georgia/i, "Georgia, serif"],
  [/^garamond/i, "Garamond, 'EB Garamond', Georgia, serif"],
  [/^symbol|^wingdings|^webdings/i, "'Segoe UI Symbol', 'Noto Sans Symbols', sans-serif"],
];
export function fontStack(name: string | undefined): string | undefined {
  if (!name) return undefined;
  for (const [re, st] of FONT_MAP) if (re.test(name)) return st;
  const q = `'${name.replace(/'/g, "")}'`;
  if (/mono|courier|consol|code/i.test(name)) return `${q}, monospace`;
  if (/times|serif|georgia|garamond|book|palatino|minion|cambria|roman/i.test(name) && !/sans/i.test(name)) return `${q}, serif`;
  return `${q}, Calibri, Carlito, Arial, sans-serif`;
}

// ───────── CSS ─────────

export type Css = Record<string, string>;
const px = (n: number) => `${Math.round(n * 100) / 100}px`;

export function borderCss(b: Border | undefined): string | undefined {
  if (!b) return undefined;
  if (b.val === "none" || b.val === "nil") return "none";
  const w = Math.max(1, Math.round(((b.sz / 8) * 96) / 72 * 100) / 100);
  let style = "solid";
  let width = w;
  if (/double|thinThick|thickThin|triple/i.test(b.val)) { style = "double"; width = Math.max(3, w * 2.2); }
  else if (/dotted/i.test(b.val)) style = "dotted";
  else if (/dash/i.test(b.val)) style = "dashed";
  else if (/thick/i.test(b.val)) width = Math.max(2, w * 1.8);
  const color = !b.color || b.color === "auto" ? "#000" : `#${b.color}`;
  return `${px(width)} ${style} ${color}`;
}

export function rCss(r: RProps): Css {
  const c: Css = {};
  const fam = fontStack(r.fAscii ?? r.fHAnsi);
  if (fam) c["font-family"] = fam;
  if (r.sz !== undefined) c["font-size"] = px(ptPx(r.sz / 2) * (r.vert === "superscript" || r.vert === "subscript" ? 0.7 : 1));
  else if (r.vert === "superscript" || r.vert === "subscript") c["font-size"] = "0.7em";
  if (r.b !== undefined) c["font-weight"] = r.b ? "700" : "400";
  if (r.i !== undefined) c["font-style"] = r.i ? "italic" : "normal";
  const deco: string[] = [];
  if (r.u && r.u !== "none") deco.push("underline");
  if (r.strike || r.dstrike) deco.push("line-through");
  if (deco.length) {
    c["text-decoration-line"] = deco.join(" ");
    if (r.u && r.u !== "none") {
      if (/double/i.test(r.u)) c["text-decoration-style"] = "double";
      else if (/dotted/i.test(r.u)) c["text-decoration-style"] = "dotted";
      else if (/dash/i.test(r.u)) c["text-decoration-style"] = "dashed";
      else if (/wave/i.test(r.u)) c["text-decoration-style"] = "wavy";
      else c["text-decoration-style"] = "solid";
      if (/thick/i.test(r.u)) c["text-decoration-thickness"] = "2px";
      if (r.uColor && r.uColor !== "auto") c["text-decoration-color"] = `#${r.uColor}`;
    } else if (r.dstrike) c["text-decoration-style"] = "double";
  } else if (r.u === "none" || r.strike === false) c["text-decoration-line"] = "none";
  if (r.color) c["color"] = r.color === "auto" ? "inherit" : `#${r.color}`;
  const bg = r.highlight && r.highlight !== "none" ? HIGHLIGHT[r.highlight] : r.shd?.fill ? `#${r.shd.fill}` : undefined;
  if (bg) c["background-color"] = bg;
  if (r.caps !== undefined) c["text-transform"] = r.caps ? "uppercase" : "none";
  if (r.smallCaps !== undefined) c["font-variant-caps"] = r.smallCaps ? "small-caps" : "normal";
  if (r.vert === "superscript") c["vertical-align"] = "super";
  else if (r.vert === "subscript") c["vertical-align"] = "sub";
  else if (r.vert === "baseline") c["vertical-align"] = "baseline";
  if (r.spacing !== undefined) c["letter-spacing"] = px(twipPx(r.spacing));
  if (r.position !== undefined && !r.vert) c["vertical-align"] = px((r.position / 2) * (96 / 72));
  if (r.vanish) c["display"] = "none";
  if (r.border) { const b = borderCss(r.border); if (b) c["border"] = b; }
  if (r.emboss || r.imprint) c["text-shadow"] = r.imprint ? "-1px -1px 0 rgba(255,255,255,.7)" : "1px 1px 0 rgba(255,255,255,.8), -1px -1px 0 rgba(0,0,0,.25)";
  else if (r.shadow) c["text-shadow"] = "1px 1px 1px rgba(0,0,0,.35)";
  if (r.outline) { c["-webkit-text-stroke"] = "0.6px currentColor"; c["color"] = "transparent"; }
  return c;
}

/** Hanya properti yang berbeda dari `base` (agar DOM run ringkas). */
export function cssDiff(css: Css, base: Css): Css {
  const o: Css = {};
  for (const k in css) if (base[k] !== css[k]) o[k] = css[k];
  return o;
}

const LINE_BASE = 1.2;
/** Rasio tinggi baris alami (ascent+descent+lineGap)/em beberapa font umum; dipakai agar "spasi tunggal" mendekati Word. */
const LINE_RATIO: [RegExp, number][] = [
  [/^calibri|^carlito/i, 1.22], [/^cambria|^caladea/i, 1.17], [/^arial|^helvetica|^liberation sans/i, 1.15], [/^times|^liberation serif/i, 1.15], [/^courier|^liberation mono/i, 1.13],
  [/^verdana/i, 1.22], [/^tahoma/i, 1.21], [/^segoe ui/i, 1.33], [/^consolas/i, 1.17], [/^georgia/i, 1.14], [/^trebuchet/i, 1.16], [/^garamond/i, 1.12], [/^century gothic/i, 1.23], [/^comic sans/i, 1.39], [/^book antiqua|^palatino/i, 1.2],
];
export function lineBaseFor(font: string | undefined): number {
  if (font) for (const [re, v] of LINE_RATIO) if (re.test(font)) return v;
  return LINE_BASE;
}
export function pCss(p: PProps, lineBase = LINE_BASE): Css {
  const c: Css = {};
  if (p.jc) {
    const m: Record<string, string> = { left: "left", start: "left", center: "center", right: "right", end: "right", both: "justify", distribute: "justify", justify: "justify", thaiDistribute: "justify" };
    c["text-align"] = m[p.jc] ?? "left";
    if (p.jc === "distribute") c["text-align-last"] = "justify";
  }
  if (p.bidi) { c["direction"] = "rtl"; if (!p.jc) c["text-align"] = "right"; }
  const L = p.indLeft ?? 0;
  if (p.indLeft !== undefined) c["margin-left"] = px(twipPx(L));
  if (p.indRight !== undefined) c["margin-right"] = px(twipPx(p.indRight));
  if (p.indHanging) c["text-indent"] = px(-twipPx(p.indHanging));
  else if (p.indFirst) c["text-indent"] = px(twipPx(p.indFirst));
  const bef = p.beforeAuto ? 280 : p.before;
  const aft = p.afterAuto ? 280 : p.after;
  if (bef !== undefined) c["margin-top"] = px(twipPx(bef));
  if (aft !== undefined) c["margin-bottom"] = px(twipPx(aft));
  if (p.line !== undefined) {
    const rule = p.lineRule ?? "auto";
    if (rule === "auto") c["line-height"] = String(Math.round((p.line / 240) * lineBase * 1000) / 1000);
    else c["line-height"] = px(twipPx(p.line));
  }
  if (p.shd?.fill) c["background-color"] = `#${p.shd.fill}`;
  if (p.bdr) {
    const sides: [keyof Borders, string][] = [["top", "top"], ["left", "left"], ["bottom", "bottom"], ["right", "right"]];
    for (const [k, css] of sides) {
      const b = p.bdr[k];
      const bc = borderCss(b);
      if (bc) {
        c[`border-${css}`] = bc;
        if (b && b.val !== "none" && b.val !== "nil") c[`padding-${css}`] = px(ptPx(b.space ?? 1));
      }
    }
  }
  return c;
}

// ───────── style engine ─────────

export interface TableStyleDef {
  id: string;
  name?: string;
  borders?: Borders;
  cellMar?: Mar;
  rowBand: number;
  colBand: number;
  whole: TCond;
  cond: Map<string, TCond>;
}

interface StyleRec { id: string; type: string; name?: string; basedOn?: string; next?: string; link?: string; isDefault: boolean; el: XEl; qFormat: boolean; ui?: number }

export class StyleEngine {
  theme: Theme;
  docP: PProps = {};
  docRonly: RProps = {};
  defaultPara?: string;
  defaultChar?: string;
  defaultTable?: string;
  private recs = new Map<string, StyleRec>();
  private pCache = new Map<string, { p: PProps; r: RProps }>();
  private cCache = new Map<string, RProps>();
  private tCache = new Map<string, TableStyleDef>();
  latent = 0;

  constructor(stylesRoot: { docDefaults?: XEl; styles: XEl[] } | undefined, themeXml: string | undefined) {
    this.theme = parseTheme(themeXml);
    if (!stylesRoot) { this.docRonly = { sz: 22, fAscii: "Calibri" }; return; }
    const dd = stylesRoot.docDefaults;
    if (dd) {
      this.docRonly = readR(first(first(dd, "rPrDefault"), "rPr"), this.theme);
      this.docP = readP(first(first(dd, "pPrDefault"), "pPr"), this.theme);
    }
    if (this.docRonly.sz === undefined) this.docRonly.sz = 20;
    for (const el of stylesRoot.styles) {
      const id = attr(el, "styleId");
      if (!id) continue;
      const type = attr(el, "type") ?? "paragraph";
      const def = attr(el, "default") === "1" || attr(el, "default") === "true";
      const rec: StyleRec = { id, type, name: val(el, "name"), basedOn: val(el, "basedOn"), next: val(el, "next"), link: val(el, "link"), isDefault: def, el, qFormat: !!first(el, "qFormat"), ui: num(val(el, "uiPriority")) };
      this.recs.set(id, rec);
      if (def) { if (type === "paragraph") this.defaultPara = id; else if (type === "character") this.defaultChar = id; else if (type === "table") this.defaultTable = id; }
    }
  }

  has(id: string | undefined): boolean { return !!id && this.recs.has(id); }
  name(id: string | undefined): string | undefined { return id ? this.recs.get(id)?.name ?? id : undefined; }
  type(id: string): string | undefined { return this.recs.get(id)?.type; }
  next(id: string | undefined): string | undefined { return id ? this.recs.get(id)?.next : undefined; }
  list(type?: string): { id: string; name: string; type: string; qFormat: boolean; ui: number }[] {
    return [...this.recs.values()].filter(r => !type || r.type === type).map(r => ({ id: r.id, name: r.name ?? r.id, type: r.type, qFormat: r.qFormat, ui: r.ui ?? 99 }));
  }
  isHeading(id: string | undefined): number | undefined {
    if (!id) return undefined;
    const n = (this.recs.get(id)?.name ?? id).toLowerCase();
    const m = /^(?:heading|judul)\s*(\d)$/.exec(n) ?? /^heading(\d)$/.exec(id.toLowerCase());
    return m ? Number(m[1]) : n === "title" ? 0 : undefined;
  }

  private chain(id: string | undefined): StyleRec[] {
    const out: StyleRec[] = [];
    const seen = new Set<string>();
    let cur = id ? this.recs.get(id) : undefined;
    while (cur && !seen.has(cur.id)) { out.unshift(cur); seen.add(cur.id); cur = cur.basedOn ? this.recs.get(cur.basedOn) : undefined; }
    return out;
  }

  /** Layer kumulatif style paragraf (basedOn dari akar sampai id). */
  paraLayer(id: string | undefined): { p: PProps; r: RProps } {
    const key = id ?? "";
    const hit = this.pCache.get(key);
    if (hit) return hit;
    let p: PProps = {}; let r: RProps = {};
    for (const rec of this.chain(id)) {
      p = mergeP(p, readP(first(rec.el, "pPr"), this.theme));
      r = mergeR(r, readR(first(rec.el, "rPr"), this.theme));
    }
    const out = { p, r };
    this.pCache.set(key, out);
    return out;
  }
  charLayer(id: string | undefined): RProps {
    const key = id ?? "";
    const hit = this.cCache.get(key);
    if (hit) return hit;
    let r: RProps = {};
    for (const rec of this.chain(id)) r = mergeR(r, readR(first(rec.el, "rPr"), this.theme));
    this.cCache.set(key, r);
    return r;
  }

  /** Style paragraf default (Normal) hanya menimpa docDefaults pada properti yang memang berbeda. */
  private normalDiff(layer: { p: PProps; r: RProps }): { p: PProps; r: RProps } {
    const p: PProps = {}; const r: RProps = {};
    for (const k of Object.keys(layer.p) as (keyof PProps)[]) if (JSON.stringify(layer.p[k]) !== JSON.stringify(this.docP[k])) (p as Record<string, unknown>)[k] = layer.p[k];
    for (const k of Object.keys(layer.r) as (keyof RProps)[]) if (JSON.stringify(layer.r[k]) !== JSON.stringify(this.docRonly[k])) (r as Record<string, unknown>)[k] = layer.r[k];
    return { p, r };
  }

  /**
   * Properti dasar paragraf: docDefaults → (style tabel) → style paragraf. `tbl` = layer dari style tabel/ conditional.
   * Hasil `r` dipakai sebagai CSS dasar elemen paragraf, run hanya menyimpan selisihnya.
   */
  paraBase(styleId: string | undefined, tbl?: TCond): { p: PProps; r: RProps; styleId: string | undefined } {
    const sid = styleId && this.recs.has(styleId) ? styleId : this.defaultPara;
    let layer = this.paraLayer(sid);
    if (tbl && sid === this.defaultPara) layer = this.normalDiff(layer);
    let p = mergeP(this.docP, tbl?.p);
    let r = mergeR(this.docRonly, tbl?.r);
    p = mergeP(p, layer.p);
    r = mergeR(r, layer.r);
    return { p, r, styleId: sid };
  }

  tableStyle(id: string | undefined): TableStyleDef {
    const sid = id && this.recs.has(id) ? id : this.defaultTable ?? "";
    const hit = this.tCache.get(sid);
    if (hit) return hit;
    const def: TableStyleDef = { id: sid, rowBand: 1, colBand: 1, whole: {}, cond: new Map() };
    for (const rec of this.chain(sid)) {
      if (rec.type !== "table") continue;
      const el = rec.el;
      const tblPr = first(el, "tblPr");
      def.borders = mergeBorders(def.borders, readBorders(first(tblPr, "tblBorders"), this.theme));
      def.cellMar = { ...def.cellMar, ...readMar(first(tblPr, "tblCellMar")) };
      def.rowBand = num(val(tblPr, "tblStyleRowBandSize")) ?? def.rowBand;
      def.colBand = num(val(tblPr, "tblStyleColBandSize")) ?? def.colBand;
      const wholeFromTop = this.readCond(el);
      def.whole = this.mergeCond(def.whole, wholeFromTop);
      for (const sp of els(el, "tblStylePr")) {
        const t = attr(sp, "type") ?? "wholeTable";
        const c = this.readCond(sp);
        if (t === "wholeTable") def.whole = this.mergeCond(def.whole, c);
        else def.cond.set(t, this.mergeCond(def.cond.get(t) ?? {}, c));
      }
    }
    this.tCache.set(sid, def);
    return def;
  }
  private readCond(el: XEl): TCond {
    const tcPr = first(el, "tcPr");
    const c: TCond = {};
    const p = readP(first(el, "pPr"), this.theme); if (Object.keys(p).length) c.p = p;
    const r = readR(first(el, "rPr"), this.theme); if (Object.keys(r).length) c.r = r;
    const tp = first(el, "tblPr");
    const tb = readBorders(first(tcPr, "tcBorders"), this.theme);
    // tblPr/tblBorders di dalam tblStylePr juga berlaku untuk sel kondisi tersebut
    const tbb = readBorders(first(tp, "tblBorders"), this.theme);
    const b = mergeBorders(tbb, tb); if (b) c.borders = b;
    const shd = first(tcPr, "shd") ?? first(tp, "shd"); if (shd) c.shd = readShd(shd, this.theme);
    const mar = readMar(first(tcPr, "tcMar")); if (mar) c.mar = mar;
    const va = val(tcPr, "vAlign"); if (va) c.vAlign = va;
    return c;
  }
  mergeCond(a: TCond, b: TCond): TCond {
    return {
      p: b.p ? mergeP(a.p ?? {}, b.p) : a.p,
      r: b.r ? mergeR(a.r ?? {}, b.r) : a.r,
      borders: mergeBorders(a.borders, b.borders),
      shd: b.shd ?? a.shd,
      mar: a.mar || b.mar ? { ...a.mar, ...b.mar } : undefined,
      vAlign: b.vAlign ?? a.vAlign,
    };
  }

  /** Format kondisional style tabel untuk sel (r,c) dari tabel nRows × nCols. */
  cellCond(def: TableStyleDef, look: TableLook, r: number, c: number, nRows: number, nCols: number): TCond {
    let out: TCond = def.whole;
    const apply = (t: string) => { const x = def.cond.get(t); if (x) out = this.mergeCond(out, x); };
    const firstRow = look.firstRow && r === 0;
    const lastRow = look.lastRow && r === nRows - 1 && nRows > 1;
    const firstCol = look.firstCol && c === 0;
    const lastCol = look.lastCol && c === nCols - 1 && nCols > 1;
    if (!look.noVBand) {
      const ci = c - (look.firstCol ? 1 : 0);
      if (ci >= 0 && !(lastCol)) apply(Math.floor(ci / def.colBand) % 2 === 0 ? "band1Vert" : "band2Vert");
    }
    if (!look.noHBand && !firstRow && !lastRow) {
      const ri = r - (look.firstRow ? 1 : 0);
      if (ri >= 0) apply(Math.floor(ri / def.rowBand) % 2 === 0 ? "band1Horz" : "band2Horz");
    }
    if (lastCol) apply("lastCol");
    if (firstCol) apply("firstCol");
    if (lastRow) apply("lastRow");
    if (firstRow) apply("firstRow");
    if (firstRow && lastCol) apply("neCell");
    if (firstRow && firstCol) apply("nwCell");
    if (lastRow && lastCol) apply("seCell");
    if (lastRow && firstCol) apply("swCell");
    return out;
  }
}

export interface TableLook { firstRow: boolean; lastRow: boolean; firstCol: boolean; lastCol: boolean; noHBand: boolean; noVBand: boolean }
export function readTableLook(tblPr: XEl | undefined): TableLook {
  const look = first(tblPr, "tblLook");
  const d: TableLook = { firstRow: true, lastRow: false, firstCol: true, lastCol: false, noHBand: false, noVBand: true };
  if (!look) return d;
  const v = attr(look, "val");
  const flag = (name: string, bit: number, def: boolean) => {
    const a = attr(look, name);
    if (a !== undefined) return a === "1" || a === "true";
    if (v) return (parseInt(v, 16) & bit) !== 0;
    return def;
  };
  return { firstRow: flag("firstRow", 0x20, d.firstRow), lastRow: flag("lastRow", 0x40, d.lastRow), firstCol: flag("firstColumn", 0x80, d.firstCol), lastCol: flag("lastColumn", 0x100, d.lastCol), noHBand: flag("noHBand", 0x200, d.noHBand), noVBand: flag("noVBand", 0x400, d.noVBand) };
}

export { NS };
