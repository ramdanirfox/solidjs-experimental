/**
 * Editor PPTX (client-only) berbasis @office-kit/pptx.
 * Kanvas slide 16:9 dengan render dari model OOXML (bentuk, teks, tabel, grafik, gambar, grup), seleksi + seret/ubah ukuran/putar,
 * edit teks di tempat, sisip bentuk/tabel/grafik/gambar, format painter, cari & ganti, miniatur slide (urut ulang lewat seret),
 * catatan, transisi, animasi, slideshow, info + log + OLE/makro + debug, undo history (maks. dapat disetel), readonly, i18n (en/id).
 */
import { For, Show, batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, type JSX } from "solid-js";
import * as P from "@office-kit/pptx";
import { PptxDeck, PptxLoadError } from "./pptx-model";
import { PptxView, type FindHit, type PxSelInfo, type Tool } from "./pptx-view";
import { createSampleDeck } from "./pptx-sample";
import { createI18n, type Lang } from "./pptx-i18n";
import { hexDump, isCfb, isZip, readCfb, readVba, streamBytes, type CfbInfo, type VbaInfo } from "../office-shared/ole-core";
import { formatBytes } from "../docx-editor/docx-util";
import { listPptxOle, pptxOleBytes, type PptxOle } from "./pptx-ole";
import { createEventBus, type EditorEventBus } from "../editor-kit/events";
import { readFileInput, oleEventInfo, type FileInput, type OfficeCommonEvents, type OfficeOleEvents, type OleEventInfo, type OleInsertOptions } from "../editor-kit/office-events";
import { RulerKit, type RulerEventMap } from "../editor-kit/ruler-kit";
import { RULER_UNITS, type RulerUnit } from "../editor-kit/ruler-core";
import { prepareOle } from "../office-shared/ole-embed";
import "./pptx-editor.css";

/** Event yang dipancarkan editor PPTX (bus: `api.events`; DOM: CustomEvent `pptx-editor:<tipe>` pada elemen akar). */
export interface PptxEditorEventMap extends OfficeCommonEvents, OfficeOleEvents, RulerEventMap {
  ready: { api: PptxEditorApi };
  selection: { info: PxSelInfo };
  /** Slide aktif berpindah. */
  slide: { index: number; count: number };
  find: { query: string; count: number };
  tool: { tool: Tool };
}

/** Handle imperatif yang diberikan lewat `onReady`. */
export interface PptxEditorApi {
  readonly events: EditorEventBus<PptxEditorEventMap>;
  on: EditorEventBus<PptxEditorEventMap>["on"];
  off: EditorEventBus<PptxEditorEventMap>["off"];
  once: EditorEventBus<PptxEditorEventMap>["once"];
  /** Jalankan perintah bernama (sama dengan CustomEvent `pptx-editor:command`). */
  run<T = unknown>(command: string, ...args: unknown[]): Promise<T>;
  getDeck(): PptxDeck | undefined;
  getView(): PptxView | undefined;
  load(input: Uint8Array | ArrayBuffer | File, fileName?: string): Promise<void>;
  /** PPTX hasil edit (bytes). */
  getBytes(): Promise<Uint8Array | undefined>;
  getText(): string;
  undo(): Promise<void>;
  redo(): Promise<void>;
  goTo(slideIndex: number): void;
  getSlideCount(): number;
  setZoom(z: number): void;
  getZoom(): number;
  /** Penggaris (satuan px slide 1280×720), garis bantu yang menjadi target snapping, dan alat ukur. */
  readonly ruler: RulerKit;
  readonly ole: {
    list(): PptxOle[];
    /** Sisipkan berkas apa pun sebagai objek OLE di slide aktif (atau `opts.slide`). */
    insert(file: FileInput, opts?: OleInsertOptions & { slide?: number; at?: { x?: number; y?: number; w?: number; h?: number } }): Promise<OleEventInfo | undefined>;
    /** Ganti isi objek OLE `id` ("slide:shapeId", mis. "0:12"); posisi & ukuran tetap. */
    update(id: string, file: FileInput, opts?: OleInsertOptions): Promise<OleEventInfo | undefined>;
    getBytes(id: string): Uint8Array | undefined;
    /** Ubah ukuran bingkai (px slide). */
    resize(id: string, wPx: number, hPx: number): Promise<boolean>;
  };
}

export interface PptxEditorProps {
  /** URL berkas .pptx yang dimuat di awal. */
  src?: string;
  /** Bytes presentasi yang dimuat di awal (alternatif `src`). */
  data?: Uint8Array | ArrayBuffer;
  fileName?: string;
  /** Muat presentasi contoh bila `src`/`data` tidak diberikan (default: true). */
  sample?: boolean;
  height?: string;
  class?: string;
  /** Mode baca-saja: tanpa edit, undo, dan simpan; navigasi, cari, slideshow, dan unduh tetap tersedia. */
  readonly?: boolean;
  /** Bahasa antarmuka. Default: dari browser (id/en). */
  locale?: Lang;
  onLocaleChange?: (l: Lang) => void;
  /** Maksimum catatan riwayat undo (default 100). */
  maxHistory?: number;
  /** Sembunyikan toolbar/ribbon di awal. */
  toolbarHidden?: boolean;
  onChange?: (info: { label: string; modified: boolean }) => void;
  /** Bus event milik aplikasi (opsional). Tanpa ini editor membuat bus sendiri; selalu tersedia lewat `api.events`. */
  bus?: EditorEventBus<PptxEditorEventMap>;
  /** Menerima SETIAP event editor. */
  onEvent?: <K extends keyof PptxEditorEventMap>(type: K, payload: PptxEditorEventMap[K], api: PptxEditorApi) => void;
  onReady?: (api: PptxEditorApi) => void;
  /** Tampilkan penggaris di awal (default false). */
  ruler?: boolean;
  /** Satuan penggaris. Default "cm". */
  rulerUnit?: RulerUnit;
}

const ICONS: Record<string, string> = {
  open: "M6 14l1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",
  save: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z M17 21v-8H7v8 M7 3v5h8",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3",
  undo: "M3 7v6h6 M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13", redo: "M21 7v6h-6 M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01",
  log: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8",
  bug: "M8 2l1.88 1.88 M14.12 3.88L16 2 M9 7.13v-1a3.003 3.003 0 1 1 6 0v1 M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6 M12 20v-9 M6.53 9C4.6 8.8 3 7.1 3 5 M6 13H2 M20.97 5c0 2.1-1.6 3.8-3.5 4 M22 13h-4",
  expand: "M15 3h6v6 M9 21H3v-6 M21 3l-7 7 M3 21l7-7", shrink: "M4 14h6v6 M20 10h-6V4 M14 10l7-7 M3 21l7-7",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  eyeoff: "M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94 M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19 m-6.72-1.07a3 3 0 1 1-4.24-4.24 M1 1l22 22",
  bullets: "M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01", numbers: "M10 6h11 M10 12h11 M10 18h11 M4 6h1v4 M4 10h2 M6 18H4c0-1 2-2 2-3s-1-1.5-2-1",
  indent: "M3 8l4 4-4 4 M21 6H11 M21 12H11 M21 18H11", outdent: "M7 8l-4 4 4 4 M21 6H11 M21 12H11 M21 18H11",
  alignL: "M17 10H3 M21 6H3 M21 14H3 M17 18H3", alignC: "M18 10H6 M21 6H3 M21 14H3 M18 18H6", alignR: "M21 10H7 M21 6H3 M21 14H3 M21 18H7", alignJ: "M21 6H3 M21 10H3 M21 14H3 M21 18H3",
  image: "M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M21 15l-5-5L5 21",
  table: "M3 3h18v18H3z M3 9h18 M3 15h18 M9 3v18 M15 3v18", chart: "M3 3v18h18 M7 14v4 M12 9v9 M17 5v13",
  link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  brush: "M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7 M14.5 17.5 4.5 15",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3 12h18 M12 3c2.5 2.7 3.8 5.7 3.8 9S14.5 18.3 12 21c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z",
  panel: "M3 3h18v18H3z M3 9h18", plus: "M12 5v14 M5 12h14", trash: "M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6 M10 11v6 M14 11v6",
  clip: "M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48",
  txt: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5", clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2",
  merge: "M8 6H4v12h4 M16 6h4v12h-4 M9 12h6 M12 9l3 3-3 3", rotate: "M21 12a9 9 0 1 1-3-6.7 M21 4v5h-5",
  flipH: "M12 3v18 M16 7l5 5-5 5V7z M8 7l-5 5 5 5V7z", flipV: "M3 12h18 M7 8l5-5 5 5H7z M7 16l5 5 5-5H7z",
  lock: "M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z M7 11V7a5 5 0 0 1 10 0v4", unlock: "M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z M7 11V7a5 5 0 0 1 9.9-1",
  check: "M20 6L9 17l-5-5", x: "M18 6L6 18 M6 6l12 12", chevron: "M6 9l6 6 6-6", sample: "M12 3l1.9 5.8H20l-4.9 3.6 1.9 5.8-5-3.6-5 3.6 1.9-5.8L4 8.8h6.1z",
  arrowUp: "M12 19V5 M5 12l7-7 7 7", arrowDown: "M12 5v14 M19 12l-7 7-7-7", replace: "M17 1l4 4-4 4 M3 11V9a4 4 0 0 1 4-4h14 M7 23l-4-4 4-4 M21 13v2a4 4 0 0 1-4 4H3",
  play: "M5 3l14 9-14 9z", textbox: "M4 7V4h16v3 M9 20h6 M12 4v16", shape: "M12 3l9 16H3z", line: "M5 19L19 5", arrow: "M5 19L19 5 M10 5h9v9",
  front: "M8 8h12v12H8z M4 4h12v4", back: "M4 4h12v12H4z M8 20h12V8", group: "M3 3h8v8H3z M13 13h8v8h-8z", slides: "M3 5h18v11H3z M8 21h8 M12 16v5",
  copy: "M9 9h11v11H9z M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1", paste: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2 M9 2h6v4H9z",
  fill: "M19 11l-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2a2 2 0 0 0 2.8 0L19 11z M5 2l5 5 M21 15s2 2.3 2 4a2 2 0 0 1-4 0c0-1.7 2-4 2-4z",
  stroke: "M4 20l4-1L20 7l-3-3L5 16z", shadow: "M5 5h12v12H5z M9 19h10V9",
  ruler: "M3 17L17 3l4 4L7 21z M7 13l2 2 M10 10l2 2 M13 7l2 2", measure: "M2 12h20 M2 8v8 M22 8v8 M7 10v4 M12 9v6 M17 10v4",
  object: "M4 4h10l6 6v10H4z M14 4v6h6 M8 14h8 M8 17h5",
};
const Ic = (p: { n: string; size?: number }) => (
  <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d={ICONS[p.n] ?? ""} /></svg>
);

type Tab = "home" | "insert" | "format" | "table" | "chart" | "picture" | "slide" | "view";
type Panel = "find" | "info" | "log" | "ole" | "history" | null;
type MenuId = "export" | "layout" | "shapes" | "table" | "chart" | "align" | "lang" | "ctx-shape" | "ctx-slide" | "ctx-thumb";
type SlideLog = { level: "info" | "warn" | "error"; key: string; params?: Record<string, string | number>; time: number };

const FONTS = ["Calibri", "Arial", "Segoe UI", "Times New Roman", "Georgia", "Verdana", "Tahoma", "Courier New", "Consolas", "Trebuchet MS", "Cambria", "Garamond", "Comic Sans MS"];
const SIZES = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 60, 72, 96];
const SHAPES: string[] = ["rect", "roundRect", "ellipse", "triangle", "rtTriangle", "diamond", "parallelogram", "trapezoid", "pentagon", "hexagon", "octagon", "star5", "star6", "rightArrow", "leftArrow", "upArrow", "downArrow", "chevron", "plus", "heart", "cloud", "lightningBolt", "moon", "sun", "donut", "can", "cube", "leftBracket", "rightBrace"];
const CHARTS: P.ChartKind[] = ["column", "bar", "line", "area", "pie", "doughnut", "scatter", "radar"];
const TRANSITIONS = ["fade", "push", "wipe", "cover", "pull", "split", "zoom", "dissolve", "blinds", "checker", "circle", "diamond", "plus", "wedge", "wheel", "random"] as const;
const DASHES: P.LineDash[] = ["solid", "dash", "dot", "dashDot", "lgDash", "sysDash"];
const cm = (emu: number) => Math.round((emu / 360000) * 100) / 100;

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const baseName = (n: string) => n.replace(/\.[^.]+$/, "");

export default function PptxEditor(props: PptxEditorProps) {
  let rootEl!: HTMLDivElement;
  let hostEl!: HTMLDivElement;
  let thumbsEl!: HTMLDivElement;
  let fileInput!: HTMLInputElement;
  let imgInput!: HTMLInputElement;
  let replInput!: HTMLInputElement;
  let bgInput!: HTMLInputElement;
  let findInput: HTMLInputElement | undefined;
  let view: PptxView | undefined;
  let frameEl!: HTMLDivElement;
  let oleInput!: HTMLInputElement;
  let oleUpdInput!: HTMLInputElement;
  let oleTarget: string | null = null;
  let ruler: RulerKit | undefined;
  let api: PptxEditorApi | undefined;
  let loadSource: PptxEditorEventMap["load"]["source"] = "api";
  const ownBus = !props.bus;
  const bus: EditorEventBus<PptxEditorEventMap> = props.bus ?? createEventBus<PptxEditorEventMap>({ source: "pptx-editor", domPrefix: "pptx-editor" });
  const emit = <K extends keyof PptxEditorEventMap>(type: K, payload: PptxEditorEventMap[K]) => {
    bus.emit(type, payload);
    if (api) { try { props.onEvent?.(type, payload, api); } catch (e) { console.error("[pptx-editor] onEvent", e); } }
  };
  const [rulerOn, setRulerOn] = createSignal(!!props.ruler);
  const [rulerUnit, setRulerUnit] = createSignal<RulerUnit>(props.rulerUnit ?? "cm");
  const [measuring, setMeasuring] = createSignal(false);
  const [guideCount, setGuideCount] = createSignal(0);
  const [measureText, setMeasureText] = createSignal("");

  const detect = (): Lang => (typeof navigator !== "undefined" && /^id\b|^in\b/i.test(navigator.language) ? "id" : "en");
  const [lang, setLangSig] = createSignal<Lang>(props.locale ?? detect());
  const { t } = createI18n(lang);
  const setLang = (l: Lang) => { setLangSig(l); props.onLocaleChange?.(l); emit("locale", { locale: l }); };
  createEffect(() => { if (props.locale) setLangSig(props.locale); });

  const [deck, setDeck] = createSignal<PptxDeck | undefined>(undefined);
  const [ver, setVer] = createSignal(0);
  const [logVer, setLogVer] = createSignal(0);
  const [busy, setBusy] = createSignal<string | null>("busy.loading");
  const [loadErr, setLoadErr] = createSignal<{ msg: string; code: string; info?: CfbInfo; bytes?: Uint8Array; name: string } | null>(null);
  const [sel, setSel] = createSignal<PxSelInfo | null>(null);
  const [panel, setPanel] = createSignal<Panel>(null);
  const [tab, setTab] = createSignal<Tab>("home");
  const [tbHidden, setTbHidden] = createSignal(!!props.toolbarHidden);
  const [fs, setFs] = createSignal(false);
  const [cssFs, setCssFs] = createSignal(false);
  const [zoom, setZoomSig] = createSignal(1);
  const [fit, setFit] = createSignal(true);
  const [grid, setGrid] = createSignal(false);
  const [snapOn, setSnapOn] = createSignal(true);
  const [lockAspect, setLockAspect] = createSignal(true);
  const [notesOpen, setNotesOpen] = createSignal(true);
  const [thumbsOpen, setThumbsOpen] = createSignal(true);
  const [dark, setDark] = createSignal(false);
  const [painter, setPainter] = createSignal<{ items: [string, string][] } | null>(null);
  const [tool, setTool] = createSignal<Tool>(null);
  const [toastMsg, setToastMsg] = createSignal<string | null>(null);
  const [menu, setMenu] = createSignal<{ id: MenuId; x: number; y: number; idx?: number } | null>(null);
  const [dialog, setDialog] = createSignal<"debug" | "link" | null>(null);
  const [dragOver, setDragOver] = createSignal(false);
  const [histMax, setHistMax] = createSignal(props.maxHistory ?? 100);
  const [dbg, setDbg] = createSignal("");
  const [linkUrl, setLinkUrl] = createSignal("");
  const [logFilter, setLogFilter] = createSignal<"all" | "info" | "warn" | "error">("all");
  const [notes, setNotes] = createSignal("");
  const [propsDraft, setPropsDraft] = createSignal<Record<string, string>>({});
  const [oleSel, setOleSel] = createSignal<string | null>(null);
  const [oleInfo, setOleInfo] = createSignal<{ cfb?: CfbInfo; stream?: string; dump?: string; vba?: VbaInfo; vbaMod?: number } | null>(null);
  const [slideIdx, setSlideIdx] = createSignal(0);
  const [slideCount, setSlideCount] = createSignal(0);
    // pencarian
  const [fq, setFq] = createSignal("");
  const [fRepl, setFRepl] = createSignal("");
  const [fCase, setFCase] = createSignal(false);
  const [fWord, setFWord] = createSignal(false);
  const [fRegex, setFRegex] = createSignal(false);
  const [fRes, setFRes] = createSignal<{ hits: FindHit[]; error?: string } | null>(null);
  const [fCur, setFCur] = createSignal(-1);
  const [fLimit, setFLimit] = createSignal(200);

  const ro = () => !!props.readonly;
  let toastTimer = 0;
  const toast = (key: string, params?: Record<string, string | number>) => {
    setToastMsg(t(key, params));
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => setToastMsg(null), 2600);
  };
  const bump = () => setVer(v => v + 1);
  const modified = () => { ver(); return !!deck()?.modified; };
  const canUndo = () => { ver(); return !!deck()?.canUndo; };
  const canRedo = () => { ver(); return !!deck()?.canRedo; };

  // ───────── miniatur ─────────

  let thumbJob = 0;
  const thumbItem = (i: number): HTMLElement | null => thumbsEl?.children[i] as HTMLElement | null;
  const fillThumb = (i: number) => {
    const d = deck(), item = thumbItem(i);
    const slide = d?.slides[i];
    if (!d || !view || !item || !slide) return;
    const holder = item.querySelector<HTMLElement>(".pxe-th-img")!;
    holder.textContent = "";
    try { holder.appendChild(view.renderThumb(slide, 168)); } catch { holder.textContent = "!"; }
    item.classList.toggle("hid", P.isSlideHidden(slide));
  };
  const markActive = () => {
    const i = view?.slideIdx ?? 0;
    [...(thumbsEl?.children ?? [])].forEach((c, k) => c.classList.toggle("on", k === i));
    thumbItem(i)?.scrollIntoView({ block: "nearest" });
  };
  const rebuildThumbs = (which: number[] | "all") => {
    const d = deck();
    if (!d || !thumbsEl || !view) return;
    const n = d.slides.length;
    setSlideCount(n);
    if (which === "all" || thumbsEl.children.length !== n) {
      const job = ++thumbJob;
      thumbsEl.textContent = "";
      for (let i = 0; i < n; i++) {
        const it = document.createElement("div");
        it.className = "pxe-th"; it.draggable = !ro(); it.dataset.i = String(i);
        it.innerHTML = `<span class="no">${i + 1}</span><div class="pxe-th-img"></div><span class="hid-badge">⊘</span>`;
        thumbsEl.appendChild(it);
      }
      let k = 0;
      const step = () => { if (job !== thumbJob) return; const end = Math.min(n, k + 6); for (; k < end; k++) fillThumb(k); if (k < n) setTimeout(step, 8); };
      step();
      markActive();
    } else for (const i of which) fillThumb(i);
    markActive();
  };

  // ───────── memuat ─────────

  const refreshProps = (d: PptxDeck) => {
    const c = (P.getCoreProperties(d.pres) ?? {}) as P.CoreProperties;
    setPropsDraft({ title: c.title ?? "", creator: c.creator ?? "", subject: c.subject ?? "", keywords: c.keywords ?? "", description: c.description ?? "", category: c.category ?? "" });
  };
  const syncNotes = () => { const s = view?.slide; setNotes(s ? (P.getSlideNotes(s) ?? "") : ""); };
  const prompts = () => ({ title: t("prompt.title"), ctrTitle: t("prompt.title"), subTitle: t("prompt.subtitle"), body: t("prompt.body"), default: t("prompt.default") });

  const attach = (d: PptxDeck) => {
    d.setMaxHistory(histMax());
    batch(() => { setDeck(d); setLoadErr(null); setSel(null); setFRes(null); setFCur(-1); setOleSel(null); setOleInfo(null); setBusy(null); bump(); setLogVer(v => v + 1); });
    view!.prompts = prompts();
    view!.load(d);
    setSlideIdx(0);
    rebuildThumbs("all");
    refreshProps(d);
    syncNotes();
    if (fq()) runSearch();
    ruler?.clearGuides();
    ruler?.refresh();
    emit("load", { fileName: d.fileName, size: d.originalBytes.length, source: loadSource });
    loadSource = "api";
  };
  const loadBytes = async (bytes: Uint8Array, name: string) => {
    setBusy("busy.opening");
    try { attach(await PptxDeck.open(bytes, name)); }
    catch (e) {
      let info: CfbInfo | undefined;
      if (e instanceof PptxLoadError && e.bytes && e.bytes.length > 8 && (e.code === "legacy-ppt" || e.code === "encrypted")) { try { info = readCfb(e.bytes); } catch { /* abaikan */ } }
      setLoadErr({ msg: e instanceof Error ? e.message : String(e), code: e instanceof PptxLoadError ? e.code : "parse", info, bytes: e instanceof PptxLoadError ? e.bytes : undefined, name });
      setBusy(null);
      emit("load-error", { message: e instanceof Error ? e.message : String(e), code: e instanceof PptxLoadError ? e.code : "parse", fileName: name });
    }
  };
  const confirmDiscard = () => !(deck()?.modified && !ro()) || window.confirm(t("confirm.discard"));
  const openFile = async (f: File | undefined | null) => { if (!f || !confirmDiscard()) return; loadSource = "file"; await loadBytes(new Uint8Array(await f.arrayBuffer()), f.name); };
  const openSample = async () => {
    if (!confirmDiscard()) return;
    setBusy("busy.sample");
    loadSource = "sample";
    try { attach(await createSampleDeck(lang())); } catch (e) { setLoadErr({ msg: e instanceof Error ? e.message : String(e), code: "parse", name: "sample" }); setBusy(null); }
  };
  const newBlank = async () => {
    if (!confirmDiscard()) return;
    const pres = P.createPresentation({ size: "16:9" });
    const s = P.addBlankSlide(pres);
    void s;
    loadSource = "new";
    attach(await PptxDeck.fromPresentation(pres, lang() === "id" ? "presentasi-baru.pptx" : "new-presentation.pptx"));
  };

  // ───────── unduh ─────────

  const savePptx = async () => {
    const d = deck();
    if (!d || ro()) return;
    view?.commitEdit();
    try {
      const out = /\.(pptx|pptm)$/i.test(d.fileName) ? d.fileName : baseName(d.fileName) + ".pptx";
      const blob = await d.toBlob();
      downloadBlob(out, blob);
      d.markSaved(); bump();
      toast("toast.saved", { name: out });
      emit("save", { fileName: out, size: blob.size });
    } catch (e) { d.addLog("error", "log.saveFail", { msg: e instanceof Error ? e.message : String(e) }); setLogVer(v => v + 1); toast("toast.saveFail"); emit("error", { scope: "save", error: e }); }
  };
  const saveSource = () => { const d = deck(); if (d) { downloadBlob(d.fileName, new Blob([d.originalBytes as BlobPart])); emit("export", { format: "source", fileName: d.fileName, size: d.originalBytes.length }); } };
  const outlineText = () => {
    const d = deck();
    if (!d) return "";
    return d.slides.map((s, i) => { return `# ${i + 1}. ${P.getSlideTitle(s) ?? ""}\n${P.getSlideText(s)}${P.getSlideNotes(s) ? `\n[${t("notes.label")}] ${P.getSlideNotes(s)}` : ""}`; }).join("\n\n");
  };
  const saveTxt = () => { const d = deck(); if (d) { const s = outlineText(); downloadBlob(baseName(d.fileName) + ".txt", new Blob([s], { type: "text/plain;charset=utf-8" })); emit("export", { format: "txt", fileName: baseName(d.fileName) + ".txt", size: s.length }); } };

  // ───────── hook ke view ─────────

  const hooks = () => ({
    committed: () => bump(),
    changed: (label: string) => {
      bump();
      const info = { label, modified: !!deck()?.modified };
      props.onChange?.(info);
      emit("change", info);
      ruler?.refresh();
      if (panel() === "find" && fq()) scheduleSearch();
    },
    selection: (s: PxSelInfo) => { setSel(s); if (s.slideIndex !== slideIdx()) setSlideIdx(s.slideIndex); emit("selection", { info: s }); },
    slide: (i: number) => { setSlideIdx(i); queueMicrotask(() => { markActive(); syncNotes(); ruler?.refresh(); }); emit("slide", { index: i, count: deck()?.slides.length ?? 0 }); },
    ole: (slideIndex: number, shapeId: number, progId: string) => {
      setPanel("ole");
      const list = oleItems(); const i = list.findIndex(o => o.slideIndex === slideIndex && o.shapeId === shapeId);
      if (i >= 0) setOleItem(slideIndex + ":" + shapeId);
      emit("ole:open", { id: slideIndex + ":" + shapeId, progId });
    },
    thumbs: (w: number[] | "all") => rebuildThumbs(w),
    toast,
    log: (level: "info" | "warn" | "error", key: string, params?: Record<string, string | number>) => { deck()?.addLog(level, key, params); setLogVer(v => v + 1); },
    context: (x: number, y: number, kind: "shape" | "slide") => setMenu({ id: kind === "shape" ? "ctx-shape" : "ctx-slide", x, y }),
    painter: (p: { items: [string, string][] } | null) => setPainter(p),
    tool: (tl: Tool) => { setTool(tl); emit("tool", { tool: tl }); },
    openFile: (f: File) => { void openFile(f); },
  });

  // ───────── OLE: sisip & perbarui (API + UI) ─────────

  const oleItems = createMemo<PptxOle[]>(() => { ver(); const d = deck(); return d ? listPptxOle(d.pres) : []; });
  const [oleItem, setOleItem] = createSignal<string | null>(null);
  const oleKey = (o: PptxOle) => o.slideIndex + ":" + o.shapeId;
  const parseOleId = (id: string): { slide: number; shape: number } => {
    const m = /^(\d+):(\d+)$/.exec(id);
    if (!m) throw new Error('Id objek OLE tidak valid: "' + id + '" (format "slide:shapeId", mis. "0:12").');
    return { slide: Number(m[1]), shape: Number(m[2]) };
  };
  const oleLog = (level: "info" | "warn" | "error", key: string, params?: Record<string, string | number>) => { deck()?.addLog(level, key, params); setLogVer(v => v + 1); };
  const oleFail = (action: "insert" | "update" | "resize", e: unknown, fileName?: string) => {
    const msg = e instanceof Error ? e.message : String(e);
    oleLog("error", "log.oleActionFail", { action, name: fileName ?? "", msg });
    toast("toast.oleFail", { msg });
    emit("ole:error", { action, message: msg, fileName });
    emit("error", { scope: "ole", error: e });
  };
  const oleInsert: PptxEditorApi["ole"]["insert"] = async (input, opts) => {
    let name = "";
    try {
      if (!deck() || !view) throw new Error("Tidak ada presentasi yang terbuka.");
      if (ro()) throw new Error("Mode baca-saja: objek OLE tidak dapat disisipkan.");
      const f = await readFileInput(input); name = f.name;
      const prep = await prepareOle(f.name, f.bytes, opts);
      if (opts?.slide !== undefined) view.goTo(opts.slide);
      const r = await view.insertOle(prep, opts?.at ?? (opts?.size ? { w: opts.size.wPx * 9525, h: opts.size.hPx * 9525 } : undefined));
      if (!r) throw new Error("Tidak ada slide untuk menyisipkan objek.");
      bump();
      oleLog("info", "log.oleInserted", { name: f.name, kind: prep.kind, progId: prep.progId, size: prep.bytes.length });
      toast("toast.oleInserted", { name: f.name });
      const info = oleEventInfo(r.slideIndex + ":" + r.shapeId, r.part, prep, "slide " + (r.slideIndex + 1));
      emit("ole:inserted", info);
      return info;
    } catch (e) { oleFail("insert", e, name); return undefined; }
  };
  const oleUpdate: PptxEditorApi["ole"]["update"] = async (id, input, opts) => {
    let name = "";
    try {
      if (!deck() || !view) throw new Error("Tidak ada presentasi yang terbuka.");
      if (ro()) throw new Error("Mode baca-saja: objek OLE tidak dapat diperbarui.");
      const { slide, shape } = parseOleId(id);
      const f = await readFileInput(input); name = f.name;
      const prep = await prepareOle(f.name, f.bytes, opts);
      const r = await view.updateOle(slide, shape, prep);
      if (!r) throw new Error('Objek OLE "' + id + '" tidak ditemukan.');
      bump();
      oleLog("info", "log.oleUpdated", { name: f.name, kind: prep.kind, progId: prep.progId, size: prep.bytes.length });
      toast("toast.oleUpdated", { name: f.name });
      const info = { ...oleEventInfo(slide + ":" + shape, r.part, prep, "slide " + (slide + 1)), previousId: id };
      emit("ole:updated", info);
      return info;
    } catch (e) { oleFail("update", e, name); return undefined; }
  };
  const oleResize: PptxEditorApi["ole"]["resize"] = async (id, wPx, hPx) => {
    try {
      const d = deck();
      if (!d || !view || ro()) throw new Error("Tidak dapat mengubah ukuran (tanpa presentasi atau baca-saja).");
      const { slide, shape } = parseOleId(id);
      if (!(await view.resizeOle(slide, shape, wPx, hPx))) throw new Error('Objek OLE "' + id + '" tidak ditemukan atau ukuran tidak valid.');
      bump();
      emit("ole:updated", { id, part: "", progId: "", fileName: "", size: 0, kind: "package", previousId: id });
      return true;
    } catch (e) { oleFail("resize", e); return false; }
  };
  const oleInsertUi = async (f: File) => {
    const info = await oleInsert(f);
    if (!info) return;
    setPanel("ole");
    setOleItem(info.id);
  };
  const oleUpdateUi = async (f: File) => {
    if (!oleTarget) return;
    const info = await oleUpdate(oleTarget, f);
    oleTarget = null;
    if (info) setOleItem(info.id);
  };

  // ───────── penggaris ─────────

  const rulerGeometry = () => {
    const body = frameEl.querySelector<HTMLElement>(":scope > .rk-body");
    const box = view?.slideBox();
    const s = view?.zoom ?? 1;
    if (!body || !box) return { originX: 0, originY: 0, scale: s, zeroX: 0, zeroY: 0 };
    const br = body.getBoundingClientRect();
    return { originX: box.rect.left - br.left, originY: box.rect.top - br.top, scale: s, zeroX: 0, zeroY: 0 };
  };
  const onRulerEvent = <K extends keyof RulerEventMap>(type: K, payload: RulerEventMap[K]) => {
    if (type === "ruler:visible") setRulerOn((payload as RulerEventMap["ruler:visible"]).visible);
    else if (type === "ruler:unit") setRulerUnit((payload as RulerEventMap["ruler:unit"]).unit);
    else if (type === "ruler:measure-mode") { setMeasuring((payload as RulerEventMap["ruler:measure-mode"]).active); if (!(payload as RulerEventMap["ruler:measure-mode"]).active) setMeasureText(""); }
    else if (type === "ruler:measure") setMeasureText((payload as RulerEventMap["ruler:measure"]).text);
    if (type === "ruler:guide-add" || type === "ruler:guide-remove") setGuideCount(ruler?.getGuides().length ?? 0);
    emit(type, payload as never);
  };

  const buildApi = (): PptxEditorApi => ({
    events: bus, on: bus.on, off: bus.off, once: bus.once, run: (name, ...args) => bus.run(name, ...args),
    getDeck: () => deck(), getView: () => view,
    load: async (input, name) => {
      const f = typeof File !== "undefined" && input instanceof File ? input : undefined;
      const bytes = f ? new Uint8Array(await f.arrayBuffer()) : input instanceof Uint8Array ? input : new Uint8Array(input as ArrayBuffer);
      loadSource = "api";
      await loadBytes(bytes, name ?? f?.name ?? "presentation.pptx");
    },
    getBytes: async () => { view?.commitEdit(); return deck()?.toBytes(); },
    getText: () => outlineText(),
    undo: async () => { await restore(() => deck()!.undo()); emit("history", { action: "undo" }); },
    redo: async () => { await restore(() => deck()!.redo()); emit("history", { action: "redo" }); },
    goTo: i => view?.goTo(i), getSlideCount: () => deck()?.slides.length ?? 0,
    setZoom: z => setZoom(z), getZoom: () => zoom(),
    ruler: ruler!,
    ole: {
      list: () => oleItems(), insert: oleInsert, update: oleUpdate, resize: oleResize,
      getBytes: id => { const d = deck(); if (!d) return undefined; try { const { slide, shape } = parseOleId(id); return pptxOleBytes(d.pres, slide, shape)?.data; } catch { return undefined; } },
    },
  });

  const registerCommands = () => {
    const a = api!;
    const cmds: Record<string, (...x: any[]) => unknown> = {
      undo: () => a.undo(), redo: () => a.redo(), goTo: (i: number) => a.goTo(i), getSlideCount: () => a.getSlideCount(), setZoom: (z: number) => a.setZoom(z), getZoom: () => a.getZoom(),
      load: (i: Uint8Array | ArrayBuffer | File, n?: string) => a.load(i, n), getBytes: () => a.getBytes(), getText: () => a.getText(),
      save: () => savePptx(), setPanel: (p: Panel) => setPanel(p), setLocale: (l: Lang) => setLang(l),
      "ole.list": () => a.ole.list(), "ole.insert": (f: FileInput, o?: object) => a.ole.insert(f, o),
      "ole.update": (id: string, f: FileInput, o?: OleInsertOptions) => a.ole.update(id, f, o),
      "ole.getBytes": (id: string) => a.ole.getBytes(id), "ole.resize": (id: string, w: number, h: number) => a.ole.resize(id, w, h),
      "ruler.show": () => a.ruler.setVisible(true), "ruler.hide": () => a.ruler.setVisible(false), "ruler.toggle": () => a.ruler.toggle(),
      "ruler.setUnit": (u: RulerUnit) => a.ruler.setUnit(u), "ruler.addGuide": (axis: "x" | "y", pos: number) => a.ruler.addGuide(axis, pos),
      "ruler.removeGuide": (id: string) => a.ruler.removeGuide(id), "ruler.clearGuides": () => a.ruler.clearGuides(), "ruler.getGuides": () => a.ruler.getGuides(),
      "ruler.measure": (x1: number, y1: number, x2: number, y2: number) => a.ruler.measure(x1, y1, x2, y2), "ruler.setMeasureMode": (on: boolean) => a.ruler.setMeasureMode(on),
    };
    for (const [n, fn] of Object.entries(cmds)) onCleanup(bus.registerCommand(n, fn));
  };

  onMount(async () => {
    view = new PptxView(hostEl, hooks());
    view.readonly = ro();
    ruler = new RulerKit({
      frame: frameEl, unit: rulerUnit(), visible: rulerOn(), scrollEl: hostEl, getGeometry: rulerGeometry, emit: onRulerEvent,
      labels: { corner: t("ruler.corner"), removeGuide: t("ruler.removeGuide") },
    });
    // garis bantu penggaris ikut menjadi target snapping saat memindah / mengubah ukuran bentuk
    view.guideSource = () => (ruler?.isVisible() ? { x: ruler.guidePositions("x"), y: ruler.guidePositions("y") } : { x: [], y: [] });
    onCleanup(() => ruler?.destroy());
    api = buildApi();
    registerCommands();
    onCleanup(bus.attach(rootEl));
    // gagang debug (dipakai uji E2E / konsol): rootEl.__px = { view, deck }
    (rootEl as unknown as { __px: unknown }).__px = { view, deck, api };
    emit("ready", { api });
    props.onReady?.(api);
    onCleanup(() => { emit("destroy", {}); if (ownBus) bus.clear(); });
    const onFs = () => setFs(document.fullscreenElement === rootEl || cssFs());
    document.addEventListener("fullscreenchange", onFs);
    const onDocDown = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest?.(".pxe-menu,[data-menu]")) setMenu(null); };
    document.addEventListener("mousedown", onDocDown);
    onCleanup(() => { document.removeEventListener("fullscreenchange", onFs); document.removeEventListener("mousedown", onDocDown); view?.dispose(); clearTimeout(toastTimer); clearTimeout(searchTimer); thumbJob++; stopPresent(); });
    try {
      if (props.data) await loadBytes(props.data instanceof Uint8Array ? props.data : new Uint8Array(props.data), props.fileName ?? "presentation.pptx");
      else if (props.src) {
        const res = await fetch(props.src);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await loadBytes(new Uint8Array(await res.arrayBuffer()), props.fileName ?? decodeURIComponent(props.src.split("/").pop() || "presentation.pptx"));
      } else if (props.sample !== false) await openSample();
      else setBusy(null);
    } catch (e) { setLoadErr({ msg: e instanceof Error ? e.message : String(e), code: "fetch", name: props.src ?? "" }); setBusy(null); }

    // miniatur: klik / seret-urut / konteks
    thumbsEl.addEventListener("click", e => { const it = (e.target as HTMLElement).closest<HTMLElement>(".pxe-th"); if (it) view?.goTo(+it.dataset.i!); });
    thumbsEl.addEventListener("contextmenu", e => { const it = (e.target as HTMLElement).closest<HTMLElement>(".pxe-th"); if (!it) return; e.preventDefault(); view?.goTo(+it.dataset.i!); setMenu({ id: "ctx-thumb", x: e.clientX, y: e.clientY, idx: +it.dataset.i! }); });
    let dragFrom = -1;
    thumbsEl.addEventListener("dragstart", e => { const it = (e.target as HTMLElement).closest<HTMLElement>(".pxe-th"); if (!it) return; dragFrom = +it.dataset.i!; e.dataTransfer?.setData("text/x-slide", String(dragFrom)); });
    thumbsEl.addEventListener("dragover", e => { if (dragFrom < 0) return; e.preventDefault(); const it = (e.target as HTMLElement).closest<HTMLElement>(".pxe-th"); thumbsEl.querySelectorAll(".drop").forEach(x => x.classList.remove("drop")); it?.classList.add("drop"); });
    thumbsEl.addEventListener("drop", e => { if (dragFrom < 0) return; e.preventDefault(); e.stopPropagation(); const it = (e.target as HTMLElement).closest<HTMLElement>(".pxe-th"); thumbsEl.querySelectorAll(".drop").forEach(x => x.classList.remove("drop")); if (it) { const to = +it.dataset.i!; view?.moveSlide(dragFrom, to); } dragFrom = -1; });
    thumbsEl.addEventListener("dragend", () => { dragFrom = -1; thumbsEl.querySelectorAll(".drop").forEach(x => x.classList.remove("drop")); });
  });

  createEffect(on(ro, v => { if (view) { view.readonly = v; view.updateOverlay(); rebuildThumbs("all"); } }, { defer: true }));
  createEffect(on(grid, v => view?.setGrid(v), { defer: true }));
  createEffect(on(snapOn, v => { if (view) view.snapOn = v; }, { defer: true }));
  createEffect(on(lockAspect, v => { if (view) view.lockAspect = v; }, { defer: true }));
  createEffect(on(lang, () => { if (view) { view.prompts = prompts(); view.render(); } }, { defer: true }));
  createEffect(on(histMax, v => { const d = deck(); if (d) { d.setMaxHistory(v); bump(); } }, { defer: true }));
  createEffect(on(zoom, z => { ruler?.refresh(); emit("zoom", { zoom: z }); }, { defer: true }));
  createEffect(on(panel, p => emit("panel", { panel: p }), { defer: true }));
  createEffect(on(ro, v => emit("readonly", { readonly: v }), { defer: true }));
  createEffect(on(() => props.ruler, v => { if (v !== undefined) ruler?.setVisible(!!v); }, { defer: true }));
  createEffect(on(() => props.rulerUnit, v => { if (v) ruler?.setUnit(v); }, { defer: true }));
  createEffect(on(dark, () => ruler?.refresh(), { defer: true }));

  const setZoom = (z: number) => { view?.setZoom(z); setFit(false); setZoomSig(view?.zoom ?? z); };
  const fitZoom = () => { view?.fitNow(); setFit(true); setZoomSig(view?.zoom ?? 1); };
  createEffect(() => { if (fit() && deck()) queueMicrotask(() => setZoomSig(view?.zoom ?? 1)); });
  const toggleFs = async () => {
    if (fs()) { if (document.fullscreenElement) await document.exitFullscreen().catch(() => {}); setCssFs(false); setFs(false); return; }
    try { await rootEl.requestFullscreen(); setFs(true); } catch { setCssFs(true); setFs(true); }
  };

  // ───────── undo/redo ─────────

  const restore = async (fn: () => Promise<boolean>) => {
    const d = deck();
    if (!d || !view || ro()) return;
    view.commitEdit();
    const ids = view.selectedIds(), idx = view.slideIdx;
    if (await fn()) { view.afterRestore(ids, idx); setSlideIdx(view.slideIdx); bump(); syncNotes(); markActive(); refreshProps(d); if (panel() === "find" && fq()) runSearch(); }
  };
  const undo = () => { const d = deck(); if (d) void restore(() => d.undo()).then(() => emit("history", { action: "undo" })); };
  const redo = () => { const d = deck(); if (d) void restore(() => d.redo()).then(() => emit("history", { action: "redo" })); };
  const jump = (i: number) => { const d = deck(); if (d) void restore(() => d.restore(i)); };

  // ───────── pencarian ─────────

  let searchTimer = 0;
  const searchOpts = () => ({ query: fq(), regex: fRegex(), caseSensitive: fCase(), wholeWord: fWord() });
  const runSearch = () => {
    if (!view || !deck()) return;
    if (!fq()) { view.clearSearch(); setFRes(null); setFCur(-1); return; }
    const r = view.search(searchOpts());
    setFRes(r); setFCur(-1); setFLimit(200);
    emit("find", { query: fq(), count: r.hits.length });
  };
  const scheduleSearch = () => { clearTimeout(searchTimer); searchTimer = window.setTimeout(runSearch, 160); };
  const step = (d: 1 | -1) => { const r = fRes(); if (!r?.hits.length) return; const n = (fCur() + d + r.hits.length) % r.hits.length; setFCur(n); view?.gotoHit(n); };
  const openFind = () => { setPanel("find"); queueMicrotask(() => { findInput?.focus(); findInput?.select(); }); };
  const replaceCur = () => { const r = fRes(); const i = fCur() >= 0 ? fCur() : 0; if (!r?.hits[i] || ro()) return; const n = view!.replaceHits([r.hits[i]], searchOpts(), fRepl()); if (n) toast("toast.replaced", { n }); runSearch(); };
  const replaceAll = () => { const r = fRes(); if (!r?.hits.length || ro()) return; const n = view!.replaceHits(r.hits, searchOpts(), fRepl()); toast("toast.replaced", { n }); runSearch(); };

  // ───────── slideshow ─────────

  let presentEl: HTMLElement | null = null;
  let presentKey: ((e: KeyboardEvent) => void) | null = null;
  function stopPresent() {
    presentEl?.remove(); presentEl = null;
    if (presentKey) { document.removeEventListener("keydown", presentKey, true); presentKey = null; }
    if (document.fullscreenElement && document.fullscreenElement !== rootEl) void document.exitFullscreen().catch(() => {});
  }
  const startPresent = () => {
    const d = deck();
    if (!d || !view) return;
    view.commitEdit();
    const visible = d.slides.map((s, i) => (P.isSlideHidden(s) ? -1 : i)).filter(i => i >= 0);
    if (!visible.length) return;
    let pos = Math.max(0, visible.findIndex(i => i >= view!.slideIdx));
    const el = document.createElement("div");
    el.className = "pxe-present";
    rootEl.appendChild(el);
    presentEl = el;
    const draw = () => {
      el.textContent = "";
      const size = P.getSlideSize(d.pres)!;
      const ar = size.width / size.height;
      const w = Math.min(el.clientWidth, el.clientHeight * ar);
      const box = view!.renderThumb(d.slides[visible[pos]], Math.floor(w));
      box.classList.add("pxe-pslide");
      const tr = P.getSlideTransition(d.slides[visible[pos]]);
      if (tr && tr.effect !== "none") box.classList.add("fx");
      el.appendChild(box);
      const hud = document.createElement("div");
      hud.className = "pxe-phud"; hud.textContent = `${pos + 1} / ${visible.length}`;
      el.appendChild(hud);
    };
    const go = (n: number) => { if (n < 0) return; if (n >= visible.length) { stopPresent(); return; } pos = n; draw(); };
    presentKey = e => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); stopPresent(); }
      else if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) { e.preventDefault(); e.stopPropagation(); go(pos + 1); }
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); e.stopPropagation(); go(pos - 1); }
      else if (e.key === "Home") { e.preventDefault(); go(0); }
      else if (e.key === "End") { e.preventDefault(); go(visible.length - 1); }
    };
    document.addEventListener("keydown", presentKey, true);
    el.addEventListener("click", e => { go(e.clientX < el.clientWidth * 0.25 ? pos - 1 : pos + 1); });
    el.addEventListener("contextmenu", e => { e.preventDefault(); stopPresent(); });
    void el.requestFullscreen?.().catch(() => {});
    requestAnimationFrame(draw);
    new ResizeObserver(draw).observe(el);
  };

  // ───────── OLE / makro ─────────

  const oleParts = createMemo(() => {
    ver();
    const d = deck();
    if (!d) return [] as { name: string; size: number; type: string }[];
    return P.listPackageParts(d.pres).filter(p => /^\/ppt\/embeddings\//.test(p.name) || /vbaProject\.bin$/i.test(p.name) || /^\/ppt\/(ole|activeX)/i.test(p.name)).map(p => ({ name: p.name, size: p.byteLength, type: p.contentType }));
  });
  const vbaName = () => oleParts().find(p => /vbaProject\.bin$/i.test(p.name))?.name;
  const selectOle = (name: string) => {
    setOleSel(name);
    const d = deck(); const data = d ? P.readPackagePart(d.pres, name) : null;
    if (!data) { setOleInfo({}); return; }
    try { setOleInfo(isCfb(data) ? { cfb: readCfb(data) } : {}); } catch (e) { setOleInfo({}); d?.addLog("error", "log.oleFail", { part: name, msg: e instanceof Error ? e.message : String(e) }); setLogVer(v => v + 1); }
  };
  const oleDownload = (name: string, native: boolean) => {
    const d = deck(); const data = d ? P.readPackagePart(d.pres, name) : null;
    if (!data) return;
    if (native && isCfb(data)) { const n = readCfb(data).native; if (n) { downloadBlob(n.fileName, new Blob([n.data as BlobPart])); return; } }
    downloadBlob(name.split("/").pop() || "object.bin", new Blob([data as BlobPart]));
  };
  const oleStream = (path: string) => {
    const d = deck(); const data = d && oleSel() ? P.readPackagePart(d.pres, oleSel()!) : null;
    if (!data) return;
    const b = streamBytes(data, path);
    setOleInfo(i => ({ ...(i ?? {}), stream: path, dump: b ? hexDump(b, 512) : t("ole.noStream") }));
  };
  const loadVba = () => { const n = vbaName(); const d = deck(); const data = n && d ? P.readPackagePart(d.pres, n) : null; if (!data) return; const v = readVba(data); setOleInfo(i => ({ ...(i ?? {}), vba: v, vbaMod: v.modules.length ? 0 : undefined })); };

  // ───────── properti & debug ─────────

  const applyProps = () => { const d = deck(); if (!d || ro()) return; P.setCoreProperties(d.pres, { ...propsDraft(), modified: new Date() } as never); view?.changed("hist.props"); toast("toast.propsSaved"); };
  const openDebug = () => {
    const d = deck();
    if (!d || !view) return;
    const sum = P.getPresentationSummary(d.pres);
    const info = {
      app: { component: "PptxEditor", lang: lang(), readonly: ro(), zoom: view.zoom },
      deck: { name: d.fileName, size: d.originalBytes.length, modified: d.modified, size16: P.getSlideSize(d.pres), summary: sum, parts: P.listPackageParts(d.pres).map(p => ({ n: p.name, b: p.byteLength, ct: p.contentType })) },
      history: { index: d.histIdx, count: d.hist.length, max: d.maxHistory, entries: d.hist.map((h, i) => ({ i, label: h.label, kb: Math.round(h.bytes.length / 1024) })) },
      current: view.debug(),
      search: { hits: fRes()?.hits.length ?? 0 },
      env: { ua: navigator.userAgent, dpr: window.devicePixelRatio },
    };
    setDbg(JSON.stringify(info, (_k, v) => (v instanceof Uint8Array ? `<Uint8Array ${v.length}>` : v), 2));
    setDialog("debug");
  };

  // ───────── util UI ─────────

  const openMenu = (id: MenuId, e: MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu(m => (m?.id === id ? null : { id, x: Math.min(r.left, window.innerWidth - 260), y: r.bottom + 2 }));
  };
  const Btn = (p: { icon?: string; label?: string; title?: string; on?: boolean; disabled?: boolean; primary?: boolean; onClick?: (e: MouseEvent) => void; children?: JSX.Element; menu?: boolean; badge?: number; badgeKind?: string }) => (
    <button class="pxe-btn" classList={{ on: p.on, primary: p.primary }} title={p.title ?? p.label} disabled={p.disabled} data-menu={p.menu ? "1" : undefined} onMouseDown={e => e.preventDefault()} onClick={e => p.onClick?.(e)}>
      <Show when={p.icon}><Ic n={p.icon!} /></Show>
      <Show when={p.label}><span>{p.label}</span></Show>
      {p.children}
      <Show when={p.badge}><span class={`b ${p.badgeKind ?? ""}`}>{p.badge}</span></Show>
      <Show when={p.menu}><Ic n="chevron" size={12} /></Show>
    </button>
  );
  const Grp = (p: { cap?: string; children: JSX.Element }) => (<div class="pxe-rg"><div class="row">{p.children}</div><Show when={p.cap}><div class="cap">{p.cap}</div></Show></div>);
  const MI = (p: { label: string; onClick: () => void; disabled?: boolean; icon?: string }) => (
    <button disabled={p.disabled} onMouseDown={e => e.preventDefault()} onClick={() => { setMenu(null); p.onClick(); }}><Show when={p.icon}><Ic n={p.icon!} size={14} /></Show>{p.label}</button>
  );
  const S = () => sel()?.shape;
  const edit = () => !ro() && !!deck();
  const hasSel = () => edit() && !!S();
  const logs = createMemo<SlideLog[]>(() => { logVer(); const d = deck(); return d ? [...d.log] : []; });
  const counts = createMemo(() => { const l = logs(); return { info: l.filter(x => x.level === "info").length, warn: l.filter(x => x.level === "warn").length, error: l.filter(x => x.level === "error").length }; });
  const layouts = createMemo(() => { ver(); const d = deck(); return d ? P.getSlideLayouts(d.pres).map(l => P.getSlideLayoutName(l)) : []; });
  const transition = createMemo(() => { ver(); slideIdx(); const s = view?.slide; return s ? P.getSlideTransition(s) : null; });
  const info = createMemo(() => {
    ver();
    const d = deck();
    if (!d || panel() !== "info") return null;
    return { sum: P.getPresentationSummary(d.pres), size: P.getSlideSize(d.pres), parts: P.listPackageParts(d.pres), validation: P.validatePresentation(d.pres), core: P.getCoreProperties(d.pres), comments: P.getAllComments(d.pres) };
  });
  const tabs = createMemo<Tab[]>(() => {
    const s = S();
    const out: Tab[] = ["home", "insert", "format"];
    if (s?.isTable) out.push("table");
    if (s?.isChart) out.push("chart");
    if (s?.isPicture) out.push("picture");
    out.push("slide", "view");
    return out;
  });
  createEffect(() => { if (!tabs().includes(tab())) setTab("home"); });
  const colorOf = (c: string | null | undefined, d = "#000000") => (c && /^#?[0-9a-f]{6}$/i.test(c) ? (c.startsWith("#") ? c : `#${c}`).toLowerCase() : d);

  // ───────── pintasan ─────────

  const onRootKey = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const typing = (e.target as HTMLElement).closest?.("input,textarea,select,[contenteditable='true']");
    if (mod && k === "f") { e.preventDefault(); openFind(); }
    else if (mod && k === "s") { e.preventDefault(); void savePptx(); }
    else if (mod && k === "o") { e.preventDefault(); fileInput.click(); }
    else if (mod && !typing && k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (mod && !typing && k === "y") { e.preventDefault(); redo(); }
    else if (e.key === "F5") { e.preventDefault(); startPresent(); }
    else if (e.key === "F3") { e.preventDefault(); if (panel() !== "find") openFind(); else step(e.shiftKey ? -1 : 1); }
    else if (e.key === "Escape") { if (menu()) setMenu(null); else if (dialog()) setDialog(null); else if (panel() === "find" && !painter() && !view?.isEditing()) setPanel(null); }
  };

  const numField = (label: string, value: number | undefined, onSet: (v: number) => void, step = 0.1, w = 62) => (
    <>
      <label class="pxe-lbl">{label}</label>
      <input class="pxe-num-in" style={{ width: `${w}px` }} type="number" step={step} disabled={!hasSel()} value={value ?? ""} onChange={e => { const v = parseFloat(e.currentTarget.value); if (Number.isFinite(v)) onSet(v); }} />
    </>
  );

  // ───────── ribbon ─────────

  const Home = () => (
    <>
      <Grp cap={t("g.clipboard")}>
        <Btn icon="paste" label={t("b.paste")} disabled={!edit()} onClick={() => view?.paste()} />
        <Btn icon="copy" title={t("b.copy") + " (Ctrl+C)"} disabled={!hasSel()} onClick={() => view?.copy()} />
        <Btn icon="copy" label={t("b.duplicate")} title={t("b.duplicate") + " (Ctrl+D)"} disabled={!hasSel()} onClick={() => view?.duplicateSelected()} />
        <Btn icon="brush" label={t("b.painter")} title={t("b.painterTip")} disabled={!hasSel()} on={!!painter()} onClick={() => (painter() ? view?.cancelPainter() : view?.startPainter())} />
      </Grp>
      <Grp cap={t("g.slides")}>
        <Btn icon="plus" label={t("b.newSlide")} disabled={!edit()} onClick={() => view?.addSlide()} />
        <Btn label={t("b.layout")} disabled={!edit()} menu onClick={e => openMenu("layout", e)} />
        <Btn icon="copy" title={t("b.dupSlide")} disabled={!edit()} onClick={() => view?.duplicateSlide()} />
        <Btn icon="trash" title={t("b.delSlide")} disabled={!edit() || slideCount() < 2} onClick={() => view?.deleteSlide()} />
      </Grp>
      <Grp cap={t("g.font")}>
        <select class="pxe-sel" style={{ width: "130px" }} disabled={!hasSel() || !S()?.fmt} value={S()?.fmt?.font ?? ""} onChange={e => view?.textFormat({ font: e.currentTarget.value })} title={t("b.font")}>
          <option value="">{S()?.fmt?.font ?? "—"}</option>
          <For each={FONTS}>{f => <option value={f}>{f}</option>}</For>
        </select>
        <input class="pxe-num-in" style={{ width: "56px" }} list="pxe-sizes" disabled={!hasSel()} value={S()?.fmt?.size ?? ""} title={t("b.size")} onChange={e => { const v = parseFloat(e.currentTarget.value); if (v > 0) view?.textFormat({ size: v }); }} />
        <datalist id="pxe-sizes"><For each={SIZES}>{s => <option value={s} />}</For></datalist>
        <Btn title={t("b.sizeUp")} disabled={!hasSel()} onClick={() => view?.textFormat({ size: Math.min(400, (S()?.fmt?.size ?? 18) + 2) })}><span style={{ "font-weight": "700" }}>A↑</span></Btn>
        <Btn title={t("b.sizeDown")} disabled={!hasSel()} onClick={() => view?.textFormat({ size: Math.max(6, (S()?.fmt?.size ?? 18) - 2) })}><span style={{ "font-weight": "700", "font-size": "11px" }}>A↓</span></Btn>
        <Btn title={t("b.bold") + " (Ctrl+B)"} disabled={!hasSel()} on={S()?.fmt?.bold} onClick={() => view?.toggle("bold")}><span class="f-b">B</span></Btn>
        <Btn title={t("b.italic") + " (Ctrl+I)"} disabled={!hasSel()} on={S()?.fmt?.italic} onClick={() => view?.toggle("italic")}><span class="f-i">I</span></Btn>
        <Btn title={t("b.underline") + " (Ctrl+U)"} disabled={!hasSel()} on={S()?.fmt?.underline} onClick={() => view?.toggle("underline")}><span class="f-u">U</span></Btn>
        <Btn title={t("b.strike")} disabled={!hasSel()} on={S()?.fmt?.strike} onClick={() => view?.toggle("strike")}><span class="f-s">S</span></Btn>
        <label class="pxe-lbl" title={t("b.color")}>A<input type="color" class="pxe-color" disabled={!hasSel()} value={colorOf(S()?.fmt?.color)} onChange={e => view?.textFormat({ color: e.currentTarget.value as P.Color })} /></label>
      </Grp>
      <Grp cap={t("g.paragraph")}>
        <Btn icon="bullets" title={t("b.bullets")} disabled={!hasSel()} on={S()?.fmt?.bullet === "bullet"} onClick={() => view?.bullets(S()?.fmt?.bullet === "bullet" ? "none" : "bullet")} />
        <Btn icon="numbers" title={t("b.numbers")} disabled={!hasSel()} on={S()?.fmt?.bullet === "number"} onClick={() => view?.bullets(S()?.fmt?.bullet === "number" ? "none" : "number")} />
        <Btn icon="outdent" title={t("b.outdent")} disabled={!hasSel()} onClick={() => view?.level(-1)} />
        <Btn icon="indent" title={t("b.indent")} disabled={!hasSel()} onClick={() => view?.level(1)} />
        <Btn icon="alignL" title={t("b.alignL")} disabled={!hasSel()} on={S()?.fmt?.align === "left" || S()?.fmt?.align === "l"} onClick={() => view?.align("left")} />
        <Btn icon="alignC" title={t("b.alignC")} disabled={!hasSel()} on={S()?.fmt?.align === "center" || S()?.fmt?.align === "ctr"} onClick={() => view?.align("center")} />
        <Btn icon="alignR" title={t("b.alignR")} disabled={!hasSel()} on={S()?.fmt?.align === "right" || S()?.fmt?.align === "r"} onClick={() => view?.align("right")} />
        <Btn icon="alignJ" title={t("b.alignJ")} disabled={!hasSel()} on={S()?.fmt?.align === "justify"} onClick={() => view?.align("justify")} />
        <select class="pxe-sel" style={{ width: "62px" }} disabled={!hasSel()} title={t("b.lineSpacing")} onChange={e => { const v = parseFloat(e.currentTarget.value); if (v) view?.lineSpacing(v); e.currentTarget.value = ""; }}>
          <option value="">↕ {S()?.fmt?.lineSpacing ?? ""}</option><For each={[0.9, 1, 1.15, 1.5, 2]}>{v => <option value={v}>{v}</option>}</For>
        </select>
        <Btn label="⤒" title={t("b.anchorTop")} disabled={!hasSel()} onClick={() => view?.textAnchor("top")} />
        <Btn label="↕" title={t("b.anchorMid")} disabled={!hasSel()} onClick={() => view?.textAnchor("center")} />
        <Btn label="⤓" title={t("b.anchorBot")} disabled={!hasSel()} onClick={() => view?.textAnchor("bottom")} />
      </Grp>
      <Grp cap={t("g.drawing")}>
        <label class="pxe-lbl" title={t("b.fill")}><Ic n="fill" size={14} /><input type="color" class="pxe-color" disabled={!hasSel()} value={colorOf(S()?.fill, "#4f81bd")} onChange={e => view?.setFill(e.currentTarget.value)} /></label>
        <Btn label="∅" title={t("b.noFill")} disabled={!hasSel()} onClick={() => view?.setFill(null)} />
        <label class="pxe-lbl" title={t("b.outline")}><Ic n="stroke" size={14} /><input type="color" class="pxe-color" disabled={!hasSel()} value={colorOf(S()?.stroke, "#1f2937")} onChange={e => view?.setStroke({ color: e.currentTarget.value, widthPt: S()?.strokeW ? S()!.strokeW! / 12700 : 1 })} /></label>
        <select class="pxe-sel" style={{ width: "62px" }} disabled={!hasSel()} title={t("b.outlineW")} onChange={e => { const v = parseFloat(e.currentTarget.value); if (v >= 0) view?.setStroke(v === 0 ? { color: null } : { widthPt: v, color: S()?.stroke ?? "#1f2937" }); e.currentTarget.value = ""; }}>
          <option value="">{S()?.strokeW ? `${Math.round((S()!.strokeW! / 12700) * 10) / 10}pt` : "—"}</option><For each={[0, 0.5, 1, 2, 3, 4.5, 6]}>{v => <option value={v}>{v === 0 ? "∅" : `${v}pt`}</option>}</For>
        </select>
        <select class="pxe-sel" style={{ width: "74px" }} disabled={!hasSel() || !S()?.stroke} title={t("b.dash")} onChange={e => { if (e.currentTarget.value) view?.setStroke({ dash: e.currentTarget.value as P.LineDash }); e.currentTarget.value = ""; }}>
          <option value="">{S()?.dash ?? "—"}</option><For each={DASHES}>{v => <option value={v}>{v}</option>}</For>
        </select>
        <Btn icon="shadow" title={t("b.shadow")} disabled={!hasSel()} on={S()?.shadow} onClick={() => view?.setShadow(!S()?.shadow)} />
      </Grp>
    </>
  );

  const Insert = () => (
    <>
      <Grp cap={t("g.insert")}>
        <Btn icon="textbox" label={t("b.textbox")} disabled={!edit()} on={tool()?.type === "textbox"} onClick={() => view?.setTool(tool()?.type === "textbox" ? null : { type: "textbox" })} />
        <Btn icon="shape" label={t("b.shapes")} disabled={!edit()} menu onClick={e => openMenu("shapes", e)} />
        <Btn icon="line" title={t("b.line")} disabled={!edit()} on={tool()?.type === "line" && !(tool() as { arrow?: boolean }).arrow} onClick={() => view?.setTool({ type: "line" })} />
        <Btn icon="arrow" title={t("b.arrowLine")} disabled={!edit()} on={tool()?.type === "line" && !!(tool() as { arrow?: boolean }).arrow} onClick={() => view?.setTool({ type: "line", arrow: true })} />
        <Btn icon="image" label={t("b.picture")} disabled={!edit()} onClick={() => imgInput.click()} />
        <Btn icon="object" label={t("ole.insert")} title={t("ole.insertTip")} disabled={!edit() || !deck()} onClick={() => oleInput.click()} />
        <Btn icon="table" label={t("b.table")} disabled={!edit()} menu onClick={e => openMenu("table", e)} />
        <Btn icon="chart" label={t("b.chart")} disabled={!edit()} menu onClick={e => openMenu("chart", e)} />
        <Btn icon="link" label={t("b.link")} disabled={!hasSel()} onClick={() => { setLinkUrl(S()?.hyperlink ?? "https://"); setDialog("link"); }} />
      </Grp>
      <Grp cap={t("g.slides")}>
        <Btn icon="plus" label={t("b.newSlide")} disabled={!edit()} onClick={() => view?.addSlide()} />
        <Btn label={t("b.layout")} disabled={!edit()} menu onClick={e => openMenu("layout", e)} />
      </Grp>
    </>
  );

  const Format = () => (
    <>
      <Grp cap={t("g.size")}>
        {numField("X", S() ? cm(S()!.x) : undefined, v => view?.setBoundsCm({ x: v }))}
        {numField("Y", S() ? cm(S()!.y) : undefined, v => view?.setBoundsCm({ y: v }))}
        {numField(t("p.width"), S() ? cm(S()!.w) : undefined, v => view?.setBoundsCm({ w: v }, lockAspect()))}
        {numField(t("p.height"), S() ? cm(S()!.h) : undefined, v => view?.setBoundsCm({ h: v }, lockAspect()))}
        <label class="pxe-lbl">cm</label>
        <Btn icon={lockAspect() ? "lock" : "unlock"} title={t("p.lock")} label={lockAspect() ? t("p.locked") : t("p.free")} on={lockAspect()} onClick={() => setLockAspect(v => !v)} />
      </Grp>
      <Grp cap={t("g.transform")}>
        {numField("°", S()?.rot, v => view?.setRotation(v), 5, 56)}
        <Btn icon="rotate" title={t("p.rotateCW")} disabled={!hasSel()} onClick={() => view?.setRotation(((S()?.rot ?? 0) + 90) % 360)} />
        <Btn icon="flipH" title={t("p.flipH")} disabled={!hasSel()} on={S()?.flipH} onClick={() => view?.flip("h")} />
        <Btn icon="flipV" title={t("p.flipV")} disabled={!hasSel()} on={S()?.flipV} onClick={() => view?.flip("v")} />
      </Grp>
      <Grp cap={t("g.arrange")}>
        <Btn icon="front" title={t("a.front")} disabled={!hasSel()} onClick={() => view?.zOrder("front")} />
        <Btn icon="back" title={t("a.back")} disabled={!hasSel()} onClick={() => view?.zOrder("back")} />
        <Btn icon="arrowUp" title={t("a.forward")} disabled={!hasSel()} onClick={() => view?.zOrder("forward")} />
        <Btn icon="arrowDown" title={t("a.backward")} disabled={!hasSel()} onClick={() => view?.zOrder("backward")} />
        <Btn label={t("b.align")} disabled={!hasSel()} menu onClick={e => openMenu("align", e)} />
        <Btn icon="group" label={t("a.group")} title={t("a.group") + " (Ctrl+G)"} disabled={!edit() || (sel()?.count ?? 0) < 2} onClick={() => view?.group()} />
        <Btn label={t("a.ungroup")} disabled={!edit() || !S()?.isGroup} onClick={() => view?.ungroup()} />
      </Grp>
      <Grp cap={t("g.properties")}>
        <input class="pxe-txt" style={{ width: "130px" }} disabled={!hasSel()} placeholder={t("p.name")} title={t("p.name")} value={S()?.name ?? ""} onChange={e => view?.rename(e.currentTarget.value)} />
        <input class="pxe-txt" style={{ width: "150px" }} disabled={!hasSel()} placeholder={t("p.alt")} title={t("p.alt")} value={S()?.alt ?? ""} onChange={e => view?.setAlt(e.currentTarget.value)} />
        <Btn icon={S()?.hidden ? "eyeoff" : "eye"} title={t("p.hidden")} disabled={!hasSel()} on={S()?.hidden} onClick={() => view?.setHidden(!S()?.hidden)} />
        <select class="pxe-sel" style={{ width: "100px" }} disabled={!hasSel()} title={t("p.animation")} value={S()?.animation ?? ""} onChange={e => view?.setAnimation((e.currentTarget.value || null) as P.AnimationEffect | null)}>
          <option value="">{t("p.noAnim")}</option><For each={["fadeIn", "fadeOut", "appear", "disappear"]}>{a => <option value={a}>{a}</option>}</For>
        </select>
        <Btn icon="trash" title={t("p.delete")} disabled={!hasSel()} onClick={() => view?.deleteSelected()} />
      </Grp>
    </>
  );

  const TableTab = () => {
    const d = () => !edit() || !S()?.isTable;
    const op = (name: string, arg?: unknown) => () => view?.tableOp(name, arg);
    return (
      <>
        <Grp cap={t("g.rowsCols")}>
          <Btn label={t("t.rowAbove")} disabled={d()} onClick={op("rowAbove")} /><Btn label={t("t.rowBelow")} disabled={d()} onClick={op("rowBelow")} />
          <Btn label={t("t.colLeft")} disabled={d()} onClick={op("colLeft")} /><Btn label={t("t.colRight")} disabled={d()} onClick={op("colRight")} />
          <Btn icon="trash" label={t("t.delRow")} disabled={d()} onClick={op("delRow")} /><Btn icon="trash" label={t("t.delCol")} disabled={d()} onClick={op("delCol")} />
          <Btn icon="trash" label={t("t.delTable")} disabled={d()} onClick={op("delTable")} />
        </Grp>
        <Grp cap={t("g.merge")}>
          <Btn icon="merge" label={t("t.mergeRight")} disabled={d()} onClick={op("merge", { rowSpan: 1, colSpan: 2 })} />
          <Btn icon="merge" label={t("t.mergeDown")} disabled={d()} onClick={op("merge", { rowSpan: 2, colSpan: 1 })} />
          <span class="pxe-lbl">{S()?.cell ? t("t.cellPos", { r: S()!.cell!.row, c: S()!.cell!.col }) : t("t.pickCell")}</span>
        </Grp>
        <Grp cap={t("g.cell")}>
          <label class="pxe-lbl" title={t("t.shade")}>▨<input type="color" class="pxe-color" disabled={d()} value="#e8eef7" onChange={e => view?.tableOp("fill", e.currentTarget.value)} /></label>
          <Btn label="∅" title={t("t.noShade")} disabled={d()} onClick={op("fill", null)} />
          <Btn label="⤒" title={t("b.anchorTop")} disabled={d()} onClick={op("anchor", "top")} /><Btn label="↕" title={t("b.anchorMid")} disabled={d()} onClick={op("anchor", "center")} /><Btn label="⤓" title={t("b.anchorBot")} disabled={d()} onClick={op("anchor", "bottom")} />
          <Btn label={t("t.borders")} title={t("t.bordersTip")} disabled={d()} onClick={op("border", { color: "#1f2937", widthPt: 1 })} />
        </Grp>
        <Grp cap={t("g.table")}>
          <label class="pxe-chk"><input type="checkbox" disabled={d()} onChange={e => view?.tableOp("flags", { firstRow: e.currentTarget.checked })} />{t("t.headerRow")}</label>
          <label class="pxe-chk"><input type="checkbox" disabled={d()} onChange={e => view?.tableOp("flags", { bandRow: e.currentTarget.checked })} />{t("t.banded")}</label>
          <label class="pxe-chk"><input type="checkbox" disabled={d()} onChange={e => view?.tableOp("flags", { firstCol: e.currentTarget.checked })} />{t("t.firstCol")}</label>
          <label class="pxe-lbl">{t("t.colW")}</label><input class="pxe-num-in" type="number" min="0.5" step="0.1" disabled={d()} onChange={e => { const v = parseFloat(e.currentTarget.value); if (v > 0) view?.tableOp("colW", v); }} />
          <label class="pxe-lbl">{t("t.rowH")}</label><input class="pxe-num-in" type="number" min="0.3" step="0.1" disabled={d()} onChange={e => { const v = parseFloat(e.currentTarget.value); if (v > 0) view?.tableOp("rowH", v); }} />
        </Grp>
      </>
    );
  };

  const ChartTab = () => (
    <Grp cap={t("g.chart")}>
      <select class="pxe-sel" style={{ width: "120px" }} disabled={!hasSel()} title={t("c.kind")} onChange={e => view?.chartSpecPatch({ kind: e.currentTarget.value })}>
        <For each={CHARTS}>{k => <option value={k}>{t("c." + k)}</option>}</For>
      </select>
      <input class="pxe-txt" style={{ width: "180px" }} disabled={!hasSel()} placeholder={t("c.title")} title={t("c.title")} onChange={e => view?.chartSpecPatch({ title: e.currentTarget.value })} />
      <span class="pxe-lbl">{t("c.note")}</span>
    </Grp>
  );

  const PictureTab = () => {
    const d = () => !edit() || !S()?.isPicture;
    const im = () => S()?.image;
    const crop = (side: "left" | "top" | "right" | "bottom", v: number) => view?.imageProps({ crop: { ...(im()?.crop ?? {}), [side]: Math.max(0, Math.min(0.9, v / 100)) } });
    return (
      <>
        <Grp cap={t("g.picture")}>
          <Btn icon="image" label={t("p.replace")} disabled={d()} onClick={() => replInput.click()} />
          <Btn label={t("p.resetCrop")} disabled={d()} onClick={() => view?.imageProps({ crop: null, brightness: null, contrast: null, opacity: null })} />
          <span class="pxe-lbl">{im() ? `${im()!.format ?? ""} · ${formatBytes(im()!.bytes)}` : ""}</span>
        </Grp>
        <Grp cap={t("g.crop")}>
          <For each={["left", "top", "right", "bottom"] as const}>{side => (<>
            <label class="pxe-lbl">{t("p.crop." + side)}</label>
            <input class="pxe-num-in" style={{ width: "52px" }} type="number" min="0" max="90" step="1" disabled={d()} value={Math.round((im()?.crop?.[side] ?? 0) * 100)} onChange={e => crop(side, parseFloat(e.currentTarget.value) || 0)} />
          </>)}</For>
          <label class="pxe-lbl">%</label>
        </Grp>
        <Grp cap={t("g.adjust")}>
          <label class="pxe-lbl">{t("p.brightness")}</label><input type="range" min="-50" max="50" disabled={d()} value={Math.round((im()?.brightness ?? 0) * 100)} onChange={e => view?.imageProps({ brightness: +e.currentTarget.value / 100 })} />
          <label class="pxe-lbl">{t("p.contrast")}</label><input type="range" min="-50" max="50" disabled={d()} value={Math.round((im()?.contrast ?? 0) * 100)} onChange={e => view?.imageProps({ contrast: +e.currentTarget.value / 100 })} />
          <label class="pxe-lbl">{t("p.opacity")}</label><input type="range" min="10" max="100" disabled={d()} value={Math.round((im()?.opacity ?? 1) * 100)} onChange={e => view?.setOpacity(+e.currentTarget.value / 100)} />
        </Grp>
      </>
    );
  };

  const SlideTab = () => (
    <>
      <Grp cap={t("g.slide")}>
        <select class="pxe-sel" style={{ width: "150px" }} disabled={!edit()} title={t("b.layout")} value={sel()?.layout ?? ""} onChange={e => view?.changeLayout(e.currentTarget.value)}>
          <For each={layouts()}>{l => <option value={l} selected={l === sel()?.layout}>{l}</option>}</For>
        </select>
        <Btn icon={sel()?.hidden ? "eyeoff" : "eye"} label={t("s.hideSlide")} disabled={!edit()} on={sel()?.hidden} onClick={() => view?.hideSlide(!sel()?.hidden)} />
        <Btn icon="arrowUp" title={t("s.moveUp")} disabled={!edit() || slideIdx() < 1} onClick={() => view?.moveSlide(slideIdx(), slideIdx() - 1)} />
        <Btn icon="arrowDown" title={t("s.moveDown")} disabled={!edit() || slideIdx() >= slideCount() - 1} onClick={() => view?.moveSlide(slideIdx(), slideIdx() + 1)} />
      </Grp>
      <Grp cap={t("g.background")}>
        <label class="pxe-lbl" title={t("s.bgColor")}><Ic n="fill" size={14} /><input type="color" class="pxe-color" disabled={!edit()} value="#ffffff" onChange={e => view?.setBackground(e.currentTarget.value)} /></label>
        <Btn icon="image" label={t("s.bgImage")} disabled={!edit()} onClick={() => bgInput.click()} />
        <Btn label={t("s.bgClear")} disabled={!edit()} onClick={() => view?.setBackground(null)} />
      </Grp>
      <Grp cap={t("g.transition")}>
        <select class="pxe-sel" style={{ width: "120px" }} disabled={!edit()} title={t("s.transition")} value={transition()?.effect ?? "none"} onChange={e => { const v = e.currentTarget.value; view?.setTransition(v === "none" ? null : { effect: v as P.TransitionEffect, speed: transition()?.speed ?? "med" }); }}>
          <option value="none">{t("s.noTransition")}</option><For each={TRANSITIONS}>{x => <option value={x}>{x}</option>}</For>
        </select>
        <select class="pxe-sel" style={{ width: "76px" }} disabled={!edit() || !transition()} title={t("s.speed")} value={transition()?.speed ?? "med"} onChange={e => view?.setTransition({ effect: (transition()?.effect ?? "fade") as P.TransitionEffect, speed: e.currentTarget.value as "slow" | "med" | "fast" })}>
          <For each={["slow", "med", "fast"]}>{s => <option value={s}>{s}</option>}</For>
        </select>
        <Btn label={t("s.applyAll")} disabled={!edit()} onClick={() => view?.applyTransitionAll()} />
      </Grp>
      <Grp cap={t("g.show")}>
        <Btn icon="play" label={t("b.present")} title={t("b.present") + " (F5)"} disabled={!deck()} onClick={startPresent} />
      </Grp>
    </>
  );

  const ViewTab = () => (
    <>
      <Grp cap={t("g.zoom")}>
        <Btn label="−" title={t("v.zoomOut")} onClick={() => setZoom(zoom() - 0.1)} /><Btn label="+" title={t("v.zoomIn")} onClick={() => setZoom(zoom() + 0.1)} />
        <Btn label={t("v.fit")} on={fit()} onClick={fitZoom} /><Btn label="100%" onClick={() => setZoom(1)} />
      </Grp>
      <Grp cap={t("g.show")}>
        <label class="pxe-chk"><input type="checkbox" checked={grid()} onChange={e => setGrid(e.currentTarget.checked)} />{t("v.grid")}</label>
        <label class="pxe-chk"><input type="checkbox" checked={snapOn()} onChange={e => setSnapOn(e.currentTarget.checked)} />{t("v.snap")}</label>
        <label class="pxe-chk"><input type="checkbox" checked={thumbsOpen()} onChange={e => { setThumbsOpen(e.currentTarget.checked); queueMicrotask(() => { if (fit()) fitZoom(); }); }} />{t("v.thumbs")}</label>
        <label class="pxe-chk"><input type="checkbox" checked={notesOpen()} onChange={e => { setNotesOpen(e.currentTarget.checked); queueMicrotask(() => { if (fit()) fitZoom(); }); }} />{t("v.notes")}</label>
        <label class="pxe-chk"><input type="checkbox" checked={dark()} onChange={e => setDark(e.currentTarget.checked)} />{t("v.dark")}</label>
      </Grp>
      <Grp cap={t("g.ruler")}>
        <label class="pxe-chk" title={t("ruler.showTip")}><input type="checkbox" checked={rulerOn()} onChange={e => ruler?.setVisible(e.currentTarget.checked)} />{t("ruler.show")}</label>
        <select class="pxe-sel" style={{ width: "62px" }} title={t("ruler.unit")} value={rulerUnit()} onChange={e => ruler?.setUnit(e.currentTarget.value as RulerUnit)}>
          <For each={RULER_UNITS}>{u => <option value={u}>{u}</option>}</For>
        </select>
        <Btn icon="measure" label={t("ruler.measure")} title={t("ruler.measureTip")} on={measuring()} onClick={() => ruler?.setMeasureMode(!measuring())} />
        <Btn icon="trash" label={t("ruler.clearGuides")} disabled={!guideCount()} onClick={() => ruler?.clearGuides()} />
        <Show when={guideCount()}><span class="pxe-lbl">{t("ruler.guides", { n: guideCount() })}</span></Show>
        <Show when={measureText()}><span class="pxe-lbl" title={t("ruler.measure")}>{measureText()}</span></Show>
      </Grp>
      <Grp cap={t("g.window")}>
        <Btn icon="play" label={t("b.present")} onClick={startPresent} />
        <Btn icon={fs() ? "shrink" : "expand"} label={fs() ? t("v.exitFs") : t("v.fullscreen")} onClick={() => void toggleFs()} />
      </Grp>
    </>
  );

  // ───────── panel samping ─────────

  const sidePanel = () => (
    <div class="pxe-side">
      <div class="pxe-side-h"><b>{t("panel." + panel())}</b><span style={{ flex: 1 }} /><Btn icon="x" title={t("b.close")} onClick={() => setPanel(null)} /></div>
      <div class="pxe-side-b">
        <Show when={panel() === "find"}>
          <div style={{ display: "flex", gap: "4px", "margin-bottom": "6px" }}>
            <input ref={findInput} class="pxe-txt" style={{ flex: 1 }} placeholder={t("find.placeholder")} value={fq()} onInput={e => { setFq(e.currentTarget.value); scheduleSearch(); }} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (!fRes() || searchTimer) runSearch(); step(e.shiftKey ? -1 : 1); } }} />
            <Btn icon="arrowUp" title={t("find.prev")} onClick={() => step(-1)} /><Btn icon="arrowDown" title={t("find.next")} onClick={() => step(1)} />
          </div>
          <div style={{ display: "flex", gap: "10px", "flex-wrap": "wrap", "margin-bottom": "6px" }}>
            <label class="pxe-chk"><input type="checkbox" checked={fCase()} onChange={e => { setFCase(e.currentTarget.checked); runSearch(); }} />{t("find.case")}</label>
            <label class="pxe-chk"><input type="checkbox" checked={fWord()} onChange={e => { setFWord(e.currentTarget.checked); runSearch(); }} />{t("find.word")}</label>
            <label class="pxe-chk"><input type="checkbox" checked={fRegex()} onChange={e => { setFRegex(e.currentTarget.checked); runSearch(); }} />{t("find.regex")}</label>
          </div>
          <Show when={fRes()?.error}><div class="pxe-warnbox">{t("find.badRegex")}: {fRes()!.error}</div></Show>
          <Show when={!ro()}>
            <div style={{ display: "flex", gap: "4px", "margin-bottom": "6px" }}>
              <input class="pxe-txt" style={{ flex: 1 }} placeholder={t("find.replaceWith")} value={fRepl()} onInput={e => setFRepl(e.currentTarget.value)} />
              <Btn icon="replace" title={t("find.replaceOne")} disabled={!fRes()?.hits.length} onClick={replaceCur} />
              <Btn label={t("find.replaceAll")} disabled={!fRes()?.hits.length} onClick={replaceAll} />
            </div>
          </Show>
          <Show when={fRes()}><div class="pxe-note">{fRes()!.hits.length.toLocaleString()} {t("find.count")}{fRes()!.hits.length >= 3000 ? ` (${t("find.truncated")})` : ""}</div></Show>
          <div class="pxe-list">
            <For each={fRes()?.hits.slice(0, fLimit()) ?? []}>{h => (
              <div class="pxe-row" classList={{ on: fCur() === h.index }} onClick={() => { setFCur(h.index); view?.gotoHit(h.index); }}>
                <span class="lv">{t("find.slide", { n: h.slide + 1 })}</span>
                <span style={{ flex: 1, "min-width": 0 }}>{h.before}<mark>{h.text}</mark>{h.after}<div class="loc">{h.where}</div></span>
              </div>
            )}</For>
          </div>
          <Show when={(fRes()?.hits.length ?? 0) > fLimit()}><Btn label={t("find.more", { n: Math.min(200, fRes()!.hits.length - fLimit()) })} onClick={() => setFLimit(n => n + 200)} /></Show>
        </Show>

        <Show when={panel() === "history"}>
          <div class="pxe-note">{(ver(), t("hist.count", { n: Math.max(0, (deck()?.hist.length ?? 1) - 1), i: deck()?.histIdx ?? 0 }))}</div>
          <label class="pxe-field"><span>{t("hist.max")}</span><input class="pxe-num-in" type="number" min="1" max="1000" style={{ width: "90px" }} value={histMax()} onChange={e => setHistMax(Math.max(1, Math.floor(+e.currentTarget.value || 1)))} /></label>
          <div class="pxe-list">
            <For each={(ver(), deck()?.hist.map((h, i) => ({ h, i })).reverse() ?? [])}>{({ h, i }) => (
              <div class="pxe-row" classList={{ on: i === deck()?.histIdx }} onClick={() => jump(i)}>
                <span class="lv">#{i}</span><span style={{ flex: 1 }}>{t(h.label.startsWith("hist.") ? h.label : `hist.${h.label}`)}</span><span class="loc">{formatBytes(h.bytes.length)}</span>
              </div>
            )}</For>
          </div>
        </Show>

        <Show when={panel() === "log"}>
          <div style={{ display: "flex", gap: "4px", "margin-bottom": "6px", "flex-wrap": "wrap" }}>
            <For each={["all", "info", "warn", "error"] as const}>{f => <Btn label={`${t("log." + (f === "all" ? "all" : f === "info" ? "ok" : f === "warn" ? "warn" : "error"))}${f === "all" ? "" : ` ${counts()[f]}`}`} on={logFilter() === f} onClick={() => setLogFilter(f)} />}</For>
          </div>
          <div class="pxe-list">
            <For each={logs().filter(l => logFilter() === "all" || l.level === logFilter())}>{l => (
              <div class="pxe-row" style={{ cursor: "default" }}><span class={`pxe-ic ${l.level}`}>{l.level === "info" ? "●" : l.level === "warn" ? "▲" : "✖"}</span><span style={{ flex: 1, "word-break": "break-word" }}>{t(l.key, l.params)}</span></div>
            )}</For>
          </div>
        </Show>

        <Show when={panel() === "info" && info()}>
          {(() => {
            const i = () => info()!;
            return (
              <>
                <div class="pxe-h3">{t("info.file")}</div>
                <dl class="pxe-kv">
                  <dt>{t("info.name")}</dt><dd>{deck()?.fileName}</dd>
                  <dt>{t("info.size")}</dt><dd>{formatBytes(deck()?.originalBytes.length ?? 0)}</dd>
                  <dt>{t("info.parts")}</dt><dd>{i().parts.length}</dd>
                  <dt>{t("info.modified")}</dt><dd>{modified() ? t("info.yes") : t("info.no")}</dd>
                </dl>
                <div class="pxe-h3">{t("info.stats")}</div>
                <dl class="pxe-kv">
                  <dt>{t("info.slides")}</dt><dd>{i().sum.slideCount} ({t("info.hidden")}: {i().sum.hiddenSlideCount})</dd>
                  <dt>{t("info.shapes")}</dt><dd>{i().sum.totalShapes}</dd>
                  <dt>{t("info.size16")}</dt><dd>{i().size ? `${cm(i().size!.width)} × ${cm(i().size!.height)} cm` : "-"}</dd>
                  <dt>{t("info.layouts")}</dt><dd>{i().sum.layoutCount}</dd>
                  <dt>{t("info.theme")}</dt><dd>{i().sum.themeName ?? "-"}</dd>
                  <dt>{t("info.comments")}</dt><dd>{i().comments.length}</dd>
                </dl>
                <Show when={i().comments.length}>
                  <div class="pxe-list"><For each={i().comments.slice(0, 20)}>{c => <div class="pxe-row" style={{ cursor: "default" }}><span class="lv">{t("find.slide", { n: c.slideIndex + 1 })}</span><span style={{ flex: 1 }}><b>{P.getCommentAuthor(c.comment).name}</b>: {P.getCommentText(c.comment)}</span></div>}</For></div>
                </Show>
                <div class="pxe-h3">{t("info.props")}</div>
                <For each={["title", "creator", "subject", "keywords", "description", "category"]}>{k => (
                  <label class="pxe-field"><span>{t("prop." + k)}</span><input class="pxe-txt" disabled={ro()} value={propsDraft()[k] ?? ""} onInput={e => setPropsDraft(p => ({ ...p, [k]: e.currentTarget.value }))} /></label>
                )}</For>
                <Btn label={t("info.applyProps")} disabled={ro()} onClick={applyProps} />
                <div class="pxe-h3">{t("info.validation")}</div>
                <Show when={i().validation.length === 0}><div class="pxe-note">✓ {t("info.valid")}</div></Show>
                <For each={i().validation}>{v => <div class="pxe-warnbox">[{v.severity}] {v.message}</div>}</For>
                <div class="pxe-h3">{t("info.partsList")}</div>
                <table class="pxe-tbl"><tbody><For each={i().parts}>{p => <tr><td style={{ "word-break": "break-all" }}>{p.name}</td><td>{formatBytes(p.byteLength)}</td></tr>}</For></tbody></table>
              </>
            );
          })()}
        </Show>

        <Show when={panel() === "ole"}>
          <div class="pxe-note">{t("ole.help")}</div>
          <div style={{ display: "flex", gap: "4px", "flex-wrap": "wrap", "margin-bottom": "6px" }}>
            <Btn icon="object" label={t("ole.insert")} title={t("ole.insertTip")} disabled={!edit() || !deck()} onClick={() => oleInput.click()} />
            <Btn icon="replace" label={t("ole.update")} title={t("ole.updateTip")} disabled={!edit() || !oleItem() || !oleItems().some(o => oleKey(o) === oleItem() && !o.linked && o.format !== "missing")}
              onClick={() => { oleTarget = oleItem(); oleUpdInput.click(); }} />
          </div>
          <Show when={oleItems().length}>
            <div class="pxe-h3">{t("ole.objects")}</div>
            <div class="pxe-list">
              <For each={oleItems()}>{o => (
                <div class="pxe-row" classList={{ on: oleItem() === oleKey(o) }} onClick={() => { setOleItem(oleKey(o)); view?.goTo(o.slideIndex); }}>
                  <span style={{ flex: 1, "min-width": 0 }}><b>{o.description}</b><div class="loc">{o.progId || "—"} · {o.fileName} · {formatBytes(o.size)} · {t("ole.onSlide", { n: o.slideIndex + 1 })}</div></span>
                </div>
              )}</For>
            </div>
          </Show>
          <Show when={oleParts().length === 0}><div class="pxe-note">{t("ole.none")}</div></Show>
          <div class="pxe-list">
            <For each={oleParts()}>{o => (
              <div class="pxe-row" classList={{ on: oleSel() === o.name }} onClick={() => selectOle(o.name)}>
                <span style={{ flex: 1, "word-break": "break-all" }}>{o.name.replace("/ppt/", "")}</span><span class="loc">{formatBytes(o.size)}</span>
              </div>
            )}</For>
          </div>
          <Show when={oleSel()}>
            {(() => {
              const data = () => { const d = deck(); return d && oleSel() ? P.readPackagePart(d.pres, oleSel()!) : null; };
              return (
                <>
                  <div class="pxe-h3">{t("ole.detail")}</div>
                  <dl class="pxe-kv">
                    <dt>{t("ole.kind")}</dt><dd>{data() ? (isCfb(data()!) ? `OLE (${oleInfo()?.cfb?.kind ?? "CFB"})` : isZip(data()!) ? "OOXML (zip)" : "binary") : "-"}</dd>
                    <Show when={oleInfo()?.cfb?.native}><dt>{t("ole.embedded")}</dt><dd>{oleInfo()!.cfb!.native!.fileName}</dd></Show>
                  </dl>
                  <div style={{ display: "flex", gap: "6px", "flex-wrap": "wrap" }}>
                    <Btn icon="download" label={t("ole.dlRaw")} onClick={() => oleDownload(oleSel()!, false)} />
                    <Show when={oleInfo()?.cfb?.native}><Btn icon="download" label={t("ole.dlNative")} onClick={() => oleDownload(oleSel()!, true)} /></Show>
                  </div>
                  <Show when={data() && isZip(data()!)}><div class="pxe-note">{t("ole.zipNote")}</div></Show>
                  <Show when={oleInfo()?.cfb}>
                    <div class="pxe-h3">{t("ole.structure")}</div>
                    <table class="pxe-tbl"><tbody><For each={oleInfo()!.cfb!.entries}>{x => <tr style={{ cursor: x.type === "stream" ? "pointer" : "default" }} onClick={() => x.type === "stream" && oleStream(x.path)}><td style={{ "word-break": "break-all" }}>{x.path}</td><td>{x.type}</td><td>{x.type === "stream" ? x.size : ""}</td></tr>}</For></tbody></table>
                    <Show when={oleInfo()?.dump}><pre class="pxe-code">{oleInfo()!.dump}</pre></Show>
                  </Show>
                </>
              );
            })()}
          </Show>
          <Show when={vbaName()}>
            <div class="pxe-h3">{t("ole.macros")}</div>
            <div class="pxe-warnbox">{t("ole.macroNote")}</div>
            <Show when={!oleInfo()?.vba}><Btn label={t("ole.readVba")} onClick={loadVba} /></Show>
            <Show when={oleInfo()?.vba}>
              <Show when={oleInfo()!.vba!.error}><div class="pxe-warnbox">{oleInfo()!.vba!.error}</div></Show>
              <div class="pxe-list"><For each={oleInfo()!.vba!.modules}>{(m, i) => <div class="pxe-row" classList={{ on: oleInfo()!.vbaMod === i() }} onClick={() => setOleInfo(x => ({ ...(x ?? {}), vbaMod: i() }))}><span class="lv">{m.type}</span><span style={{ flex: 1 }}>{m.name}</span><span class="loc">{formatBytes(m.size)}</span></div>}</For></div>
              <Show when={oleInfo()!.vbaMod !== undefined && oleInfo()!.vba!.modules[oleInfo()!.vbaMod!]}><pre class="pxe-code">{oleInfo()!.vba!.modules[oleInfo()!.vbaMod!].source ?? t("ole.noSource")}</pre></Show>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );

  const slideMenuItems = () => (
    <>
      <MI icon="plus" label={t("b.newSlide")} disabled={!edit()} onClick={() => view?.addSlide()} />
      <MI icon="copy" label={t("b.dupSlide")} disabled={!edit()} onClick={() => view?.duplicateSlide()} />
      <MI icon={sel()?.hidden ? "eye" : "eyeoff"} label={t("s.hideSlide")} disabled={!edit()} onClick={() => view?.hideSlide(!sel()?.hidden)} />
      <MI icon="arrowUp" label={t("s.moveUp")} disabled={!edit() || slideIdx() < 1} onClick={() => view?.moveSlide(slideIdx(), slideIdx() - 1)} />
      <MI icon="arrowDown" label={t("s.moveDown")} disabled={!edit() || slideIdx() >= slideCount() - 1} onClick={() => view?.moveSlide(slideIdx(), slideIdx() + 1)} />
      <hr /><MI icon="trash" label={t("b.delSlide")} disabled={!edit() || slideCount() < 2} onClick={() => view?.deleteSlide()} />
    </>
  );

  // ───────── JSX ─────────

  return (
    <div ref={rootEl} class={`pxe-root ${props.class ?? ""}`} classList={{ dark: dark(), "pxe-fs": cssFs() }} style={{ height: props.height ?? "78vh" }} tabIndex={-1}
      onKeyDown={onRootKey}
      onDragOver={e => { if (e.dataTransfer?.types.includes("Files")) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={() => setDragOver(false)}>
      <input ref={fileInput} type="file" hidden accept=".pptx,.pptm,.potx,.potm,application/vnd.openxmlformats-officedocument.presentationml.presentation" onChange={e => { void openFile(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
      <input ref={oleInput} type="file" hidden onChange={e => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (f) void oleInsertUi(f); }} />
      <input ref={oleUpdInput} type="file" hidden onChange={e => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (f) void oleUpdateUi(f); }} />
      <input ref={imgInput} type="file" hidden accept="image/png,image/jpeg,image/gif,image/bmp,image/webp,image/svg+xml" onChange={e => { const f = e.currentTarget.files?.[0]; if (f) void view?.insertImage(f); e.currentTarget.value = ""; }} />
      <input ref={replInput} type="file" hidden accept="image/*" onChange={e => { const f = e.currentTarget.files?.[0]; if (f) void view?.replaceImage(f); e.currentTarget.value = ""; }} />
      <input ref={bgInput} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" onChange={e => { const f = e.currentTarget.files?.[0]; if (f) void view?.setBackgroundImage(f); e.currentTarget.value = ""; }} />

      <div class="pxe-top">
        <div class="pxe-title" title={deck()?.fileName}>
          <i>P</i><span class="n">{deck()?.fileName ?? "PPTX Editor"}</span>
          <Show when={modified()}><span class="pxe-tag mod" title={t("tag.modifiedTip")}>●</span></Show>
          <Show when={ro()}><span class="pxe-tag" title={t("tag.readonlyTip")}>{t("tag.readonly")}</span></Show>
          <Show when={vbaName()}><span class="pxe-tag warn" title={t("tag.macroTip")}>{t("tag.macro")}</span></Show>
        </div>
        <div class="pxe-grp">
          <Btn icon="open" label={t("b.open")} title={t("b.openTip") + " (Ctrl+O)"} onClick={() => fileInput.click()} />
          <Btn icon="sample" title={t("b.sample")} onClick={() => void openSample()} />
          <Btn icon="save" label={t("b.save")} primary title={t("b.saveTip") + " (Ctrl+S)"} disabled={ro() || !deck()} onClick={() => void savePptx()} />
          <Btn icon="download" label={t("b.export")} menu disabled={!deck()} onClick={e => openMenu("export", e)} />
        </div>
        <div class="pxe-grp">
          <Btn icon="undo" title={t("b.undo") + " (Ctrl+Z)"} disabled={ro() || !canUndo()} onClick={undo} />
          <Btn icon="redo" title={t("b.redo") + " (Ctrl+Y)"} disabled={ro() || !canRedo()} onClick={redo} />
          <Btn icon="clock" title={t("b.history")} on={panel() === "history"} onClick={() => setPanel(p => (p === "history" ? null : "history"))} />
        </div>
        <div class="pxe-grp">
          <Btn icon="play" label={t("b.present")} title={t("b.present") + " (F5)"} disabled={!deck()} onClick={startPresent} />
          <Btn icon="search" label={t("b.find")} title={t("b.find") + " (Ctrl+F)"} on={panel() === "find"} onClick={() => (panel() === "find" ? setPanel(null) : openFind())} />
          <Btn icon="info" title={t("b.info")} on={panel() === "info"} onClick={() => setPanel(p => (p === "info" ? null : "info"))} />
          <Btn icon="log" title={t("b.log")} on={panel() === "log"} badge={counts().error || counts().warn} badgeKind={counts().error ? "" : "w"} onClick={() => setPanel(p => (p === "log" ? null : "log"))} />
          <Btn icon="clip" title={t("b.ole")} on={panel() === "ole"} badge={oleParts().length || undefined} badgeKind="i" onClick={() => setPanel(p => (p === "ole" ? null : "ole"))} />
          <Btn icon="bug" title={t("b.debug")} disabled={!deck()} onClick={openDebug} />
        </div>
        <span class="pxe-spacer" />
        <div class="pxe-grp">
          <Btn icon="globe" label={lang().toUpperCase()} title={t("b.language")} menu onClick={e => openMenu("lang", e)} />
          <Btn icon={tbHidden() ? "eye" : "eyeoff"} title={tbHidden() ? t("v.showToolbar") : t("v.hideToolbar")} on={tbHidden()} onClick={() => setTbHidden(v => !v)} />
          <Btn icon={fs() ? "shrink" : "expand"} title={fs() ? t("v.exitFs") : t("v.fullscreen")} onClick={() => void toggleFs()} />
        </div>
      </div>

      <Show when={!tbHidden()}>
        <div class="pxe-tabs">
          <For each={tabs()}>{k => (
            <button class="pxe-tab" classList={{ on: tab() === k, ctx: k === "table" || k === "chart" || k === "picture" }} onMouseDown={e => e.preventDefault()} onClick={() => setTab(k)}>{t("tab." + k)}</button>
          )}</For>
        </div>
        <div class="pxe-ribbon">
          <Show when={tab() === "home"}><Home /></Show>
          <Show when={tab() === "insert"}><Insert /></Show>
          <Show when={tab() === "format"}><Format /></Show>
          <Show when={tab() === "table"}><TableTab /></Show>
          <Show when={tab() === "chart"}><ChartTab /></Show>
          <Show when={tab() === "picture"}><PictureTab /></Show>
          <Show when={tab() === "slide"}><SlideTab /></Show>
          <Show when={tab() === "view"}><ViewTab /></Show>
        </div>
      </Show>
      <Show when={tbHidden()}>
        <button class="pxe-btn pxe-showbar" style={{ background: "var(--px-panel)", border: "1px solid var(--px-border)" }} onClick={() => setTbHidden(false)} title={t("v.showToolbar")}><Ic n="panel" /><span>{t("v.showToolbar")}</span></button>
      </Show>

      <Show when={painter()}>
        <div class="pxe-painter">
          <Ic n="brush" /><b>{t("painter.copied")}</b>
          <For each={painter()!.items}>{([k, v]) => <span class="kv">{t("pk." + k)}: {v}</span>}</For>
          <span style={{ flex: 1 }} /><span>{t("painter.hint")}</span>
          <Btn icon="x" label={t("b.cancel")} onClick={() => view?.cancelPainter()} />
        </div>
      </Show>
      <Show when={tool()}>
        <div class="pxe-painter"><Ic n="shape" /><b>{t("tool.draw")}</b><span style={{ flex: 1 }} /><span>{t("tool.hint")}</span><Btn icon="x" label={t("b.cancel")} onClick={() => view?.setTool(null)} /></div>
      </Show>

      <div class="pxe-main">
        <div class="pxe-thumbs" classList={{ closed: !thumbsOpen() }} ref={thumbsEl} />
        <div class="pxe-canvas">
          <div ref={frameEl} class="rk-frame pxe-rkframe"><div class="rk-body"><div ref={hostEl} class="pxe-host" /></div></div>
          <Show when={notesOpen() && deck()}>
            <div class="pxe-notes">
              <label>{t("notes.label")}</label>
              <textarea placeholder={t("notes.placeholder")} readOnly={ro()} value={notes()} onInput={e => { setNotes(e.currentTarget.value); view?.setNotes(e.currentTarget.value); }} />
            </div>
          </Show>
          <Show when={busy()}><div class="pxe-busy">{t(busy()!)}</div></Show>
          <Show when={dragOver()}><div class="pxe-drop">{t("drop.hint")}</div></Show>
          <Show when={loadErr()}>
            {(() => {
              const e = () => loadErr()!;
              return (
                <div style={{ position: "absolute", inset: 0, overflow: "auto", background: "var(--px-canvas)", "z-index": 60, padding: "14px" }}>
                  <div class="pxe-errbox">
                    <b>{t("err." + e().code)}</b>
                    <div style={{ margin: "6px 0", "word-break": "break-word" }}>{e().msg}</div>
                    <div class="pxe-note">{t("err.hint")}</div>
                    <div style={{ display: "flex", gap: "6px", "margin-top": "8px", "flex-wrap": "wrap" }}>
                      <Btn icon="open" label={t("b.open")} onClick={() => fileInput.click()} />
                      <Btn icon="sample" label={t("b.sample")} onClick={() => void openSample()} />
                      <Show when={e().bytes}><Btn icon="download" label={t("b.source")} onClick={() => downloadBlob(e().name, new Blob([e().bytes as BlobPart]))} /></Show>
                    </div>
                    <Show when={e().info}>
                      <div class="pxe-h3">{t("err.cfb", { kind: e().info!.kind ?? "OLE" })}</div>
                      <table class="pxe-tbl"><tbody><For each={e().info!.entries}>{x => <tr><td style={{ "word-break": "break-all" }}>{x.path}</td><td>{x.type}</td><td>{x.type === "stream" ? x.size : ""}</td></tr>}</For></tbody></table>
                    </Show>
                  </div>
                </div>
              );
            })()}
          </Show>
        </div>
        <Show when={panel()}>{sidePanel()}</Show>
      </div>

      <div class="pxe-status">
        <span class="it">{t("s.slide", { i: slideIdx() + 1, n: slideCount() })}</span>
        <Show when={sel()?.layout}><span class="it">{sel()!.layout}</span></Show>
        <Show when={(sel()?.count ?? 0) > 1}><span class="it chip">{t("s.multi", { n: sel()!.count })}</span></Show>
        <Show when={S()}>
          <span class="it chip">{S()!.name} · {S()!.kind}{S()!.preset ? ` · ${S()!.preset}` : ""} · {cm(S()!.w)} × {cm(S()!.h)} cm{S()!.rot ? ` · ${Math.round(S()!.rot)}°` : ""}</span>
          <Show when={S()!.cell}><span class="it chip">{t("s.cell", { r: S()!.cell!.row, c: S()!.cell!.col, rows: S()!.cell!.rows, cols: S()!.cell!.cols })}{S()!.cell!.merged ? ` · ${t("s.merged")}` : ""}</span></Show>
        </Show>
        <Show when={sel()?.editing}><span class="it chip">✎ {t("s.editing")}</span></Show>
        <span class="sp" />
        <Show when={ro()}><span class="it chip">{t("tag.readonly")}</span></Show>
        <span class="it" title={t("s.historyTip")}>{(ver(), t("s.history", { i: deck()?.histIdx ?? 0, n: Math.max(0, (deck()?.hist.length ?? 1) - 1), max: histMax() }))}</span>
        <button onClick={() => setZoom(zoom() - 0.1)} title={t("v.zoomOut")}>−</button>
        <input type="range" min="10" max="300" step="5" value={Math.round(zoom() * 100)} onInput={e => setZoom(+e.currentTarget.value / 100)} />
        <button onClick={() => setZoom(zoom() + 0.1)} title={t("v.zoomIn")}>+</button>
        <button onClick={fitZoom} title={t("v.fit")} classList={{ on: fit() }}>⤢</button>
        <span class="it" style={{ width: "40px", "text-align": "right" }}>{Math.round(zoom() * 100)}%</span>
      </div>

      <Show when={menu()}>
        {(() => {
          const m = () => menu()!;
          return (
            <div class="pxe-menu" style={{ left: `${m().x}px`, top: `${m().y}px` }} onMouseDown={e => { if (!(e.target as HTMLElement).closest("input,select")) e.preventDefault(); }}>
              <Show when={m().id === "export"}>
                <MI icon="save" label={t("m.pptx")} disabled={ro()} onClick={() => void savePptx()} />
                <MI icon="txt" label={t("m.txt")} onClick={saveTxt} />
                <hr /><MI icon="download" label={t("m.source")} onClick={saveSource} />
                <MI label={t("m.new")} disabled={ro()} onClick={() => void newBlank()} />
              </Show>
              <Show when={m().id === "layout"}>
                <div class="h">{t("b.layout")}</div>
                <For each={layouts()}>{l => <MI label={l} onClick={() => view?.addSlide(l)} />}</For>
              </Show>
              <Show when={m().id === "shapes"}>
                <div class="pxe-gallery"><For each={SHAPES}>{s => <button title={s} onMouseDown={e => e.preventDefault()} onClick={() => { setMenu(null); view?.setTool({ type: "shape", preset: s }); }}><svg viewBox="0 0 40 28" width="36" height="26" innerHTML={`<path d="${shapePreview(s)}" fill="#4f81bd" stroke="#2b4a73" stroke-width="1"/>`} /></button>}</For></div>
              </Show>
              <Show when={m().id === "table"}><TblPicker /></Show>
              <Show when={m().id === "chart"}><For each={CHARTS}>{k => <MI icon="chart" label={t("c." + k)} onClick={() => view?.insertChart(k)} />}</For></Show>
              <Show when={m().id === "align"}>
                <For each={["left", "center", "right", "top", "middle", "bottom"] as const}>{a => <MI label={t("al." + a)} onClick={() => view?.alignShapes(a)} />}</For>
                <hr /><MI label={t("al.hdist")} disabled={(sel()?.count ?? 0) < 3} onClick={() => view?.alignShapes("hdist")} /><MI label={t("al.vdist")} disabled={(sel()?.count ?? 0) < 3} onClick={() => view?.alignShapes("vdist")} />
              </Show>
              <Show when={m().id === "lang"}><MI label="English" onClick={() => setLang("en")} /><MI label="Bahasa Indonesia" onClick={() => setLang("id")} /></Show>
              <Show when={m().id === "ctx-shape"}>
                <MI icon="copy" label={t("b.copy")} disabled={!hasSel()} onClick={() => view?.copy()} /><MI icon="paste" label={t("b.paste")} disabled={!edit()} onClick={() => view?.paste()} />
                <MI label={t("b.duplicate")} disabled={!hasSel()} onClick={() => view?.duplicateSelected()} />
                <hr /><MI icon="front" label={t("a.front")} disabled={!hasSel()} onClick={() => view?.zOrder("front")} /><MI icon="back" label={t("a.back")} disabled={!hasSel()} onClick={() => view?.zOrder("back")} />
                <MI icon="group" label={t("a.group")} disabled={!edit() || (sel()?.count ?? 0) < 2} onClick={() => view?.group()} /><MI label={t("a.ungroup")} disabled={!edit() || !S()?.isGroup} onClick={() => view?.ungroup()} />
                <hr /><MI icon="brush" label={t("b.painter")} disabled={!hasSel()} onClick={() => view?.startPainter()} />
                <Show when={S()?.isPicture}><MI icon="image" label={t("p.replace")} disabled={!edit()} onClick={() => replInput.click()} /></Show>
                <MI icon="link" label={t("b.link")} disabled={!hasSel()} onClick={() => { setLinkUrl(S()?.hyperlink ?? "https://"); setDialog("link"); }} />
                <hr /><MI icon="trash" label={t("p.delete")} disabled={!hasSel()} onClick={() => view?.deleteSelected()} />
              </Show>
              <Show when={m().id === "ctx-slide"}>
                <MI icon="paste" label={t("b.paste")} disabled={!edit()} onClick={() => view?.paste()} />
                <MI icon="textbox" label={t("b.textbox")} disabled={!edit()} onClick={() => view?.setTool({ type: "textbox" })} />
                <MI icon="image" label={t("b.picture")} disabled={!edit()} onClick={() => imgInput.click()} />
                <hr />{slideMenuItems()}
              </Show>
              <Show when={m().id === "ctx-thumb"}>{slideMenuItems()}<hr /><MI icon="play" label={t("b.present")} onClick={startPresent} /></Show>
            </div>
          );
        })()}
      </Show>

      <Show when={dialog() === "debug"}>
        <div class="pxe-modal-bg" onClick={e => { if (e.target === e.currentTarget) setDialog(null); }}>
          <div class="pxe-modal">
            <div class="pxe-modal-h"><Ic n="bug" /> {t("dlg.debug")}<span style={{ flex: 1 }} /><Btn icon="x" onClick={() => setDialog(null)} /></div>
            <div class="pxe-modal-b"><div class="pxe-note">{t("dlg.debugHelp")}</div><textarea class="pxe-txt" readOnly rows={22} style={{ "min-height": "320px" }} value={dbg()} /></div>
            <div class="pxe-modal-f"><Btn label={t("b.refresh")} onClick={openDebug} /><Btn label={t("b.copy")} onClick={() => { void navigator.clipboard?.writeText(dbg()); toast("toast.copied", { n: 1 }); }} /><Btn label={t("b.download")} onClick={() => downloadBlob("pptx-debug.json", new Blob([dbg()], { type: "application/json" }))} /><Btn primary label={t("b.close")} onClick={() => setDialog(null)} /></div>
          </div>
        </div>
      </Show>
      <Show when={dialog() === "link"}>
        <div class="pxe-modal-bg" onClick={e => { if (e.target === e.currentTarget) setDialog(null); }}>
          <div class="pxe-modal sm">
            <div class="pxe-modal-h"><Ic n="link" /> {t("dlg.link")}<span style={{ flex: 1 }} /><Btn icon="x" onClick={() => setDialog(null)} /></div>
            <div class="pxe-modal-b">
              <label class="pxe-field"><span>URL</span><input class="pxe-txt" value={linkUrl()} onInput={e => setLinkUrl(e.currentTarget.value)} ref={el => queueMicrotask(() => el.select())} onKeyDown={e => { if (e.key === "Enter") { view?.setHyperlink(linkUrl().trim() || null); setDialog(null); } }} /></label>
              <div class="pxe-note">{t("dlg.linkNote")}</div>
            </div>
            <div class="pxe-modal-f">
              <Show when={S()?.hyperlink}><Btn label={t("b.unlink")} onClick={() => { view?.setHyperlink(null); setDialog(null); }} /></Show>
              <Btn label={t("b.cancel")} onClick={() => setDialog(null)} />
              <Btn primary label={t("b.apply")} onClick={() => { view?.setHyperlink(linkUrl().trim() || null); setDialog(null); }} />
            </div>
          </div>
        </div>
      </Show>
      <Show when={toastMsg()}><div class="pxe-toast">{toastMsg()}</div></Show>
    </div>
  );

  function TblPicker() {
    const [hov, setHov] = createSignal({ r: 0, c: 0 });
    return (
      <div class="pxe-gridpick">
        <div class="g" onMouseLeave={() => setHov({ r: 0, c: 0 })}>
          <For each={Array.from({ length: 80 }, (_, i) => i)}>{i => { const r = Math.floor(i / 10) + 1, c = (i % 10) + 1; return <i classList={{ on: r <= hov().r && c <= hov().c }} onMouseEnter={() => setHov({ r, c })} onClick={() => { setMenu(null); view?.insertTable(r, c); }} />; }}</For>
        </div>
        <div class="cap">{hov().r ? `${hov().r} × ${hov().c}` : t("m.pickTable")}</div>
      </div>
    );
  }
}

/** Siluet kecil bentuk preset untuk galeri (jalur SVG 40×28). */
function shapePreview(p: string): string {
  const w = 40, h = 28;
  const star = (n: number) => { const cx = 20, cy = 14, R = 13, r = 6; return Array.from({ length: n * 2 }, (_, i) => { const a = (Math.PI * i) / n - Math.PI / 2, rr = i % 2 ? r : R; return `${i ? "L" : "M"}${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr * 1).toFixed(1)}`; }).join("") + "Z"; };
  const poly = (n: number) => Array.from({ length: n }, (_, i) => { const a = (Math.PI * 2 * i) / n - Math.PI / 2; return `${i ? "L" : "M"}${(20 + Math.cos(a) * 14).toFixed(1)} ${(14 + Math.sin(a) * 12).toFixed(1)}`; }).join("") + "Z";
  switch (p) {
    case "ellipse": return "M3 14a17 11 0 1 0 34 0a17 11 0 1 0-34 0Z";
    case "roundRect": return "M8 3h24a5 5 0 0 1 5 5v12a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5Z";
    case "triangle": return "M20 3L37 25H3Z"; case "rtTriangle": return "M5 3V25H35Z";
    case "diamond": return "M20 2L37 14L20 26L3 14Z"; case "parallelogram": return "M10 4H37L30 24H3Z"; case "trapezoid": return "M10 4H30L37 24H3Z";
    case "pentagon": return poly(5); case "hexagon": return poly(6); case "octagon": return poly(8);
    case "star5": return star(5); case "star6": return star(6);
    case "rightArrow": return "M3 10H24V4L37 14L24 24V18H3Z"; case "leftArrow": return "M37 10H16V4L3 14L16 24V18H37Z";
    case "upArrow": return "M14 25V12H8L20 2L32 12H26V25Z"; case "downArrow": return "M14 3V16H8L20 26L32 16H26V3Z";
    case "chevron": return "M3 3H26L37 14L26 25H3L14 14Z"; case "plus": return "M14 3H26V10H37V18H26V25H14V18H3V10H14Z";
    case "heart": return "M20 25C4 14 6 3 14 4C17 4 19 6 20 8C21 6 23 4 26 4C34 3 36 14 20 25Z";
    case "cloud": return "M11 23A6 6 0 0 1 10 11A8 8 0 0 1 25 8A7 7 0 0 1 31 21Z"; case "lightningBolt": return "M22 2L8 16H18L14 26L32 11H22Z";
    case "moon": return "M26 3A12 12 0 1 0 26 25A9 9 0 0 1 26 3Z"; case "sun": return star(12);
    case "donut": return "M3 14a17 11 0 1 0 34 0a17 11 0 1 0-34 0ZM12 14a8 5 0 1 1 16 0a8 5 0 1 1-16 0Z"; case "can": return "M6 6a14 4 0 0 1 28 0V22a14 4 0 0 1-28 0Z";
    case "cube": return "M4 9L12 3H36V19L28 25H4ZM4 9H28V25M28 9L36 3"; case "leftBracket": return "M30 3H14V25H30"; case "rightBrace": return "M12 3C20 3 18 12 24 14C18 16 20 25 12 25";
    default: return `M3 3H${w - 3}V${h - 3}H3Z`;
  }
}
