/**
 * Resolusi style OOXML (styles.xml + theme1.xml) menjadi struktur visual yang siap dipakai DOM.
 * Murni logika (tanpa Solid / DOM) sehingga mudah dites.
 */
import type { Workbook } from "@office-kit/xlsx/workbook";
import type { Cell } from "@office-kit/xlsx/cell";
import {
  getCellAlignment,
  getCellBorder,
  getCellFill,
  getCellFont,
  getCellNumberFormat,
  getCellProtection,
  resolveIndexedColor,
} from "@office-kit/xlsx/styles";

type ColorLike = { rgb?: string; indexed?: number; theme?: number; auto?: boolean; tint?: number } | undefined;

/** Urutan indeks tema sesuai spesifikasi SpreadsheetML (0=lt1, 1=dk1, 2=lt2, 3=dk2, 4..9=accent1..6, 10=hlink, 11=folHlink). */
const THEME_ORDER = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
const DEFAULT_THEME: Record<string, string> = {
  lt1: "FFFFFF", dk1: "000000", lt2: "E7E6E6", dk2: "44546A",
  accent1: "4472C4", accent2: "ED7D31", accent3: "A5A5A5", accent4: "FFC000", accent5: "5B9BD5", accent6: "70AD47",
  hlink: "0563C1", folHlink: "954F72",
};

export function parseThemePalette(themeXml?: Uint8Array): { palette: string[]; fromFile: boolean } {
  const map: Record<string, string> = { ...DEFAULT_THEME };
  let fromFile = false;
  if (themeXml && themeXml.length) {
    try {
      const xml = new TextDecoder().decode(themeXml);
      const scheme = /<a:clrScheme[\s\S]*?<\/a:clrScheme>/.exec(xml)?.[0] ?? xml;
      const re = /<a:(dk1|lt1|dk2|lt2|accent[1-6]|hlink|folHlink)>\s*<a:(?:srgbClr\s+val="([0-9A-Fa-f]{6})"|sysClr\s[^>]*?lastClr="([0-9A-Fa-f]{6})")/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(scheme))) {
        map[m[1]!] = (m[2] ?? m[3])!.toUpperCase();
        fromFile = true;
      }
    } catch { /* tema rusak: pakai palet default */ }
  }
  return { palette: THEME_ORDER.map(k => map[k]!), fromFile };
}

function hex2rgb(h: string): [number, number, number] {
  const s = h.replace("#", "").slice(-6);
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
function rgb2hex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return "#" + c(r) + c(g) + c(b);
}
function rgb2hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/** Terapkan tint OOXML (-1..1) pada luminansi HSL. */
export function applyTint(hex: string, tint: number): string {
  if (!tint) return hex.startsWith("#") ? hex : "#" + hex;
  const [r, g, b] = hex2rgb(hex);
  const [h, s, l] = rgb2hsl(r, g, b);
  const nl = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const [nr, ng, nb] = hsl2rgb(h, s, nl);
  return rgb2hex(nr, ng, nb);
}

export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hex2rgb(a), [br, bg, bb] = hex2rgb(b);
  return rgb2hex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

export function resolveColor(color: ColorLike, palette: string[]): string | undefined {
  if (!color) return undefined;
  if (color.rgb) {
    const base = color.rgb.length === 8 ? color.rgb.slice(2) : color.rgb;
    if (!/^[0-9a-fA-F]{6}$/.test(base)) return undefined;
    return applyTint(base, color.tint ?? 0);
  }
  if (color.theme !== undefined) {
    const base = palette[color.theme];
    return base ? applyTint(base, color.tint ?? 0) : undefined;
  }
  if (color.indexed !== undefined) {
    if (color.indexed === 64) return "#000000";
    if (color.indexed === 65) return "#ffffff";
    const h = resolveIndexedColor(color.indexed);
    return h ? applyTint(h.slice(-6), color.tint ?? 0) : undefined;
  }
  return undefined; // auto
}

export interface BorderSideCss { width: number; css: string; color: string }

export interface ResolvedStyle {
  id: number;
  fontName: string;
  sizePt: number;
  bold: boolean;
  italic: boolean;
  underline: "none" | "single" | "double";
  strike: boolean;
  color?: string;
  vertAlign?: "superscript" | "subscript";
  bg?: string;
  bgImage?: string;
  left?: BorderSideCss;
  right?: BorderSideCss;
  top?: BorderSideCss;
  bottom?: BorderSideCss;
  h: string;
  v: string;
  wrap: boolean;
  indent: number;
  rotation: number;
  shrink: boolean;
  numFmt: string;
  locked: boolean;
  hidden: boolean;
}

const BORDER_MAP: Record<string, { w: number; css: string }> = {
  thin: { w: 1, css: "solid" }, medium: { w: 2, css: "solid" }, thick: { w: 3, css: "solid" },
  double: { w: 3, css: "double" }, hair: { w: 1, css: "dotted" }, dotted: { w: 1, css: "dotted" },
  dashed: { w: 1, css: "dashed" }, dashDot: { w: 1, css: "dashed" }, dashDotDot: { w: 1, css: "dashed" },
  mediumDashed: { w: 2, css: "dashed" }, mediumDashDot: { w: 2, css: "dashed" }, mediumDashDotDot: { w: 2, css: "dashed" },
  slantDashDot: { w: 2, css: "dashed" },
};

const PATTERN_DENSITY: Record<string, number> = {
  gray0625: 0.0625, gray125: 0.125, lightGray: 0.25, mediumGray: 0.5, darkGray: 0.75,
  lightDown: 0.2, lightUp: 0.2, lightGrid: 0.25, lightTrellis: 0.25, lightHorizontal: 0.2, lightVertical: 0.2,
  darkDown: 0.5, darkUp: 0.5, darkGrid: 0.55, darkTrellis: 0.55, darkHorizontal: 0.5, darkVertical: 0.5,
};

function sideCss(side: { style?: string; color?: ColorLike } | undefined, palette: string[]): BorderSideCss | undefined {
  if (!side || !side.style || side.style === "none") return undefined;
  const m = BORDER_MAP[side.style] ?? BORDER_MAP.thin!;
  return { width: m.w, css: m.css, color: resolveColor(side.color, palette) ?? "#000000" };
}

export class StyleResolver {
  readonly palette: string[];
  readonly themeFromFile: boolean;
  private cache = new Map<number, ResolvedStyle>();

  constructor(private wb: Workbook) {
    const t = parseThemePalette(wb.themeXml);
    this.palette = t.palette;
    this.themeFromFile = t.fromFile;
  }

  /** Dipanggil saat stylesheet berubah (mis. setelah memodifikasi style). */
  clear() { this.cache.clear(); }

  get(styleId: number): ResolvedStyle {
    let r = this.cache.get(styleId);
    if (!r) { r = this.compute(styleId); this.cache.set(styleId, r); }
    return r;
  }

  private compute(styleId: number): ResolvedStyle {
    const fake = { row: 1, col: 1, value: null, styleId } as Cell;
    const font: any = safe(() => getCellFont(this.wb, fake)) ?? {};
    const fill: any = safe(() => getCellFill(this.wb, fake));
    const border: any = safe(() => getCellBorder(this.wb, fake)) ?? {};
    const al: any = safe(() => getCellAlignment(this.wb, fake)) ?? {};
    const prot: any = safe(() => getCellProtection(this.wb, fake)) ?? {};
    const pal = this.palette;

    let bg: string | undefined;
    let bgImage: string | undefined;
    if (fill) {
      if (fill.kind === "pattern") {
        const pt = fill.patternType;
        const fg = resolveColor(fill.fgColor, pal);
        const bgc = resolveColor(fill.bgColor, pal);
        if (pt === "solid") bg = fg ?? bgc;
        else if (pt && pt !== "none") {
          const base = bgc ?? "#ffffff";
          bg = mixHex(base, fg ?? "#000000", PATTERN_DENSITY[pt] ?? 0.3);
        }
      } else if (fill.kind === "gradient" && fill.stops?.length) {
        const stops = fill.stops.map((s: any) => `${resolveColor(s.color, pal) ?? "#fff"} ${Math.round((s.position ?? 0) * 100)}%`);
        const first = resolveColor(fill.stops[0].color, pal);
        bg = first;
        if (stops.length > 1) bgImage = fill.type === "path" ? `radial-gradient(${stops.join(",")})` : `linear-gradient(${90 + (fill.degree ?? 0)}deg, ${stops.join(",")})`;
      }
    }

    return {
      id: styleId,
      fontName: font.name ?? "Calibri",
      sizePt: font.size ?? 11,
      bold: !!font.bold,
      italic: !!font.italic,
      underline: font.underline && font.underline !== "none" ? (String(font.underline).startsWith("double") ? "double" : "single") : "none",
      strike: !!font.strike,
      color: resolveColor(font.color, pal),
      vertAlign: font.vertAlign === "superscript" || font.vertAlign === "subscript" ? font.vertAlign : undefined,
      bg,
      bgImage,
      left: sideCss(border.left, pal),
      right: sideCss(border.right, pal),
      top: sideCss(border.top, pal),
      bottom: sideCss(border.bottom, pal),
      h: al.horizontal ?? "general",
      v: al.vertical ?? "bottom",
      wrap: !!al.wrapText,
      indent: al.indent ?? 0,
      rotation: al.textRotation ?? 0,
      shrink: !!al.shrinkToFit,
      numFmt: safe(() => getCellNumberFormat(this.wb, fake)) ?? "General",
      locked: prot.locked !== false,
      hidden: !!prot.hidden,
    };
  }

  /** Terapkan DXF (conditional formatting) di atas style dasar. */
  applyDxf(base: ResolvedStyle, dxf: any): ResolvedStyle {
    if (!dxf) return base;
    const out: ResolvedStyle = { ...base };
    const f = dxf.font;
    if (f) {
      if (f.bold !== undefined) out.bold = !!f.bold;
      if (f.italic !== undefined) out.italic = !!f.italic;
      if (f.strike !== undefined) out.strike = !!f.strike;
      if (f.underline && f.underline !== "none") out.underline = "single";
      const c = resolveColor(f.color, this.palette);
      if (c) out.color = c;
    }
    const fill = dxf.fill;
    if (fill?.kind === "pattern") {
      // Pada DXF warna solid disimpan di bgColor (keanehan spesifikasi); fallback ke fgColor.
      const c = resolveColor(fill.bgColor, this.palette) ?? resolveColor(fill.fgColor, this.palette);
      if (c && fill.patternType !== "none") { out.bg = c; out.bgImage = undefined; }
    }
    const b = dxf.border;
    if (b) {
      for (const k of ["left", "right", "top", "bottom"] as const) {
        const s = sideCss(b[k], this.palette);
        if (s) out[k] = s;
      }
    }
    return out;
  }
}

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

/** Warna teks yang terbaca di atas latar tertentu. */
export function readableOn(bg: string): string {
  const [r, g, b] = hex2rgb(bg);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#000000" : "#ffffff";
}

export { hex2rgb, rgb2hex };
