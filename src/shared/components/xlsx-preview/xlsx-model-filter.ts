/** XlsxBook: xlsx-model-filter.ts — fungsi bagian dari kelas (`this: XlsxBook`), dipasang di kelas sebagai properti agar API publik tidak berubah. */
import { type Sel, type FilterState, normSel, addr } from "./xlsx-model";
import type { XlsxBook } from "./xlsx-model";
import { setAutoFilter, setRowDimension, getCellExtent, type Worksheet } from "@office-kit/xlsx/worksheet";
import { isErr } from "./xlsx-formula";

export function enableFilter(this: XlsxBook, ws: Worksheet, sel: Sel): FilterState | undefined {
  const n = normSel(sel);
  let range = { minRow: n.r1, minCol: n.c1, maxRow: n.r2, maxCol: n.c2 };
  if (n.r1 === n.r2 && n.c1 === n.c2) {
    // satu sel: otomatis perluas ke seluruh blok data (current region)
    const ext = getCellExtent(ws);
    if (!ext) return undefined;
    range = { minRow: n.r1, minCol: ext.minCol, maxRow: ext.maxRow, maxCol: ext.maxCol };
  }
  const st: FilterState = { range, selected: new Map(), hiddenRows: new Set(), written: new Set(), touched: true };
  this.filters.set(ws, st);
  this.dirty = true;
  return st;
}

export function disableFilter(this: XlsxBook, ws: Worksheet) {
  this.filters.set(ws, null);
  setAutoFilter(ws, undefined);
  const keepTables = ws.tables?.length;
  if (keepTables) for (const t of ws.tables) t.autoFilter = undefined as any;
  this.dirty = true;
}

export function recomputeFilter(this: XlsxBook, ws: Worksheet, st: FilterState) {
  st.hiddenRows = new Set();
  const active = [...st.selected.entries()];
  if (!active.length) return;
  for (let r = st.range.minRow + 1; r <= st.range.maxRow; r++) {
    for (const [col, allowed] of active) {
      const t = this.textAt(ws, r, col);
      if (!allowed.has(t)) { st.hiddenRows.add(r); break; }
    }
  }
}

export function setFilterColumn(this: XlsxBook, ws: Worksheet, st: FilterState, col: number, allowed: Set<string> | null) {
  if (allowed === null) st.selected.delete(col); else st.selected.set(col, allowed);
  st.touched = true;
  this.dirty = true;
  this.recomputeFilter(ws, st);
}

export function uniqueValues(this: XlsxBook, ws: Worksheet, st: FilterState, col: number): { value: string; count: number }[] {
  const m = new Map<string, number>();
  for (let r = st.range.minRow + 1; r <= st.range.maxRow; r++) {
    const t = this.textAt(ws, r, col);
    m.set(t, (m.get(t) ?? 0) + 1);
  }
  return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => {
    const na = Number(a.value), nb = Number(b.value);
    if (a.value !== "" && b.value !== "" && !isNaN(na) && !isNaN(nb)) return na - nb;
    return a.value.localeCompare(b.value, undefined, { numeric: true, sensitivity: "base" });
  });
}

/** Tulis keadaan filter ke model OOXML sebelum disimpan. */
export function flushFilters(this: XlsxBook) {
  for (const [ws, st] of this.filters) {
    if (!st || !st.touched) continue;
    const ref = `${addr(st.range.minRow, st.range.minCol)}:${addr(st.range.maxRow, st.range.maxCol)}`;
    const filterColumns = [...st.selected.entries()].map(([col, vals]) => ({
      kind: "filters" as const,
      colId: col - st.range.minCol,
      values: [...vals].filter(v => v !== ""),
      ...(vals.has("") ? { blank: true } : {}),
    }));
    setAutoFilter(ws, { ref, filterColumns } as any);
    for (let r = st.range.minRow + 1; r <= st.range.maxRow; r++) {
      if (st.hiddenRows.has(r)) { setRowDimension(ws, r, { hidden: true }); st.written.add(r); }
      else if (st.written.has(r)) { setRowDimension(ws, r, { hidden: false }); st.written.delete(r); }
    }
  }
}

/** Isi ulang cache nilai formula agar viewer lain (tanpa kalkulasi) menampilkan hasil terbaru. */
export function refreshFormulaCaches(this: XlsxBook): number {
  const prev = this.ev.live;
  this.ev.live = true;
  this.ev.invalidate();
  let n = 0;
  for (const s of this.wb.sheets) {
    if (s.kind !== "worksheet") continue;
    for (const [r, row] of s.sheet.rows) for (const [c, cell] of row) {
      const f: any = cell.value;
      if (!f || f.kind !== "formula") continue;
      const res = this.ev.evalFormulaCell(s.sheet, r, c);
      if (isErr(res) && (res.code === "#NAME?" || res.code === "#CIRC!")) continue;
      const next: any = { ...f };
      if (isErr(res)) { next.cachedValue = res.code; next.cachedValueType = "error"; }
      else if (res === null) { delete next.cachedValue; delete next.cachedValueType; }
      else { next.cachedValue = res; delete next.cachedValueType; }
      cell.value = next;
      n++;
    }
  }
  this.ev.live = prev;
  this.ev.invalidate();
  return n;
}
