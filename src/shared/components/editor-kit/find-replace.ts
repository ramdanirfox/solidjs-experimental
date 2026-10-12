/**
 * Cari, ganti, dan lompat (goto) yang dipakai bersama editor Office/maxGraph lewat event bus.
 *
 * Perintah bus yang didaftarkan tiap editor (nama sama di semua editor):
 *   - `goto(target)`            : pindahkan fokus/viewport ke slide, halaman, sel, simpul, hasil pencarian, dst. (lihat `NavTarget` tiap editor)
 *   - `find(spec)`              : cari → daftar `FindMatch`; hasil pertama disorot (`spec.select === false` untuk menonaktifkan)
 *   - `findNext()` / `findPrev()` / `findClear()`
 *   - `replace(spec)`           : ganti hasil yang sedang aktif (atau pertama)
 *   - `replaceAll(spec)`        : ganti semua yang cocok
 *   - `replace.kinds()`         : jenis objek/aspek yang bisa diganti oleh editor ini
 *
 * Penggantian dikategorikan lewat `ReplaceKind`. Satu permintaan boleh memuat beberapa jenis sekaligus (`kinds: ["text", "link"]`);
 * jenis yang tidak didukung editor dilaporkan di `ReplaceReport.skipped`, tidak melempar galat.
 *
 *  - Jenis berbasis string (`text`, `link`, `notes`, `name`, `formula`, `comment`, `headerFooter`, `label`, `data`) memakai
 *    `query` sebagai teks/regex dan `replacement` sebagai teks pengganti (grup regex `$1` berlaku bila `regex: true`).
 *  - Jenis berbasis nilai (`font`, `color`, `fill`, `stroke`) mencocokkan `query` sebagai nilai persis (nama font tanpa beda huruf;
 *    warna `#RRGGBB`/`RRGGBB`/`#RGB`) dan mengganti dengan `replacement` — `""` pada warna berarti "hapus warna".
 */

export type ReplaceKind =
  | "text"          // isi teks utama: paragraf/tabel (docx), shape/tabel (pptx), nilai sel (xlsx), label simpul (maxgraph)
  | "headerFooter"  // teks header & footer (docx)
  | "notes"         // catatan pembicara (pptx), catatan kaki (docx)
  | "comment"       // komentar / catatan sel
  | "link"          // target hyperlink (URL)
  | "name"          // nama objek (shape, sheet, tabel bernama, halaman)
  | "formula"       // teks rumus (xlsx)
  | "number"        // nilai numerik sel, dicocokkan sebagai teks angka mentah (xlsx)
  | "label"         // label/tooltip
  | "data"          // atribut data kustom (maxgraph)
  | "font"          // nama font (nilai persis)
  | "color"         // warna teks (nilai persis)
  | "fill"          // warna isi bentuk/sel/simpul (nilai persis)
  | "stroke";       // warna garis/tepi (nilai persis)

/** Jenis yang berbasis nilai persis (bukan pencarian teks). */
export const VALUE_KINDS: readonly ReplaceKind[] = ["font", "color", "fill", "stroke"];
export const isValueKind = (k: ReplaceKind) => VALUE_KINDS.includes(k);

export interface FindSpec {
  query: string;
  regex?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  /** Batasi pencarian ke jenis tertentu (default: semua jenis berbasis string yang didukung editor). */
  kinds?: ReplaceKind[];
  /** Sorot & fokuskan hasil pertama (default true). */
  select?: boolean;
  /** Jumlah hasil maksimum yang dikembalikan (default 2000). */
  limit?: number;
}

export interface ReplaceSpec extends FindSpec {
  replacement: string;
  /** Jenis yang diganti. Default: `["text"]`. */
  kinds?: ReplaceKind[];
}

/** Satu hasil pencarian — bentuknya sama di semua editor; `where` berisi lokasi spesifik editor. */
export interface FindMatch {
  index: number;
  kind: ReplaceKind;
  text: string;
  before: string;
  after: string;
  /** Lokasi manusiawi, mis. "Slide 3 · Title", "Sheet1!B4", "¶12 (tabel 1 r2 k3)". */
  location: string;
  /** Lokasi terstruktur yang bisa diberikan ke `goto`. */
  target: NavTargetBase;
}

export interface FindResult { query: string; count: number; matches: FindMatch[]; error?: string; truncated?: boolean; current: number }

export interface ReplaceReport {
  total: number;
  byKind: Partial<Record<ReplaceKind, number>>;
  /** Jenis yang diminta tetapi tidak didukung editor ini. */
  skipped: ReplaceKind[];
  error?: string;
}

/** Dasar semua target navigasi: `kind` membedakan jenis target. */
export interface NavTargetBase { kind: string; [k: string]: unknown }

export interface NavEvent { target: NavTargetBase; ok: boolean; /** Keterangan singkat (mis. "Slide 3/10"). */ label?: string }

/** Event umum terkait cari/ganti/navigasi. Disatukan ke peta event tiap editor. */
export interface OfficeNavEvents {
  navigate: NavEvent;
  find: { query: string; count: number };
  replace: ReplaceReport & { query: string; replacement: string; kinds: ReplaceKind[] };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Bangun RegExp global dari spesifikasi pencarian. Mengembalikan `error` bila regex tidak valid. */
export function compileFind(o: Pick<FindSpec, "query" | "regex" | "caseSensitive" | "wholeWord">): { re: RegExp | null; error?: string } {
  if (!o.query) return { re: null };
  try {
    let src = o.regex ? o.query : escapeRe(o.query);
    if (o.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
    return { re: new RegExp(src, "gu" + (o.caseSensitive ? "" : "i")) };
  } catch (e) {
    return { re: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Ganti semua kecocokan di `text`; mengembalikan teks baru dan jumlah penggantian. `$1`… hanya berlaku pada mode regex. */
export function replaceInString(text: string, re: RegExp, replacement: string, regex: boolean): { text: string; count: number } {
  let count = 0;
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const out = text.replace(g, (...m) => {
    const full = m[0] as string;
    if (!full.length) return full;
    count++;
    if (!regex) return replacement;
    const single = new RegExp(re.source, re.flags.replace("g", ""));
    return full.replace(single, replacement);
  });
  return { text: out, count };
}

/** Semua kecocokan dalam `text` sebagai {start,end}. Kecocokan kosong dilewati. */
export function matchRanges(text: string, re: RegExp): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = g.exec(text))) {
    if (!m[0].length) { g.lastIndex++; continue; }
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export const snippet = (text: string, start: number, end: number, n = 28) => ({
  before: text.slice(Math.max(0, start - n), start).replace(/\s+/g, " "),
  after: text.slice(end, end + n).replace(/\s+/g, " "),
});

/** `#RGB` / `#RRGGBB` / `RRGGBB` / `RRGGBBAA` → "RRGGBB" huruf besar; null bila bukan warna. */
export function normHex(c: string | null | undefined): string | null {
  if (!c) return null;
  let s = c.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split("").map(x => x + x).join("");
  if (/^[0-9a-f]{8}$/i.test(s)) s = s.slice(0, 6);
  return /^[0-9a-f]{6}$/i.test(s) ? s.toUpperCase() : null;
}

/** Pencocok nilai untuk jenis `font` / warna. */
export const sameFont = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
export const sameColor = (a: string | null | undefined, b: string | null | undefined) => { const x = normHex(a), y = normHex(b); return !!x && x === y; };

/** Kelompokkan ke `ReplaceReport` dari hitungan per jenis. */
export function makeReport(kinds: ReplaceKind[], supported: readonly ReplaceKind[], counts: Partial<Record<ReplaceKind, number>>): ReplaceReport {
  const byKind: Partial<Record<ReplaceKind, number>> = {};
  let total = 0;
  for (const [k, v] of Object.entries(counts) as [ReplaceKind, number][]) { if (v) { byKind[k] = v; total += v; } }
  return { total, byKind, skipped: kinds.filter(k => !supported.includes(k)) };
}

/** Kursor hasil cari bersama: simpan hasil terakhir dan posisi aktif, dengan putaran. */
export function createFindCursor<T>() {
  let items: T[] = [];
  let cur = -1;
  return {
    set(list: T[], start = -1) { items = list; cur = start; },
    clear() { items = []; cur = -1; },
    get items() { return items; },
    get index() { return cur; },
    set index(i: number) { cur = i; },
    get current(): T | undefined { return items[cur]; },
    step(dir: 1 | -1): T | undefined {
      if (!items.length) return undefined;
      cur = cur < 0 ? (dir === 1 ? 0 : items.length - 1) : (cur + dir + items.length) % items.length;
      return items[cur];
    },
  };
}
