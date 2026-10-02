/**
 * Gambar DrawingML: baca tata letak (inline/anchor, wrap, posisi, crop, rotasi), ubah ukuran, kunci rasio,
 * ganti mode wrap (inline ⇄ anchor), serta deteksi ukuran asli dari header berkas gambar.
 */
import { NS, attr, cloneEl, descend, first, mk, num, parseXmlString, setAttr, setChild, type XEl, type XNode, isEl } from "./docx-xml";

export type WrapMode = "inline" | "square" | "tight" | "through" | "topBottom" | "behind" | "front";
export interface PosSpec { rel: string; off?: number; align?: string }
export interface ImgInfo {
  drawing: XEl;
  host: XEl;
  kind: "inline" | "anchor";
  /** pic = gambar; lainnya (chart, shape, group, diagram) tidak dapat diedit sebagai gambar. */
  content: "pic" | "chart" | "shape" | "group" | "diagram" | "ole" | "other";
  cx: number;
  cy: number;
  relId?: string;
  descr: string;
  name: string;
  docPrId: number;
  wrap: WrapMode;
  wrapText?: string;
  behind: boolean;
  posH?: PosSpec;
  posV?: PosSpec;
  dist: { t: number; b: number; l: number; r: number };
  rot: number;
  flipH: boolean;
  flipV: boolean;
  crop?: { l: number; t: number; r: number; b: number };
  lockAspect: boolean;
}

const hostOf = (drawing: XEl) => first(drawing, "inline") ?? first(drawing, "anchor");

export function drawingContent(drawing: XEl): ImgInfo["content"] {
  const host = hostOf(drawing);
  const gd = descend(host, "graphicData");
  const uri = attr(gd, "uri") ?? "";
  if (/picture/.test(uri)) return "pic";
  if (/chart/.test(uri)) return "chart";
  if (/diagram/.test(uri)) return "diagram";
  if (/wordprocessingShape|wps/.test(uri)) return "shape";
  if (/wordprocessingGroup|wpg/.test(uri)) return "group";
  if (/ole/i.test(uri)) return "ole";
  return "other";
}

export function readDrawing(drawing: XEl): ImgInfo | undefined {
  const host = hostOf(drawing);
  if (!host) return undefined;
  const kind = host.name.local === "anchor" ? "anchor" : "inline";
  const ext = first(host, "extent");
  const docPr = first(host, "docPr");
  const pic = descend(host, "pic");
  const blip = descend(host, "blip");
  const xfrm = descend(pic ?? host, "xfrm");
  const src = descend(pic, "srcRect");
  const ph = first(host, "positionH"), pv = first(host, "positionV");
  const spec = (e: XEl | undefined): PosSpec | undefined => {
    if (!e) return undefined;
    const al = first(e, "align");
    const off = first(e, "posOffset");
    return { rel: attr(e, "relativeFrom") ?? "column", align: al ? al.children.map(c => (c.kind === "text" ? c.value : "")).join("").trim() : undefined, off: off ? num(off.children.map(c => (c.kind === "text" ? c.value : "")).join("").trim()) : undefined };
  };
  let wrap: WrapMode = "inline";
  let wrapText: string | undefined;
  const behind = attr(host, "behindDoc") === "1" || attr(host, "behindDoc") === "true";
  if (kind === "anchor") {
    if (first(host, "wrapSquare")) { wrap = "square"; wrapText = attr(first(host, "wrapSquare"), "wrapText"); }
    else if (first(host, "wrapTight")) { wrap = "tight"; wrapText = attr(first(host, "wrapTight"), "wrapText"); }
    else if (first(host, "wrapThrough")) { wrap = "through"; wrapText = attr(first(host, "wrapThrough"), "wrapText"); }
    else if (first(host, "wrapTopAndBottom")) wrap = "topBottom";
    else wrap = behind ? "behind" : "front";
  }
  const locks = descend(host, "graphicFrameLocks") ?? descend(host, "picLocks");
  return {
    drawing, host, kind,
    content: drawingContent(drawing),
    cx: num(attr(ext, "cx")) ?? 0,
    cy: num(attr(ext, "cy")) ?? 0,
    relId: blip ? attr(blip, "embed") ?? attr(blip, "link") : undefined,
    descr: attr(docPr, "descr") ?? "",
    name: attr(docPr, "name") ?? "",
    docPrId: num(attr(docPr, "id")) ?? 0,
    wrap, wrapText, behind,
    posH: spec(ph), posV: spec(pv),
    dist: { t: num(attr(host, "distT")) ?? 0, b: num(attr(host, "distB")) ?? 0, l: num(attr(host, "distL")) ?? 0, r: num(attr(host, "distR")) ?? 0 },
    rot: (num(attr(xfrm, "rot")) ?? 0) / 60000,
    flipH: attr(xfrm, "flipH") === "1", flipV: attr(xfrm, "flipV") === "1",
    crop: src ? { l: num(attr(src, "l")) ?? 0, t: num(attr(src, "t")) ?? 0, r: num(attr(src, "r")) ?? 0, b: num(attr(src, "b")) ?? 0 } : undefined,
    lockAspect: attr(locks, "noChangeAspect") === "1" || attr(locks, "noChangeAspect") === "true",
  };
}

function setExt(el: XEl | undefined, cx: number, cy: number) {
  if (!el) return;
  setAttr(el, "cx", String(Math.max(1, Math.round(cx))), "", "");
  setAttr(el, "cy", String(Math.max(1, Math.round(cy))), "", "");
}
export function setSize(drawing: XEl, cx: number, cy: number) {
  const host = hostOf(drawing);
  if (!host) return;
  setExt(first(host, "extent"), cx, cy);
  const pic = descend(host, "pic");
  const x = descend(pic ?? host, "xfrm");
  setExt(first(x, "ext"), cx, cy);
  // spPr ext (a:ext) tidak berprefix wp; atribut yang sama (cx, cy)
}
export function setLockAspect(drawing: XEl, on: boolean) {
  const host = hostOf(drawing);
  const l1 = descend(host, "graphicFrameLocks");
  const l2 = descend(host, "picLocks");
  for (const l of [l1, l2]) if (l) setAttr(l, "noChangeAspect", on ? "1" : undefined, "", "");
  if (on && !l1 && !l2) {
    const cnv = first(host, "cNvGraphicFramePr");
    if (cnv) cnv.children.push(mk("graphicFrameLocks", { noChangeAspect: 1 }, undefined, NS.a, "a"));
  }
}
export function setAlt(drawing: XEl, descr: string, title?: string) {
  const host = hostOf(drawing);
  const dp = first(host, "docPr");
  if (!dp) return;
  setAttr(dp, "descr", descr || undefined, "", "");
  if (title !== undefined) setAttr(dp, "title", title || undefined, "", "");
}
export function setRotation(drawing: XEl, deg: number, flipH?: boolean, flipV?: boolean) {
  const host = hostOf(drawing);
  const x = descend(descend(host, "pic") ?? host, "xfrm");
  if (!x) return;
  setAttr(x, "rot", deg ? String(Math.round(((deg % 360) + 360) % 360 * 60000)) : undefined, "", "");
  if (flipH !== undefined) setAttr(x, "flipH", flipH ? "1" : undefined, "", "");
  if (flipV !== undefined) setAttr(x, "flipV", flipV ? "1" : undefined, "", "");
}
export function setCrop(drawing: XEl, crop: { l: number; t: number; r: number; b: number } | null) {
  const pic = descend(hostOf(drawing), "pic");
  const bf = first(pic, "blipFill");
  if (!bf) return;
  const old = first(bf, "srcRect");
  if (old) bf.children.splice(bf.children.indexOf(old), 1);
  if (!crop || (!crop.l && !crop.t && !crop.r && !crop.b)) return;
  const el = mk("srcRect", { l: Math.round(crop.l), t: Math.round(crop.t), r: Math.round(crop.r), b: Math.round(crop.b) }, undefined, NS.a, "a");
  const blipIdx = bf.children.findIndex(c => isEl(c) && c.name.local === "blip");
  bf.children.splice(blipIdx + 1, 0, el);
}

const DECL = `xmlns:w="${NS.w}" xmlns:wp="${NS.wp}" xmlns:a="${NS.a}" xmlns:pic="${NS.pic}" xmlns:r="${NS.r}"`;

function takeKids(host: XEl, ...locals: string[]): XEl[] {
  return locals.map(l => first(host, l)).filter((x): x is XEl => !!x);
}

const ANCHOR_ID = { n: 251658240 };

/** Ubah mode tata letak. `opts.h` mengatur perataan horizontal bawaan untuk wrap. */
export function setWrapMode(drawing: XEl, mode: WrapMode, opts?: { h?: "left" | "center" | "right"; offsetX?: number; offsetY?: number; rel?: "page" | "margin" | "column" }) {
  const info = readDrawing(drawing);
  const host = hostOf(drawing);
  if (!info || !host) return;
  const extent = first(host, "extent") ?? mk("extent", { cx: info.cx, cy: info.cy }, undefined, NS.wp, "wp");
  const effect = first(host, "effectExtent") ?? mk("effectExtent", { l: 0, t: 0, r: 0, b: 0 }, undefined, NS.wp, "wp");
  const rest = takeKids(host, "docPr", "cNvGraphicFramePr", "graphic");
  const decl = (el: XEl) => { for (const [k, v] of [["w", NS.w], ["wp", NS.wp], ["a", NS.a], ["pic", NS.pic], ["r", NS.r]]) if (!el.attrs.some(a => a.isNamespaceDecl && a.name.local === k)) el.attrs.push({ name: { uri: NS.xmlns, local: k, prefix: "xmlns" }, value: v, isNamespaceDecl: true }); };
  void decl; void DECL;
  let nh: XEl;
  if (mode === "inline") {
    nh = mk("inline", { distT: 0, distB: 0, distL: 0, distR: 0 }, [extent, effect, ...rest], NS.wp, "wp");
  } else {
    const d = info.dist;
    const behind = mode === "behind";
    const hAlign = opts?.h;
    const posH: XEl = hAlign
      ? mk("positionH", { relativeFrom: opts?.rel ?? "margin" }, [mk("align", undefined, [{ kind: "text", value: hAlign }], NS.wp, "wp")], NS.wp, "wp")
      : mk("positionH", { relativeFrom: opts?.rel ?? info.posH?.rel ?? "column" }, [mk("posOffset", undefined, [{ kind: "text", value: String(Math.round(opts?.offsetX ?? info.posH?.off ?? 0)) }], NS.wp, "wp")], NS.wp, "wp");
    const posV: XEl = mk("positionV", { relativeFrom: info.posV?.rel ?? "paragraph" }, [mk("posOffset", undefined, [{ kind: "text", value: String(Math.round(opts?.offsetY ?? info.posV?.off ?? 0)) }], NS.wp, "wp")], NS.wp, "wp");
    const wrap = mode === "square" || mode === "tight" || mode === "through"
      ? mk("wrapSquare", { wrapText: info.wrapText ?? "bothSides" }, undefined, NS.wp, "wp")
      : mode === "topBottom" ? mk("wrapTopAndBottom", undefined, undefined, NS.wp, "wp") : mk("wrapNone", undefined, undefined, NS.wp, "wp");
    const dist = mode === "square" || mode === "tight" || mode === "through" ? { t: d.t, b: d.b, l: d.l || 114300, r: d.r || 114300 } : d;
    nh = mk("anchor", {
      distT: dist.t, distB: dist.b, distL: dist.l, distR: dist.r, simplePos: 0, relativeHeight: ANCHOR_ID.n++, behindDoc: behind ? 1 : 0, locked: 0, layoutInCell: 1, allowOverlap: 1,
    }, [mk("simplePos", { x: 0, y: 0 }, undefined, NS.wp, "wp"), posH, posV, extent, effect, wrap, ...rest], NS.wp, "wp");
    if (mode === "topBottom") { setAttr(posH, "relativeFrom", opts?.rel ?? "margin", "", ""); if (!hAlign) { posH.children = [mk("align", undefined, [{ kind: "text", value: "center" }], NS.wp, "wp")]; } }
  }
  const i = drawing.children.indexOf(host);
  drawing.children[i] = nh;
}

export function setPosition(drawing: XEl, offsetX: number, offsetY: number, relH?: string, relV?: string) {
  const host = first(drawing, "anchor");
  if (!host) return;
  const mkPos = (name: "positionH" | "positionV", rel: string, off: number) => mk(name, { relativeFrom: rel }, [mk("posOffset", undefined, [{ kind: "text", value: String(Math.round(off)) }], NS.wp, "wp")], NS.wp, "wp");
  const oh = first(host, "positionH"), ov = first(host, "positionV");
  const nh = mkPos("positionH", relH ?? attr(oh, "relativeFrom") ?? "column", offsetX);
  const nv = mkPos("positionV", relV ?? attr(ov, "relativeFrom") ?? "paragraph", offsetY);
  if (oh) host.children[host.children.indexOf(oh)] = nh;
  if (ov) host.children[host.children.indexOf(ov)] = nv;
}
export function setWrapDistance(drawing: XEl, d: { t?: number; b?: number; l?: number; r?: number }) {
  const host = first(drawing, "anchor");
  if (!host) return;
  if (d.t !== undefined) setAttr(host, "distT", String(Math.round(d.t)), "", "");
  if (d.b !== undefined) setAttr(host, "distB", String(Math.round(d.b)), "", "");
  if (d.l !== undefined) setAttr(host, "distL", String(Math.round(d.l)), "", "");
  if (d.r !== undefined) setAttr(host, "distR", String(Math.round(d.r)), "", "");
}

/** Salin drawing dengan docPr id baru (untuk duplikat/tempel). */
export function cloneDrawing(drawing: XEl, newId: number): XEl {
  const c = cloneEl(drawing);
  const dp = first(hostOf(c), "docPr");
  if (dp) setAttr(dp, "id", String(newId), "", "");
  return c;
}

/** Ganti rId gambar (embed) — mis. saat "Ganti gambar". */
export function replaceBlip(drawing: XEl, relId: string) {
  const blip = descend(hostOf(drawing), "blip");
  if (blip) setAttr(blip, "embed", relId, NS.r, "r");
}

export function maxDocPrId(root: XEl): number {
  let m = 0;
  const walk = (e: XEl) => { for (const c of e.children) if (isEl(c)) { if (c.name.local === "docPr") m = Math.max(m, num(attr(c, "id")) ?? 0); walk(c); } };
  walk(root);
  return m;
}

// ───────── ukuran asli dari header berkas ─────────

export function sniffImageSize(b: Uint8Array): { w: number; h: number; type: string } | undefined {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { w: dv.getUint32(16), h: dv.getUint32(20), type: "image/png" };
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { w: dv.getUint16(6, true), h: dv.getUint16(8, true), type: "image/gif" };
  if (b.length > 26 && b[0] === 0x42 && b[1] === 0x4d) return { w: Math.abs(dv.getInt32(18, true)), h: Math.abs(dv.getInt32(22, true)), type: "image/bmp" };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: dv.getUint16(i + 5), w: dv.getUint16(i + 7), type: "image/jpeg" };
      i += 2 + dv.getUint16(i + 2);
    }
    return undefined;
  }
  if (b.length > 30 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) { // RIFF....WEBP
    const tag = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (tag === "VP8X") return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)), type: "image/webp" };
    if (tag === "VP8 ") return { w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff, type: "image/webp" };
    if (tag === "VP8L") { const v = dv.getUint32(21, true); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1, type: "image/webp" }; }
  }
  return undefined;
}

export const IMAGE_BROWSER_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/bmp", "image/webp", "image/svg+xml", "image/avif", "image/x-icon", "image/vnd.microsoft.icon"]);

export function parseDrawingXml(xml: string): XEl { return parseXmlString(xml); }
export { setChild };
export type { XNode };
