// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as P from "@office-kit/pptx";
import { PptxDeck } from "./pptx-model";
import { listPptxOle, pptxOleBytes, scanSlideOle, updateOleFrame } from "./pptx-ole";
import { prepareOle } from "../office-shared/ole-embed";
import { encodePng } from "../office-shared/png";
import { zipSync } from "../office-shared/test-zip";

const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** Rakit slide bergaya PowerPoint: OLE di dalam mc:AlternateContent (Choice VML + Fallback gambar). */
async function powerPointStyleDeck(): Promise<PptxDeck> {
  const pres = P.createPresentation({ size: "16:9" });
  P.addBlankSlide(pres);
  const p1 = await P.loadPresentation(await P.savePresentation(pres));
  const slide = P.getSlides(p1)[0];
  const pkg = P._internalPackageOf(p1);
  const slidePart = P.getSlidePartName(slide);
  pkg.addPart("/ppt/embeddings/Microsoft_Excel_Worksheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", zipSync({ "[Content_Types].xml": "<x/>" }));
  (pkg.contentTypes as unknown as { defaults: { extension: string; contentType: string }[] }).defaults.push({ extension: "xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, { extension: "png", contentType: "image/png" });
  pkg.addPart("/ppt/media/image1.png", "image/png", encodePng(8, 8, () => [10, 20, 30]));
  const rels = pkg.getRels(slidePart)!;
  rels.items.push({ id: "rId9", type: `${R}/package`, target: "../embeddings/Microsoft_Excel_Worksheet.xlsx", targetMode: "Internal" } as never);
  rels.items.push({ id: "rId10", type: `${R}/image`, target: "../media/image1.png", targetMode: "Internal" } as never);
  pkg.setRels(slidePart, rels as never);
  const sp = pkg.getPart(slidePart)!;
  let xml = new TextDecoder().decode(sp.data);
  xml = xml.replace("<p:sld ", '<p:sld xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:v="urn:schemas-microsoft-com:vml" ');
  const head = '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Object 3"/><p:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="1000000" y="1100000"/><a:ext cx="2000000" cy="1500000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/presentationml/2006/ole">';
  const tail = "</a:graphicData></a:graphic></p:graphicFrame>";
  const choice = head + '<p:oleObj spid="_x0000_s1026" name="Worksheet" r:id="rId9" imgW="2000000" imgH="1500000" progId="Excel.Sheet.12"><p:embed/></p:oleObj>' + tail;
  const fallback = head + '<p:oleObj name="Worksheet" r:id="rId9" imgW="2000000" imgH="1500000" progId="Excel.Sheet.12"><p:embed/><p:pic><p:nvPicPr><p:cNvPr id="0" name=""/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId10"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="1000000" y="1100000"/><a:ext cx="2000000" cy="1500000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:oleObj>' + tail;
  xml = xml.replace("</p:spTree>", `<mc:AlternateContent><mc:Choice Requires="v">${choice}</mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent></p:spTree>`);
  sp.data = new TextEncoder().encode(xml);
  return PptxDeck.open(await P.savePresentation(p1), "powerpoint.pptx");
}

describe("pptx OLE buatan PowerPoint (mc:AlternateContent)", () => {
  it("library tidak melihatnya sebagai shape, tetapi pemindai XML menemukannya", async () => {
    const deck = await powerPointStyleDeck();
    expect(P.getSlideShapes(P.getSlides(deck.pres)[0])).toHaveLength(0);
    const frames = scanSlideOle(P.getSlides(deck.pres)[0]);
    expect(frames).toHaveLength(1); // Choice + Fallback dilebur per id
    expect(frames[0]).toMatchObject({ id: 4, direct: false, progId: "Excel.Sheet.12", relId: "rId9", previewRelId: "rId10", linked: false });
    expect(frames[0].bounds).toEqual({ x: 1_000_000, y: 1_100_000, w: 2_000_000, h: 1_500_000 });
    const list = listPptxOle(deck.pres);
    expect(list[0]).toMatchObject({ slideIndex: 0, shapeId: 4, format: "zip", part: "/ppt/embeddings/Microsoft_Excel_Worksheet.xlsx", previewPart: "/ppt/media/image1.png" });
    expect(pptxOleBytes(deck.pres, 0, 4)!.data.length).toBeGreaterThan(20);
  });

  it("perbarui: cabang VML dilepas, bingkai menjadi biasa (dikenal library), posisi tetap, part lama dibuang", async () => {
    const deck = await powerPointStyleDeck();
    const prep = await prepareOle("catatan.txt", new TextEncoder().encode("baru"));
    const up = await deck.mutatePackage("hist.oleUpdate", pres => updateOleFrame(pres, 0, 4, prep));
    expect(up.oldPart).toBe("/ppt/embeddings/Microsoft_Excel_Worksheet.xlsx");
    const shapes = P.getSlideShapes(P.getSlides(deck.pres)[0]);
    expect(shapes).toHaveLength(1); // kini bingkai biasa
    const [o] = listPptxOle(deck.pres);
    expect(o).toMatchObject({ shapeId: 4, direct: true, progId: "Package", format: "cfb", fileName: "catatan.txt" });
    expect(o.bounds).toEqual({ x: 1_000_000, y: 1_100_000, w: 2_000_000, h: 1_500_000 });
    const names = P.listPackageParts(deck.pres).map(p => p.name);
    expect(names).not.toContain("/ppt/embeddings/Microsoft_Excel_Worksheet.xlsx");
    expect(names).not.toContain("/ppt/media/image1.png");
    expect(P.getSlideXmlString(P.getSlides(deck.pres)[0])).not.toMatch(/spid=/);
    expect(P.validatePresentation(deck.pres).filter(v => v.severity === "error")).toEqual([]);
  });
});
