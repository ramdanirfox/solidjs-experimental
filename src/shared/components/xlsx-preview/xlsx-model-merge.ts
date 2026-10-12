/** XlsxBook: xlsx-model-merge.ts — fungsi bagian dari kelas (`this: XlsxBook`), dipasang di kelas sebagai properti agar API publik tidak berubah. */
import { type Sel, normSel, addr, type EditRecord } from "./xlsx-model";
import type { XlsxBook } from "./xlsx-model";
import { mergeCells, unmergeCells, type Worksheet } from "@office-kit/xlsx/worksheet";
import { patchRawAnchor } from "./xlsx-model-shared";

export function mergeIndex(this: XlsxBook, ws: Worksheet) {
  let m = this.mergeMaps.get(ws);
  if (m && m.list === ws.mergedCells) return m;
  const anchors = new Map<number, any>(), covered = new Map<number, any>();
  for (const g of ws.mergedCells ?? []) {
    anchors.set(g.minRow * 16385 + g.minCol, g);
    if ((g.maxRow - g.minRow + 1) * (g.maxCol - g.minCol + 1) <= 100000) {
      for (let r = g.minRow; r <= g.maxRow; r++) for (let c = g.minCol; c <= g.maxCol; c++) if (r !== g.minRow || c !== g.minCol) covered.set(r * 16385 + c, g);
    }
  }
  m = { anchors, covered, list: ws.mergedCells };
  this.mergeMaps.set(ws, m);
  return m;
}

export function invalidateMerges(this: XlsxBook) { this.mergeMaps = new WeakMap(); this.invalidate(); }

export function invalidateDrawings(this: XlsxBook, ws: Worksheet) { this.drawings.delete(ws); }

export function mergeAt(this: XlsxBook, ws: Worksheet, r: number, c: number): { minRow: number; minCol: number; maxRow: number; maxCol: number } | undefined {
  if (!ws.mergedCells?.length) return undefined;
  const m = this.mergeIndex(ws);
  const k = r * 16385 + c;
  return m.covered.get(k) ?? m.anchors.get(k);
}

/** Perluas seleksi agar selalu mencakup seluruh merge yang beririsan (perilaku Excel). Orientasi anchor/focus dipertahankan. */
export function expandSel(this: XlsxBook, ws: Worksheet, sel: Sel): Sel {
  const list = ws.mergedCells;
  if (!list?.length) return sel;
  let n = normSel(sel);
  for (let guard = 0, changed = true; changed && guard < 50; guard++) {
    changed = false;
    for (const g of list) {
      if (g.maxRow < n.r1 || g.minRow > n.r2 || g.maxCol < n.c1 || g.minCol > n.c2) continue;
      if (g.minRow < n.r1 || g.maxRow > n.r2 || g.minCol < n.c1 || g.maxCol > n.c2) {
        n = { r1: Math.min(n.r1, g.minRow), c1: Math.min(n.c1, g.minCol), r2: Math.max(n.r2, g.maxRow), c2: Math.max(n.c2, g.maxCol) };
        changed = true;
      }
    }
  }
  const fr = sel.r1 <= sel.r2, fc = sel.c1 <= sel.c2;
  return { r1: fr ? n.r1 : n.r2, r2: fr ? n.r2 : n.r1, c1: fc ? n.c1 : n.c2, c2: fc ? n.c2 : n.c1 };
}

export function rangeStr(this: XlsxBook, g: { minRow: number; minCol: number; maxRow: number; maxCol: number }) {
  return `${addr(g.minRow, g.minCol)}:${addr(g.maxRow, g.maxCol)}`;
}

/** Gabungkan sel pada seleksi. Nilai selain sel kiri-atas dibuang (seperti Excel). */
export function mergeSelection(this: XlsxBook, ws: Worksheet, sel: Sel): { records: EditRecord[]; lost: number } | { error: string } {
  const n = normSel(this.expandSel(ws, sel));
  if (n.r1 === n.r2 && n.c1 === n.c2) return { error: "Pilih lebih dari satu sel untuk digabung" };
  const inner = (ws.mergedCells ?? []).filter(g => g.minRow >= n.r1 && g.maxRow <= n.r2 && g.minCol >= n.c1 && g.maxCol <= n.c2).map(g => ({ ...g }));
  if (inner.length === 1 && inner[0]!.minRow === n.r1 && inner[0]!.maxRow === n.r2 && inner[0]!.minCol === n.c1 && inner[0]!.maxCol === n.c2) return { error: "Rentang ini sudah digabung" };
  const records: EditRecord[] = [];
  let lost = 0;
  for (const [r, row] of ws.rows) {
    if (r < n.r1 || r > n.r2) continue;
    for (const [c, cell] of [...row.entries()]) {
      if (c < n.c1 || c > n.c2 || (r === n.r1 && c === n.c1) || cell.value === null) continue;
      records.push(this.setValueRaw(ws, r, c, null)); lost++;
    }
  }
  const target = this.rangeStr({ minRow: n.r1, minCol: n.c1, maxRow: n.r2, maxCol: n.c2 });
  const apply = () => { for (const g of inner) unmergeCells(ws, this.rangeStr(g)); mergeCells(ws, target); this.invalidateMerges(); };
  const revert = () => { unmergeCells(ws, target); for (const g of inner) mergeCells(ws, this.rangeStr(g)); this.invalidateMerges(); };
  apply();
  records.push({ sheet: ws.title, row: n.r1, col: n.c1, before: null, after: null, undo: revert, redo: apply });
  return { records, lost };
}

export function unmergeSelection(this: XlsxBook, ws: Worksheet, sel: Sel): { records: EditRecord[]; count: number } | { error: string } {
  const n = normSel(sel);
  const hit = (ws.mergedCells ?? []).filter(g => !(g.maxRow < n.r1 || g.minRow > n.r2 || g.maxCol < n.c1 || g.minCol > n.c2)).map(g => ({ ...g }));
  if (!hit.length) return { error: "Tidak ada sel gabungan pada seleksi" };
  const apply = () => { for (const g of hit) unmergeCells(ws, this.rangeStr(g)); this.invalidateMerges(); };
  const revert = () => { for (const g of hit) mergeCells(ws, this.rangeStr(g)); this.invalidateMerges(); };
  apply();
  return { records: [{ sheet: ws.title, row: n.r1, col: n.c1, before: null, after: null, undo: revert, redo: apply }], count: hit.length };
}

/** Gambar & shape (objek "unsupported" ber-raw) dapat dipindah/diubah ukurannya; grafik dipertahankan apa adanya. */
export function moveDrawing(this: XlsxBook, ws: Worksheet, index: number, anchor: any): EditRecord | undefined {
  const item: any = ws.drawing?.items[index];
  const isShape = item?.content.kind === "unsupported" && !!item.raw;
  if (!item || (item.content.kind !== "picture" && !isShape)) return undefined;
  const old = item.anchor;
  const oldRaw = item.raw;
  // Shape ditulis ulang verbatim dari raw, jadi posisi harus ditulis ke dalam raw itu sendiri.
  const set = (a: any) => { item.anchor = a; item.raw = isShape ? patchRawAnchor(oldRaw, a) : undefined; this.invalidateDrawings(ws); };
  set(anchor);
  return { sheet: ws.title, row: 0, col: 0, before: null, after: null, undo: () => { item.anchor = old; item.raw = oldRaw; this.invalidateDrawings(ws); }, redo: () => set(anchor) };
}
