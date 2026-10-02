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
});
