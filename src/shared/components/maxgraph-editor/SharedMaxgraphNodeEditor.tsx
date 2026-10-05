import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import {
    type Cell,
    type CellStyle,
    CompactTreeLayout,
    ConnectionHandler,
    FastOrganicLayout,
    FitPlugin,
    Graph,
    GraphDataModel,
    HierarchicalLayout,
    ImageBox,
    InternalEvent,
    KeyHandler,
    ModelXmlSerializer,
    Outline,
    PanningHandler,
    PopupMenuHandler,
    RubberBandHandler,
    ShapeRegistry,
    StencilShapeRegistry,
    UndoManager,
    constants,
    domUtils,
    getDefaultPlugins,
} from "@maxgraph/core";
import "@maxgraph/core/css/common.css"; // style yang dibutuhkan RubberBand, handle, dan popup menu
import "./SharedMaxgraphNodeEditor.css";
import { createEventBus, type EditorEventBus } from "../editor-kit/events";
import {
    DEFAULT_NODE_SIZE,
    DEFAULT_NODE_TYPES,
    EDGE_STYLE_LABELS,
    EDGE_STYLE_VALUES,
    EMPTY_MODEL_XML,
    ICONS,
    NODE_MIME,
} from "./defaults";
import {
    DrawioError,
    buildMxfile,
    detectFormat,
    exportMxGraphModel,
    htmlToPlain,
    importMxGraphModel,
    plainToHtml,
    parseDrawioFile,
    parseXml,
    sanitizeHtmlLabel,
    type DrawioImportReport,
    type DrawioPage,
} from "./drawio";
import { MaxgraphLogger } from "./logger";
import { MaxgraphHtmlLabelDialog } from "./MaxgraphHtmlLabelDialog";
import { MaxgraphDebugPanel, type DebugTab } from "./MaxgraphDebugPanel";
import { MAX_THUMBNAILS, createThumbnailer, detectShapeLibrary, readShapeLibrary, registerStencils, specToNodeType } from "./shapes";
import { exportGraphSvg } from "./svg";
import type {
    MaxgraphCellInspection,
    MaxgraphEdgeStyle,
    MaxgraphEventMap,
    MaxgraphExportFormat,
    MaxgraphInfo,
    MaxgraphLayoutKind,
    MaxgraphNodeEditorApi,
    MaxgraphNodeType,
    SharedMaxgraphNodeEditorProps,
} from "./types";

export type * from "./types";

const ICON_PATHS = {
    undo: "M3 7v6h6 M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13",
    redo: "M21 7v6h-6 M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13",
    copy: "M9 9h11v11H9z M5 15V5h10",
    paste: "M9 4h6v3H9z M7 5H5v16h14V5h-2",
    duplicate: "M8 8h12v12H8z M4 16V4h12 M14 11v6 M11 14h6",
    trash: "M3 6h18 M8 6V4h8v2 M6 6l1 14h10l1-14 M10 10v6 M14 10v6",
    zoomIn: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3 M11 8v6 M8 11h6",
    zoomOut: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3 M8 11h6",
    fit: "M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5",
    grid: "M3 3h18v18H3z M3 9h18 M3 15h18 M9 3v18 M15 3v18",
    map: "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14",
    upload: "M12 15V3 M7 8l5-5 5 5 M4 21h16",
    download: "M12 3v12 M7 10l5 5 5-5 M4 21h16",
    shapes: "M12 3l5 9H7z M3 14h8v7H3z M17 17.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
    bug: "M8 2l1.9 1.9 M14.1 3.9L16 2 M9 7.1v-1a3 3 0 1 1 6 0v1 M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z M12 20v-9 M6.5 9C4.6 8.8 3 7.1 3 5 M6 13H2 M20.97 5c0 2.1-1.6 3.8-3.5 4 M22 13h-4",
    info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01",
    group: "M3 3h18v18H3z M7 8h6v5H7z M11 12h6v5h-6z",
    ungroup: "M3 3h7v7H3z M14 14h7v7h-7z M14 3h7v7h-7z M3 14h7v7H3z",
    fullscreen: "M15 3h6v6 M9 21H3v-6 M21 3l-7 7 M3 21l7-7",
    exitFullscreen: "M4 14h6v6 M20 10h-6V4 M14 10l7-7 M3 21l7-7",
    html: "M16 18l6-6-6-6 M8 6l-6 6 6 6 M14 4l-4 16",
} as const;

const Icon = (p: { name: keyof typeof ICON_PATHS }) => (
    <svg class="mgx-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d={ICON_PATHS[p.name]} />
    </svg>
);

const Btn = (p: { icon: keyof typeof ICON_PATHS; title: string; onClick: () => void; disabled?: boolean; active?: boolean; text?: string }) => (
    <button type="button" class="mgx-btn" classList={{ "mgx-active": p.active }} title={p.title} aria-label={p.title} aria-pressed={p.active} disabled={p.disabled} onClick={() => p.onClick()}>
        <Icon name={p.icon} />
        <Show when={p.text}>
            <span>{p.text}</span>
        </Show>
    </button>
);

const buildNodeStyle = (t: MaxgraphNodeType): CellStyle => {
    if (t.kind === "shape") {
        // bentuk apa adanya (stensil / SVG): label di bawah bentuk, warna dari `style`
        return {
            fontColor: "#0f172a",
            fontSize: 12,
            strokeWidth: 1.5,
            verticalLabelPosition: "bottom",
            verticalAlign: "top",
            ...t.style,
        };
    }
    return {
        shape: t.icon ? "label" : "rectangle",
        rounded: true,
        arcSize: 22,
        strokeColor: "none",
        strokeWidth: 0,
        fillColor: t.color ?? "#475569",
        fontColor: "#ffffff",
        fontSize: 12,
        fontStyle: constants.FONT_STYLE_MASK.BOLD,
        align: "center",
        verticalAlign: "middle",
        spacing: 4,
        ...(t.icon ? { image: t.icon, imageAlign: "left", imageVerticalAlign: "middle", imageWidth: 22, imageHeight: 22 } : {}),
        ...t.style,
    };
};

const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const toKeyed = <T,>(v: T | undefined, d: T) => (v === undefined ? d : v);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface LibEntry { id: string; name: string; kind: string; count: number; stencils: number }

/** Style kelompok buatan editor: wadah bergaris putus-putus. Basis `group` (tak terlihat) sama dengan style `group` draw.io. */
const GROUP_STYLE: CellStyle = {
    baseStyleNames: ["group"],
    strokeColor: "#94a3b8",
    dashed: true,
    dashPattern: "6 4",
    fillColor: "none",
    rounded: true,
    arcSize: 4,
    align: "left",
    verticalAlign: "top",
    spacingLeft: 8,
    spacingTop: 2,
    fontSize: 11,
    fontColor: "#64748b",
    resizable: true,
};

export const SharedMaxgraphNodeEditor = (props: SharedMaxgraphNodeEditorProps) => {
    let rootEl!: HTMLDivElement;
    let canvasEl!: HTMLDivElement;
    let outlineHost: HTMLDivElement | undefined;
    let fileInput!: HTMLInputElement;
    let shapesInput!: HTMLInputElement;

    let graph: Graph | undefined;
    let api: MaxgraphNodeEditorApi | undefined;
    let undoManager: UndoManager | undefined;
    let keyHandler: KeyHandler | undefined;
    let outline: Outline | undefined;
    let lastEmittedXml: string | undefined;
    let changeTimer: ReturnType<typeof setTimeout> | undefined;
    let noticeTimer: ReturnType<typeof setTimeout> | undefined;
    let clipboard: Cell[] = [];
    let pasteCount = 0;
    let cascade = 0;
    let spaceDown = false;
    let lastScale = 1;
    let wasReadonly: boolean | undefined;
    const nativeSnaps = new Map<number, string>();
    const htmlCache = new Map<string, string>();
    const disposers: Array<() => void> = [];

    // ------------------------------------------------------------------ logger & event bus

    const logger = props.logger ?? new MaxgraphLogger({ level: props.logLevel ?? "info", console: props.consoleLog });
    const ownBus = !props.bus;
    const bus: EditorEventBus<MaxgraphEventMap> =
        props.bus ?? createEventBus<MaxgraphEventMap>({ source: "maxgraph-editor", historyIgnore: ["log"], onError: (e, t) => logger.error("events", `handler "${t}" melempar galat: ${errMsg(e)}`, e) });

    const emit = <K extends keyof MaxgraphEventMap>(type: K, payload: MaxgraphEventMap[K]) => {
        bus.emit(type, payload);
        if (api) {
            try { props.onEvent?.(type, payload, api); } catch (e) { logger.error("events", `onEvent("${type}") melempar galat: ${errMsg(e)}`, e); }
        }
    };
    let inLog = false;
    disposers.push(logger.subscribe(entry => {
        if (inLog) return; // handler "log" yang gagal tidak boleh memicu lingkaran log → event → log
        inLog = true;
        try { bus.emit("log", entry); } finally { inLog = false; }
    }));

    // ------------------------------------------------------------------ state

    const [ready, setReady] = createSignal(false);
    const [selection, setSelection] = createSignal<Cell[]>([]);
    const [canUndo, setCanUndo] = createSignal(false);
    const [canRedo, setCanRedo] = createSignal(false);
    const [zoom, setZoom] = createSignal(1);
    const [counts, setCounts] = createSignal({ nodes: 0, edges: 0 });
    const [showGrid, setShowGrid] = createSignal(toKeyed(props.grid, true));
    const [showOutline, setShowOutline] = createSignal(!!props.outline);
    const [edgeStyle, setEdgeStyle] = createSignal<MaxgraphEdgeStyle>(props.edgeStyle ?? "orthogonal");
    const [panel, setPanel] = createSignal<DebugTab | null>(props.panel ?? null);
    const [panelVer, setPanelVer] = createSignal(0);
    const [pages, setPages] = createSignal<DrawioPage[]>([{ id: "page-1", name: "Page-1", xml: "", compressed: false }]);
    const [pageIdx, setPageIdx] = createSignal(0);
    const [lastImport, setLastImport] = createSignal<DrawioImportReport | undefined>();
    const [notice, setNotice] = createSignal<{ ok: boolean; text: string } | null>(null);
    const [extraTypes, setExtraTypes] = createSignal<MaxgraphNodeType[]>([]);
    const [libs, setLibs] = createSignal<LibEntry[]>([]);
    const [full, setFull] = createSignal(false);
    const [cssFull, setCssFull] = createSignal(false);
    const [labelDlg, setLabelDlg] = createSignal<{ cell: Cell; value: string; html: boolean } | null>(null);

    const nodeTypes = createMemo(() => [...(props.nodeTypes ?? DEFAULT_NODE_TYPES), ...extraTypes()]);
    const isReadonly = () => !!props.readonly;
    const toolbar = createMemo(() => {
        const t = props.toolbar;
        if (t === false) return null;
        const o = typeof t === "object" ? t : {};
        return {
            history: o.history ?? true,
            edit: o.edit ?? true,
            zoom: o.zoom ?? true,
            edgeStyle: o.edgeStyle ?? true,
            layout: o.layout ?? true,
            view: o.view ?? true,
            io: o.io ?? true,
            shapes: o.shapes ?? true,
            group: o.group ?? true,
            fullscreen: o.fullscreen ?? true,
        };
    });
    const groups = createMemo(() => {
        const map = new Map<string, MaxgraphNodeType[]>();
        for (const t of nodeTypes()) {
            const g = t.group ?? "";
            if (!map.has(g)) map.set(g, []);
            map.get(g)!.push(t);
        }
        return [...map.entries()];
    });
    const selectedVertices = createMemo(() => selection().filter(c => c.isVertex()));
    const selectedEdges = createMemo(() => selection().filter(c => c.isEdge()));

    /** Catat galat, beri tahu aplikasi, dan tampilkan di bilah pemberitahuan. `logged` = sudah dicatat oleh `logger.trace`. */
    const fail = (e: unknown, scope = "editor", logged = false) => {
        if (!logged) logger.error(scope, errMsg(e), e);
        console.error("[maxgraph-editor]", e);
        showNotice(false, e instanceof DrawioError ? e.message : errMsg(e));
        emit("error", { scope, error: e });
        props.onError?.(e);
    };
    const showNotice = (ok: boolean, text: string) => {
        clearTimeout(noticeTimer);
        setNotice({ ok, text });
        if (ok) noticeTimer = setTimeout(() => setNotice(null), 6000);
    };

    // ------------------------------------------------------------------ helpers

    const refreshHistory = () => {
        setCanUndo(!!undoManager?.canUndo());
        setCanRedo(!!undoManager?.canRedo());
    };

    const refreshCounts = () => {
        if (!graph) return;
        const parent = graph.getDefaultParent();
        setCounts({
            nodes: graph.getChildCells(parent, true, false).length,
            edges: graph.getChildCells(parent, false, true).length,
        });
        setPanelVer(v => v + 1);
    };

    const getXml = (pretty = true) => new ModelXmlSerializer(graph!.getDataModel()).export({ pretty });

    const scheduleChange = () => {
        clearTimeout(changeTimer);
        changeTimer = setTimeout(() => {
            if (!graph) return;
            lastEmittedXml = getXml(false);
            emit("change", { xml: lastEmittedXml });
            props.onChange?.(lastEmittedXml, api!);
        }, 250);
    };

    const afterLoad = () => {
        undoManager?.clear();
        refreshHistory();
        refreshCounts();
    };

    /** Muat XML asli maxGraph. Dicoba dulu pada model cadangan sehingga XML rusak tidak mengosongkan diagram yang terbuka. */
    const loadNative = (text: string) => {
        logger.trace("import", "Muat XML asli maxGraph (GraphDataModel)", () => {
            // maxGraph tidak melempar galat untuk XML rusak (hasilnya model kosong) → periksa kebenaran XML & isi model cadangan dulu
            parseXml(text);
            const scratch = new GraphDataModel();
            new ModelXmlSerializer(scratch).import(text);
            if (!scratch.getRoot() || scratch.getRoot()!.getChildCount() === 0) throw new DrawioError("structure", "XML tidak berisi model maxGraph yang valid (tidak ada <root>/layer).");
            logger.step("import", "XML lolos uji coba pada model cadangan", true, "XML well-formed dan menghasilkan root + layer; model yang terbuka belum diubah");
            const g = graph!;
            const model = g.getDataModel();
            g.stopEditing(true);
            g.clearSelection();
            model.beginUpdate();
            try {
                model.clear();
                new ModelXmlSerializer(model).import(text);
            } finally {
                model.endUpdate();
            }
            afterLoad();
        }, { why: () => `${counts().nodes} node, ${counts().edges} garis` });
    };

    /** Muat XML apa pun: mxfile (async), mxGraphModel draw.io, atau GraphDataModel. */
    const setXml = (xml: string) => {
        const text = xml.trim() || EMPTY_MODEL_XML;
        const fmt = detectFormat(text);
        try {
            if (fmt === "mxfile") {
                void importDrawio(text, { fit: false }).catch(() => undefined); // galat sudah dicatat & ditampilkan
                return;
            }
            logger.trace("import", `setXml (${fmt})`, () => {
                if (fmt === "mxGraphModel") {
                    graph!.stopEditing(true);
                    graph!.clearSelection();
                    const { report } = importMxGraphModel(graph!, text, { logger });
                    setPages([{ id: "page-1", name: "Page-1", xml: "", compressed: false }]);
                    setPageIdx(0);
                    nativeSnaps.clear();
                    setLastImport(report);
                    afterLoad();
                    emit("import", { format: "mxGraphModel", source: "setXml", mode: "replace", report });
                    return;
                }
                loadNative(text);
                setPages([{ id: "page-1", name: pages()[0]?.name ?? "Page-1", xml: "", compressed: false }]);
                setPageIdx(0);
                nativeSnaps.clear();
                emit("import", { format: fmt === "GraphDataModel" ? "GraphDataModel" : "xml", source: "setXml", mode: "replace" });
            });
        } catch (e) {
            // diagram yang terbuka tetap utuh (impor atomik); galat dicatat oleh trace, ditampilkan di sini
            fail(e, "import", true);
        }
    };

    const resolvePage = (list: readonly DrawioPage[], ref?: number | string) => {
        if (ref === undefined) return 0;
        if (typeof ref === "number") {
            if (!Number.isInteger(ref) || ref < 0 || ref >= list.length) throw new DrawioError("structure", `Halaman ${ref} tidak ada (jumlah halaman: ${list.length}).`);
            return ref;
        }
        const i = list.findIndex(p => p.id === ref || p.name === ref);
        if (i < 0) throw new DrawioError("structure", `Halaman "${ref}" tidak ditemukan. Tersedia: ${list.map(p => p.name).join(", ")}`);
        return i;
    };

    const importDrawio: MaxgraphNodeEditorApi["importDrawio"] = async (text, o = {}) => {
        const mode = o.mode ?? "replace";
        if (isReadonly()) {
            logger.warn("import", "Impor diabaikan", "mode baca-saja aktif");
            return undefined;
        }
        try {
            return await logger.trace("import", `Impor draw.io (${mode})`, async () => {
                const file = await parseDrawioFile(text, logger);
                const g = graph!;
                if (file.format === "GraphDataModel") {
                    if (mode === "merge") throw new DrawioError("unsupported", "Mode merge hanya untuk draw.io (<mxfile>/<mxGraphModel>), bukan XML asli maxGraph.");
                    loadNative(text);
                    setPages([{ id: "page-1", name: "Page-1", xml: "", compressed: false }]);
                    setPageIdx(0);
                    nativeSnaps.clear();
                    if (o.fit !== false) fit();
                    emit("import", { format: "GraphDataModel", source: "importDrawio", mode });
                    return undefined;
                }
                const idx = resolvePage(file.pages, o.page);
                const page = file.pages[idx];
                g.stopEditing(true);
                g.clearSelection();
                const { report, cells } = importMxGraphModel(g, page.xml, {
                    mode, logger, format: file.format, pageCount: file.pages.length,
                    page: { index: idx, id: page.id, name: page.name, compressed: page.compressed },
                    dx: mode === "merge" ? 20 : 0, dy: mode === "merge" ? 20 : 0,
                });
                if (mode === "replace") {
                    setPages(file.pages.map(p => ({ ...p })));
                    setPageIdx(idx);
                    nativeSnaps.clear();
                    afterLoad();
                    if (o.fit !== false) queueMicrotask(() => graph && fit());
                } else if (cells.length) g.setSelectionCells(cells);
                setLastImport(report);
                emit("import", { format: file.format, source: "importDrawio", mode, report });
                if (mode === "replace") emit("page", { index: idx, id: page.id, name: page.name, count: file.pages.length });
                const warn = report.unknownShapes.length ? ` · bentuk tidak tersedia: ${report.unknownShapes.slice(0, 4).join(", ")}${report.unknownShapes.length > 4 ? "…" : ""}` : "";
                showNotice(true, `Impor draw.io berhasil: ${report.cells.vertices} node, ${report.cells.edges} garis${warn}.`);
                return report;
            }, { why: r => (r ? `${r.cells.vertices} node, ${r.cells.edges} garis, halaman "${r.page.name}"` : "XML asli maxGraph") });
        } catch (e) {
            fail(e, "import", true);
            throw e;
        }
    };

    const exportDrawio: MaxgraphNodeEditorApi["exportDrawio"] = o =>
        logger.trace("export", "Ekspor draw.io", async () => {
            const cur = exportMxGraphModel(graph!, { logger, pretty: o?.pretty });
            const list = pages().map((p, i) => (i === pageIdx() ? { ...p, xml: cur } : p));
            const use = o?.pages === "current" || list.length <= 1 ? [list[pageIdx()] ?? { id: "page-1", name: "Page-1", xml: cur, compressed: false }] : list;
            return buildMxfile(use, { compress: o?.compress, pretty: o?.pretty, logger });
        }, { why: r => `${r.length} karakter` });

    const setPage: MaxgraphNodeEditorApi["setPage"] = async ref => {
        const list = pages();
        const idx = resolvePage(list, ref);
        const cur = pageIdx();
        if (idx === cur) return;
        const g = graph!;
        try {
            await logger.trace("import", `Pindah ke halaman "${list[idx].name}"`, async () => {
                nativeSnaps.set(cur, getXml(false));
                const flat = exportMxGraphModel(g, {});
                setPages(l => l.map((p, i) => (i === cur ? { ...p, xml: flat } : p)));
                g.stopEditing(true);
                g.clearSelection();
                const snap = nativeSnaps.get(idx);
                if (snap) {
                    loadNative(snap);
                    logger.step("import", "Halaman dipulihkan dari salinan asli maxGraph", true, "named style & tipe node tetap terjaga");
                } else importMxGraphModel(g, list[idx].xml, { logger, applySettings: false, format: "mxfile", pageCount: list.length, page: { index: idx, id: list[idx].id, name: list[idx].name, compressed: list[idx].compressed } });
                afterLoad();
                setPageIdx(idx);
                queueMicrotask(() => graph && fit());
                emit("page", { index: idx, id: list[idx].id, name: list[idx].name, count: list.length });
            });
        } catch (e) {
            fail(e, "import", true);
            throw e;
        }
    };

    const applyEdgeStyle = (kind: MaxgraphEdgeStyle, toSelection: boolean) => {
        const g = graph!;
        const v = EDGE_STYLE_VALUES[kind];
        const def = g.getStylesheet().getDefaultEdgeStyle();
        def.edgeStyle = v.edgeStyle;
        def.curved = v.curved;
        def.rounded = v.rounded;
        if (toSelection) {
            const edges = selectedEdges();
            if (edges.length) {
                g.batchUpdate(() => {
                    g.setCellStyles("edgeStyle", v.edgeStyle ?? null, edges);
                    g.setCellStyles("curved", v.curved, edges);
                    g.setCellStyles("rounded", v.rounded, edges);
                });
            }
        }
    };

    const registerNodeTypes = () => {
        const g = graph!;
        const sheet = g.getStylesheet();
        for (const t of nodeTypes()) if (t.kind !== "fragment") sheet.putCellStyle(t.id, buildNodeStyle(t));
        g.refresh();
        logger.debug("palette", `${nodeTypes().length} jenis node didaftarkan sebagai named style`);
    };

    const snapped = (n: number) => (graph!.isGridEnabled() ? graph!.snap(n) : n);

    const addNode: MaxgraphNodeEditorApi["addNode"] = (typeId, x, y, label) => {
        const g = graph!;
        const type = nodeTypes().find(t => t.id === typeId);
        if (!type) {
            logger.warn("api", `addNode("${typeId}") diabaikan`, "jenis node tidak terdaftar");
            return null;
        }
        if (isReadonly()) {
            logger.warn("api", `addNode("${typeId}") diabaikan`, "mode baca-saja");
            return null;
        }
        const w = type.width ?? DEFAULT_NODE_SIZE.width;
        const h = type.height ?? DEFAULT_NODE_SIZE.height;
        if (x === undefined || y === undefined) {
            const c = g.container;
            const s = g.getView().scale;
            const t = g.getView().translate;
            const off = (cascade++ % 6) * 24;
            x = (c.scrollLeft + c.clientWidth / 2) / s - t.x - w / 2 + off;
            y = (c.scrollTop + c.clientHeight / 2) / s - t.y - h / 2 + off;
        }
        let cell: Cell | null = null;
        if (type.kind === "fragment" && type.fragmentXml) {
            g.batchUpdate(() => {
                const { cells } = importMxGraphModel(g, type.fragmentXml!, { mode: "merge", parent: g.getDefaultParent(), logger });
                const b = g.getBoundingBoxFromGeometry(cells, true);
                if (b) g.moveCells(cells, Math.max(0, snapped(x!)) - b.x, Math.max(0, snapped(y!)) - b.y);
                cell = cells[0] ?? null;
                if (cells.length) g.setSelectionCells(cells);
            });
            logger.step("api", `Fragmen "${type.label}" disisipkan`, !!cell, cell ? "sel dari pustaka draw.io digabung ke diagram" : "fragmen kosong");
        } else {
            g.batchUpdate(() => {
                cell = g.insertVertex({
                    parent: g.getDefaultParent(),
                    value: label ?? type.label,
                    position: [Math.max(0, snapped(x!)), Math.max(0, snapped(y!))],
                    size: [w, h],
                    style: { baseStyleNames: [type.id] },
                });
            });
            if (cell) g.setSelectionCell(cell);
        }
        if (cell) {
            logger.debug("api", `Node "${type.id}" ditambahkan`, { id: (cell as Cell).getId() });
            emit("node-added", { cell, type });
            props.onNodeAdded?.(cell, type, api!);
        }
        return cell;
    };

    const addEdge: MaxgraphNodeEditorApi["addEdge"] = (source, target, label = "") => {
        const g = graph!;
        if (isReadonly()) return null;
        if (!g.isValidConnection(source, target)) {
            logger.warn("api", "addEdge ditolak", "sambungan tidak valid (loop/duplikat/validateConnection)");
            return null;
        }
        let edge: Cell | null = null;
        g.batchUpdate(() => {
            edge = g.insertEdge({ parent: g.getDefaultParent(), value: label, source, target });
        });
        return edge;
    };

    const deleteSelection = () => {
        const g = graph!;
        if (isReadonly()) return;
        const cells = g.getDeletableCells(g.getSelectionCells());
        if (cells.length) g.removeCells(cells, true);
    };

    // ------------------------------------------------------------------ pengelompokan

    const group: MaxgraphNodeEditorApi["group"] = cells => {
        const g = graph!;
        if (isReadonly()) return null;
        const list = (cells ?? g.getSelectionCells()).filter(c => c.isVertex() || c.isEdge());
        if (list.length < 1) {
            logger.warn("api", "Kelompokkan diabaikan", "tidak ada sel yang dipilih");
            return null;
        }
        let grp: Cell | null = null;
        g.batchUpdate(() => {
            grp = g.groupCells(g.createGroupCell(list), 24, list);
            if (grp) {
                g.getDataModel().setStyle(grp, { ...GROUP_STYLE });
                grp.setValue(grp.value || "Group");
                grp.connectable = false;
            }
        });
        if (grp) {
            g.setSelectionCell(grp);
            logger.info("api", `${list.length} sel dikelompokkan`, { id: (grp as Cell).getId() });
            emit("cells-grouped", { group: grp, cells: list });
        }
        return grp;
    };

    const ungroup: MaxgraphNodeEditorApi["ungroup"] = cells => {
        const g = graph!;
        if (isReadonly()) return [];
        const targets = (cells ?? g.getSelectionCells()).filter(c => c.getChildCount() > 0 && c.isVertex());
        if (!targets.length) {
            logger.warn("api", "Pisahkan kelompok diabaikan", "sel terpilih bukan kelompok");
            return [];
        }
        let freed: Cell[] = [];
        g.batchUpdate(() => { freed = g.ungroupCells(targets) ?? []; });
        g.setSelectionCells(freed);
        logger.info("api", `${targets.length} kelompok dibubarkan`, `${freed.length} sel dilepas`);
        emit("cells-ungrouped", { cells: freed });
        return freed;
    };

    // ------------------------------------------------------------------ label (teks / HTML)

    const getLabelOf: MaxgraphNodeEditorApi["getLabel"] = cell => {
        const g = graph;
        const c = cell ?? g?.getSelectionCell();
        if (!g || !c) return undefined;
        const html = !!(g.getCellStyle(c) as Record<string, unknown>).html;
        const raw = domUtils.isNode(c.value) ? ((c.value as Element).getAttribute("label") ?? "") : c.value == null ? "" : String(c.value);
        return { value: raw, html };
    };

    const setLabelOf: MaxgraphNodeEditorApi["setLabel"] = (cell, value, opts) => {
        const g = graph!;
        if (isReadonly() || !(cell.isVertex() || cell.isEdge())) return false;
        const wasHtml = !!(g.getCellStyle(cell) as Record<string, unknown>).html;
        const html = opts?.html ?? wasHtml;
        const out = html ? sanitizeHtmlLabel(value) : value;
        g.batchUpdate(() => {
            if (html !== wasHtml) g.setCellStyles("html", html ? 1 : null, [cell]);
            g.labelChanged(cell, out);
        });
        logger.step("label", `Label ${cell.getId()} diperbarui`, true, html ? (html !== wasHtml ? "mode diubah ke HTML (html=1); isi disanitasi" : "HTML disanitasi sebelum disimpan") : (html !== wasHtml ? "mode diubah ke teks polos (html dihapus)" : "teks polos"));
        return true;
    };

    const openLabelEditor = (cell?: Cell | null) => {
        const c = cell ?? graph?.getSelectionCell();
        if (!c || isReadonly() || !(c.isVertex() || c.isEdge())) return;
        graph!.stopEditing(true);
        const l = getLabelOf(c)!;
        setLabelDlg({ cell: c, value: l.value, html: l.html });
    };

    /** Terapkan hasil dialog ke SEMUA sel terpilih bila mode diubah, atau ke sel dialog bila hanya isi yang berubah. */
    const applyLabelDialog = (value: string, html: boolean) => {
        const d = labelDlg();
        if (!d) return;
        setLabelDlg(null);
        const g = graph!;
        const sel = g.getSelectionCells().filter(c => c.isVertex() || c.isEdge());
        const targets = sel.length > 1 && sel.includes(d.cell) && html !== d.html ? sel : [d.cell];
        g.batchUpdate(() => {
            for (const c of targets) {
                if (c === d.cell) setLabelOf(c, value, { html });
                else { // sel lain: hanya konversi mode, isi masing-masing dipertahankan
                    const cur = getLabelOf(c)!;
                    setLabelOf(c, cur.html === html ? cur.value : html ? plainToHtml(cur.value) : htmlToPlain(cur.value), { html });
                }
            }
        });
        queueMicrotask(() => canvasEl?.focus({ preventScroll: true }));
    };

    // ------------------------------------------------------------------ layar penuh

    const isFull = () => !!document.fullscreenElement && document.fullscreenElement === rootEl || cssFull();
    const setFullscreen: MaxgraphNodeEditorApi["setFullscreen"] = async on => {
        if (on === isFull()) return;
        if (on) {
            try {
                if (!rootEl.requestFullscreen) throw new Error("Fullscreen API tidak tersedia");
                await rootEl.requestFullscreen();
                logger.info("ui", "Layar penuh aktif", "Fullscreen API");
            } catch (e) {
                setCssFull(true); // fallback: penuhi viewport via CSS (mis. iframe tanpa izin fullscreen)
                setFull(true);
                logger.step("ui", "Layar penuh aktif", true, `Fullscreen API ditolak (${errMsg(e)}) → mode CSS memenuhi viewport`);
            }
        } else {
            if (document.fullscreenElement === rootEl) await document.exitFullscreen().catch(() => undefined);
            setCssFull(false);
            logger.info("ui", "Layar penuh ditutup");
        }
        setFull(isFull());
        emit("fullscreen", { fullscreen: isFull() });
        requestAnimationFrame(() => graph?.refresh());
    };
    const toggleFullscreen = () => setFullscreen(!isFull());

    const copy = () => {
        const g = graph!;
        const cells = g.getExportableCells(g.getSelectionCells());
        if (!cells.length) return;
        clipboard = g.cloneCells(cells, false);
        pasteCount = 0;
    };

    const paste = () => {
        const g = graph!;
        if (isReadonly() || !clipboard.length) return;
        pasteCount++;
        const d = (g.getGridSize() || 10) * 2 * pasteCount;
        g.setSelectionCells(g.importCells(clipboard, d, d));
    };

    const duplicate = () => {
        const g = graph!;
        if (isReadonly()) return;
        const cells = g.getExportableCells(g.getSelectionCells());
        if (!cells.length) return;
        const d = (g.getGridSize() || 10) * 2;
        g.setSelectionCells(g.importCells(cells, d, d));
    };

    const nudge = (dx: number, dy: number) => {
        const g = graph!;
        if (isReadonly()) return;
        const cells = g.getMovableCells(g.getSelectionCells());
        if (cells.length) g.moveCells(cells, dx, dy);
    };

    const minZ = () => props.minZoom ?? 0.1;
    const maxZ = () => props.maxZoom ?? 8;
    let zoomAnim = 0;
    let zooming = false;

    /** Zoom ke `target` (dibatasi min/max) dengan titik di bawah kursor tetap di tempatnya. */
    const zoomAt = (target: number, clientX?: number, clientY?: number) => {
        const g = graph;
        if (!g) return;
        const view = g.getView();
        const before = view.scale;
        const s = Math.min(maxZ(), Math.max(minZ(), target));
        if (Math.abs(s - before) < 1e-6) return;
        const rect = g.container.getBoundingClientRect();
        const cx = clientX === undefined ? rect.left + g.container.clientWidth / 2 : clientX;
        const cy = clientY === undefined ? rect.top + g.container.clientHeight / 2 : clientY;
        const gx = (g.container.scrollLeft + cx - rect.left) / before - view.translate.x;
        const gy = (g.container.scrollTop + cy - rect.top) / before - view.translate.y;
        g.centerZoom = false;
        g.zoomTo(s, false);
        g.container.scrollLeft = (gx + view.translate.x) * s - (cx - rect.left);
        g.container.scrollTop = (gy + view.translate.y) * s - (cy - rect.top);
    };

    /** Zoom lewat tombol / API: animasi singkat (ease-out, interpolasi geometrik) agar tidak melompat. */
    const zoomTo = (target: number, clientX?: number, clientY?: number) => {
        const g = graph;
        if (!g) return;
        cancelAnimationFrame(zoomAnim);
        zooming = false;
        const from = g.getView().scale;
        const to = Math.min(maxZ(), Math.max(minZ(), target));
        if (props.zoomAnimation === false || typeof requestAnimationFrame !== "function" || Math.abs(to - from) < 1e-6) { zoomAt(to, clientX, clientY); return; }
        let t0 = -1;
        const dur = 140;
        zooming = true;
        const step = (now: number) => {
            if (t0 < 0) t0 = now;
            const k = Math.max(0, Math.min(1, (now - t0) / dur));
            const e = 1 - (1 - k) ** 3;
            zoomAt(from * (to / from) ** e, clientX, clientY);
            if (k < 1 && graph) zoomAnim = requestAnimationFrame(step);
            else zooming = false;
        };
        zoomAnim = requestAnimationFrame(step);
    };
    const zoomBy = (dir: 1 | -1, clientX?: number, clientY?: number) => {
        const f = props.zoomFactor ?? 1.2;
        const base = zooming ? targetZoom : graph!.getView().scale;
        targetZoom = Math.min(maxZ(), Math.max(minZ(), dir > 0 ? base * f : base / f));
        zoomTo(targetZoom, clientX, clientY);
    };
    let targetZoom = 1; // target zoom terakhir: klik beruntun saat animasi berjalan tetap akumulatif
    // roda mouse / pinch: zoom kontinu (eksponensial) per frame — mulus untuk trackpad, ±17% per ketukan roda mouse
    let wheelAcc = 0, wheelRaf = 0, wheelX = 0, wheelY = 0;
    const wheelZoom = (e: WheelEvent) => {
        const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
        wheelAcc += e.deltaY * unit;
        wheelX = e.clientX; wheelY = e.clientY;
        if (wheelRaf) return;
        wheelRaf = requestAnimationFrame(() => {
            wheelRaf = 0;
            cancelAnimationFrame(zoomAnim);
            zooming = false;
            const d = Math.max(-300, Math.min(300, wheelAcc)); // satu frame tidak boleh melonjak
            wheelAcc = 0;
            const k = 0.0016 * (props.wheelZoomSpeed ?? 1);
            zoomAt(graph!.getView().scale * Math.exp(-d * k), wheelX, wheelY);
        });
    };

    const fit = () => {
        const g = graph!;
        const plugin = g.getPlugin<FitPlugin>(FitPlugin.pluginId);
        if (g.getDefaultParent().getChildCount() === 0) {
            g.zoomActual();
            return;
        }
        plugin?.fitCenter({ margin: 24 });
    };

    const layout = (kind: MaxgraphLayoutKind) => {
        const g = graph!;
        if (isReadonly()) return;
        const parent = g.getDefaultParent();
        const model = g.getDataModel();
        model.beginUpdate();
        try {
            logger.trace("layout", `Tata letak "${kind}"`, () => {
                if (kind === "horizontal") {
                    const l = new HierarchicalLayout(g, "west");
                    l.interRankCellSpacing = 70;
                    l.intraCellSpacing = 30;
                    l.execute(parent);
                } else if (kind === "vertical") {
                    const l = new HierarchicalLayout(g, "north");
                    l.interRankCellSpacing = 50;
                    l.intraCellSpacing = 30;
                    l.execute(parent);
                } else if (kind === "tree") {
                    new CompactTreeLayout(g, true).execute(parent);
                } else {
                    const l = new FastOrganicLayout(g);
                    l.forceConstant = 140;
                    l.execute(parent);
                }
            }, { why: () => `${counts().nodes} node ditata` });
            emit("layout", { kind });
        } catch (e) {
            fail(e, "layout", true);
        } finally {
            model.endUpdate();
        }
    };

    const toSvg = () => exportGraphSvg(graph!);

    const toPngBlob = (scale = 2) =>
        new Promise<Blob>((resolve, reject) => {
            const svg = toSvg();
            const m = /width="(\d+)px" height="(\d+)px"/.exec(svg)!;
            const w = +m[1];
            const h = +m[2];
            const img = new Image();
            img.onload = () => {
                const c = document.createElement("canvas");
                c.width = w * scale;
                c.height = h * scale;
                const ctx = c.getContext("2d")!;
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, c.width, c.height);
                ctx.drawImage(img, 0, 0, c.width, c.height);
                c.toBlob(b => (b ? resolve(b) : reject(new Error("Gagal membuat PNG"))), "image/png");
            };
            img.onerror = () => reject(new Error("Gagal merender SVG"));
            img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        });

    const download: MaxgraphNodeEditorApi["download"] = (format: MaxgraphExportFormat, filename = "diagram") =>
        logger.trace("export", `Unduh ${format}`, async () => {
            let blob: Blob, name: string;
            if (format === "xml") { blob = new Blob([getXml(true)], { type: "application/xml" }); name = `${filename}.xml`; }
            else if (format === "svg") { blob = new Blob([toSvg()], { type: "image/svg+xml" }); name = `${filename}.svg`; }
            else if (format === "png") { blob = await toPngBlob(); name = `${filename}.png`; }
            else { blob = new Blob([await exportDrawio({ compress: format === "drawio-compressed" })], { type: "application/vnd.jgraph.mxfile+xml" }); name = `${filename}.drawio`; }
            downloadBlob(blob, name);
            emit("export", { format, size: blob.size, filename: name });
        }, { why: () => "berkas diserahkan ke browser" });

    // ------------------------------------------------------------------ bentuk tambahan

    const importShapes: MaxgraphNodeEditorApi["importShapes"] = async (content, o = {}) => {
        try {
            return await logger.trace("shapes", `Impor bentuk${o.fileName ? ` "${o.fileName}"` : ""}`, async () => {
                const t0 = Date.now();
                const lib = await readShapeLibrary(content, { ...o, logger });
                const keys = registerStencils(lib, logger);
                const th = createThumbnailer();
                const types: MaxgraphNodeType[] = [];
                try {
                    lib.specs.forEach((s, i) => types.push(specToNodeType(s, lib, i < MAX_THUMBNAILS ? th.render(s) : undefined)));
                } finally {
                    th.dispose();
                }
                if (lib.specs.length > MAX_THUMBNAILS) logger.step("shapes", `Thumbnail dibatasi ${MAX_THUMBNAILS} item pertama`, true, `${lib.specs.length - MAX_THUMBNAILS} item lain tampil tanpa pratinjau`);
                setExtraTypes(t => [...t, ...types]);
                setLibs(l => [...l, { id: lib.id, name: lib.name, kind: lib.kind, count: types.length, stencils: keys.length }]);
                graph?.refresh(); // sel yang memakai shape=… yang baru terdaftar digambar ulang
                const report = { id: lib.id, name: lib.name, kind: lib.kind, added: types.length, skipped: lib.skipped, keys, durationMs: Date.now() - t0 };
                emit("shapes", { action: "added", id: lib.id, name: lib.name, report });
                showNotice(true, `Pustaka "${lib.name}": ${types.length} bentuk ditambahkan${lib.skipped.length ? `, ${lib.skipped.length} dilewati` : ""}.`);
                return report;
            }, { why: r => `${r.added} bentuk (${r.kind}) ditambahkan ke palet${r.skipped.length ? `, ${r.skipped.length} dilewati` : ""}` });
        } catch (e) {
            fail(e, "shapes", true);
            throw e;
        }
    };

    const removeShapeLibrary = (id: string) => {
        const lib = libs().find(l => l.id === id);
        if (!lib) { logger.warn("shapes", `Pustaka "${id}" tidak ditemukan`); return; }
        setExtraTypes(t => t.filter(x => x.source !== id));
        setLibs(l => l.filter(x => x.id !== id));
        logger.info("shapes", `Pustaka "${lib.name}" dihapus dari palet`, "stensil tetap terdaftar di maxGraph agar diagram yang memakainya tetap tampil");
        emit("shapes", { action: "removed", id, name: lib.name });
    };

    const registerNodeType = (t: MaxgraphNodeType) => {
        setExtraTypes(l => [...l.filter(x => x.id !== t.id), t]);
        logger.debug("palette", `Jenis node "${t.id}" ditambahkan`);
    };

    /** Arahkan berkas: pustaka bentuk (stensil/SVG/mxlibrary) atau diagram. */
    const routeFile = async (file: File, force?: "shapes") => {
        try {
            const text = await file.text();
            const kind = detectShapeLibrary(text);
            logger.debug("import", `Berkas "${file.name}" (${file.size} byte) dikenali sebagai ${force === "shapes" ? "pustaka bentuk (dipilih pengguna)" : kind === "unknown" ? "diagram" : `pustaka bentuk/${kind}`}`);
            if (force === "shapes" || kind !== "unknown") await importShapes(text, { fileName: file.name });
            else await importDrawio(text);
        } catch {
            /* galat sudah dicatat & ditampilkan oleh importDrawio/importShapes */
        }
    };

    // ------------------------------------------------------------------ info & inspeksi

    const countCells = (root: Cell) => {
        let v = 0, e = 0, l = 0, total = 0;
        const visit = (c: Cell, depth: number) => {
            for (let i = 0; i < c.getChildCount(); i++) {
                const k = c.getChildAt(i);
                total++;
                if (depth === 0) l++;
                else if (k.isEdge()) e++;
                else if (k.isVertex()) v++;
                visit(k, depth + 1);
            }
        };
        visit(root, 0);
        return { vertices: v, edges: e, layers: l, total };
    };

    const getInfo = (): MaxgraphInfo | undefined => {
        const g = graph;
        if (!g) return undefined;
        const st = logger.stats();
        return {
            cells: countCells(g.getDataModel().getRoot()!),
            selection: { count: selection().length, ids: selection().map(c => String(c.getId())) },
            zoom: zoom(),
            readonly: isReadonly(),
            page: { index: pageIdx(), name: pages()[pageIdx()]?.name ?? "Page-1", count: pages().length },
            nodeTypes: nodeTypes().length,
            shapeLibraries: libs().map(l => ({ id: l.id, name: l.name, kind: l.kind, count: l.count })),
            stencils: libs().reduce((a, l) => a + l.stencils, 0),
            history: { canUndo: canUndo(), canRedo: canRedo() },
            listeners: bus.listenerCount(),
            commands: bus.commands(),
            log: { total: st.total, warn: st.warn, error: st.error, failed: st.failed },
        };
    };

    const inspect = (cell?: Cell | null): MaxgraphCellInspection | undefined => {
        const g = graph;
        const c = cell ?? g?.getSelectionCell();
        if (!g || !c) return undefined;
        const root = g.getDataModel().getRoot();
        const style = { ...(g.getCellStyle(c) as Record<string, unknown>) };
        const own = { ...(c.style as Record<string, unknown>) };
        const shapeName = String(style.shape ?? (c.isEdge() ? "connector" : "rectangle"));
        const geo = c.getGeometry();
        const parent = c.getParent();
        return {
            id: c.getId(),
            kind: c === root ? "root" : parent === root ? "layer" : c.isEdge() ? "edge" : "vertex",
            label: domUtils.isNode(c.value) ? ((c.value as Element).getAttribute("label") ?? "") : c.value == null ? "" : String(c.value),
            parent: parent?.getId() ?? null,
            ...(c.isEdge() ? { source: c.source?.getId() ?? null, target: c.target?.getId() ?? null } : {}),
            ...(geo ? { geometry: { x: geo.x, y: geo.y, width: geo.width, height: geo.height, relative: !!geo.relative, points: geo.points?.length ?? 0 } } : {}),
            style,
            ownStyle: own,
            namedStyles: Array.isArray(own.baseStyleNames) ? (own.baseStyleNames as string[]) : [],
            shape: { name: shapeName, resolved: ShapeRegistry.get(shapeName) ? "builtin" : StencilShapeRegistry.get(shapeName) ? "stencil" : "missing" },
            children: c.getChildCount(),
        };
    };

    const showPanel = (p: DebugTab | null) => {
        setPanel(p);
        logger.debug("ui", `Panel ${p ?? "ditutup"}`);
    };
    const togglePanel = (p: DebugTab) => showPanel(panel() === p ? null : p);

    // ------------------------------------------------------------------ popup menu

    const buildContextMenu: PopupMenuHandler["factoryMethod"] = (menu, cell) => {
        const g = graph!;
        const ro = isReadonly();
        if (typeof props.contextMenu === "function") {
            props.contextMenu({ graph: g, cell, menu, api: api! });
            menu.addSeparator();
        }
        if (cell && !ro) {
            if (cell.isVertex() || cell.isEdge()) menu.addItem("Ubah label", null, () => g.startEditingAtCell(cell));
            if (cell.isEdge()) {
                const sub = menu.addItem("Gaya garis", null, null);
                for (const k of Object.keys(EDGE_STYLE_VALUES) as MaxgraphEdgeStyle[]) {
                    menu.addItem(EDGE_STYLE_LABELS[k], null, () => applyEdgeStyle(k, true), sub);
                }
            }
            if (cell.isVertex()) {
                menu.addItem("Bawa ke depan", null, () => g.orderCells(false));
                menu.addItem("Kirim ke belakang", null, () => g.orderCells(true));
            }
            if (cell.isVertex() || cell.isEdge()) {
                menu.addItem("Kelola label (HTML)…", null, () => openLabelEditor(cell));
                const html = !!(g.getCellStyle(cell) as Record<string, unknown>).html;
                menu.addItem(html ? "Jadikan label teks polos" : "Jadikan label HTML", null, () => { const l = getLabelOf(cell)!; setLabelOf(cell, html ? htmlToPlain(l.value) : plainToHtml(l.value), { html: !html }); });
            }
            const sel = g.getSelectionCells();
            if (sel.length >= 1 && !sel.some(c => c.isEdge() && sel.length === 1)) menu.addItem("Kelompokkan", null, () => group(), null, null, true);
            if (cell.isVertex() && cell.getChildCount() > 0) menu.addItem("Pisahkan kelompok", null, () => ungroup([cell]));
            menu.addSeparator();
            menu.addItem("Salin", null, copy);
            menu.addItem("Duplikat", null, duplicate);
            menu.addItem(cell.isEdge() ? "Hapus garis" : "Hapus node (beserta garis)", null, deleteSelection);
            menu.addSeparator();
            menu.addItem("Periksa sel ini (Info)", null, () => showPanel("info"));
        } else if (!ro) {
            const hasClip = clipboard.length > 0;
            menu.addItem("Tempel", null, paste, null, null, hasClip);
            menu.addItem("Pilih semua", null, () => g.selectAll());
            menu.addSeparator();
        }
        menu.addItem("Pas ke layar", null, fit);
        menu.addItem("Ukuran 100%", null, () => g.zoomActual());
    };

    // ------------------------------------------------------------------ setup

    onMount(() => {
        const plugins = getDefaultPlugins();
        if (!plugins.includes(FitPlugin)) plugins.push(FitPlugin);
        plugins.push(RubberBandHandler);

        const g = new Graph(canvasEl, undefined, plugins);
        graph = g;
        const model = g.getDataModel();
        logger.info("graph", "Graph dibuat", `maxGraph, ${plugins.length} plugin`);

        // gaya dasar
        Object.assign(g.getStylesheet().getDefaultEdgeStyle(), {
            strokeColor: "#64748b",
            strokeWidth: 2,
            endArrow: "classic",
            fontColor: "#334155",
            fontSize: 11,
            labelBackgroundColor: "#ffffff",
            ...props.defaultEdgeStyle,
        });
        Object.assign(g.getStylesheet().getDefaultVertexStyle(), props.defaultNodeStyle);
        applyEdgeStyle(props.edgeStyle ?? "orthogonal", false);
        Object.assign(g.getStylesheet().getDefaultEdgeStyle(), props.defaultEdgeStyle);

        g.setDropEnabled(true);
        g.setMultigraph(false);
        g.setAllowNegativeCoordinates(false);
        g.setEnterStopsCellEditing(true);
        g.setTooltips(false);
        g.options.foldingEnabled = false;
        InternalEvent.disableContextMenu(canvasEl);
        canvasEl.tabIndex = 0;

        // label HTML ala draw.io (style html=1) — selalu disanitasi sebelum digambar
        g.isHtmlLabel = cell => !!(g.getCurrentCellStyle(cell) as Record<string, unknown>).html;
        const baseConvert = g.convertValueToString.bind(g);
        g.convertValueToString = cell => (domUtils.isNode(cell.value) ? ((cell.value as Element).getAttribute("label") ?? "") : baseConvert(cell));
        const baseGetLabel = g.getLabel.bind(g);
        g.getLabel = cell => {
            const l = baseGetLabel(cell);
            if (typeof l !== "string" || !l || !g.isHtmlLabel(cell)) return l;
            let s = htmlCache.get(l);
            if (s === undefined) {
                s = sanitizeHtmlLabel(l);
                if (htmlCache.size > 500) htmlCache.clear();
                htmlCache.set(l, s);
            }
            return s;
        };
        const baseLabelChanged = g.cellLabelChanged.bind(g);
        g.cellLabelChanged = (cell, value, autoSize) => {
            if (domUtils.isNode(cell.value)) { // nilai XML (<object>): ubah atribut label, pertahankan atribut lain
                const node = (cell.value as Element).cloneNode(true) as Element;
                node.setAttribute("label", String(value));
                value = node as never;
            }
            baseLabelChanged(cell, value, autoSize);
        };

        // "group" = style kelompok draw.io (wadah tak terlihat); kelompok buatan editor menambah garis putus-putus (GROUP_STYLE)
        g.getStylesheet().putCellStyle("group", { fillColor: "none", strokeColor: "none", verticalAlign: "top", align: "left" } as CellStyle);
        const onFsChange = () => { setFull(isFull()); if (!document.fullscreenElement && !cssFull()) emit("fullscreen", { fullscreen: false }); };
        document.addEventListener("fullscreenchange", onFsChange);
        const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape" && cssFull() && !labelDlg()) void setFullscreen(false); };
        document.addEventListener("keydown", onEsc);
        disposers.push(() => { document.removeEventListener("fullscreenchange", onFsChange); document.removeEventListener("keydown", onEsc); cancelAnimationFrame(zoomAnim); cancelAnimationFrame(wheelRaf); });

        const connection = g.getPlugin<ConnectionHandler>("ConnectionHandler");
        if (connection) connection.connectImage = new ImageBox(ICONS.connector, 16, 16);

        // sambungan valid
        const baseIsValid = g.isValidConnection.bind(g);
        g.isValidConnection = (source, target) => {
            if (!baseIsValid(source, target)) return false;
            if (source && target && props.validateConnection) return props.validateConnection(source, target, g);
            return true;
        };

        // undo / redo
        undoManager = new UndoManager(props.maxHistory ?? 100);
        const onUndoable = (_s: unknown, evt: any) => {
            undoManager!.undoableEditHappened(evt.getProperty("edit"));
            refreshHistory();
        };
        model.addListener(InternalEvent.UNDO, onUndoable);
        g.getView().addListener(InternalEvent.UNDO, onUndoable);

        // perubahan model, seleksi, zoom
        model.addListener(InternalEvent.CHANGE, (_s: unknown, evt: any) => {
            refreshCounts();
            scheduleChange();
            const edit = evt.getProperty("edit");
            emit("model-change", { changes: edit?.changes?.length ?? 0 });
        });
        g.getSelectionModel().addListener(InternalEvent.CHANGE, () => {
            const cells = g.getSelectionCells();
            setSelection(cells);
            setPanelVer(v => v + 1);
            emit("selection", { cells });
            props.onSelectionChange?.(cells, api!);
        });
        const onScale = () => {
            const s = g.getView().scale;
            setZoom(s);
            if (s !== lastScale) { lastScale = s; emit("zoom", { scale: s }); }
        };
        g.getView().addListener(InternalEvent.SCALE, onScale);
        g.getView().addListener(InternalEvent.SCALE_AND_TRANSLATE, onScale);
        g.addListener(InternalEvent.DOUBLE_CLICK, (_s: unknown, evt: any) => {
            const cell: Cell | null = evt.getProperty("cell") ?? null;
            const ev = evt.getProperty("event") as MouseEvent;
            emit("double-click", { cell, event: ev });
            if (cell) props.onCellDoubleClick?.(cell, ev, api!);
        });
        g.addListener(InternalEvent.CLICK, (_s: unknown, evt: any) => emit("click", { cell: evt.getProperty("cell") ?? null, event: evt.getProperty("event") }));
        g.addListener(InternalEvent.CELLS_ADDED, (_s: unknown, evt: any) => emit("cells-added", { cells: evt.getProperty("cells") ?? [] }));
        g.addListener(InternalEvent.CELLS_REMOVED, (_s: unknown, evt: any) => emit("cells-removed", { cells: evt.getProperty("cells") ?? [] }));
        g.addListener(InternalEvent.CELLS_MOVED, (_s: unknown, evt: any) => emit("cells-moved", { cells: evt.getProperty("cells") ?? [], dx: evt.getProperty("dx") ?? 0, dy: evt.getProperty("dy") ?? 0 }));
        g.addListener(InternalEvent.CELLS_RESIZED, (_s: unknown, evt: any) => emit("cells-resized", { cells: evt.getProperty("cells") ?? [] }));
        g.addListener(InternalEvent.LABEL_CHANGED, (_s: unknown, evt: any) => emit("label-changed", { cell: evt.getProperty("cell"), value: evt.getProperty("value"), previous: evt.getProperty("old") }));
        g.addListener(InternalEvent.CELL_CONNECTED, (_s: unknown, evt: any) => emit("edge-connected", { edge: evt.getProperty("edge"), terminal: evt.getProperty("terminal") ?? null, previous: evt.getProperty("previous") ?? null, source: !!evt.getProperty("source") }));

        // pan: tombol tengah atau spasi + drag
        const panning = g.getPlugin<PanningHandler>("PanningHandler");
        if (panning) panning.isForcePanningEvent = (me: any) => (me.getEvent() as MouseEvent).button === 1 || spaceDown;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.code === "Space" && !g.isEditing() && e.target === canvasEl) {
                spaceDown = true;
                canvasEl.classList.add("mgx-panning");
                e.preventDefault();
            }
        };
        const onKeyUp = (e: KeyboardEvent) => {
            if (e.code === "Space") {
                spaceDown = false;
                canvasEl.classList.remove("mgx-panning");
            }
        };
        canvasEl.addEventListener("keydown", onKeyDown);
        canvasEl.addEventListener("keyup", onKeyUp);
        canvasEl.addEventListener("mousedown", () => canvasEl.focus({ preventScroll: true }));

        // zoom roda mouse
        const onWheel = (e: WheelEvent) => {
            if (props.wheelZoom === false || !(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            wheelZoom(e);
        };
        canvasEl.addEventListener("wheel", onWheel, { passive: false });

        // seret dari palet / jatuhkan berkas
        const onDragOver = (e: DragEvent) => {
            if (isReadonly()) return;
            if (e.dataTransfer?.types.includes(NODE_MIME) || e.dataTransfer?.types.includes("Files")) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
            }
        };
        const onDrop = (e: DragEvent) => {
            if (isReadonly()) return;
            const files = e.dataTransfer?.files;
            if (files?.length && !e.dataTransfer?.getData(NODE_MIME)) {
                e.preventDefault();
                void (async () => { for (const f of [...files]) await routeFile(f); })();
                return;
            }
            const id = e.dataTransfer?.getData(NODE_MIME);
            if (!id) return;
            e.preventDefault();
            const type = nodeTypes().find(t => t.id === id);
            const pt = g.getPointForEvent(e as unknown as MouseEvent, false);
            addNode(id, pt.x - (type?.width ?? DEFAULT_NODE_SIZE.width) / 2, pt.y - (type?.height ?? DEFAULT_NODE_SIZE.height) / 2);
        };
        canvasEl.addEventListener("dragover", onDragOver);
        canvasEl.addEventListener("drop", onDrop);

        // pintasan keyboard
        keyHandler = new KeyHandler(g);
        keyHandler.bindKey(46, deleteSelection); // Delete
        keyHandler.bindKey(8, deleteSelection); // Backspace
        keyHandler.bindKey(113, () => {
            const c = g.getSelectionCell();
            if (c && !isReadonly()) g.startEditingAtCell(c);
        });
        const step = () => g.getGridSize() || 10;
        keyHandler.bindKey(37, () => nudge(-step(), 0));
        keyHandler.bindKey(38, () => nudge(0, -step()));
        keyHandler.bindKey(39, () => nudge(step(), 0));
        keyHandler.bindKey(40, () => nudge(0, step()));
        keyHandler.bindShiftKey(37, () => nudge(-1, 0));
        keyHandler.bindShiftKey(38, () => nudge(0, -1));
        keyHandler.bindShiftKey(39, () => nudge(1, 0));
        keyHandler.bindShiftKey(40, () => nudge(0, 1));
        keyHandler.bindControlKey(90, () => api!.undo());
        keyHandler.bindControlKey(89, () => api!.redo());
        keyHandler.bindControlShiftKey(90, () => api!.redo());
        keyHandler.bindControlKey(67, copy);
        keyHandler.bindControlKey(86, paste);
        keyHandler.bindControlKey(68, duplicate);
        keyHandler.bindControlKey(65, () => g.selectAll());
        keyHandler.bindControlKey(48, () => g.zoomActual());
        keyHandler.bindControlKey(71, () => group()); // Ctrl+G
        keyHandler.bindControlShiftKey(71, () => ungroup()); // Ctrl+Shift+G
        keyHandler.bindShiftKey(113, () => openLabelEditor()); // Shift+F2 = kelola label HTML
        keyHandler.bindControlKey(187, () => zoomBy(1)); // Ctrl + "="
        keyHandler.bindControlKey(189, () => zoomBy(-1)); // Ctrl + "-"

        api = {
            graph: g,
            getXml,
            setXml,
            clear: () => {
                if (isReadonly()) return;
                g.removeCells(g.getChildCells(g.getDefaultParent(), true, true), true);
            },
            undo: () => {
                if (isReadonly()) return;
                g.stopEditing(true);
                undoManager!.undo();
                refreshHistory();
                emit("history", { action: "undo", canUndo: canUndo(), canRedo: canRedo() });
            },
            redo: () => {
                if (isReadonly()) return;
                undoManager!.redo();
                refreshHistory();
                emit("history", { action: "redo", canUndo: canUndo(), canRedo: canRedo() });
            },
            canUndo: () => !!undoManager?.canUndo(),
            canRedo: () => !!undoManager?.canRedo(),
            zoomIn: () => zoomBy(1),
            zoomOut: () => zoomBy(-1),
            zoomActual: () => zoomTo(1),
            zoomTo,
            group,
            ungroup,
            getLabel: getLabelOf,
            setLabel: setLabelOf,
            openLabelEditor,
            setFullscreen,
            toggleFullscreen,
            isFullscreen: isFull,
            fit,
            getZoom: () => g.getView().scale,
            addNode,
            addEdge,
            getSelection: () => g.getSelectionCells(),
            selectAll: () => g.selectAll(),
            deleteSelection,
            copy,
            paste,
            duplicate,
            layout,
            toSvg,
            toPngBlob,
            download,
            exportDrawio,
            importDrawio,
            getPages: () => pages(),
            setPage,
            importShapes,
            removeShapeLibrary,
            listShapeLibraries: () => libs().map(l => ({ id: l.id, name: l.name, kind: l.kind, count: l.count })),
            registerNodeType,
            getNodeTypes: () => nodeTypes(),
            events: bus,
            on: bus.on,
            off: bus.off,
            once: bus.once,
            run: (name, ...args) => bus.run(name, ...args),
            logger,
            getInfo: () => getInfo()!,
            inspect,
            showPanel: p => showPanel(p),
        };

        // perintah bernama untuk bus.run(...) dan CustomEvent "maxgraph-editor:command"
        const cmds: Record<string, (...a: any[]) => unknown> = {
            undo: () => api!.undo(), redo: () => api!.redo(), zoomIn: () => api!.zoomIn(), zoomOut: () => api!.zoomOut(), zoomActual: () => g.zoomActual(), fit,
            clear: () => api!.clear(), selectAll: () => g.selectAll(), deleteSelection, copy, paste, duplicate,
            layout: (k: MaxgraphLayoutKind) => layout(k),
            addNode: (t: string, x?: number, y?: number, label?: string) => addNode(t, x, y, label),
            group: (ids?: string[]) => group(ids?.map(i => model.getCell(i)).filter((c): c is Cell => !!c)),
            ungroup: (ids?: string[]) => ungroup(ids?.map(i => model.getCell(i)).filter((c): c is Cell => !!c)),
            setLabel: (id: string, v: string, o?: { html?: boolean }) => { const c = model.getCell(id); if (!c) throw new Error(`setLabel: sel "${id}" tidak ditemukan`); return setLabelOf(c, v, o); },
            getLabel: (id?: string) => getLabelOf(id ? model.getCell(id) : undefined),
            openLabelEditor: (id?: string) => openLabelEditor(id ? model.getCell(id) : undefined),
            zoomTo: (s: number) => zoomTo(s),
            setFullscreen: (on: boolean) => setFullscreen(on),
            toggleFullscreen: () => toggleFullscreen(),
            addEdge: (s: string, t: string, label?: string) => {
                const a = model.getCell(s), b = model.getCell(t);
                if (!a || !b) throw new Error(`addEdge: sel "${!a ? s : t}" tidak ditemukan`);
                return addEdge(a, b, label);
            },
            select: (ids: string[]) => g.setSelectionCells(ids.map(i => model.getCell(i)).filter((c): c is Cell => !!c)),
            getXml: (pretty?: boolean) => getXml(pretty), setXml: (x: string) => setXml(x),
            importDrawio: (x: string, o?: object) => importDrawio(x, o), exportDrawio: (o?: object) => exportDrawio(o),
            importShapes: (c: string, o?: object) => importShapes(c, o), removeShapeLibrary,
            setPage: (r: number | string) => setPage(r), getPages: () => pages(),
            download: (f: MaxgraphExportFormat, n?: string) => download(f, n),
            toSvg, getInfo: () => getInfo(), inspect: (id?: string) => inspect(id ? model.getCell(id) : undefined),
            getLogs: (f?: object) => logger.entries(f), clearLogs: () => logger.clear(), setLogLevel: (l: "debug" | "info" | "warn" | "error") => logger.setLevel(l),
            showPanel: (p: DebugTab | null) => showPanel(p),
            registerNodeType: (t: MaxgraphNodeType) => registerNodeType(t),
        };
        for (const [n, fn] of Object.entries(cmds)) disposers.push(bus.registerCommand(n, fn));
        disposers.push(bus.attach(rootEl));

        registerNodeTypes();
        setXml(props.xml ?? EMPTY_MODEL_XML);
        lastEmittedXml = props.xml;
        lastScale = g.getView().scale;
        setReady(true);
        logger.info("graph", "Editor siap", `${counts().nodes} node, ${counts().edges} garis`);
        emit("ready", { api });
        props.onReady?.(api);

        if (props.shapeLibraries?.length) {
            void (async () => {
                for (const l of props.shapeLibraries!) await importShapes(l.content, { name: l.name }).catch(() => undefined);
            })();
        }

        onCleanup(() => {
            clearTimeout(changeTimer);
            clearTimeout(noticeTimer);
            emit("destroy", {});
            canvasEl.removeEventListener("keydown", onKeyDown);
            canvasEl.removeEventListener("keyup", onKeyUp);
            canvasEl.removeEventListener("wheel", onWheel);
            canvasEl.removeEventListener("dragover", onDragOver);
            canvasEl.removeEventListener("drop", onDrop);
            disposers.forEach(d => d());
            if (ownBus) bus.clear();
            outline?.destroy();
            keyHandler?.onDestroy();
            g.destroy();
            graph = undefined;
        });
    });

    // ------------------------------------------------------------------ reaktif terhadap props

    createEffect(on([ready, nodeTypes], () => ready() && registerNodeTypes(), { defer: true }));

    createEffect(
        on(
            () => props.xml,
            xml => {
                if (ready() && xml !== undefined && xml !== lastEmittedXml) {
                    try { setXml(xml); } catch { /* sudah dicatat & ditampilkan; diagram lama tetap */ }
                    lastEmittedXml = xml;
                }
            },
            { defer: true },
        ),
    );

    createEffect(() => {
        if (!ready()) return;
        const g = graph!;
        const ro = isReadonly();
        g.setCellsLocked(ro);
        g.setCellsDeletable(!ro);
        g.setCellsDisconnectable(!ro);
        g.setCellsEditable(!ro && props.labelEditable !== false);
        g.setConnectable(!ro && props.connectable !== false);
        g.setDropEnabled(!ro);
        g.setAllowLoops(!!props.allowLoops);
        g.setAllowDanglingEdges(!!props.allowDanglingEdges);
        g.setMultigraph(!!props.multigraph);
        g.setPanning(props.panning !== false);
        g.zoomFactor = props.zoomFactor ?? 1.2;
        g.setGridSize(props.gridSize ?? 10);
        g.setGridEnabled(showGrid());
        g.getPlugin<RubberBandHandler>("RubberBandHandler")?.setEnabled(props.rubberband !== false);
        g.getPlugin<PopupMenuHandler>("PopupMenuHandler")!.factoryMethod = props.contextMenu === false ? undefined : buildContextMenu;
        keyHandler?.setEnabled(props.keyboard !== false);
        if (ro) g.stopEditing(true);
        if (wasReadonly !== undefined && wasReadonly !== ro) emit("readonly", { readonly: ro });
        wasReadonly = ro;
    });

    createEffect(() => {
        if (!ready()) return;
        const size = (props.gridSize ?? 10) * zoom();
        canvasEl.style.backgroundSize = showGrid() ? `${size}px ${size}px` : "";
        canvasEl.classList.toggle("mgx-grid", showGrid());
    });

    createEffect(on(() => props.outline, v => setShowOutline(!!v), { defer: true }));
    createEffect(() => {
        if (!ready()) return;
        outline?.destroy();
        outline = undefined;
        if (showOutline() && outlineHost) outline = new Outline(graph!, outlineHost);
    });

    createEffect(on(() => props.edgeStyle, v => v && (setEdgeStyle(v), ready() && applyEdgeStyle(v, false)), { defer: true }));
    createEffect(on(() => props.logLevel, l => l && logger.setLevel(l), { defer: true }));
    createEffect(on(() => props.panel, p => p !== undefined && setPanel(p), { defer: true }));

    // ------------------------------------------------------------------ UI

    const onPaletteDragStart = (e: DragEvent, t: MaxgraphNodeType) => {
        e.dataTransfer?.setData(NODE_MIME, t.id);
        e.dataTransfer?.setData("text/plain", t.label);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
    };

    const fillOf = () => {
        const v = selectedVertices()[0];
        const c = v ? graph?.getCurrentCellStyle(v).fillColor : undefined;
        return typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c : "#ffffff";
    };

    const rootStyle = () => ({
        height: typeof props.height === "number" ? `${props.height}px` : (props.height ?? "100%"),
        ...props.style,
    });

    const tb = toolbar;

    return (
        <div ref={rootEl} class={`mgx-root ${props.class ?? ""}`} classList={{ "mgx-full": full() }} style={full() ? { ...rootStyle(), height: "100vh" } : rootStyle()}>
            <Show when={tb()}>
                {t => (
                    <div class="mgx-toolbar" role="toolbar" aria-label="Toolbar diagram">
                        <Show when={t().history}>
                            <div class="mgx-group">
                                <Btn icon="undo" title="Urungkan (Ctrl+Z)" onClick={() => api?.undo()} disabled={!canUndo() || isReadonly()} />
                                <Btn icon="redo" title="Ulangi (Ctrl+Y)" onClick={() => api?.redo()} disabled={!canRedo() || isReadonly()} />
                            </div>
                        </Show>
                        <Show when={t().edit}>
                            <div class="mgx-group">
                                <Btn icon="copy" title="Salin (Ctrl+C)" onClick={copy} disabled={!selection().length} />
                                <Btn icon="paste" title="Tempel (Ctrl+V)" onClick={paste} disabled={isReadonly() || !ready()} />
                                <Btn icon="duplicate" title="Duplikat (Ctrl+D)" onClick={duplicate} disabled={isReadonly() || !selection().length} />
                                <Btn icon="trash" title="Hapus (Del)" onClick={deleteSelection} disabled={isReadonly() || !selection().length} />
                                <Show when={t().group}>
                                    <Btn icon="group" title="Kelompokkan sel terpilih (Ctrl+G)" onClick={() => group()} disabled={isReadonly() || !selection().length} />
                                    <Btn icon="ungroup" title="Pisahkan kelompok (Ctrl+Shift+G)" onClick={() => ungroup()} disabled={isReadonly() || !selection().some(c => c.isVertex() && c.getChildCount() > 0)} />
                                </Show>
                                <Btn icon="html" title="Kelola label: teks polos / HTML (Shift+F2)" onClick={() => openLabelEditor()} disabled={isReadonly() || selection().length < 1} />
                                <Show when={selectedVertices().length && !isReadonly()}>
                                    <label class="mgx-color" title="Warna node terpilih">
                                        <input
                                            type="color"
                                            value={fillOf()}
                                            onChange={e => graph!.setCellStyles("fillColor", e.currentTarget.value, selectedVertices())}
                                        />
                                    </label>
                                </Show>
                            </div>
                        </Show>
                        <Show when={t().zoom}>
                            <div class="mgx-group">
                                <Btn icon="zoomOut" title="Perkecil" onClick={() => api?.zoomOut()} disabled={!ready()} />
                                <button type="button" class="mgx-btn mgx-zoom" title="Ukuran 100% (Ctrl+0)" onClick={() => api?.zoomActual()}>
                                    {Math.round(zoom() * 100)}%
                                </button>
                                <Btn icon="zoomIn" title="Perbesar" onClick={() => api?.zoomIn()} disabled={!ready()} />
                                <Btn icon="fit" title="Pas ke layar" onClick={fit} disabled={!ready()} />
                            </div>
                        </Show>
                        <Show when={t().edgeStyle && !isReadonly()}>
                            <div class="mgx-group">
                                <select
                                    class="mgx-select"
                                    title="Gaya garis (garis terpilih dan garis baru)"
                                    value={edgeStyle()}
                                    onChange={e => {
                                        const k = e.currentTarget.value as MaxgraphEdgeStyle;
                                        setEdgeStyle(k);
                                        applyEdgeStyle(k, true);
                                    }}
                                >
                                    <For each={Object.keys(EDGE_STYLE_VALUES) as MaxgraphEdgeStyle[]}>{k => <option value={k}>{EDGE_STYLE_LABELS[k]}</option>}</For>
                                </select>
                            </div>
                        </Show>
                        <Show when={t().layout && !isReadonly()}>
                            <div class="mgx-group">
                                <select
                                    class="mgx-select"
                                    title="Tata letak otomatis"
                                    value=""
                                    onChange={e => {
                                        const k = e.currentTarget.value as MaxgraphLayoutKind;
                                        e.currentTarget.value = "";
                                        if (k) layout(k);
                                    }}
                                >
                                    <option value="">Tata letak…</option>
                                    <option value="horizontal">Hierarki horizontal</option>
                                    <option value="vertical">Hierarki vertikal</option>
                                    <option value="tree">Pohon</option>
                                    <option value="organic">Organik</option>
                                </select>
                            </div>
                        </Show>
                        <Show when={t().view}>
                            <div class="mgx-group">
                                <Btn icon="grid" title="Tampilkan grid & snap" active={showGrid()} onClick={() => setShowGrid(v => !v)} />
                                <Btn icon="map" title="Minimap" active={showOutline()} onClick={() => setShowOutline(v => !v)} />
                            </div>
                        </Show>
                        <Show when={pages().length > 1}>
                            <div class="mgx-group">
                                <select
                                    class="mgx-select"
                                    title="Halaman diagram draw.io"
                                    value={String(pageIdx())}
                                    onChange={e => setPage(Number(e.currentTarget.value)).catch(() => undefined)}
                                >
                                    <For each={pages()}>{(p, i) => <option value={String(i())}>{p.name}</option>}</For>
                                </select>
                            </div>
                        </Show>
                        <Show when={t().io || t().shapes || props.debugTools !== false}>
                            <div class="mgx-group mgx-push">
                                <Show when={t().io && !isReadonly()}>
                                    <Btn icon="upload" title="Impor diagram (draw.io .drawio/.xml atau XML maxGraph)" onClick={() => fileInput.click()} />
                                </Show>
                                <Show when={t().shapes && !isReadonly()}>
                                    <Btn icon="shapes" title="Impor bentuk tambahan (stensil .xml, .svg, pustaka draw.io)" onClick={() => shapesInput.click()} />
                                </Show>
                                <Show when={t().io}>
                                    <select
                                        class="mgx-select"
                                        title="Ekspor diagram"
                                        value=""
                                        onChange={e => {
                                            const f = e.currentTarget.value as MaxgraphExportFormat;
                                            e.currentTarget.value = "";
                                            if (f) download(f).catch(() => undefined);
                                        }}
                                    >
                                        <option value="">Ekspor…</option>
                                        <option value="drawio">draw.io (.drawio)</option>
                                        <option value="drawio-compressed">draw.io terkompresi</option>
                                        <option value="xml">XML maxGraph (.xml)</option>
                                        <option value="svg">SVG (.svg)</option>
                                        <option value="png">PNG (.png)</option>
                                    </select>
                                </Show>
                                <Show when={t().fullscreen}>
                                    <Btn icon={full() ? "exitFullscreen" : "fullscreen"} title={full() ? "Keluar layar penuh (Esc)" : "Layar penuh"} active={full()} onClick={() => void toggleFullscreen()} />
                                </Show>
                                <Show when={props.debugTools !== false}>
                                    <Btn icon="bug" title="Log penelusuran (apa yang berhasil dan kenapa)" active={panel() === "log"} onClick={() => togglePanel("log")} />
                                    <Btn icon="info" title="Info diagram & inspeksi sel" active={panel() === "info"} onClick={() => togglePanel("info")} />
                                </Show>
                            </div>
                        </Show>
                    </div>
                )}
            </Show>

            <div class="mgx-body">
                <Show when={props.palette !== false && !isReadonly()}>
                    <aside class="mgx-palette" aria-label="Palet node">
                        <div class="mgx-palette-title">{props.paletteTitle ?? "Node"}</div>
                        <For each={groups()}>
                            {([group, items]) => (
                                <>
                                    <Show when={group}>
                                        <div class="mgx-palette-group">{group}</div>
                                    </Show>
                                    <div class="mgx-palette-grid">
                                        <For each={items}>
                                            {t => (
                                                <div
                                                    class="mgx-palette-item"
                                                    draggable={true}
                                                    tabIndex={0}
                                                    title={`${t.label} — seret ke kanvas, atau klik ganda / Enter untuk menambah`}
                                                    onDragStart={e => onPaletteDragStart(e, t)}
                                                    onDblClick={() => api?.addNode(t.id)}
                                                    onKeyDown={e => e.key === "Enter" && api?.addNode(t.id)}
                                                >
                                                    <span class="mgx-palette-chip" classList={{ "mgx-thumb": !!t.kind && t.kind !== "card" }} style={{ background: t.color ?? "#475569" }}>
                                                        <Show when={t.icon}>
                                                            <img src={t.icon} alt="" draggable={false} />
                                                        </Show>
                                                    </span>
                                                    <span class="mgx-palette-label">{t.label}</span>
                                                </div>
                                            )}
                                        </For>
                                    </div>
                                </>
                            )}
                        </For>
                    </aside>
                </Show>

                <div class="mgx-canvas-wrap">
                    <div ref={canvasEl} class="mgx-canvas" />
                    <Show when={showOutline()}>
                        <div ref={el => (outlineHost = el)} class="mgx-outline" />
                    </Show>
                </div>
            </div>

            <Show when={panel()}>
                {p => (
                    <MaxgraphDebugPanel
                        tab={p()}
                        onTab={showPanel}
                        onClose={() => showPanel(null)}
                        logger={logger}
                        bus={bus}
                        getInfo={getInfo}
                        inspectSelection={() => inspect()}
                        lastImport={lastImport}
                        version={panelVer}
                    />
                )}
            </Show>

            <Show when={notice()}>
                {n => (
                    <div class="mgx-notice" classList={{ "mgx-notice-ok": n().ok }} role={n().ok ? "status" : "alert"}>
                        <span class="mgx-notice-text">{n().text}</span>
                        <Show when={!n().ok}>
                            <button type="button" class="mgx-btn mgx-txt" onClick={() => showPanel("log")}>Lihat log</button>
                        </Show>
                        <button type="button" class="mgx-btn mgx-txt" aria-label="Tutup pemberitahuan" onClick={() => setNotice(null)}>✕</button>
                    </div>
                )}
            </Show>

            <Show when={props.statusBar !== false}>
                <div class="mgx-status">
                    <span>{counts().nodes} node</span>
                    <span>{counts().edges} garis</span>
                    <Show when={selection().length}>
                        <span>{selection().length} terpilih</span>
                    </Show>
                    <Show when={isReadonly()}>
                        <span class="mgx-badge">baca-saja</span>
                    </Show>
                    <span class="mgx-hint">Ctrl + roda = zoom · spasi/tombol tengah + seret = geser · klik kanan = menu</span>
                </div>
            </Show>

            <Show when={labelDlg()}>
                {d => (
                    <MaxgraphHtmlLabelDialog
                        value={d().value}
                        html={d().html}
                        title={d().cell.getId() ? `#${d().cell.getId()}` : undefined}
                        onApply={applyLabelDialog}
                        onCancel={() => { setLabelDlg(null); queueMicrotask(() => canvasEl?.focus({ preventScroll: true })); }}
                    />
                )}
            </Show>

            <input
                ref={fileInput}
                type="file"
                accept=".xml,.drawio,.dio,.mxfile,.svg,.mxlibrary,text/xml,application/xml,image/svg+xml"
                hidden
                onChange={e => {
                    const f = e.currentTarget.files?.[0];
                    e.currentTarget.value = "";
                    if (f) void routeFile(f);
                }}
            />
            <input
                ref={shapesInput}
                type="file"
                multiple
                accept=".xml,.svg,.mxlibrary,.json,.txt,text/xml,application/xml,image/svg+xml"
                hidden
                onChange={e => {
                    const files = [...(e.currentTarget.files ?? [])];
                    e.currentTarget.value = "";
                    void (async () => { for (const f of files) await routeFile(f, "shapes"); })();
                }}
            />
        </div>
    );
};

export default SharedMaxgraphNodeEditor;
