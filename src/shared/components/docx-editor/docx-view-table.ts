/** DocxView: docx-view-table.ts — fungsi bagian dari kelas (`this: DocxView`), dipasang di kelas sebagai properti agar API publik tidak berubah. */
import type { DocxView } from "./docx-view";
import { isEl, mk, type XEl } from "./docx-xml";
import { renderTable } from "./docx-render";
import { deleteBlock } from "./docx-ops";
import { buildGrid, type GCell, type Rect } from "./docx-table";
import * as T from "./docx-table";

/** Sel (`tc`) milik `tbl` yang memuat paragraf `p` (menembus tabel bersarang), atau undefined. */
export function cellInTable(this: DocxView, p: XEl, tbl: XEl): XEl | undefined {
  const book = this.book!;
  let cur: XEl | undefined = p;
  while (cur) {
    if (cur.name.local === "tc") {
      const tr = book.parentOf(cur);
      if (tr && book.parentOf(tr) === tbl) return cur;
    }
    cur = book.parentOf(cur);
  }
  return undefined;
}

export function outermostTable(this: DocxView, tbl: XEl): XEl {
  let cur = tbl;
  for (;;) {
    const tc = this.book!.parentOf(cur);
    if (!tc || tc.name.local !== "tc") return cur;
    const tr = this.book!.parentOf(tc), up = tr ? this.book!.parentOf(tr) : undefined;
    if (!up) return cur;
    cur = up;
  }
}

export function finishTable(this: DocxView, tbl: XEl, label: string, focusTc?: XEl) {
  const book = this.book!;
  book.reindex();
  const top = this.outermostTable(tbl);
  const old = this.reg.domOf.get(top);
  if (old) {
    const sec = old.dataset.sec ?? "0";
    const nd = renderTable(this.makeCtx(this.contentWOf(Number(sec)), book.doc.partName), top);
    nd.dataset.sec = sec;
    old.replaceWith(nd);
  } else this.renderAll({ sel: null });
  this.refreshNums();
  this.applyCellSelVisual();
  let target = focusTc;
  if (!target || !this.book!.parentOf(target)) {
    const g2 = buildGrid(tbl);
    const lc = this.lastCell;
    target = lc ? g2.map[Math.min(lc.row, g2.rows.length - 1)]?.[Math.min(lc.col, g2.ncols - 1)]?.origin.el : undefined;
  }
  if (target) { const p = this.firstParaIn(target); if (p) this.focusPara(p, 0, false); }
  this.commit(label);
  this.schedulePaginate(30);
}

/** Perintah tabel. `arg` bergantung pada `op`. */
export function table(this: DocxView, op: string, arg?: unknown): void {
  const c = this.tctx();
  const book = this.book;
  if (!c || !book || this.readonly) return;
  const { tbl, g, rect, cell } = c;
  const focusTc = cell.el;
  this.lastCell = { row: rect.r1, col: rect.c1 };
  const cellsInRect = () => { const set = new Set<XEl>(); for (let r = rect.r1; r <= rect.r2; r++) for (let cc = rect.c1; cc <= rect.c2; cc++) { const x = g.map[r]?.[cc]?.origin; if (x) set.add(x.el); } return [...set]; };
  const sides = (p: string): T.BorderSide[] => p === "all" ? ["top", "left", "bottom", "right", "insideH", "insideV"] : p === "outer" ? ["top", "left", "bottom", "right"] : p === "inner" ? ["insideH", "insideV"] : [p as T.BorderSide];
  switch (op) {
    case "insertRowAbove": T.insertRow(tbl, rect.r1, "above"); return this.finishTable(tbl, "hist.tblRow", focusTc);
    case "insertRowBelow": T.insertRow(tbl, rect.r2, "below"); return this.finishTable(tbl, "hist.tblRow", focusTc);
    case "insertColLeft": T.insertCol(tbl, rect.c1, "left"); return this.finishTable(tbl, "hist.tblCol", focusTc);
    case "insertColRight": T.insertCol(tbl, rect.c2, "right"); return this.finishTable(tbl, "hist.tblCol", focusTc);
    case "deleteRows": if (T.deleteRows(tbl, rect.r1, rect.r2) === "table") return this.table("deleteTable"); this.clearCellSel(); return this.finishTable(tbl, "hist.tblDelRow");
    case "deleteCols": if (T.deleteCols(tbl, rect.c1, rect.c2) === "table") return this.table("deleteTable"); this.clearCellSel(); return this.finishTable(tbl, "hist.tblDelCol");
    case "deleteTable": {
      const parent = book.parentOf(tbl);
      if (!parent) return;
      const sibs = this.blockSiblings(parent); const nx = sibs[sibs.indexOf(tbl) + 1] ?? sibs[sibs.indexOf(tbl) - 1];
      deleteBlock(parent, tbl);
      this.cellSel = null;
      this.commitStructural("hist.tblDelete");
      const p = nx && nx.name.local === "p" ? nx : undefined;
      if (p) this.focusPara(p, 0, false);
      return;
    }
    case "merge": { const k = T.mergeCells(tbl, rect); if (!k) return; this.clearCellSel(); return this.finishTable(tbl, "hist.tblMerge", k); }
    case "split": { const k = T.splitCell(tbl, cell.row, cell.col, typeof arg === "number" ? arg : 2); this.clearCellSel(); return this.finishTable(tbl, "hist.tblSplit", k); }
    case "shade": for (const tc of cellsInRect()) T.setCellShading(tc, arg as string | null); return this.finishTable(tbl, "hist.tblShade", focusTc);
    case "valign": for (const tc of cellsInRect()) T.setCellVAlign(tc, arg as "top" | "center" | "bottom"); return this.finishTable(tbl, "hist.tblAlign", focusTc);
    case "noWrap": for (const tc of cellsInRect()) T.setCellNoWrap(tc, !!arg); return this.finishTable(tbl, "hist.tbl", focusTc);
    case "direction": for (const tc of cellsInRect()) T.setCellDirection(tc, arg as "lrTb" | "btLr" | "tbRl"); return this.finishTable(tbl, "hist.tbl", focusTc);
    case "cellMargins": for (const tc of cellsInRect()) T.setCellMargins(tc, arg as { top?: number; left?: number; bottom?: number; right?: number } | null); return this.finishTable(tbl, "hist.tbl", focusTc);
    case "borders": {
      const a = arg as { preset: string; spec: T.BorderSpec | null; scope?: "cells" | "table" };
      const whole = a.scope === "table" || (rect.r1 === 0 && rect.c1 === 0 && rect.r2 === g.rows.length - 1 && rect.c2 === g.ncols - 1);
      if (whole) { if (a.preset === "all" || a.preset === "none") T.clearCellBorders(tbl); T.setTableBorders(tbl, sides(a.preset === "none" ? "all" : a.preset), a.preset === "none" ? null : a.spec); }
      else for (const cl of g.cells) {
        if (cl.row < rect.r1 || cl.row > rect.r2 || cl.col < rect.c1 || cl.col > rect.c2) continue;
        const ss = a.preset === "none" ? (["top", "left", "bottom", "right"] as T.BorderSide[]) : this.cellSides(a.preset, cl, rect);
        T.setCellBorders(cl.el, ss, a.preset === "none" ? null : a.spec);
      }
      return this.finishTable(tbl, "hist.tblBorder", focusTc);
    }
    case "align": T.setTableAlign(tbl, arg as "left" | "center" | "right"); return this.finishTable(tbl, "hist.tblAlign", focusTc);
    case "style": T.setTableStyle(tbl, arg as string | null); return this.finishTable(tbl, "hist.tblStyle", focusTc);
    case "look": T.setTableLook(tbl, arg as Parameters<typeof T.setTableLook>[1]); return this.finishTable(tbl, "hist.tblStyle", focusTc);
    case "layout": T.setTableLayout(tbl, !!arg); return this.finishTable(tbl, "hist.tbl", focusTc);
    case "width": { const a = arg as { mode: "auto" | "pct" | "dxa"; value?: number }; T.setTableWidthMode(tbl, a.mode, a.value); if (a.mode === "dxa" && a.value) { const w = T.gridWidths(g); const sum = w.reduce((x, y) => x + y, 0); T.setTableWidths(tbl, w.map(x => (x * a.value!) / sum)); } return this.finishTable(tbl, "hist.tbl", focusTc); }
    case "rowHeight": for (const r of new Set(Array.from({ length: rect.r2 - rect.r1 + 1 }, (_, i) => g.rows[rect.r1 + i]))) T.setRowHeight(r, arg === null ? null : Math.round((arg as number) * 20)); return this.finishTable(tbl, "hist.tbl", focusTc);
    case "headerRow": for (const r of new Set(Array.from({ length: rect.r2 - rect.r1 + 1 }, (_, i) => g.rows[rect.r1 + i]))) T.setHeaderRow(r, !!arg); return this.finishTable(tbl, "hist.tbl", focusTc);
    case "distCols": T.distributeColumns(tbl, rect.c1 === rect.c2 ? 0 : rect.c1, rect.c1 === rect.c2 ? g.ncols - 1 : rect.c2); return this.finishTable(tbl, "hist.tblResize", focusTc);
    case "caption": { const a = arg as { title?: string; desc?: string }; T.setTableCaption(tbl, a.title, a.desc); return this.finishTable(tbl, "hist.tbl", focusTc); }
    case "select": { this.setCellSel(tbl, { r1: 0, c1: 0, r2: g.rows.length - 1, c2: g.ncols - 1 }); return; }
    case "selectRow": { this.setCellSel(tbl, { r1: rect.r1, c1: 0, r2: rect.r2, c2: g.ncols - 1 }); return; }
    case "selectCol": { this.setCellSel(tbl, { r1: 0, c1: rect.c1, r2: g.rows.length - 1, c2: rect.c2 }); return; }
    default: return;
  }
}

export function cellSides(this: DocxView, preset: string, cl: GCell, rect: Rect): T.BorderSide[] {
  const endR = cl.row + cl.rowspan - 1, endC = cl.col + cl.colspan - 1;
  if (preset === "all") return ["top", "left", "bottom", "right"];
  if (preset === "outer") { const o: T.BorderSide[] = []; if (cl.row === rect.r1) o.push("top"); if (endR === rect.r2) o.push("bottom"); if (cl.col === rect.c1) o.push("left"); if (endC === rect.c2) o.push("right"); return o; }
  if (preset === "inner") { const o: T.BorderSide[] = []; if (cl.row > rect.r1) o.push("top"); if (endR < rect.r2) o.push("bottom"); if (cl.col > rect.c1) o.push("left"); if (endC < rect.c2) o.push("right"); return o; }
  if (preset === "top") return cl.row === rect.r1 ? ["top"] : [];
  if (preset === "bottom") return endR === rect.r2 ? ["bottom"] : [];
  if (preset === "left") return cl.col === rect.c1 ? ["left"] : [];
  if (preset === "right") return endC === rect.c2 ? ["right"] : [];
  if (preset === "insideH") return [...(cl.row > rect.r1 ? ["top" as const] : []), ...(endR < rect.r2 ? ["bottom" as const] : [])];
  if (preset === "insideV") return [...(cl.col > rect.c1 ? ["left" as const] : []), ...(endC < rect.c2 ? ["right" as const] : [])];
  return [];
}

export function clearCells(this: DocxView) {
  const c = this.tctx();
  if (!c) return;
  const sel = c.g.cells.filter(x => x.row >= c.rect.r1 && x.row <= c.rect.r2 && x.col >= c.rect.c1 && x.col <= c.rect.c2);
  for (const cl of sel) { const keep = cl.el.children.find(k => isEl(k) && k.name.local === "tcPr"); cl.el.children = keep ? [keep, mk("p")] : [mk("p")]; }
  this.finishTable(c.tbl, "hist.delete");
}

export function tableNavigate(this: DocxView, c: NonNullable<ReturnType<DocxView["tctx"]>>, dir: 1 | -1) {
  const { g, cell } = c;
  const order = g.cells.filter(x => x.vm !== "continue");
  const i = order.indexOf(cell) + dir;
  if (i >= 0 && i < order.length) { const p = this.firstParaIn(order[i].el); if (p) this.focusPara(p, 0, false); return; }
  if (dir === 1 && !this.readonly) {
    T.insertRow(c.tbl, g.rows.length - 1, "below");
    const g2 = buildGrid(c.tbl);
    const target = g2.map[g2.rows.length - 1]?.[0]?.el;
    this.finishTable(c.tbl, "hist.tblRow", target);
  }
}

export function setCellSel(this: DocxView, tbl: XEl, r: Rect) {
  const g = buildGrid(tbl);
  const rect = T.expandRect(g, r);
  this.cellSel = { tbl, ...rect };
  this.applyCellSelVisual();
  this.scheduleSelection();
}

export function clearCellSel(this: DocxView) { this.cellSel = null; this.applyCellSelVisual(); this.scheduleSelection(); }

export function applyCellSelVisual(this: DocxView) {
  this.pagesEl.querySelectorAll(".dx-sel").forEach(e => e.classList.remove("dx-sel"));
  if (!this.cellSel) return;
  const g = buildGrid(this.cellSel.tbl);
  const r = T.expandRect(g, this.cellSel);
  for (const cl of g.cells) {
    if (cl.vm === "continue" || cl.row < r.r1 || cl.row > r.r2 || cl.col < r.c1 || cl.col > r.c2) continue;
    this.reg.domOf.get(cl.el)?.classList.add("dx-sel");
  }
}

export function drawingParaEl(this: DocxView, el: HTMLElement) { return el.closest<HTMLElement>(".dx-p"); }
