/**
 * Opasitas (alfa) warna untuk bentuk PPTX. Library hanya menyediakan pembaca (`getShapeFillOpacity`, `getShapeStrokeOpacity`);
 * penulisan dilakukan langsung pada XML DrawingML: `<a:solidFill><a:srgbClr val="…"><a:alpha val="50000"/></a:srgbClr></a:solidFill>`.
 * Elemen XML bentuk diambil dari properti bersimbol milik `SlideShapeData` (simbol internal library, ditemukan lewat nilainya).
 */
import type { SlideShapeData } from "@office-kit/pptx";

interface QName { prefix: string; localName: string; namespaceURI: string }
interface XEl { kind: "element"; name: QName; attrs: { name: QName; value: string }[]; children: unknown[]; prefixDecls: Map<string, string> }

const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const isEl = (n: unknown): n is XEl => !!n && (n as XEl).kind === "element";
const kids = (e: XEl, local: string) => e.children.filter((c): c is XEl => isEl(c) && c.name.localName === local);
const kid = (e: XEl | undefined, local: string) => (e ? kids(e, local)[0] : undefined);
/** Anak elemen warna pertama (srgbClr/schemeClr/…) dari `a:solidFill`. */
const colorOf = (fill: XEl | undefined) => (fill ? (fill.children.find(isEl) as XEl | undefined) : undefined);

/** Elemen XML akar bentuk (`p:sp`, `p:cxnSp`, `p:pic`, …) atau undefined. */
export function shapeXml(shape: SlideShapeData): XEl | undefined {
  for (const k of Object.getOwnPropertySymbols(shape)) {
    const v = (shape as unknown as Record<symbol, unknown>)[k];
    if (isEl(v)) return v;
  }
  return undefined;
}

const alphaEl = (a: number): XEl => ({ kind: "element", name: { prefix: "a", localName: "alpha", namespaceURI: A_NS }, attrs: [{ name: { prefix: "", localName: "val", namespaceURI: "" }, value: String(Math.round(Math.min(1, Math.max(0, a)) * 100000)) }], children: [], prefixDecls: new Map() });

function writeAlpha(color: XEl | undefined, alpha: number | null): boolean {
  if (!color) return false;
  color.children = color.children.filter(c => !(isEl(c) && c.name.localName === "alpha"));
  if (alpha !== null && alpha < 1) color.children.push(alphaEl(alpha));
  return true;
}
function readAlpha(color: XEl | undefined): number | null {
  const a = kid(color, "alpha");
  if (!a) return null;
  const v = parseInt(a.attrs.find(x => x.name.localName === "val")?.value ?? "", 10);
  return Number.isFinite(v) ? v / 100000 : null;
}

const spPr = (shape: SlideShapeData) => kid(shapeXml(shape), "spPr");

/** Atur opasitas isi solid bentuk (null/1 = opak). Mengembalikan false bila isinya bukan warna solid. */
export function setFillAlpha(shape: SlideShapeData, alpha: number | null): boolean {
  return writeAlpha(colorOf(kid(spPr(shape), "solidFill")), alpha);
}
/** Atur opasitas garis solid bentuk. */
export function setStrokeAlpha(shape: SlideShapeData, alpha: number | null): boolean {
  return writeAlpha(colorOf(kid(kid(spPr(shape), "ln"), "solidFill")), alpha);
}

/** Warna `a:rPr/a:solidFill` pada semua run teks (`a:r`) bentuk. */
function runColorEls(shape: SlideShapeData): XEl[][] {
  const tx = kid(shapeXml(shape), "txBody");
  if (!tx) return [];
  return kids(tx, "p").map(p => kids(p, "r").map(r => colorOf(kid(kid(r, "rPr"), "solidFill"))).filter((c): c is XEl => !!c));
}
/** Opasitas teks: untuk semua run (null = opak). Run tanpa warna eksplisit diabaikan. */
export function setTextAlpha(shape: SlideShapeData, alpha: number | null): number {
  let n = 0;
  for (const row of runColorEls(shape)) for (const c of row) if (writeAlpha(c, alpha)) n++;
  return n;
}
/** Opasitas run ke-`r` pada paragraf ke-`p` (null = opak/tidak ada). */
export function runAlpha(shape: SlideShapeData, p: number, r: number): number | null {
  const tx = kid(shapeXml(shape), "txBody");
  const para = tx ? kids(tx, "p")[p] : undefined;
  const run = para ? kids(para, "r")[r] : undefined;
  return readAlpha(colorOf(kid(kid(run, "rPr"), "solidFill")));
}
/** Opasitas bersama seluruh run teks bentuk bila seragam; null bila tidak ada/beragam. */
export function textAlphaOf(shape: SlideShapeData): number | null {
  const vals = new Set<number | null>();
  for (const row of runColorEls(shape)) for (const c of row) vals.add(readAlpha(c));
  return vals.size === 1 ? [...vals][0] : null;
}

/** Atur opasitas run ke-`r` pada paragraf ke-`p`. */
export function setRunAlpha(shape: SlideShapeData, p: number, r: number, alpha: number | null): boolean {
  const tx = kid(shapeXml(shape), "txBody");
  const para = tx ? kids(tx, "p")[p] : undefined;
  const run = para ? kids(para, "r")[r] : undefined;
  return writeAlpha(colorOf(kid(kid(run, "rPr"), "solidFill")), alpha);
}
