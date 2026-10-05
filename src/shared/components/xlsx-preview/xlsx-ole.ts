/**
 * Objek OLE pada XLSX: baca (pindai paket) dan tulis (sisip / perbarui) langsung pada ZIP hasil simpan.
 *
 * @office-kit/xlsx tidak punya API sisip/ganti OLE, jadi pengubahan dilakukan setelah `workbookToBytes` + `repairPackage`:
 *  - **Sisip**: part `xl/embeddings/*` + gambar pratinjau `xl/media/*`, relasi sheet, `<oleObjects><oleObject …/></oleObjects>` pada sheet,
 *    dan bentuk VML (`xl/drawings/vmlDrawingN.vml`) yang memuat anchor sel + gambar pratinjau — bentuk klasik Excel 2007+ yang dibaca semua versi Excel.
 *  - **Perbarui**: ganti isi part embedding (atau buat part baru + arahkan ulang relasi bila jenisnya berubah) dan gambar pratinjau.
 * Pembacaan mendukung bentuk klasik (VML) maupun bentuk Excel 2010+ (`mc:AlternateContent` + `objectPr` + anchor).
 */
import { openZip, createZipWriter } from "@office-kit/xlsx/zip";
import { fromArrayBuffer, toArrayBuffer } from "@office-kit/xlsx/io";
import { WORKSHEET_ORDER, splitRoot } from "./xlsx-repair";
import { describeProgId, isCfb, isZip, readCfb } from "../office-shared/ole-core";
import { OLE_BIN_CONTENT_TYPE, REL_IMAGE, type PreparedOle } from "../office-shared/ole-embed";

const dec = new TextDecoder("utf-8");
const enc = new TextEncoder();
const EMU_PER_PX = 9525;
const REL_VML = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing";
const NS_REL_PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
const VML_CT = "application/vnd.openxmlformats-officedocument.vmlDrawing";
const STEM: Record<string, string> = {
  xlsx: "Microsoft_Excel_Sheet", xlsm: "Microsoft_Excel_Sheet", docx: "Microsoft_Word_Document", docm: "Microsoft_Word_Document",
  pptx: "Microsoft_PowerPoint_Presentation", pptm: "Microsoft_PowerPoint_Presentation",
};

/** Anchor sel (basis 0). Offset dalam px CSS. */
export interface OleAnchor { c1: number; c1off: number; r1: number; r1off: number; c2: number; c2off: number; r2: number; r2off: number }

export interface XlsxOleObject {
  /** `<indeks sheet>:<shapeId>` untuk objek di berkas; `new:<n>` untuk yang baru disisipkan. */
  id: string;
  sheet: string;
  sheetPart: string;
  shapeId: number;
  progId: string;
  relId?: string;
  part?: string;
  previewPart?: string;
  anchor?: OleAnchor;
  linked: boolean;
  size: number;
  format: "cfb" | "zip" | "other" | "missing";
  fileName: string;
  description: string;
  origin: "file" | "inserted";
  /** Pratinjau PNG/JPEG/GIF (untuk digambar di grid). */
  previewBytes?: Uint8Array;
  previewFormat?: string;
}

export interface PendingOleInsert { id: string; sheet: string; prep: PreparedOle; anchor: OleAnchor; /** Ukuran tampil (px). */ widthPx: number; heightPx: number }
export interface OlePatchSet {
  inserts: PendingOleInsert[];
  /** Perbaruan objek yang sudah ada di berkas, kunci = `XlsxOleObject.id`. */
  updates: Map<string, PreparedOle>;
}

// ───────── util paket ─────────

const attrOf = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function resolvePart(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const out = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) { if (seg === "..") out.pop(); else if (seg && seg !== ".") out.push(seg); }
  return out.join("/");
}
const relsPartOf = (part: string) => part.replace(/([^/]+)$/, "_rels/$1.rels");
const relativeTo = (from: string, part: string) => {
  const a = from.split("/").slice(0, -1), b = part.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
};

interface Rel { id: string; type: string; target: string; mode?: string }
function parseRels(xml: string | undefined): Rel[] {
  if (!xml) return [];
  return [...xml.matchAll(/<Relationship\b[^>]*>/g)].map(m => ({ id: attrOf(m[0], "Id") ?? "", type: attrOf(m[0], "Type") ?? "", target: unxml(attrOf(m[0], "Target") ?? ""), mode: attrOf(m[0], "TargetMode") }));
}
const relsXml = (rels: Rel[]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS_REL_PKG}">${rels.map(r => `<Relationship Id="${r.id}" Type="${r.type}" Target="${xmlEsc(r.target)}"${r.mode ? ` TargetMode="${r.mode}"` : ""}/>`).join("")}</Relationships>`;

type Zip = Awaited<ReturnType<typeof openZip>>;
const text = (zip: Zip, name: string) => (zip.has(name) ? dec.decode(zip.read(name)) : undefined);

function sheetMap(zip: Zip): { name: string; part: string }[] {
  const wb = text(zip, "xl/workbook.xml");
  if (!wb) return [];
  const rels = parseRels(text(zip, "xl/_rels/workbook.xml.rels"));
  const out: { name: string; part: string }[] = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const rid = attrOf(m[0], "r:id");
    const rel = rels.find(r => r.id === rid);
    if (rel) out.push({ name: unxml(attrOf(m[0], "name") ?? ""), part: resolvePart("xl/workbook.xml", rel.target) });
  }
  return out;
}

const IMG_FMT: Record<string, string> = { png: "png", jpg: "jpeg", jpeg: "jpeg", gif: "gif", bmp: "bmp", webp: "webp", svg: "svg" };

// ───────── baca ─────────

/** Pindai paket XLSX: semua objek OLE (VML klasik maupun objectPr Excel 2010+). */
export async function scanXlsxOle(bytes: Uint8Array): Promise<XlsxOleObject[]> {
  const zip = await openZip(fromArrayBuffer(bytes));
  try {
    const out: XlsxOleObject[] = [];
    sheetMap(zip).forEach(({ name, part }, si) => {
      const xml = text(zip, part);
      if (!xml || !/<oleObject\b/.test(xml)) return;
      const rels = parseRels(text(zip, relsPartOf(part)));
      const legacy = /<legacyDrawing\b[^>]*\br:id="([^"]+)"/.exec(xml)?.[1];
      const vmlPart = legacy ? resolvePart(part, rels.find(r => r.id === legacy)?.target ?? "") : undefined;
      const vml = vmlPart ? text(zip, vmlPart) : undefined;
      const vmlRels = vmlPart ? parseRels(text(zip, relsPartOf(vmlPart))) : [];
      const byShape = new Map<number, XlsxOleObject & { rank: number }>();
      for (const m of xml.matchAll(/<oleObject\b[^>]*?(?:\/>|>[\s\S]*?<\/oleObject>)/g)) {
        const tag = m[0];
        const head = /^<oleObject\b[^>]*>/.exec(tag)![0];
        const shapeId = Number(attrOf(head, "shapeId") ?? 0);
        const progId = unxml(attrOf(head, "progId") ?? "");
        const relId = attrOf(head, "r:id");
        const linked = !!attrOf(head, "link");
        let anchor: OleAnchor | undefined, previewRel: string | undefined;
        const op = /<objectPr\b[^>]*>[\s\S]*?<\/objectPr>/.exec(tag)?.[0];
        if (op) {
          previewRel = attrOf(/^<objectPr\b[^>]*>/.exec(op)![0], "r:id");
          const num = (tagName: string, blk: string) => Number(new RegExp("<(?:xdr:)?" + tagName + "\\b[^>]*>(\\d+)</(?:xdr:)?" + tagName + ">").exec(blk)?.[1] ?? 0);
          const from = /<(?:xdr:)?from\b[^>]*>[\s\S]*?<\/(?:xdr:)?from>/.exec(op)?.[0], to = /<(?:xdr:)?to\b[^>]*>[\s\S]*?<\/(?:xdr:)?to>/.exec(op)?.[0];
          if (from && to) anchor = { c1: num("col", from), c1off: num("colOff", from) / EMU_PER_PX, r1: num("row", from), r1off: num("rowOff", from) / EMU_PER_PX, c2: num("col", to), c2off: num("colOff", to) / EMU_PER_PX, r2: num("row", to), r2off: num("rowOff", to) / EMU_PER_PX };
        }
        let previewPart: string | undefined;
        if (previewRel) { const t = rels.find(r => r.id === previewRel)?.target; if (t) previewPart = resolvePart(part, t); }
        if (vml && shapeId) {
          const blk = new RegExp(`<v:shape\\b[^>]*\\bid="_x0000_s${shapeId}"[\\s\\S]*?</v:shape>`).exec(vml)?.[0];
          if (blk) {
            const a = /<x:Anchor>\s*([^<]*?)\s*<\/x:Anchor>/.exec(blk)?.[1]?.split(",").map(s => Number(s.trim()));
            if (!anchor && a && a.length >= 8 && a.every(Number.isFinite)) anchor = { c1: a[0]!, c1off: a[1]!, r1: a[2]!, r1off: a[3]!, c2: a[4]!, c2off: a[5]!, r2: a[6]!, r2off: a[7]! };
            const rid = /o:relid="([^"]+)"/.exec(blk)?.[1];
            if (!previewPart && rid) { const t = vmlRels.find(r => r.id === rid)?.target; if (t && vmlPart) previewPart = resolvePart(vmlPart, t); }
          }
        }
        const rel = relId ? rels.find(r => r.id === relId) : undefined;
        const embPart = rel && rel.mode !== "External" ? resolvePart(part, rel.target) : undefined;
        const data = embPart && !linked && zip.has(embPart) ? zip.read(embPart) : undefined;
        const format: XlsxOleObject["format"] = !data ? "missing" : isCfb(data) ? "cfb" : isZip(data) ? "zip" : "other";
        let description = progId || "OLE";
        let fileName = embPart?.split("/").pop() ?? "";
        if (data && format === "cfb") { try { const c = readCfb(data); description = c.userType ?? c.kind ?? description; if (c.native) fileName = c.native.fileName; } catch { /* abaikan */ } }
        const pvFmt = previewPart ? IMG_FMT[(previewPart.split(".").pop() ?? "").toLowerCase()] : undefined;
        const obj: XlsxOleObject & { rank: number } = {
          id: `${si}:${shapeId}`, sheet: name, sheetPart: part, shapeId, progId, relId, part: embPart, previewPart, anchor, linked, size: data?.length ?? 0, format, fileName, description, origin: "file",
          previewBytes: previewPart && pvFmt && zip.has(previewPart) ? zip.read(previewPart) : undefined, previewFormat: pvFmt,
          rank: (relId ? 1 : 0) + (anchor ? 1 : 0) + (previewPart ? 1 : 0),
        };
        const prev = byShape.get(shapeId);
        if (!prev || obj.rank > prev.rank) byShape.set(shapeId, obj);
      }
      for (const { rank: _rank, ...o } of byShape.values()) { void _rank; out.push(o); }
    });
    return out;
  } finally { zip.close(); }
}

// ───────── tulis ─────────

const VML_SHAPETYPE =
  `<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/>` +
  `<v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/><v:f eqn="sum @0 1 0"/><v:f eqn="sum 0 0 @1"/><v:f eqn="prod @2 1 2"/><v:f eqn="prod @3 21600 pixelWidth"/>` +
  `<v:f eqn="prod @3 21600 pixelHeight"/><v:f eqn="sum @0 0 1"/><v:f eqn="prod @6 1 2"/><v:f eqn="prod @7 21600 pixelWidth"/><v:f eqn="sum @8 21600 0"/>` +
  `<v:f eqn="prod @7 21600 pixelHeight"/><v:f eqn="sum @10 21600 0"/></v:formulas><v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype>`;

const VML_NEW = (shapes: string) =>
  `<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">` +
  `<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>${VML_SHAPETYPE}${shapes}</xml>`;

const anchorText = (a: OleAnchor) => [a.c1, Math.round(a.c1off), a.r1, Math.round(a.r1off), a.c2, Math.round(a.c2off), a.r2, Math.round(a.r2off)].join(", ");

function vmlShape(id: number, relId: string, title: string, a: OleAnchor, wPx: number, hPx: number): string {
  return `<v:shape id="_x0000_s${id}" type="#_x0000_t75" style="position:absolute;margin-left:0;margin-top:0;width:${Math.round(wPx * 75) / 100}pt;height:${Math.round(hPx * 75) / 100}pt;z-index:${id - 1024}" o:ole="" fillcolor="window [65]" stroked="f">` +
    `<v:fill color2="window [65]"/><v:imagedata o:relid="${relId}" o:title="${xmlEsc(title)}"/><o:lock v:ext="edit" aspectratio="t"/>` +
    `<x:ClientData ObjectType="Pict"><x:SizeWithCells/><x:Anchor>${anchorText(a)}</x:Anchor><x:CF>Pict</x:CF><x:AutoPict/></x:ClientData></v:shape>`;
}

/** Sisipkan anak baru pada `<worksheet>` di posisi skema yang benar (tanpa menyusun ulang elemen lain). */
export function addWorksheetChild(xml: string, name: string, text: string): string {
  const parts = splitRoot(xml, "worksheet");
  if (!parts) throw new Error("XML sheet tidak dikenali (tidak dapat menyisipkan <" + name + ">).");
  const local = (n: string) => n.replace(/^.*:/, "");
  const order = (n: string) => WORKSHEET_ORDER.indexOf(local(n));
  const mine = order(name);
  let at = parts.children.length;
  for (let i = 0; i < parts.children.length; i++) { const o = order(parts.children[i]!.name); if (o > mine) { at = i; break; } }
  let head = parts.head;
  if (!/xmlns:r="/.test(head)) head = head.replace(/<worksheet\b/, `<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`);
  const kids = parts.children.map(c => c.text);
  kids.splice(at, 0, text);
  return head + kids.join("") + parts.tail;
}

interface TypeEntry { part?: string; ext: string; type: string }

/** Pastikan setiap part punya content type: tambah Default per ekstensi; bila Default sudah ada tetapi berbeda, tulis Override per part. */
function ensureContentTypes(ct: string, entries: TypeEntry[]): string {
  let out = ct;
  const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const { part, ext, type } of entries) {
    const def = new RegExp(`<Default\\b[^>]*\\bExtension="${escRe(ext)}"[^>]*>`, "i").exec(out);
    if (!def) { out = out.replace("</Types>", `<Default Extension="${ext}" ContentType="${type}"/></Types>`); continue; }
    if (attrOf(def[0], "ContentType") === type || !part) continue;
    if (!new RegExp(`<Override\\b[^>]*\\bPartName="/${escRe(part)}"`).test(out)) out = out.replace("</Types>", `<Override PartName="/${part}" ContentType="${type}"/></Types>`);
  }
  return out;
}

const stemUnique = (names: Set<string>, dir: string, stem: string, ext: string) => {
  let n = 1;
  while (names.has(`${dir}${stem}${n}.${ext}`)) n++;
  const name = `${dir}${stem}${n}.${ext}`;
  names.add(name);
  return name;
};
const nextId = (used: Set<string>, prefix: string) => { let n = 1; while (used.has(`${prefix}${n}`)) n++; used.add(`${prefix}${n}`); return `${prefix}${n}`; };

/** Terapkan sisip + perbarui pada bytes XLSX. Mengembalikan bytes baru (atau yang sama bila tidak ada perubahan). */
export async function applyOlePatches(bytes: Uint8Array, patches: OlePatchSet): Promise<Uint8Array> {
  if (!patches.inserts.length && !patches.updates.size) return bytes;
  const zip = await openZip(fromArrayBuffer(bytes));
  try {
    const names0 = zip.list();
    const names = new Set(names0);
    const files = new Map<string, Uint8Array | null>(); // null = buang
    const read = (n: string) => (files.has(n) ? (files.get(n) ?? undefined) : zip.has(n) ? zip.read(n) : undefined);
    const readText = (n: string) => { const b = read(n); return b ? dec.decode(b) : undefined; };
    const put = (n: string, data: Uint8Array | string) => { files.set(n, typeof data === "string" ? enc.encode(data) : data); names.add(n); };
    let ct = readText("[Content_Types].xml") ?? "";
    const types: TypeEntry[] = [];
    const addType = (part: string, ext: string, type: string) => { types.push({ part, ext, type }); };
    const sheets = sheetMap(zip);
    const existing = await scanXlsxOle(bytes);

    // ── perbarui objek yang sudah ada
    for (const [id, prep] of patches.updates) {
      const o = existing.find(x => x.id === id);
      if (!o) throw new Error(`Objek OLE "${id}" tidak ditemukan di paket.`);
      if (o.linked || !o.relId) throw new Error(`Objek OLE "${id}" tertaut (link) — isinya tidak dapat diganti.`);
      let sx = readText(o.sheetPart)!;
      const relsPart = relsPartOf(o.sheetPart);
      const rels = parseRels(readText(relsPart));
      const rel = rels.find(r => r.id === o.relId)!;
      const oldExt = (o.part ?? "").split(".").pop()?.toLowerCase();
      const embPart = o.part && oldExt === prep.ext && rel.type === prep.relType ? o.part : stemUnique(names, "xl/embeddings/", STEM[prep.ext] ?? "oleObject", prep.ext);
      put(embPart, prep.bytes);
      if (embPart !== o.part) {
        addType(embPart, prep.ext, prep.contentType);
        rel.target = relativeTo(o.sheetPart, embPart); rel.type = prep.relType;
        if (o.part && !rels.some(r => r !== rel && r.mode !== "External" && resolvePart(o.sheetPart, r.target) === o.part)) files.set(o.part, null);
      }
      // progId pada semua oleObject dengan shapeId yang sama (Choice + Fallback)
      sx = sx.replace(/<oleObject\b[^>]*>/g, tag => (attrOf(tag, "shapeId") === String(o.shapeId) ? (/\bprogId="/.test(tag) ? tag.replace(/\bprogId="[^"]*"/, `progId="${xmlEsc(prep.progId)}"`) : tag.replace("<oleObject", `<oleObject progId="${xmlEsc(prep.progId)}"`)) : tag));
      put(o.sheetPart, sx);
      // pratinjau: part PNG baru, arahkan relasi VML / objectPr ke sana
      const pvPart = stemUnique(names, "xl/media/", "oleprev", "png");
      put(pvPart, prep.preview);
      addType(pvPart, "png", "image/png");
      const legacy = /<legacyDrawing\b[^>]*\br:id="([^"]+)"/.exec(sx)?.[1];
      const vmlPart = legacy ? resolvePart(o.sheetPart, rels.find(r => r.id === legacy)?.target ?? "") : undefined;
      let repointed = false;
      if (vmlPart && readText(vmlPart)) {
        const vml = readText(vmlPart)!;
        const blk = new RegExp(`<v:shape\\b[^>]*\\bid="_x0000_s${o.shapeId}"[\\s\\S]*?</v:shape>`).exec(vml)?.[0];
        const rid = blk && /o:relid="([^"]+)"/.exec(blk)?.[1];
        if (rid) {
          const vr = parseRels(readText(relsPartOf(vmlPart)));
          const r = vr.find(x => x.id === rid);
          if (r) { r.target = relativeTo(vmlPart, pvPart); put(relsPartOf(vmlPart), relsXml(vr)); repointed = true; }
        }
      }
      const op = /<objectPr\b[^>]*\br:id="([^"]+)"/.exec(sx)?.[1];
      const opRel = op ? rels.find(r => r.id === op) : undefined;
      if (opRel) { opRel.target = relativeTo(o.sheetPart, pvPart); repointed = true; }
      void repointed;
      put(relsPart, relsXml(rels));
    }

    // ── sisipkan objek baru, dikelompokkan per sheet
    const bySheet = new Map<string, PendingOleInsert[]>();
    for (const ins of patches.inserts) { const l = bySheet.get(ins.sheet) ?? []; l.push(ins); bySheet.set(ins.sheet, l); }
    for (const [sheetName, list] of bySheet) {
      const sh = sheets.find(s => s.name === sheetName);
      if (!sh) throw new Error(`Sheet "${sheetName}" tidak ditemukan di paket.`);
      let sx = readText(sh.part)!;
      const relsPart = relsPartOf(sh.part);
      const rels = parseRels(readText(relsPart));
      const usedRel = new Set(rels.map(r => r.id));
      const legacy = /<legacyDrawing\b[^>]*\br:id="([^"]+)"/.exec(sx)?.[1];
      let vmlPart = legacy ? resolvePart(sh.part, rels.find(r => r.id === legacy)?.target ?? "") : undefined;
      let vml = vmlPart ? readText(vmlPart) : undefined;
      const newVml = !vml;
      if (!vmlPart) vmlPart = stemUnique(names, "xl/drawings/", "vmlDrawing", "vml");
      const vmlRels = parseRels(readText(relsPartOf(vmlPart)));
      const usedVr = new Set(vmlRels.map(r => r.id));
      // id shape: di atas semua id VML & oleObject yang sudah ada pada sheet
      let maxShape = 1024;
      for (const m of (vml ?? "").matchAll(/_x0000_s(\d+)/g)) maxShape = Math.max(maxShape, Number(m[1]));
      for (const m of sx.matchAll(/<oleObject\b[^>]*\bshapeId="(\d+)"/g)) maxShape = Math.max(maxShape, Number(m[1]));
      let shapes = "", oleEls = "";
      for (const ins of list) {
        const p = ins.prep;
        const emb = stemUnique(names, "xl/embeddings/", STEM[p.ext] ?? "oleObject", p.ext);
        put(emb, p.bytes); addType(emb, p.ext, p.contentType);
        const pv = stemUnique(names, "xl/media/", "oleprev", "png");
        put(pv, p.preview); addType(pv, "png", "image/png");
        const relId = nextId(usedRel, "rIdOle");
        rels.push({ id: relId, type: p.relType, target: relativeTo(sh.part, emb) });
        const pvRel = nextId(usedVr, "rIdOlePv");
        vmlRels.push({ id: pvRel, type: REL_IMAGE, target: relativeTo(vmlPart, pv) });
        const shapeId = ++maxShape;
        shapes += vmlShape(shapeId, pvRel, p.label, ins.anchor, ins.widthPx, ins.heightPx);
        oleEls += `<oleObject progId="${xmlEsc(p.progId)}" dvAspect="DVASPECT_ICON" shapeId="${shapeId}" r:id="${relId}"/>`;
      }
      if (newVml) vml = VML_NEW(shapes);
      else {
        vml = vml!.replace(/<\/xml>\s*$/, shapes + "</xml>");
        if (!/<v:shapetype\b[^>]*id="_x0000_t75"/.test(vml)) vml = vml.replace(/(<o:shapelayout\b[\s\S]*?<\/o:shapelayout>)/, `$1${VML_SHAPETYPE}`);
        // blok idmap harus mencakup id shape yang dipakai (blok n = id n*1024+1 … (n+1)*1024)
        const block = Math.floor(maxShape / 1024);
        vml = vml.replace(/(<o:idmap\b[^>]*\bdata=")([^"]*)(")/, (_a, p1: string, data: string, p3: string) => (data.split(",").map(s => s.trim()).includes(String(block)) ? _a : p1 + data + "," + block + p3));
      }
      put(vmlPart, vml!);
      put(relsPartOf(vmlPart), relsXml(vmlRels));
      if (newVml) {
        const lid = nextId(usedRel, "rIdVml");
        rels.push({ id: lid, type: REL_VML, target: relativeTo(sh.part, vmlPart) });
        types.push({ ext: "vml", type: VML_CT });
        sx = addWorksheetChild(sx, "legacyDrawing", `<legacyDrawing r:id="${lid}"/>`);
      }
      if (/<oleObjects\b/.test(sx)) sx = sx.replace(/<\/oleObjects>/, oleEls + "</oleObjects>");
      else sx = addWorksheetChild(sx, "oleObjects", `<oleObjects>${oleEls}</oleObjects>`);
      put(sh.part, sx);
      put(relsPart, relsXml(rels));
    }

    ct = ensureContentTypes(ct, types);
    put("[Content_Types].xml", ct);

    const sink = toArrayBuffer();
    const writer = createZipWriter(sink);
    const order = [...names0, ...[...names].filter(n => !names0.includes(n))];
    for (const n of order) {
      if (files.get(n) === null) continue;
      const data = files.has(n) ? files.get(n)! : zip.read(n);
      await writer.addEntry(n, data, { compress: !/\.(png|jpe?g|gif|webp|zip|xlsx|xlsm|docx|pptx)$/i.test(n) });
    }
    const fin = await writer.finalize();
    return fin && fin.length ? fin : new Uint8Array(sink.result());
  } finally { zip.close(); }
}

/** Konversi anchor OLE (px) ↔ anchor drawing (EMU) agar dapat digambar oleh `anchorRect`. */
export const oleAnchorToDrawing = (a: OleAnchor) => ({
  kind: "twoCell",
  from: { col: a.c1, colOff: Math.round(a.c1off * EMU_PER_PX), row: a.r1, rowOff: Math.round(a.r1off * EMU_PER_PX) },
  to: { col: a.c2, colOff: Math.round(a.c2off * EMU_PER_PX), row: a.r2, rowOff: Math.round(a.r2off * EMU_PER_PX) },
});
export const drawingToOleAnchor = (d: { from: { col: number; colOff: number; row: number; rowOff: number }; to: { col: number; colOff: number; row: number; rowOff: number } }): OleAnchor => ({
  c1: d.from.col, c1off: d.from.colOff / EMU_PER_PX, r1: d.from.row, r1off: d.from.rowOff / EMU_PER_PX,
  c2: d.to.col, c2off: d.to.colOff / EMU_PER_PX, r2: d.to.row, r2off: d.to.rowOff / EMU_PER_PX,
});
export { OLE_BIN_CONTENT_TYPE };


// ───────── status sesi: objek di berkas + sisipan + perbaruan ─────────

const fmtOf = (p: PreparedOle): XlsxOleObject["format"] => (p.kind === "office" ? "zip" : "cfb");

/** Keadaan OLE selama sesi edit. Ditulis ke paket oleh `XlsxBook.toBytes` lewat `applyOlePatches`. */
export class OleStore {
  existing: XlsxOleObject[] = [];
  inserts: PendingOleInsert[] = [];
  updates = new Map<string, PreparedOle>();
  private seq = 0;

  nextId() { return `new:${++this.seq}`; }
  get hasChanges() { return this.inserts.length > 0 || this.updates.size > 0; }
  patches(): OlePatchSet { return { inserts: [...this.inserts], updates: new Map(this.updates) }; }

  /** Gabungan objek berkas (dengan perbaruan tercermin) dan sisipan baru. */
  list(): XlsxOleObject[] {
    const out = this.existing.map(o => {
      const u = this.updates.get(o.id);
      return u ? { ...o, progId: u.progId, fileName: u.fileName, size: u.bytes.length, format: fmtOf(u), description: describeProgId(u.progId), previewBytes: u.preview, previewFormat: "png", linked: false } : o;
    });
    for (const i of this.inserts) {
      out.push({
        id: i.id, sheet: i.sheet, sheetPart: "", shapeId: 0, progId: i.prep.progId, anchor: i.anchor, linked: false, size: i.prep.bytes.length, format: fmtOf(i.prep),
        fileName: i.prep.fileName, description: describeProgId(i.prep.progId), origin: "inserted", previewBytes: i.prep.preview, previewFormat: "png",
      });
    }
    return out;
  }
}
