// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createSampleWorkbook } from "./xlsx-sample";
import { XlsxBook, loadBook, buildLoadReport } from "./xlsx-model";
import { buildLayout } from "./xlsx-layout";

async function sample() {
  const wb = await createSampleWorkbook();
  const book = new XlsxBook(wb, "sample.xlsx", 0);
  book.refreshFormulaCaches();
  return book;
}

describe("xlsx-model", () => {
  it("sample: formula, filter, drawings, layout", async () => {
    const book = await sample();
    const ws = book.worksheetAt(0)!;
    const total = book.textAt(ws, 4, 8);
    expect(total).toMatch(/^Rp/);
    const sum = book.worksheetAt(1)!;
    expect(book.textAt(sum, 8, 1)).toBe("Total");
    expect(book.valueAt(sum, 11, 2)).toBe("✔ cocok");
    expect(book.valueAt(sum, 13, 2)).toBe("aman");
    const f = book.filterOf(ws)!;
    expect(f.range.minRow).toBe(3);
    const lay = buildLayout(ws, { zoom: 1, showHidden: false });
    expect(lay.fc).toBe(3); expect(lay.fr).toBe(3);
    expect(lay.hiddenRows.has(8)).toBe(true);
    expect(lay.hiddenCols.has(9)).toBe(true);
    expect(book.drawingsOf(ws).filter(d => d.kind === "picture").length).toBe(1);
  });

  it("round trip + edit + csv + search + undo", async () => {
    const book = await sample();
    const ws = book.worksheetAt(0)!;
    const rec = book.setInput(ws, 4, 5, "100");
    book.commit([rec]);
    expect(book.textAt(ws, 4, 8)).not.toBe("");
    expect(book.dirty).toBe(true);
    const bytes = await book.toBytes();
    const out = await loadBook(bytes, "sample-edited.xlsx");
    expect(out.book).toBeTruthy();
    const ws2 = out.book!.worksheetAt(0)!;
    expect(out.book!.valueAt(ws2, 4, 5)).toBe(100);
    const csv = book.toCsv(ws, { skipHidden: true });
    expect(csv.split("\r\n").length).toBeGreaterThan(20);
    const res = book.search({ query: "laptop", allSheets: true });
    expect(res.hits.length).toBeGreaterThan(0);
    book.undo();
    expect(book.valueAt(ws, 4, 5)).not.toBe(100);
    const log = buildLoadReport(out.book!);
    expect(log.some(l => l.area.includes("Penjualan"))).toBe(true);
    console.log(log.map(l => `[${l.level}] ${l.area}: ${l.message}`).join("\n"));
  });

  it("macro: vbaProject dipertahankan", async () => {
    const book = await sample();
    book.wb.vbaProject = new Uint8Array([1, 2, 3, 4]);
    const bytes = await book.toBytes();
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.includes("vbaProject.bin")).toBe(true);
  });

  it("edit style per sel: patch, undo, simpan ulang", async () => {
    const book = await sample();
    const ws = book.worksheetAt(0)!;
    const sel = { r1: 5, c1: 3, r2: 7, c2: 4 };
    const recs = book.applyStyle(ws, sel, { bold: true, fill: "#ff0000", fontColor: "#00ff00", border: { kind: "outer" }, numFmt: "0.00", h: "center" });
    expect(recs.length).toBe(6);
    book.commit(recs, { styleOnly: true });
    expect(book.ev.live).toBe(false); // style saja tidak mengubah mode kalkulasi
    const mid = book.styleOf(ws, ws.rows.get(6)!.get(3)!);
    expect(mid.bold).toBe(true); expect(mid.bg).toBe("#ff0000"); expect(mid.color).toBe("#00ff00"); expect(mid.h).toBe("center"); expect(mid.numFmt).toBe("0.00");
    expect(mid.top).toBeUndefined(); // sel tengah tidak mendapat border luar
    const corner = book.styleOf(ws, ws.rows.get(5)!.get(3)!);
    expect(corner.top?.width).toBe(1); expect(corner.left?.width).toBe(1);
    const bytes = await book.toBytes();
    const re = await loadBook(bytes, "x.xlsx");
    const st = re.book!.styleOf(re.book!.worksheetAt(0)!, re.book!.worksheetAt(0)!.rows.get(6)!.get(3)!);
    expect(st.bg).toBe("#ff0000");
    book.undo();
    expect(book.styleOf(ws, ws.rows.get(6)!.get(3)!).bg).not.toBe("#ff0000");
    // rentang kosong dibuat sel baru
    const empty = book.applyStyle(ws, { r1: 40, c1: 1, r2: 41, c2: 2 }, { fill: "#00ff00" });
    expect(empty.length).toBe(4);
  });

  it("pencarian async dapat dibatalkan dan sama dengan sync", async () => {
    const book = await sample();
    const ws = book.worksheetAt(0)!;
    const a = book.search({ query: "keyboard", sheet: ws });
    const b = await book.searchAsync({ query: "keyboard", sheet: ws }, () => false);
    expect(b?.hits.length).toBe(a.hits.length);
    const c = await book.searchAsync({ query: "keyboard", sheet: ws }, () => true, undefined);
    expect(c === undefined || c.hits.length === a.hits.length).toBe(true);
  });

  it("merge/unmerge: snapping, undo, simpan ulang", async () => {
    const book = await sample();
    const ws = book.worksheetAt(0)!;
    // A1:H1 sudah merge di sample: seleksi sebagian harus diperluas ke seluruh merge
    const ex = book.expandSel(ws, { r1: 1, c1: 3, r2: 2, c2: 4 });
    expect(ex).toEqual({ r1: 1, c1: 1, r2: 2, c2: 8 });
    expect(book.mergeAt(ws, 1, 5)?.minCol).toBe(1);
    expect(book.mergeAt(ws, 5, 5)).toBeUndefined();
    const before = ws.mergedCells.length;
    const res: any = book.mergeSelection(ws, { r1: 5, c1: 3, r2: 6, c2: 4 });
    expect(res.error).toBeUndefined();
    expect(res.lost).toBe(3);
    book.commit(res.records, { styleOnly: true });
    expect(ws.mergedCells.length).toBe(before + 1);
    expect(book.mergeAt(ws, 6, 4)?.minRow).toBe(5);
    expect(book.valueAt(ws, 6, 4)).toBeNull();
    const re = await loadBook(await book.toBytes(), "m.xlsx");
    expect(re.book!.worksheetAt(0)!.mergedCells.length).toBe(before + 1);
    book.undo();
    expect(ws.mergedCells.length).toBe(before);
    expect(book.valueAt(ws, 6, 3)).not.toBeNull();
    book.redo();
    expect(book.mergeAt(ws, 6, 4)?.minRow).toBe(5);
    const un: any = book.unmergeSelection(ws, { r1: 5, c1: 3, r2: 5, c2: 3 });
    expect(un.count).toBe(1);
    expect(book.mergeAt(ws, 6, 4)).toBeUndefined();
    expect((book.mergeSelection(ws, { r1: 40, c1: 1, r2: 40, c2: 1 }) as any).error).toBeTruthy();
  });

  it("gambar: pindah, sisip, hapus, undo & persist", async () => {
    const book = await sample();
    const ws = book.worksheetAt(0)!;
    const d0 = book.drawingsOf(ws).filter(d => d.kind === "picture");
    expect(d0.length).toBe(1);
    const anchor = { kind: "oneCell", from: { col: 11, colOff: 1000, row: 9, rowOff: 2000 }, ext: { cx: 952500, cy: 476250 } };
    const mv = book.moveDrawing(ws, d0[0]!.index, anchor)!;
    book.commit([mv], { styleOnly: true });
    expect(book.drawingsOf(ws).find(d => d.kind === "picture")!.anchorCell).toEqual({ row: 10, col: 12 });
    const re = await loadBook(await book.toBytes(), "i.xlsx");
    const rw = re.book!.worksheetAt(0)!;
    const pic = re.book!.drawingsOf(rw).find(d => d.kind === "picture")!;
    expect(pic.anchor.from.col).toBe(11); expect(pic.anchor.from.row).toBe(9);
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));
    const ins = book.insertImage(ws, png, 12, 2);
    book.commit([ins.record], { styleOnly: true });
    expect(book.drawingsOf(ws).filter(d => d.kind === "picture").length).toBe(2);
    book.undo();
    expect(book.drawingsOf(ws).filter(d => d.kind === "picture").length).toBe(1);
    book.redo();
    const del = book.deleteDrawing(ws, ins.index)!;
    book.commit([del], { styleOnly: true });
    expect(book.drawingsOf(ws).filter(d => d.kind === "picture").length).toBe(1);
    book.undo();
    expect(book.drawingsOf(ws).filter(d => d.kind === "picture").length).toBe(2);
  });
});
