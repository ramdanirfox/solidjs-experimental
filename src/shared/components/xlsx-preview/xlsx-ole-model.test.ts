// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createWorkbook, addWorksheet } from "@office-kit/xlsx/workbook";
import { setCell } from "@office-kit/xlsx/worksheet";
import { XlsxBook, loadBook } from "./xlsx-model";
import { readCfb } from "../office-shared/ole-core";
import { prepareOle } from "../office-shared/ole-embed";
import { openZip } from "@office-kit/xlsx/zip";
import { fromArrayBuffer } from "@office-kit/xlsx/io";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

async function newBook() {
  const wb = createWorkbook();
  const ws = addWorksheet(wb, "Data");
  setCell(ws, 1, 1, "halo");
  const book = new XlsxBook(wb, "uji.xlsx", 0);
  book.sourceBytes = await book.toBytes();
  await book.scanOle();
  return { book, ws };
}
const anchor = { c1: 2, c1off: 0, r1: 2, r1off: 0, c2: 4, c2off: 0, r2: 5, r2off: 0 };
const part = async (bytes: Uint8Array, name: string) => { const z = await openZip(fromArrayBuffer(bytes)); try { return z.read(name); } finally { z.close(); } };

describe("XlsxBook OLE", () => {
  it("sisip → tampil di drawingsOf (kind ole) → simpan → buka kembali → perbarui → simpan", async () => {
    const { book, ws } = await newBook();
    expect(book.oleList()).toHaveLength(0);
    const { record, id } = book.insertOle(ws, await prepareOle("catatan.txt", enc("isi satu")), anchor, { w: 96, h: 72 });
    book.commit([record], { styleOnly: true });
    expect(book.dirty).toBe(true);
    expect(book.oleList(ws)).toHaveLength(1);
    const dv = book.drawingsOf(ws).find(d => d.kind === "ole")!;
    expect(dv).toMatchObject({ oleId: id, index: -1, name: "Package", anchorCell: { row: 3, col: 3 } });
    expect(dv.url === undefined || typeof dv.url === "string").toBe(true);

    const saved = await book.toBytes();
    const re = (await loadBook(saved, "uji.xlsx")).book!;
    const [o] = re.oleList();
    expect(o).toMatchObject({ sheet: "Data", progId: "Package", origin: "file", format: "cfb", fileName: "catatan.txt" });
    expect(o.anchor).toEqual(anchor);

    // perbarui objek yang sudah ada di berkas
    const up = re.updateOle(o.id, await prepareOle("baru.txt", enc("isi dua")));
    re.commit([up.record], { styleOnly: true });
    expect(re.oleList()[0]).toMatchObject({ fileName: "baru.txt", id: o.id });
    const saved2 = await re.toBytes();
    const re2 = (await loadBook(saved2, "uji.xlsx")).book!;
    const [o2] = re2.oleList();
    expect(dec(readCfb(await part(saved2, o2.part!)).native!.data)).toBe("isi dua");
    expect(o2.anchor).toEqual(anchor);
    expect(re2.oleList()).toHaveLength(1);
  });

  it("undo/redo sisip dan perbarui mengembalikan keadaan sesi (tanpa menyentuh paket)", async () => {
    const { book, ws } = await newBook();
    const ins = book.insertOle(ws, await prepareOle("a.txt", enc("a")), anchor, { w: 96, h: 72 });
    book.commit([ins.record], { styleOnly: true });
    const up = book.updateOle(ins.id, await prepareOle("b.txt", enc("b")));
    book.commit([up.record], { styleOnly: true });
    expect(book.oleList()[0].fileName).toBe("b.txt");
    up.record.undo!();
    expect(book.oleList()[0].fileName).toBe("a.txt");
    up.record.redo!();
    expect(book.oleList()[0].fileName).toBe("b.txt");
    ins.record.undo!();
    expect(book.oleList()).toHaveLength(0);
    expect(book.drawingsOf(ws).some(d => d.kind === "ole")).toBe(false);
    ins.record.redo!();
    expect(book.oleList()).toHaveLength(1);
    // simpan tanpa objek jika semua dibatalkan
    ins.record.undo!();
    const bytes = await book.toBytes();
    expect((await loadBook(bytes, "x.xlsx")).book!.oleList()).toHaveLength(0);
  });

  it("galat: id tak ada dan objek tertaut", async () => {
    const { book } = await newBook();
    await expect(Promise.resolve().then(() => book.updateOle("0:999", { } as never))).rejects.toThrow(/tidak ditemukan/);
    book.ole.existing = [{ id: "0:1", sheet: "Data", sheetPart: "xl/worksheets/sheet1.xml", shapeId: 1, progId: "x", linked: true, size: 0, format: "missing", fileName: "", description: "", origin: "file" }];
    expect(() => book.updateOle("0:1", { } as never)).toThrow(/tertaut/);
  });
});
