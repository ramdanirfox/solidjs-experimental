// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as P from "@office-kit/pptx";
import { PptxDeck } from "./pptx-model";
import { insertOleFrame, listPptxOle, oleFramePreview, pptxOleBytes, scanSlideOle, updateOleFrame } from "./pptx-ole";
import { readCfb } from "../office-shared/ole-core";
import { prepareOle } from "../office-shared/ole-embed";
import { zipSync } from "../office-shared/test-zip";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

async function newDeck() {
  const pres = P.createPresentation({ size: "16:9" });
  P.addBlankSlide(pres);
  P.addBlankSlide(pres);
  return PptxDeck.fromPresentation(pres, "t.pptx");
}

describe("pptx OLE: sisip & perbarui", () => {
  it("sisip → muat ulang → terbaca sebagai bingkai OLE dengan pratinjau dan isi utuh", async () => {
    const deck = await newDeck();
    const prep = await prepareOle("catatan.txt", enc("isi satu"));
    const gen = deck.generation;
    const r = await deck.mutatePackage("hist.oleInsert", pres => insertOleFrame(pres, 1, prep));
    expect(deck.generation).toBeGreaterThan(gen);
    expect(r).toMatchObject({ slideIndex: 1, part: "/ppt/embeddings/oleObject1.bin" });
    expect(deck.canUndo).toBe(true);

    const list = listPptxOle(deck.pres);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ slideIndex: 1, shapeId: r.shapeId, progId: "Package", format: "cfb", fileName: "catatan.txt", linked: false });
    expect(list[0].bounds.w).toBeGreaterThan(1_000_000);

    const slide = P.getSlides(deck.pres)[1];
    const pv = oleFramePreview(deck.pres, slide, scanSlideOle(slide).find(f => f.id === r.shapeId)!)!;
    expect(pv.format).toBe("png");
    expect(pv.bytes[0]).toBe(0x89);
    expect(dec(readCfb(pptxOleBytes(deck.pres, 1, r.shapeId)!.data).native!.data)).toBe("isi satu");

    // simpan → buka ulang di sesi baru
    const re = await PptxDeck.open(await deck.toBytes(), "x.pptx");
    expect(listPptxOle(re.pres)).toHaveLength(1);
    expect(P.validatePresentation(re.pres).filter(v => v.severity === "error")).toEqual([]);
  });

  it("posisi default di tengah slide; objek kedua tidak menimpa part/id yang pertama", async () => {
    const deck = await newDeck();
    const p1 = await prepareOle("a.txt", enc("a")), p2 = await prepareOle("b.txt", enc("b"));
    const r1 = await deck.mutatePackage("1", pres => insertOleFrame(pres, 0, p1));
    const r2 = await deck.mutatePackage("2", pres => insertOleFrame(pres, 0, p2, { x: 100, y: 200, w: 3_000_000 }));
    expect(r2.part).not.toBe(r1.part);
    expect(r2.shapeId).not.toBe(r1.shapeId);
    expect(r2.relId).not.toBe(r1.relId);
    expect(r2.bounds).toMatchObject({ x: 100, y: 200, w: 3_000_000 });
    const size = P.getSlideSize(deck.pres)!;
    expect(r1.bounds.x * 2 + r1.bounds.w).toBeCloseTo(size.width, -1);
    expect(listPptxOle(deck.pres).map(o => o.shapeId).sort()).toEqual([r1.shapeId, r2.shapeId].sort());
  });

  it("dokumen Office tertanam: relasi package + ProgID Excel.Sheet.12 + content type", async () => {
    const deck = await newDeck();
    const prep = await prepareOle("hitung.xlsx", zipSync({ "[Content_Types].xml": "<x/>" }));
    const r = await deck.mutatePackage("x", pres => insertOleFrame(pres, 0, prep));
    expect(r.part).toBe("/ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx");
    expect(listPptxOle(deck.pres)[0]).toMatchObject({ progId: "Excel.Sheet.12", format: "zip" });
    expect(P.listPackageParts(deck.pres).find(p => p.name === r.part)!.contentType).toMatch(/spreadsheetml\.sheet$/);
  });

  it("perbarui: isi & jenis berganti, posisi/ukuran tetap, part lama dibuang, undo memulihkan", async () => {
    const deck = await newDeck();
    const v1 = await prepareOle("v1.txt", enc("versi 1"));
    const ins = await deck.mutatePackage("hist.oleInsert", pres => insertOleFrame(pres, 0, v1, { x: 500_000, y: 600_000, w: 2_400_000 }));
    const before = listPptxOle(deck.pres)[0];

    const v2 = await prepareOle("hitung.xlsx", zipSync({ "[Content_Types].xml": "<x/>" }));
    const up = await deck.mutatePackage("hist.oleUpdate", pres => updateOleFrame(pres, 0, ins.shapeId, v2));
    expect(up.oldPart).toBe(ins.part);
    const after = listPptxOle(deck.pres);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ progId: "Excel.Sheet.12", part: up.part, format: "zip", shapeId: ins.shapeId });
    expect(after[0].bounds).toEqual(before.bounds); // posisi & ukuran tetap
    const names = P.listPackageParts(deck.pres).map(p => p.name);
    expect(names).not.toContain(ins.part); // part lama dibuang
    expect(names.filter(n => /oleprev/.test(n))).toHaveLength(1);

    // undo (snapshot bytes penuh) memulihkan isi lama
    expect(await deck.undo()).toBe(true);
    const back = listPptxOle(deck.pres)[0];
    expect(back).toMatchObject({ progId: "Package", part: ins.part });
    expect(dec(readCfb(pptxOleBytes(deck.pres, 0, ins.shapeId)!.data).native!.data)).toBe("versi 1");
    expect(await deck.redo()).toBe(true);
    expect(listPptxOle(deck.pres)[0].progId).toBe("Excel.Sheet.12");
  });

  it("galat: slide/shape tidak ada dan kegagalan tidak merusak dek", async () => {
    const deck = await newDeck();
    const prep = await prepareOle("a.txt", enc("a"));
    await expect(deck.mutatePackage("x", pres => insertOleFrame(pres, 9, prep))).rejects.toThrow(/Slide 10 tidak ada/);
    await expect(deck.mutatePackage("x", pres => updateOleFrame(pres, 0, 999, prep))).rejects.toThrow(/tidak ditemukan/);
    expect(P.getSlides(deck.pres)).toHaveLength(2);
    expect(listPptxOle(deck.pres)).toHaveLength(0);
    // tetap bisa menyisipkan setelah kegagalan
    await deck.mutatePackage("ok", pres => insertOleFrame(pres, 0, prep));
    expect(listPptxOle(deck.pres)).toHaveLength(1);
  });
});
