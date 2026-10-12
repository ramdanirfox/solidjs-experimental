/**
 * Cari/ganti lintas jenis dan pengelolaan hyperlink untuk workbook XLSX (tanpa DOM).
 * Semua perubahan mengembalikan `EditRecord` sehingga dapat di-undo lewat `XlsxBook.commit/undo`.
 */
import type { Worksheet } from "@office-kit/xlsx/worksheet";
import { makeHyperlink } from "@office-kit/xlsx/worksheet";
import { makeFormula, type Cell } from "@office-kit/xlsx/cell";
import { addr, parseAddress, type EditRecord, type Sel, type XlsxBook } from "./xlsx-model";
import { classifyLink, type LinkItem } from "../editor-kit/hyperlink";
import { sameColor, sameFont, type ReplaceKind } from "../editor-kit/find-replace";

export const XLSX_REPLACE_KINDS: readonly ReplaceKind[] = ["text", "formula", "link", "comment", "font", "color", "fill"];

/** Satu potongan teks yang dapat dicari & diganti. */
export interface XUnit {
  kind: "text" | "formula" | "link" | "comment";
  sheet: string;
  ws: Worksheet;
  row: number;
  col: number;
  address: string;
  text: string;
  /** Teks pendamping (mis. teks tampilan tautan). */
  label?: string;
  /** Terapkan teks baru; mengembalikan record untuk undo. */
  set(next: string): EditRecord;
}

export interface UnitScope { sheet?: Worksheet; selection?: Sel }

const worksheets = (book: XlsxBook): Worksheet[] => book.sheets.filter(s => s.kind === "worksheet").map(s => (s as unknown as { sheet: Worksheet }).sheet);

function cellRec(ws: Worksheet, row: number, col: number, undo: () => void, redo: () => void): EditRecord {
  return { sheet: ws.title, row, col, before: null, after: null, undo, redo };
}

export function collectUnits(book: XlsxBook, kinds: ReplaceKind[], scope: UnitScope = {}): XUnit[] {
  const out: XUnit[] = [];
  const want = new Set(kinds);
  const targets = scope.sheet ? [scope.sheet] : worksheets(book);
  for (const ws of targets) {
    if (want.has("text") || want.has("formula")) {
      for (const r of [...ws.rows.keys()].sort((a, b) => a - b)) {
        const row = ws.rows.get(r)!;
        if (scope.selection && (r < scope.selection.r1 || r > scope.selection.r2)) continue;
        for (const c of [...row.keys()].sort((a, b) => a - b)) {
          if (scope.selection && (c < scope.selection.c1 || c > scope.selection.c2)) continue;
          const cell = row.get(c) as Cell;
          const v = cell.value as unknown;
          if (typeof v === "string" && want.has("text")) {
            out.push({ kind: "text", sheet: ws.title, ws, row: r, col: c, address: addr(r, c), text: v, set: t => book.setValueRaw(ws, r, c, t) });
          } else if (v && typeof v === "object" && (v as { kind?: string }).kind === "formula" && want.has("formula")) {
            const f = String((v as { formula?: string }).formula ?? "");
            out.push({ kind: "formula", sheet: ws.title, ws, row: r, col: c, address: addr(r, c), text: f, set: t => book.setValueRaw(ws, r, c, makeFormula(t.replace(/^=/, ""))) });
          }
        }
      }
    }
    if (want.has("link")) {
      for (const h of ws.hyperlinks ?? []) {
        const a = parseAddress(h.ref);
        const row = a?.r1 ?? 1, col = a?.c1 ?? 1;
        const key: "target" | "location" = h.target !== undefined && h.target !== "" ? "target" : "location";
        out.push({
          kind: "link", sheet: ws.title, ws, row, col, address: h.ref, text: (key === "target" ? h.target : h.location) ?? "", label: h.display ?? book.textAt(ws, row, col),
          set: next => {
            const before = { target: h.target, location: h.location };
            const after = key === "target" ? { target: next, location: h.location } : { target: h.target, location: next };
            const apply = (v: { target?: string; location?: string }) => { h.target = v.target; h.location = v.location; book.invalidateLinks(ws); };
            apply(after);
            return cellRec(ws, row, col, () => apply(before), () => apply(after));
          },
        });
      }
    }
    if (want.has("comment")) {
      for (const cm of ws.legacyComments ?? []) {
        const a = parseAddress(cm.ref);
        const row = a?.r1 ?? 1, col = a?.c1 ?? 1;
        out.push({
          kind: "comment", sheet: ws.title, ws, row, col, address: cm.ref, text: cm.text, label: cm.author,
          set: next => {
            const before = cm.text;
            cm.text = next;
            book.invalidateLinks(ws);
            return cellRec(ws, row, col, () => { cm.text = before; book.invalidateLinks(ws); }, () => { cm.text = next; book.invalidateLinks(ws); });
          },
        });
      }
    }
  }
  return out;
}

// ───────── hyperlink ─────────

export interface XLink { id: string; ws: Worksheet; link: ReturnType<typeof makeHyperlink> }

export function listLinks(book: XlsxBook): XLink[] {
  const out: XLink[] = [];
  for (const ws of worksheets(book)) (ws.hyperlinks ?? []).forEach((link, i) => out.push({ id: `${ws.title}|${i}|${link.ref}`, ws, link }));
  return out;
}
export function toLinkItem(book: XlsxBook, l: XLink): LinkItem {
  const url = l.link.target ? l.link.target : l.link.location ? `#${l.link.location}` : "";
  const a = parseAddress(l.link.ref);
  return {
    id: l.id, url, text: l.link.display ?? (a ? book.textAt(l.ws, a.r1, a.c1) : ""), tooltip: l.link.tooltip, kind: classifyLink(url),
    location: `${l.ws.title}!${l.link.ref}`, target: { kind: "cell", sheet: l.ws.title, address: a ? addr(a.r1, a.c1) : l.link.ref },
  };
}

/** Pasang/ubah hyperlink pada `ref` (sel/rentang). `url` "#Sheet!A1" = lokasi internal. Mengembalikan record undo. */
export function setLink(book: XlsxBook, ws: Worksheet, ref: string, url: string, opts: { tooltip?: string; display?: string } = {}): EditRecord {
  const a = parseAddress(ref);
  const internal = url.startsWith("#");
  const idx = ws.hyperlinks.findIndex(h => h.ref === ref);
  const before = idx >= 0 ? { ...ws.hyperlinks[idx] } : undefined;
  const next = makeHyperlink({ ref, ...(internal ? { location: url.slice(1) } : { target: url }), ...(opts.tooltip ? { tooltip: opts.tooltip } : {}), ...(opts.display ? { display: opts.display } : {}) });
  const apply = () => { const i = ws.hyperlinks.findIndex(h => h.ref === ref); if (i >= 0) ws.hyperlinks[i] = next; else ws.hyperlinks.push(next); book.invalidateLinks(ws); };
  const revert = () => { const i = ws.hyperlinks.findIndex(h => h.ref === ref); if (before) { if (i >= 0) ws.hyperlinks[i] = before as typeof next; else ws.hyperlinks.push(before as typeof next); } else if (i >= 0) ws.hyperlinks.splice(i, 1); book.invalidateLinks(ws); };
  apply();
  return cellRec(ws, a?.r1 ?? 1, a?.c1 ?? 1, revert, apply);
}

export function removeLinkAt(book: XlsxBook, ws: Worksheet, ref: string): EditRecord | undefined {
  const i = ws.hyperlinks.findIndex(h => h.ref === ref);
  if (i < 0) return undefined;
  const [removed] = ws.hyperlinks.splice(i, 1);
  book.invalidateLinks(ws);
  const a = parseAddress(ref);
  return cellRec(ws, a?.r1 ?? 1, a?.c1 ?? 1,
    () => { ws.hyperlinks.splice(Math.min(i, ws.hyperlinks.length), 0, removed); book.invalidateLinks(ws); },
    () => { const j = ws.hyperlinks.indexOf(removed); if (j >= 0) ws.hyperlinks.splice(j, 1); book.invalidateLinks(ws); });
}

// ───────── nilai: font / warna teks / isi ─────────

export type ValueKind = "font" | "color" | "fill";

function styleMatches(book: XlsxBook, styleId: number, kind: ValueKind, value: string): boolean {
  const st = book.styles.get(styleId);
  return kind === "font" ? sameFont(st.fontName, value) : kind === "color" ? sameColor(st.color, value) : sameColor(st.bg, value);
}

/**
 * Ganti font / warna teks / warna isi persis pada semua sel. `to` kosong: warna → hapus (teks = hitam otomatis, isi = tanpa isi).
 * Gaya dihitung sekali per `styleId` lalu disalin ke semua sel yang memakainya.
 */
export function replaceValues(book: XlsxBook, kind: ValueKind, from: string, to: string, scope: UnitScope = {}): EditRecord[] {
  const out: EditRecord[] = [];
  const patchFor = (): Parameters<XlsxBook["applyStyle"]>[2] | null => {
    if (kind === "font") return to ? { fontName: to } : null;
    if (kind === "color") return { fontColor: to ? (to.startsWith("#") ? to : `#${to}`) : null };
    return { fill: to ? (to.startsWith("#") ? to : `#${to}`) : null };
  };
  const patch = patchFor();
  if (!patch) return out;
  const mapped = new Map<number, number>();
  for (const ws of scope.sheet ? [scope.sheet] : worksheets(book)) {
    for (const r of [...ws.rows.keys()]) {
      if (scope.selection && (r < scope.selection.r1 || r > scope.selection.r2)) continue;
      const row = ws.rows.get(r)!;
      for (const c of [...row.keys()]) {
        if (scope.selection && (c < scope.selection.c1 || c > scope.selection.c2)) continue;
        const cell = row.get(c) as Cell;
        if (!styleMatches(book, cell.styleId, kind, from)) continue;
        const orig = cell.styleId;
        let id = mapped.get(orig);
        if (id === undefined) {
          const recs = book.applyStyle(ws, { r1: r, c1: c, r2: r, c2: c }, patch);
          out.push(...recs);
          mapped.set(orig, cell.styleId);
          continue;
        }
        out.push(book.setValueRaw(ws, r, c, cell.value, id));
      }
    }
  }
  return out;
}

export function countValue(book: XlsxBook, kind: ValueKind, value: string): number {
  let n = 0;
  for (const ws of worksheets(book)) for (const row of ws.rows.values()) for (const cell of row.values()) if (styleMatches(book, (cell as Cell).styleId, kind, value)) n++;
  return n;
}
