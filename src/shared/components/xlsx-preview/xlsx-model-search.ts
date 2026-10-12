/** XlsxBook: xlsx-model-search.ts — fungsi bagian dari kelas (`this: XlsxBook`), dipasang di kelas sebagai properti agar API publik tidak berubah. */



import { type SearchOptions, type SearchResult, type SearchHit, parseColumnSpec, addr } from "./xlsx-model";
import type { XlsxBook } from "./xlsx-model";
import { type Worksheet } from "@office-kit/xlsx/worksheet";

/** Pencarian bertahap: berhenti sejenak tiap ±16 ribu sel agar UI tidak membeku pada sheet raksasa. */
export async function searchAsync(this: XlsxBook, opts: SearchOptions, cancelled: () => boolean, progress?: (scanned: number) => void): Promise<SearchResult | undefined> {
  const g = this.searchGen(opts);
  let scanned = 0;
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
    scanned += 16384;
    progress?.(scanned);
    await new Promise(res => setTimeout(res, 0));
    if (cancelled()) return undefined;
  }
}

export function* searchGen(this: XlsxBook, opts: SearchOptions): Generator<void, SearchResult, void> {
  const started = performance.now();
  const results: SearchHit[] = [];
  const q = opts.query;
  if (!q) return { hits: [], truncated: false, ms: 0, perSheet: new Map() };
  let re: RegExp | undefined;
  if (opts.regex) { try { re = new RegExp(q, opts.matchCase ? "" : "i"); } catch { return { hits: [], truncated: false, ms: 0, perSheet: new Map(), error: "Regex tidak valid" }; } }
  const needle = opts.matchCase ? q : q.toLowerCase();
  const cols = opts.columns ? parseColumnSpec(opts.columns) : undefined;
  const limit = opts.limit ?? 3000;
  let truncated = false;
  let scanned = 0;
  const perSheet = new Map<string, number>();
  const targets = opts.allSheets ? this.wb.sheets.filter(s => s.kind === "worksheet").map(s => (s as any).sheet as Worksheet) : opts.sheet ? [opts.sheet] : [];
  outer: for (const ws of targets) {
    const rowKeys = [...ws.rows.keys()].sort((a, b) => a - b);
    for (const r of rowKeys) {
      const row = ws.rows.get(r)!;
      if (opts.selection && opts.sheet === ws && (r < opts.selection.r1 || r > opts.selection.r2)) continue;
      for (const c of [...row.keys()].sort((a, b) => a - b)) {
        if (cols && !cols.has(c)) continue;
        if (opts.selection && opts.sheet === ws && (c < opts.selection.c1 || c > opts.selection.c2)) continue;
        const cell = row.get(c)!;
        if ((++scanned & 0x3fff) === 0) yield;
        if (cell.value === null) continue;
        const f: any = cell.value;
        const isF = f && typeof f === "object" && f.kind === "formula";
        const shown = this.cellText(ws, cell);
        const fText = isF ? "=" + f.formula : "";
        const candidates = opts.inFormulas && isF ? [shown, fText] : [shown];
        let hitText: string | undefined;
        for (const cand of candidates) {
          const hay = opts.matchCase ? cand : cand.toLowerCase();
          const ok = re ? re.test(cand) : opts.wholeCell ? hay === needle : hay.includes(needle);
          if (ok) { hitText = cand; break; }
        }
        if (hitText === undefined) continue;
        results.push({ sheet: ws.title, row: r, col: c, address: addr(r, c), text: shown, formula: isF ? fText : undefined, matchedIn: hitText === fText && isF ? "formula" : "value" });
        perSheet.set(ws.title, (perSheet.get(ws.title) ?? 0) + 1);
        if (results.length >= limit) { truncated = true; break outer; }
      }
    }
  }
  return { hits: results, truncated, ms: performance.now() - started, perSheet };
}
