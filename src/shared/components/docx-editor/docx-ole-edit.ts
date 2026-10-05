/** Sisip & perbarui objek OLE pada DOCX (part `/word/embeddings/*`, pratinjau gambar, `<w:object>` VML). */
import { NS, attr, descendAll, parseXmlString, setAttr, type XEl } from "./docx-xml";
import type { DocxBook } from "./docx-model";
import { REL_IMAGE, type PreparedOle } from "../office-shared/ole-embed";

export interface DocxOleRef { relId: string; part: string; previewRelId: string; previewPart: string; shapeId: string; progId: string }
export interface DocxOleFound { p: XEl; object: XEl; ole: XEl; shape?: XEl; imagedata?: XEl }

const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const STEM: Record<string, string> = {
  xlsx: "Microsoft_Excel_Sheet", xlsm: "Microsoft_Excel_Sheet", docx: "Microsoft_Word_Document", docm: "Microsoft_Word_Document",
  pptx: "Microsoft_PowerPoint_Presentation", pptm: "Microsoft_PowerPoint_Presentation",
};

function nextPartName(book: DocxBook, dir: string, stem: string, ext: string): string {
  const used = new Set(book.partNames().map(n => n.toLowerCase()));
  let n = 1;
  while (used.has(`${dir}${stem}${n}.${ext}`.toLowerCase())) n++;
  return `${dir}${stem}${n}.${ext}`;
}
function nextRelId(book: DocxBook, prefix: string): string {
  const used = new Set(book.relsOf(book.doc.partName).map(r => r.id as string));
  let n = 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}
function ensureContentType(book: DocxBook, part: string, ext: string, ct: string) {
  const idx = book.doc.opc.contentTypes;
  const def = idx.defaults.find(x => x.extension.toLowerCase() === ext.toLowerCase());
  if (!def) idx.defaults.push({ extension: ext, contentType: ct });
  else if (def.contentType !== ct) (idx.overrides as unknown as { partName: string; contentType: string }[]).push({ partName: part, contentType: ct });
}
function addPart(book: DocxBook, part: string, bytes: Uint8Array, ct: string, ext: string) {
  const d = book.doc;
  d.opc.parts.set(part as never, { name: part, contentType: ct, data: bytes, compression: ext === "png" ? "store" : "deflate", zipEntry: part.slice(1) } as never);
  d.opc.order.push(part as never);
  ensureContentType(book, part, ext, ct);
}
function addRel(book: DocxBook, id: string, type: string, target: string) {
  book.oleTracked.set(id, `/word/${target}`);
  (book.doc.opc.relsBySource.get(book.doc.partName)!.relationships as unknown as { id: string; type: string; target: string; targetMode: string }[]).push({ id, type, target, targetMode: "Internal" });
}
function nextShapeId(book: DocxBook): string {
  const used = new Set<string>();
  for (const o of descendAll(book.body, "OLEObject")) { const s = attr(o, "ShapeID"); if (s) used.add(s); }
  let n = 1025;
  while (used.has(`_x0000_i${n}`)) n++;
  return `_x0000_i${n}`;
}

const SHAPETYPE =
  `<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/>` +
  `<v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/><v:f eqn="sum @0 1 0"/><v:f eqn="sum 0 0 @1"/><v:f eqn="prod @2 1 2"/><v:f eqn="prod @3 21600 pixelWidth"/>` +
  `<v:f eqn="prod @3 21600 pixelHeight"/><v:f eqn="sum @0 0 1"/><v:f eqn="prod @6 1 2"/><v:f eqn="prod @7 21600 pixelWidth"/><v:f eqn="sum @8 21600 0"/>` +
  `<v:f eqn="prod @7 21600 pixelHeight"/><v:f eqn="sum @10 21600 0"/></v:formulas><v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype>`;

/** Tambahkan part embedding + pratinjau + relasi, lalu kembalikan `<w:r><w:object>` siap sisip. */
export function createOleRun(book: DocxBook, p: PreparedOle, size?: { wPx: number; hPx: number }): { run: XEl; ref: DocxOleRef } {
  const part = nextPartName(book, "/word/embeddings/", STEM[p.ext] ?? "oleObject", p.ext);
  addPart(book, part, p.bytes, p.contentType, p.ext);
  const relId = nextRelId(book, "rIdOle");
  addRel(book, relId, p.relType, part.replace("/word/", ""));
  const previewPart = nextPartName(book, "/word/media/", "oleprev", "png");
  addPart(book, previewPart, p.preview, "image/png", "png");
  const previewRelId = nextRelId(book, "rIdOlePv");
  addRel(book, previewRelId, REL_IMAGE, previewPart.replace("/word/", ""));
  const shapeId = nextShapeId(book);
  const wPt = Math.round((size?.wPx ?? p.previewWidth) * 7.5) / 10, hPt = Math.round((size?.hPx ?? p.previewHeight) * 7.5) / 10;
  const xml =
    `<w:r xmlns:w="${NS.w}" xmlns:r="${NS.r}" xmlns:v="${NS.v}" xmlns:o="${NS.o}"><w:object w:dxaOrig="${Math.round(wPt * 20)}" w:dyaOrig="${Math.round(hPt * 20)}">` +
    SHAPETYPE +
    `<v:shape id="${shapeId}" type="#_x0000_t75" style="width:${wPt}pt;height:${hPt}pt" o:ole=""><v:imagedata r:id="${previewRelId}" o:title="${escAttr(p.label)}"/></v:shape>` +
    `<o:OLEObject Type="Embed" ProgID="${escAttr(p.progId)}" ShapeID="${shapeId}" DrawAspect="Content" ObjectID="_${Date.now() % 1_000_000_000}${Math.floor(Math.random() * 1000)}" r:id="${relId}"/>` +
    `</w:object></w:r>`;
  return { run: parseXmlString(xml), ref: { relId, part, previewRelId, previewPart, shapeId, progId: p.progId } };
}

/** Cari objek OLE di body berdasarkan id relasi embedding. */
export function findOleObject(book: DocxBook, relId: string): DocxOleFound | undefined {
  for (const { p } of book.paragraphs()) {
    for (const ole of descendAll(p, "OLEObject")) {
      if (attr(ole, "id") !== relId) continue;
      const object = descendAll(p, "object").find(o => descendAll(o, "OLEObject").includes(ole));
      if (!object) continue;
      return { p, object, ole, shape: descendAll(object, "shape")[0], imagedata: descendAll(object, "imagedata")[0] };
    }
  }
  return undefined;
}

/**
 * Ganti isi objek OLE. Selalu membuat part + relasi BARU lalu mengarahkan objek ke sana (part lama dibiarkan), sehingga
 * undo/redo — yang hanya menyimpan XML body — tetap mengembalikan isi lama dengan benar.
 */
export function updateOleObject(book: DocxBook, relId: string, p: PreparedOle, opts: { keepPreview?: boolean } = {}): DocxOleRef & { oldRelId: string; oldPart: string } {
  const f = findOleObject(book, relId);
  if (!f) throw new Error(`Objek OLE "${relId}" tidak ditemukan di dokumen.`);
  const old = book.rel(relId);
  const oldPart = old ? book.resolve(book.doc.partName, old.target) : "";
  const part = nextPartName(book, "/word/embeddings/", STEM[p.ext] ?? "oleObject", p.ext);
  addPart(book, part, p.bytes, p.contentType, p.ext);
  const newRel = nextRelId(book, "rIdOle");
  addRel(book, newRel, p.relType, part.replace("/word/", ""));
  setAttr(f.ole, "id", newRel, NS.r, "r");
  setAttr(f.ole, "ProgID", p.progId, "", "");
  let previewRelId = attr(f.imagedata, "id") ?? "";
  let previewPart = "";
  if (!opts.keepPreview || !previewRelId) {
    previewPart = nextPartName(book, "/word/media/", "oleprev", "png");
    addPart(book, previewPart, p.preview, "image/png", "png");
    previewRelId = nextRelId(book, "rIdOlePv");
    addRel(book, previewRelId, REL_IMAGE, previewPart.replace("/word/", ""));
    if (f.imagedata) { setAttr(f.imagedata, "id", previewRelId, NS.r, "r"); setAttr(f.imagedata, "title", p.label, NS.o, "o"); }
  }
  return { relId: newRel, part, previewRelId, previewPart, shapeId: attr(f.ole, "ShapeID") ?? "", progId: p.progId, oldRelId: relId, oldPart };
}

const ptOf = (style: string, prop: string) => { const m = new RegExp(`${prop}\\s*:\\s*([\\d.]+)pt`, "i").exec(style); return m ? Number(m[1]) : undefined; };

/** Ukuran tampilan objek (px CSS). */
export function oleSize(book: DocxBook, relId: string): { wPx: number; hPx: number } | undefined {
  const style = attr(findOleObject(book, relId)?.shape, "style") ?? "";
  const w = ptOf(style, "width"), h = ptOf(style, "height");
  return w && h ? { wPx: (w * 96) / 72, hPx: (h * 96) / 72 } : undefined;
}

/** Ubah ukuran tampilan objek (px CSS). */
export function setOleSize(book: DocxBook, relId: string, wPx: number, hPx: number): boolean {
  const f = findOleObject(book, relId);
  if (!f?.shape) return false;
  const rest = (attr(f.shape, "style") ?? "").replace(/(^|;)\s*(width|height)\s*:[^;]*/gi, "").replace(/^;+/, "");
  setAttr(f.shape, "style", `width:${Math.round(wPx * 7.5) / 10}pt;height:${Math.round(hPx * 7.5) / 10}pt${rest ? ";" + rest : ""}`, "", "");
  return true;
}

/** Isi embedding untuk `relId` (undefined bila hilang / eksternal). */
export function oleBytes(book: DocxBook, relId: string): { data: Uint8Array; part: string } | undefined {
  const r = book.rel(relId);
  if (!r || r.targetMode === "External") return undefined;
  const part = book.resolve(book.doc.partName, r.target);
  const data = book.part(part)?.data;
  return data ? { data, part } : undefined;
}

/**
 * Lepas sementara part embedding/pratinjau hasil sisip/perbarui yang tidak dirujuk body saat ini (sisa untuk undo), agar berkas
 * yang disimpan bersih. Mengembalikan fungsi pemulih yang menaruh semuanya kembali, sehingga undo setelah simpan tetap benar.
 */
export function pruneOleParts(book: DocxBook): () => void {
  if (!book.oleTracked.size) return () => {};
  const used = new Set<string>();
  for (const tag of ["OLEObject", "imagedata"]) for (const el of descendAll(book.body, tag)) { const id = attr(el, "id"); if (id) used.add(id); }
  const opc = book.doc.opc;
  const rels = opc.relsBySource.get(book.doc.partName)!.relationships as unknown as { id: string; target: string }[];
  const order = opc.order as unknown as string[];
  const ov = opc.contentTypes.overrides as unknown as { partName: string }[];
  const undo: (() => void)[] = [];
  for (const [relId, part] of book.oleTracked) {
    if (used.has(relId)) continue;
    const ri = rels.findIndex(r => r.id === relId);
    if (ri >= 0) { const [rel] = rels.splice(ri, 1); undo.push(() => rels.splice(Math.min(ri, rels.length), 0, rel)); }
    const shared = rels.some(r => r.target && book.resolve(book.doc.partName, r.target) === part);
    if (shared) continue;
    const entry = opc.parts.get(part as never);
    if (entry) { opc.parts.delete(part as never); undo.push(() => { opc.parts.set(part as never, entry); }); }
    const oi = order.indexOf(part);
    if (oi >= 0) { order.splice(oi, 1); undo.push(() => order.splice(Math.min(oi, order.length), 0, part)); }
    const ci = ov.findIndex(o => o.partName === part);
    if (ci >= 0) { const [o] = ov.splice(ci, 1); undo.push(() => ov.splice(Math.min(ci, ov.length), 0, o)); }
  }
  return () => { for (const u of undo.reverse()) u(); };
}
