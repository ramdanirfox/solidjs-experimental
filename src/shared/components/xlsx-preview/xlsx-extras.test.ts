// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createSampleWorkbook } from "./xlsx-sample";
import { XlsxBook } from "./xlsx-model";
import { reorderChildren, WORKSHEET_ORDER, normalizeNamespaces, dedupeShapeIds } from "./xlsx-repair";
import { analyzeFormula, describeCellType } from "./xlsx-formula-check";
import { extractRefs } from "./xlsx-formula";

async function sample() {
  const book = new XlsxBook(await createSampleWorkbook(), "s.xlsx", 0);
  book.refreshFormulaCaches();
  return book;
}

describe("repair paket OOXML", () => {
  const xml = '<?xml version="1.0"?><worksheet xmlns="x"><sheetData/><mergeCells count="1"><mergeCell ref="A1:B2"/></mergeCells>'
    + '<customSheetViews><customSheetView guid="{a>b}"><pageSetup r:id="rId2"/></customSheetView></customSheetViews><pageMargins left="1"/></worksheet>';
  it("customSheetViews dipindah ke sebelum mergeCells", () => {
    const r = reorderChildren(xml, "worksheet", WORKSHEET_ORDER)!;
    expect(r).toBeTruthy();
    expect(r.xml.indexOf("<customSheetViews>")).toBeLessThan(r.xml.indexOf("<mergeCells"));
    expect(r.xml).toContain('guid="{a>b}"'); // '>' dalam atribut tidak merusak
    expect(r.moved).toContain("mergeCells");
  });
  it("urutan yang sudah benar / elemen asing tidak disentuh", () => {
    const ok = '<worksheet><sheetData/><mergeCells/><pageMargins/></worksheet>';
    expect(reorderChildren(ok, "worksheet", WORKSHEET_ORDER)).toBeNull();
    expect(reorderChildren('<worksheet><sheetData/><foo/><cols/></worksheet>', "worksheet", WORKSHEET_ORDER)).toBeNull();
  });
});

describe("pemeriksa formula & tipe data", () => {
  it("sintaks, kurung, fungsi salah ketik", async () => {
    const book = await sample(); const ws = book.worksheetAt(0)!;
    const a = analyzeFormula(book, ws, 30, 1, "=SUM(A1:A3");
    expect(a[0]!.blocking).toBe(true); expect(a[0]!.hint).toMatch(/kurung/i);
    const b = analyzeFormula(book, ws, 30, 1, "=SUMM(E4:E23)");
    expect(b.some(i => /SUM\(\)/.test(i.hint))).toBe(true);
    expect(analyzeFormula(book, ws, 30, 1, "=SUM(E4:E23)")).toEqual([]);
  });
  it("teks pada rentang & operasi angka", async () => {
    const book = await sample(); const ws = book.worksheetAt(0)!;
    const i = analyzeFormula(book, ws, 30, 1, "=SUM(C4:C23)"); // kolom C = teks
    expect(i.some(x => /tanpa angka/.test(x.title))).toBe(true);
    const j = analyzeFormula(book, ws, 30, 1, "=C4+1");
    expect(j.some(x => /Teks dipakai/.test(x.title))).toBe(true);
    expect(j.some(x => /#VALUE!/.test(x.title))).toBe(true);
    const k = analyzeFormula(book, ws, 30, 1, "=1/0");
    expect(k.some(x => /#DIV\/0!/.test(x.title) && /IFERROR/.test(x.hint))).toBe(true);
    const l = analyzeFormula(book, ws, 30, 1, "=SUM(A30:A31)");
    expect(l.some(x => /melingkar/i.test(x.title))).toBe(true);
    expect(analyzeFormula(book, ws, 30, 1, "=Nope!A1+1").some(x => /tidak ditemukan/.test(x.title))).toBe(true);
  });
  it("tipe data sel untuk status bar", async () => {
    const book = await sample(); const ws = book.worksheetAt(0)!;
    expect(describeCellType(book, ws, 4, 3).label).toBe("Teks");
    expect(describeCellType(book, ws, 4, 5).label).toBe("Angka");
    expect(describeCellType(book, ws, 4, 2).label).toBe("Tanggal/Waktu");
    expect(describeCellType(book, ws, 4, 8).label).toMatch(/^Formula → Angka/);
    expect(describeCellType(book, ws, 90, 90).label).toBe("Kosong");
    book.commit([book.setInput(ws, 40, 1, "'123")]);
    expect(describeCellType(book, ws, 40, 1).warn).toBe(true);
  });
  it("extractRefs", () => {
    const r = extractRefs('=SUM(A1:B3)+Sheet2!$C$4*"A1"+LOG10(2)');
    expect(r.map(x => x.text)).toEqual(["A1:B3", "Sheet2!$C$4"]);
    expect(r[0]).toMatchObject({ r1: 1, c1: 1, r2: 3, c2: 2 });
  });
});

describe("repair drawing (shape bermakro)", () => {
  // meniru keluaran library: prefix a14 diganti ns0, tetapi mc:Ignorable tetap "a14"
  const broken = '<xdr:wsDr xmlns:xdr="x"><xdr:twoCellAnchor xmlns:ns0="http://schemas.microsoft.com/office/drawing/2010/main" xmlns:ns1="http://schemas.microsoft.com/office/drawing/2014/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">'
    + '<xdr:sp macro="[0]!Silly"><xdr:nvSpPr><xdr:cNvPr id="5" name="a"><a:extLst><a:ext uri="u"><ns1:creationId id="{1}"/></a:ext></a:extLst></xdr:cNvPr></xdr:nvSpPr>'
    + '<a:srgbClr val="000000" mc:Ignorable="a14" ns0:legacySpreadsheetColorIndex="64"/></xdr:sp></xdr:twoCellAnchor></xdr:wsDr>';
  it("mengembalikan prefix a14/a16 sehingga mc:Ignorable valid", () => {
    const r = normalizeNamespaces(broken)!;
    expect(r.xml).toContain('xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"');
    expect(r.xml).toContain('a14:legacySpreadsheetColorIndex="64"');
    expect(r.xml).toContain("<a16:creationId");
    expect(r.xml).not.toMatch(/ns\d:/);
    expect(r.xml).toContain('macro="[0]!Silly"'); // referensi makro tidak berubah
  });
  it("membuang token Ignorable yang prefix-nya memang tidak ada", () => {
    const r = normalizeNamespaces('<a xmlns:mc="m"><b mc:Ignorable="zz"/></a>')!;
    expect(r.xml).not.toContain("Ignorable");
  });
  it("XML yang sudah benar tidak disentuh; id shape duplikat diberi nomor baru", () => {
    expect(normalizeNamespaces('<a xmlns:a14="u"><b mc:Ignorable="a14"/></a>')).toBeNull();
    const d = dedupeShapeIds('<x><xdr:cNvPr id="2" name="a"/><xdr:cNvPr id="2" name="b"/><xdr:cNvPr id="7" name="c"/></x>')!;
    expect(d.changed).toBe(1);
    expect(d.xml).toContain('id="8" name="b"');
    expect(dedupeShapeIds('<x><xdr:cNvPr id="2" name="a"/></x>')).toBeNull();
  });
});

