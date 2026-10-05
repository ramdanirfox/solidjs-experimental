// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createSampleBook } from "./docx-sample";
import { DocxBook } from "./docx-model";
import { insertRunAt } from "./docx-text";
import { createOleRun, findOleObject, oleBytes, oleSize, setOleSize, updateOleObject } from "./docx-ole-edit";
import { listOle, readCfb } from "./docx-ole";
import { prepareOle } from "../office-shared/ole-embed";
import { zipSync } from "../office-shared/test-zip";

const enc = (s: string) => new TextEncoder().encode(s);

describe("docx OLE: sisip & perbarui", () => {
  it("prepareOle memilih bentuk penyimpanan seperti Office", async () => {
    const txt = await prepareOle("catatan.txt", enc("halo dunia"));
    expect(txt).toMatchObject({ kind: "package", progId: "Package", ext: "bin" });
    expect(readCfb(txt.bytes).native?.fileName).toBe("catatan.txt");
    expect(new TextDecoder().decode(readCfb(txt.bytes).native!.data)).toBe("halo dunia");

    const xlsx = await prepareOle("laporan.xlsx", zipSync({ "[Content_Types].xml": "<x/>" }));
    expect(xlsx).toMatchObject({ kind: "office", progId: "Excel.Sheet.12", ext: "xlsx" });
    expect(xlsx.contentType).toMatch(/spreadsheetml\.sheet$/);

    // berkas bernama .xlsx tetapi bukan ZIP → dibungkus sebagai Package, bukan ditulis sebagai xlsx rusak
    const fake = await prepareOle("palsu.xlsx", enc("bukan zip"));
    expect(fake.kind).toBe("package");
    await expect(prepareOle("kosong.bin", new Uint8Array())).rejects.toThrow(/kosong/i);
    expect(txt.preview[0]).toBe(0x89); // PNG
  });

  it("sisip objek → simpan → buka kembali: terdaftar, isi utuh, tanpa duplikasi id", async () => {
    const book = await createSampleBook({ lang: "en", ole: true });
    const before = listOle(book).length;
    const prep = await prepareOle("data.csv", enc("a,b\n1,2"));
    const p = [...book.paragraphs()][0].p;
    const { run, ref } = createOleRun(book, prep);
    insertRunAt(p, 0, run);
    book.reindex();

    const list = listOle(book);
    expect(list).toHaveLength(before + 1);
    const o = list.find(x => x.relId === ref.relId)!;
    expect(o).toMatchObject({ progId: "Package", relType: "oleObject", format: "cfb", part: ref.part });
    expect(ref.part).toMatch(/^\/word\/embeddings\/oleObject\d+\.bin$/);

    // objek kedua tidak menimpa yang pertama
    const second = createOleRun(book, await prepareOle("lain.csv", enc("x")));
    insertRunAt(p, 0, second.run);
    expect(second.ref.relId).not.toBe(ref.relId);
    expect(second.ref.part).not.toBe(ref.part);
    expect(second.ref.shapeId).not.toBe(ref.shapeId);

    const bytes = book.toBytes();
    const re = await DocxBook.open(bytes, "x.docx");
    const rl = listOle(re);
    expect(rl).toHaveLength(before + 2);
    const back = rl.find(x => x.part === ref.part)!;
    expect(new TextDecoder().decode(readCfb(re.part(back.part)!.data).native!.data)).toBe("a,b\n1,2");
    expect(re.validate().filter(v => v.severity === "error")).toEqual([]);
  });

  it("dokumen Office tertanam memakai relasi package + content type sendiri", async () => {
    const book = await createSampleBook({ lang: "en", ole: false });
    const prep = await prepareOle("sheet.xlsx", zipSync({ "[Content_Types].xml": "<x/>" }));
    const { run, ref } = createOleRun(book, prep);
    insertRunAt([...book.paragraphs()][0].p, 0, run);
    book.reindex();
    expect(ref.part).toBe("/word/embeddings/Microsoft_Excel_Sheet1.xlsx");
    expect(book.rel(ref.relId)!.type).toMatch(/\/package$/);
    const re = await DocxBook.open(book.toBytes(), "x.docx");
    const o = listOle(re)[0];
    expect(o).toMatchObject({ progId: "Excel.Sheet.12", relType: "package", format: "zip" });
    expect(re.part(o.part)!.contentType).toMatch(/spreadsheetml\.sheet$/);
  });

  it("perbarui: relasi baru, undo mengembalikan isi lama, isi baru tersimpan", async () => {
    const book = await createSampleBook({ lang: "en", ole: false });
    book.checkpoint("init", true);
    const p = [...book.paragraphs()][0].p;
    const first = createOleRun(book, await prepareOle("v1.txt", enc("versi 1")));
    insertRunAt(p, 0, first.run);
    book.reindex(); book.checkpoint("insert");

    const upd = updateOleObject(book, first.ref.relId, await prepareOle("v2.txt", enc("versi 2")));
    book.checkpoint("update");
    expect(upd.relId).not.toBe(first.ref.relId);
    expect(upd.oldRelId).toBe(first.ref.relId);
    expect(findOleObject(book, upd.relId)).toBeTruthy();
    expect(findOleObject(book, first.ref.relId)).toBeUndefined();
    expect(new TextDecoder().decode(readCfb(oleBytes(book, upd.relId)!.data).native!.data)).toBe("versi 2");

    // undo hanya memulihkan XML body — bagian lama harus masih ada
    expect(book.undo()).toBe(true);
    book.reindex();
    expect(findOleObject(book, first.ref.relId)).toBeTruthy();
    expect(new TextDecoder().decode(readCfb(oleBytes(book, first.ref.relId)!.data).native!.data)).toBe("versi 1");
    book.redo(); book.reindex();

    // beralih jenis (txt → xlsx) mengganti ProgID, jenis relasi, dan ekstensi part
    const toXlsx = updateOleObject(book, upd.relId, await prepareOle("t.xlsx", zipSync({ "[Content_Types].xml": "<x/>" })));
    expect(toXlsx.part).toMatch(/\.xlsx$/);
    expect(book.rel(toXlsx.relId)!.type).toMatch(/\/package$/);
    const re = await DocxBook.open(book.toBytes(), "x.docx");
    const list = listOle(re);
    expect(list.map(x => x.progId)).toEqual(["Excel.Sheet.12"]);
    expect(() => updateOleObject(book, "rIdTidakAda", { } as never)).toThrow(/tidak ditemukan/);
  });

  it("ukuran tampilan dapat dibaca dan diubah", async () => {
    const book = await createSampleBook({ lang: "en", ole: false });
    const { run, ref } = createOleRun(book, await prepareOle("a.txt", enc("a")), { wPx: 200, hPx: 100 });
    insertRunAt([...book.paragraphs()][0].p, 0, run);
    book.reindex();
    expect(oleSize(book, ref.relId)).toEqual({ wPx: 200, hPx: 100 });
    expect(setOleSize(book, ref.relId, 320, 160)).toBe(true);
    const s = oleSize(book, ref.relId)!;
    expect(Math.round(s.wPx)).toBe(320);
    expect(Math.round(s.hPx)).toBe(160);
    expect(setOleSize(book, "tidak-ada", 1, 1)).toBe(false);
  });
});
