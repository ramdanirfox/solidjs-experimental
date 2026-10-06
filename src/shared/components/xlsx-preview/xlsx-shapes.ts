/**
 * Parser shape DrawingML (xdr:sp / xdr:cxnSp / xdr:grpSp) menjadi model render ringan (SVG + teks HTML).
 * Murni (tanpa DOM) agar bisa diuji di node. Geometri preset yang tidak dikenal dirender sebagai persegi.
 */
import type { XmlNode } from "@office-kit/xlsx/xml";

export const EMU_PX = 9525;
const THEME_ORDER = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
const SCHEME_ALIAS: Record<string, string> = { tx1: "dk1", bg1: "lt1", tx2: "dk2", bg2: "lt2" };

export type SchemeLookup = (name: string) => string | undefined;
export function schemeLookup(palette: string[]): SchemeLookup {
  return name => {
    const i = THEME_ORDER.indexOf(SCHEME_ALIAS[name] ?? name);
    return i >= 0 ? palette[i] : undefined;
  };
}

// ───────────────────────── model ─────────────────────────
export interface ShapeColor { hex: string; a: number }
export type ShapeFill =
  | { kind: "solid"; color: ShapeColor }
  | { kind: "grad"; stops: { pos: number; color: ShapeColor }[]; angle: number };
export interface ShapeRun { t: string; sz?: number; b?: boolean; i?: boolean; u?: boolean; strike?: boolean; color?: string; font?: string; br?: boolean }
export interface ShapePara { align: "left" | "center" | "right" | "justify"; runs: ShapeRun[]; emptySz?: number }
export interface ShapeTextBody {
  paras: ShapePara[];
  anchor: "top" | "middle" | "bottom";
  /** Inset l,t,r,b dalam px (96 dpi). */
  inset: [number, number, number, number];
  wrap: boolean;
  vert: "horz" | "vert" | "vert270";
}
export interface ShapeArrow { type: string; w: string; len: string }
export interface ShapeSpec {
  name: string;
  descr?: string;
  geom: string;
  adj: Record<string, number>;
  fill: ShapeFill | null;
  stroke: ShapeColor | null;
  /** Lebar garis dalam px (96 dpi). */
  strokeW: number;
  dash?: string;
  rot: number;
  flipH: boolean;
  flipV: boolean;
  head?: ShapeArrow;
  tail?: ShapeArrow;
  text?: ShapeTextBody;
  /** Posisi relatif terhadap rect anchor (0..1); 0,0,1,1 untuk shape tingkat atas. */
  rel: { x: number; y: number; w: number; h: number };
  hidden: boolean;
  /** true bila geometri preset tidak punya renderer khusus. */
  approx: boolean;
}
export interface ShapeGroup { shapes: ShapeSpec[]; hasText: boolean; approx: boolean }

// ───────────────────────── util XML ─────────────────────────
export const local = (n: XmlNode | undefined): string => (n?.name ?? "").replace(/^\{[^}]*\}/, "");
const kid = (n: XmlNode | undefined, name: string): XmlNode | undefined => n?.children.find(c => local(c) === name);
const kids = (n: XmlNode | undefined, name: string): XmlNode[] => n?.children.filter(c => local(c) === name) ?? [];
const num = (v: string | undefined, d: number): number => { const n = v === undefined ? NaN : Number(v); return Number.isFinite(n) ? n : d; };

/** Cari node pertama (DFS) dengan local name dalam daftar, termasuk node itu sendiri. */
export function findShapeRoot(n: XmlNode | undefined, names = ["sp", "cxnSp", "grpSp"]): XmlNode | undefined {
  if (!n) return undefined;
  if (names.includes(local(n))) return n;
  for (const c of n.children) { const r = findShapeRoot(c, names); if (r) return r; }
  return undefined;
}

// ───────────────────────── warna ─────────────────────────
function hex2rgb(h: string): [number, number, number] {
  const s = h.replace("#", "").slice(-6).padStart(6, "0");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
const toHex = (r: number, g: number, b: number) => "#" + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
function rgb2hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => { t = (t + 1) % 1; return 255 * (t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p); };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}
const PRESET_COLORS: Record<string, string> = {
  black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF", yellow: "FFFF00", gray: "808080", grey: "808080", orange: "FFA500",
  purple: "800080", cyan: "00FFFF", magenta: "FF00FF", lime: "00FF00", navy: "000080", teal: "008080", maroon: "800000", silver: "C0C0C0", olive: "808000",
  darkBlue: "00008B", darkRed: "8B0000", darkGreen: "006400", lightGray: "D3D3D3", dkGray: "A9A9A9", ltGray: "D3D3D3", dkBlue: "00008B", dkRed: "8B0000", dkGreen: "006400",
};

/** Baca elemen warna (srgbClr/schemeClr/prstClr/sysClr + transform) di dalam `parent`. */
export function readColor(parent: XmlNode | undefined, scheme: SchemeLookup, phClr?: ShapeColor): ShapeColor | null {
  const c = parent?.children.find(x => ["srgbClr", "schemeClr", "prstClr", "sysClr", "scrgbClr", "hslClr"].includes(local(x)));
  if (!c) return null;
  let hex: string | undefined;
  switch (local(c)) {
    case "srgbClr": hex = c.attrs.val; break;
    case "prstClr": hex = PRESET_COLORS[c.attrs.val ?? ""]; break;
    case "sysClr": hex = c.attrs.lastClr ?? (c.attrs.val === "window" ? "FFFFFF" : "000000"); break;
    case "scrgbClr": hex = toHex(num(c.attrs.r, 0) / 1000 * 2.55, num(c.attrs.g, 0) / 1000 * 2.55, num(c.attrs.b, 0) / 1000 * 2.55).slice(1); break;
    case "schemeClr": hex = c.attrs.val === "phClr" ? phClr?.hex.slice(1) : scheme(c.attrs.val ?? ""); break;
    default: break;
  }
  if (!hex) return null;
  let [r, g, b] = hex2rgb(hex);
  let a = c.attrs.val === "phClr" && phClr ? phClr.a : 1;
  for (const m of c.children) {
    const v = num(m.attrs.val, 100000) / 100000;
    switch (local(m)) {
      case "lumMod": case "lumOff": case "satMod": {
        let [h, s, l] = rgb2hsl(r, g, b);
        const nm = local(m);
        if (nm === "lumMod") l *= v; else if (nm === "lumOff") l += v; else s *= v;
        [r, g, b] = hsl2rgb(h, Math.min(1, s), Math.max(0, Math.min(1, l)));
        break;
      }
      case "shade": r *= v; g *= v; b *= v; break;
      case "tint": r = 255 - (255 - r) * v; g = 255 - (255 - g) * v; b = 255 - (255 - b) * v; break;
      case "alpha": a = v; break;
      case "alphaMod": a *= v; break;
      default: break;
    }
  }
  return { hex: toHex(r, g, b), a: Math.max(0, Math.min(1, a)) };
}

// ───────────────────────── fill / garis ─────────────────────────
function readFill(holder: XmlNode | undefined, scheme: SchemeLookup, ph?: ShapeColor): ShapeFill | null | undefined {
  // undefined = tidak ditentukan; null = noFill
  if (!holder) return undefined;
  for (const c of holder.children) {
    switch (local(c)) {
      case "noFill": return null;
      case "solidFill": { const col = readColor(c, scheme, ph); return col ? { kind: "solid", color: col } : undefined; }
      case "gradFill": {
        const stops = kids(kid(c, "gsLst"), "gs").map(gs => ({ pos: num(gs.attrs.pos, 0) / 100000, color: readColor(gs, scheme, ph) })).filter((s): s is { pos: number; color: ShapeColor } => !!s.color);
        if (!stops.length) return undefined;
        return { kind: "grad", stops, angle: num(kid(c, "lin")?.attrs.ang, 5400000) / 60000 };
      }
      case "pattFill": { const col = readColor(kid(c, "fgClr"), scheme, ph); return col ? { kind: "solid", color: col } : undefined; }
      case "blipFill": return undefined;
      default: break;
    }
  }
  return undefined;
}

const DASH: Record<string, string> = { dash: "4 3", sysDash: "3 1", dot: "1 2", sysDot: "1 1", lgDash: "8 3", dashDot: "4 3 1 3", sysDashDot: "3 1 1 1", lgDashDot: "8 3 1 3", lgDashDotDot: "8 3 1 3 1 3", sysDashDotDot: "3 1 1 1 1 1" };
const LN_REF_EMU = [0, 6350, 12700, 19050];

// ───────────────────────── teks ─────────────────────────
function readTextBody(tx: XmlNode | undefined, scheme: SchemeLookup, defColor?: string): ShapeTextBody | undefined {
  if (!tx) return undefined;
  const body = kid(tx, "bodyPr");
  const paras: ShapePara[] = kids(tx, "p").map(p => {
    const algn = kid(p, "pPr")?.attrs.algn;
    const runs: ShapeRun[] = [];
    for (const r of p.children) {
      const nm = local(r);
      if (nm === "br") { runs.push({ t: "\n", br: true }); continue; }
      if (nm !== "r" && nm !== "fld") continue;
      const rp = kid(r, "rPr");
      const col = readColor(kid(rp, "solidFill"), scheme);
      runs.push({
        t: kid(r, "t")?.text ?? "",
        sz: rp?.attrs.sz ? num(rp.attrs.sz, 1100) / 100 : undefined,
        b: rp?.attrs.b === "1" || rp?.attrs.b === "true" || undefined,
        i: rp?.attrs.i === "1" || rp?.attrs.i === "true" || undefined,
        u: (rp?.attrs.u && rp.attrs.u !== "none") || undefined ? true : undefined,
        strike: (rp?.attrs.strike && rp.attrs.strike !== "noStrike") ? true : undefined,
        color: col?.hex ?? defColor,
        font: kid(rp, "latin")?.attrs.typeface,
      });
    }
    const end = kid(p, "endParaRPr");
    return { align: algn === "ctr" ? "center" : algn === "r" ? "right" : algn === "just" || algn === "dist" ? "justify" : "left", runs, emptySz: end?.attrs.sz ? num(end.attrs.sz, 1100) / 100 : undefined } as ShapePara;
  });
  const a = body?.attrs.anchor;
  const vert = body?.attrs.vert;
  return {
    paras,
    anchor: a === "ctr" || a === "just" || a === "dist" ? "middle" : a === "b" ? "bottom" : "top",
    inset: [num(body?.attrs.lIns, 91440), num(body?.attrs.tIns, 45720), num(body?.attrs.rIns, 91440), num(body?.attrs.bIns, 45720)].map(v => v / EMU_PX) as [number, number, number, number],
    wrap: body?.attrs.wrap !== "none",
    vert: vert === "vert" || vert === "eaVert" ? "vert" : vert === "vert270" ? "vert270" : "horz",
  };
}

export const shapePlainText = (t: ShapeTextBody | undefined): string => (t?.paras ?? []).map(p => p.runs.map(r => r.t).join("")).join("\n").trim();

// ───────────────────────── geometri ─────────────────────────
const KNOWN = new Set([
  "rect", "roundRect", "round1Rect", "round2SameRect", "snip1Rect", "ellipse", "triangle", "rtTriangle", "diamond", "parallelogram", "trapezoid", "pentagon", "hexagon", "octagon", "plus",
  "star4", "star5", "star6", "star8", "star10", "rightArrow", "leftArrow", "upArrow", "downArrow", "chevron", "homePlate", "can", "cube", "line", "straightConnector1",
  "bentConnector2", "bentConnector3", "bentConnector4", "curvedConnector2", "curvedConnector3", "curvedConnector4",
  "flowChartProcess", "flowChartAlternateProcess", "flowChartDecision", "flowChartTerminator", "flowChartConnector", "flowChartData", "flowChartPreparation", "flowChartPredefinedProcess", "flowChartInputOutput",
  "textBox", "wedgeRectCallout", "wedgeRoundRectCallout", "wedgeEllipseCallout", "mathPlus", "mathMinus", "mathMultiply", "donut", "noSmoking", "blockArc",
]);
export const isKnownGeom = (g: string) => KNOWN.has(g);
export const isLineGeom = (g: string) => g === "line" || /Connector\d?$/.test(g);

export interface PathPart { d: string; noFill?: boolean }

const pts = (p: [number, number][]) => "M" + p.map(([x, y]) => `${f(x)},${f(y)}`).join("L") + "Z";
const f = (n: number) => Math.round(n * 100) / 100;
function star(n: number, inner: number, w: number, h: number): string {
  const raw: [number, number][] = [];
  for (let k = 0; k < n * 2; k++) {
    const ang = -Math.PI / 2 + (k * Math.PI) / n, r = k % 2 ? inner : 1;
    raw.push([Math.cos(ang) * r, Math.sin(ang) * r]);
  }
  const xs = raw.map(p => p[0]), ys = raw.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return pts(raw.map(([x, y]) => [((x - x0) / (x1 - x0)) * w, ((y - y0) / (y1 - y0)) * h]));
}
function arrow(dir: "r" | "l" | "u" | "d", w: number, h: number, a1: number, a2: number): string {
  const vertical = dir === "u" || dir === "d";
  const L = vertical ? h : w, T = vertical ? w : h, ss = Math.min(w, h);
  const sh = (T * a1) / 100000, hl = Math.min(L, (ss * a2) / 100000);
  const base: [number, number][] = [[0, (T - sh) / 2], [L - hl, (T - sh) / 2], [L - hl, 0], [L, T / 2], [L - hl, T], [L - hl, (T + sh) / 2], [0, (T + sh) / 2]];
  return pts(base.map(([u, v]) => dir === "r" ? [u, v] : dir === "l" ? [w - u, v] : dir === "d" ? [v, u] : [v, h - u]));
}
function rrect(w: number, h: number, r: number): string {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${f(r)},0H${f(w - r)}A${f(r)},${f(r)} 0 0 1 ${f(w)},${f(r)}V${f(h - r)}A${f(r)},${f(r)} 0 0 1 ${f(w - r)},${f(h)}H${f(r)}A${f(r)},${f(r)} 0 0 1 0,${f(h - r)}V${f(r)}A${f(r)},${f(r)} 0 0 1 ${f(r)},0Z`;
}
function ellipse(w: number, h: number): string {
  return `M0,${f(h / 2)}A${f(w / 2)},${f(h / 2)} 0 1 0 ${f(w)},${f(h / 2)}A${f(w / 2)},${f(h / 2)} 0 1 0 0,${f(h / 2)}Z`;
}

/** Path SVG (koordinat px lokal 0..w, 0..h) untuk geometri preset. */
export function presetPaths(geom: string, w: number, h: number, adj: Record<string, number> = {}): PathPart[] {
  const ss = Math.min(w, h);
  const a = (k: string, d: number) => adj[k] ?? d;
  const a1 = a("adj", a("adj1", NaN));
  switch (geom) {
    case "roundRect": case "flowChartAlternateProcess": case "wedgeRoundRectCallout": return [{ d: rrect(w, h, (ss * (Number.isNaN(a1) ? 16667 : a1)) / 100000) }];
    case "flowChartTerminator": return [{ d: rrect(w, h, h / 2) }];
    case "round1Rect": { const r = (ss * (Number.isNaN(a1) ? 16667 : a1)) / 100000; return [{ d: `M0,0H${f(w - r)}A${f(r)},${f(r)} 0 0 1 ${f(w)},${f(r)}V${f(h)}H0Z` }]; }
    case "round2SameRect": { const r = (ss * (Number.isNaN(a1) ? 16667 : a1)) / 100000; return [{ d: `M${f(r)},0H${f(w - r)}A${f(r)},${f(r)} 0 0 1 ${f(w)},${f(r)}V${f(h)}H0V${f(r)}A${f(r)},${f(r)} 0 0 1 ${f(r)},0Z` }]; }
    case "snip1Rect": { const s = (ss * (Number.isNaN(a1) ? 16667 : a1)) / 100000; return [{ d: pts([[0, 0], [w - s, 0], [w, s], [w, h], [0, h]]) }]; }
    case "ellipse": case "flowChartConnector": case "wedgeEllipseCallout": return [{ d: ellipse(w, h) }];
    case "donut": { const t = (ss * a("adj", 25000)) / 100000; return [{ d: ellipse(w, h) + ellipse(w - 2 * t, h - 2 * t).replace(/(-?\d+\.?\d*),(-?\d+\.?\d*)/g, (_m, x: string, y: string) => `${Number(x) + t},${Number(y) + t}`) }]; }
    case "triangle": return [{ d: pts([[0, h], [(w * (Number.isNaN(a1) ? 50000 : a1)) / 100000, 0], [w, h]]) }];
    case "rtTriangle": return [{ d: pts([[0, 0], [0, h], [w, h]]) }];
    case "diamond": case "flowChartDecision": return [{ d: pts([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]) }];
    case "parallelogram": case "flowChartData": case "flowChartInputOutput": { const o = Math.min(w, (ss * (geom === "parallelogram" && !Number.isNaN(a1) ? a1 : 25000)) / 100000); return [{ d: pts([[o, 0], [w, 0], [w - o, h], [0, h]]) }]; }
    case "trapezoid": { const o = Math.min(w / 2, (ss * (Number.isNaN(a1) ? 25000 : a1)) / 100000); return [{ d: pts([[0, h], [o, 0], [w - o, 0], [w, h]]) }]; }
    case "pentagon": return [{ d: pts([[0.5, 0], [1, 0.3819], [0.809, 1], [0.191, 1], [0, 0.3819]].map(([x, y]) => [x! * w, y! * h] as [number, number])) }];
    case "hexagon": case "flowChartPreparation": { const o = Math.min(w / 2, (ss * (geom === "hexagon" && !Number.isNaN(a1) ? a1 : 25000)) / 100000); return [{ d: pts([[0, h / 2], [o, 0], [w - o, 0], [w, h / 2], [w - o, h], [o, h]]) }]; }
    case "octagon": { const o = (ss * (Number.isNaN(a1) ? 29289 : a1)) / 100000; return [{ d: pts([[o, 0], [w - o, 0], [w, o], [w, h - o], [w - o, h], [o, h], [0, h - o], [0, o]]) }]; }
    case "plus": case "mathPlus": { const o = (ss * (Number.isNaN(a1) ? (geom === "plus" ? 25000 : 23520) : a1)) / 100000; return [{ d: pts([[o, 0], [w - o, 0], [w - o, o], [w, o], [w, h - o], [w - o, h - o], [w - o, h], [o, h], [o, h - o], [0, h - o], [0, o], [o, o]]) }]; }
    case "mathMinus": { const t = (h * (Number.isNaN(a1) ? 23520 : a1)) / 100000; return [{ d: pts([[0, (h - t) / 2], [w, (h - t) / 2], [w, (h + t) / 2], [0, (h + t) / 2]]) }]; }
    case "mathMultiply": { const o = ss * 0.12; return [{ d: pts([[o, 0], [w / 2, h / 2 - o], [w - o, 0], [w, o], [w / 2 + o, h / 2], [w, h - o], [w - o, h], [w / 2, h / 2 + o], [o, h], [0, h - o], [w / 2 - o, h / 2], [0, o]]) }]; }
    case "star4": return [{ d: star(4, 0.35, w, h) }];
    case "star5": return [{ d: star(5, 0.382, w, h) }];
    case "star6": return [{ d: star(6, 0.577, w, h) }];
    case "star8": return [{ d: star(8, 0.7, w, h) }];
    case "star10": return [{ d: star(10, 0.8, w, h) }];
    case "rightArrow": return [{ d: arrow("r", w, h, a("adj1", 50000), a("adj2", 50000)) }];
    case "leftArrow": return [{ d: arrow("l", w, h, a("adj1", 50000), a("adj2", 50000)) }];
    case "upArrow": return [{ d: arrow("u", w, h, a("adj1", 50000), a("adj2", 50000)) }];
    case "downArrow": return [{ d: arrow("d", w, h, a("adj1", 50000), a("adj2", 50000)) }];
    case "chevron": { const o = Math.min(w, (ss * (Number.isNaN(a1) ? 50000 : a1)) / 100000); return [{ d: pts([[0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h], [o, h / 2]]) }]; }
    case "homePlate": { const o = Math.min(w, (ss * (Number.isNaN(a1) ? 50000 : a1)) / 100000); return [{ d: pts([[0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h]]) }]; }
    case "can": {
      const ry = Math.min(h / 2, (ss * (Number.isNaN(a1) ? 25000 : a1)) / 200000), rx = w / 2;
      return [
        { d: `M0,${f(ry)}A${f(rx)},${f(ry)} 0 0 1 ${f(w)},${f(ry)}V${f(h - ry)}A${f(rx)},${f(ry)} 0 0 1 0,${f(h - ry)}Z` },
        { d: `M0,${f(ry)}A${f(rx)},${f(ry)} 0 0 0 ${f(w)},${f(ry)}`, noFill: true },
      ];
    }
    case "cube": {
      const o = (ss * (Number.isNaN(a1) ? 25000 : a1)) / 100000;
      return [
        { d: pts([[0, o], [w - o, o], [w - o, h], [0, h]]) },
        { d: pts([[0, o], [o, 0], [w, 0], [w - o, o]]) },
        { d: pts([[w - o, o], [w, 0], [w, h - o], [w - o, h]]) },
      ];
    }
    case "flowChartPredefinedProcess": { const o = w * 0.125; return [{ d: pts([[0, 0], [w, 0], [w, h], [0, h]]) }, { d: `M${f(o)},0V${f(h)}M${f(w - o)},0V${f(h)}`, noFill: true }]; }
    case "line": case "straightConnector1": return [{ d: `M0,0L${f(w)},${f(h)}`, noFill: true }];
    case "bentConnector2": return [{ d: `M0,0H${f(w)}V${f(h)}`, noFill: true }];
    case "bentConnector3": { const x = (w * a("adj1", 50000)) / 100000; return [{ d: `M0,0H${f(x)}V${f(h)}H${f(w)}`, noFill: true }]; }
    case "bentConnector4": return [{ d: `M0,0H${f(w / 2)}V${f(h / 2)}H${f(w)}V${f(h)}`, noFill: true }];
    case "curvedConnector2": case "curvedConnector3": case "curvedConnector4": { const x = geom === "curvedConnector2" ? w : (w * a("adj1", 50000)) / 100000; return [{ d: `M0,0C${f(x)},0 ${f(x)},${f(h)} ${f(w)},${f(h)}`, noFill: true }]; }
    default: return [{ d: `M0,0H${f(w)}V${f(h)}H0Z` }];
  }
}

// ───────────────────────── parser ─────────────────────────
interface Xf { x: number; y: number; cx: number; cy: number; rot: number; flipH: boolean; flipV: boolean; chX?: number; chY?: number; chCx?: number; chCy?: number }
function readXfrm(x: XmlNode | undefined): Xf | undefined {
  if (!x) return undefined;
  const off = kid(x, "off"), ext = kid(x, "ext"), cho = kid(x, "chOff"), che = kid(x, "chExt");
  return {
    x: num(off?.attrs.x, 0), y: num(off?.attrs.y, 0), cx: num(ext?.attrs.cx, 0), cy: num(ext?.attrs.cy, 0),
    rot: num(x.attrs.rot, 0) / 60000, flipH: x.attrs.flipH === "1" || x.attrs.flipH === "true", flipV: x.attrs.flipV === "1" || x.attrs.flipV === "true",
    chX: cho ? num(cho.attrs.x, 0) : undefined, chY: cho ? num(cho.attrs.y, 0) : undefined, chCx: che ? num(che.attrs.cx, 0) : undefined, chCy: che ? num(che.attrs.cy, 0) : undefined,
  };
}

type RelMap = (x: number, y: number, w: number, h: number) => ShapeSpec["rel"];
const FULL: RelMap = () => ({ x: 0, y: 0, w: 1, h: 1 });

function parseOne(n: XmlNode, scheme: SchemeLookup, rel: RelMap, top: boolean): ShapeSpec | undefined {
  const tag = local(n);
  const nv = kid(n, tag === "sp" ? "nvSpPr" : "nvCxnSpPr");
  const cNv = kid(nv, "cNvPr");
  const spPr = kid(n, "spPr");
  const style = kid(n, "style");
  const xf = readXfrm(kid(spPr, "xfrm"));
  const prst = kid(spPr, "prstGeom");
  const custom = kid(spPr, "custGeom");
  const geom = prst?.attrs.prst ?? (custom ? "custGeom" : tag === "cxnSp" ? "line" : "rect");
  const adj: Record<string, number> = {};
  for (const gd of kids(kid(prst, "avLst"), "gd")) { const m = /val\s+(-?\d+)/.exec(gd.attrs.fmla ?? ""); if (m) adj[gd.attrs.name ?? ""] = Number(m[1]); }

  // style refs (fill/ln/font) dipakai bila spPr tidak menentukan sendiri
  const refColor = (name: string) => readColor(kid(style, name), scheme);
  let fill = readFill(spPr, scheme);
  if (fill === undefined) {
    const fr = kid(style, "fillRef");
    const c = num(fr?.attrs.idx, 0) > 0 ? refColor("fillRef") : null;
    fill = c ? { kind: "solid", color: c } : null;
  }
  const ln = kid(spPr, "ln");
  let stroke: ShapeColor | null = null;
  let strokeW = 0;
  const lnFill = readFill(ln, scheme);
  if (lnFill === undefined) {
    const lr = kid(style, "lnRef");
    const idx = num(lr?.attrs.idx, 0);
    if (idx > 0) { stroke = refColor("lnRef"); strokeW = (LN_REF_EMU[Math.min(idx, 3)]! || 12700) / EMU_PX; }
  } else if (lnFill) {
    stroke = lnFill.kind === "solid" ? lnFill.color : lnFill.stops[0]!.color;
  }
  if (stroke && ln?.attrs.w) strokeW = num(ln.attrs.w, 12700) / EMU_PX;
  else if (stroke && !strokeW) strokeW = 12700 / EMU_PX;

  const fontRef = refColor("fontRef");
  const tx = readTextBody(kid(n, "txBody"), scheme, fontRef?.hex);
  const arrow = (k: string): ShapeArrow | undefined => { const e = kid(ln, k); return e && e.attrs.type && e.attrs.type !== "none" ? { type: e.attrs.type, w: e.attrs.w ?? "med", len: e.attrs.len ?? "med" } : undefined; };
  const prstDash = kid(ln, "prstDash")?.attrs.val;

  const r = top || !xf ? { x: 0, y: 0, w: 1, h: 1 } : rel(xf.x, xf.y, xf.cx, xf.cy);
  const hasText = !!tx && tx.paras.some(p => p.runs.some(x => x.t.trim()));
  const isLine = isLineGeom(geom);
  return {
    name: cNv?.attrs.name ?? tag, descr: cNv?.attrs.descr || undefined,
    geom, adj, fill: isLine ? null : fill, stroke, strokeW, dash: prstDash ? DASH[prstDash] : undefined,
    rot: xf?.rot ?? 0, flipH: xf?.flipH ?? false, flipV: xf?.flipV ?? false,
    head: arrow("headEnd"), tail: arrow("tailEnd"),
    text: hasText || (tx && tx.paras.length) ? tx : undefined,
    rel: r, hidden: cNv?.attrs.hidden === "1" || cNv?.attrs.hidden === "true",
    approx: geom === "custGeom" || !isKnownGeom(geom),
  };
}

function walk(n: XmlNode, scheme: SchemeLookup, rel: RelMap, top: boolean, out: ShapeSpec[]) {
  const tag = local(n);
  if (tag === "sp" || tag === "cxnSp") { const s = parseOne(n, scheme, rel, top); if (s) out.push(s); return; }
  if (tag !== "grpSp") return;
  const xf = readXfrm(kid(kid(n, "grpSpPr"), "xfrm"));
  let childRel: RelMap = rel;
  if (xf && xf.chCx && xf.chCy) {
    const { x, y, cx, cy, chX = 0, chY = 0, chCx, chCy } = xf;
    if (top) {
      childRel = (px, py, pw, ph) => ({ x: (px - chX) / chCx, y: (py - chY) / chCy, w: pw / chCx, h: ph / chCy });
    } else {
      const sx = cx / chCx, sy = cy / chCy;
      childRel = (px, py, pw, ph) => rel(x + (px - chX) * sx, y + (py - chY) * sy, pw * sx, ph * sy);
    }
  }
  for (const c of n.children) walk(c, scheme, childRel, false, out);
}

/** Bangun grup shape dari node anchor/AlternateContent. `undefined` bila tidak ada shape yang dikenali. */
export function parseShapeGroup(raw: XmlNode | undefined, scheme: SchemeLookup): ShapeGroup | undefined {
  const root = findShapeRoot(raw);
  if (!root) return undefined;
  const shapes: ShapeSpec[] = [];
  walk(root, scheme, FULL, true, shapes);
  if (!shapes.length) return undefined;
  return { shapes, hasText: shapes.some(s => !!shapePlainText(s.text)), approx: shapes.some(s => s.approx) };
}
