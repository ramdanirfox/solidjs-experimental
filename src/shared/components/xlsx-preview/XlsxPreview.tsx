/**
 * Preview XLSX/XLSM (client-only) berbasis @office-kit/xlsx.
 * Fitur: grid OOXML (style, lebar/tinggi, hidden, freeze, merge, gambar), status bar, pencarian (sheet/workbook),
 * pindah sheet, edit & copy/paste, autofilter, evaluasi formula, unduh XLSX/CSV, buka berkas lokal, info workbook,
 * log pembacaan, debug sel, undo/redo, zoom, conditional formatting.
 */
import { For, Show, batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack, type JSX } from "solid-js";
import type { Worksheet } from "@office-kit/xlsx/worksheet";
import { hideRows, hideColumns, unhideRows, unhideColumns } from "@office-kit/xlsx/worksheet";
import { getCellAlignment, getCellBorder, getCellFill, getCellFont } from "@office-kit/xlsx/styles";
import { columnLetterFromIndex, parseSheetRange } from "@office-kit/xlsx/utils";
import XlsxGrid, { type GridApi } from "./XlsxGrid";
import {
  XlsxBook, addr, buildLoadReport, formatBytes, loadBook, logEntry, normSel, parseAddress, selAddr, sheetInfo, workbookInfo,
  type FilterState, type LogEntry, type LogLevel, type SearchHit, type SearchResult, type Sel, type EditRecord,
} from "./xlsx-model";
import { buildLayout, colW, measureTextPx, pxToColChars, pxToPt, type Layout } from "./xlsx-layout";
import { isErr, nodeToString, SUPPORTED_FUNCTIONS, toText, type Node as FNode, type Val } from "./xlsx-formula";
import { shiftRefs } from "./xlsx-cf";
import { createSampleWorkbook } from "./xlsx-sample";
import { resolveColor } from "./xlsx-style";
import "./xlsx-preview.css";

export interface XlsxPreviewProps {
  /** URL berkas .xlsx/.xlsm yang dimuat di awal. */
  src?: string;
  /** Muat workbook contoh bila `src` tidak diberikan (default: true). */
  sample?: boolean;
  height?: string;
  class?: string;
}

const ICONS: Record<string, string> = {
  open: "M6 14l1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",
  save: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3",
  csv: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h2 M8 17h2 M14 13h2 M14 17h2",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3",
  filter: "M22 3H2l8 9.46V19l4 2v-8.54L22 3z",
  undo: "M3 7v6h6 M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13",
  redo: "M21 7v6h-6 M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01",
  log: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8",
  bug: "M8 2l1.88 1.88 M14.12 3.88L16 2 M9 7.13v-1a3.003 3.003 0 1 1 6 0v1 M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6 M12 20v-9 M6.53 9C4.6 8.8 3 7.1 3 5 M6 13H2 M20.97 5c0 2.1-1.6 3.8-3.5 4 M22 13h-4",
  freeze: "M2 12h20 M12 2v20 M20 16l-4-4 4-4 M4 8l4 4-4 4 M16 4l-4 4-4-4 M8 20l4-4 4 4",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  grid: "M3 3h18v18H3z M3 9h18 M3 15h18 M9 3v18 M15 3v18",
  sigma: "M18 7V4H6l6 8-6 8h12v-3",
  sample: "M12 3l1.9 5.8H20l-4.9 3.6 1.9 5.8-5-3.6-5 3.6 1.9-5.8L4 8.8h6.1z",
  zoomin: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3 M11 8v6 M8 11h6",
};
const Ic = (p: { n: string; size?: number }) => (
  <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d={ICONS[p.n]} /></svg>
);

type Panel = "find" | "info" | "log" | null;
type Dialog = "debug" | "eval" | null;

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function fmtVal(v: Val): string {
  if (v === null) return "(kosong)";
  if (typeof v === "object") {
    if ((v as any).kind === "error") return (v as any).code;
    if ((v as any).kind === "range") { const r: any = v; return `${r.ws.title}!${addr(r.r1, r.c1)}${r.r1 === r.r2 && r.c1 === r.c2 ? "" : ":" + addr(Math.min(r.r2, 1048576), Math.min(r.c2, 16384))}`; }
    if ((v as any).kind === "array") { const a: any = v; return "{" + a.rows.map((r: any[]) => r.map(x => (typeof x === "string" ? `"${x}"` : toText(x))).join(", ")).join("; ") + "}"; }
  }
  return typeof v === "string" ? `"${v}"` : toText(v as any);
}

function jsonSafe(_k: string, v: any) {
  if (v instanceof Map) return Object.fromEntries(v);
  if (v instanceof Set) return [...v];
  if (v instanceof Uint8Array) return `<Uint8Array ${v.length} bytes>`;
  if (v instanceof Date) return `Date(${v.toISOString()})`;
  return v;
}

export default function XlsxPreview(props: XlsxPreviewProps) {
  let rootEl!: HTMLDivElement;
  let fileInput!: HTMLInputElement;
  let gridApi: GridApi | undefined;

  // ───────── state inti ─────────
  const [book, setBook] = createSignal<XlsxBook | undefined>(undefined);
  const [busy, setBusy] = createSignal<string | null>("Memuat…");
  const [ver, setVer] = createSignal(0);
  const [lver, setLver] = createSignal(0);
  const [sheetIdx, setSheetIdx] = createSignal(0);
  const [zoom, setZoom] = createSignal(1);
  const [showHidden, setShowHidden] = createSignal(false);
  const [gridlines, setGridlines] = createSignal(true);
  const [showFormulas, setShowFormulas] = createSignal(false);
  const [live, setLive] = createSignal(false);
  const [sel, setSel] = createSignal<Sel>({ r1: 1, c1: 1, r2: 1, c2: 1 });
  const [active, setActive] = createSignal({ row: 1, col: 1 });
  const [editing, setEditing] = createSignal<{ row: number; col: number; text: string; src: "cell" | "bar" } | null>(null);
  const [panel, setPanel] = createSignal<Panel>(null);
  const [dialog, setDialog] = createSignal<Dialog>(null);
  const [logs, setLogs] = createSignal<LogEntry[]>([]);
  const [toastMsg, setToastMsg] = createSignal<string | null>(null);
  const [menu, setMenu] = createSignal<"csv" | "freeze" | "view" | null>(null);
  const [ctx, setCtx] = createSignal<{ x: number; y: number; row: number; col: number } | null>(null);
  const [dragOver, setDragOver] = createSignal(false);
  const [nameBox, setNameBox] = createSignal<string | null>(null);

  const bump = () => setVer(v => v + 1);
  const bumpLayout = () => batch(() => { setLver(v => v + 1); bump(); });

  const ws = createMemo(() => { ver(); sheetIdx(); return book()?.worksheetAt(sheetIdx()); });
  const sheetRef = createMemo(() => book()?.sheets[sheetIdx()]);

  const filterState = createMemo<(FilterState & { _t?: number }) | undefined>(() => {
    lver(); const w = ws(); const b = book();
    const st = w && b ? b.filterOf(w) : undefined;
    return st ? { ...st } : undefined;
  }, undefined, { equals: false });

  const layout = createMemo<Layout>(() => {
    lver(); sheetIdx();
    const w = ws();
    if (!w) return buildLayout({ columnDimensions: new Map(), rowDimensions: new Map(), views: [], rows: new Map(), mergedCells: [] } as any, { zoom: 1, showHidden: false });
    const f = filterState();
    const b = book();
    const autoHeightPx = b ? (r: number) => {
      const row = w.rows.get(r); if (!row) return undefined;
      let max = 0;
      for (const cell of row.values()) { if (cell.styleId === 0) continue; const px = b.styles.get(cell.styleId).sizePt * 1.75; if (px > max) max = px; }
      return max || undefined;
    } : undefined;
    return buildLayout(w, { zoom: zoom(), showHidden: showHidden(), filterHidden: f?.hiddenRows, autoHeightPx });
  });

  // ───────── util ─────────
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const toast = (m: string, ms = 2600) => { setToastMsg(m); clearTimeout(toastTimer); toastTimer = setTimeout(() => setToastMsg(null), ms); };
  const pushLog = (e: LogEntry) => setLogs(l => (l.length > 600 ? [...l.slice(-500), e] : [...l, e]));
  const countLevel = (lv: LogLevel) => logs().filter(l => l.level === lv).length;

  function attachBook(b: XlsxBook, entries: LogEntry[]) {
    book()?.dispose();
    batch(() => {
      b.log = e => { if (!untrack(logs).some(x => x.message === e.message)) pushLog(e); };
      setBook(b);
      setLogs(entries);
      setLive(b.ev.live);
      uiMemo.clear();
      const idx = Math.min(Math.max(0, b.wb.activeSheetIndex ?? 0), b.sheets.length - 1);
      const first = b.sheets[idx]?.kind === "worksheet" ? idx : b.sheets.findIndex(s => s.kind === "worksheet");
      setSheetIdx(Math.max(0, first));
      applySheetView(b, Math.max(0, first));
      setEditing(null);
      setPanel(null);
      bump(); setLver(v => v + 1);
    });
  }

  function applySheetView(b: XlsxBook, i: number) {
    const w = b.worksheetAt(i);
    const view: any = w?.views?.[0];
    setGridlines(view?.showGridLines !== false);
    setShowFormulas(!!view?.showFormulas);
    if (view?.zoomScale && b.sheets[i]) setZoom(Math.min(4, Math.max(0.25, view.zoomScale / 100)));
    else setZoom(1);
    const ac = view?.selection?.activeCell ? parseAddress(view.selection.activeCell) : undefined;
    const mem = w ? uiMemo.get(w.title) : undefined;
    if (mem) { setSel(mem.sel); setActive(mem.active); }
    else if (ac) { setSel({ r1: ac.r1, c1: ac.c1, r2: ac.r1, c2: ac.c1 }); setActive({ row: ac.r1, col: ac.c1 }); }
    else { setSel({ r1: 1, c1: 1, r2: 1, c2: 1 }); setActive({ row: 1, col: 1 }); }
  }

  const uiMemo = new Map<string, { sel: Sel; active: { row: number; col: number }; x: number; y: number }>();
  let scrollPos = { x: 0, y: 0 };

  // ───────── load ─────────
  async function loadBytes(bytes: ArrayBuffer | Uint8Array, name: string) {
    setBusy(`Membaca ${name}…`);
    try {
      const out = await loadBook(bytes, name);
      if (out.book) { attachBook(out.book, out.entries); toast(`“${name}” dimuat`); }
      else { setLogs(l => [...l, ...out.entries]); setPanel("log"); toast("Gagal membaca berkas — lihat Log"); }
    } finally { setBusy(null); }
  }

  async function openSample() {
    setBusy("Membuat contoh…");
    try {
      const wb = await createSampleWorkbook();
      const b = new XlsxBook(wb, "contoh-penjualan.xlsx", 0);
      b.refreshFormulaCaches(); // simpan hasil formula sebagai cache seperti berkas dari Excel
      attachBook(b, [logEntry("ok", "Sample", "Workbook contoh dibangun dengan @office-kit/xlsx (tidak berasal dari berkas)")]);
      const rep = buildLoadReport(b);
      setLogs(l => [...l, ...rep]);
    } catch (e: any) {
      setLogs([logEntry("error", "Sample", `Gagal membuat contoh: ${e?.message ?? e}`, e?.stack)]);
    } finally { setBusy(null); }
  }

  async function openUrl(url: string) {
    setBusy("Mengunduh…");
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadBytes(await res.arrayBuffer(), decodeURIComponent(url.split("/").pop()?.split("?")[0] || "workbook.xlsx"));
    } catch (e: any) {
      setLogs(l => [...l, logEntry("error", "Fetch", `Gagal mengunduh ${url}: ${e?.message ?? e}`)]);
      setBusy(null);
      await openSample();
    }
  }

  async function openFile(f: File | undefined | null) {
    if (!f) return;
    await loadBytes(await f.arrayBuffer(), f.name);
  }

  onMount(() => {
    if (props.src) void openUrl(props.src);
    else if (props.sample !== false) void openSample();
    else setBusy(null);
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest?.(".xl-menu-wrap")) setMenu(null);
      if (!t.closest?.(".xl-ctx")) setCtx(null);
      if (!t.closest?.(".xl-filter-pop") && !t.closest?.(".xl-filter-btn")) setFp(null);
    };
    window.addEventListener("mousedown", close);
    onCleanup(() => { window.removeEventListener("mousedown", close); book()?.dispose(); });
  });

  // ───────── seleksi & navigasi ─────────
  const onSelect = (s: Sel, a: { row: number; col: number }) => { setSel(s); setActive(a); };

  const isRowHidden = (r: number) => !showHidden() && layout().hiddenRows.has(r);
  const isColHidden = (c: number) => !showHidden() && layout().hiddenCols.has(c);
  const stepRow = (r: number, d: number) => { const L = layout(); let n = r + d; while (n >= 1 && n <= L.maxRow && isRowHidden(n)) n += d; return Math.min(L.maxRow, Math.max(1, n)); };
  const stepCol = (c: number, d: number) => { const L = layout(); let n = c + d; while (n >= 1 && n <= L.maxCol && isColHidden(n)) n += d; return Math.min(L.maxCol, Math.max(1, n)); };

  function jumpTarget(r: number, c: number, dr: number, dc: number) {
    const w = ws()!; const L = layout();
    const has = (rr: number, cc: number) => { const v = w.rows.get(rr)?.get(cc)?.value; return v !== null && v !== undefined && v !== ""; };
    const inb = (rr: number, cc: number) => rr >= 1 && cc >= 1 && rr <= L.maxRow && cc <= L.maxCol;
    let rr = r + dr, cc = c + dc;
    if (!inb(rr, cc)) return { r, c };
    if (has(r, c) && has(rr, cc)) { while (inb(rr + dr, cc + dc) && has(rr + dr, cc + dc)) { rr += dr; cc += dc; } return { r: rr, c: cc }; }
    while (inb(rr, cc) && !has(rr, cc)) { rr += dr; cc += dc; }
    if (!inb(rr, cc)) { rr -= dr; cc -= dc; }
    return { r: rr, c: cc };
  }

  function moveBy(dr: number, dc: number, extend: boolean, jump = false) {
    const a = active(); const s = sel();
    const focus = extend ? { row: s.r2, col: s.c2 } : a;
    let r = focus.row, c = focus.col;
    if (jump) { const t = jumpTarget(r, c, dr, dc); r = t.r; c = t.c; }
    else { if (dr) r = stepRow(r, dr); if (dc) c = stepCol(c, dc); }
    if (extend) setSel({ r1: a.row, c1: a.col, r2: r, c2: c });
    else { setSel({ r1: r, c1: c, r2: r, c2: c }); setActive({ row: r, col: c }); }
    if (extend) gridApi?.scrollTo(r, c);
  }

  function goTo(r: number, c: number, sheet?: string) {
    const b = book(); if (!b) return;
    if (sheet) { const i = b.sheets.findIndex(s => s.sheet.title === sheet); if (i >= 0 && i !== sheetIdx()) selectSheet(i); }
    setSel({ r1: r, c1: c, r2: r, c2: c }); setActive({ row: r, col: c });
    queueMicrotask(() => gridApi?.scrollTo(r, c));
  }

  function selectSheet(i: number) {
    const b = book(); if (!b || i === sheetIdx()) return;
    commitEdit("none");
    const w = ws();
    if (w) uiMemo.set(w.title, { sel: sel(), active: active(), x: scrollPos.x, y: scrollPos.y });
    batch(() => {
      setSheetIdx(i);
      b.wb.activeSheetIndex = i;
      applySheetView(b, i);
      setFp(null);
      setLver(v => v + 1);
    });
    queueMicrotask(() => gridApi?.focus());
  }

  // ───────── edit ─────────
  function startEdit(row: number, col: number, initial?: string, src: "cell" | "bar" = "cell") {
    const b = book(), w = ws(); if (!b || !w) return;
    const raw = b.rawInputText(w.rows.get(row)?.get(col));
    setEditing({ row, col, text: initial ?? raw, src });
  }

  function commitEdit(move: "down" | "right" | "none" | "up" | "left" = "down") {
    const e = editing(); const b = book(), w = ws();
    if (!e || !b || !w) { setEditing(null); return; }
    setEditing(null);
    const raw = b.rawInputText(w.rows.get(e.row)?.get(e.col));
    if (e.text !== raw) {
      const rec = b.setInput(w, e.row, e.col, e.text);
      b.commit([rec]);
      setLive(b.ev.live);
      bump();
    }
    if (move !== "none") {
      const dr = move === "down" ? 1 : move === "up" ? -1 : 0, dc = move === "right" ? 1 : move === "left" ? -1 : 0;
      const r = dr ? stepRow(e.row, dr) : e.row, c = dc ? stepCol(e.col, dc) : e.col;
      setSel({ r1: r, c1: c, r2: r, c2: c }); setActive({ row: r, col: c });
    }
    queueMicrotask(() => gridApi?.focus());
  }

  const cancelEdit = () => { setEditing(null); queueMicrotask(() => gridApi?.focus()); };

  function applyRecords(recs: EditRecord[] | undefined) {
    if (!recs?.length) return;
    setLive(book()!.ev.live);
    bump();
    const last = recs[0]!;
    if (last.sheet !== ws()?.title) goTo(last.row, last.col, last.sheet);
    else goTo(last.row, last.col);
  }
  const doUndo = () => { commitEdit("none"); const b = book(); if (!b?.canUndo) return; applyRecords(b.undo()); };
  const doRedo = () => { commitEdit("none"); const b = book(); if (!b?.canRedo) return; applyRecords(b.redo()); };

  function clearSelection() {
    const b = book(), w = ws(); if (!b || !w) return;
    const recs = b.clearRange(w, sel());
    b.commit(recs); setLive(b.ev.live); bump();
    if (recs.length) toast(`${recs.length} sel dikosongkan`);
  }

  // ───────── clipboard ─────────
  let internalClip: { text: string; sel: Sel; cells: ({ value: any; styleId: number } | null)[][] } | null = null;

  function copySel(cut = false): string {
    const b = book(), w = ws(); if (!b || !w) return "";
    const n = normSel(sel());
    const text = b.toTsv(w, n);
    const cells: ({ value: any; styleId: number } | null)[][] = [];
    for (let r = n.r1; r <= n.r2; r++) {
      const row: ({ value: any; styleId: number } | null)[] = [];
      for (let c = n.c1; c <= n.c2; c++) { const cell = w.rows.get(r)?.get(c); row.push(cell ? { value: cell.value, styleId: cell.styleId } : null); }
      cells.push(row);
    }
    internalClip = { text, sel: n, cells };
    if (cut) { const recs = b.clearRange(w, n); b.commit(recs); setLive(b.ev.live); bump(); }
    return text;
  }

  function pasteText(text: string) {
    const b = book(), w = ws(); if (!b || !w) return;
    const n = normSel(sel());
    const recs: EditRecord[] = [];
    if (internalClip && internalClip.text === text) {
      const dr = n.r1 - internalClip.sel.r1, dc = n.c1 - internalClip.sel.c1;
      internalClip.cells.forEach((row, i) => row.forEach((snap, j) => {
        const r = n.r1 + i, c = n.c1 + j;
        if (!snap) { if (w.rows.get(r)?.get(c)) recs.push(b.setValueRaw(w, r, c, null)); return; }
        let v = snap.value;
        if (v && typeof v === "object" && v.kind === "formula") v = { ...v, formula: shiftRefs(v.formula ?? "", dr, dc), cachedValue: undefined };
        recs.push(b.setValueRaw(w, r, c, v, snap.styleId));
      }));
    } else {
      const grid = XlsxBook.parseTsv(text);
      grid.forEach((row, i) => row.forEach((t, j) => recs.push(b.setInput(w, n.r1 + i, n.c1 + j, t))));
    }
    b.commit(recs); setLive(b.ev.live); bump();
    if (recs.length) { const rows = Math.max(...recs.map(r => r.row)), cols = Math.max(...recs.map(r => r.col)); setSel({ r1: n.r1, c1: n.c1, r2: rows, c2: cols }); toast(`${recs.length} sel ditempel`); }
  }

  const isTyping = (t: EventTarget | null) => { const el = t as HTMLElement | null; return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable); };
  function onCopyEvt(e: ClipboardEvent, cut = false) {
    if (isTyping(e.target) || !ws()) return;
    e.clipboardData?.setData("text/plain", copySel(cut));
    e.preventDefault();
    toast(cut ? "Dipotong" : `Disalin ${selAddr(sel())}`, 1400);
  }
  function onPasteEvt(e: ClipboardEvent) {
    if (isTyping(e.target) || !ws()) return;
    const t = e.clipboardData?.getData("text/plain");
    if (t) { e.preventDefault(); pasteText(t); }
  }
  async function copyViaButton() {
    const text = copySel();
    try { await navigator.clipboard.writeText(text); toast(`Disalin ${selAddr(sel())}`, 1400); } catch { toast("Browser menolak akses clipboard — gunakan Ctrl+C"); }
  }
  async function pasteViaButton() {
    try { pasteText(await navigator.clipboard.readText()); } catch { toast("Gunakan Ctrl+V untuk menempel"); }
  }

  // ───────── keyboard ─────────
  function onGridKey(e: KeyboardEvent) {
    const w = ws(); if (!w) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (mod) {
      switch (k.toLowerCase()) {
        case "z": e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return;
        case "y": e.preventDefault(); doRedo(); return;
        case "f": e.preventDefault(); openFind(); return;
        case "a": e.preventDefault(); { const L = layout(); setSel({ r1: 1, c1: 1, r2: L.maxRow, c2: L.maxCol }); } return;
        case "s": e.preventDefault(); void saveXlsx(); return;
        case "c": case "x": case "v": return; // ditangani event clipboard
      }
    }
    switch (k) {
      case "ArrowDown": e.preventDefault(); moveBy(1, 0, e.shiftKey, mod); return;
      case "ArrowUp": e.preventDefault(); moveBy(-1, 0, e.shiftKey, mod); return;
      case "ArrowLeft": e.preventDefault(); moveBy(0, -1, e.shiftKey, mod); return;
      case "ArrowRight": e.preventDefault(); moveBy(0, 1, e.shiftKey, mod); return;
      case "Tab": e.preventDefault(); moveBy(0, e.shiftKey ? -1 : 1, false); return;
      case "Enter": e.preventDefault(); if (e.shiftKey) moveBy(-1, 0, false); else moveBy(1, 0, false); return;
      case "Home": e.preventDefault(); { const r = mod ? 1 : active().row; setSel({ r1: r, c1: 1, r2: r, c2: 1 }); setActive({ row: r, col: 1 }); gridApi?.scrollTo(r, 1); } return;
      case "End": if (mod) { e.preventDefault(); const { ext } = usedExtent(); setSel({ r1: ext.r, c1: ext.c, r2: ext.r, c2: ext.c }); setActive({ row: ext.r, col: ext.c }); gridApi?.scrollTo(ext.r, ext.c); } return;
      case "PageDown": e.preventDefault(); { const n = 20; const r = Math.min(layout().maxRow, active().row + n); setSel({ r1: r, c1: active().col, r2: r, c2: active().col }); setActive({ row: r, col: active().col }); } return;
      case "PageUp": e.preventDefault(); { const r = Math.max(1, active().row - 20); setSel({ r1: r, c1: active().col, r2: r, c2: active().col }); setActive({ row: r, col: active().col }); } return;
      case "F2": e.preventDefault(); startEdit(active().row, active().col); return;
      case "F3": e.preventDefault(); stepHit(e.shiftKey ? -1 : 1); return;
      case "Delete": case "Backspace": e.preventDefault(); clearSelection(); return;
      case "Escape": setCtx(null); setMenu(null); return;
    }
    if (k.length === 1 && !mod && !e.altKey) { e.preventDefault(); startEdit(active().row, active().col, k); }
  }

  const usedExtent = () => {
    const w = ws(); let r = 1, c = 1;
    if (w) for (const [rk, row] of w.rows) for (const ck of row.keys()) { if (rk > r) r = rk; if (ck > c) c = ck; }
    return { ext: { r, c } };
  };

  // ───────── formula bar / name box ─────────
  const activeCell = createMemo(() => { ver(); const w = ws(); const a = active(); return w?.rows.get(a.row)?.get(a.col); });
  const barText = () => {
    const e = editing();
    if (e) return e.text;
    return book()?.rawInputText(activeCell()) ?? "";
  };
  const nameText = () => nameBox() ?? selAddr(sel());

  function submitName(text: string) {
    setNameBox(null);
    const b = book(); if (!b) return;
    const t = text.trim();
    const direct = parseAddress(t);
    if (direct && /^[A-Za-z]{1,3}\d+(:[A-Za-z]{1,3}\d+)?$/.test(t.replace(/\$/g, ""))) { setSel({ r1: direct.r1, c1: direct.c1, r2: direct.r2, c2: direct.c2 }); setActive({ row: direct.r1, col: direct.c1 }); gridApi?.scrollTo(direct.r1, direct.c1); gridApi?.focus(); return; }
    const dn = b.wb.definedNames?.find(d => d.name.toLowerCase() === t.toLowerCase());
    if (dn) {
      try {
        const pr = parseSheetRange(dn.value.replace(/\$/g, ""));
        const bb = pr.bounds;
        goTo(bb.minRow, bb.minCol, pr.sheet);
        setSel({ r1: bb.minRow, c1: bb.minCol, r2: bb.maxRow, c2: bb.maxCol });
        gridApi?.focus();
        return;
      } catch { /* bukan range */ }
    }
    toast(`Alamat/nama “${t}” tidak dikenal`);
  }

  // ───────── autofilter ─────────
  const [fp, setFp] = createSignal<{ col: number; x: number; y: number; items: { value: string; count: number }[]; checked: Set<string>; q: string } | null>(null);

  function openFilterPopup(col: number, anchor: HTMLElement) {
    const b = book(), w = ws(), f = b && w ? b.filterOf(w) : undefined;
    if (!b || !w || !f) return;
    const items = b.uniqueValues(w, f, col);
    const cur = f.selected.get(col);
    const rc = anchor.getBoundingClientRect();
    setFp({ col, x: Math.min(rc.left, window.innerWidth - 276), y: rc.bottom + 4, items, checked: new Set(cur ?? items.map(i => i.value)), q: "" });
  }

  function applyFilterPopup() {
    const p = fp(), b = book(), w = ws(); if (!p || !b || !w) return;
    const f = b.filterOf(w); if (!f) return;
    const all = p.checked.size >= p.items.length;
    b.setFilterColumn(w, f, p.col, all ? null : new Set(p.checked));
    setFp(null);
    bumpLayout();
    const hidden = f.hiddenRows.size;
    toast(all ? "Filter kolom dihapus" : `Filter: ${hidden} baris disembunyikan`);
  }

  function toggleFilter() {
    const b = book(), w = ws(); if (!b || !w) return;
    if (b.filterOf(w)) { b.disableFilter(w); toast("AutoFilter dimatikan"); }
    else { const f = b.enableFilter(w, sel()); if (f) toast(`AutoFilter diterapkan pada ${addr(f.range.minRow, f.range.minCol)}:${addr(f.range.maxRow, f.range.maxCol)}`); else toast("Tidak ada data untuk difilter"); }
    bumpLayout();
  }

  // ───────── freeze, resize, hide ─────────
  function doFreeze(kind: "row" | "col" | "both" | "cell" | "none") {
    const b = book(), w = ws(); if (!b || !w) return;
    const a = active();
    const r = kind === "row" ? 1 : kind === "col" ? 0 : kind === "both" ? 1 : kind === "cell" ? a.row - 1 : 0;
    const c = kind === "row" ? 0 : kind === "col" ? 1 : kind === "both" ? 1 : kind === "cell" ? a.col - 1 : 0;
    b.freeze(w, Math.max(0, r), Math.max(0, c));
    setMenu(null); bumpLayout();
    toast(kind === "none" ? "Pembekuan dilepas" : `Dibekukan: ${Math.max(0, r)} baris, ${Math.max(0, c)} kolom`);
  }

  function resizeColumn(col: number, px: number) {
    const b = book(), w = ws(); if (!b || !w) return;
    b.resizeColumn(w, col, pxToColChars(px));
    bumpLayout();
  }
  function resizeRow(row: number, px: number) {
    const b = book(), w = ws(); if (!b || !w) return;
    b.resizeRow(w, row, pxToPt(px));
    bumpLayout();
  }
  function autofitColumn(col: number) {
    const b = book(), w = ws(); if (!b || !w) return;
    let max = 0;
    let n = 0;
    for (const [r, row] of w.rows) {
      const cell = row.get(col); if (!cell || cell.value === null) continue;
      if (++n > 3000) break;
      const st = b.styleOf(w, cell);
      const px = measureTextPx(b.cellText(w, cell), `${st.italic ? "italic " : ""}${st.bold ? "bold " : ""}${(st.sizePt * 96) / 72}px "${st.fontName}", Segoe UI, sans-serif`) + 12;
      if (r > 0 && px > max) max = px;
    }
    resizeColumn(col, Math.max(24, Math.min(520, max || 64)));
  }

  function hideSelection(kind: "rows" | "cols") {
    const b = book(), w = ws(); if (!b || !w) return;
    const n = normSel(sel());
    if (kind === "rows") hideRows(w, n.r1, n.r2); else hideColumns(w, n.c1, n.c2);
    b.dirty = true; setCtx(null); bumpLayout();
  }
  function unhideAround() {
    const b = book(), w = ws(); if (!b || !w) return;
    const n = normSel(sel());
    unhideRows(w, Math.max(1, n.r1 - 1), n.r2 + 1); unhideColumns(w, Math.max(1, n.c1 - 1), n.c2 + 1);
    b.dirty = true; setCtx(null); bumpLayout();
  }

  // ───────── pencarian ─────────
  const [q, setQ] = createSignal("");
  const [scope, setScope] = createSignal<"sheet" | "book" | "sel">("sheet");
  const [fCase, setFCase] = createSignal(false);
  const [fWhole, setFWhole] = createSignal(false);
  const [fRegex, setFRegex] = createSignal(false);
  const [fFormula, setFFormula] = createSignal(false);
  const [fCols, setFCols] = createSignal("");
  const [res, setRes] = createSignal<SearchResult | null>(null);
  const [curHit, setCurHit] = createSignal(-1);
  const [hitLimit, setHitLimit] = createSignal(300);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let findInput: HTMLInputElement | undefined;

  function openFind() {
    const b = book(), w = ws();
    setPanel("find");
    const a = active();
    const t = b && w && sel().r1 === sel().r2 && sel().c1 === sel().c2 ? b.textAt(w, a.row, a.col) : "";
    if (t && !q() && t.length < 60) setQ(t);
    queueMicrotask(() => { findInput?.focus(); findInput?.select(); });
  }

  function runSearch() {
    const b = book(), w = ws();
    if (!b || !w || !q()) { setRes(null); setCurHit(-1); return; }
    const r = b.search({
      query: q(), sheet: w, allSheets: scope() === "book", selection: scope() === "sel" ? normSel(sel()) : undefined,
      matchCase: fCase(), wholeCell: fWhole(), regex: fRegex(), inFormulas: fFormula(), columns: fCols() || undefined,
    });
    batch(() => { setRes(r); setCurHit(r.hits.length ? 0 : -1); setHitLimit(300); });
    if (r.hits.length) { const h = r.hits[0]!; if (scope() !== "book" || h.sheet === ws()?.title) { /* biarkan pengguna menekan Enter untuk melompat */ } }
  }
  createEffect(on([q, scope, fCase, fWhole, fRegex, fFormula, fCols, sheetIdx, ver], () => {
    clearTimeout(searchTimer);
    if (panel() !== "find") return;
    searchTimer = setTimeout(runSearch, 180);
  }, { defer: true }));

  const hitSet = createMemo(() => {
    const r = res(); const t = ws()?.title;
    const s = new Set<number>();
    if (panel() !== "find" || !r || !t) return s;
    for (const h of r.hits) if (h.sheet === t) s.add(h.row * 16385 + h.col);
    return s;
  });
  const curHitKey = createMemo(() => {
    const r = res(); const i = curHit();
    const h = r?.hits[i];
    return h && h.sheet === ws()?.title ? h.row * 16385 + h.col : undefined;
  });

  function gotoHit(i: number) {
    const r = res(); const h = r?.hits[i]; if (!h) return;
    setCurHit(i);
    goTo(h.row, h.col, h.sheet);
  }
  function stepHit(d: number) {
    const r = res(); if (!r?.hits.length) { openFind(); return; }
    const n = r.hits.length;
    gotoHit(((curHit() + d) % n + n) % n);
  }

  // ───────── export ─────────
  async function saveXlsx() {
    const b = book(); if (!b) return;
    commitEdit("none");
    try {
      setBusy("Menyusun berkas…");
      const bytes = await b.toBytes();
      const name = b.saveName;
      downloadBlob(name, new Blob([bytes as BlobPart], { type: b.isMacro ? "application/vnd.ms-excel.sheet.macroEnabled.12" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      pushLog(logEntry("ok", "Simpan", `Diunduh sebagai ${name} (${formatBytes(bytes.length)})${b.isMacro ? " — biner VBA dipertahankan" : ""}`));
      toast(`Diunduh: ${name}`);
      b.dirty = false; bump();
    } catch (e: any) {
      pushLog(logEntry("error", "Simpan", `Gagal menyimpan: ${e?.message ?? e}`, e?.stack));
      setPanel("log"); toast("Gagal menyimpan — lihat Log");
    } finally { setBusy(null); }
  }

  function exportCsv(mode: "view" | "raw" | "sel") {
    const b = book(), w = ws(); if (!b || !w) return;
    setMenu(null);
    const L = layout();
    const csv = b.toCsv(w, { sel: mode === "sel" ? sel() : undefined, raw: mode === "raw", skipHidden: !showHidden(), hiddenRows: L.hiddenRows, hiddenCols: L.hiddenCols });
    const name = `${b.fileName.replace(/\.[^.]+$/, "")}-${w.title.replace(/[^\w.-]+/g, "_")}.csv`;
    downloadBlob(name, new Blob([csv], { type: "text/csv;charset=utf-8" }));
    pushLog(logEntry("ok", "CSV", `Sheet «${w.title}» diekspor ke ${name} (${formatBytes(csv.length)}; ${mode === "raw" ? "nilai mentah" : mode === "sel" ? "seleksi " + selAddr(sel()) : "teks seperti tampilan"})`));
    toast(`CSV diunduh: ${name}`);
  }

  // ───────── formula eval dialog ─────────
  const [evalText, setEvalText] = createSignal("");
  const [evalOut, setEvalOut] = createSignal<{ value?: string; error?: string; steps: { expr: string; value: string }[]; cached?: string } | null>(null);

  function openEval() {
    const b = book(), w = ws(); if (!b || !w) return;
    const cell = w.rows.get(active().row)?.get(active().col);
    const f = (cell?.value as any)?.kind === "formula" ? "=" + (cell!.value as any).formula : evalText() || "=SUM(1,2,3)*2";
    setEvalText(f);
    setDialog("eval");
    runEval(f);
  }

  function runEval(text = evalText()) {
    const b = book(), w = ws(); if (!b || !w) return;
    const prev = b.ev.live;
    b.ev.live = true; b.ev.invalidate();
    const steps: { expr: string; value: string }[] = [];
    try {
      const ctxCell = { ws: w, row: active().row, col: active().col };
      const val = b.ev.evalTextRaw(text, ctxCell, (n: FNode, v: Val) => {
        if (n.t === "num" || n.t === "str" || n.t === "bool" || n.t === "empty") return;
        const s = nodeToString(n);
        const f = fmtVal(v);
        if (steps[steps.length - 1]?.expr !== s) steps.push({ expr: s, value: f });
      });
      const sc = b.ev.scalar(val);
      const cell = w.rows.get(active().row)?.get(active().col);
      const fv: any = cell?.value;
      setEvalOut({ value: fmtVal(val === sc ? sc : val), steps, cached: fv?.kind === "formula" && fv.cachedValue !== undefined ? String(fv.cachedValue) : undefined, error: isErr(sc) ? sc.code : undefined });
    } catch (e: any) {
      setEvalOut({ error: e?.message ?? String(e), steps });
    } finally { b.ev.live = prev; b.ev.invalidate(); b.ev.live = prev; }
  }

  function applyEvalToCell() {
    const b = book(), w = ws(); if (!b || !w) return;
    const rec = b.setInput(w, active().row, active().col, evalText());
    b.commit([rec]); setLive(b.ev.live); bump(); setDialog(null); toast(`Ditulis ke ${addr(active().row, active().col)}`);
  }

  function toggleLive() {
    const b = book(); if (!b) return;
    b.ev.live = !b.ev.live; b.invalidate(); setLive(b.ev.live); bump();
    toast(b.ev.live ? "Formula dihitung ulang oleh mesin evaluasi" : "Menampilkan nilai cache dari berkas");
  }

  // ───────── debug sel ─────────
  const debugInfo = createMemo(() => {
    ver(); lver();
    if (dialog() !== "debug") return null;
    const b = book(), w = ws(); if (!b || !w) return null;
    const { row, col } = active();
    const cell = w.rows.get(row)?.get(col);
    const f: any = cell?.value;
    const isF = f && typeof f === "object" && f.kind === "formula";
    const prev = b.ev.live;
    b.ev.live = true; b.ev.invalidate();
    const computed = isF ? b.ev.evalFormulaCell(w, row, col) : undefined;
    b.ev.live = prev; b.ev.invalidate();
    const inRange = (rg: any) => row >= rg.minRow && row <= rg.maxRow && col >= rg.minCol && col <= rg.maxCol;
    const merge = w.mergedCells?.find(inRange);
    const dim = [...w.columnDimensions.values()].find(d => col >= d.min && col <= d.max);
    const L = layout();
    const dbg: any = {
      alamat: addr(row, col), sheet: w.title, baris: row, kolom: col, kolomHuruf: columnLetterFromIndex(col),
      nilaiMentah: cell ? { tipe: f === null ? "null" : f instanceof Date ? "Date" : typeof f === "object" ? f.kind : typeof f, nilai: f } : "(sel tidak ada di file)",
      teksTampilan: cell ? b.cellText(w, cell) : "",
      formula: isF ? { teks: "=" + f.formula, jenis: f.t, ref: f.ref, si: f.si, cache: f.cachedValue, cacheTipe: f.cachedValueType, hasilMesin: isErr(computed as any) ? (computed as any).code : computed, sama: String(f.cachedValue ?? "") === String(isErr(computed as any) ? (computed as any).code : computed ?? "") } : undefined,
      style: cell ? {
        styleId: cell.styleId, numberFormat: b.styleOf(w, cell).numFmt,
        font: getCellFont(b.wb, cell), fill: getCellFill(b.wb, cell), border: getCellBorder(b.wb, cell), alignment: getCellAlignment(b.wb, cell),
        resolved: b.styleOf(w, cell),
      } : undefined,
      gabungan: merge ? `${addr(merge.minRow, merge.minCol)}:${addr(merge.maxRow, merge.maxCol)}` : undefined,
      hyperlink: b.hyperlinkAt(w, row, col), komentar: b.commentAt(w, row, col),
      dataValidation: w.dataValidations?.filter(dv => dv.sqref.ranges.some(inRange)).map(dv => ({ type: dv.type, operator: dv.operator, formula1: dv.formula1, formula2: dv.formula2, prompt: dv.prompt })),
      conditionalFormatting: w.conditionalFormatting?.filter(cf => cf.sqref.ranges.some(inRange)).map(cf => cf.rules.map(r => ({ type: r.type, priority: r.priority, operator: r.operator, formulas: r.formulas, dxfId: r.dxfId }))),
      tabel: w.tables?.filter(t => { const bb = parseAddress(t.ref); return bb && row >= bb.r1 && row <= bb.r2 && col >= bb.c1 && col <= bb.c2; }).map(t => t.displayName),
      dimensi: { kolom: dim, baris: w.rowDimensions.get(row), lebarPx: Math.round(colW(L, col)), tinggiPx: Math.round(L.rowStart[row + 1]! - L.rowStart[row]!), kolomHidden: L.hiddenCols.has(col), barisHidden: L.hiddenRows.has(row) },
      filter: b.filterOf(w) ? { rentang: b.filterOf(w)!.range, kolomTerfilter: [...b.filterOf(w)!.selected.keys()] } : undefined,
      gambarDiSel: b.drawingsOf(w).filter(d => d.anchorCell.row === row && d.anchorCell.col === col).map(d => ({ jenis: d.kind, nama: d.name, format: d.format, byte: d.bytes, anchor: d.anchor })),
    };
    return dbg;
  });

  // ───────── stats seleksi ─────────
  const selStats = createMemo(() => {
    ver();
    const b = book(), w = ws(); if (!b || !w) return null;
    const n = normSel(sel());
    const area = (n.r2 - n.r1 + 1) * (n.c2 - n.c1 + 1);
    if (area <= 1) return null;
    let sum = 0, cnt = 0, nonEmpty = 0, min = Infinity, max = -Infinity;
    const rows = w.rows;
    const rkeys = area > 200000 ? [...rows.keys()].filter(r => r >= n.r1 && r <= n.r2) : null;
    const each = (r: number) => {
      const row = rows.get(r); if (!row) return;
      for (const [c, cell] of row) {
        if (c < n.c1 || c > n.c2 || cell.value === null) continue;
        nonEmpty++;
        const v = b.ev.cellValue(w, r, c);
        if (typeof v === "number") { sum += v; cnt++; if (v < min) min = v; if (v > max) max = v; }
      }
    };
    if (rkeys) rkeys.forEach(each); else for (let r = n.r1; r <= n.r2; r++) each(r);
    return { rows: n.r2 - n.r1 + 1, cols: n.c2 - n.c1 + 1, sum, cnt, nonEmpty, min, max, avg: cnt ? sum / cnt : 0 };
  });
  const fmtN = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 4 }));

  // ───────── drag & drop ─────────
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragOver(false); void openFile(e.dataTransfer?.files?.[0]); };

  const openLink = (_r: number, _c: number, link: any) => {
    const b = book(); if (!b) return;
    if (link.location) { try { const pr = parseSheetRange(link.location.replace(/\$/g, "")); goTo(pr.bounds.minRow, pr.bounds.minCol, pr.sheet); } catch { toast(`Lokasi ${link.location} tidak valid`); } }
    else if (link.target && /^(https?:|mailto:)/i.test(link.target)) window.open(link.target, "_blank", "noopener,noreferrer");
    else toast(`Hyperlink tidak dibuka: ${link.target ?? ""}`);
  };

  // ───────── tabs ─────────
  const tabs = createMemo(() => {
    ver();
    const b = book(); if (!b) return [];
    return b.sheets.map((s, i) => ({ i, s })).filter(({ s, i }) => s.state === "visible" || showHidden() || i === sheetIdx());
  });
  const tabColor = (s: any): string | undefined => {
    const c = s.kind === "worksheet" ? (s.sheet.sheetProperties as any)?.tabColor : undefined;
    return c ? resolveColor(c, book()?.styles.palette ?? []) : undefined;
  };

  // ───────── render ─────────
  const Btn = (p: { icon?: string; label?: string; title?: string; on?: boolean; disabled?: boolean; primary?: boolean; dot?: boolean; onClick: (e: MouseEvent) => void; children?: JSX.Element }) => (
    <button class="xl-btn" classList={{ on: p.on, primary: p.primary, dot: p.dot }} title={p.title ?? p.label} disabled={p.disabled} onClick={p.onClick}>
      <Show when={p.icon}><Ic n={p.icon!} /></Show>
      <Show when={p.label}><span>{p.label}</span></Show>
      {p.children}
    </button>
  );

  return (
    <div
      ref={rootEl}
      class={`xl-root ${props.class ?? ""}`}
      style={{ height: props.height ?? "78vh" }}
      onCopy={e => onCopyEvt(e)}
      onCut={e => onCopyEvt(e, true)}
      onPaste={onPasteEvt}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={onDrop}
    >
      <input ref={fileInput} type="file" hidden accept=".xlsx,.xlsm,.xltx,.xltm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12" onChange={e => { void openFile(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />

      {/* toolbar */}
      <div class="xl-toolbar">
        <div class="xl-title" title={book()?.fileName}>
          <i>X</i>
          <span>{book()?.fileName ?? "XLSX Preview"}</span>
          <Show when={book()?.isMacro}><span class="xl-tag" title="Workbook mengandung makro VBA (tidak dieksekusi)">XLSM · makro</span></Show>
        </div>
        <div class="xl-group">
          <Btn icon="open" label="Buka" title="Buka berkas Excel lokal (.xlsx / .xlsm)" onClick={() => fileInput.click()} />
          <Btn icon="sample" title="Muat workbook contoh" onClick={() => void openSample()} />
          <Btn icon="save" label="Simpan" primary={!!book()?.dirty} dot={!!book()?.dirty} disabled={!book()} title="Unduh perubahan sebagai .xlsx/.xlsm (Ctrl+S)" onClick={() => void saveXlsx()} />
          <div class="xl-menu-wrap">
            <Btn icon="csv" label="CSV" disabled={!ws()} title="Unduh sheet sebagai CSV" onClick={() => setMenu(m => (m === "csv" ? null : "csv"))} />
            <Show when={menu() === "csv"}>
              <div class="xl-menu">
                <button onClick={() => exportCsv("view")}>Sheet aktif — teks seperti tampilan<small>format angka/tanggal</small></button>
                <button onClick={() => exportCsv("raw")}>Sheet aktif — nilai mentah<small>tanpa format</small></button>
                <button onClick={() => exportCsv("sel")} disabled={sel().r1 === sel().r2 && sel().c1 === sel().c2}>Seleksi saja ({selAddr(sel())})</button>
                <hr /><small style={{ padding: "2px 10px", display: "block" }}>Baris/kolom tersembunyi {showHidden() ? "ikut diekspor" : "dilewati"} · UTF-8 BOM</small>
              </div>
            </Show>
          </div>
        </div>
        <div class="xl-group">
          <Btn icon="undo" title="Urungkan (Ctrl+Z)" disabled={!book()?.canUndo} onClick={doUndo} />
          <Btn icon="redo" title="Ulangi (Ctrl+Y)" disabled={!book()?.canRedo} onClick={doRedo} />
          <Btn title="Salin seleksi (Ctrl+C)" label="Salin" disabled={!ws()} onClick={() => void copyViaButton()} />
          <Btn title="Tempel (Ctrl+V)" label="Tempel" disabled={!ws()} onClick={() => void pasteViaButton()} />
        </div>
        <div class="xl-group">
          <Btn icon="search" label="Cari" on={panel() === "find"} disabled={!book()} title="Cari (Ctrl+F)" onClick={() => (panel() === "find" ? setPanel(null) : openFind())} />
          <Btn icon="filter" label="Filter" on={!!filterState()} disabled={!ws()} title="AutoFilter kolom" onClick={toggleFilter} />
          <div class="xl-menu-wrap">
            <Btn icon="freeze" label="Freeze" on={(layout().fr + layout().fc) > 0} disabled={!ws()} title="Bekukan baris/kolom" onClick={() => setMenu(m => (m === "freeze" ? null : "freeze"))} />
            <Show when={menu() === "freeze"}>
              <div class="xl-menu">
                <button onClick={() => doFreeze("row")}>Bekukan baris teratas</button>
                <button onClick={() => doFreeze("col")}>Bekukan kolom pertama</button>
                <button onClick={() => doFreeze("both")}>Bekukan baris & kolom pertama</button>
                <button onClick={() => doFreeze("cell")}>Bekukan hingga sel aktif ({addr(active().row, active().col)})</button>
                <hr />
                <button onClick={() => doFreeze("none")} disabled={(layout().fr + layout().fc) === 0}>Lepas pembekuan</button>
              </div>
            </Show>
          </div>
          <div class="xl-menu-wrap">
            <Btn icon="eye" label="Tampilan" title="Opsi tampilan" onClick={() => setMenu(m => (m === "view" ? null : "view"))} />
            <Show when={menu() === "view"}>
              <div class="xl-menu">
                <label><input type="checkbox" checked={gridlines()} onChange={e => setGridlines(e.currentTarget.checked)} /> Garis grid</label>
                <label><input type="checkbox" checked={showFormulas()} onChange={e => setShowFormulas(e.currentTarget.checked)} /> Tampilkan rumus (bukan hasil)</label>
                <label><input type="checkbox" checked={showHidden()} onChange={e => { setShowHidden(e.currentTarget.checked); bumpLayout(); }} /> Tampilkan baris/kolom/sheet tersembunyi</label>
                <label><input type="checkbox" checked={live()} onChange={toggleLive} /> Hitung ulang formula (mesin evaluasi)</label>
              </div>
            </Show>
          </div>
        </div>
        <div class="xl-group">
          <Btn icon="sigma" label="Evaluasi" disabled={!ws()} title="Evaluasi formula (langkah demi langkah)" onClick={openEval} />
          <Btn icon="bug" label="Debug sel" disabled={!ws()} title="Informasi debug sel terpilih" onClick={() => setDialog("debug")} />
        </div>
        <span class="xl-spacer" />
        <div class="xl-group">
          <Btn icon="info" label="Info" on={panel() === "info"} disabled={!book()} title="Informasi workbook & worksheet" onClick={() => setPanel(p => (p === "info" ? null : "info"))} />
          <Btn icon="log" label="Log" on={panel() === "log"} title="Log pembacaan (berhasil / gagal / makro)" onClick={() => setPanel(p => (p === "log" ? null : "log"))}>
            <Show when={countLevel("error") > 0}><span class="badge">{countLevel("error")}</span></Show>
            <Show when={countLevel("error") === 0 && countLevel("warn") > 0}><span class="badge warn">{countLevel("warn")}</span></Show>
          </Btn>
        </div>
      </div>

      {/* formula bar */}
      <div class="xl-fbar">
        <input
          class="xl-namebox" value={nameText()} spellcheck={false} title="Name box — ketik alamat (B2:C5) atau nama terdefinisi lalu Enter"
          onFocus={e => e.currentTarget.select()} onInput={e => setNameBox(e.currentTarget.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); submitName(e.currentTarget.value); } else if (e.key === "Escape") { setNameBox(null); gridApi?.focus(); } }}
          onBlur={() => setNameBox(null)}
        />
        <button class="xl-fx" title="Evaluasi formula" onClick={openEval} disabled={!ws()}>fx</button>
        <input
          class="xl-fin" value={barText()} spellcheck={false} disabled={!ws()} placeholder="Nilai atau formula sel aktif"
          onInput={e => { const a = active(); const cur = editing(); if (!cur) setEditing({ row: a.row, col: a.col, text: e.currentTarget.value, src: "bar" }); else setEditing({ ...cur, text: e.currentTarget.value }); }}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commitEdit("down"); } else if (e.key === "Escape") { cancelEdit(); } }}
        />
      </div>

      {/* grid + panel */}
      <div class="xl-main">
        <div class="xl-gridwrap">
          <Show when={ws()} keyed fallback={
            <div class="xl-empty">
              <Show when={busy()} fallback={
                <div>
                  <h3>{sheetRef()?.kind === "chartsheet" ? "Chartsheet" : "Belum ada workbook"}</h3>
                  <p>{sheetRef()?.kind === "chartsheet" ? "Sheet ini berisi grafik penuh (chartsheet) yang belum dirender di preview." : "Buka berkas .xlsx/.xlsm atau muat contoh."}</p>
                </div>
              }>
                <div><div class="xl-spin" /><div>{busy()}</div></div>
              </Show>
            </div>
          }>
            {w => (
              <XlsxGrid
                book={book()!}
                sheet={w}
                version={ver}
                layoutVersion={lver}
                layout={layout}
                showHidden={showHidden}
                showGridlines={gridlines}
                showFormulas={showFormulas}
                sel={sel}
                active={active}
                onSelect={(s, a) => onSelect(s, a)}
                hits={hitSet}
                currentHit={curHitKey}
                editing={() => { const e = editing(); return e && e.src === "cell" ? e : null; }}
                onStartEdit={(r, c, i) => startEdit(r, c, i)}
                onEditText={t => setEditing(e => (e ? { ...e, text: t } : e))}
                onCommitEdit={commitEdit}
                onCancelEdit={cancelEdit}
                onKeyDown={onGridKey}
                onResizeColumn={resizeColumn}
                onResizeRow={resizeRow}
                onAutofitColumn={autofitColumn}
                onOpenFilter={openFilterPopup}
                filter={filterState}
                onZoomWheel={d => setZoom(z => Math.min(3, Math.max(0.4, +(z + d).toFixed(2))))}
                onContextMenu={(e, r, c) => setCtx({ x: e.clientX, y: e.clientY, row: r, col: c })}
                onLink={openLink}
                ref={api => (gridApi = api)}
                initialScroll={uiMemo.get(w.title) ? { x: uiMemo.get(w.title)!.x, y: uiMemo.get(w.title)!.y } : undefined}
                onScrollChange={(x, y) => (scrollPos = { x, y })}
              />
            )}
          </Show>
        </div>

        <Show when={panel()}>
          <aside class="xl-side">
            <div class="xl-side-head">
              <div class="xl-tabs-mini">
                <button classList={{ on: panel() === "find" }} onClick={() => openFind()}>Cari</button>
                <button classList={{ on: panel() === "info" }} onClick={() => setPanel("info")}>Info</button>
                <button classList={{ on: panel() === "log" }} onClick={() => setPanel("log")}>Log</button>
              </div>
              <button class="xl-x" onClick={() => setPanel(null)} title="Tutup">×</button>
            </div>
            <div class="xl-side-body">
              {/* CARI */}
              <Show when={panel() === "find"}>
                <input ref={findInput} class="xl-input" placeholder="Cari teks / angka…" value={q()} onInput={e => setQ(e.currentTarget.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (!res()) runSearch(); else stepHit(e.shiftKey ? -1 : 1); } }} />
                <div class="xl-row-inline">
                  <span class="xl-chip" classList={{ on: fCase() }} onClick={() => setFCase(v => !v)} title="Samakan huruf besar/kecil">Aa</span>
                  <span class="xl-chip" classList={{ on: fWhole() }} onClick={() => setFWhole(v => !v)} title="Seluruh isi sel harus sama">Sel utuh</span>
                  <span class="xl-chip" classList={{ on: fRegex() }} onClick={() => setFRegex(v => !v)} title="Ekspresi reguler">.*</span>
                  <span class="xl-chip" classList={{ on: fFormula() }} onClick={() => setFFormula(v => !v)} title="Cari juga di teks formula">Formula</span>
                </div>
                <div class="xl-row-inline">
                  <select class="xl-select" value={scope()} onChange={e => setScope(e.currentTarget.value as any)} style={{ flex: "1" }}>
                    <option value="sheet">Sheet ini</option>
                    <option value="book">Seluruh workbook (lintas sheet)</option>
                    <option value="sel">Hanya seleksi</option>
                  </select>
                </div>
                <input class="xl-input" placeholder="Batasi kolom — mis. B, D:F (kosong = semua)" value={fCols()} onInput={e => setFCols(e.currentTarget.value)} />
                <Show when={res()}>
                  {r => (
                    <>
                      <div class="xl-row-inline" style={{ "justify-content": "space-between", "margin-top": "12px" }}>
                        <div>
                          <b>{r().hits.length.toLocaleString()}</b> hasil{r().truncated ? "+" : ""}
                          <span style={{ color: "var(--xl-muted)" }}> · {r().perSheet.size} sheet · {r().ms.toFixed(0)} ms</span>
                        </div>
                        <div>
                          <button class="xl-btn" style={{ height: "26px", padding: "0 8px" }} onClick={() => stepHit(-1)} title="Sebelumnya (Shift+F3)">↑</button>
                          <button class="xl-btn" style={{ height: "26px", padding: "0 8px" }} onClick={() => stepHit(1)} title="Berikutnya (F3)">↓</button>
                        </div>
                      </div>
                      <Show when={r().error}><div class="xl-result err">{r().error}</div></Show>
                      <Show when={r().perSheet.size > 1}>
                        <div class="xl-row-inline">
                          <For each={[...r().perSheet.entries()]}>{([s, n]) => <span class="xl-tag">{s}: {n}</span>}</For>
                        </div>
                      </Show>
                      <ul class="xl-hitlist">
                        <For each={r().hits.slice(0, hitLimit())}>
                          {(h: SearchHit, i) => (
                            <li classList={{ cur: i() === curHit() }} onClick={() => gotoHit(i())} title={h.formula ?? h.text}>
                              <span class="sh">{h.sheet}</span><span class="ad">{h.address}</span>
                              <span class="tx">{h.matchedIn === "formula" ? h.formula : h.text}</span>
                            </li>
                          )}
                        </For>
                      </ul>
                      <Show when={r().hits.length > hitLimit()}>
                        <button class="xl-btn" style={{ width: "100%", "justify-content": "center", "margin-top": "8px" }} onClick={() => setHitLimit(n => n + 500)}>Tampilkan lebih banyak ({r().hits.length - hitLimit()} lagi)</button>
                      </Show>
                    </>
                  )}
                </Show>
                <Show when={!res() && q()}><p style={{ color: "var(--xl-muted)" }}>Mencari…</p></Show>
                <Show when={!q()}>
                  <p style={{ color: "var(--xl-muted)", "margin-top": "14px" }}>
                    Ketik kata kunci. Pilih <b>Seluruh workbook</b> untuk mencari antar worksheet; hasil menampilkan jumlah, sheet, dan alamat sel. <span class="xl-kbd">F3</span> / <span class="xl-kbd">Shift+F3</span> untuk berpindah.
                  </p>
                </Show>
              </Show>

              {/* INFO */}
              <Show when={panel() === "info" && book()}>
                <For each={[...workbookInfo(book()!), ...(ws() ? sheetInfo(book()!, ws()!) : [])]}>
                  {g => (
                    <>
                      <h4>{g.title}</h4>
                      <dl class="xl-kv"><For each={g.rows}>{r => (<><dt>{r.label}</dt><dd>{r.value}</dd></>)}</For></dl>
                    </>
                  )}
                </For>
                <h4>Daftar sheet</h4>
                <table class="xl-table">
                  <thead><tr><th>#</th><th>Nama</th><th>Jenis</th><th>Status</th></tr></thead>
                  <tbody><For each={book()!.sheets}>{(s, i) => <tr style={{ cursor: "pointer" }} onClick={() => s.kind === "worksheet" && selectSheet(i())}><td>{i() + 1}</td><td>{s.sheet.title}</td><td>{s.kind}</td><td>{s.state}</td></tr>}</For></tbody>
                </table>
                <Show when={book()!.wb.definedNames?.length}>
                  <h4>Defined names</h4>
                  <table class="xl-table"><tbody><For each={book()!.wb.definedNames}>{d => <tr><td class="mono">{d.name}</td><td class="mono">{d.value}</td></tr>}</For></tbody></table>
                </Show>
                <h4>Mesin formula</h4>
                <p style={{ margin: 0, color: "var(--xl-muted)" }}>{SUPPORTED_FUNCTIONS.length} fungsi: {SUPPORTED_FUNCTIONS.join(", ")}</p>
              </Show>

              {/* LOG */}
              <Show when={panel() === "log"}>
                <div class="xl-row-inline">
                  <span class="xl-tag" style={{ color: "var(--xl-ok)" }}>✔ {countLevel("ok")}</span>
                  <span class="xl-tag" style={{ color: "#2563eb" }}>ℹ {countLevel("info")}</span>
                  <span class="xl-tag" style={{ color: "#d97706" }}>⚠ {countLevel("warn")}</span>
                  <span class="xl-tag" style={{ color: "var(--xl-err)" }}>✖ {countLevel("error")}</span>
                  <span class="xl-spacer" />
                  <button class="xl-btn" style={{ height: "26px" }} onClick={() => { void navigator.clipboard?.writeText(logs().map(l => `[${l.level}] ${l.area}: ${l.message}${l.detail ? "\n" + l.detail : ""}`).join("\n")); toast("Log disalin"); }}>Salin</button>
                  <button class="xl-btn" style={{ height: "26px" }} onClick={() => setLogs([])}>Bersihkan</button>
                </div>
                <Show when={logs().length === 0}><p style={{ color: "var(--xl-muted)" }}>Belum ada log.</p></Show>
                <ul class="xl-log">
                  <For each={logs()}>
                    {l => (
                      <li class={l.level}>
                        <span class="time">{new Date(l.ts).toLocaleTimeString()}</span>
                        <div class="area">{l.level === "ok" ? "✔" : l.level === "warn" ? "⚠" : l.level === "error" ? "✖" : "ℹ"} {l.area}</div>
                        <div>{l.message}</div>
                        <Show when={l.detail}><pre>{l.detail}</pre></Show>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>
          </aside>
        </Show>
      </div>

      {/* sheet tabs */}
      <div class="xl-tabs">
        <For each={tabs()}>
          {({ i, s }) => (
            <button class="xl-tab" classList={{ on: i === sheetIdx(), "hidden-sheet": s.state !== "visible" }} style={{ "--tab": tabColor(s) }} onClick={() => selectSheet(i)} title={`${s.sheet.title}${s.state !== "visible" ? ` (${s.state})` : ""}${s.kind === "chartsheet" ? " — chartsheet" : ""}`}>
              <span class="sw" />
              {s.sheet.title}
              <Show when={s.state !== "visible"}><span class="st">{s.state === "veryHidden" ? "very hidden" : "hidden"}</span></Show>
              <Show when={s.kind === "chartsheet"}><span class="st">chart</span></Show>
            </button>
          )}
        </For>
      </div>

      {/* status bar */}
      <div class="xl-status">
        <span><b>{editing() ? "Edit" : busy() ? "Sibuk" : "Siap"}</b></span>
        <span class="mono">{selAddr(sel())}</span>
        <Show when={selStats()}>
          {s => <span title={`${s().rows} baris × ${s().cols} kolom`}>{s().rows}R × {s().cols}K</span>}
        </Show>
        <Show when={activeCell() && (activeCell()!.value as any)?.kind === "formula"}>
          <span class="ell mono" title={"=" + (activeCell()!.value as any).formula}>fx = {(activeCell()!.value as any).formula} → <b>{book()?.textAt(ws()!, active().row, active().col) || "—"}</b></span>
        </Show>
        <span class="grow" />
        <Show when={selStats()}>
          {s => (
            <>
              <Show when={s().cnt > 0}>
                <span>Rata-rata: <b>{fmtN(s().avg)}</b></span>
                <span>Min: <b>{fmtN(s().min)}</b></span>
                <span>Maks: <b>{fmtN(s().max)}</b></span>
                <span>Jumlah: <b>{fmtN(s().sum)}</b></span>
              </Show>
              <span>Hitung: <b>{s().nonEmpty.toLocaleString()}</b></span>
            </>
          )}
        </Show>
        <Show when={filterState()?.selected.size ? filterState() : undefined}>{f => <span>Filter: <b>{f().hiddenRows.size}</b> baris disembunyikan</span>}</Show>
        <Show when={book()?.dirty}><span title="Ada perubahan yang belum diunduh">● diubah</span></Show>
        <button class="xl-status-btn" classList={{ on: live() }} onClick={toggleLive} title="Hitung ulang formula dengan mesin evaluasi">{live() ? "Live" : "Cache"}</button>
        <span>
          <button onClick={() => setZoom(z => Math.max(0.4, +(z - 0.1).toFixed(2)))}>−</button>
          <input type="range" min="40" max="300" step="5" value={Math.round(zoom() * 100)} onInput={e => setZoom(+e.currentTarget.value / 100)} />
          <button onClick={() => setZoom(z => Math.min(3, +(z + 0.1).toFixed(2)))}>+</button>
          {" "}<b>{Math.round(zoom() * 100)}%</b>
        </span>
      </div>

      {/* popup filter */}
      <Show when={fp()}>
        {p => {
          const visible = () => p().items.filter(i => !p().q || i.value.toLowerCase().includes(p().q.toLowerCase())).slice(0, 400);
          const allVisibleChecked = () => visible().every(i => p().checked.has(i.value));
          return (
            <div class="xl-filter-pop" style={{ left: `${p().x}px`, top: `${p().y}px` }}>
              <div class="hd"><span>Filter kolom {columnLetterFromIndex(p().col)}</span><button class="xl-x" onClick={() => setFp(null)}>×</button></div>
              <div style={{ padding: "8px" }}><input class="xl-input" placeholder="Cari nilai…" value={p().q} onInput={e => setFp(x => (x ? { ...x, q: e.currentTarget.value } : x))} /></div>
              <div class="lst">
                <label><input type="checkbox" checked={allVisibleChecked()} onChange={e => setFp(x => { if (!x) return x; const s = new Set(x.checked); visible().forEach(i => (e.currentTarget.checked ? s.add(i.value) : s.delete(i.value))); return { ...x, checked: s }; })} /> <b>(Pilih semua)</b></label>
                <For each={visible()}>
                  {it => (
                    <label>
                      <input type="checkbox" checked={p().checked.has(it.value)} onChange={e => setFp(x => { if (!x) return x; const s = new Set(x.checked); e.currentTarget.checked ? s.add(it.value) : s.delete(it.value); return { ...x, checked: s }; })} />
                      <span>{it.value === "" ? "(Kosong)" : it.value}</span><span class="n">{it.count}</span>
                    </label>
                  )}
                </For>
                <Show when={p().items.length > 400 && !p().q}><div style={{ padding: "6px", color: "var(--xl-muted)" }}>Menampilkan 400 nilai pertama — gunakan pencarian.</div></Show>
              </div>
              <div class="ft">
                <button class="xl-btn" onClick={() => { setFp(x => (x ? { ...x, checked: new Set(x.items.map(i => i.value)) } : x)); applyFilterPopup(); }}>Hapus filter</button>
                <button class="xl-btn primary" onClick={applyFilterPopup}>OK</button>
              </div>
            </div>
          );
        }}
      </Show>

      {/* menu konteks */}
      <Show when={ctx()}>
        {c => (
          <div class="xl-ctx" style={{ left: `${Math.min(c().x, window.innerWidth - 240)}px`, top: `${Math.min(c().y, window.innerHeight - 300)}px` }}>
            <button onClick={() => { void copyViaButton(); setCtx(null); }}>Salin<small>Ctrl+C</small></button>
            <button onClick={() => { const t = copySel(true); void navigator.clipboard?.writeText(t); setCtx(null); }}>Potong<small>Ctrl+X</small></button>
            <button onClick={() => { void pasteViaButton(); setCtx(null); }}>Tempel<small>Ctrl+V</small></button>
            <button onClick={() => { clearSelection(); setCtx(null); }}>Kosongkan isi<small>Del</small></button>
            <hr />
            <button onClick={() => { startEdit(c().row, c().col); setCtx(null); }}>Edit sel<small>F2</small></button>
            <button onClick={() => { setDialog("debug"); setCtx(null); }}>Debug sel {addr(c().row, c().col)}</button>
            <button onClick={() => { openEval(); setCtx(null); }}>Evaluasi formula…</button>
            <button onClick={() => { setQ(book()?.textAt(ws()!, c().row, c().col) ?? ""); openFind(); setCtx(null); }}>Cari nilai sel ini</button>
            <hr />
            <button onClick={() => { doFreeze("cell"); setCtx(null); }}>Bekukan hingga {addr(active().row, active().col)}</button>
            <button onClick={() => hideSelection("rows")}>Sembunyikan baris</button>
            <button onClick={() => hideSelection("cols")}>Sembunyikan kolom</button>
            <button onClick={unhideAround}>Tampilkan yang tersembunyi di sekitar</button>
          </div>
        )}
      </Show>

      {/* dialog: evaluasi */}
      <Show when={dialog() === "eval"}>
        <div class="xl-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setDialog(null); }}>
          <div class="xl-dialog">
            <header><h3>Evaluasi formula — {ws()?.title}!{addr(active().row, active().col)}</h3><button class="xl-x" onClick={() => setDialog(null)}>×</button></header>
            <div class="body">
              <textarea class="xl-textarea" value={evalText()} spellcheck={false} onInput={e => setEvalText(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) runEval(); }} />
              <div class="xl-row-inline">
                <button class="xl-btn primary" onClick={() => runEval()}>Evaluasi <span class="xl-kbd" style={{ color: "#111" }}>Ctrl+Enter</span></button>
                <button class="xl-btn" onClick={applyEvalToCell}>Tulis ke sel aktif</button>
                <span style={{ color: "var(--xl-muted)" }}>Referensi relatif dihitung dari sel aktif.</span>
              </div>
              <Show when={evalOut()}>
                {o => (
                  <>
                    <div class="xl-result" classList={{ err: !!o().error }}>
                      <Show when={!o().error} fallback={<>Error: {o().error}{o().value ? ` (${o().value})` : ""}</>}>= {o().value}</Show>
                    </div>
                    <Show when={o().cached !== undefined}><p style={{ color: "var(--xl-muted)" }}>Nilai cache dalam berkas: <b>{o().cached}</b></p></Show>
                    <h4 style={{ margin: "14px 0 6px" }}>Langkah evaluasi</h4>
                    <table class="xl-table">
                      <thead><tr><th>Sub-ekspresi</th><th>Nilai</th></tr></thead>
                      <tbody><For each={o().steps}>{s => <tr><td class="mono">{s.expr}</td><td class="mono">{s.value}</td></tr>}</For></tbody>
                    </table>
                  </>
                )}
              </Show>
            </div>
          </div>
        </div>
      </Show>

      {/* dialog: debug sel */}
      <Show when={dialog() === "debug" && debugInfo()}>
        {d => (
          <div class="xl-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setDialog(null); }}>
            <div class="xl-dialog">
              <header><h3>Debug sel — {d().sheet}!{d().alamat}</h3>
                <button class="xl-btn" onClick={() => { void navigator.clipboard?.writeText(JSON.stringify(d(), jsonSafe, 2)); toast("JSON disalin"); }}>Salin JSON</button>
                <button class="xl-x" onClick={() => setDialog(null)}>×</button>
              </header>
              <div class="body">
                <table class="xl-table" style={{ "margin-bottom": "12px" }}>
                  <tbody>
                    <tr><th>Tipe nilai</th><td>{d().nilaiMentah?.tipe ?? "—"}</td><th>Tampilan</th><td class="mono">{d().teksTampilan || "—"}</td></tr>
                    <tr><th>Number format</th><td class="mono">{d().style?.numberFormat ?? "General"}</td><th>styleId</th><td>{d().style?.styleId ?? 0}</td></tr>
                    <Show when={d().formula}><tr><th>Formula</th><td class="mono" colspan="3">{d().formula.teks} <span class="xl-tag">{d().formula.jenis}</span> — cache: <b>{String(d().formula.cache)}</b>, mesin: <b>{String(d().formula.hasilMesin)}</b> {d().formula.sama ? "✔ sama" : "≠ beda"}</td></tr></Show>
                    <Show when={d().gabungan}><tr><th>Merged</th><td>{d().gabungan}</td><th>Dimensi</th><td>{d().dimensi.lebarPx}×{d().dimensi.tinggiPx}px {d().dimensi.kolomHidden ? "· kolom hidden" : ""} {d().dimensi.barisHidden ? "· baris hidden" : ""}</td></tr></Show>
                  </tbody>
                </table>
                <div class="xl-code">{JSON.stringify(d(), jsonSafe, 2)}</div>
              </div>
            </div>
          </div>
        )}
      </Show>

      <Show when={dragOver()}><div class="xl-drop">Lepaskan berkas .xlsx / .xlsm di sini</div></Show>
      <Show when={toastMsg()}><div class="xl-toast">{toastMsg()}</div></Show>
    </div>
  );
}
