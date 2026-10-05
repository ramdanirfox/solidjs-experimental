// @vitest-environment node
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { createWorkbook, addWorksheet } from "@office-kit/xlsx/workbook";
import { setCell, setComment } from "@office-kit/xlsx/worksheet";
import { loadWorkbook, workbookToBytes, fromArrayBuffer } from "@office-kit/xlsx/io";
import { openZip } from "@office-kit/xlsx/zip";
import { addWorksheetChild, applyOlePatches, scanXlsxOle, type OleAnchor, type PendingOleInsert } from "./xlsx-ole";
import { repairPackage } from "./xlsx-repair";
import { readCfb } from "../office-shared/ole-core";
import { prepareOle } from "../office-shared/ole-embed";
import { zipSync } from "../office-shared/test-zip";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const anchor = (c: number, r: number): OleAnchor => ({ c1: c, c1off: 4, r1: r, r1off: 2, c2: c + 2, c2off: 10, r2: r + 3, r2off: 5 });

async function baseBook(withComment = false): Promise<Uint8Array> {
  const wb = createWorkbook();
  const ws = addWorksheet(wb, "Data");
  setCell(ws, 1, 1, "halo");
  const ws2 = addWorksheet(wb, "Lain & <Satu>");
  setCell(ws2, 1, 1, 42);
  if (withComment) setComment(ws, { ref: "A1", author: "tim", text: "catatan" });
  const raw = await workbookToBytes(wb);
  return (await repairPackage(raw)).bytes;
}
const entries = async (bytes: Uint8Array) => { const z = await openZip(fromArrayBuffer(bytes)); try { return Object.fromEntries(z.list().map(n => [n, dec(z.read(n))])); } finally { z.close(); } };
// workbookToBytes membutuhkan realm Node (typed array asli) → uji berjalan di lingkungan node; DOMParser dipinjam dari jsdom
const { DOMParser: JsdomParser } = new JSDOM("").window;
const wellFormed = (xml: string) => !new JsdomParser().parseFromString(xml, "application/xml").getElementsByTagName("parsererror").length;

describe("xlsx OLE: sisip", () => {
  it("sisip pada sheet tanpa VML: part, relasi, oleObjects, VML, content type — semua well-formed dan terbaca kembali", async () => {
    const base = await baseBook();
    const prep = await prepareOle("catatan.txt", enc("isi satu"));
    const ins: PendingOleInsert = { id: "new:1", sheet: "Data", prep, anchor: anchor(2, 3), widthPx: 96, heightPx: 72 };
    const out = await applyOlePatches(base, { inserts: [ins], updates: new Map() });
    const files = await entries(out);

    expect(Object.keys(files)).toEqual(expect.arrayContaining(["xl/embeddings/oleObject1.bin", "xl/media/oleprev1.png", "xl/drawings/vmlDrawing1.vml", "xl/drawings/_rels/vmlDrawing1.vml.rels"]));
    for (const [n, x] of Object.entries(files)) if (/\.(xml|rels|vml)$/.test(n)) expect(wellFormed(x), `${n} harus well-formed`).toBe(true);
    const sheet = files["xl/worksheets/sheet1.xml"];
    expect(sheet).toMatch(/<legacyDrawing r:id="rIdVml1"\/>/);
    expect(sheet).toMatch(/<oleObjects><oleObject progId="Package" dvAspect="DVASPECT_ICON" shapeId="1025" r:id="rIdOle1"\/><\/oleObjects>/);
    // urutan skema: ... sheetData ... legacyDrawing, oleObjects
    expect(sheet.indexOf("<sheetData")).toBeLessThan(sheet.indexOf("<legacyDrawing"));
    expect(sheet.indexOf("<legacyDrawing")).toBeLessThan(sheet.indexOf("<oleObjects"));
    expect(files["xl/drawings/vmlDrawing1.vml"]).toContain("<x:Anchor>2, 4, 3, 2, 4, 10, 6, 5</x:Anchor>");
    expect(files["[Content_Types].xml"]).toMatch(/Extension="vml"/);
    expect(files["[Content_Types].xml"]).toMatch(/Extension="bin"/);

    const found = await scanXlsxOle(out);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ sheet: "Data", progId: "Package", shapeId: 1025, part: "xl/embeddings/oleObject1.bin", format: "cfb", fileName: "catatan.txt", linked: false, origin: "file" });
    expect(found[0].anchor).toEqual(anchor(2, 3));
    expect(found[0].previewFormat).toBe("png");
    expect(found[0].previewBytes![0]).toBe(0x89);
  });

  it("beberapa objek di dua sheet: id shape unik, tidak saling menimpa; nama sheet dengan karakter khusus", async () => {
    const base = await baseBook();
    const a = await prepareOle("a.txt", enc("a")), b = await prepareOle("b.txt", enc("b")), x = await prepareOle("lap.xlsx", zipSync({ "[Content_Types].xml": "<x/>" }));
    const out = await applyOlePatches(base, {
      inserts: [
        { id: "new:1", sheet: "Data", prep: a, anchor: anchor(0, 0), widthPx: 96, heightPx: 72 },
        { id: "new:2", sheet: "Data", prep: b, anchor: anchor(4, 0), widthPx: 96, heightPx: 72 },
        { id: "new:3", sheet: "Lain & <Satu>", prep: x, anchor: anchor(1, 1), widthPx: 96, heightPx: 72 },
      ],
      updates: new Map(),
    });
    const found = await scanXlsxOle(out);
    expect(found.map(f => [f.sheet, f.shapeId, f.progId])).toEqual([["Data", 1025, "Package"], ["Data", 1026, "Package"], ["Lain & <Satu>", 1025, "Excel.Sheet.12"]]);
    expect(new Set(found.map(f => f.part)).size).toBe(3);
    const files = await entries(out);
    expect(files["[Content_Types].xml"]).toMatch(/spreadsheetml\.sheet/);
    for (const [n, c] of Object.entries(files)) if (/\.(xml|rels|vml)$/.test(n)) expect(wellFormed(c), n).toBe(true);
  });

  it("selamat dari round-trip library: muat → simpan → objek masih ada", async () => {
    const base = await baseBook();
    const out = await applyOlePatches(base, { inserts: [{ id: "n", sheet: "Data", prep: await prepareOle("a.txt", enc("a")), anchor: anchor(1, 1), widthPx: 96, heightPx: 72 }], updates: new Map() });
    const wb = await loadWorkbook(fromArrayBuffer(out));
    const again = (await repairPackage(await workbookToBytes(wb))).bytes;
    const found = await scanXlsxOle(again);
    // @office-kit/xlsx 0.23.4 mempertahankan oleObjects + VML + embedding saat simpan; bila versi berikutnya mengubahnya, uji ini menangkapnya
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ progId: "Package", format: "cfb", fileName: "a.txt", previewFormat: "png" });
    expect(found[0].anchor).toEqual(anchor(1, 1));
  });

  it("galat jelas: sheet tidak ada dan objek tertaut/tak dikenal", async () => {
    const base = await baseBook();
    const prep = await prepareOle("a.txt", enc("a"));
    await expect(applyOlePatches(base, { inserts: [{ id: "n", sheet: "Tidak Ada", prep, anchor: anchor(0, 0), widthPx: 9, heightPx: 9 }], updates: new Map() })).rejects.toThrow(/Sheet "Tidak Ada" tidak ditemukan/);
    await expect(applyOlePatches(base, { inserts: [], updates: new Map([["0:999", prep]]) })).rejects.toThrow(/tidak ditemukan/);
    expect(await applyOlePatches(base, { inserts: [], updates: new Map() })).toBe(base);
  });
});

describe("xlsx OLE: sheet yang sudah punya komentar (VML bersama)", () => {
  it("menambah shape ke VML komentar yang ada, id unik, idmap mencakup blok, komentar tetap ada", async () => {
    const base = await baseBook(true);
    const before = await entries(base);
    const vmlName = Object.keys(before).find(n => /vmlDrawing\d*\.vml$/.test(n));
    expect(vmlName, "workbook dengan komentar harus punya VML").toBeTruthy();
    const out = await applyOlePatches(base, { inserts: [{ id: "n", sheet: "Data", prep: await prepareOle("a.txt", enc("a")), anchor: anchor(3, 3), widthPx: 96, heightPx: 72 }], updates: new Map() });
    const files = await entries(out);
    expect(Object.keys(files).filter(n => /\.vml$/.test(n))).toEqual([vmlName]); // tidak membuat VML kedua
    const vml = files[vmlName!];
    const ids = [...vml.matchAll(/id="_x0000_s(\d+)"/g)].map(m => Number(m[1]));
    expect(new Set(ids).size).toBe(ids.length);
    expect(vml).toContain('o:ole=""');
    expect(vml).toContain("ObjectType=\"Note\"");
    const sheetXml = Object.entries(files).find(([n, c]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n) && c.includes("<oleObjects"))![1];
    expect((sheetXml.match(/<legacyDrawing\b/g) ?? []).length).toBe(1);
    for (const [n, c] of Object.entries(files)) if (/\.(xml|rels|vml)$/.test(n)) expect(wellFormed(c), n).toBe(true);
    const found = await scanXlsxOle(out);
    expect(found).toHaveLength(1);
    expect(found[0].anchor).toEqual(anchor(3, 3));
    // komentar tetap terbaca oleh library
    const wb = await loadWorkbook(fromArrayBuffer(out));
    const first = wb.sheets[0] as { kind: string; sheet: { legacyComments?: unknown[] } };
    expect(first.kind).toBe("worksheet");
    expect(first.sheet.legacyComments?.length).toBe(1);
  });
});

describe("xlsx OLE: perbarui", () => {
  it("isi sama jenis: part diganti di tempat; jenis berbeda: part & relasi baru, progId diganti, pratinjau diarahkan ulang", async () => {
    const base = await baseBook();
    const v1 = await prepareOle("v1.txt", enc("versi 1"));
    const withOle = await applyOlePatches(base, { inserts: [{ id: "n", sheet: "Data", prep: v1, anchor: anchor(1, 1), widthPx: 96, heightPx: 72 }], updates: new Map() });
    const [o1] = await scanXlsxOle(withOle);

    const v2 = await prepareOle("v2.txt", enc("versi 2"));
    const out2 = await applyOlePatches(withOle, { inserts: [], updates: new Map([[o1.id, v2]]) });
    const [o2] = await scanXlsxOle(out2);
    expect(o2.part).toBe(o1.part); // jenis sama → tempat sama
    expect(dec(readCfb((await zipBytes(out2, o2.part!))).native!.data)).toBe("versi 2");
    expect(o2.previewPart).not.toBe(o1.previewPart); // pratinjau baru

    const x = await prepareOle("hitung.xlsx", zipSync({ "[Content_Types].xml": "<x/>" }));
    const out3 = await applyOlePatches(out2, { inserts: [], updates: new Map([[o2.id, x]]) });
    const [o3] = await scanXlsxOle(out3);
    expect(o3).toMatchObject({ progId: "Excel.Sheet.12", format: "zip", shapeId: o1.shapeId });
    expect(o3.part).toMatch(/\.xlsx$/);
    const files = await entries(out3);
    expect(Object.keys(files)).not.toContain(o1.part); // part lama dibuang
    expect(files["xl/worksheets/_rels/sheet1.xml.rels"]).toMatch(/\/package"/);
    expect(o3.anchor).toEqual(o1.anchor); // posisi tidak berubah
    for (const [n, c] of Object.entries(files)) if (/\.(xml|rels|vml)$/.test(n)) expect(wellFormed(c), n).toBe(true);
  });

  it("membaca bentuk Excel 2010+ (mc:AlternateContent + objectPr + anchor)", async () => {
    const base = await baseBook();
    const withOle = await applyOlePatches(base, { inserts: [{ id: "n", sheet: "Data", prep: await prepareOle("a.txt", enc("a")), anchor: anchor(1, 1), widthPx: 96, heightPx: 72 }], updates: new Map() });
    // ubah sheet menjadi gaya modern: Choice (dengan objectPr + anchor) + Fallback
    const files = await entries(withOle);
    const rels = files["xl/worksheets/_rels/sheet1.xml.rels"].replace("</Relationships>", '<Relationship Id="rIdX9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/oleprev1.png"/></Relationships>');
    const modern = files["xl/worksheets/sheet1.xml"].replace(/<oleObjects>[\s\S]*<\/oleObjects>/,
      '<oleObjects><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="x14"><oleObject progId="Package" shapeId="1025" r:id="rIdOle1"><objectPr defaultSize="0" r:id="rIdX9"><anchor moveWithCells="1"><from><xdr:col xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">7</xdr:col><xdr:colOff xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">9525</xdr:colOff><xdr:row xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">2</xdr:row><xdr:rowOff xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">19050</xdr:rowOff></from><to><xdr:col xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">9</xdr:col><xdr:colOff xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">0</xdr:colOff><xdr:row xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">5</xdr:row><xdr:rowOff xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">0</xdr:rowOff></to></anchor></objectPr></oleObject></mc:Choice><mc:Fallback><oleObject progId="Package" shapeId="1025" r:id="rIdOle1"/></mc:Fallback></mc:AlternateContent></oleObjects>');
    const patched = await rebuild(withOle, { "xl/worksheets/sheet1.xml": modern, "xl/worksheets/_rels/sheet1.xml.rels": rels });
    const found = await scanXlsxOle(patched);
    expect(found).toHaveLength(1); // Choice + Fallback dilebur
    expect(found[0].anchor).toEqual({ c1: 7, c1off: 1, r1: 2, r1off: 2, c2: 9, c2off: 0, r2: 5, r2off: 0 });
    expect(found[0].previewPart).toBe("xl/media/oleprev1.png");
  });
});

describe("addWorksheetChild", () => {
  it("menyisipkan di posisi skema, bukan di akhir", () => {
    const xml = '<worksheet xmlns="x" xmlns:r="r"><sheetData/><pageMargins left="1"/><tableParts count="0"/></worksheet>';
    const out = addWorksheetChild(xml, "oleObjects", "<oleObjects/>");
    expect(out.indexOf("<pageMargins")).toBeLessThan(out.indexOf("<oleObjects"));
    expect(out.indexOf("<oleObjects")).toBeLessThan(out.indexOf("<tableParts"));
    expect(addWorksheetChild('<worksheet xmlns="x"><sheetData/></worksheet>', "legacyDrawing", '<legacyDrawing r:id="a"/>')).toContain('xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"');
  });
});

async function zipBytes(bytes: Uint8Array, name: string): Promise<Uint8Array> {
  const z = await openZip(fromArrayBuffer(bytes));
  try { return z.read(name); } finally { z.close(); }
}
/** Bangun ulang ZIP dengan mengganti sebagian entri (untuk menyiapkan skenario uji). */
async function rebuild(bytes: Uint8Array, replace: Record<string, string>): Promise<Uint8Array> {
  const { createZipWriter } = await import("@office-kit/xlsx/zip");
  const { toArrayBuffer } = await import("@office-kit/xlsx/io");
  const z = await openZip(fromArrayBuffer(bytes));
  try {
    const sink = toArrayBuffer();
    const w = createZipWriter(sink);
    for (const n of z.list()) await w.addEntry(n, replace[n] !== undefined ? enc(replace[n]) : z.read(n), { compress: true });
    const fin = await w.finalize();
    return fin && fin.length ? fin : new Uint8Array(sink.result());
  } finally { z.close(); }
}
