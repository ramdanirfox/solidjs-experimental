/** XlsxBook: xlsx-model-drawings.ts — fungsi bagian dari kelas (`this: XlsxBook`), dipasang di kelas sebagai properti agar API publik tidak berubah. */
import { type EditRecord, addr, type FilterState, parseAddress } from "./xlsx-model";
import type { XlsxBook } from "./xlsx-model";
import { addImageAt, loadImage } from "@office-kit/xlsx/drawing";
import { setRowDimension, type Worksheet } from "@office-kit/xlsx/worksheet";

export function deleteDrawing(this: XlsxBook, ws: Worksheet, index: number): EditRecord | undefined {
  const items: any[] | undefined = ws.drawing?.items;
  const item = items?.[index];
  if (!items || !item || (item.content.kind !== "picture" && !(item.content.kind === "unsupported" && item.raw))) return undefined;
  items.splice(index, 1);
  this.invalidateDrawings(ws);
  return {
    sheet: ws.title, row: 0, col: 0, before: null, after: null,
    undo: () => { items.splice(Math.min(index, items.length), 0, item); this.invalidateDrawings(ws); },
    redo: () => { const i = items.indexOf(item); if (i >= 0) items.splice(i, 1); this.invalidateDrawings(ws); },
  };
}

export function insertImage(this: XlsxBook, ws: Worksheet, bytes: Uint8Array, row: number, col: number): { record: EditRecord; index: number; width: number; height: number } {
  const img = loadImage(bytes);
  let w = img.width || 240, h = img.height || 160;
  const max = 480;
  if (w > max) { h = (h * max) / w; w = max; }
  const item: any = addImageAt(ws, addr(row, col), img, { widthPx: Math.max(8, Math.round(w)), heightPx: Math.max(8, Math.round(h)) });
  const items: any[] = ws.drawing!.items;
  const index = items.indexOf(item);
  this.invalidateDrawings(ws);
  return {
    index, width: Math.round(w), height: Math.round(h),
    record: {
      sheet: ws.title, row, col, before: null, after: null,
      undo: () => { const i = items.indexOf(item); if (i >= 0) items.splice(i, 1); this.invalidateDrawings(ws); },
      redo: () => { if (!items.includes(item)) items.splice(Math.min(index, items.length), 0, item); this.invalidateDrawings(ws); },
    },
  };
}

export function filterOf(this: XlsxBook, ws: Worksheet): FilterState | undefined {
  if (this.filters.has(ws)) return this.filters.get(ws) ?? undefined;
  const af = ws.autoFilter ?? ws.tables?.find(t => t.autoFilter)?.autoFilter ?? undefined;
  const ref = af?.ref ?? ws.tables?.[0]?.ref;
  let st: FilterState | null = null;
  if (ref && (ws.autoFilter || ws.tables?.length)) {
    const b = parseAddress(ref);
    if (b) {
      st = { range: { minRow: b.r1, minCol: b.c1, maxRow: b.r2, maxCol: b.c2 }, selected: new Map(), hiddenRows: new Set(), written: new Set(), touched: false };
      for (const fc of af?.filterColumns ?? []) {
        if ((fc as any).kind === "filters") {
          const vals = new Set<string>((fc as any).values as string[]);
          if ((fc as any).blank) vals.add("");
          st.selected.set(b.c1 + fc.colId, vals);
        }
      }
      if (st.selected.size) {
        // filter aktif dari file: atribut hidden pada baris data adalah hasil filter -> dihitung ulang oleh model
        for (let r = b.r1 + 1; r <= b.r2; r++) { const d = ws.rowDimensions.get(r); if (d?.hidden) st.written.add(r); }
        this.recomputeFilter(ws, st);
        for (const r of st.written) setRowDimension(ws, r, { hidden: false });
      }
    }
  }
  this.filters.set(ws, st);
  return st ?? undefined;
}
