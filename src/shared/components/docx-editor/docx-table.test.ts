// @vitest-environment node
import { describe, it, expect } from "vitest";
import { els, first, serialize, type XEl } from "./docx-xml";
import { buildGrid, createTable, deleteCols, deleteRows, distributeColumns, expandRect, gridWidths, insertCol, insertRow, mergeCells, resizeColumn, splitCell } from "./docx-table";
import { insertText } from "./docx-text";

const cellsOf = (tbl: XEl) => els(tbl, "tr").map(tr => els(tr, "tc").length);
const text = (tc: XEl, s: string) => insertText(els(tc, "p")[0], 0, s);
const tcAt = (tbl: XEl, r: number, c: number) => els(els(tbl, "tr")[r], "tc")[c];
const grid = (tbl: XEl) => els(first(tbl, "tblGrid")!, "gridCol").map(g => Number(g.attrs.find(a => a.name.local === "w")!.value));

describe("docx-table", () => {
  it("createTable + insertRow/insertCol menjaga bentuk persegi", () => {
    const t = createTable({ rows: 3, cols: 3, widthTwips: 9000 });
    expect(buildGrid(t).ncols).toBe(3);
    insertRow(t, 1, "below");
    expect(cellsOf(t)).toEqual([3, 3, 3, 3]);
    insertCol(t, 0, "right");
    expect(cellsOf(t)).toEqual([4, 4, 4, 4]);
    expect(grid(t)).toHaveLength(4);
    expect(gridWidths(buildGrid(t)).reduce((a, b) => a + b, 0)).toBeGreaterThan(9000);
  });

  it("merge 2×2 → colspan/rowspan; isi terkumpul; split memulihkan", () => {
    const t = createTable({ rows: 3, cols: 3, widthTwips: 9000 });
    text(tcAt(t, 0, 0), "A"); text(tcAt(t, 0, 1), "B"); text(tcAt(t, 1, 0), "C"); text(tcAt(t, 1, 1), "D");
    const keep = mergeCells(t, { r1: 0, c1: 0, r2: 1, c2: 1 })!;
    expect(cellsOf(t)).toEqual([2, 2, 3]);
    const g = buildGrid(t);
    const o = g.map[0][0]!;
    expect([o.colspan, o.rowspan]).toEqual([2, 2]);
    expect(g.map[1][1]!.origin).toBe(o);
    expect(els(keep, "p").map(p => serialize(p).replace(/<[^>]+>/g, "")).join("|")).toBe("A|B|C|D");
    splitCell(t, 0, 0);
    expect(cellsOf(t)).toEqual([3, 3, 3]);
    expect(buildGrid(t).cells.every(c => c.colspan === 1 && c.rowspan === 1)).toBe(true);
  });

  it("expandRect meluas agar tidak memotong sel gabungan", () => {
    const t = createTable({ rows: 3, cols: 3, widthTwips: 9000 });
    mergeCells(t, { r1: 0, c1: 0, r2: 1, c2: 1 });
    const r = expandRect(buildGrid(t), { r1: 1, c1: 1, r2: 2, c2: 2 });
    expect(r).toEqual({ r1: 0, c1: 0, r2: 2, c2: 2 });
  });

  it("deleteRows memindahkan merge vertikal ke baris berikutnya; deleteCols mengecilkan gridSpan", () => {
    const t = createTable({ rows: 4, cols: 3, widthTwips: 9000 });
    text(tcAt(t, 1, 0), "V");
    mergeCells(t, { r1: 1, c1: 0, r2: 3, c2: 0 }); // merge vertikal 3 baris
    expect(buildGrid(t).map[1][0]!.rowspan).toBe(3);
    deleteRows(t, 1, 1);
    const g = buildGrid(t);
    expect(g.rows).toHaveLength(3);
    expect(g.map[1][0]!.rowspan).toBe(2);
    expect(serialize(g.map[1][0]!.el)).toContain("V");
    const t2 = createTable({ rows: 2, cols: 4, widthTwips: 8000 });
    mergeCells(t2, { r1: 0, c1: 1, r2: 0, c2: 3 });
    expect(buildGrid(t2).map[0][1]!.colspan).toBe(3);
    deleteCols(t2, 2, 2);
    expect(buildGrid(t2).map[0][1]!.colspan).toBe(2);
    expect(grid(t2)).toHaveLength(3);
  });

  it("deleteRows/deleteCols seluruhnya melaporkan 'table'", () => {
    const t = createTable({ rows: 2, cols: 2, widthTwips: 4000 });
    expect(deleteRows(t, 0, 1)).toBe("table");
    expect(deleteCols(t, 0, 1)).toBe("table");
  });

  it("resizeColumn memindahkan lebar antar kolom bersebelahan dan menyelaraskan tcW", () => {
    const t = createTable({ rows: 2, cols: 3, widthTwips: 9000 });
    const before = grid(t);
    resizeColumn(t, 0, 500);
    const after = grid(t);
    expect(after[0]).toBe(before[0] + 500);
    expect(after[1]).toBe(before[1] - 500);
    expect(after.reduce((a, b) => a + b, 0)).toBe(before.reduce((a, b) => a + b, 0));
    const tcw = Number(first(first(tcAt(t, 0, 0), "tcPr"), "tcW")!.attrs.find(a => a.name.local === "w")!.value);
    expect(tcw).toBe(after[0]);
    // tidak boleh lebih kecil dari batas minimal
    resizeColumn(t, 0, -100000);
    expect(grid(t)[0]).toBeGreaterThanOrEqual(240);
    distributeColumns(t, 0, 2);
    const d = grid(t);
    expect(Math.max(...d) - Math.min(...d)).toBeLessThanOrEqual(1);
  });
});
