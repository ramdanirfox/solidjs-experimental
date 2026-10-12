/** XlsxBook: xlsx-model-csv.ts — fungsi bagian dari kelas (`this: XlsxBook`), dipasang di kelas sebagai properti agar API publik tidak berubah. */
import { type Sel, normSel, type SearchOptions, type SearchResult } from "./xlsx-model";
import type { XlsxBook } from "./xlsx-model";
import { type Worksheet } from "@office-kit/xlsx/worksheet";

export function toTsv(this: XlsxBook, ws: Worksheet, sel: Sel): string {
  const n = normSel(sel);
  const rows: string[] = [];
  for (let r = n.r1; r <= n.r2; r++) {
    const cells: string[] = [];
    for (let c = n.c1; c <= n.c2; c++) {
      const t = this.textAt(ws, r, c);
      cells.push(/[\t\r\n"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
    }
    rows.push(cells.join("\t"));
  }
  return rows.join("\r\n");
}

export function search(this: XlsxBook, opts: SearchOptions): SearchResult {
  const g = this.searchGen(opts);
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}
