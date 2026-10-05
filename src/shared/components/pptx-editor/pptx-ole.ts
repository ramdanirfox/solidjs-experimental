/**
 * Objek OLE pada PPTX: baca, sisip, dan perbarui.
 *
 * @office-kit/pptx belum punya API OLE — dan objek OLE buatan PowerPoint dibungkus `mc:AlternateContent` sehingga library tidak
 * menampilkannya sebagai shape sama sekali. Karena itu bingkai OLE dibaca langsung dari XML slide (`scanSlideOle`), dan bagian paket
 * (part embedding, pratinjau, relasi slide) serta XML slide diubah lewat `_internalPackageOf`. Setelah perubahan, panggil
 * `PptxDeck.mutatePackage` agar model dimuat ulang dari paket yang sudah benar.
 */
import * as P from "@office-kit/pptx";
import type { PresentationData, SlideData, SlideShapeData } from "@office-kit/pptx";
import { REL_IMAGE, type PreparedOle } from "../office-shared/ole-embed";
import { isCfb, isZip, readCfb } from "../office-shared/ole-core";

const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const OLE_URI = "http://schemas.openxmlformats.org/presentationml/2006/ole";
const STEM: Record<string, string> = {
  xlsx: "Microsoft_Excel_Worksheet", xlsm: "Microsoft_Excel_Worksheet", docx: "Microsoft_Word_Document", docm: "Microsoft_Word_Document",
  pptx: "Microsoft_PowerPoint_Presentation", pptm: "Microsoft_PowerPoint_Presentation",
};
const EMU_PER_PX = 9525;

type Pkg = ReturnType<typeof P._internalPackageOf>;
const pkgOf = (pres: PresentationData): Pkg => P._internalPackageOf(pres);
type Bounds = { x: number; y: number; w: number; h: number };

export interface OleFrameInfo {
  progId: string;
  name: string;
  /** Id relasi ke part embedding; undefined bila tertaut (link) atau rusak. */
  relId?: string;
  linked: boolean;
  /** Id relasi gambar pratinjau. */
  previewRelId?: string;
}

/** Bingkai OLE hasil pindai XML slide. */
export interface RawOleFrame extends OleFrameInfo {
  /** `p:cNvPr@id`. */
  id: number;
  bounds: Bounds;
  /** Anak langsung spTree/grpSp (dikenal library sebagai shape). false = di dalam `mc:AlternateContent` (buatan PowerPoint). */
  direct: boolean;
}

export interface PptxOle extends RawOleFrame {
  slideIndex: number;
  shapeId: number;
  shapeName: string;
  part: string;
  previewPart?: string;
  size: number;
  format: "cfb" | "zip" | "other" | "missing";
  fileName: string;
  description: string;
}

const parse = (xml: string) => new DOMParser().parseFromString(xml, "application/xml");
const posixResolve = (base: string, target: string) => {
  if (target.startsWith("/")) return target;
  const out = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) { if (seg === "..") out.pop(); else if (seg && seg !== ".") out.push(seg); }
  return out.join("/");
};
const relTarget = (pres: PresentationData, slidePart: string, relId: string | undefined) => {
  if (!relId) return undefined;
  const rel = pkgOf(pres).getRels(slidePart)?.items.find(r => r.id === relId);
  if (!rel) return undefined;
  return { rel, part: rel.targetMode === "External" ? rel.target : posixResolve(slidePart, rel.target) };
};

/** Posisi/ukuran bingkai dari `<p:xfrm>` milik graphicFrame itu sendiri (bukan xfrm di dalam `<p:pic>`). */
const frameBounds = (f: Element): Bounds => {
  const xfrm = [...f.children].find(c => c.localName === "xfrm");
  const o = xfrm?.getElementsByTagNameNS(NS_A, "off")[0], e = xfrm?.getElementsByTagNameNS(NS_A, "ext")[0];
  return { x: Number(o?.getAttribute("x") ?? 0), y: Number(o?.getAttribute("y") ?? 0), w: Number(e?.getAttribute("cx") ?? 0), h: Number(e?.getAttribute("cy") ?? 0) };
};

const scanCache = new WeakMap<SlideData, { xml: string; frames: RawOleFrame[] }>();

/** Pindai XML slide: semua `p:graphicFrame` OLE, termasuk yang dibungkus `mc:AlternateContent` (cabang Choice & Fallback dilebur per id). */
export function scanSlideOle(slide: SlideData): RawOleFrame[] {
  const xml = P.getSlideXmlString(slide);
  const hit = scanCache.get(slide);
  if (hit && hit.xml === xml) return hit.frames;
  const doc = parse(xml);
  const byId = new Map<number, { frame: RawOleFrame; rich: boolean }>();
  for (const f of doc.getElementsByTagNameNS(NS_P, "graphicFrame")) {
    const gd = f.getElementsByTagNameNS(NS_A, "graphicData")[0];
    if (gd?.getAttribute("uri") !== OLE_URI) continue;
    const objs = [...f.getElementsByTagNameNS(NS_P, "oleObj")];
    const ole = objs.find(o => o.getElementsByTagNameNS(NS_P, "pic").length) ?? objs[0];
    if (!ole) continue;
    const id = Number(f.getElementsByTagNameNS(NS_P, "cNvPr")[0]?.getAttribute("id") ?? 0);
    const parent = f.parentElement;
    const direct = !!parent && (parent.localName === "spTree" || parent.localName === "grpSp");
    const blip = f.getElementsByTagNameNS(NS_A, "blip")[0];
    const rich = ole.getElementsByTagNameNS(NS_P, "pic").length > 0;
    const frame: RawOleFrame = {
      id, direct, bounds: frameBounds(f),
      progId: ole.getAttribute("progId") ?? "", name: ole.getAttribute("name") ?? "",
      relId: ole.getAttributeNS(NS_R, "id") || undefined, linked: ole.getElementsByTagNameNS(NS_P, "link").length > 0,
      previewRelId: blip?.getAttributeNS(NS_R, "embed") || undefined,
    };
    const prev = byId.get(id);
    // cabang yang memuat <p:pic> (Fallback) lebih informatif; "direct" hanya bila semua cabang adalah anak langsung spTree
    if (!prev || (rich && !prev.rich)) byId.set(id, { frame: { ...frame, direct: prev ? prev.frame.direct && direct : direct }, rich });
  }
  const frames = [...byId.values()].map(v => v.frame);
  scanCache.set(slide, { xml, frames });
  return frames;
}

/** Info OLE sebuah shape yang dikenal library (bingkai langsung); `null` bila bukan bingkai OLE. */
export function readOleFrame(shape: SlideShapeData): OleFrameInfo | null {
  if (P.getShapeKind(shape) !== "graphicFrame" || P.isTableShape(shape) || P.isChartShape(shape)) return null;
  const id = P.getShapeId(shape);
  const f = scanSlideOle(P.getShapeSlide(shape)).find(x => x.id === id);
  return f ? { progId: f.progId, name: f.name, relId: f.relId, linked: f.linked, previewRelId: f.previewRelId } : null;
}

const IMG_FMT: Record<string, string> = { png: "png", jpg: "jpeg", jpeg: "jpeg", gif: "gif", bmp: "bmp", webp: "webp", svg: "svg" };

/** Gambar pratinjau bingkai OLE (EMF/WMF tidak didukung browser → undefined). */
export function oleFramePreview(pres: PresentationData, slide: SlideData, info: OleFrameInfo): { bytes: Uint8Array; format: string } | undefined {
  if (!info.previewRelId) return undefined;
  const t = relTarget(pres, P.getSlidePartName(slide), info.previewRelId);
  if (!t || t.rel.targetMode === "External") return undefined;
  const format = IMG_FMT[(t.part.split(".").pop() ?? "").toLowerCase()];
  const bytes = format ? P.readPackagePart(pres, t.part) : null;
  return bytes && format ? { bytes, format } : undefined;
}

/** Daftar objek OLE di seluruh slide (termasuk yang dibungkus mc:AlternateContent). */
export function listPptxOle(pres: PresentationData): PptxOle[] {
  const out: PptxOle[] = [];
  P.getSlides(pres).forEach((slide, slideIndex) => {
    const slidePart = P.getSlidePartName(slide);
    for (const f of scanSlideOle(slide)) {
      const t = relTarget(pres, slidePart, f.relId);
      const data = t && !f.linked && t.rel.targetMode !== "External" ? P.readPackagePart(pres, t.part) : null;
      const pv = relTarget(pres, slidePart, f.previewRelId);
      let description = f.progId || "OLE";
      let fileName = t?.part.split("/").pop() ?? "";
      const format: PptxOle["format"] = !data ? "missing" : isCfb(data) ? "cfb" : isZip(data) ? "zip" : "other";
      if (data && format === "cfb") { try { const c = readCfb(data); description = c.userType ?? c.kind ?? description; if (c.native) fileName = c.native.fileName; } catch { /* abaikan */ } }
      out.push({ ...f, slideIndex, shapeId: f.id, shapeName: f.name || `Object ${f.id}`, part: t?.part ?? "", previewPart: pv?.part, size: data?.length ?? 0, format, fileName, description });
    }
  });
  return out;
}

// ───────── penulisan paket ─────────

function ensureContentType(pkg: Pkg, part: string, ext: string, ct: string) {
  const ctx = pkg.contentTypes as unknown as { defaults: { extension: string; contentType: string }[]; overrides: { partName: string; contentType: string }[] };
  const def = ctx.defaults.find(d => d.extension.toLowerCase() === ext.toLowerCase());
  if (!def) ctx.defaults.push({ extension: ext, contentType: ct });
  else if (def.contentType !== ct) ctx.overrides.push({ partName: part, contentType: ct });
}
function uniquePart(pkg: Pkg, dir: string, stem: string, ext: string): string {
  let n = 1;
  while (pkg.getPart(`${dir}${stem}${n}.${ext}`)) n++;
  return `${dir}${stem}${n}.${ext}`;
}
function addPartWithCt(pkg: Pkg, part: string, ct: string, data: Uint8Array, ext: string) {
  ensureContentType(pkg, part, ext, ct);
  pkg.addPart(part, ct, data);
}
function nextRelId(items: { id: string }[], prefix: string): string {
  const used = new Set(items.map(i => i.id));
  let n = 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function frameXml(id: number, name: string, p: PreparedOle, relId: string, previewRelId: string, b: Bounds): string {
  return (
    `<p:graphicFrame xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${esc(name)}"/>` +
    `<p:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="${b.x}" y="${b.y}"/><a:ext cx="${b.w}" cy="${b.h}"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="${OLE_URI}"><p:oleObj name="${esc(p.label)}" r:id="${relId}" imgW="${b.w}" imgH="${b.h}" progId="${esc(p.progId)}" showAsIcon="1"><p:embed/>` +
    `<p:pic><p:nvPicPr><p:cNvPr id="0" name=""/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${previewRelId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${b.w}" cy="${b.h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:oleObj></a:graphicData></a:graphic></p:graphicFrame>`
  );
}

export interface OleFrameBounds { x?: number; y?: number; w?: number; h?: number }
export interface InsertedOleFrame { shapeId: number; relId: string; part: string; previewRelId: string; previewPart: string; slideIndex: number; bounds: Bounds }

/** Sisipkan bingkai OLE di slide `slideIndex` (default: tengah slide, ±2,4 kali ukuran pratinjau). */
export function insertOleFrame(pres: PresentationData, slideIndex: number, p: PreparedOle, at: OleFrameBounds = {}): InsertedOleFrame {
  const slide = P.getSlides(pres)[slideIndex];
  if (!slide) throw new Error(`Slide ${slideIndex + 1} tidak ada.`);
  const pkg = pkgOf(pres), slidePart = P.getSlidePartName(slide);
  const size = P.getSlideSize(pres) ?? { width: 12192000, height: 6858000 };
  const w = Math.round(at.w ?? p.previewWidth * EMU_PER_PX * 2.4), h = Math.round(at.h ?? (at.w ? (at.w * p.previewHeight) / p.previewWidth : p.previewHeight * EMU_PER_PX * 2.4));
  const bounds = { x: Math.round(at.x ?? (size.width - w) / 2), y: Math.round(at.y ?? (size.height - h) / 2), w, h };

  const part = uniquePart(pkg, "/ppt/embeddings/", STEM[p.ext] ?? "oleObject", p.ext);
  addPartWithCt(pkg, part, p.contentType, p.bytes, p.ext);
  const previewPart = uniquePart(pkg, "/ppt/media/", "oleprev", "png");
  addPartWithCt(pkg, previewPart, "image/png", p.preview, "png");
  const rels = pkg.getRels(slidePart) ?? { items: [] };
  const relId = nextRelId(rels.items, "rIdOle");
  rels.items.push({ id: relId, type: p.relType, target: part.replace("/ppt/", "../"), targetMode: "Internal" } as never);
  const previewRelId = nextRelId(rels.items, "rIdOlePv");
  rels.items.push({ id: previewRelId, type: REL_IMAGE, target: previewPart.replace("/ppt/", "../"), targetMode: "Internal" } as never);
  pkg.setRels(slidePart, rels as never);

  const sp = pkg.getPart(slidePart)!;
  const xml = new TextDecoder().decode(sp.data);
  // id baru = maks. semua cNvPr@id di XML slide + 1 (termasuk id grup akar spTree, yang tidak dihitung getMaxShapeId)
  let maxId = 1;
  for (const m of xml.matchAll(/<p:cNvPr\b[^>]*?\sid="(\d+)"/g)) maxId = Math.max(maxId, Number(m[1]));
  const shapeId = maxId + 1;
  const at2 = xml.lastIndexOf("</p:spTree>");
  if (at2 < 0) throw new Error("Slide tidak memiliki <p:spTree>.");
  sp.data = new TextEncoder().encode(xml.slice(0, at2) + frameXml(shapeId, `Object ${shapeId}`, p, relId, previewRelId, bounds) + xml.slice(at2));
  return { shapeId, relId, part, previewRelId, previewPart, slideIndex, bounds };
}

export interface UpdatedOleFrame extends InsertedOleFrame { oldRelId?: string; oldPart?: string }

/**
 * Ganti isi bingkai OLE: part baru + gambar pratinjau baru; part lama dibuang bila tidak dirujuk lagi. Posisi & ukuran dipertahankan.
 * Bingkai buatan PowerPoint (`mc:AlternateContent` dengan cabang VML) diubah menjadi bingkai biasa agar pratinjau baru yang dipakai.
 */
export function updateOleFrame(pres: PresentationData, slideIndex: number, shapeId: number, p: PreparedOle): UpdatedOleFrame {
  const slide = P.getSlides(pres)[slideIndex];
  if (!slide) throw new Error(`Slide ${slideIndex + 1} tidak ada.`);
  const info = scanSlideOle(slide).find(f => f.id === shapeId);
  if (!info) throw new Error(`Objek OLE (shape ${shapeId}) tidak ditemukan di slide ${slideIndex + 1}.`);
  const pkg = pkgOf(pres), slidePart = P.getSlidePartName(slide);
  const old = relTarget(pres, slidePart, info.relId), oldPv = relTarget(pres, slidePart, info.previewRelId);

  const part = uniquePart(pkg, "/ppt/embeddings/", STEM[p.ext] ?? "oleObject", p.ext);
  addPartWithCt(pkg, part, p.contentType, p.bytes, p.ext);
  const previewPart = uniquePart(pkg, "/ppt/media/", "oleprev", "png");
  addPartWithCt(pkg, previewPart, "image/png", p.preview, "png");
  const rels = pkg.getRels(slidePart)!;
  const relId = nextRelId(rels.items, "rIdOle");
  rels.items.push({ id: relId, type: p.relType, target: part.replace("/ppt/", "../"), targetMode: "Internal" } as never);
  const previewRelId = nextRelId(rels.items, "rIdOlePv");
  rels.items.push({ id: previewRelId, type: REL_IMAGE, target: previewPart.replace("/ppt/", "../"), targetMode: "Internal" } as never);

  const sp = pkg.getPart(slidePart)!;
  const doc = parse(new TextDecoder().decode(sp.data));
  const frames = [...doc.getElementsByTagNameNS(NS_P, "graphicFrame")].filter(f => f.getElementsByTagNameNS(NS_P, "cNvPr")[0]?.getAttribute("id") === String(shapeId)
    && f.getElementsByTagNameNS(NS_A, "graphicData")[0]?.getAttribute("uri") === OLE_URI);
  if (!frames.length) throw new Error("Bingkai OLE tidak ditemukan pada XML slide.");
  for (const f of frames) {
    for (const o of f.getElementsByTagNameNS(NS_P, "oleObj")) {
      if (info.relId && o.getAttributeNS(NS_R, "id") === info.relId) o.setAttributeNS(NS_R, "r:id", relId);
      o.setAttribute("progId", p.progId);
      o.setAttribute("name", p.label);
    }
    for (const b of f.getElementsByTagNameNS(NS_A, "blip")) if (b.getAttributeNS(NS_R, "embed") === info.previewRelId) b.setAttributeNS(NS_R, "r:embed", previewRelId);
  }
  // lepas pembungkus mc:AlternateContent: pakai cabang Fallback (yang memuat <p:pic>) sebagai bingkai biasa
  for (const f of frames) {
    const choice = f.parentElement, ac = choice?.parentElement;
    if (!choice || !ac || ac.namespaceURI !== NS_MC || ac.localName !== "AlternateContent" || !ac.parentNode) continue;
    const keep = [...ac.getElementsByTagNameNS(NS_P, "graphicFrame")].find(g => g.getElementsByTagNameNS(NS_P, "pic").length) ?? f;
    for (const o of keep.getElementsByTagNameNS(NS_P, "oleObj")) o.removeAttribute("spid");
    ac.replaceWith(keep);
  }
  const xml = DECL + new XMLSerializer().serializeToString(doc.documentElement);
  sp.data = new TextEncoder().encode(xml);

  // buang relasi + part lama bila tidak dirujuk lagi oleh XML slide
  const drop = (rel?: { rel: { id: string }; part: string }) => {
    if (!rel || xml.includes(`"${rel.rel.id}"`)) return;
    const i = rels.items.findIndex(r => r.id === rel.rel.id);
    if (i >= 0) rels.items.splice(i, 1);
    const stillUsed = P.getSlides(pres).some(s => s !== slide && (pkg.getRels(P.getSlidePartName(s))?.items ?? []).some(r => r.targetMode !== "External" && posixResolve(P.getSlidePartName(s), r.target) === rel.part));
    if (!stillUsed && rel.part.startsWith("/ppt/")) pkg.removePart(rel.part);
  };
  drop(old);
  drop(oldPv);
  pkg.setRels(slidePart, rels as never);
  return { shapeId, relId, part, previewRelId, previewPart, slideIndex, bounds: info.bounds, oldRelId: info.relId, oldPart: old?.part };
}

/** Bytes isi embedding bingkai OLE. */
export function pptxOleBytes(pres: PresentationData, slideIndex: number, shapeId: number): { data: Uint8Array; part: string } | undefined {
  const slide = P.getSlides(pres)[slideIndex];
  const info = slide ? scanSlideOle(slide).find(f => f.id === shapeId) : undefined;
  if (!slide || !info || info.linked) return undefined;
  const t = relTarget(pres, P.getSlidePartName(slide), info.relId);
  const data = t && t.rel.targetMode !== "External" ? P.readPackagePart(pres, t.part) : null;
  return data && t ? { data, part: t.part } : undefined;
}

export const isOleShape = (shape: SlideShapeData) => { try { return !!readOleFrame(shape); } catch { return false; } };
