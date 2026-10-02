/**
 * Operasi tabel pada XML `<w:tbl>` lewat model grid (kolom logis): sisip/hapus baris & kolom, gabung/pisah sel
 * (gridSpan + vMerge), ubah lebar kolom/tinggi baris, shading, border, dan properti tabel.
 */
import { flatLength } from "./docx-text";
import { attr, cloneEl, els, ensureProps, first, insertAfter, isEl, mk, num, pruneProps, removeKids, removeNode, setAttr, setChild, val, type XEl, type XNode } from "./docx-xml";

export interface GCell {
  el: XEl;
  row: number;
  col: number;
  colspan: number;
  rowspan: number;
  vm: "none" | "restart" | "continue";
  /** Sel asal (restart) untuk sel `continue`. */
  origin: GCell;
}
export interface Grid {
  tbl: XEl;
  rows: XEl[];
  ncols: number;
  cells: GCell[];
  map: (GCell | undefined)[][];
}

export const MIN_COL = 240; // twips

export function buildGrid(tbl: XEl): Grid {
  const rows = els(tbl, "tr");
  const cells: GCell[] = [];
  const map: (GCell | undefined)[][] = rows.map(() => []);
  let ncols = els(first(tbl, "tblGrid") ?? mk("tblGrid"), "gridCol").length;
  rows.forEach((tr, r) => {
    let c = num(val(first(tr, "trPr"), "gridBefore")) ?? 0;
    for (const tc of els(tr, "tc")) {
      const tcPr = first(tc, "tcPr");
      const span = Math.max(1, num(val(tcPr, "gridSpan")) ?? 1);
      const vmEl = first(tcPr, "vMerge");
      const vm: GCell["vm"] = !vmEl ? "none" : attr(vmEl, "val") === "restart" ? "restart" : "continue";
      const cell = { el: tc, row: r, col: c, colspan: span, rowspan: 1, vm } as GCell;
      cell.origin = cell;
      if (vm === "continue" && r > 0) {
        const above = map[r - 1][c];
        if (above) { cell.origin = above.origin; above.origin.rowspan++; }
      }
      cells.push(cell);
      for (let k = 0; k < span; k++) map[r][c + k] = cell;
      c += span;
    }
    ncols = Math.max(ncols, c);
  });
  return { tbl, rows, ncols, cells, map };
}

export const cellParagraphs = (tc: XEl) => els(tc, "p");
export function newEmptyPara(ref?: XEl): XEl {
  const p = mk("p");
  const refP = ref ? first(ref, "p") : undefined;
  const pPr = refP ? first(refP, "pPr") : undefined;
  if (pPr) {
    const c = cloneEl(pPr);
    removeKids(c, "numPr"); removeKids(c, "sectPr");
    p.children.push(c);
    p.selfClosing = false;
  }
  return p;
}

// ───────── lebar ─────────

export function gridWidths(g: Grid): number[] {
  const gc = els(first(g.tbl, "tblGrid") ?? mk("tblGrid"), "gridCol").map(x => num(attr(x, "w")) ?? 0);
  if (gc.length === g.ncols && gc.every(w => w > 0)) return gc;
  // rekonstruksi dari tcW sel tanpa span
  const w: number[] = new Array(g.ncols).fill(0);
  for (const c of g.cells) {
    const tw = num(attr(first(first(c.el, "tcPr"), "tcW"), "w"));
    if (tw && c.colspan === 1 && !w[c.col]) w[c.col] = tw;
  }
  const known = w.filter(x => x > 0);
  const avg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 9000 / Math.max(1, g.ncols);
  return w.map(x => x || Math.round(avg));
}

export function writeWidths(g: Grid, widths: number[]) {
  let grid = first(g.tbl, "tblGrid");
  if (!grid) { grid = mk("tblGrid"); const i = g.tbl.children.findIndex(c => isEl(c) && c.name.local === "tr"); g.tbl.children.splice(i < 0 ? g.tbl.children.length : i, 0, grid); }
  grid.children = widths.map(w => mk("gridCol", { w: Math.round(w) }));
  grid.selfClosing = grid.children.length === 0;
  for (const c of g.cells) {
    let sum = 0;
    for (let k = 0; k < c.colspan; k++) sum += widths[c.col + k] ?? 0;
    const tcPr = ensureProps(c.el, "tcPr");
    setChild(tcPr, mk("tcW", { w: Math.round(sum), type: "dxa" }));
  }
}
function syncTableWidth(g: Grid, widths: number[]) {
  const tblPr = ensureProps(g.tbl, "tblPr");
  const tw = first(tblPr, "tblW");
  if (!tw || attr(tw, "type") === "dxa" || attr(tw, "type") === "auto" || !attr(tw, "type")) {
    setChild(tblPr, mk("tblW", { w: Math.round(widths.reduce((a, b) => a + b, 0)), type: "dxa" }));
  }
}

// ───────── pembuatan ─────────

export interface NewTableOpts { rows: number; cols: number; widthTwips: number; styleId?: string; borders?: boolean; header?: boolean }
export function createTable(o: NewTableOpts): XEl {
  const cw = Math.floor(o.widthTwips / o.cols);
  const b = (n: string) => mk(n, { val: "single", sz: 4, space: 0, color: "auto" });
  const tblPr = mk("tblPr", undefined, [
    ...(o.styleId ? [mk("tblStyle", { val: o.styleId })] : []),
    mk("tblW", { w: cw * o.cols, type: "dxa" }),
    ...(o.borders !== false && !o.styleId ? [mk("tblBorders", undefined, ["top", "left", "bottom", "right", "insideH", "insideV"].map(b))] : []),
    mk("tblLayout", { type: "fixed" }),
    mk("tblLook", { val: "04A0", firstRow: 1, lastRow: 0, firstColumn: 1, lastColumn: 0, noHBand: 0, noVBand: 1 }),
  ]);
  const grid = mk("tblGrid", undefined, Array.from({ length: o.cols }, () => mk("gridCol", { w: cw })));
  const rows: XNode[] = [];
  for (let r = 0; r < o.rows; r++) {
    const cells = Array.from({ length: o.cols }, () => mk("tc", undefined, [mk("tcPr", undefined, [mk("tcW", { w: cw, type: "dxa" })]), mk("p")]));
    const trPr = r === 0 && o.header ? mk("trPr", undefined, [mk("tblHeader")]) : undefined;
    rows.push(mk("tr", undefined, trPr ? [trPr, ...cells] : cells));
  }
  return mk("tbl", undefined, [tblPr, grid, ...rows]);
}

// ───────── baris ─────────

function cloneCellStructure(src: GCell | undefined, widths: number[], col: number, span: number, vm: "none" | "continue"): XEl {
  const tcPr = src ? cloneEl(first(src.el, "tcPr") ?? mk("tcPr")) : mk("tcPr");
  removeKids(tcPr, "vMerge"); removeKids(tcPr, "gridSpan");
  let sum = 0; for (let k = 0; k < span; k++) sum += widths[col + k] ?? 0;
  setChild(tcPr, mk("tcW", { w: Math.round(sum), type: "dxa" }));
  if (span > 1) setChild(tcPr, mk("gridSpan", { val: span }));
  if (vm === "continue") setChild(tcPr, mk("vMerge"));
  return mk("tc", undefined, [tcPr, newEmptyPara(src?.el)]);
}

export function insertRow(tbl: XEl, rowIdx: number, where: "above" | "below"): XEl | undefined {
  const g = buildGrid(tbl);
  const ref = g.rows[rowIdx];
  if (!ref) return undefined;
  const L = where === "above" ? rowIdx : rowIdx + 1;
  const widths = gridWidths(g);
  const cells: XNode[] = [];
  const seen = new Set<GCell>();
  for (let c = 0; c < g.ncols; c++) {
    const cur = g.map[rowIdx][c];
    if (!cur || seen.has(cur)) continue;
    seen.add(cur);
    const below = g.map[L]?.[c];
    const above = g.map[L - 1]?.[c];
    const crossing = !!below && !!above && below.vm === "continue" && below.origin === above.origin;
    cells.push(cloneCellStructure(cur, widths, cur.col, cur.colspan, crossing ? "continue" : "none"));
  }
  const trPr = first(ref, "trPr");
  const tr = mk("tr", undefined, cells);
  if (trPr) { const c = cloneEl(trPr); removeKids(c, "tblHeader"); removeKids(c, "gridBefore"); removeKids(c, "gridAfter"); if (c.children.length) tr.children.unshift(c); }
  const at = g.rows[L];
  if (at) tbl.children.splice(tbl.children.indexOf(at), 0, tr);
  else insertAfter(tbl, g.rows[g.rows.length - 1], tr);
  return tr;
}

/** Hapus baris r1..r2 (inklusif). Mengembalikan true bila seluruh tabel terhapus. */
export function deleteRows(tbl: XEl, r1: number, r2: number): "table" | "ok" {
  const g = buildGrid(tbl);
  r1 = Math.max(0, r1); r2 = Math.min(g.rows.length - 1, r2);
  if (r1 === 0 && r2 === g.rows.length - 1) return "table";
  for (const c of g.cells) {
    if (c.vm !== "restart" || c.row < r1 || c.row > r2) continue;
    // origin merge vertikal dihapus: serahkan ke sel `continue` pertama di baris tersisa
    const lastRow = c.row + c.rowspan - 1;
    if (lastRow > r2) {
      const heir = g.map[r2 + 1]?.[c.col];
      if (heir && heir.vm === "continue") {
        const content = els(c.el, "p");
        const hp = ensureProps(heir.el, "tcPr");
        if (c.rowspan - (r2 - c.row + 1) > 1) setChild(hp, mk("vMerge", { val: "restart" }));
        else setChild(hp, null, "vMerge");
        heir.el.children = heir.el.children.filter(k => !(isEl(k) && k.name.local === "p"));
        heir.el.children.push(...content.map(p => cloneEl(p)));
        if (!content.length) heir.el.children.push(mk("p"));
      }
    }
  }
  for (let r = r2; r >= r1; r--) removeNode(tbl, g.rows[r]);
  return "ok";
}

// ───────── kolom ─────────

export function insertCol(tbl: XEl, col: number, where: "left" | "right"): boolean {
  const g = buildGrid(tbl);
  const refCell = (r: number) => g.map[r][col];
  const C = where === "left" ? col : col + 1;
  const widths = gridWidths(g);
  const newW = widths[col] ?? 1000;
  g.rows.forEach((tr, r) => {
    const at = g.map[r][C];
    const before = C > 0 ? g.map[r][C - 1] : undefined;
    if (at && before && at === before) { // garis memotong sel yang membentang
      const tcPr = ensureProps(at.el, "tcPr");
      setChild(tcPr, mk("gridSpan", { val: at.colspan + 1 }));
      return;
    }
    const ref = refCell(r);
    const vm: "none" | "continue" = ref?.vm === "continue" ? "continue" : "none";
    const nw = [...widths]; nw.splice(C, 0, newW);
    const tc = cloneCellStructure(ref, nw, C, 1, vm);
    if (at) tr.children.splice(tr.children.indexOf(at.el), 0, tc);
    else { const last = els(tr, "tc").pop(); if (last) insertAfter(tr, last, tc); else tr.children.push(tc); }
  });
  widths.splice(C, 0, newW);
  const g2 = buildGrid(tbl);
  writeWidths(g2, widths);
  syncTableWidth(g2, widths);
  return true;
}

export function deleteCols(tbl: XEl, c1: number, c2: number): "table" | "ok" {
  const g = buildGrid(tbl);
  c1 = Math.max(0, c1); c2 = Math.min(g.ncols - 1, c2);
  if (c1 === 0 && c2 === g.ncols - 1) return "table";
  const widths = gridWidths(g);
  for (const c of g.cells) {
    const a = Math.max(c.col, c1), b = Math.min(c.col + c.colspan - 1, c2);
    if (a > b) continue;
    const overlap = b - a + 1;
    if (overlap >= c.colspan) {
      const tr = g.rows[c.row];
      removeNode(tr, c.el);
    } else {
      const tcPr = ensureProps(c.el, "tcPr");
      const ns = c.colspan - overlap;
      setChild(tcPr, ns > 1 ? mk("gridSpan", { val: ns }) : null, "gridSpan");
    }
  }
  widths.splice(c1, c2 - c1 + 1);
  const g2 = buildGrid(tbl);
  writeWidths(g2, widths);
  syncTableWidth(g2, widths);
  return "ok";
}

// ───────── gabung & pisah ─────────

export interface Rect { r1: number; c1: number; r2: number; c2: number }
export function normRect(a: Rect): Rect { return { r1: Math.min(a.r1, a.r2), r2: Math.max(a.r1, a.r2), c1: Math.min(a.c1, a.c2), c2: Math.max(a.c1, a.c2) }; }

/** Perluas rect agar tidak memotong sel gabungan. */
export function expandRect(g: Grid, rect: Rect): Rect {
  let { r1, c1, r2, c2 } = normRect(rect);
  r2 = Math.min(r2, g.rows.length - 1); c2 = Math.min(c2, g.ncols - 1);
  for (let changed = true; changed;) {
    changed = false;
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
      const cell = g.map[r][c];
      if (!cell) continue;
      const o = cell.origin;
      const nr1 = Math.min(r1, o.row), nr2 = Math.max(r2, o.row + o.rowspan - 1);
      const nc1 = Math.min(c1, o.col), nc2 = Math.max(c2, o.col + o.colspan - 1);
      if (nr1 !== r1 || nr2 !== r2 || nc1 !== c1 || nc2 !== c2) { r1 = nr1; r2 = nr2; c1 = nc1; c2 = nc2; changed = true; }
    }
  }
  return { r1, c1, r2, c2 };
}

const hasContent = (tc: XEl) => els(tc, "p").some(p => flatLength(p) > 0) || els(tc, "tbl").length > 0;

export function mergeCells(tbl: XEl, rectIn: Rect): XEl | undefined {
  const g = buildGrid(tbl);
  const rect = expandRect(g, rectIn);
  const { r1, c1, r2, c2 } = rect;
  if (r1 === r2 && c1 === c2) return undefined;
  const widths = gridWidths(g);
  const originCell = g.map[r1][c1]!.origin;
  const keep = originCell.el;
  // kumpulkan isi (urut baris→kolom)
  const content: XNode[] = [];
  const seen = new Set<XEl>();
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
    const cell = g.map[r][c]?.origin;
    if (!cell || seen.has(cell.el)) continue;
    seen.add(cell.el);
    if (cell.el === keep) continue;
    if (hasContent(cell.el)) for (const k of cell.el.children) if (isEl(k) && k.name.local !== "tcPr") content.push(k);
  }
  const keepKids = keep.children.filter(k => !(isEl(k) && k.name.local === "tcPr"));
  const keepHas = hasContent(keep);
  keep.children = [first(keep, "tcPr")!, ...(keepHas ? keepKids : []), ...content].filter(Boolean) as XNode[];
  if (!keep.children.some(k => isEl(k) && (k.name.local === "p" || k.name.local === "tbl"))) keep.children.push(mk("p"));
  // sekarang susun ulang struktur tiap baris
  for (let r = r1; r <= r2; r++) {
    const tr = g.rows[r];
    const inRect = new Set<XEl>();
    for (let c = c1; c <= c2; c++) { const cell = g.map[r][c]; if (cell) inRect.add(cell.el); }
    const first0 = g.map[r][c1]!;
    // sel pertama baris ini: pertahankan (di baris r1 = origin)
    const holder = r === r1 ? keep : first0.el;
    for (const el of inRect) if (el !== holder) removeNode(tr, el);
    const tcPr = ensureProps(holder, "tcPr");
    let sum = 0; for (let c = c1; c <= c2; c++) sum += widths[c] ?? 0;
    setChild(tcPr, mk("tcW", { w: Math.round(sum), type: "dxa" }));
    setChild(tcPr, c2 > c1 ? mk("gridSpan", { val: c2 - c1 + 1 }) : null, "gridSpan");
    if (r2 > r1) setChild(tcPr, r === r1 ? mk("vMerge", { val: "restart" }) : mk("vMerge"));
    else setChild(tcPr, null, "vMerge");
    if (r !== r1) {
      holder.children = [tcPr, mk("p")];
    }
  }
  return keep;
}

/** Pisahkan sel gabungan; bila tidak digabung dan `cols>1`, belah kolom grid. */
export function splitCell(tbl: XEl, row: number, col: number, cols = 2): XEl | undefined {
  let g = buildGrid(tbl);
  const cell = g.map[row]?.[col]?.origin;
  if (!cell) return undefined;
  const widths = gridWidths(g);
  if (cell.colspan > 1 || cell.rowspan > 1) {
    // pisah vertikal
    if (cell.rowspan > 1) {
      for (let r = cell.row; r < cell.row + cell.rowspan; r++) {
        const m = g.map[r][cell.col];
        if (!m) continue;
        setChild(ensureProps(m.el, "tcPr"), null, "vMerge");
        pruneProps(m.el, "tcPr");
      }
    }
    // pisah horizontal
    if (cell.colspan > 1) {
      for (let r = cell.row; r < cell.row + cell.rowspan; r++) {
        const m = g.map[r][cell.col];
        if (!m) continue;
        const tr = g.rows[r];
        const vm: "none" | "continue" = "none";
        const adds: XEl[] = [];
        for (let k = 1; k < cell.colspan; k++) adds.push(cloneCellStructure(m, widths, cell.col + k, 1, vm));
        const tcPr = ensureProps(m.el, "tcPr");
        setChild(tcPr, null, "gridSpan");
        setChild(tcPr, mk("tcW", { w: Math.round(widths[cell.col] ?? 0), type: "dxa" }));
        let prev: XNode = m.el;
        for (const a of adds) { insertAfter(tr, prev, a); prev = a; }
      }
    }
    return cell.el;
  }
  // belah kolom grid
  const n = Math.max(2, cols);
  const w = widths[col];
  const part = Math.max(MIN_COL / 2, Math.floor(w / n));
  const nw = [...widths]; nw.splice(col, 1, ...Array.from({ length: n }, () => part));
  g.rows.forEach((tr, r) => {
    const m = g.map[r][col];
    if (!m) return;
    if (m.el === cell.el) {
      let prev: XNode = m.el;
      for (let k = 1; k < n; k++) { const add = cloneCellStructure(m, nw, col + k, 1, "none"); insertAfter(tr, prev, add); prev = add; }
    } else {
      const tcPr = ensureProps(m.el, "tcPr");
      setChild(tcPr, mk("gridSpan", { val: m.colspan + n - 1 }));
    }
  });
  g = buildGrid(tbl);
  writeWidths(g, nw);
  return cell.el;
}

// ───────── dimensi ─────────

export function resizeColumn(tbl: XEl, col: number, deltaTwips: number): number[] {
  const g = buildGrid(tbl);
  const widths = gridWidths(g);
  let d = deltaTwips;
  if (widths[col] + d < MIN_COL) d = MIN_COL - widths[col];
  if (col + 1 < widths.length) {
    if (widths[col + 1] - d < MIN_COL) d = widths[col + 1] - MIN_COL;
    widths[col] += d; widths[col + 1] -= d;
  } else widths[col] += d;
  writeWidths(g, widths);
  syncTableWidth(g, widths);
  const tblPr = ensureProps(tbl, "tblPr");
  setChild(tblPr, mk("tblLayout", { type: "fixed" }));
  return widths;
}

export function setTableWidths(tbl: XEl, widths: number[]) {
  const g = buildGrid(tbl);
  writeWidths(g, widths);
  syncTableWidth(g, widths);
}

export function distributeColumns(tbl: XEl, c1: number, c2: number) {
  const g = buildGrid(tbl);
  const w = gridWidths(g);
  const total = w.slice(c1, c2 + 1).reduce((a, b) => a + b, 0);
  const each = Math.floor(total / (c2 - c1 + 1));
  for (let c = c1; c <= c2; c++) w[c] = each;
  writeWidths(g, w);
  syncTableWidth(g, w);
}

export function setRowHeight(tr: XEl, twips: number | null, rule: "atLeast" | "exact" = "atLeast") {
  const trPr = ensureProps(tr, "trPr");
  setChild(trPr, twips === null ? null : mk("trHeight", { val: Math.round(twips), hRule: rule }), "trHeight");
  pruneProps(tr, "trPr");
}
export function setHeaderRow(tr: XEl, on: boolean) {
  const trPr = ensureProps(tr, "trPr");
  setChild(trPr, on ? mk("tblHeader") : null, "tblHeader");
  pruneProps(tr, "trPr");
}

// ───────── sel & tabel: properti ─────────

export function setCellShading(tc: XEl, fill: string | null) {
  const tcPr = ensureProps(tc, "tcPr");
  setChild(tcPr, fill === null ? null : mk("shd", { val: "clear", color: "auto", fill: fill.replace("#", "").toUpperCase() }), "shd");
  pruneProps(tc, "tcPr");
}
export function setCellVAlign(tc: XEl, v: "top" | "center" | "bottom" | null) {
  const tcPr = ensureProps(tc, "tcPr");
  setChild(tcPr, v === null ? null : mk("vAlign", { val: v }), "vAlign");
  pruneProps(tc, "tcPr");
}
export function setCellMargins(tc: XEl, m: { top?: number; left?: number; bottom?: number; right?: number } | null) {
  const tcPr = ensureProps(tc, "tcPr");
  if (!m) setChild(tcPr, null, "tcMar");
  else setChild(tcPr, mk("tcMar", undefined, (["top", "left", "bottom", "right"] as const).filter(k => m[k] !== undefined).map(k => mk(k, { w: Math.round(m[k]!), type: "dxa" }))));
  pruneProps(tc, "tcPr");
}
export function setCellNoWrap(tc: XEl, on: boolean) {
  const tcPr = ensureProps(tc, "tcPr");
  setChild(tcPr, on ? mk("noWrap") : null, "noWrap");
  pruneProps(tc, "tcPr");
}
export function setCellDirection(tc: XEl, dir: "lrTb" | "btLr" | "tbRl") {
  const tcPr = ensureProps(tc, "tcPr");
  setChild(tcPr, dir === "lrTb" ? null : mk("textDirection", { val: dir }), "textDirection");
  pruneProps(tc, "tcPr");
}

export interface BorderSpec { style: string; sz: number; color: string }
export type BorderSide = "top" | "left" | "bottom" | "right" | "insideH" | "insideV";
export function bEl(side: string, s: BorderSpec | null): XEl {
  return s && s.style !== "none" ? mk(side, { val: s.style, sz: s.sz, space: 0, color: s.color.replace("#", "").toUpperCase() || "auto" }) : mk(side, { val: "nil" });
}
/** Border sel (atas/kiri/bawah/kanan) — `null` menghapus garis. */
export function setCellBorders(tc: XEl, sides: BorderSide[], spec: BorderSpec | null) {
  const tcPr = ensureProps(tc, "tcPr");
  const cur = first(tcPr, "tcBorders") ?? mk("tcBorders");
  for (const s of sides) setChild(cur, bEl(s, spec));
  setChild(tcPr, cur);
}
export function setTableBorders(tbl: XEl, sides: BorderSide[], spec: BorderSpec | null) {
  const tblPr = ensureProps(tbl, "tblPr");
  const cur = first(tblPr, "tblBorders") ?? mk("tblBorders");
  for (const s of sides) setChild(cur, bEl(s, spec));
  setChild(tblPr, cur);
}
/** Hapus override border tingkat sel agar border tabel berlaku. */
export function clearCellBorders(tbl: XEl) {
  for (const tc of els(tbl, "tr").flatMap(tr => els(tr, "tc"))) { const tcPr = first(tc, "tcPr"); if (tcPr) { setChild(tcPr, null, "tcBorders"); pruneProps(tc, "tcPr"); } }
}

export function setTableAlign(tbl: XEl, jc: "left" | "center" | "right") {
  const tblPr = ensureProps(tbl, "tblPr");
  setChild(tblPr, jc === "left" ? null : mk("jc", { val: jc }), "jc");
}
export function setTableStyle(tbl: XEl, id: string | null) {
  const tblPr = ensureProps(tbl, "tblPr");
  setChild(tblPr, id ? mk("tblStyle", { val: id }) : null, "tblStyle");
}
export function setTableLook(tbl: XEl, look: Partial<{ firstRow: boolean; lastRow: boolean; firstColumn: boolean; lastColumn: boolean; noHBand: boolean; noVBand: boolean }>) {
  const tblPr = ensureProps(tbl, "tblPr");
  const old = first(tblPr, "tblLook");
  const cur: Record<string, boolean> = { firstRow: true, lastRow: false, firstColumn: true, lastColumn: false, noHBand: false, noVBand: true };
  if (old) for (const k of Object.keys(cur)) { const a = attr(old, k); if (a !== undefined) cur[k] = a === "1" || a === "true"; }
  Object.assign(cur, look);
  const bits = (cur.firstRow ? 0x20 : 0) | (cur.lastRow ? 0x40 : 0) | (cur.firstColumn ? 0x80 : 0) | (cur.lastColumn ? 0x100 : 0) | (cur.noHBand ? 0x200 : 0) | (cur.noVBand ? 0x400 : 0);
  setChild(tblPr, mk("tblLook", { val: bits.toString(16).toUpperCase().padStart(4, "0"), firstRow: +cur.firstRow, lastRow: +cur.lastRow, firstColumn: +cur.firstColumn, lastColumn: +cur.lastColumn, noHBand: +cur.noHBand, noVBand: +cur.noVBand }));
}
export function setTableLayout(tbl: XEl, fixed: boolean) {
  const tblPr = ensureProps(tbl, "tblPr");
  setChild(tblPr, fixed ? mk("tblLayout", { type: "fixed" }) : null, "tblLayout");
}
export function setTableWidthMode(tbl: XEl, mode: "auto" | "pct" | "dxa", value?: number) {
  const tblPr = ensureProps(tbl, "tblPr");
  if (mode === "auto") setChild(tblPr, mk("tblW", { w: 0, type: "auto" }));
  else if (mode === "pct") setChild(tblPr, mk("tblW", { w: Math.round((value ?? 100) * 50), type: "pct" }));
  else setChild(tblPr, mk("tblW", { w: Math.round(value ?? 9000), type: "dxa" }));
}
export function setTableCaption(tbl: XEl, title?: string, desc?: string) {
  const tblPr = ensureProps(tbl, "tblPr");
  setChild(tblPr, title ? mk("tblCaption", { val: title }) : null, "tblCaption");
  setChild(tblPr, desc ? mk("tblDescription", { val: desc }) : null, "tblDescription");
}

/** Matriks teks tabel (untuk ekspor). */
export function tableMatrix(tbl: XEl, textOfCell: (tc: XEl) => string): string[][] {
  const g = buildGrid(tbl);
  return g.rows.map((tr, r) => {
    const row: string[] = [];
    for (let c = 0; c < g.ncols; c++) {
      const cell = g.map[r][c];
      row.push(cell && cell.col === c && cell.vm !== "continue" ? textOfCell(cell.el) : "");
    }
    return row;
  });
}

export function tablePosition(g: Grid, tc: XEl): GCell | undefined { return g.cells.find(c => c.el === tc); }
export { setAttr };
