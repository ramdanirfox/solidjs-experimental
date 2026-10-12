/** XlsxBook: xlsx-model-style.ts — fungsi bagian dari kelas (`this: XlsxBook`), dipasang di kelas sebagai properti agar API publik tidak berubah. */
import { type Sel, type EditRecord, normSel } from "./xlsx-model";
import type { XlsxBook } from "./xlsx-model";
import { ensureCell, type Worksheet } from "@office-kit/xlsx/worksheet";

/** Format painter: salin styleId ke seluruh rentang. */
export function applyStyleId(this: XlsxBook, ws: Worksheet, sel: Sel, styleId: number): EditRecord[] {
  const n = normSel(sel);
  const recs: EditRecord[] = [];
  if ((n.r2 - n.r1 + 1) * (n.c2 - n.c1 + 1) > 60000) return recs;
  for (let r = n.r1; r <= n.r2; r++) for (let c = n.c1; c <= n.c2; c++) {
    const cell = ws.rows.get(r)?.get(c);
    if ((cell?.styleId ?? 0) === styleId) continue;
    const before = this.snap(cell);
    const t = cell ?? ensureCell(ws, r, c);
    t.styleId = styleId;
    recs.push({ sheet: ws.title, row: r, col: c, before, after: this.snap(t) });
  }
  return recs;
}

export function undo(this: XlsxBook): EditRecord[] | undefined { return this.step(this.undoStack, this.redoStack, "before"); }

export function redo(this: XlsxBook): EditRecord[] | undefined { return this.step(this.redoStack, this.undoStack, "after"); }

export function step(this: XlsxBook, from: EditRecord[][], to: EditRecord[][], side: "before" | "after"): EditRecord[] | undefined {
  const recs = from.pop();
  if (!recs) return undefined;
  for (const rec of [...recs].reverse()) {
    const custom = side === "before" ? rec.undo : rec.redo;
    if (custom) { custom(); continue; }
    const ws = this.findSheet(rec.sheet);
    if (ws) this.writeSnap(ws, rec.row, rec.col, rec[side]);
  }
  to.push(recs);
  this.dirty = true;
  this.invalidate();
  return recs;
}

export function nameScopes(this: XlsxBook) { return this.wb.definedNames.map(n => ({ n, scope: n.scope })); }
