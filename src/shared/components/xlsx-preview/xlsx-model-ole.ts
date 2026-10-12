/** XlsxBook: xlsx-model-ole.ts — fungsi bagian dari kelas (`this: XlsxBook`), dipasang di kelas sebagai properti agar API publik tidak berubah. */
import { logEntry, type EditRecord } from "./xlsx-model";
import type { XlsxBook } from "./xlsx-model";
import { fromArrayBuffer } from "@office-kit/xlsx/io";
import { type Worksheet } from "@office-kit/xlsx/worksheet";
import { openZip } from "@office-kit/xlsx/zip";
import { scanXlsxOle, type OleAnchor, type XlsxOleObject } from "./xlsx-ole";
import type { PreparedOle } from "../office-shared/ole-embed";

export async function scanOle(this: XlsxBook) {
  if (!this.sourceBytes) return;
  try { this.ole.existing = await scanXlsxOle(this.sourceBytes); }
  catch (e: any) { this.log?.(logEntry("warn", "OLE", `Objek OLE pada berkas tidak dapat dipindai: ${e?.message ?? e}`)); }
}

export function oleList(this: XlsxBook, ws?: Worksheet): XlsxOleObject[] { const all = this.ole.list(); return ws ? all.filter(o => o.sheet === ws.title) : all; }

export function wsByTitle(this: XlsxBook, title: string): Worksheet | undefined { for (const s of this.wb.sheets) if (s.kind === "worksheet" && s.sheet.title === title) return s.sheet; return undefined; }

/** Sisipkan objek OLE di `anchor` (basis 0). Kembalikan catatan undo/redo. */
export function insertOle(this: XlsxBook, ws: Worksheet, prep: PreparedOle, anchor: OleAnchor, size: { w: number; h: number }): { record: EditRecord; id: string } {
  const id = this.ole.nextId();
  const ins = { id, sheet: ws.title, prep, anchor, widthPx: size.w, heightPx: size.h };
  this.ole.inserts.push(ins);
  this.invalidateDrawings(ws);
  const record: EditRecord = {
    sheet: ws.title, row: anchor.r1 + 1, col: anchor.c1 + 1, before: null, after: null,
    undo: () => { const i = this.ole.inserts.indexOf(ins); if (i >= 0) this.ole.inserts.splice(i, 1); this.invalidateDrawings(ws); },
    redo: () => { if (!this.ole.inserts.includes(ins)) this.ole.inserts.push(ins); this.invalidateDrawings(ws); },
  };
  return { record, id };
}

/** Isi embedding objek OLE `id` (sisipan, perbaruan, atau dari berkas sumber). */
export async function oleBytes(this: XlsxBook, id: string): Promise<Uint8Array | undefined> {
  const ins = this.ole.inserts.find(i => i.id === id);
  if (ins) return ins.prep.bytes;
  const up = this.ole.updates.get(id);
  if (up) return up.bytes;
  const o = this.ole.existing.find(x => x.id === id);
  if (!o?.part || !this.sourceBytes || o.linked) return undefined;
  const zip = await openZip(fromArrayBuffer(this.sourceBytes));
  try { return zip.has(o.part) ? zip.read(o.part) : undefined; } finally { zip.close(); }
}

/** Pindah / ubah ukuran objek OLE. Hanya untuk sisipan sesi ini (posisi objek di berkas tidak ditulis ulang). */
export function moveOle(this: XlsxBook, id: string, anchor: OleAnchor, size: { w: number; h: number }): { record: EditRecord } {
  const ins = this.ole.inserts.find(i => i.id === id);
  if (!ins) throw new Error("Posisi/ukuran objek OLE yang sudah ada di berkas belum dapat diubah — hanya objek yang disisipkan pada sesi ini.");
  const ws = this.wsByTitle(ins.sheet)!;
  const before = { anchor: ins.anchor, w: ins.widthPx, h: ins.heightPx };
  const apply = (a: OleAnchor, w: number, h: number) => { ins.anchor = a; ins.widthPx = w; ins.heightPx = h; this.invalidateDrawings(ws); };
  apply(anchor, size.w, size.h);
  return { record: { sheet: ins.sheet, row: anchor.r1 + 1, col: anchor.c1 + 1, before: null, after: null, undo: () => apply(before.anchor, before.w, before.h), redo: () => apply(anchor, size.w, size.h) } };
}

/** Ganti isi objek OLE `id` (milik berkas atau sisipan sesi ini). */
export function updateOle(this: XlsxBook, id: string, prep: PreparedOle): { record: EditRecord; target: XlsxOleObject } {
  const target = this.ole.list().find(o => o.id === id);
  if (!target) throw new Error(`Objek OLE "${id}" tidak ditemukan.`);
  if (target.linked) throw new Error("Objek OLE tertaut (link) — isinya tidak dapat diganti.");
  const ws = this.wsByTitle(target.sheet)!;
  const ins = this.ole.inserts.find(i => i.id === id);
  const old = ins ? ins.prep : this.ole.updates.get(id);
  const set = (p: PreparedOle | undefined) => { if (ins) { if (p) ins.prep = p; } else if (p) this.ole.updates.set(id, p); else this.ole.updates.delete(id); this.invalidateDrawings(ws); };
  set(prep);
  const a = target.anchor;
  return { target, record: { sheet: target.sheet, row: (a?.r1 ?? 0) + 1, col: (a?.c1 ?? 0) + 1, before: null, after: null, undo: () => set(old), redo: () => set(prep) } };
}
