/**
 * Editor DOCX (client-only) berbasis @office-kit/docx.
 * Kertas halaman dengan style OOXML, edit teks/tabel/gambar, status bar, cari (biasa & regex), format painter, OLE (cfb),
 * info dokumen + log + debug, undo history (maks. dapat disetel), toolbar yang dapat disembunyikan, layar penuh, readonly, i18n (en/id).
 */
import { For, Show, batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, type JSX } from "solid-js";
import { DocxBook, DocxLoadError, PAGE_SIZES } from "./docx-model";
import { DocxView, type ImgSelInfo, type PainterInfo, type SelInfo } from "./docx-view";
import { createSampleBook } from "./docx-sample";
import { exportHtml, exportText } from "./docx-export";
import { hexDump, isCfb, listOle, readCfb, readVba, streamBytes, vbaPart, type CfbInfo, type OleObject, type VbaInfo } from "./docx-ole";
import { resolveRevisions } from "./docx-ops";
import { compileQuery, type Hit, type SearchResult } from "./docx-search";
import { createI18n, type Lang } from "./docx-i18n";
import { formatBytes } from "./docx-util";
import "./docx-editor.css";

export interface DocxEditorProps {
  /** URL berkas .docx yang dimuat di awal. */
  src?: string;
  /** Bytes dokumen yang dimuat di awal (alternatif `src`). */
  data?: Uint8Array | ArrayBuffer;
  fileName?: string;
  /** Muat dokumen contoh bila `src`/`data` tidak diberikan (default: true). */
  sample?: boolean;
  height?: string;
  class?: string;
  /** Mode baca-saja: tanpa edit, tanpa undo/simpan; cari, salin, unduh TXT/HTML tetap tersedia. */
  readonly?: boolean;
  /** Bahasa antarmuka. Default: dari browser (id/en). */
  locale?: Lang;
  onLocaleChange?: (l: Lang) => void;
  /** Maksimum catatan riwayat undo (default 100). */
  maxHistory?: number;
  /** Sembunyikan toolbar/ribbon di awal. */
  toolbarHidden?: boolean;
  onChange?: (info: { label: string; modified: boolean }) => void;
}

const ICONS: Record<string, string> = {
  open: "M6 14l1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",
  save: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z M17 21v-8H7v8 M7 3v5h8",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3",
  undo: "M3 7v6h6 M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13",
  redo: "M21 7v6h-6 M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01",
  log: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8",
  bug: "M8 2l1.88 1.88 M14.12 3.88L16 2 M9 7.13v-1a3.003 3.003 0 1 1 6 0v1 M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6 M12 20v-9 M6.53 9C4.6 8.8 3 7.1 3 5 M6 13H2 M20.97 5c0 2.1-1.6 3.8-3.5 4 M22 13h-4",
  expand: "M15 3h6v6 M9 21H3v-6 M21 3l-7 7 M3 21l7-7",
  shrink: "M4 14h6v6 M20 10h-6V4 M14 10l7-7 M3 21l7-7",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  eyeoff: "M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94 M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19 m-6.72-1.07a3 3 0 1 1-4.24-4.24 M1 1l22 22",
  bullets: "M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01",
  numbers: "M10 6h11 M10 12h11 M10 18h11 M4 6h1v4 M4 10h2 M6 18H4c0-1 2-2 2-3s-1-1.5-2-1",
  indent: "M3 8l4 4-4 4 M21 6H11 M21 12H11 M21 18H11",
  outdent: "M7 8l-4 4 4 4 M21 6H11 M21 12H11 M21 18H11",
  alignL: "M17 10H3 M21 6H3 M21 14H3 M17 18H3", alignC: "M18 10H6 M21 6H3 M21 14H3 M18 18H6", alignR: "M21 10H7 M21 6H3 M21 14H3 M21 18H7", alignJ: "M21 6H3 M21 10H3 M21 14H3 M21 18H3",
  image: "M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M21 15l-5-5L5 21",
  table: "M3 3h18v18H3z M3 9h18 M3 15h18 M9 3v18 M15 3v18",
  link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  unlink: "M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71 M5.17 11.75l-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71 M8 2v3 M2 8h3 M16 22v-3 M22 16h-3",
  brush: "M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7 M14.5 17.5 4.5 15",
  eraser: "M20 20H9l-6-6a2 2 0 0 1 0-2.8L12 2.2a2 2 0 0 1 2.8 0l6 6a2 2 0 0 1 0 2.8L12 20 M8.5 11.5l7 7",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3 12h18 M12 3c2.5 2.7 3.8 5.7 3.8 9S14.5 18.3 12 21c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z",
  panel: "M3 3h18v18H3z M3 9h18",
  plus: "M12 5v14 M5 12h14", minus: "M5 12h14",
  trash: "M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6 M10 11v6 M14 11v6",
  clip: "M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48",
  outline: "M21 12h-8 M21 6H8 M21 18h-8 M3 6v4c0 1.1.9 2 2 2h3 M3 10v6c0 1.1.9 2 2 2h3",
  txt: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5",
  code: "M16 18l6-6-6-6 M8 6l-6 6 6 6",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2",
  merge: "M8 6H4v12h4 M16 6h4v12h-4 M9 12h6 M12 9l3 3-3 3",
  split: "M3 3h18v18H3z M12 3v18 M8 12H6 M18 12h-2",
  pagebreak: "M4 4h16 M4 20h16 M3 12h3 M9 12h3 M15 12h3",
  rotate: "M21 12a9 9 0 1 1-3-6.7 M21 4v5h-5",
  flipH: "M12 3v18 M16 7l5 5-5 5V7z M8 7l-5 5 5 5V7z",
  flipV: "M3 12h18 M7 8l5-5 5 5H7z M7 16l5 5 5-5H7z",
  lock: "M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z M7 11V7a5 5 0 0 1 10 0v4",
  unlock: "M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z M7 11V7a5 5 0 0 1 9.9-1",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M12 1v2 M12 21v2 M4.2 4.2l1.4 1.4 M18.4 18.4l1.4 1.4 M1 12h2 M21 12h2 M4.2 19.8l1.4-1.4 M18.4 5.6l1.4-1.4",
  check: "M20 6L9 17l-5-5", x: "M18 6L6 18 M6 6l12 12", chevron: "M6 9l6 6 6-6", sample: "M12 3l1.9 5.8H20l-4.9 3.6 1.9 5.8-5-3.6-5 3.6 1.9-5.8L4 8.8h6.1z",
  arrowUp: "M12 19V5 M5 12l7-7 7 7", arrowDown: "M12 5v14 M19 12l-7 7-7-7", replace: "M17 1l4 4-4 4 M3 11V9a4 4 0 0 1 4-4h14 M7 23l-4-4 4-4 M21 13v2a4 4 0 0 1-4 4H3",
};
const Ic = (p: { n: string; size?: number }) => (
  <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d={ICONS[p.n] ?? ""} /></svg>
);

type Tab = "home" | "insert" | "table" | "picture" | "layout" | "view";
type Panel = "find" | "info" | "log" | "ole" | "history" | "outline" | null;
type MenuId = "export" | "history" | "table" | "borders" | "symbols" | "case" | "lang" | "ctx-text" | "ctx-table" | "ctx-image";

const FONTS = ["Calibri", "Cambria", "Arial", "Times New Roman", "Courier New", "Georgia", "Verdana", "Tahoma", "Segoe UI", "Consolas", "Garamond", "Trebuchet MS", "Comic Sans MS"];
const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 28, 36, 48, 72];
const HIGHLIGHTS: [string, string][] = [["yellow", "#ffff00"], ["green", "#00ff00"], ["cyan", "#00ffff"], ["magenta", "#ff00ff"], ["red", "#ff0000"], ["blue", "#0000ff"], ["lightGray", "#c0c0c0"], ["darkYellow", "#808000"]];
const SYMBOLS = ["©", "®", "™", "°", "±", "×", "÷", "≈", "≠", "≤", "≥", "→", "←", "↑", "↓", "•", "§", "¶", "€", "£", "¥", "α", "β", "π", "Ω", "∞", "√", "✓", "✗", "★"];
const MARGIN_PRESETS: Record<string, { top: number; right: number; bottom: number; left: number }> = {
  normal: { top: 1440, right: 1440, bottom: 1440, left: 1440 }, narrow: { top: 720, right: 720, bottom: 720, left: 720 }, moderate: { top: 1440, right: 1080, bottom: 1440, left: 1080 }, wide: { top: 1440, right: 2880, bottom: 1440, left: 2880 },
};
const PX_CM = 96 / 2.54;
const cm = (px: number) => Math.round((px / PX_CM) * 100) / 100;
const twCm = (tw: number) => Math.round((tw / 567) * 100) / 100;

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const baseName = (n: string) => n.replace(/\.[^.]+$/, "");

export default function DocxEditor(props: DocxEditorProps) {
  let rootEl!: HTMLDivElement;
  let hostEl!: HTMLDivElement;
  let fileInput!: HTMLInputElement;
  let imgInput!: HTMLInputElement;
  let replInput!: HTMLInputElement;
  let findInput: HTMLInputElement | undefined;
  let view: DocxView | undefined;

  const detect = (): Lang => (typeof navigator !== "undefined" && /^id\b|^in\b/i.test(navigator.language) ? "id" : "en");
  const [lang, setLangSig] = createSignal<Lang>(props.locale ?? detect());
  const { t } = createI18n(lang);
  const setLang = (l: Lang) => { setLangSig(l); props.onLocaleChange?.(l); };
  createEffect(() => { if (props.locale) setLangSig(props.locale); });

  const [book, setBook] = createSignal<DocxBook | undefined>(undefined);
  const [ver, setVer] = createSignal(0);
  const [logVer, setLogVer] = createSignal(0);
  const [busy, setBusy] = createSignal<string | null>("busy.loading");
  const [loadErr, setLoadErr] = createSignal<{ msg: string; code: string; info?: CfbInfo; bytes?: Uint8Array; name: string } | null>(null);
  const [sel, setSel] = createSignal<SelInfo | null>(null);
  const [pages, setPages] = createSignal(0);
  const [panel, setPanel] = createSignal<Panel>(null);
  const [tab, setTab] = createSignal<Tab>("home");
  const [tbHidden, setTbHidden] = createSignal(!!props.toolbarHidden);
  const [fs, setFs] = createSignal(false);
  const [cssFs, setCssFs] = createSignal(false);
  const [zoom, setZoomSig] = createSignal(1);
  const [marks, setMarks] = createSignal(false);
  const [revs, setRevs] = createSignal(true);
  const [dark, setDark] = createSignal(false);
  const [painter, setPainter] = createSignal<PainterInfo | null>(null);
  const [toastMsg, setToastMsg] = createSignal<string | null>(null);
  const [menu, setMenu] = createSignal<{ id: MenuId; x: number; y: number } | null>(null);
  const [dialog, setDialog] = createSignal<"debug" | "link" | null>(null);
  const [dragOver, setDragOver] = createSignal(false);
  const [lockRatio, setLockRatio] = createSignal(true);
  const [histMax, setHistMax] = createSignal(props.maxHistory ?? 100);
  const [dbg, setDbg] = createSignal("");
  const [linkUrl, setLinkUrl] = createSignal("");
  const [linkTip, setLinkTip] = createSignal("");
  const [gridHover, setGridHover] = createSignal<{ r: number; c: number }>({ r: 0, c: 0 });
  const [borderSpec, setBorderSpec] = createSignal({ style: "single", sz: 8, color: "#000000" });
  const [logFilter, setLogFilter] = createSignal<"all" | "info" | "warn" | "error">("all");
  const [oleSel, setOleSel] = createSignal<number | null>(null);
  const [oleInfo, setOleInfo] = createSignal<{ cfb?: CfbInfo; stream?: string; dump?: string; vba?: VbaInfo; vbaMod?: number } | null>(null);
  const [propsDraft, setPropsDraft] = createSignal<Record<string, string>>({});
  // pencarian
  const [fq, setFq] = createSignal("");
  const [fRepl, setFRepl] = createSignal("");
  const [fCase, setFCase] = createSignal(false);
  const [fWord, setFWord] = createSignal(false);
  const [fRegex, setFRegex] = createSignal(false);
  const [fAdv, setFAdv] = createSignal(false);
  const [fFlags, setFFlags] = createSignal("");
  const [fRes, setFRes] = createSignal<SearchResult | null>(null);
  const [fCur, setFCur] = createSignal(-1);
  const [fLimit, setFLimit] = createSignal(300);

  const ro = () => !!props.readonly;
  let toastTimer = 0;
  const toast = (key: string, params?: Record<string, string | number>) => {
    setToastMsg(t(key, params));
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => setToastMsg(null), 2600);
  };
  const bump = () => setVer(v => v + 1);
  const modified = () => { ver(); return !!book()?.modified; };
  const canUndo = () => { ver(); return !!book()?.canUndo; };
  const canRedo = () => { ver(); return !!book()?.canRedo; };

  // ───────── memuat dokumen ─────────

  const attach = (b: DocxBook) => {
    b.setMaxHistory(histMax());
    batch(() => {
      setBook(b); setLoadErr(null); setSel(null); setFRes(null); setFCur(-1); setOleSel(null); setOleInfo(null); setBusy(null);
      bump(); setLogVer(v => v + 1);
    });
    view!.load(b);
    refreshProps(b);
    if (fq()) runSearch();
  };

  const loadBytes = async (bytes: Uint8Array, name: string) => {
    setBusy("busy.opening");
    try {
      const b = await DocxBook.open(bytes, name);
      attach(b);
    } catch (e) {
      let info: CfbInfo | undefined;
      if (e instanceof DocxLoadError && e.bytes && e.bytes.length > 8 && (e.code === "legacy-doc" || e.code === "encrypted")) { try { info = readCfb(e.bytes); } catch { /* abaikan */ } }
      const code = e instanceof DocxLoadError ? e.code : "parse";
      setLoadErr({ msg: e instanceof Error ? e.message : String(e), code, info, bytes: e instanceof DocxLoadError ? e.bytes : undefined, name });
      setBusy(null);
    }
  };
  const openFile = async (f: File | undefined | null) => {
    if (!f) return;
    if (book()?.modified && !ro() && !window.confirm(t("confirm.discard"))) return;
    await loadBytes(new Uint8Array(await f.arrayBuffer()), f.name);
  };
  const openSample = async () => {
    if (book()?.modified && !ro() && !window.confirm(t("confirm.discard"))) return;
    setBusy("busy.sample");
    try { attach(await createSampleBook({ lang: lang() })); } catch (e) { setLoadErr({ msg: e instanceof Error ? e.message : String(e), code: "parse", name: "sample" }); setBusy(null); }
  };
  const newBlank = async () => {
    const { createDocx } = await import("@office-kit/docx");
    if (book()?.modified && !ro() && !window.confirm(t("confirm.discard"))) return;
    const doc = createDocx({ paragraphs: [""] });
    attach(DocxBook.fromDocx(doc, lang() === "id" ? "dokumen-baru.docx" : "new-document.docx"));
  };

  // ───────── unduh ─────────

  const fname = () => book()?.fileName ?? "document.docx";
  const saveDocx = () => {
    const b = book();
    if (!b || ro()) return;
    try {
      const out = /\.(docx|docm)$/i.test(b.fileName) ? b.fileName : baseName(b.fileName) + ".docx";
      downloadBlob(out, b.toBlob());
      b.markSaved(); bump();
      toast("toast.saved", { name: out });
    } catch (e) { b.addLog("error", "save", "log.saveFail", { msg: e instanceof Error ? e.message : String(e) }); setLogVer(v => v + 1); toast("toast.saveFail"); }
  };
  const saveSource = () => { const b = book(); if (b) downloadBlob(b.fileName, new Blob([b.originalBytes as BlobPart])); };
  const saveTxt = () => { const b = book(); if (b) downloadBlob(baseName(b.fileName) + ".txt", new Blob([exportText(b)], { type: "text/plain;charset=utf-8" })); };
  const saveHtml = () => { const b = book(); if (b) downloadBlob(baseName(b.fileName) + ".html", new Blob([exportHtml(b)], { type: "text/html;charset=utf-8" })); };

  // ───────── hook ke view ─────────

  const hooks = () => ({
    changed: (label: string) => {
      bump();
      props.onChange?.({ label, modified: !!book()?.modified });
      if (panel() === "find" && fq()) scheduleSearch();
      if (panel() === "outline") bump();
    },
    selection: (s: SelInfo) => { setSel(s); if (s.image) setLockRatio(s.image.lock); },
    pages: (n: number) => setPages(n),
    painter: (p: PainterInfo | null) => setPainter(p),
    ole: (relId: string) => { setPanel("ole"); const list = oleList(); const i = list.findIndex(o => o.relId === relId); if (i >= 0) selectOle(i); },
    openFile: (f: File) => { void openFile(f); },
    toast,
    log: (level: "info" | "warn" | "error", cat: string, key: string, params?: Record<string, string | number>) => { book()?.addLog(level, cat, key, params); setLogVer(v => v + 1); },
    context: (x: number, y: number, kind: "text" | "table" | "image") => setMenu({ id: kind === "text" ? "ctx-text" : kind === "table" ? "ctx-table" : "ctx-image", x, y }),
    askLink: (cur: string | undefined) => { setLinkUrl(cur ?? "https://"); setLinkTip(""); setDialog("link"); },
  });

  onMount(async () => {
    view = new DocxView(hostEl, hooks());
    view.readonly = ro();
    // gagang debug (dipakai uji E2E / konsol): rootEl.__dx = { view, book() }
    (rootEl as unknown as { __dx: unknown }).__dx = { view, book };
    const onFs = () => setFs(document.fullscreenElement === rootEl || cssFs());
    document.addEventListener("fullscreenchange", onFs);
    const onDocDown = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest?.(".dxe-menu,[data-menu]")) setMenu(null); };
    document.addEventListener("mousedown", onDocDown);
    onCleanup(() => { document.removeEventListener("fullscreenchange", onFs); document.removeEventListener("mousedown", onDocDown); view?.dispose(); clearTimeout(toastTimer); clearTimeout(searchTimer); });
    try {
      if (props.data) await loadBytes(props.data instanceof Uint8Array ? props.data : new Uint8Array(props.data), props.fileName ?? "document.docx");
      else if (props.src) {
        const res = await fetch(props.src);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await loadBytes(new Uint8Array(await res.arrayBuffer()), props.fileName ?? decodeURIComponent(props.src.split("/").pop() || "document.docx"));
      } else if (props.sample !== false) await openSample();
      else setBusy(null);
    } catch (e) { setLoadErr({ msg: e instanceof Error ? e.message : String(e), code: "fetch", name: props.src ?? "" }); setBusy(null); }
  });

  createEffect(on(ro, v => { view?.setReadonly(v); }));
  createEffect(on(marks, v => view?.setMarks(v), { defer: true }));
  createEffect(on(revs, v => view?.setRevisions(v), { defer: true }));
  createEffect(on(histMax, v => { const b = book(); if (b) { b.setMaxHistory(v); bump(); } }, { defer: true }));

  const setZoom = (z: number) => { view?.setZoom(z); setZoomSig(view?.zoom ?? z); };
  const toggleFs = async () => {
    if (fs()) { if (document.fullscreenElement) await document.exitFullscreen().catch(() => {}); setCssFs(false); setFs(false); return; }
    try { await rootEl.requestFullscreen(); setFs(true); } catch { setCssFs(true); setFs(true); }
  };

  // ───────── pencarian ─────────

  let searchTimer = 0;
  const searchOpts = () => ({ query: fq(), regex: fRegex(), caseSensitive: fCase(), wholeWord: fWord(), flags: fFlags() });
  const runSearch = () => {
    if (!view || !book()) return;
    if (!fq()) { view.clearSearch(); setFRes(null); setFCur(-1); return; }
    const r = view.search(searchOpts());
    setFRes(r); setFCur(-1); setFLimit(300);
  };
  const scheduleSearch = () => { clearTimeout(searchTimer); searchTimer = window.setTimeout(runSearch, 160); };
  const step = (d: 1 | -1) => {
    const r = fRes();
    if (!r || !r.hits.length) return;
    const n = (fCur() + d + r.hits.length) % r.hits.length;
    setFCur(n); view?.gotoHit(n);
  };
  const gotoHit = (i: number) => { setFCur(i); view?.gotoHit(i); };
  const openFind = () => {
    setPanel("find");
    const s = window.getSelection()?.toString();
    if (s && s.length < 80 && !s.includes("\n")) { setFq(s); runSearch(); }
    queueMicrotask(() => { findInput?.focus(); findInput?.select(); });
  };
  const replaceCur = () => {
    const r = fRes(); const i = fCur() >= 0 ? fCur() : 0;
    if (!r || !r.hits[i] || ro()) return;
    const n = view!.replaceHitsBy([r.hits[i]], searchOpts(), fRepl());
    if (n) toast("toast.replaced", { n });
    runSearch();
  };
  const replaceAll = () => {
    const r = fRes();
    if (!r || !r.hits.length || ro()) return;
    const n = view!.replaceHitsBy(r.hits, searchOpts(), fRepl());
    toast("toast.replaced", { n });
    runSearch();
  };
  const regexErr = createMemo(() => (fRegex() && fq() ? compileQuery(searchOpts()).error : undefined));
  const whereLabel = (h: Hit) => (h.where.kind === "table" ? t("find.whereTable", { t: h.where.table ?? 0, r: h.where.row ?? 0, c: h.where.col ?? 0, p: h.where.para }) : t("find.whereBody", { p: h.where.para }));

  // ───────── OLE ─────────

  const oleList = createMemo<OleObject[]>(() => { ver(); const b = book(); return b ? listOle(b) : []; });
  const vba = createMemo(() => { ver(); const b = book(); return b ? vbaPart(b) : undefined; });
  const selectOle = (i: number) => {
    setOleSel(i);
    const o = oleList()[i];
    const b = book();
    if (!o || !b) return;
    const data = b.part(o.part)?.data;
    if (!data) { setOleInfo({}); return; }
    try { setOleInfo(isCfb(data) ? { cfb: readCfb(data) } : {}); } catch (e) { setOleInfo({}); b.addLog("error", "ole", "log.oleFail", { part: o.part, msg: e instanceof Error ? e.message : String(e) }); setLogVer(v => v + 1); }
    const el = hostEl.querySelector<HTMLElement>(`.dx-ole[data-ole="${o.relId ?? ""}"]`);
    el?.scrollIntoView({ block: "center" });
  };
  const oleDownload = (o: OleObject, mode: "raw" | "native") => {
    const b = book(); const data = b?.part(o.part)?.data;
    if (!b || !data) return;
    if (mode === "native") { const n = readCfb(data).native; if (n) { downloadBlob(n.fileName, new Blob([n.data as BlobPart])); return; } }
    downloadBlob(o.fileName || "object.bin", new Blob([data as BlobPart]));
  };
  const oleStream = (path: string) => {
    const o = oleList()[oleSel() ?? -1]; const data = o && book()?.part(o.part)?.data;
    if (!data) return;
    const bytes = streamBytes(data, path);
    setOleInfo(i => ({ ...(i ?? {}), stream: path, dump: bytes ? hexDump(bytes, 512) : t("ole.noStream") }));
  };
  const loadVba = () => {
    const p = vba();
    if (!p) return;
    const v = readVba(p.data);
    setOleInfo(i => ({ ...(i ?? {}), vba: v, vbaMod: v.modules.length ? 0 : undefined }));
  };

  // ───────── properti dokumen ─────────

  const refreshProps = (b: DocxBook) => {
    const c = b.coreProps();
    setPropsDraft({ title: c.title ?? "", creator: c.creator ?? "", subject: c.subject ?? "", keywords: c.keywords ?? "", description: c.description ?? "", category: c.category ?? "" });
  };
  const applyProps = () => { const b = book(); if (!b || ro()) return; b.setCore({ ...propsDraft(), modified: new Date().toISOString() }); view?.commit("hist.props"); toast("toast.propsSaved"); };

  // ───────── debug ─────────

  const openDebug = () => {
    const b = book();
    if (!b || !view) return;
    const info = {
      app: { component: "DocxEditor", lang: lang(), readonly: ro(), zoom: view.zoom, pages: pages() },
      document: {
        name: b.fileName, size: b.originalBytes.length, modified: b.modified, main: b.doc.partName, sections: b.sections().map(s => ({ w: s.w, h: s.h, orient: s.orient, margins: [s.mt, s.mr, s.mb, s.ml], type: s.type, titlePg: s.titlePg, cols: s.cols.num })),
        stats: b.stats(), compat: b.compatMode(), evenOdd: b.evenAndOdd(), defaultTab: b.defaultTab(),
        styles: b.styles.list().length, theme: b.styles.theme, parts: b.partNames().map(n => ({ name: n, bytes: b.part(n)?.data.length, type: b.part(n)?.contentType })),
        rels: b.relsOf(b.doc.partName).map(r => ({ id: r.id, type: r.type.split("/").pop(), target: r.target, mode: r.targetMode })),
        census: Object.fromEntries([...b.census()].sort((a, c) => c[1] - a[1]).slice(0, 40)),
      },
      history: { index: b.histIdx, count: b.hist.length, max: b.maxHistory, entries: b.hist.map((h, i) => ({ i, label: h.label, kb: Math.round(h.size / 1024) })) },
      cursor: view.debugAtCaret(),
      search: { hits: fRes()?.hits.length ?? 0 },
      env: { ua: navigator.userAgent, highlightApi: typeof (window as unknown as { Highlight?: unknown }).Highlight !== "undefined", dpr: window.devicePixelRatio },
    };
    setDbg(JSON.stringify(info, (_k, v) => (v instanceof Uint8Array ? `<Uint8Array ${v.length}>` : v instanceof Map ? Object.fromEntries(v) : v), 2));
    setDialog("debug");
  };

  // ───────── util UI ─────────

  const openMenu = (id: MenuId, e: MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu(m => (m?.id === id ? null : { id, x: Math.min(r.left, window.innerWidth - 240), y: r.bottom + 2 }));
  };
  const Btn = (p: { icon?: string; label?: string; title?: string; on?: boolean; disabled?: boolean; primary?: boolean; onClick?: (e: MouseEvent) => void; children?: JSX.Element; menu?: boolean; badge?: number; badgeKind?: string; class?: string }) => (
    <button class={`dxe-btn ${p.class ?? ""}`} classList={{ on: p.on, primary: p.primary }} title={p.title ?? p.label} disabled={p.disabled} data-menu={p.menu ? "1" : undefined}
      onMouseDown={e => e.preventDefault()} onClick={e => p.onClick?.(e)}>
      <Show when={p.icon}><Ic n={p.icon!} /></Show>
      <Show when={p.label}><span>{p.label}</span></Show>
      {p.children}
      <Show when={p.badge}><span class={`b ${p.badgeKind ?? ""}`}>{p.badge}</span></Show>
      <Show when={p.menu}><Ic n="chevron" size={12} /></Show>
    </button>
  );
  const Grp = (p: { cap?: string; children: JSX.Element }) => (<div class="dxe-rg"><div class="row">{p.children}</div><Show when={p.cap}><div class="cap">{p.cap}</div></Show></div>);
  const MI = (p: { label: string; onClick: () => void; disabled?: boolean; icon?: string }) => (
    <button disabled={p.disabled} onMouseDown={e => e.preventDefault()} onClick={() => { setMenu(null); p.onClick(); }}><Show when={p.icon}><Ic n={p.icon!} size={14} /></Show>{p.label}</button>
  );

  const S = () => sel();
  const edit = () => !ro() && !!book();
  const inTable = () => !!S()?.table;
  const hasImg = () => !!S()?.image;
  const img = (): ImgSelInfo | undefined => S()?.image;
  const logs = createMemo(() => { logVer(); const b = book(); return b ? [...b.log] : []; });
  const counts = createMemo(() => { const l = logs(); return { info: l.filter(x => x.level === "info").length, warn: l.filter(x => x.level === "warn").length, error: l.filter(x => x.level === "error").length }; });
  const outline = createMemo(() => { ver(); return panel() === "outline" && view ? view.outline() : []; });
  const doc = createMemo(() => {
    ver();
    const b = book();
    if (!b || panel() !== "info") return null;
    return { stats: b.stats(), sections: b.sections(), core: b.coreProps(), app: b.appProps(), parts: b.partNames().map(n => ({ n, size: b.part(n)?.data.length ?? 0, type: b.part(n)?.contentType ?? "" })), comments: b.comments(), styles: b.styles.list(), validation: b.validate() };
  });
  const [words, setWords] = createSignal(0);
  let wordTimer = 0;
  createEffect(() => { ver(); const b = book(); clearTimeout(wordTimer); if (!b) { setWords(0); return; } wordTimer = window.setTimeout(() => setWords(b.stats().words), 350); });
  onCleanup(() => clearTimeout(wordTimer));
  const paraStyles = createMemo(() => { ver(); const b = book(); if (!b) return []; return b.styles.list("paragraph").sort((a, c) => Number(c.qFormat) - Number(a.qFormat) || a.ui - c.ui || a.name.localeCompare(c.name)); });
  const fontsAll = createMemo(() => { const f = S()?.font; return f && !FONTS.includes(f) ? [f, ...FONTS] : FONTS; });

  const doImgSize = (axis: "w" | "h", v: number) => { if (!(v > 0)) return; view?.imgSetSize(axis === "w" ? v * PX_CM : null, axis === "h" ? v * PX_CM : null); };

  // ───────── pintasan ─────────

  const onRootKey = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === "f") { e.preventDefault(); openFind(); }
    else if (mod && k === "s") { e.preventDefault(); saveDocx(); }
    else if (mod && k === "o") { e.preventDefault(); fileInput.click(); }
    else if (e.key === "F3") { e.preventDefault(); if (panel() !== "find") openFind(); else step(e.shiftKey ? -1 : 1); }
    else if (e.key === "Escape") { if (menu()) setMenu(null); else if (dialog()) setDialog(null); else if (panel() === "find" && !painter()) setPanel(null); }
  };

  // ───────── JSX ─────────

  const Home = () => (
    <>
      <Grp cap={t("g.clipboard")}>
        <Btn icon="brush" label={t("b.painter")} title={t("b.painterTip")} disabled={!edit() || !S()?.has} on={!!painter()} onClick={() => (painter() ? view?.cancelPainter() : view?.startPainter(false))} />
        <Btn icon="brush" title={t("b.painterSticky")} disabled={!edit() || !S()?.has} onClick={() => view?.startPainter(true)}><small>×N</small></Btn>
      </Grp>
      <Grp cap={t("g.font")}>
        <select class="dxe-sel" style={{ width: "140px" }} disabled={!edit()} value={S()?.font ?? ""} onChange={e => view?.setFont(e.currentTarget.value || null)} title={t("b.font")}>
          <option value="">{S()?.font ? "" : "—"}</option>
          <For each={fontsAll()}>{f => <option value={f} selected={f === S()?.font}>{f}</option>}</For>
        </select>
        <input class="dxe-num-in" style={{ width: "56px" }} list="dxe-sizes" disabled={!edit()} value={S()?.size ?? ""} title={t("b.size")}
          onChange={e => { const v = parseFloat(e.currentTarget.value); if (v > 0) view?.setSize(v); }} />
        <datalist id="dxe-sizes"><For each={SIZES}>{s => <option value={s} />}</For></datalist>
        <Btn title={t("b.sizeUp")} disabled={!edit()} onClick={() => view?.bumpSize(1)}><span style={{ "font-size": "14px", "font-weight": "700" }}>A↑</span></Btn>
        <Btn title={t("b.sizeDown")} disabled={!edit()} onClick={() => view?.bumpSize(-1)}><span style={{ "font-size": "11px", "font-weight": "700" }}>A↓</span></Btn>
        <Btn title={t("b.bold") + " (Ctrl+B)"} disabled={!edit()} on={S()?.bold} onClick={() => view?.toggleRun("b")}><span class="f-b">B</span></Btn>
        <Btn title={t("b.italic") + " (Ctrl+I)"} disabled={!edit()} on={S()?.italic} onClick={() => view?.toggleRun("i")}><span class="f-i">I</span></Btn>
        <Btn title={t("b.underline") + " (Ctrl+U)"} disabled={!edit()} on={S()?.underline} onClick={() => view?.toggleUnderline()}><span class="f-u">U</span></Btn>
        <Btn title={t("b.strike")} disabled={!edit()} on={S()?.strike} onClick={() => view?.toggleRun("strike")}><span class="f-s">S</span></Btn>
        <Btn title={t("b.sub")} disabled={!edit()} on={S()?.sub} onClick={() => view?.setVert("subscript")}><span>x<sub>2</sub></span></Btn>
        <Btn title={t("b.sup")} disabled={!edit()} on={S()?.sup} onClick={() => view?.setVert("superscript")}><span>x<sup>2</sup></span></Btn>
        <Btn title={t("b.case")} disabled={!edit()} menu onClick={e => openMenu("case", e)}><span>Aa</span></Btn>
        <label class="dxe-lbl" title={t("b.color")}>A<input type="color" class="dxe-color" disabled={!edit()} value={S()?.color ? `#${S()!.color}` : "#000000"} onChange={e => view?.setColor(e.currentTarget.value)} /></label>
        <select class="dxe-sel" style={{ width: "54px" }} disabled={!edit()} title={t("b.highlight")} onChange={e => { const v = e.currentTarget.value; if (v) view?.setHighlight(v === "none" ? null : v); e.currentTarget.value = ""; }}>
          <option value="">🖍</option><option value="none">∅</option><For each={HIGHLIGHTS}>{([n, c]) => <option value={n} style={{ background: c }}>{n}</option>}</For>
        </select>
        <Btn icon="eraser" title={t("b.clearFmt")} disabled={!edit()} onClick={() => view?.clearFormat()} />
      </Grp>
      <Grp cap={t("g.paragraph")}>
        <Btn icon="bullets" title={t("b.bullets")} disabled={!edit()} on={S()?.list === "bullet"} onClick={() => view?.toggleList("bullet")} />
        <Btn icon="numbers" title={t("b.numbers")} disabled={!edit()} on={S()?.list === "number"} onClick={() => view?.toggleList("number")} />
        <Btn icon="outdent" title={t("b.outdent")} disabled={!edit()} onClick={() => view?.indent(-1)} />
        <Btn icon="indent" title={t("b.indent")} disabled={!edit()} onClick={() => view?.indent(1)} />
        <Btn icon="alignL" title={t("b.alignL") + " (Ctrl+L)"} disabled={!edit()} on={S()?.align === "left" || S()?.align === "start"} onClick={() => view?.setAlign("left")} />
        <Btn icon="alignC" title={t("b.alignC") + " (Ctrl+E)"} disabled={!edit()} on={S()?.align === "center"} onClick={() => view?.setAlign("center")} />
        <Btn icon="alignR" title={t("b.alignR") + " (Ctrl+R)"} disabled={!edit()} on={S()?.align === "right" || S()?.align === "end"} onClick={() => view?.setAlign("right")} />
        <Btn icon="alignJ" title={t("b.alignJ") + " (Ctrl+J)"} disabled={!edit()} on={S()?.align === "both"} onClick={() => view?.setAlign("both")} />
        <select class="dxe-sel" style={{ width: "62px" }} disabled={!edit()} title={t("b.lineSpacing")} onChange={e => { const v = parseFloat(e.currentTarget.value); if (v) view?.setLineSpacing(v); e.currentTarget.value = ""; }}>
          <option value="">↕ {S()?.line ?? ""}</option><For each={[1, 1.15, 1.5, 2, 2.5, 3]}>{v => <option value={v}>{v}</option>}</For>
        </select>
        <Btn title={t("b.spaceBefore")} disabled={!edit()} onClick={() => view?.setParaSpacing(S()?.spaceBefore ? null : 12, null)}><small>↥12</small></Btn>
        <Btn title={t("b.spaceAfter")} disabled={!edit()} onClick={() => view?.setParaSpacing(null, S()?.spaceAfter ? null : 8)}><small>↧8</small></Btn>
        <label class="dxe-lbl" title={t("b.shading")}>▨<input type="color" class="dxe-color" disabled={!edit()} value="#ffffcc" onChange={e => view?.setShading(e.currentTarget.value)} /></label>
      </Grp>
      <Grp cap={t("g.styles")}>
        <select class="dxe-sel" style={{ width: "150px" }} disabled={!edit()} value={S()?.styleId ?? ""} onChange={e => view?.setStyle(e.currentTarget.value || null)} title={t("b.style")}>
          <For each={paraStyles()}>{s => <option value={s.id} selected={s.id === S()?.styleId}>{s.name}</option>}</For>
        </select>
      </Grp>
    </>
  );

  const Insert = () => (
    <>
      <Grp cap={t("g.insert")}>
        <Btn icon="image" label={t("b.picture")} disabled={!edit()} onClick={() => imgInput.click()} />
        <Btn icon="table" label={t("b.table")} disabled={!edit()} menu onClick={e => openMenu("table", e)} />
        <Btn icon="link" label={t("b.link")} title={t("b.link") + " (Ctrl+K)"} disabled={!edit() || !S()?.has} onClick={() => { setLinkUrl(S()?.link ?? "https://"); setLinkTip(""); setDialog("link"); }} />
        <Btn icon="unlink" title={t("b.unlink")} disabled={!edit() || !S()?.link} onClick={() => view?.setLink(null)} />
        <Btn icon="pagebreak" label={t("b.pageBreak")} title={t("b.pageBreak") + " (Ctrl+Enter)"} disabled={!edit() || !S()?.has} onClick={() => view?.insertPageBreakAtCaret()} />
        <Btn label="Ω" title={t("b.symbol")} disabled={!edit() || !S()?.has} menu onClick={e => openMenu("symbols", e)} />
      </Grp>
      <Grp cap={t("g.review")}>
        <Btn label={t("b.acceptAll")} disabled={!edit()} onClick={() => { const b = book(); if (!b) return; const n = resolveRevisions(b.body, "accept"); if (n) { b.reindex(); view?.renderAll({ sel: null }); view?.commit("hist.revisions"); } toast("toast.revisions", { n }); }} />
        <Btn label={t("b.rejectAll")} disabled={!edit()} onClick={() => { const b = book(); if (!b) return; const n = resolveRevisions(b.body, "reject"); if (n) { b.reindex(); view?.renderAll({ sel: null }); view?.commit("hist.revisions"); } toast("toast.revisions", { n }); }} />
      </Grp>
    </>
  );

  const TableTab = () => {
    const d = () => !edit() || !inTable();
    const op = (name: string, arg?: unknown) => () => view?.table(name, arg);
    const look = (k: string, v: boolean) => view?.table("look", { [k]: v });
    return (
      <>
        <Grp cap={t("g.rowsCols")}>
          <Btn label={t("t.rowAbove")} disabled={d()} onClick={op("insertRowAbove")} />
          <Btn label={t("t.rowBelow")} disabled={d()} onClick={op("insertRowBelow")} />
          <Btn label={t("t.colLeft")} disabled={d()} onClick={op("insertColLeft")} />
          <Btn label={t("t.colRight")} disabled={d()} onClick={op("insertColRight")} />
          <Btn icon="trash" label={t("t.delRow")} disabled={d()} onClick={op("deleteRows")} />
          <Btn icon="trash" label={t("t.delCol")} disabled={d()} onClick={op("deleteCols")} />
          <Btn icon="trash" label={t("t.delTable")} disabled={d()} onClick={op("deleteTable")} />
        </Grp>
        <Grp cap={t("g.merge")}>
          <Btn icon="merge" label={t("t.merge")} disabled={d()} onClick={op("merge")} />
          <Btn icon="split" label={t("t.split")} disabled={d()} onClick={op("split", 2)} />
          <Btn label={t("t.selTable")} disabled={d()} onClick={op("select")} />
          <Btn label={t("t.selRow")} disabled={d()} onClick={op("selectRow")} />
          <Btn label={t("t.selCol")} disabled={d()} onClick={op("selectCol")} />
        </Grp>
        <Grp cap={t("g.cell")}>
          <label class="dxe-lbl" title={t("t.shade")}>▨<input type="color" class="dxe-color" disabled={d()} value="#e8eef7" onChange={e => view?.table("shade", e.currentTarget.value)} /></label>
          <Btn label="∅" title={t("t.noShade")} disabled={d()} onClick={op("shade", null)} />
          <Btn label="⤒" title={t("t.vTop")} disabled={d()} onClick={op("valign", "top")} />
          <Btn label="↕" title={t("t.vMid")} disabled={d()} onClick={op("valign", "center")} />
          <Btn label="⤓" title={t("t.vBot")} disabled={d()} onClick={op("valign", "bottom")} />
          <Btn label={t("t.borders")} disabled={d()} menu onClick={e => openMenu("borders", e)} />
          <select class="dxe-sel" disabled={d()} title={t("t.borderStyle")} value={borderSpec().style} onChange={e => setBorderSpec(s => ({ ...s, style: e.currentTarget.value }))}>
            <For each={["single", "double", "dashed", "dotted", "thick"]}>{s => <option value={s}>{s}</option>}</For>
          </select>
          <select class="dxe-sel" disabled={d()} title={t("t.borderWidth")} value={borderSpec().sz} onChange={e => setBorderSpec(s => ({ ...s, sz: +e.currentTarget.value }))}>
            <For each={[2, 4, 8, 12, 18, 24]}>{s => <option value={s}>{s / 8} pt</option>}</For>
          </select>
          <input type="color" class="dxe-color" disabled={d()} title={t("t.borderColor")} value={borderSpec().color} onChange={e => setBorderSpec(s => ({ ...s, color: e.currentTarget.value }))} />
        </Grp>
        <Grp cap={t("g.table")}>
          <select class="dxe-sel" style={{ width: "130px" }} disabled={d()} title={t("t.style")} onChange={e => view?.table("style", e.currentTarget.value || null)}>
            <option value="">{t("t.styleNone")}</option>
            <For each={book()?.styles.list("table") ?? []}>{s => <option value={s.id}>{s.name}</option>}</For>
          </select>
          <label class="dxe-chk"><input type="checkbox" disabled={d()} onChange={e => { view?.table("headerRow", e.currentTarget.checked); look("firstRow", e.currentTarget.checked); }} />{t("t.headerRow")}</label>
          <label class="dxe-chk"><input type="checkbox" disabled={d()} onChange={e => look("noHBand", !e.currentTarget.checked)} />{t("t.banded")}</label>
          <label class="dxe-chk"><input type="checkbox" disabled={d()} onChange={e => look("firstColumn", e.currentTarget.checked)} />{t("t.firstCol")}</label>
          <Btn icon="alignL" title={t("t.alignL")} disabled={d()} onClick={op("align", "left")} />
          <Btn icon="alignC" title={t("t.alignC")} disabled={d()} onClick={op("align", "center")} />
          <Btn icon="alignR" title={t("t.alignR")} disabled={d()} onClick={op("align", "right")} />
          <Btn label={t("t.distCols")} disabled={d()} onClick={op("distCols")} />
          <Btn label={t("t.fixed")} title={t("t.fixedTip")} disabled={d()} onClick={op("layout", true)} />
          <Btn label={t("t.auto")} title={t("t.autoTip")} disabled={d()} onClick={op("layout", false)} />
          <label class="dxe-lbl">{t("t.rowH")}</label>
          <input class="dxe-num-in" style={{ width: "54px" }} type="number" min="0" step="0.1" disabled={d()} title={t("t.rowH")} onChange={e => { const v = parseFloat(e.currentTarget.value); view?.table("rowHeight", v > 0 ? v * 28.35 : null); }} />
        </Grp>
      </>
    );
  };

  const PictureTab = () => {
    const d = () => !edit() || !hasImg();
    const i = () => img();
    return (
      <>
        <Grp cap={t("g.size")}>
          <label class="dxe-lbl">{t("p.width")}</label>
          <input class="dxe-num-in" type="number" min="0.2" step="0.1" disabled={d()} value={i() ? cm(i()!.wPx) : ""} onChange={e => doImgSize("w", parseFloat(e.currentTarget.value))} />
          <label class="dxe-lbl">{t("p.height")}</label>
          <input class="dxe-num-in" type="number" min="0.2" step="0.1" disabled={d()} value={i() ? cm(i()!.hPx) : ""} onChange={e => doImgSize("h", parseFloat(e.currentTarget.value))} />
          <label class="dxe-lbl">cm</label>
          <Btn icon={lockRatio() ? "lock" : "unlock"} title={t("p.lock")} label={lockRatio() ? t("p.locked") : t("p.free")} disabled={!edit() || !hasImg()} on={lockRatio()} onClick={() => { const v = !lockRatio(); setLockRatio(v); view?.imgSetLock(v); }} />
          <Btn label={t("p.reset")} title={t("p.resetTip")} disabled={d()} onClick={() => view?.imgReset()} />
        </Grp>
        <Grp cap={t("g.wrap")}>
          <select class="dxe-sel" style={{ width: "150px" }} disabled={d()} value={i()?.wrap ?? "inline"} onChange={e => view?.imgSetWrap(e.currentTarget.value as never)}>
            <For each={["inline", "square", "topBottom", "behind", "front"]}>{w => <option value={w} selected={i()?.wrap === w || (w === "square" && (i()?.wrap === "tight" || i()?.wrap === "through"))}>{t("wrap." + w)}</option>}</For>
          </select>
          <Btn icon="alignL" title={t("p.floatL")} disabled={d() || !i()?.floating} onClick={() => view?.imgSetWrap(i()!.wrap === "inline" ? "square" : i()!.wrap, "left")} />
          <Btn icon="alignC" title={t("p.floatC")} disabled={d() || !i()?.floating} onClick={() => view?.imgSetWrap(i()!.wrap, "center")} />
          <Btn icon="alignR" title={t("p.floatR")} disabled={d() || !i()?.floating} onClick={() => view?.imgSetWrap(i()!.wrap, "right")} />
        </Grp>
        <Grp cap={t("g.transform")}>
          <Btn icon="rotate" title={t("p.rotateCCW")} disabled={d()} onClick={() => view?.imgRotate((i()?.rot ?? 0) - 90)}><small>−90°</small></Btn>
          <Btn icon="rotate" title={t("p.rotateCW")} disabled={d()} onClick={() => view?.imgRotate((i()?.rot ?? 0) + 90)}><small>+90°</small></Btn>
          <Btn icon="flipH" title={t("p.flipH")} disabled={d()} onClick={() => view?.imgFlip("h")} />
          <Btn icon="flipV" title={t("p.flipV")} disabled={d()} onClick={() => view?.imgFlip("v")} />
          <label class="dxe-lbl">{t("p.crop")}</label>
          <For each={["l", "t", "r", "b"]}>{k => <input class="dxe-num-in" style={{ width: "44px" }} type="number" min="0" max="90" step="1" placeholder={k.toUpperCase() + "%"} disabled={d()} title={t("p.cropTip", { side: k.toUpperCase() })} data-crop={k}
            onChange={e => { const row = e.currentTarget.parentElement!; const g = (kk: string) => parseFloat((row.querySelector(`[data-crop="${kk}"]`) as HTMLInputElement).value) || 0; view?.imgCrop({ l: g("l"), t: g("t"), r: g("r"), b: g("b") }); }} />}</For>
        </Grp>
        <Grp cap={t("g.picture")}>
          <input class="dxe-txt" style={{ width: "170px" }} placeholder={t("p.alt")} disabled={d()} value={i()?.descr ?? ""} onChange={e => view?.imgSetAlt(e.currentTarget.value)} />
          <Btn label={t("p.replace")} disabled={d()} onClick={() => replInput.click()} />
          <Btn label={t("p.duplicate")} disabled={d()} onClick={() => view?.imgDuplicate()} />
          <Btn icon="trash" label={t("p.delete")} disabled={d()} onClick={() => view?.imgDelete()} />
        </Grp>
      </>
    );
  };

  const LayoutTab = () => {
    const sec = () => { ver(); const s = book()?.sections(); return s ? s[s.length - 1] : undefined; };
    const margin = (k: "top" | "right" | "bottom" | "left") => { const s = sec(); return s ? twCm(k === "top" ? s.mt : k === "right" ? s.mr : k === "bottom" ? s.mb : s.ml) : ""; };
    const setM = (k: "top" | "right" | "bottom" | "left", v: number) => { if (v >= 0) { book()?.setPage({ margins: { [k]: v * 567 } }); view?.renderAll(); view?.commit("hist.page"); } };
    const sizeName = () => { const s = sec(); if (!s) return ""; const w = Math.min(s.w, s.h), h = Math.max(s.w, s.h); return Object.entries(PAGE_SIZES).find(([, v]) => Math.abs(v.w - w) < 30 && Math.abs(v.h - h) < 30)?.[0] ?? ""; };
    return (
      <>
        <Grp cap={t("g.pageSetup")}>
          <select class="dxe-sel" disabled={!edit()} value={sizeName()} onChange={e => { if (e.currentTarget.value) { book()?.setPage({ size: e.currentTarget.value }); view?.renderAll(); view?.commit("hist.page"); } }} title={t("l.size")}>
            <option value="">{t("l.custom")}</option><For each={Object.keys(PAGE_SIZES)}>{k => <option value={k} selected={sizeName() === k}>{k}</option>}</For>
          </select>
          <Btn label={t("l.portrait")} disabled={!edit()} on={sec()?.orient === "portrait"} onClick={() => { book()?.setPage({ orient: "portrait" }); view?.renderAll(); view?.commit("hist.page"); }} />
          <Btn label={t("l.landscape")} disabled={!edit()} on={sec()?.orient === "landscape"} onClick={() => { book()?.setPage({ orient: "landscape" }); view?.renderAll(); view?.commit("hist.page"); }} />
        </Grp>
        <Grp cap={t("g.margins")}>
          <select class="dxe-sel" disabled={!edit()} title={t("l.margins")} onChange={e => { const m = MARGIN_PRESETS[e.currentTarget.value]; if (m) { book()?.setPage({ margins: m }); view?.renderAll(); view?.commit("hist.page"); } e.currentTarget.value = ""; }}>
            <option value="">{t("l.marginPreset")}</option><For each={Object.keys(MARGIN_PRESETS)}>{k => <option value={k}>{t("l.m." + k)}</option>}</For>
          </select>
          <For each={["top", "bottom", "left", "right"] as const}>{k => (<><label class="dxe-lbl">{t("l." + k)}</label><input class="dxe-num-in" style={{ width: "58px" }} type="number" min="0" step="0.1" disabled={!edit()} value={margin(k)} onChange={e => setM(k, parseFloat(e.currentTarget.value))} /></>)}</For>
          <label class="dxe-lbl">cm</label>
        </Grp>
      </>
    );
  };

  const ViewTab = () => (
    <>
      <Grp cap={t("g.zoom")}>
        <Btn icon="minus" title={t("v.zoomOut")} onClick={() => setZoom(zoom() - 0.1)} />
        <input type="range" min="25" max="300" step="5" value={Math.round(zoom() * 100)} onInput={e => setZoom(+e.currentTarget.value / 100)} style={{ width: "120px" }} />
        <Btn icon="plus" title={t("v.zoomIn")} onClick={() => setZoom(zoom() + 0.1)} />
        <span class="dxe-lbl">{Math.round(zoom() * 100)}%</span>
        <Btn label="100%" onClick={() => setZoom(1)} />
        <Btn label={t("v.fitWidth")} onClick={() => { view?.fitWidth(); setZoomSig(view?.zoom ?? 1); }} />
        <Btn label={t("v.fitPage")} onClick={() => { view?.fitPage(); setZoomSig(view?.zoom ?? 1); }} />
      </Grp>
      <Grp cap={t("g.show")}>
        <label class="dxe-chk"><input type="checkbox" checked={marks()} onChange={e => setMarks(e.currentTarget.checked)} />{t("v.marks")}</label>
        <label class="dxe-chk"><input type="checkbox" checked={revs()} onChange={e => setRevs(e.currentTarget.checked)} />{t("v.revisions")}</label>
        <label class="dxe-chk"><input type="checkbox" checked={dark()} onChange={e => setDark(e.currentTarget.checked)} />{t("v.dark")}</label>
        <Btn icon="outline" label={t("v.outline")} on={panel() === "outline"} onClick={() => setPanel(p => (p === "outline" ? null : "outline"))} />
      </Grp>
      <Grp cap={t("g.window")}>
        <Btn icon="eyeoff" label={t("v.hideToolbar")} onClick={() => setTbHidden(true)} />
        <Btn icon={fs() ? "shrink" : "expand"} label={fs() ? t("v.exitFs") : t("v.fullscreen")} onClick={() => void toggleFs()} />
      </Grp>
    </>
  );

  const TblPicker = () => (
    <div class="dxe-gridpick">
      <div class="g" onMouseLeave={() => setGridHover({ r: 0, c: 0 })}>
        <For each={Array.from({ length: 80 }, (_, k) => k)}>{k => { const r = Math.floor(k / 10) + 1, c = (k % 10) + 1; return <i classList={{ on: r <= gridHover().r && c <= gridHover().c }} onMouseEnter={() => setGridHover({ r, c })} onMouseDown={e => e.preventDefault()} onClick={() => { setMenu(null); view?.insertTable(r, c); }} />; }}</For>
      </div>
      <div class="cap">{gridHover().r ? `${gridHover().r} × ${gridHover().c}` : t("m.pickTable")}</div>
    </div>
  );

  const BorderMenu = () => (
    <>
      <For each={["all", "outer", "inner", "top", "bottom", "left", "right", "insideH", "insideV"]}>{p => <MI label={t("bd." + p)} onClick={() => view?.table("borders", { preset: p, spec: borderSpec() })} />}</For>
      <hr />
      <MI label={t("bd.none")} onClick={() => view?.table("borders", { preset: "none", spec: null })} />
    </>
  );

  const TableMenuItems = () => (
    <>
      <div class="h">{t("g.rowsCols")}</div>
      <MI label={t("t.rowAbove")} onClick={() => view?.table("insertRowAbove")} /><MI label={t("t.rowBelow")} onClick={() => view?.table("insertRowBelow")} />
      <MI label={t("t.colLeft")} onClick={() => view?.table("insertColLeft")} /><MI label={t("t.colRight")} onClick={() => view?.table("insertColRight")} />
      <MI label={t("t.delRow")} onClick={() => view?.table("deleteRows")} /><MI label={t("t.delCol")} onClick={() => view?.table("deleteCols")} /><MI label={t("t.delTable")} onClick={() => view?.table("deleteTable")} />
      <hr />
      <MI label={t("t.merge")} onClick={() => view?.table("merge")} /><MI label={t("t.split")} onClick={() => view?.table("split", 2)} />
      <MI label={t("t.selRow")} onClick={() => view?.table("selectRow")} /><MI label={t("t.selCol")} onClick={() => view?.table("selectCol")} /><MI label={t("t.selTable")} onClick={() => view?.table("select")} />
    </>
  );

  const sidePanel = (cls = "") => (
    <div class={`dxe-side ${cls}`}>
      <div class="dxe-side-h">
        <span style={{ flex: 1 }}>{panel() ? t("panel." + panel()) : ""}</span>
        <Btn icon="x" title={t("b.close")} onClick={() => setPanel(null)} />
      </div>
      <div class="dxe-side-b">
        <Show when={panel() === "find"}>
          <div style={{ display: "flex", gap: "4px", "margin-bottom": "6px" }}>
            <input ref={findInput} class="dxe-txt" style={{ flex: 1 }} placeholder={t("find.placeholder")} value={fq()} onInput={e => { setFq(e.currentTarget.value); scheduleSearch(); }}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); } }} />
            <Btn icon="arrowUp" title={t("find.prev") + " (Shift+F3)"} onClick={() => step(-1)} disabled={!fRes()?.hits.length} />
            <Btn icon="arrowDown" title={t("find.next") + " (F3)"} onClick={() => step(1)} disabled={!fRes()?.hits.length} />
          </div>
          <div style={{ display: "flex", gap: "2px", "flex-wrap": "wrap", "margin-bottom": "6px" }}>
            <Btn on={fCase()} title={t("find.case")} onClick={() => { setFCase(v => !v); runSearch(); }}>Aa</Btn>
            <Btn on={fWord()} title={t("find.word")} onClick={() => { setFWord(v => !v); runSearch(); }}><u>ab</u></Btn>
            <Btn on={fRegex()} title={t("find.regex")} onClick={() => { setFRegex(v => !v); setFAdv(v => (fRegex() ? v : true)); runSearch(); }}>.*</Btn>
            <Btn on={fAdv()} label={t("find.advanced")} onClick={() => setFAdv(v => !v)} />
          </div>
          <Show when={fAdv()}>
            <Show when={fRegex()}>
              <div style={{ display: "flex", gap: "6px", "align-items": "center", "margin-bottom": "6px" }}>
                <span class="dxe-lbl">{t("find.flags")}</span>
                <label class="dxe-chk" title={t("find.flagS")}><input type="checkbox" checked={fFlags().includes("s")} onChange={e => { setFFlags(f => (e.currentTarget.checked ? f + "s" : f.replace("s", ""))); runSearch(); }} />s</label>
                <label class="dxe-chk" title={t("find.flagM")}><input type="checkbox" checked={fFlags().includes("m")} onChange={e => { setFFlags(f => (e.currentTarget.checked ? f + "m" : f.replace("m", ""))); runSearch(); }} />m</label>
              </div>
              <div class="dxe-note">{t("find.regexHelp")}</div>
            </Show>
            <div style={{ display: "flex", gap: "4px", "margin-bottom": "6px" }}>
              <input class="dxe-txt" style={{ flex: 1 }} placeholder={t("find.replaceWith")} value={fRepl()} disabled={ro()} onInput={e => setFRepl(e.currentTarget.value)} />
              <Btn icon="replace" title={t("find.replaceOne")} disabled={ro() || !fRes()?.hits.length} onClick={replaceCur} />
              <Btn label={t("find.replaceAll")} disabled={ro() || !fRes()?.hits.length} onClick={replaceAll} />
            </div>
          </Show>
          <Show when={regexErr()}><div class="dxe-warnbox">{t("find.badRegex")}: {regexErr()}</div></Show>
          <Show when={fq() && !regexErr()}>
            <div class="dxe-note"><b>{fRes()?.hits.length ?? 0}</b> {t("find.count")}{fRes()?.truncated ? ` (${t("find.truncated")})` : ""}{fCur() >= 0 ? ` · ${fCur() + 1}/${fRes()?.hits.length}` : ""}</div>
          </Show>
          <div class="dxe-list">
            <For each={(fRes()?.hits ?? []).slice(0, fLimit())}>{h => (
              <div class="dxe-row" classList={{ on: fCur() === h.index }} onClick={() => gotoHit(h.index)}>
                <span class="lv">{h.index + 1}</span>
                <div style={{ flex: 1, "min-width": 0 }}>
                  <div style={{ "word-break": "break-word" }}>…{h.before}<mark>{h.text}</mark>{h.after}…</div>
                  <div class="loc">{whereLabel(h)} · {t("find.page", { n: view?.pageOfHit(h) ?? 0 })} · {t("find.offset", { n: h.start + 1 })}</div>
                  <Show when={fRegex() && h.groups.length}><div class="loc">{h.groups.map((g, i) => `$${i + 1}=“${g}”`).join("  ")}</div></Show>
                </div>
              </div>
            )}</For>
          </div>
          <Show when={(fRes()?.hits.length ?? 0) > fLimit()}><Btn label={t("find.more", { n: (fRes()?.hits.length ?? 0) - fLimit() })} onClick={() => setFLimit(l => l + 500)} /></Show>
        </Show>

        <Show when={panel() === "outline"}>
          <Show when={outline().length} fallback={<div class="dxe-note">{t("outline.empty")}</div>}>
            <div class="dxe-list"><For each={outline()}>{o => <div class="dxe-row" style={{ "padding-left": `${6 + (o.level - 1) * 14}px` }} onClick={() => view?.scrollToPara(o.p)}><span class="lv">H{o.level}</span><span>{o.text}</span></div>}</For></div>
          </Show>
        </Show>

        <Show when={panel() === "history"}>
          <Show when={book()}>
            <div style={{ display: "flex", gap: "6px", "align-items": "center", "margin-bottom": "8px", "flex-wrap": "wrap" }}>
              <span class="dxe-lbl">{t("hist.max")}</span>
              <input class="dxe-num-in" type="number" min="1" max="1000" value={histMax()} onChange={e => setHistMax(Math.max(1, Math.min(1000, Math.floor(+e.currentTarget.value || 1))))} />
              <Btn icon="undo" disabled={!canUndo() || ro()} onClick={() => view?.undo()} />
              <Btn icon="redo" disabled={!canRedo() || ro()} onClick={() => view?.redo()} />
            </div>
            <div class="dxe-note">{t("hist.count", { n: book()!.hist.length - 1, i: book()!.histIdx })}</div>
            <div class="dxe-list">
              <For each={(ver(), book()!.hist.map((h, i) => ({ h, i })).reverse())}>{({ h, i }) => (
                <div class="dxe-row" classList={{ on: i === book()!.histIdx }} onClick={() => view?.jumpTo(i)}>
                  <span class="lv">#{i}</span><span style={{ flex: 1 }}>{i === 0 ? t("hist.open") : t(h.label)}</span><span class="loc">{new Date(h.at).toLocaleTimeString()}</span>
                </div>
              )}</For>
            </div>
          </Show>
        </Show>

        <Show when={panel() === "log"}>
          <div style={{ display: "flex", gap: "2px", "margin-bottom": "8px", "flex-wrap": "wrap" }}>
            <Btn on={logFilter() === "all"} onClick={() => setLogFilter("all")} label={`${t("log.all")} ${logs().length}`} />
            <Btn on={logFilter() === "info"} onClick={() => setLogFilter("info")} label={`${t("log.ok")} ${counts().info}`} />
            <Btn on={logFilter() === "warn"} onClick={() => setLogFilter("warn")} label={`${t("log.warn")} ${counts().warn}`} />
            <Btn on={logFilter() === "error"} onClick={() => setLogFilter("error")} label={`${t("log.error")} ${counts().error}`} />
            <span style={{ flex: 1 }} />
            <Btn label={t("b.copy")} onClick={() => { void navigator.clipboard?.writeText(logs().map(l => `[${l.level}] ${t(l.key, l.params)}`).join("\n")); toast("toast.copied"); }} />
          </div>
          <div class="dxe-list">
            <For each={logs().filter(l => logFilter() === "all" || l.level === logFilter())}>{l => (
              <div class="dxe-row" style={{ cursor: "default" }}><span class={`dxe-ic ${l.level}`}>{l.level === "info" ? "✓" : l.level === "warn" ? "⚠" : "✕"}</span><span style={{ flex: 1, "word-break": "break-word" }}>{t(l.key, l.params)}</span></div>
            )}</For>
          </div>
        </Show>

        <Show when={panel() === "info" && doc()}>
          {(() => {
            const d = () => doc()!;
            return (
              <>
                <div class="dxe-h3">{t("info.file")}</div>
                <dl class="dxe-kv">
                  <dt>{t("info.name")}</dt><dd>{book()!.fileName}</dd>
                  <dt>{t("info.size")}</dt><dd>{formatBytes(book()!.originalBytes.length)}</dd>
                  <dt>{t("info.parts")}</dt><dd>{d().parts.length}</dd>
                  <dt>{t("info.modified")}</dt><dd>{book()!.modified ? t("info.yes") : t("info.no")}</dd>
                  <dt>{t("info.compat")}</dt><dd>{book()!.compatMode() ?? "—"}</dd>
                </dl>
                <div style={{ display: "flex", gap: "4px", "flex-wrap": "wrap" }}>
                  <Btn icon="download" label={t("b.source")} onClick={saveSource} />
                </div>
                <div class="dxe-h3">{t("info.stats")}</div>
                <dl class="dxe-kv">
                  <dt>{t("info.pages")}</dt><dd>{pages()}</dd>
                  <dt>{t("info.words")}</dt><dd>{d().stats.words.toLocaleString()}</dd>
                  <dt>{t("info.chars")}</dt><dd>{d().stats.chars.toLocaleString()} ({d().stats.charsNoSpaces.toLocaleString()} {t("info.noSpaces")})</dd>
                  <dt>{t("info.paragraphs")}</dt><dd>{d().stats.paragraphs}</dd>
                  <dt>{t("info.tables")}</dt><dd>{d().stats.tables}</dd>
                  <dt>{t("info.images")}</dt><dd>{d().stats.images}</dd>
                  <dt>{t("info.headings")}</dt><dd>{d().stats.headings}</dd>
                  <dt>{t("info.styles")}</dt><dd>{d().styles.length}</dd>
                  <dt>{t("info.comments")}</dt><dd>{d().comments.length}</dd>
                  <dt>{t("info.appStats")}</dt><dd>{d().app.application ?? "—"} {d().app.appVersion ?? ""}{d().app.pages ? ` · ${d().app.pages}p` : ""}{d().app.words ? ` · ${d().app.words}w` : ""}</dd>
                </dl>
                <div class="dxe-h3">{t("info.props")}</div>
                <For each={["title", "creator", "subject", "keywords", "description", "category"]}>{k => (
                  <label class="dxe-field"><span>{t("prop." + k)}</span><input class="dxe-txt" disabled={ro()} value={propsDraft()[k] ?? ""} onInput={e => setPropsDraft(p => ({ ...p, [k]: e.currentTarget.value }))} /></label>
                )}</For>
                <dl class="dxe-kv">
                  <dt>{t("prop.lastModifiedBy")}</dt><dd>{d().core.lastModifiedBy ?? "—"}</dd>
                  <dt>{t("prop.created")}</dt><dd>{d().core.created ? new Date(d().core.created!).toLocaleString() : "—"}</dd>
                  <dt>{t("prop.modified")}</dt><dd>{d().core.modified ? new Date(d().core.modified!).toLocaleString() : "—"}</dd>
                  <dt>{t("prop.revision")}</dt><dd>{d().core.revision ?? "—"}</dd>
                </dl>
                <Btn primary label={t("info.applyProps")} disabled={ro()} onClick={applyProps} />
                <div class="dxe-h3">{t("info.sections")}</div>
                <table class="dxe-tbl"><thead><tr><th>#</th><th>{t("info.pageSize")}</th><th>{t("info.margins")}</th><th>{t("info.type")}</th></tr></thead>
                  <tbody><For each={d().sections}>{(s, i) => <tr><td>{i() + 1}</td><td>{twCm(s.w)}×{twCm(s.h)} cm {s.orient === "landscape" ? "↔" : "↕"}</td><td>{twCm(s.mt)}/{twCm(s.mr)}/{twCm(s.mb)}/{twCm(s.ml)}</td><td>{s.type}{s.titlePg ? " · 1st" : ""}{s.cols.num > 1 ? ` · ${s.cols.num}col` : ""}</td></tr>}</For></tbody></table>
                <Show when={d().comments.length}>
                  <div class="dxe-h3">{t("info.comments")}</div>
                  <For each={d().comments}>{c => <div class="dxe-note"><b>{c.author}</b>{c.date ? ` · ${new Date(c.date).toLocaleDateString()}` : ""}: {c.text}</div>}</For>
                </Show>
                <Show when={d().validation.length}>
                  <div class="dxe-h3">{t("info.validation")}</div>
                  <For each={d().validation}>{v => <div class="dxe-warnbox"><b>{v.code}</b> — {v.message}</div>}</For>
                </Show>
                <div class="dxe-h3">{t("info.partsList")}</div>
                <table class="dxe-tbl"><tbody><For each={d().parts}>{p => <tr><td style={{ "word-break": "break-all" }}>{p.n}</td><td>{formatBytes(p.size)}</td></tr>}</For></tbody></table>
              </>
            );
          })()}
        </Show>

        <Show when={panel() === "ole"}>
          <div class="dxe-note">{t("ole.help")}</div>
          <Show when={oleList().length} fallback={<div class="dxe-note">{t("ole.none")}</div>}>
            <div class="dxe-list">
              <For each={oleList()}>{(o, i) => (
                <div class="dxe-row" classList={{ on: oleSel() === i() }} onClick={() => selectOle(i())}>
                  <span class="lv">#{o.index}</span>
                  <div style={{ flex: 1, "min-width": 0 }}>
                    <div><b>{o.description}</b>{o.linked ? ` · ${t("ole.linked")}` : ""}</div>
                    <div class="loc">{o.progId ?? "—"} · {o.fileName} · {formatBytes(o.size)} · {o.format}{o.paragraph ? ` · ¶${o.paragraph}` : ""}</div>
                  </div>
                </div>
              )}</For>
            </div>
          </Show>
          <Show when={oleSel() !== null && oleList()[oleSel()!]}>
            {(() => {
              const o = () => oleList()[oleSel()!];
              const info = () => oleInfo();
              return (
                <>
                  <div class="dxe-h3">{t("ole.detail")}</div>
                  <dl class="dxe-kv">
                    <dt>{t("ole.part")}</dt><dd>{o().part}</dd><dt>{t("ole.relType")}</dt><dd>{o().relType}</dd><dt>{t("ole.aspect")}</dt><dd>{o().aspect ?? "—"}</dd>
                    <Show when={info()?.cfb}><dt>{t("ole.kind")}</dt><dd>{info()!.cfb!.kind ?? "—"}</dd><dt>{t("ole.userType")}</dt><dd>{info()!.cfb!.userType ?? "—"}</dd><dt>CLSID</dt><dd>{info()!.cfb!.rootClsid ?? "—"}</dd></Show>
                    <Show when={info()?.cfb?.native}><dt>{t("ole.embedded")}</dt><dd>{info()!.cfb!.native!.fileName} ({formatBytes(info()!.cfb!.native!.size)})</dd><dt>{t("ole.srcPath")}</dt><dd>{info()!.cfb!.native!.srcPath}</dd></Show>
                  </dl>
                  <div style={{ display: "flex", gap: "4px", "flex-wrap": "wrap" }}>
                    <Btn icon="download" label={t("ole.dlRaw")} disabled={o().format === "missing"} onClick={() => oleDownload(o(), "raw")} />
                    <Btn icon="download" label={t("ole.dlNative")} disabled={!info()?.cfb?.native} onClick={() => oleDownload(o(), "native")} />
                  </div>
                  <Show when={o().format === "zip"}><div class="dxe-note">{t("ole.zipNote")}</div></Show>
                  <Show when={info()?.cfb}>
                    <div class="dxe-h3">{t("ole.structure")}</div>
                    <table class="dxe-tbl"><thead><tr><th>{t("ole.entry")}</th><th>{t("ole.type")}</th><th>{t("info.size")}</th></tr></thead>
                      <tbody><For each={info()!.cfb!.entries}>{e => <tr style={{ cursor: e.type === "stream" ? "pointer" : "default" }} onClick={() => e.type === "stream" && oleStream(e.path)}><td style={{ "word-break": "break-all" }}>{e.path}</td><td>{e.type}</td><td>{e.type === "stream" ? e.size : ""}</td></tr>}</For></tbody></table>
                    <Show when={info()?.dump}><div class="dxe-h3">{info()!.stream}</div><div class="dxe-code">{info()!.dump}</div></Show>
                  </Show>
                </>
              );
            })()}
          </Show>
          <Show when={vba()}>
            <div class="dxe-h3">{t("ole.macros")}</div>
            <div class="dxe-warnbox">{t("ole.macroNote")}</div>
            <Show when={!oleInfo()?.vba}><Btn label={t("ole.readVba")} onClick={loadVba} /></Show>
            <Show when={oleInfo()?.vba}>
              <Show when={oleInfo()!.vba!.error}><div class="dxe-warnbox">{oleInfo()!.vba!.error}</div></Show>
              <div class="dxe-list"><For each={oleInfo()!.vba!.modules}>{(m, i) => <div class="dxe-row" classList={{ on: oleInfo()!.vbaMod === i() }} onClick={() => setOleInfo(x => ({ ...(x ?? {}), vbaMod: i() }))}><span class="lv">{m.type}</span><span style={{ flex: 1 }}>{m.name}</span><span class="loc">{formatBytes(m.size)}</span></div>}</For></div>
              <Show when={oleInfo()!.vbaMod !== undefined && oleInfo()!.vba!.modules[oleInfo()!.vbaMod!]}><div class="dxe-code" style={{ "margin-top": "6px" }}>{oleInfo()!.vba!.modules[oleInfo()!.vbaMod!].source ?? t("ole.noSource")}</div></Show>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );

  return (
    <div ref={rootEl} class={`dxe-root ${props.class ?? ""}`} classList={{ dark: dark(), "dxe-fs": cssFs() }} style={{ height: props.height ?? "78vh" }} tabIndex={-1}
      onKeyDown={onRootKey}
      onDragOver={e => { if (e.dataTransfer?.types.includes("Files")) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={() => setDragOver(false)}>
      <input ref={fileInput} type="file" hidden accept=".docx,.docm,.dotx,.dotm,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={e => { void openFile(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
      <input ref={imgInput} type="file" hidden accept="image/png,image/jpeg,image/gif,image/bmp,image/webp,image/svg+xml" onChange={e => { const f = e.currentTarget.files?.[0]; if (f) void view?.insertImageFile(f); e.currentTarget.value = ""; }} />
      <input ref={replInput} type="file" hidden accept="image/*" onChange={e => { const f = e.currentTarget.files?.[0]; if (f) void view?.imgReplace(f); e.currentTarget.value = ""; }} />

      {/* top bar */}
      <div class="dxe-top">
        <div class="dxe-title" title={book()?.fileName}>
          <i>W</i><span class="n">{book()?.fileName ?? "DOCX Editor"}</span>
          <Show when={modified()}><span class="dxe-tag mod" title={t("tag.modifiedTip")}>●</span></Show>
          <Show when={ro()}><span class="dxe-tag" title={t("tag.readonlyTip")}>{t("tag.readonly")}</span></Show>
          <Show when={book()?.partNames().some(n => /vbaProject/.test(n))}><span class="dxe-tag warn" title={t("tag.macroTip")}>{t("tag.macro")}</span></Show>
        </div>
        <div class="dxe-grp">
          <Btn icon="open" label={t("b.open")} title={t("b.openTip") + " (Ctrl+O)"} onClick={() => fileInput.click()} />
          <Btn icon="sample" title={t("b.sample")} onClick={() => void openSample()} />
          <Btn icon="save" label={t("b.save")} primary title={t("b.saveTip") + " (Ctrl+S)"} disabled={ro() || !book()} onClick={saveDocx} />
          <Btn icon="download" label={t("b.export")} menu disabled={!book()} onClick={e => openMenu("export", e)} />
        </div>
        <div class="dxe-grp">
          <Btn icon="undo" title={t("b.undo") + " (Ctrl+Z)"} disabled={ro() || !canUndo()} onClick={() => view?.undo()} />
          <Btn icon="redo" title={t("b.redo") + " (Ctrl+Y)"} disabled={ro() || !canRedo()} onClick={() => view?.redo()} />
          <Btn icon="clock" title={t("b.history")} on={panel() === "history"} onClick={() => setPanel(p => (p === "history" ? null : "history"))} />
        </div>
        <div class="dxe-grp">
          <Btn icon="search" label={t("b.find")} title={t("b.find") + " (Ctrl+F)"} on={panel() === "find"} onClick={() => (panel() === "find" ? setPanel(null) : openFind())} />
          <Btn icon="info" title={t("b.info")} on={panel() === "info"} onClick={() => setPanel(p => (p === "info" ? null : "info"))} />
          <Btn icon="log" title={t("b.log")} on={panel() === "log"} badge={counts().error || counts().warn} badgeKind={counts().error ? "" : "w"} onClick={() => setPanel(p => (p === "log" ? null : "log"))} />
          <Btn icon="clip" title={t("b.ole")} on={panel() === "ole"} badge={oleList().length + (vba() ? 1 : 0) || undefined} badgeKind="i" onClick={() => setPanel(p => (p === "ole" ? null : "ole"))} />
          <Btn icon="bug" title={t("b.debug")} disabled={!book()} onClick={openDebug} />
        </div>
        <span class="dxe-spacer" />
        <div class="dxe-grp">
          <Btn icon="globe" label={lang().toUpperCase()} title={t("b.language")} menu onClick={e => openMenu("lang", e)} />
          <Btn icon={tbHidden() ? "eye" : "eyeoff"} title={tbHidden() ? t("v.showToolbar") : t("v.hideToolbar")} on={tbHidden()} onClick={() => setTbHidden(v => !v)} />
          <Btn icon={fs() ? "shrink" : "expand"} title={fs() ? t("v.exitFs") : t("v.fullscreen")} onClick={() => void toggleFs()} />
        </div>
      </div>

      <Show when={!tbHidden()}>
        <div class="dxe-tabs">
          <For each={["home", "insert", "table", "picture", "layout", "view"] as Tab[]}>{k => (
            <button class="dxe-tab" classList={{ on: tab() === k, ctx: (k === "table" && inTable()) || (k === "picture" && hasImg()) }} onMouseDown={e => e.preventDefault()} onClick={() => setTab(k)}>{t("tab." + k)}</button>
          )}</For>
        </div>
        <div class="dxe-ribbon">
          <Show when={tab() === "home"}><Home /></Show>
          <Show when={tab() === "insert"}><Insert /></Show>
          <Show when={tab() === "table"}><TableTab /></Show>
          <Show when={tab() === "picture"}><PictureTab /></Show>
          <Show when={tab() === "layout"}><LayoutTab /></Show>
          <Show when={tab() === "view"}><ViewTab /></Show>
        </div>
      </Show>
      <Show when={tbHidden()}>
        <button class="dxe-btn dxe-showbar" style={{ background: "var(--dx-panel)", border: "1px solid var(--dx-border)" }} onClick={() => setTbHidden(false)} title={t("v.showToolbar")}><Ic n="panel" /><span>{t("v.showToolbar")}</span></button>
      </Show>

      <Show when={painter()}>
        <div class="dxe-painter">
          <Ic n="brush" /><b>{t("painter.copied")}</b>
          <For each={painter()!.char}>{([k, v]) => <span class="kv">{t("pk." + k)}: {v}</span>}</For>
          <For each={painter()!.para}>{([k, v]) => <span class="kv">¶ {t("pk." + k)}: {v}</span>}</For>
          <span style={{ flex: 1 }} />
          <span>{painter()!.sticky ? t("painter.sticky") : t("painter.once")}</span>
          <Btn icon="x" label={t("b.cancel")} onClick={() => view?.cancelPainter()} />
        </div>
      </Show>

      <div class="dxe-main">
        <Show when={panel() === "outline"}>{sidePanel("left")}</Show>
        <div class="dxe-canvas">
          <div ref={hostEl} class="dxe-host" />
          <Show when={busy()}><div class="dxe-busy">{t(busy()!)}</div></Show>
          <Show when={dragOver()}><div class="dxe-drop">{t("drop.hint")}</div></Show>
          <Show when={loadErr()}>
            {(() => {
              const e = () => loadErr()!;
              return (
                <div style={{ position: "absolute", inset: 0, overflow: "auto", background: "var(--dx-canvas)", "z-index": 60, padding: "14px" }}>
                  <div class="dxe-errbox">
                    <b>{t("err." + e().code)}</b>
                    <div style={{ margin: "6px 0", "word-break": "break-word" }}>{e().msg}</div>
                    <div class="dxe-note">{t("err.hint")}</div>
                    <div style={{ display: "flex", gap: "6px", "margin-top": "8px", "flex-wrap": "wrap" }}>
                      <Btn icon="open" label={t("b.open")} onClick={() => fileInput.click()} />
                      <Btn icon="sample" label={t("b.sample")} onClick={() => void openSample()} />
                      <Show when={e().bytes}><Btn icon="download" label={t("b.source")} onClick={() => downloadBlob(e().name, new Blob([e().bytes as BlobPart]))} /></Show>
                    </div>
                    <Show when={e().info}>
                      <div class="dxe-h3">{t("err.cfb", { kind: e().info!.kind ?? "OLE" })}</div>
                      <table class="dxe-tbl"><tbody><For each={e().info!.entries}>{x => <tr><td style={{ "word-break": "break-all" }}>{x.path}</td><td>{x.type}</td><td>{x.type === "stream" ? x.size : ""}</td></tr>}</For></tbody></table>
                    </Show>
                  </div>
                </div>
              );
            })()}
          </Show>
        </div>
        <Show when={panel() && panel() !== "outline"}>{sidePanel()}</Show>
      </div>

      {/* status bar */}
      <div class="dxe-status">
        <span class="it">{t("s.page", { p: S()?.page || 1, n: pages() })}</span>
        <span class="it">{t("s.words", { n: words().toLocaleString() })}</span>
        <Show when={S()?.has}>
          <span class="it">{t("s.para", { i: S()!.paraIndex, n: S()!.paraCount })} · {t("s.col", { n: S()!.col })}</span>
          <Show when={S()!.selChars > 0}><span class="it chip">{t("s.selected", { c: S()!.selChars, w: S()!.selWords, p: S()!.selParas })}</span></Show>
          <span class="it">{S()!.styleName ?? ""}{S()!.font ? ` · ${S()!.font}` : ""}{S()!.size ? ` ${S()!.size}pt` : ""}{S()!.bold ? " B" : ""}{S()!.italic ? " I" : ""}{S()!.underline ? " U" : ""}{S()!.pending ? " ⏳" : ""}</span>
          <Show when={S()!.list}><span class="it">{S()!.list === "bullet" ? "•" : "1."} {t("s.list")}</span></Show>
          <Show when={S()!.link}><span class="it" title={S()!.link}>🔗 {S()!.link!.length > 36 ? S()!.link!.slice(0, 36) + "…" : S()!.link}</span></Show>
        </Show>
        <Show when={S()?.table}>
          <span class="it chip">{t("s.table", { n: S()!.table!.index, r: S()!.table!.row, c: S()!.table!.col, rows: S()!.table!.rows, cols: S()!.table!.cols })}{S()!.table!.merged ? ` · ${t("s.merged")}` : ""}{S()!.table!.selRows ? ` · ${t("s.cellsel", { r: S()!.table!.selRows!, c: S()!.table!.selCols! })}` : ""}</span>
        </Show>
        <Show when={img()}>
          <span class="it chip">{t("s.image", { w: cm(img()!.wPx), h: cm(img()!.hPx) })} · {t("wrap." + (img()!.wrap === "tight" || img()!.wrap === "through" ? "square" : img()!.wrap))}{img()!.rot ? ` · ${Math.round(img()!.rot)}°` : ""}{img()!.lock ? " · 🔒" : ""}</span>
        </Show>
        <span class="sp" />
        <Show when={ro()}><span class="it chip">{t("tag.readonly")}</span></Show>
        <span class="it" title={t("s.historyTip")}>{(ver(), t("s.history", { i: book()?.histIdx ?? 0, n: Math.max(0, (book()?.hist.length ?? 1) - 1), max: histMax() }))}</span>
        <button onClick={() => setZoom(zoom() - 0.1)} title={t("v.zoomOut")}>−</button>
        <input type="range" min="25" max="300" step="5" value={Math.round(zoom() * 100)} onInput={e => setZoom(+e.currentTarget.value / 100)} />
        <button onClick={() => setZoom(zoom() + 0.1)} title={t("v.zoomIn")}>+</button>
        <span class="it" style={{ width: "40px", "text-align": "right" }}>{Math.round(zoom() * 100)}%</span>
      </div>

      {/* menus */}
      <Show when={menu()}>
        {(() => {
          const m = () => menu()!;
          return (
            <div class="dxe-menu" style={{ left: `${m().x}px`, top: `${m().y}px` }} onMouseDown={e => { if (!(e.target as HTMLElement).closest("input,select")) e.preventDefault(); }}>
              <Show when={m().id === "export"}>
                <MI icon="save" label={t("m.docx")} disabled={ro()} onClick={saveDocx} />
                <MI icon="txt" label={t("m.txt")} onClick={saveTxt} />
                <MI icon="code" label={t("m.html")} onClick={saveHtml} />
                <hr />
                <MI icon="download" label={t("m.source")} onClick={saveSource} />
                <MI label={t("m.new")} disabled={ro()} onClick={() => void newBlank()} />
              </Show>
              <Show when={m().id === "history"}><div class="h">{t("b.history")}</div></Show>
              <Show when={m().id === "table"}><TblPicker /></Show>
              <Show when={m().id === "borders"}><BorderMenu /></Show>
              <Show when={m().id === "symbols"}><div class="dxe-gridpick"><div class="g" style={{ "grid-template-columns": "repeat(6, 28px)" }}><For each={SYMBOLS}>{s => <i style={{ width: "28px", height: "28px", display: "grid", "place-items": "center", "font-style": "normal" }} onMouseDown={e => e.preventDefault()} onClick={() => { setMenu(null); view?.insertTextAtSel(s); }}>{s}</i>}</For></div></div></Show>
              <Show when={m().id === "case"}>
                <MI label={t("case.upper")} onClick={() => view?.changeCase("upper")} /><MI label={t("case.lower")} onClick={() => view?.changeCase("lower")} /><MI label={t("case.title")} onClick={() => view?.changeCase("title")} />
              </Show>
              <Show when={m().id === "lang"}>
                <MI label="English" onClick={() => setLang("en")} /><MI label="Bahasa Indonesia" onClick={() => setLang("id")} />
              </Show>
              <Show when={m().id === "ctx-text"}>
                <MI label={t("b.bold")} disabled={!edit()} onClick={() => view?.toggleRun("b")} /><MI label={t("b.italic")} disabled={!edit()} onClick={() => view?.toggleRun("i")} /><MI label={t("b.underline")} disabled={!edit()} onClick={() => view?.toggleUnderline()} />
                <hr /><MI label={t("b.link")} disabled={!edit()} onClick={() => { setLinkUrl(S()?.link ?? "https://"); setLinkTip(""); setDialog("link"); }} />
                <MI label={t("b.painter")} disabled={!edit()} onClick={() => view?.startPainter(false)} /><MI label={t("b.clearFmt")} disabled={!edit()} onClick={() => view?.clearFormat()} />
                <hr /><MI icon="table" label={t("b.table")} disabled={!edit()} onClick={() => view?.insertTable(3, 3)} /><MI icon="image" label={t("b.picture")} disabled={!edit()} onClick={() => imgInput.click()} />
              </Show>
              <Show when={m().id === "ctx-table"}><TableMenuItems /><hr /><MI label={t("b.painter")} disabled={!edit()} onClick={() => view?.startPainter(false)} /></Show>
              <Show when={m().id === "ctx-image"}>
                <MI label={t("p.reset")} disabled={!edit()} onClick={() => view?.imgReset()} /><MI label={t("p.replace")} disabled={!edit()} onClick={() => replInput.click()} />
                <MI label={t("p.duplicate")} disabled={!edit()} onClick={() => view?.imgDuplicate()} /><hr />
                <For each={["inline", "square", "topBottom", "behind", "front"]}>{w => <MI label={t("wrap." + w)} disabled={!edit()} onClick={() => view?.imgSetWrap(w as never)} />}</For>
                <hr /><MI icon="trash" label={t("p.delete")} disabled={!edit()} onClick={() => view?.imgDelete()} />
              </Show>
            </div>
          );
        })()}
      </Show>

      {/* dialog */}
      <Show when={dialog() === "debug"}>
        <div class="dxe-modal-bg" onClick={e => { if (e.target === e.currentTarget) setDialog(null); }}>
          <div class="dxe-modal">
            <div class="dxe-modal-h"><Ic n="bug" /> {t("dlg.debug")}<span style={{ flex: 1 }} /><Btn icon="x" onClick={() => setDialog(null)} /></div>
            <div class="dxe-modal-b"><div class="dxe-note">{t("dlg.debugHelp")}</div><textarea class="dxe-txt" readOnly rows={22} style={{ "min-height": "320px" }} value={dbg()} /></div>
            <div class="dxe-modal-f"><Btn label={t("b.refresh")} onClick={openDebug} /><Btn label={t("b.copy")} onClick={() => { void navigator.clipboard?.writeText(dbg()); toast("toast.copied"); }} /><Btn label={t("b.download")} onClick={() => downloadBlob("docx-debug.json", new Blob([dbg()], { type: "application/json" }))} /><Btn primary label={t("b.close")} onClick={() => setDialog(null)} /></div>
          </div>
        </div>
      </Show>
      <Show when={dialog() === "link"}>
        <div class="dxe-modal-bg" onClick={e => { if (e.target === e.currentTarget) setDialog(null); }}>
          <div class="dxe-modal sm">
            <div class="dxe-modal-h"><Ic n="link" /> {t("dlg.link")}<span style={{ flex: 1 }} /><Btn icon="x" onClick={() => setDialog(null)} /></div>
            <div class="dxe-modal-b">
              <label class="dxe-field"><span>URL / #bookmark</span><input class="dxe-txt" value={linkUrl()} onInput={e => setLinkUrl(e.currentTarget.value)} ref={el => queueMicrotask(() => el.select())} onKeyDown={e => { if (e.key === "Enter") { view?.setLink(linkUrl().trim() || null, linkTip() || undefined); setDialog(null); } }} /></label>
              <label class="dxe-field"><span>{t("dlg.linkTip")}</span><input class="dxe-txt" value={linkTip()} onInput={e => setLinkTip(e.currentTarget.value)} /></label>
              <Show when={S()?.collapsed && !S()?.link}><div class="dxe-note">{t("dlg.linkSelect")}</div></Show>
            </div>
            <div class="dxe-modal-f">
              <Show when={S()?.link}><Btn label={t("b.unlink")} onClick={() => { view?.setLink(null); setDialog(null); }} /></Show>
              <Btn label={t("b.cancel")} onClick={() => setDialog(null)} />
              <Btn primary label={t("b.apply")} onClick={() => { view?.setLink(linkUrl().trim() || null, linkTip() || undefined); setDialog(null); }} />
            </div>
          </div>
        </div>
      </Show>
      <Show when={toastMsg()}><div class="dxe-toast">{toastMsg()}</div></Show>
    </div>
  );
}

