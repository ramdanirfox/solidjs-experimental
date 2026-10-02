// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseXmlString, serialize, first, els, type XEl } from "./docx-xml";
import { applyParaPatch, applyRunPatch, deleteRange, flatText, insertText, mergeParagraphs, normalize, replaceRange, runsInRange, splitAt, splitParagraph, units } from "./docx-text";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const mkBody = (inner: string): XEl => parseXmlString(`<w:body ${W}>${inner}</w:body>`);
const para = (b: XEl, i = 0) => els(b, "p")[i];

describe("docx-text", () => {
  it("unit & flat text (tab, br, hyperlink, del diabaikan)", () => {
    const b = mkBody(`<w:p><w:r><w:t>Halo </w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">dunia</w:t></w:r><w:hyperlink r:id="rId1"><w:r><w:t>link</w:t></w:r></w:hyperlink><w:del><w:r><w:delText>hapus</w:delText></w:r></w:del><w:r><w:br/></w:r></w:p>`);
    expect(flatText(para(b))).toBe("Halo \tduniaLINK".replace("LINK", "link") + "\n");
    expect(units(para(b)).map(u => u.kind)).toEqual(["t", "tab", "t", "t", "br"]);
  });

  it("insertText memakai format run tetangga & menggabung teks", () => {
    const b = mkBody(`<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>abc</w:t></w:r><w:r><w:t>def</w:t></w:r></w:p>`);
    const p = para(b);
    insertText(p, 3, "X");
    expect(flatText(p)).toBe("abcXdef");
    expect(serialize(p)).toContain("<w:b/>");
    insertText(p, 7, "\tZ");
    expect(flatText(p)).toBe("abcXdef\tZ");
  });

  it("deleteRange lintas run", () => {
    const b = mkBody(`<w:p><w:r><w:t>abc</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>def</w:t></w:r><w:r><w:t>ghi</w:t></w:r></w:p>`);
    const p = para(b);
    deleteRange(p, 2, 7);
    expect(flatText(p)).toBe("abhi");
    replaceRange(p, 0, 2, "ZZZ");
    expect(flatText(p)).toBe("ZZZhi");
  });

  it("splitAt + runsInRange + applyRunPatch", () => {
    const b = mkBody(`<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>`);
    const p = para(b);
    const spans = runsInRange(p, 6, 11);
    expect(spans).toHaveLength(1);
    applyRunPatch(spans[0].run, { b: true, color: "#ff0000", sz: 28 });
    const x = serialize(p);
    expect(x).toMatch(/<w:rPr><w:b\/><w:bCs\/><w:color w:val="FF0000"\/><w:sz w:val="28"\/><w:szCs w:val="28"\/><\/w:rPr><w:t>world<\/w:t>/);
    expect(flatText(p)).toBe("Hello world");
    splitAt(p, 3);
    normalize(p);
    expect(flatText(p)).toBe("Hello world");
  });

  it("splitParagraph di tengah hyperlink membelah wrapper; mergeParagraphs membalikkan", () => {
    const b = mkBody(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Awal </w:t></w:r><w:hyperlink r:id="rId5"><w:r><w:t>tautan panjang</w:t></w:r></w:hyperlink><w:r><w:t> akhir</w:t></w:r></w:p>`);
    const p = para(b);
    const np = splitParagraph(b, p, 11);
    expect(flatText(p)).toBe("Awal tautan");
    expect(flatText(np)).toBe(" panjang akhir");
    expect(serialize(np)).toContain('<w:hyperlink r:id="rId5">');
    expect(serialize(np)).toContain('<w:jc w:val="center"/>');
    mergeParagraphs(b, p, np);
    expect(els(b, "p")).toHaveLength(1);
    expect(flatText(para(b))).toBe("Awal tautan panjang akhir");
  });

  it("splitParagraph di akhir mewarisi rPr + next style; di awal menghasilkan paragraf kosong di atas", () => {
    const b = mkBody(`<w:p><w:pPr><w:pStyle w:val="Judul"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Teks</w:t></w:r></w:p>`);
    const p = para(b);
    const np = splitParagraph(b, p, 4, { nextStyle: "Normal" });
    expect(flatText(np)).toBe("");
    expect(serialize(np)).toContain('<w:pStyle w:val="Normal"/>');
    expect(serialize(np)).toContain("<w:b/>");
    const b2 = mkBody(`<w:p><w:r><w:t>Teks</w:t></w:r></w:p>`);
    const n2 = splitParagraph(b2, para(b2), 0);
    expect(flatText(para(b2))).toBe("");
    expect(flatText(n2)).toBe("Teks");
  });

  it("applyParaPatch menjaga urutan skema pPr", () => {
    const b = mkBody(`<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`);
    const p = para(b);
    applyParaPatch(p, { style: "Heading1", indLeft: 720, before: 120, after: 60, keepNext: true, num: { numId: 3, ilvl: 1 } });
    const pPr = serialize(first(p, "pPr")!);
    const order = ["pStyle", "keepNext", "numPr", "spacing", "ind", "jc"].map(t => pPr.indexOf(`<w:${t}`));
    expect(order).toEqual([...order].sort((a, c) => a - c));
    expect(order.every(i => i >= 0)).toBe(true);
  });
});
