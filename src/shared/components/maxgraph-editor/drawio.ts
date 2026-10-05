/**
 * Serialisasi / deserialisasi draw.io (diagrams.net) untuk maxGraph.
 *
 * Impor mengenali tiga bentuk:
 *   - `<mxfile><diagram>…</diagram></mxfile>`  (berkas .drawio; isi diagram bisa terkompresi: base64 → deflate-raw → URL-encoded XML)
 *   - `<mxGraphModel>` polos                   (hasil "Export as XML" tanpa kompresi)
 *   - `<GraphDataModel>`                       (format asli maxGraph; tidak diubah, dimuat lewat ModelXmlSerializer oleh editor)
 * Ekspor menulis `<mxfile>` (satu atau banyak halaman, boleh terkompresi) dengan style yang sudah diratakan (named style
 * dari stylesheet digabung ke string style) agar draw.io menampilkannya sama seperti di editor.
 *
 * Impor bersifat atomik: seluruh dokumen diurai & divalidasi dulu; model graph baru disentuh setelah semuanya berhasil.
 * Setiap tahap dicatat ke `MaxgraphLogger` beserta alasannya, dan dikembalikan sebagai `DrawioImportReport`.
 */
import { Cell, Geometry, Point, Rectangle, ShapeRegistry, StencilShapeRegistry, domUtils, type CellStyle, type Graph } from "@maxgraph/core";
import type { MaxgraphLogger } from "./logger";

// ───────────────────────── tipe ─────────────────────────

export type DrawioFormat = "mxfile" | "mxGraphModel" | "GraphDataModel" | "unknown";
export interface DrawioPage { id: string; name: string; /** XML `<mxGraphModel>` tanpa kompresi. */ xml: string; compressed: boolean }
export interface DrawioFile { format: DrawioFormat; pages: DrawioPage[]; host?: string; version?: string }

export class DrawioError extends Error {
  constructor(public code: "empty" | "parse" | "unsupported" | "inflate" | "structure", message: string) { super(message); this.name = "DrawioError"; }
}

export interface DrawioImportReport {
  format: DrawioFormat;
  pageCount: number;
  page: { index: number; id: string; name: string };
  compressed: boolean;
  mode: "replace" | "merge";
  cells: { vertices: number; edges: number; layers: number; groups: number; total: number };
  htmlLabels: number;
  /** Label HTML yang dibersihkan (tag/atribut berbahaya dibuang). */
  sanitized: number;
  /** `shape=` yang tidak tersedia di maxGraph (tampil sebagai persegi) → impor stensil untuk menambahkannya. */
  unknownShapes: string[];
  /** Token style bernama yang tidak dikenal (diabaikan). */
  unknownStyleNames: string[];
  /** Edge dengan terminal yang tidak ditemukan. */
  danglingEdges: number;
  /** Cell yang ditempatkan ulang karena induknya tidak ada. */
  reparented: number;
  warnings: string[];
  durationMs: number;
}

export interface ImportOptions {
  mode?: "replace" | "merge";
  /** Target induk untuk mode merge. Default: layer bawaan graph. */
  parent?: Cell;
  /** Pergeseran posisi (mode merge). */
  dx?: number;
  dy?: number;
  /** Ikuti `grid` / `gridSize` dari berkas. Default true (hanya mode replace). */
  applySettings?: boolean;
  logger?: MaxgraphLogger;
  /** Nama halaman (hanya untuk laporan). */
  page?: { index: number; id: string; name: string; compressed: boolean };
  format?: DrawioFormat;
  pageCount?: number;
}

export interface ExportOptions {
  compress?: boolean;
  pretty?: boolean;
  /** Ratakan named style + style bawaan (default true). Bila false hanya `cell.style` yang ditulis. */
  flatten?: boolean;
  logger?: MaxgraphLogger;
}

// ───────────────────────── util dasar ─────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\r?\n/g, "&#10;");
const num = (n: number) => String(Math.round(n * 100) / 100);

const bytesToB64 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const b64ToBytes = (s: string) => Uint8Array.from(atob(s.replace(/\s+/g, "")), c => c.charCodeAt(0));

async function pump(bytes: Uint8Array, transform: TransformStream<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const src = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } });
  const reader = src.pipeThrough(transform).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); total += value.length;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Isi `<diagram>` terkompresi → XML. */
export async function inflateDiagramText(text: string): Promise<string> {
  if (typeof DecompressionStream === "undefined") throw new DrawioError("inflate", "Browser ini tidak mendukung DecompressionStream; ekspor diagram dari draw.io tanpa kompresi (File → Properties → Compressed = off).");
  let bytes: Uint8Array;
  try { bytes = b64ToBytes(text.trim()); } catch { throw new DrawioError("inflate", "Isi diagram bukan base64 yang valid."); }
  let raw: Uint8Array;
  try { raw = await pump(bytes, new DecompressionStream("deflate-raw") as unknown as TransformStream<Uint8Array, Uint8Array>); }
  catch (e) { throw new DrawioError("inflate", `Gagal mendekompresi diagram: ${e instanceof Error ? e.message : String(e)}`); }
  const s = new TextDecoder().decode(raw);
  try { return decodeURIComponent(s); } catch { return s; }
}

/** XML → isi `<diagram>` terkompresi (URL-encode → deflate-raw → base64). */
export async function deflateDiagramText(xml: string): Promise<string> {
  if (typeof CompressionStream === "undefined") throw new DrawioError("inflate", "Browser ini tidak mendukung CompressionStream.");
  const raw = await pump(new TextEncoder().encode(encodeURIComponent(xml)), new CompressionStream("deflate-raw") as unknown as TransformStream<Uint8Array, Uint8Array>);
  return bytesToB64(raw);
}

export function detectFormat(text: string): DrawioFormat {
  const m = /<\s*([A-Za-z_][\w.-]*)/.exec(text.replace(/^﻿/, "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, ""));
  if (!m) return "unknown";
  const n = m[1];
  return n === "mxfile" ? "mxfile" : n === "mxGraphModel" ? "mxGraphModel" : n === "GraphDataModel" ? "GraphDataModel" : "unknown";
}

export function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const err = doc.getElementsByTagName("parsererror")[0];
  if (err) throw new DrawioError("parse", `XML tidak valid: ${(err.textContent ?? "").split("\n")[0].slice(0, 200)}`);
  return doc;
}

// ───────────────────────── berkas → halaman ─────────────────────────

export async function parseDrawioFile(text: string, logger?: MaxgraphLogger): Promise<DrawioFile> {
  if (!text || !text.trim()) throw new DrawioError("empty", "Berkas kosong.");
  const format = detectFormat(text);
  logger?.step("import", `Format terdeteksi: ${format}`, format !== "unknown", format === "unknown" ? "elemen akar bukan mxfile / mxGraphModel / GraphDataModel" : `elemen akar <${format}>`);
  if (format === "unknown") throw new DrawioError("unsupported", "Bukan draw.io (<mxfile>/<mxGraphModel>) maupun XML maxGraph (<GraphDataModel>).");
  if (format === "GraphDataModel") return { format, pages: [{ id: "page-1", name: "Page-1", xml: text, compressed: false }] };
  if (format === "mxGraphModel") { parseXml(text); return { format, pages: [{ id: "page-1", name: "Page-1", xml: text, compressed: false }] }; }

  const doc = parseXml(text);
  const root = doc.documentElement;
  const diagrams = [...root.children].filter(e => e.localName === "diagram");
  if (!diagrams.length) throw new DrawioError("structure", "<mxfile> tidak berisi <diagram>.");
  const pages: DrawioPage[] = [];
  let i = 0;
  for (const d of diagrams) {
    i++;
    const name = d.getAttribute("name") || `Page-${i}`;
    const id = d.getAttribute("id") || `page-${i}`;
    const inner = [...d.children].find(c => c.localName === "mxGraphModel");
    if (inner) { pages.push({ id, name, xml: new XMLSerializer().serializeToString(inner), compressed: false }); logger?.step("import", `Halaman "${name}": diagram tidak terkompresi`, true, "<diagram> memuat <mxGraphModel> langsung"); continue; }
    const body = (d.textContent ?? "").trim();
    if (!body) { logger?.step("import", `Halaman "${name}" kosong`, false, "<diagram> tanpa isi → dilewati"); continue; }
    if (body.startsWith("<")) { pages.push({ id, name, xml: body, compressed: false }); continue; }
    if (/^%3C/i.test(body)) { pages.push({ id, name, xml: decodeURIComponent(body), compressed: false }); logger?.step("import", `Halaman "${name}": URL-encoded`, true, "isi diawali %3C → decodeURIComponent"); continue; }
    const t0 = Date.now();
    const xml = await inflateDiagramText(body);
    if (!xml.trimStart().startsWith("<")) throw new DrawioError("inflate", `Halaman "${name}": hasil dekompresi bukan XML.`);
    pages.push({ id, name, xml, compressed: true });
    logger?.step("import", `Halaman "${name}": terkompresi`, true, `base64 → deflate-raw → URL-decode (${body.length} → ${xml.length} karakter, ${Date.now() - t0} ms)`);
  }
  if (!pages.length) throw new DrawioError("structure", "Semua halaman pada berkas kosong.");
  return { format, pages, host: root.getAttribute("host") ?? undefined, version: root.getAttribute("version") ?? undefined };
}

// ───────────────────────── sanitasi label HTML ─────────────────────────

const OK_TAGS = new Set(["a", "b", "i", "u", "s", "strike", "strong", "em", "br", "div", "span", "p", "font", "ul", "ol", "li", "sub", "sup", "small", "big", "center", "pre", "code", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "table", "thead", "tbody", "tr", "td", "th", "img", "blockquote"]);
const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "link", "meta", "svg", "math", "form", "input", "button", "textarea", "select", "template", "base"]);
const OK_ATTRS = new Set(["style", "color", "face", "size", "align", "valign", "href", "target", "colspan", "rowspan", "src", "alt", "width", "height", "border", "cellpadding", "cellspacing"]);
const OK_CSS = /^(color|background(-color)?|font(-[a-z]+)?|text-(align|decoration|indent|transform)|line-height|letter-spacing|margin(-[a-z]+)?|padding(-[a-z]+)?|vertical-align|white-space|width|height|border(-[a-z]+)?|display|float|list-style(-[a-z]+)?|word-break|overflow-wrap)$/i;

function cleanCss(css: string): string {
  return css.split(";").map(d => d.trim()).filter(d => {
    const i = d.indexOf(":");
    if (i < 0) return false;
    const prop = d.slice(0, i).trim(), val = d.slice(i + 1).trim();
    return OK_CSS.test(prop) && !/url\s*\(|expression\s*\(|javascript:|@import|behavior|-moz-binding/i.test(val);
  }).join("; ");
}
const safeHref = (v: string) => /^(https?:|mailto:|tel:|#)/i.test(v.trim());
const safeImg = (v: string) => /^data:image\/(png|jpe?g|gif|webp);/i.test(v.trim());

/** Bersihkan HTML label draw.io: hanya tag/atribut aman yang dipertahankan. */
export function sanitizeHtmlLabel(html: string, stats?: { removed: number }): string {
  if (!html || !/[<&]/.test(html)) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const bump = () => { if (stats) stats.removed++; };
  const walk = (node: Element) => {
    for (const child of [...node.children]) {
      const tag = child.tagName.toLowerCase();
      if (!OK_TAGS.has(tag)) {
        bump();
        if (DROP_WITH_CONTENT.has(tag)) { child.remove(); continue; }
        walk(child);
        child.replaceWith(...child.childNodes);
        continue;
      }
      for (const a of [...child.attributes]) {
        const name = a.name.toLowerCase();
        let keep = OK_ATTRS.has(name) && !name.startsWith("on");
        if (keep && name === "href" && !safeHref(a.value)) keep = false;
        if (keep && name === "src" && !(tag === "img" && safeImg(a.value))) keep = false;
        if (keep && name === "style") { const c = cleanCss(a.value); if (c !== a.value.trim().replace(/;$/, "")) bump(); if (c) a.value = c; else keep = false; }
        else if (!keep) bump();
        if (!keep) child.removeAttribute(a.name);
      }
      if (tag === "img" && !child.getAttribute("src")) { child.remove(); continue; }
      if (tag === "a") { child.setAttribute("target", "_blank"); child.setAttribute("rel", "noopener noreferrer"); }
      walk(child);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

// ───────────────────────── style ─────────────────────────

const STRING_KEYS = new Set(["fontFamily", "image", "shape", "label", "title", "link", "tooltip", "fillColor", "strokeColor", "fontColor", "labelBackgroundColor", "labelBorderColor", "gradientColor", "swimlaneFillColor", "dashPattern", "edgeStyle", "perimeter", "startArrow", "endArrow", "align", "verticalAlign", "labelPosition", "verticalLabelPosition", "whiteSpace", "imageAlign", "imageVerticalAlign", "direction", "shadowColor", "background", "foldingEnabled"]);

export function parseStyleString(s: string | null | undefined): { names: string[]; props: [string, string][] } {
  const names: string[] = [], props: [string, string][] = [];
  for (const part of (s ?? "").split(";")) {
    const p = part.trim();
    if (!p) continue;
    const i = p.indexOf("=");
    if (i < 0) names.push(p); else props.push([p.slice(0, i).trim(), p.slice(i + 1)]);
  }
  return { names, props };
}

/** `data:image/png,AAA` (gaya draw.io) → `data:image/png;base64,AAA`; kebalikannya untuk ekspor. */
const imgIn = (v: string) => (/^data:image\/[\w.+-]+,/.test(v) ? v.replace(/^(data:image\/[\w.+-]+),/, "$1;base64,") : v);
const imgOut = (v: string) => v.replace(/^(data:[^;,]+);base64,/, "$1,");

export interface StyleContext { hasNamedStyle: (n: string) => boolean; unknownShapes: Set<string>; unknownNames: Set<string> }

export function styleFromString(s: string | null | undefined, ctx?: StyleContext): CellStyle {
  const { names, props } = parseStyleString(s);
  const out: Record<string, unknown> = {};
  const base: string[] = [];
  for (const n of names) {
    if (ctx?.hasNamedStyle(n)) base.push(n);
    else if (ShapeRegistry.get(n) || StencilShapeRegistry.get(n)) out.shape = n; // token bentuk, mis. "ellipse;" / "rhombus;"
    else ctx?.unknownNames.add(n);
  }
  if (base.length) out.baseStyleNames = base;
  for (const [k, raw] of props) {
    let v: unknown = raw;
    if (k === "image") v = imgIn(raw);
    else if (!STRING_KEYS.has(k) && /^-?\d+(\.\d+)?$/.test(raw)) v = Number(raw);
    out[k] = v;
  }
  const shape = out.shape;
  if (typeof shape === "string" && ctx && !ShapeRegistry.get(shape) && !StencilShapeRegistry.get(shape)) ctx.unknownShapes.add(shape);
  return out as CellStyle;
}

export function styleToString(style: Record<string, unknown> | null | undefined): string {
  if (!style) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(style)) {
    if (k === "baseStyleNames" || v === undefined || v === null || v === "" || typeof v === "function" || typeof v === "object") continue;
    const val = typeof v === "boolean" ? (v ? "1" : "0") : typeof v === "number" ? num(v) : k === "image" ? imgOut(String(v)) : String(v);
    parts.push(`${k}=${val}`);
  }
  return parts.length ? `${parts.join(";")};` : "";
}

// ───────────────────────── impor model ─────────────────────────

interface Entry { cell: Cell; id: string | null; parentId: string | null; sourceId: string | null; targetId: string | null }

const numAttr = (e: Element, n: string, d = 0) => { const v = e.getAttribute(n); const x = v === null ? NaN : Number(v); return Number.isFinite(x) ? x : d; };
const point = (e: Element) => new Point(numAttr(e, "x"), numAttr(e, "y"));

function readGeometry(g: Element): Geometry {
  const geo = new Geometry(numAttr(g, "x"), numAttr(g, "y"), numAttr(g, "width"), numAttr(g, "height"));
  if (g.getAttribute("relative") === "1") geo.relative = true;
  for (const c of g.children) {
    const as = c.getAttribute("as");
    if (as === "sourcePoint") geo.sourcePoint = point(c);
    else if (as === "targetPoint") geo.targetPoint = point(c);
    else if (as === "offset") geo.offset = point(c);
    else if (as === "points" || (c.localName === "Array" && as === "points")) geo.points = [...c.children].filter(p => p.localName === "mxPoint").map(point);
    else if (as === "alternateBounds") geo.alternateBounds = new Rectangle(numAttr(c, "x"), numAttr(c, "y"), numAttr(c, "width"), numAttr(c, "height"));
  }
  return geo;
}

/** Salin geometri dengan pergeseran (untuk merge). Hanya geometri absolut yang digeser. */
function shiftGeometry(geo: Geometry, dx: number, dy: number) {
  if (!dx && !dy) return;
  if (!geo.relative) { geo.x += dx; geo.y += dy; }
  if (geo.sourcePoint) { geo.sourcePoint.x += dx; geo.sourcePoint.y += dy; }
  if (geo.targetPoint) { geo.targetPoint.x += dx; geo.targetPoint.y += dy; }
  for (const p of geo.points ?? []) { p.x += dx; p.y += dy; }
}

function readModelElement(model: Element): { entries: Entry[]; root: Element; attrs: Record<string, string> } {
  const root = [...model.children].find(c => c.localName === "root");
  if (!root) throw new DrawioError("structure", "<mxGraphModel> tidak memiliki <root>.");
  const attrs: Record<string, string> = {};
  for (const a of model.attributes) attrs[a.name] = a.value;
  return { entries: [], root, attrs };
}

/**
 * Urai `<mxGraphModel>` menjadi objek Cell (belum dimasukkan ke graph). Tidak menyentuh graph sehingga aman
 * dipanggil lebih dulu; galat struktur dilempar sebagai `DrawioError`.
 */
export function readMxGraphModel(xml: string, ctx: StyleContext, stats: { htmlLabels: number; sanitized: number }, keepIds: boolean): { entries: Entry[]; attrs: Record<string, string> } {
  const doc = parseXml(xml);
  const model = doc.documentElement;
  if (model.localName !== "mxGraphModel") throw new DrawioError("structure", `Elemen akar <${model.localName}>, diharapkan <mxGraphModel>.`);
  const { root, attrs } = readModelElement(model);
  const entries: Entry[] = [];
  for (const el of root.children) {
    let cellEl: Element | undefined, userAttrs: Element | undefined;
    if (el.localName === "mxCell") cellEl = el;
    else if (el.localName === "object" || el.localName === "UserObject") { userAttrs = el; cellEl = [...el.children].find(c => c.localName === "mxCell"); }
    if (!cellEl) continue;
    const id = (userAttrs ?? cellEl).getAttribute("id");
    const style = styleFromString(cellEl.getAttribute("style"), ctx);
    const isVertex = cellEl.getAttribute("vertex") === "1", isEdge = cellEl.getAttribute("edge") === "1";
    let value: unknown = (userAttrs ? userAttrs.getAttribute("label") : cellEl.getAttribute("value")) ?? "";
    if (typeof value === "string" && (style as Record<string, unknown>).html == 1 && value) {
      stats.htmlLabels++;
      const st = { removed: 0 };
      value = sanitizeHtmlLabel(value, st);
      if (st.removed) stats.sanitized++;
    }
    if (userAttrs) { // <object label=… attr=…>: simpan sebagai node XML agar atribut kustom tidak hilang
      const node = document.implementation.createDocument(null, "object").documentElement;
      for (const a of userAttrs.attributes) if (a.name !== "id") node.setAttribute(a.name, a.value);
      if (typeof value === "string") node.setAttribute("label", value);
      value = node;
    }
    const geoEl = [...cellEl.children].find(c => c.localName === "mxGeometry");
    const cell = new Cell(value, geoEl ? readGeometry(geoEl) : null, style);
    cell.vertex = isVertex; cell.edge = isEdge;
    if (cellEl.getAttribute("connectable") === "0") cell.connectable = false;
    if (cellEl.getAttribute("visible") === "0") cell.visible = false;
    if (cellEl.getAttribute("collapsed") === "1") cell.collapsed = true;
    if (keepIds && id) cell.setId(id);
    entries.push({ cell, id, parentId: cellEl.getAttribute("parent"), sourceId: cellEl.getAttribute("source"), targetId: cellEl.getAttribute("target") });
  }
  if (!entries.length) throw new DrawioError("structure", "<root> tidak berisi sel apa pun.");
  return { entries, attrs };
}

/**
 * Terapkan model draw.io ke graph. `replace` mengganti seluruh model (satu langkah undo), `merge` menambahkan sel ke
 * `opts.parent` dan mengembalikan sel level-atas yang disisipkan.
 */
export function importMxGraphModel(graph: Graph, xml: string, opts: ImportOptions = {}): { report: DrawioImportReport; cells: Cell[] } {
  const t0 = Date.now();
  const log = opts.logger;
  const mode = opts.mode ?? "replace";
  const model = graph.getDataModel();
  const ctx: StyleContext = {
    hasNamedStyle: n => !!graph.getStylesheet().styles.get(n),
    unknownShapes: new Set(), unknownNames: new Set(),
  };
  const stats = { htmlLabels: 0, sanitized: 0 };
  const warnings: string[] = [];

  // 1) urai & validasi (belum menyentuh graph)
  const parsed = readMxGraphModel(xml, ctx, stats, mode === "replace");
  const { entries } = parsed;
  log?.step("import", `Model diurai: ${entries.length} sel`, true, "XML valid, <root> berisi sel");
  const byId = new Map<string, Entry>();
  for (const e of entries) if (e.id) { if (byId.has(e.id)) warnings.push(`id ganda "${e.id}"`); byId.set(e.id, e); }

  let rootEntry = entries.find(e => e.parentId === null && !e.cell.vertex && !e.cell.edge);
  let layerEntries: Entry[];
  let danglingEdges = 0, reparented = 0;
  const rootCell = rootEntry?.cell ?? new Cell();
  if (!rootEntry) { warnings.push("tidak ada sel akar (id=0) → dibuat otomatis"); rootEntry = { cell: rootCell, id: "0", parentId: null, sourceId: null, targetId: null }; if (mode === "replace") rootCell.setId("0"); }
  const rootKey = rootEntry.id;
  layerEntries = entries.filter(e => e !== rootEntry && e.parentId === rootKey && !e.cell.vertex && !e.cell.edge);
  let defaultLayer = layerEntries[0];
  if (!defaultLayer && mode === "replace") {
    const layer = new Cell(); if (mode === "replace") layer.setId("1");
    defaultLayer = { cell: layer, id: "1", parentId: rootKey, sourceId: null, targetId: null };
    layerEntries = [defaultLayer];
    warnings.push("tidak ada layer → layer bawaan dibuat");
    rootCell.insert(layer);
  }
  log?.step("import", `Struktur: ${layerEntries.length} layer`, true, rootEntry.id === "0" ? "akar id=0 dan layer anak langsung akar" : "akar dibuat/ditemukan otomatis");

  // 2) rakit pohon di memori
  const topLevel: Entry[] = []; // mode merge: anak langsung layer
  for (const e of entries) {
    if (e === rootEntry) continue;
    const isLayer = layerEntries.includes(e);
    if (isLayer) { if (mode === "replace") rootCell.insert(e.cell); continue; }
    let parent = e.parentId ? byId.get(e.parentId) : undefined;
    if (!parent) { reparented++; warnings.push(`sel "${e.id}" kehilangan induk "${e.parentId}" → dipindah ke layer bawaan`); parent = defaultLayer; }
    if (mode === "merge" && (!parent || layerEntries.includes(parent) || parent === rootEntry)) { topLevel.push(e); continue; }
    parent?.cell.insert(e.cell);
  }

  const dx = opts.dx ?? 0, dy = opts.dy ?? 0;
  const targetParent = opts.parent ?? graph.getDefaultParent();
  let inserted: Cell[] = [];
  model.beginUpdate();
  try {
    if (mode === "replace") {
      model.setRoot(rootCell);
    } else {
      for (const e of topLevel) { const g = e.cell.getGeometry(); if (g && (dx || dy)) shiftGeometry(g, dx, dy); }
      for (const e of topLevel) { model.add(targetParent, e.cell); inserted.push(e.cell); }
    }
    // 3) hubungkan terminal
    for (const e of entries) {
      if (!e.cell.edge) continue;
      const src = e.sourceId ? byId.get(e.sourceId)?.cell : undefined, tgt = e.targetId ? byId.get(e.targetId)?.cell : undefined;
      if ((e.sourceId && !src) || (e.targetId && !tgt)) { danglingEdges++; warnings.push(`edge "${e.id}": terminal ${!src && e.sourceId ? `source "${e.sourceId}"` : `target "${e.targetId}"`} tidak ditemukan → ujung dilepas`); }
      if (src || tgt) model.setTerminals(e.cell, src ?? null, tgt ?? null);
    }
  } finally { model.endUpdate(); }

  if (mode === "replace" && opts.applySettings !== false) {
    const gs = Number(parsed.attrs.gridSize);
    if (Number.isFinite(gs) && gs > 0) graph.setGridSize(gs);
    if (parsed.attrs.grid === "0" || parsed.attrs.grid === "1") graph.setGridEnabled(parsed.attrs.grid === "1");
  }

  const body = entries.filter(e => e !== rootEntry && !layerEntries.includes(e));
  const vertices = body.filter(e => e.cell.vertex).length, edges = body.filter(e => e.cell.edge).length;
  const groups = body.filter(e => e.cell.vertex && e.cell.getChildCount() > 0).length;
  const unknownShapes = [...ctx.unknownShapes].sort(), unknownStyleNames = [...ctx.unknownNames].sort();
  log?.step("import", `${vertices} node, ${edges} garis, ${layerEntries.length} layer`, true, mode === "replace" ? "model diganti dalam satu transaksi (undo dikosongkan oleh editor)" : `${inserted.length} sel level-atas disisipkan ke induk`);
  if (unknownShapes.length) log?.step("import", `Bentuk tidak tersedia: ${unknownShapes.join(", ")}`, false, "tidak ada di ShapeRegistry/StencilShapeRegistry → tampil sebagai persegi. Impor pustaka stensil (.xml) untuk bentuk ini.");
  if (stats.htmlLabels) log?.step("import", `${stats.htmlLabels} label HTML`, true, stats.sanitized ? `${stats.sanitized} label dibersihkan dari tag/atribut tidak aman` : "tidak ada markup berbahaya");
  if (danglingEdges) log?.step("import", `${danglingEdges} garis dengan terminal hilang`, false, "id source/target tidak ada di dokumen");
  for (const w of warnings.slice(0, 20)) log?.warn("import", w);

  const pg = opts.page ?? { index: 0, id: "page-1", name: "Page-1", compressed: false };
  return {
    cells: inserted,
    report: {
      format: opts.format ?? "mxGraphModel", pageCount: opts.pageCount ?? 1, page: { index: pg.index, id: pg.id, name: pg.name }, compressed: pg.compressed, mode,
      cells: { vertices, edges, layers: layerEntries.length, groups, total: body.length },
      htmlLabels: stats.htmlLabels, sanitized: stats.sanitized, unknownShapes, unknownStyleNames, danglingEdges, reparented, warnings, durationMs: Date.now() - t0,
    },
  };
}

// ───────────────────────── ekspor ─────────────────────────

const nodeAttrs = (v: unknown): [string, string][] | null => {
  if (!domUtils.isNode(v)) return null;
  return [...(v as Element).attributes].map(a => [a.name, a.value]);
};

/** `<mxGraphModel>` (draw.io) dari graph saat ini. */
export function exportMxGraphModel(graph: Graph, opts: ExportOptions = {}): string {
  const model = graph.getDataModel();
  const root = model.getRoot();
  if (!root) throw new DrawioError("structure", "Model kosong.");
  const flatten = opts.flatten !== false;
  const nl = opts.pretty === false ? "" : "\n";
  const ind = (n: number) => (opts.pretty === false ? "" : "  ".repeat(n));
  const lines: string[] = [];
  let cells = 0;

  const geometryXml = (cell: Cell, level: number): string | null => {
    const g = cell.getGeometry();
    if (!g) return null;
    const a: string[] = [];
    if (cell.isEdge() && !g.relative) { /* garis absolut: x/y tidak bermakna */ } else {
      if (g.x) a.push(`x="${num(g.x)}"`);
      if (g.y) a.push(`y="${num(g.y)}"`);
      if (g.width || cell.isVertex()) a.push(`width="${num(g.width)}"`);
      if (g.height || cell.isVertex()) a.push(`height="${num(g.height)}"`);
    }
    if (g.relative) a.push(`relative="1"`);
    a.push(`as="geometry"`);
    const kids: string[] = [];
    const pt = (p: { x: number; y: number }, as?: string) => `<mxPoint x="${num(p.x)}" y="${num(p.y)}"${as ? ` as="${as}"` : ""} />`;
    if (g.sourcePoint) kids.push(pt(g.sourcePoint, "sourcePoint"));
    if (g.targetPoint) kids.push(pt(g.targetPoint, "targetPoint"));
    if (g.points?.length) kids.push(`<Array as="points">${g.points.map(p => pt(p)).join("")}</Array>`);
    if (g.offset) kids.push(pt(g.offset, "offset"));
    if (g.alternateBounds) { const r = g.alternateBounds; kids.push(`<mxRectangle x="${num(r.x)}" y="${num(r.y)}" width="${num(r.width)}" height="${num(r.height)}" as="alternateBounds" />`); }
    return kids.length ? `${ind(level)}<mxGeometry ${a.join(" ")}>${nl}${kids.map(k => ind(level + 1) + k).join(nl)}${nl}${ind(level)}</mxGeometry>` : `${ind(level)}<mxGeometry ${a.join(" ")} />`;
  };

  const visit = (cell: Cell, parent: Cell | null) => {
    cells++;
    const id = cell.getId() ?? String(cells);
    const attrs = nodeAttrs(cell.value);
    const label = attrs ? "" : cell.value == null ? "" : String(cell.value);
    const style = cell.isVertex() || cell.isEdge() ? styleToString((flatten ? graph.getCellStyle(cell) : cell.style) as Record<string, unknown>) : "";
    const a: string[] = [];
    if (!attrs) a.push(`id="${esc(id)}"`, `value="${esc(label)}"`);
    if (style) a.push(`style="${esc(style)}"`);
    if (cell.isVertex()) a.push(`vertex="1"`);
    if (cell.isEdge()) a.push(`edge="1"`);
    if (parent) a.push(`parent="${esc(parent.getId() ?? "")}"`);
    if (cell.isEdge()) {
      if (cell.source?.getId()) a.push(`source="${esc(cell.source.getId()!)}"`);
      if (cell.target?.getId()) a.push(`target="${esc(cell.target.getId()!)}"`);
    }
    if (cell.connectable === false && (cell.isVertex() || cell.isEdge())) a.push(`connectable="0"`);
    if (cell.visible === false) a.push(`visible="0"`);
    if (cell.collapsed) a.push(`collapsed="1"`);
    const geo = geometryXml(cell, attrs ? 3 : 2);
    const open = attrs ? 3 : 2;
    if (attrs) {
      const ua = [`id="${esc(id)}"`, ...attrs.map(([k, v]) => `${esc(k)}="${esc(v)}"`)];
      lines.push(`${ind(2)}<object ${ua.join(" ")}>`);
      lines.push(geo ? `${ind(open)}<mxCell ${a.join(" ")}>${nl}${geo}${nl}${ind(open)}</mxCell>` : `${ind(open)}<mxCell ${a.join(" ")} />`);
      lines.push(`${ind(2)}</object>`);
    } else if (geo) lines.push(`${ind(2)}<mxCell ${a.join(" ")}>${nl}${geo}${nl}${ind(2)}</mxCell>`);
    else lines.push(`${ind(2)}<mxCell ${a.join(" ")} />`);
    for (let i = 0; i < cell.getChildCount(); i++) visit(cell.getChildAt(i), cell);
  };
  visit(root, null);

  const gridSize = graph.getGridSize();
  const head = `<mxGraphModel dx="0" dy="0" grid="${graph.isGridEnabled() ? 1 : 0}" gridSize="${gridSize}" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0">`;
  const xml = `${head}${nl}${ind(1)}<root>${nl}${lines.join(nl)}${nl}${ind(1)}</root>${nl}</mxGraphModel>`;
  opts.logger?.step("export", `Model draw.io: ${cells} sel`, true, flatten ? "style diratakan (named style + default digabung ke string style)" : "hanya style milik sel");
  return xml;
}

/** Bungkus halaman menjadi `<mxfile>`. `compress` mengikuti format default draw.io. */
export async function buildMxfile(pages: DrawioPage[], opts: ExportOptions = {}): Promise<string> {
  const nl = opts.pretty === false ? "" : "\n";
  const out: string[] = [];
  for (const p of pages) {
    const body = opts.compress ? await deflateDiagramText(p.xml) : p.xml;
    out.push(`  <diagram id="${esc(p.id)}" name="${esc(p.name)}">${opts.compress ? esc(body) : nl + body + nl + "  "}</diagram>`);
  }
  const xml = `<mxfile host="maxgraph-editor" modified="${new Date().toISOString()}" agent="maxgraph-editor" version="24.0.0" type="device" compressed="${opts.compress ? "true" : "false"}">${nl}${out.join(nl)}${nl}</mxfile>`;
  opts.logger?.step("export", `mxfile: ${pages.length} halaman`, true, opts.compress ? "diagram dikompresi deflate-raw + base64 (kompatibel draw.io)" : "diagram tanpa kompresi (mudah dibaca/diff)");
  return xml;
}

// ───────────────────────── konversi label teks ⇄ HTML ─────────────────────────

/** Teks polos → HTML aman (escape + baris baru menjadi `<br>`). */
export function plainToHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, "<br>");
}

/** HTML label → teks polos: `<br>` dan batas blok menjadi baris baru, tag lain dibuang, entitas didekode. */
export function htmlToPlain(html: string): string {
  if (!html || !/[<&]/.test(html)) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const out: string[] = [];
  const BLOCK = new Set(["div", "p", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "blockquote", "ul", "ol", "table"]);
  const walk = (n: Node) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) out.push(c.textContent ?? "");
      else if (c.nodeType === 1) {
        const tag = (c as Element).tagName.toLowerCase();
        if (tag === "script" || tag === "style") continue;
        if (tag === "br") { out.push("\n"); continue; }
        const block = BLOCK.has(tag);
        if (block && out.length && !/\n$/.test(out[out.length - 1]!)) out.push("\n");
        walk(c);
        if (block && !/\n$/.test(out[out.length - 1] ?? "")) out.push("\n");
      }
    }
  };
  walk(doc.body);
  return out.join("").replace(/\n+$/, "");
}
