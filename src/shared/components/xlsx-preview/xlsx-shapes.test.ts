// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseXml } from "@office-kit/xlsx/xml";
import { loadWorkbook, fromArrayBuffer } from "@office-kit/xlsx/io";
import { zipSync } from "../office-shared/test-zip";
import { parseShapeGroup, presetPaths, readColor, schemeLookup } from "./xlsx-shapes";
import { XlsxBook } from "./xlsx-model";

const PAL = ["FFFFFF", "000000", "E7E6E6", "44546A", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47", "0563C1", "954F72"];
const scheme = schemeLookup(PAL);
const NS = 'xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const SP = `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="2" name="Kotak 1"/><xdr:cNvSpPr/></xdr:nvSpPr>
<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1905000" cy="571500"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 30000"/></a:avLst></a:prstGeom>
<a:solidFill><a:schemeClr val="accent2"><a:lumMod val="50000"/></a:schemeClr></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:prstDash val="dash"/></a:ln></xdr:spPr>
<xdr:txBody><a:bodyPr vertOverflow="clip" wrap="square" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en" sz="1400" b="1"><a:solidFill><a:schemeClr val="bg1"/></a:solidFill></a:rPr><a:t>Halo</a:t></a:r></a:p></xdr:txBody></xdr:sp>`;

const parse = (xml: string) => parseXml(xml) as any;

describe("warna DrawingML", () => {
  it("scheme + lumMod, srgb + alpha", () => {
    const c = readColor(parse(`<a:solidFill ${NS}><a:schemeClr val="accent2"><a:lumMod val="50000"/></a:schemeClr></a:solidFill>`), scheme)!;
    expect(parseInt(c.hex.slice(1, 3), 16)).toBeLessThan(0xed); // lebih gelap dari ED7D31
    const d = readColor(parse(`<a:solidFill ${NS}><a:srgbClr val="00FF00"><a:alpha val="40000"/></a:srgbClr></a:solidFill>`), scheme)!;
    expect(d).toEqual({ hex: "#00ff00", a: 0.4 });
    expect(readColor(parse(`<a:solidFill ${NS}><a:schemeClr val="tx1"/></a:solidFill>`), scheme)!.hex).toBe("#000000");
  });
});

describe("parseShapeGroup", () => {
  it("sp: geometri, fill, garis, teks", () => {
    const g = parseShapeGroup(parse(`<xdr:twoCellAnchor ${NS}>${SP}</xdr:twoCellAnchor>`), scheme)!;
    expect(g.shapes).toHaveLength(1);
    const s = g.shapes[0]!;
    expect(s.geom).toBe("roundRect");
    expect(s.adj.adj).toBe(30000);
    expect(s.stroke!.hex).toBe("#ff0000");
    expect(s.strokeW).toBeCloseTo(2, 1);
    expect(s.dash).toBe("4 3");
    expect(s.text!.anchor).toBe("middle");
    expect(s.text!.paras[0]!.align).toBe("center");
    expect(s.text!.paras[0]!.runs[0]).toMatchObject({ t: "Halo", sz: 14, b: true, color: "#ffffff" });
    expect(g.hasText).toBe(true);
    expect(g.approx).toBe(false);
  });
  it("fill/garis dari xdr:style bila spPr kosong", () => {
    const x = `<xdr:sp ${NS}><xdr:nvSpPr><xdr:cNvPr id="3" name="S"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:prstGeom prst="ellipse"/></xdr:spPr>
<xdr:style><a:lnRef idx="2"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></xdr:style>
<xdr:txBody><a:bodyPr/><a:p><a:r><a:t>x</a:t></a:r></a:p></xdr:txBody></xdr:sp>`;
    const s = parseShapeGroup(parse(x), scheme)!.shapes[0]!;
    expect(s.fill).toEqual({ kind: "solid", color: { hex: "#4472c4", a: 1 } });
    expect(s.stroke!.hex).toBe("#4472c4");
    expect(s.text!.paras[0]!.runs[0]!.color).toBe("#ffffff");
  });
  it("textbox tanpa fill/garis", () => {
    const x = `<xdr:sp ${NS}><xdr:nvSpPr><xdr:cNvPr id="3" name="T"/><xdr:cNvSpPr txBox="1"/></xdr:nvSpPr><xdr:spPr><a:prstGeom prst="rect"/><a:noFill/></xdr:spPr><xdr:txBody><a:bodyPr wrap="none"/><a:p><a:r><a:t>a</a:t></a:r><a:br/><a:r><a:t>b</a:t></a:r></a:p></xdr:txBody></xdr:sp>`;
    const s = parseShapeGroup(parse(x), scheme)!.shapes[0]!;
    expect(s.fill).toBeNull(); expect(s.stroke).toBeNull(); expect(s.text!.wrap).toBe(false);
    expect(s.text!.paras[0]!.runs.map(r => r.t)).toEqual(["a", "\n", "b"]);
  });
  it("grup: anak dipetakan relatif terhadap rect grup", () => {
    const child = (id: number, x: number, y: number, cx: number, cy: number) => `<xdr:sp><xdr:nvSpPr><xdr:cNvPr id="${id}" name="c${id}"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"/></xdr:spPr></xdr:sp>`;
    const x = `<xdr:twoCellAnchor ${NS}><xdr:grpSp><xdr:nvGrpSpPr><xdr:cNvPr id="9" name="g"/><xdr:cNvGrpSpPr/></xdr:nvGrpSpPr><xdr:grpSpPr><a:xfrm><a:off x="1000" y="1000"/><a:ext cx="400" cy="200"/><a:chOff x="0" y="0"/><a:chExt cx="400" cy="200"/></a:xfrm></xdr:grpSpPr>${child(10, 0, 0, 200, 100)}${child(11, 200, 100, 200, 100)}</xdr:grpSp></xdr:twoCellAnchor>`;
    const g = parseShapeGroup(parse(x), scheme)!;
    expect(g.shapes.map(s => s.rel)).toEqual([{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }]);
  });
  it("konektor + geometri tak dikenal → approx", () => {
    const x = `<xdr:cxnSp ${NS}><xdr:nvCxnSpPr><xdr:cNvPr id="4" name="K"/><xdr:cNvCxnSpPr/></xdr:nvCxnSpPr><xdr:spPr><a:xfrm flipV="1"><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm><a:prstGeom prst="straightConnector1"/><a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></xdr:spPr></xdr:cxnSp>`;
    const s = parseShapeGroup(parse(x), scheme)!.shapes[0]!;
    expect(s.flipV).toBe(true); expect(s.tail!.type).toBe("triangle"); expect(s.fill).toBeNull();
    const y = x.replace("straightConnector1", "cloud").replaceAll("cxnSp", "sp").replaceAll("nvCxnSpPr", "nvSpPr");
    expect(parseShapeGroup(parse(y), scheme)!.approx).toBe(true);
  });
});

describe("presetPaths", () => {
  it("menghasilkan path untuk preset umum", () => {
    for (const g of ["rect", "roundRect", "ellipse", "triangle", "diamond", "rightArrow", "leftArrow", "upArrow", "downArrow", "star5", "hexagon", "can", "bentConnector3", "line"]) {
      const p = presetPaths(g, 100, 50);
      expect(p.length, g).toBeGreaterThan(0);
      expect(p[0]!.d, g).toMatch(/^M/);
      expect(p.some(x => /NaN/.test(x.d)), g).toBe(false);
    }
    expect(presetPaths("line", 100, 50)[0]!.noFill).toBe(true);
  });
});

describe("integrasi XlsxBook", () => {
  it("shape pada drawing menjadi DrawingView kind=shape", async () => {
    const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const bytes = zipSync({
      "[Content_Types].xml": X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>',
      "_rels/.rels": X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      "xl/workbook.xml": X + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels": X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      "xl/worksheets/sheet1.xml": X + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><drawing r:id="rId1"/></worksheet>',
      "xl/worksheets/_rels/sheet1.xml.rels": X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>',
      "xl/drawings/drawing1.xml": X + `<xdr:wsDr ${NS}><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>4</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>${SP}<xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`,
    });
    const wb = await loadWorkbook(fromArrayBuffer(bytes));
    const book = new XlsxBook(wb, "s.xlsx", bytes.length);
    const ws = book.worksheetAt(0)!;
    const dv = book.drawingsOf(ws);
    expect(dv).toHaveLength(1);
    expect(dv[0]!.kind).toBe("shape");
    expect(dv[0]!.shape!.shapes[0]!.geom).toBe("roundRect");
    expect(dv[0]!.text).toBe("Halo");

    // pindah shape: posisi harus ikut tertulis pada raw dan bertahan setelah simpan + muat ulang
    const a = dv[0]!.anchor;
    const moved = { ...a, from: { ...a.from, col: 5, row: 6 }, to: { ...a.to, col: 8, row: 9 } };
    const rec = book.moveDrawing(ws, dv[0]!.index, moved)!;
    expect(rec).toBeTruthy();
    const re = new XlsxBook(await loadWorkbook(fromArrayBuffer(await book.toBytes())), "s.xlsx", 0);
    const d2 = re.drawingsOf(re.worksheetAt(0)!);
    expect(d2[0]!.kind).toBe("shape");
    expect(d2[0]!.anchor.from).toMatchObject({ col: 5, row: 6 });
    expect(d2[0]!.text).toBe("Halo");
    rec.undo!();
    expect(book.drawingsOf(ws)[0]!.anchor.from).toMatchObject({ col: 1, row: 1 });
    expect(book.deleteDrawing(ws, 0)).toBeTruthy();
    expect(book.drawingsOf(ws)).toHaveLength(0);
  });
});
