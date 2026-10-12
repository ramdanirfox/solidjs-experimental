/** XlsxBook: xlsx-model-sheets.ts — fungsi bagian dari kelas (`this: XlsxBook`), dipasang di kelas sebagai properti agar API publik tidak berubah. */
import { type EditRecord, rewriteSheetRefs, type DrawingView } from "./xlsx-model";
import type { XlsxBook } from "./xlsx-model";
import { addWorksheet, moveSheet, removeSheet, renameSheet, setSheetState, type SheetRef } from "@office-kit/xlsx/workbook";
import { setFreezePanes, setColumnWidth, setRowHeight, type Worksheet } from "@office-kit/xlsx/worksheet";
import { makeFormula, type Cell, type CellValue } from "@office-kit/xlsx/cell";
import { anchorCell } from "./xlsx-layout";
import { oleAnchorToDrawing } from "./xlsx-ole";
import { parseShapeGroup, schemeLookup, shapePlainText } from "./xlsx-shapes";
import { collectText, IMG_MIME } from "./xlsx-model-shared";

export function restoreNames(this: XlsxBook, saved: { n: { scope?: number }; scope: number | undefined }[]) { this.wb.definedNames = saved.map(x => { x.n.scope = x.scope; return x.n as never; }); }

export function shiftNames(this: XlsxBook, from: number, d: number) { for (const n of this.wb.definedNames) if (n.scope !== undefined && n.scope >= from) n.scope += d; }

export function sheetRec(this: XlsxBook, sheet: string, apply: () => void, revert: () => void): EditRecord {
  return { sheet, row: 0, col: 0, before: null, after: null, undo: revert, redo: apply };
}

export function validTitle(this: XlsxBook, t: string, except?: string): string | undefined {
  const name = t.trim();
  if (!name) return "Nama sheet kosong";
  if (name.length > 31) return "Nama sheet maksimal 31 karakter";
  if (/[\\/?*[\]:]/.test(name)) return "Nama sheet tidak boleh memuat \\ / ? * [ ] :";
  if (name.startsWith("'") || name.endsWith("'")) return "Nama sheet tidak boleh diawali/diakhiri apostrof";
  if (this.wb.sheets.some(s => s.sheet.title.toLowerCase() === name.toLowerCase() && s.sheet.title !== except)) return `Sheet "${name}" sudah ada`;
  return undefined;
}

/** Tambah worksheet kosong. `title` default "SheetN". */
export function addSheet(this: XlsxBook, title?: string, index?: number): { records: EditRecord[]; title: string } | { error: string } {
  let name = title?.trim();
  if (!name) { let n = this.wb.sheets.length + 1; while (this.wb.sheets.some(s => s.sheet.title === `Sheet${n}`)) n++; name = `Sheet${n}`; }
  const err = this.validTitle(name);
  if (err) return { error: err };
  const at = index === undefined ? this.wb.sheets.length : Math.max(0, Math.min(this.wb.sheets.length, Math.floor(index)));
  let ref: SheetRef | undefined;
  const apply = () => {
    if (!ref) { addWorksheet(this.wb, name!, { index: at }); ref = this.wb.sheets[at]; }
    else this.wb.sheets.splice(at, 0, ref);
    this.shiftNames(at, 1);
  };
  const revert = () => removeSheet(this.wb, name!);
  apply();
  return { records: [this.sheetRec(name, apply, revert)], title: name };
}

/** Ganti nama sheet; referensi `Nama!A1` pada rumus ikut diperbarui. */
export function renameSheetTo(this: XlsxBook, oldTitle: string, newTitle: string): { records: EditRecord[]; formulas: number } | { error: string } {
  const nt = newTitle.trim();
  if (!this.wb.sheets.some(s => s.sheet.title === oldTitle)) return { error: `Sheet "${oldTitle}" tidak ditemukan` };
  if (nt === oldTitle) return { records: [], formulas: 0 };
  const err = this.validTitle(nt, oldTitle);
  if (err) return { error: err };
  const edits: { cell: Cell; before: CellValue; after: CellValue }[] = [];
  for (const s of this.wb.sheets) {
    if (s.kind !== "worksheet") continue;
    for (const row of s.sheet.rows.values()) for (const cell of row.values()) {
      const v = cell.value as any;
      if (v && typeof v === "object" && v.kind === "formula" && typeof v.formula === "string") {
        const f = rewriteSheetRefs(v.formula, oldTitle, nt);
        if (f !== v.formula) edits.push({ cell, before: cell.value, after: makeFormula(f) });
      }
    }
  }
  const apply = () => { renameSheet(this.wb, oldTitle, nt); for (const e of edits) e.cell.value = e.after; };
  const revert = () => { renameSheet(this.wb, nt, oldTitle); for (const e of edits) e.cell.value = e.before; };
  apply();
  return { records: [this.sheetRec(nt, apply, revert)], formulas: edits.length };
}

/** Hapus sheet (minimal satu sheet terlihat tersisa). */
export function removeSheetByTitle(this: XlsxBook, title: string): { records: EditRecord[] } | { error: string } {
  const i = this.wb.sheets.findIndex(s => s.sheet.title === title);
  if (i < 0) return { error: `Sheet "${title}" tidak ditemukan` };
  if (!this.wb.sheets.some((s, k) => k !== i && s.kind === "worksheet" && s.state === "visible")) return { error: "Tidak bisa menghapus satu-satunya sheet yang terlihat" };
  const ref = this.wb.sheets[i]!;
  const names = this.nameScopes();
  const apply = () => removeSheet(this.wb, title);
  const revert = () => { this.wb.sheets.splice(i, 0, ref); this.restoreNames(names); };
  apply();
  return { records: [this.sheetRec(title, apply, revert)] };
}

export function moveSheetTo(this: XlsxBook, title: string, to: number): { records: EditRecord[] } | { error: string } {
  const from = this.wb.sheets.findIndex(s => s.sheet.title === title);
  if (from < 0) return { error: `Sheet "${title}" tidak ditemukan` };
  const dest = Math.max(0, Math.min(this.wb.sheets.length - 1, Math.floor(to)));
  if (dest === from) return { records: [] };
  const apply = () => moveSheet(this.wb, title, dest);
  const revert = () => moveSheet(this.wb, title, from);
  apply();
  return { records: [this.sheetRec(title, apply, revert)] };
}

export function setSheetVisible(this: XlsxBook, title: string, visible: boolean): { records: EditRecord[] } | { error: string } {
  const ref = this.wb.sheets.find(s => s.sheet.title === title);
  if (!ref) return { error: `Sheet "${title}" tidak ditemukan` };
  const was = ref.state;
  const now = visible ? "visible" : "hidden";
  if (was === now) return { records: [] };
  try { setSheetState(this.wb, title, now); } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  return { records: [this.sheetRec(title, () => setSheetState(this.wb, title, now), () => setSheetState(this.wb, title, was))] };
}

export function findSheet(this: XlsxBook, title: string): Worksheet | undefined {
  for (const s of this.wb.sheets) if (s.kind === "worksheet" && s.sheet.title === title) return s.sheet;
  return undefined;
}

export function resizeColumn(this: XlsxBook, ws: Worksheet, col: number, chars: number) { setColumnWidth(ws, col, Math.max(0.5, chars)); this.dirty = true; }

export function resizeRow(this: XlsxBook, ws: Worksheet, row: number, pt: number) { setRowHeight(ws, row, Math.max(2, pt)); this.dirty = true; }

export function freeze(this: XlsxBook, ws: Worksheet, rows: number, cols: number) {
  setFreezePanes(ws, rows === 0 && cols === 0 ? undefined : { rows, cols });
  this.dirty = true;
}

export function drawingsOf(this: XlsxBook, ws: Worksheet): DrawingView[] {
  let d = this.drawings.get(ws);
  if (d) return d;
  d = [];
  (ws.drawing?.items ?? []).forEach((it: any, i: number) => {
    const key = `${ws.title}#${i}`;
    const content = it.content;
    const base = { key, index: i, anchor: it.anchor, anchorCell: anchorCell(it.anchor) };
    if (content.kind === "picture") {
      const p = content.picture;
      const img = p.image;
      const mime = img ? IMG_MIME[img.format] : undefined;
      let url: string | undefined;
      if (img && mime) {
        url = this.imageUrls.get(img.bytes);
        if (!url) {
          try { url = URL.createObjectURL(new Blob([img.bytes as BlobPart], { type: mime })); this.urls.push(url); this.imageUrls.set(img.bytes, url); } catch { /* abaikan */ }
        }
      }
      d!.push({ ...base, kind: "picture", name: p.name, descr: p.descr, url, format: img?.format, bytes: img?.bytes.length, hidden: !!p.hidden, note: img ? (mime ? undefined : `Format ${img.format.toUpperCase()} tidak dapat dirender browser`) : "Data gambar tidak ditemukan" });
    } else if (content.kind === "chart") {
      d!.push({ ...base, kind: "chart", name: content.chart.isCx ? "Chart (chartex)" : "Chart", hidden: false, note: "Grafik belum dirender pada preview ini" });
    } else {
      const tag = String(content.rawTag).replace(/^\{[^}]*\}/, "");
      const text = collectText(it.raw).join(" ").trim();
      const shape = ["sp", "cxnSp", "grpSp"].includes(tag) ? parseShapeGroup(it.raw, schemeLookup(this.styles.palette)) : undefined;
      if (shape) {
        const first = shape.shapes[0]!;
        d!.push({ ...base, kind: "shape", name: tag === "grpSp" ? `Grup (${shape.shapes.length})` : first.name, descr: first.descr, shape, text: shapePlainText(first.text) || text || undefined, hidden: shape.shapes.every(x => x.hidden), note: shape.approx ? "Sebagian geometri disederhanakan" : undefined });
        return;
      }
      d!.push({ ...base, kind: "unsupported", name: tag, text: text || undefined, hidden: false, note: tag === "sp" ? "Shape/textbox — hanya teks & kotak yang ditampilkan" : `Objek drawing "${tag}" belum dirender` });
    }
  });
  for (const o of this.oleList(ws)) {
    let url: string | undefined;
    const mime = o.previewFormat ? IMG_MIME[o.previewFormat] : undefined;
    if (o.previewBytes && mime) {
      url = this.imageUrls.get(o.previewBytes);
      if (!url) { try { url = URL.createObjectURL(new Blob([o.previewBytes as BlobPart], { type: mime })); this.urls.push(url); this.imageUrls.set(o.previewBytes, url); } catch { /* abaikan */ } }
    }
    const anchor = o.anchor ? oleAnchorToDrawing(o.anchor) : { kind: "absolute", pos: { x: 0, y: 0 }, ext: { cx: 96 * 9525, cy: 72 * 9525 } };
    d!.push({ key: `ole:${o.id}`, index: -1, kind: "ole", oleId: o.id, anchor, anchorCell: anchorCell(anchor), name: o.progId || "OLE", descr: `${o.description}${o.fileName ? ` — ${o.fileName}` : ""}`, url, format: o.previewFormat, bytes: o.size, hidden: false, note: url ? undefined : "Pratinjau objek tidak dapat ditampilkan browser (mis. EMF/WMF)" });
  }
  this.drawings.set(ws, d);
  return d;
}
