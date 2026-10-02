import { describe, it, expect } from "vitest";
import { createWorkbook, addWorksheet } from "@office-kit/xlsx/workbook";
import { setCell } from "@office-kit/xlsx/worksheet";
import { makeFormula } from "@office-kit/xlsx/cell";
import { Evaluator, parseFormula, nodeToString, isErr } from "./xlsx-formula";

function setup() {
  const wb = createWorkbook();
  const ws = addWorksheet(wb, "Data");
  const ws2 = addWorksheet(wb, "My Sheet");
  [["Item", "Qty", "Price"], ["Apel", 3, 1000], ["Jeruk", 5, 2000], ["Apel", 2, 1500]].forEach((row, i) =>
    row.forEach((v, j) => setCell(ws, i + 1, j + 1, v as any)));
  setCell(ws2, 1, 1, 42);
  setCell(ws, 6, 1, makeFormula("SUM(B2:B4)*2", { cachedValue: 20 }));
  setCell(ws, 7, 1, makeFormula("A6+1"));
  setCell(ws, 8, 1, makeFormula("A9"));
  setCell(ws, 9, 1, makeFormula("A8"));
  const ev = new Evaluator(wb);
  ev.live = true;
  return { wb, ws, ev };
}
const run = (ev: Evaluator, ws: any, f: string) => ev.evalText(f, { ws, row: 20, col: 1 });

describe("xlsx-formula", () => {
  it("aritmatika & presedensi", () => {
    const { ev, ws } = setup();
    expect(run(ev, ws, "=1+2*3")).toBe(7);
    expect(run(ev, ws, "=-2^2")).toBe(4);
    expect(run(ev, ws, "=(1+2)*3")).toBe(9);
    expect(run(ev, ws, "=10/4")).toBe(2.5);
    expect(run(ev, ws, "=50%")).toBe(0.5);
    expect(run(ev, ws, '="a"&"b"&1')).toBe("ab1");
    expect(isErr(run(ev, ws, "=1/0"))).toBe(true);
  });
  it("fungsi agregat & kriteria", () => {
    const { ev, ws } = setup();
    expect(run(ev, ws, "=SUM(B2:B4)")).toBe(10);
    expect(run(ev, ws, "=AVERAGE(B2:B4)")).toBeCloseTo(3.3333, 3);
    expect(run(ev, ws, '=SUMIF(A2:A4,"Apel",B2:B4)')).toBe(5);
    expect(run(ev, ws, '=COUNTIF(A2:A4,"A*")')).toBe(2);
    expect(run(ev, ws, '=SUMIFS(B2:B4,A2:A4,"Apel",C2:C4,">1000")')).toBe(2);
    expect(run(ev, ws, "=SUMPRODUCT(B2:B4,C2:C4)")).toBe(3 * 1000 + 5 * 2000 + 2 * 1500);
    expect(run(ev, ws, "=SUM(B:B)")).toBe(10);
    expect(run(ev, ws, "=MAX(B2:B4)-MIN(B2:B4)")).toBe(3);
  });
  it("logika, teks, lookup, lintas sheet", () => {
    const { ev, ws } = setup();
    expect(run(ev, ws, '=IF(B2>2,"besar","kecil")')).toBe("besar");
    expect(run(ev, ws, "=IFERROR(1/0,\"x\")")).toBe("x");
    expect(run(ev, ws, '=UPPER(LEFT(A3,2))&LEN(A3)')).toBe("JE5");
    expect(run(ev, ws, '=VLOOKUP("Jeruk",A2:C4,3,FALSE)')).toBe(2000);
    expect(run(ev, ws, '=INDEX(C2:C4,MATCH("Jeruk",A2:A4,0))')).toBe(2000);
    expect(run(ev, ws, "='My Sheet'!A1+1")).toBe(43);
    expect(run(ev, ws, "=SUMPRODUCT((B2:B4>2)*(C2:C4))")).toBe(3000);
    expect(run(ev, ws, '=TEXT(1234.5,"#,##0.00")')).toBe("1,234.50");
  });
  it("dependensi sel, siklus, nama tak dikenal", () => {
    const { ev, ws } = setup();
    expect(ev.evalFormulaCell(ws, 7, 1)).toBe(21);
    const c = ev.evalFormulaCell(ws, 8, 1);
    expect(isErr(c) && c.code).toBe("#CIRC!");
    expect(isErr(run(ev, ws, "=NOPE(1)"))).toBe(true);
  });
  it("parser round trip", () => {
    expect(nodeToString(parseFormula("=SUM(A1:B2, 3)+'My Sheet'!$C$1"))).toBe("SUM(A1:B2, 3) + 'My Sheet'!$C$1");
  });
});
