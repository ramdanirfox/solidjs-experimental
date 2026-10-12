/** XlsxBook: xlsx-model-links.ts — fungsi bagian dari kelas (`this: XlsxBook`), dipasang di kelas sebagai properti agar API publik tidak berubah. */
import { parseAddress } from "./xlsx-model";
import type { XlsxBook } from "./xlsx-model";
import { type Worksheet } from "@office-kit/xlsx/worksheet";

export function maps(this: XlsxBook, ws: Worksheet) {
  let m = this.linkMaps.get(ws);
  if (m) return m;
  const links = new Map<number, any>(), notes = new Map<number, any>();
  const expand = (ref: string, fn: (r: number, c: number) => void) => {
    const b = parseAddress(ref); if (!b) return;
    if ((b.r2 - b.r1 + 1) * (b.c2 - b.c1 + 1) > 5000) return;
    for (let r = b.r1; r <= b.r2; r++) for (let c = b.c1; c <= b.c2; c++) fn(r, c);
  };
  for (const h of ws.hyperlinks ?? []) expand(h.ref, (r, c) => links.set(r * 16385 + c, h));
  for (const cm of ws.legacyComments ?? []) expand(cm.ref, (r, c) => notes.set(r * 16385 + c, cm));
  m = { links, notes };
  this.linkMaps.set(ws, m);
  return m;
}

/** Bangun ulang indeks hyperlink/komentar sheet (panggil setelah mengubah `ws.hyperlinks` / `ws.legacyComments`). */
export function invalidateLinks(this: XlsxBook, ws: Worksheet) { this.linkMaps.delete(ws); this.invalidate(); }

export function hyperlinkAt(this: XlsxBook, ws: Worksheet, r: number, c: number) { return this.maps(ws).links.get(r * 16385 + c); }

export function commentAt(this: XlsxBook, ws: Worksheet, r: number, c: number) { return this.maps(ws).notes.get(r * 16385 + c); }
