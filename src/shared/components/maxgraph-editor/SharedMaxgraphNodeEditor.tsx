import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import {
    type Cell,
    type CellStyle,
    CompactTreeLayout,
    ConnectionHandler,
    FastOrganicLayout,
    FitPlugin,
    Graph,
    HierarchicalLayout,
    ImageBox,
    ImageExport,
    InternalEvent,
    KeyHandler,
    ModelXmlSerializer,
    Outline,
    PanningHandler,
    PopupMenuHandler,
    RubberBandHandler,
    SvgCanvas2D,
    UndoManager,
    constants,
    getDefaultPlugins,
    xmlUtils,
} from "@maxgraph/core";
import "@maxgraph/core/css/common.css"; // style yang dibutuhkan RubberBand, handle, dan popup menu
import "./SharedMaxgraphNodeEditor.css";
import {
    DEFAULT_NODE_SIZE,
    DEFAULT_NODE_TYPES,
    EDGE_STYLE_LABELS,
    EDGE_STYLE_VALUES,
    EMPTY_MODEL_XML,
    ICONS,
    NODE_MIME,
} from "./defaults";
import type {
    MaxgraphEdgeStyle,
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

const buildNodeStyle = (t: MaxgraphNodeType): CellStyle => ({
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
});

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

export const SharedMaxgraphNodeEditor = (props: SharedMaxgraphNodeEditorProps) => {
    let canvasEl!: HTMLDivElement;
    let outlineHost: HTMLDivElement | undefined;
    let fileInput!: HTMLInputElement;

    let graph: Graph | undefined;
    let api: MaxgraphNodeEditorApi | undefined;
    let undoManager: UndoManager | undefined;
    let keyHandler: KeyHandler | undefined;
    let outline: Outline | undefined;
    let lastEmittedXml: string | undefined;
    let changeTimer: ReturnType<typeof setTimeout> | undefined;
    let clipboard: Cell[] = [];
    let pasteCount = 0;
    let cascade = 0;
    let spaceDown = false;
    const disposers: Array<() => void> = [];

    const [ready, setReady] = createSignal(false);
    const [selection, setSelection] = createSignal<Cell[]>([]);
    const [canUndo, setCanUndo] = createSignal(false);
    const [canRedo, setCanRedo] = createSignal(false);
    const [zoom, setZoom] = createSignal(1);
    const [counts, setCounts] = createSignal({ nodes: 0, edges: 0 });
    const [showGrid, setShowGrid] = createSignal(toKeyed(props.grid, true));
    const [showOutline, setShowOutline] = createSignal(!!props.outline);
    const [edgeStyle, setEdgeStyle] = createSignal<MaxgraphEdgeStyle>(props.edgeStyle ?? "orthogonal");

    const nodeTypes = createMemo(() => props.nodeTypes ?? DEFAULT_NODE_TYPES);
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

    const fail = (e: unknown) => {
        console.error("[maxgraph-editor]", e);
        props.onError?.(e);
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
    };

    const getXml = (pretty = true) => new ModelXmlSerializer(graph!.getDataModel()).export({ pretty });

    const scheduleChange = () => {
        if (!props.onChange) return;
        clearTimeout(changeTimer);
        changeTimer = setTimeout(() => {
            lastEmittedXml = getXml(false);
            props.onChange?.(lastEmittedXml, api!);
        }, 250);
    };

    const setXml = (xml: string) => {
        const g = graph!;
        const model = g.getDataModel();
        g.stopEditing(true);
        g.clearSelection();
        model.beginUpdate();
        try {
            model.clear();
            new ModelXmlSerializer(model).import(xml.trim() || EMPTY_MODEL_XML);
        } catch (e) {
            fail(e);
        } finally {
            model.endUpdate();
        }
        undoManager?.clear();
        refreshHistory();
        refreshCounts();
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
        for (const t of nodeTypes()) sheet.putCellStyle(t.id, buildNodeStyle(t));
        g.refresh();
    };

    const snapped = (n: number) => (graph!.isGridEnabled() ? graph!.snap(n) : n);

    const addNode: MaxgraphNodeEditorApi["addNode"] = (typeId, x, y, label) => {
        const g = graph!;
        const type = nodeTypes().find(t => t.id === typeId);
        if (!type || isReadonly()) return null;
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
        g.batchUpdate(() => {
            cell = g.insertVertex({
                parent: g.getDefaultParent(),
                value: label ?? type.label,
                position: [Math.max(0, snapped(x!)), Math.max(0, snapped(y!))],
                size: [w, h],
                style: { baseStyleNames: [type.id] },
            });
        });
        if (cell) {
            g.setSelectionCell(cell);
            props.onNodeAdded?.(cell, type, api!);
        }
        return cell;
    };

    const addEdge: MaxgraphNodeEditorApi["addEdge"] = (source, target, label = "") => {
        const g = graph!;
        if (isReadonly() || !g.isValidConnection(source, target)) return null;
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

    const zoomBy = (dir: 1 | -1, clientX?: number, clientY?: number) => {
        const g = graph!;
        const view = g.getView();
        const before = view.scale;
        const rect = g.container.getBoundingClientRect();
        const cx = clientX === undefined ? rect.left + g.container.clientWidth / 2 : clientX;
        const cy = clientY === undefined ? rect.top + g.container.clientHeight / 2 : clientY;
        // titik graph di bawah kursor sebelum zoom, agar tetap di bawah kursor setelah zoom
        const gx = (g.container.scrollLeft + cx - rect.left) / before - view.translate.x;
        const gy = (g.container.scrollTop + cy - rect.top) / before - view.translate.y;
        g.centerZoom = false;
        if (dir > 0) g.zoomIn();
        else g.zoomOut();
        const s = view.scale;
        g.container.scrollLeft = (gx + view.translate.x) * s - (cx - rect.left);
        g.container.scrollTop = (gy + view.translate.y) * s - (cy - rect.top);
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
        } catch (e) {
            fail(e);
        } finally {
            model.endUpdate();
        }
    };

    const toSvg = () => {
        const g = graph!;
        const view = g.getView();
        const scale = view.scale;
        const border = 24;
        const bounds = g.getGraphBounds();
        const w = Math.max(1, Math.ceil(bounds.width / scale)) + border * 2;
        const h = Math.max(1, Math.ceil(bounds.height / scale)) + border * 2;
        const doc = xmlUtils.createXmlDocument();
        const root = doc.createElementNS(constants.NS_SVG, "svg");
        root.setAttribute("xmlns", constants.NS_SVG);
        root.setAttribute("width", `${w}px`);
        root.setAttribute("height", `${h}px`);
        root.setAttribute("viewBox", `0 0 ${w} ${h}`);
        const canvas = new SvgCanvas2D(root, false);
        canvas.scale(1 / scale);
        canvas.translate(-bounds.x + border * scale, -bounds.y + border * scale);
        const state = view.getState(g.getDataModel().getRoot()!);
        if (state) new ImageExport().drawState(state, canvas);
        return new XMLSerializer().serializeToString(root);
    };

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

    const download: MaxgraphNodeEditorApi["download"] = async (format, filename = "diagram") => {
        if (format === "xml") downloadBlob(new Blob([getXml(true)], { type: "application/xml" }), `${filename}.xml`);
        else if (format === "svg") downloadBlob(new Blob([toSvg()], { type: "image/svg+xml" }), `${filename}.svg`);
        else downloadBlob(await toPngBlob(), `${filename}.png`);
    };

    const onFilePicked = async (e: Event) => {
        const input = e.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        input.value = "";
        if (!file) return;
        try {
            setXml(await file.text());
            fit();
        } catch (err) {
            fail(err);
        }
    };

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
            menu.addSeparator();
            menu.addItem("Salin", null, copy);
            menu.addItem("Duplikat", null, duplicate);
            menu.addItem(cell.isEdge() ? "Hapus garis" : "Hapus node (beserta garis)", null, deleteSelection);
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
        model.addListener(InternalEvent.CHANGE, () => {
            refreshCounts();
            scheduleChange();
        });
        g.getSelectionModel().addListener(InternalEvent.CHANGE, () => {
            const cells = g.getSelectionCells();
            setSelection(cells);
            props.onSelectionChange?.(cells, api!);
        });
        const onScale = () => setZoom(g.getView().scale);
        g.getView().addListener(InternalEvent.SCALE, onScale);
        g.getView().addListener(InternalEvent.SCALE_AND_TRANSLATE, onScale);
        g.addListener(InternalEvent.DOUBLE_CLICK, (_s: unknown, evt: any) => {
            const cell: Cell | null = evt.getProperty("cell");
            if (cell) props.onCellDoubleClick?.(cell, evt.getProperty("event"), api!);
        });

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
            zoomBy(e.deltaY < 0 ? 1 : -1, e.clientX, e.clientY);
        };
        canvasEl.addEventListener("wheel", onWheel, { passive: false });

        // seret dari palet
        const onDragOver = (e: DragEvent) => {
            if (!isReadonly() && e.dataTransfer?.types.includes(NODE_MIME)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
            }
        };
        const onDrop = (e: DragEvent) => {
            const id = e.dataTransfer?.getData(NODE_MIME);
            if (!id || isReadonly()) return;
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
            },
            redo: () => {
                if (isReadonly()) return;
                undoManager!.redo();
                refreshHistory();
            },
            canUndo: () => !!undoManager?.canUndo(),
            canRedo: () => !!undoManager?.canRedo(),
            zoomIn: () => zoomBy(1),
            zoomOut: () => zoomBy(-1),
            zoomActual: () => g.zoomActual(),
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
        };

        registerNodeTypes();
        setXml(props.xml ?? EMPTY_MODEL_XML);
        lastEmittedXml = props.xml;
        setReady(true);
        props.onReady?.(api);

        onCleanup(() => {
            clearTimeout(changeTimer);
            canvasEl.removeEventListener("keydown", onKeyDown);
            canvasEl.removeEventListener("keyup", onKeyUp);
            canvasEl.removeEventListener("wheel", onWheel);
            canvasEl.removeEventListener("dragover", onDragOver);
            canvasEl.removeEventListener("drop", onDrop);
            disposers.forEach(d => d());
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
                    setXml(xml);
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
        <div class={`mgx-root ${props.class ?? ""}`} style={rootStyle()}>
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
                        <Show when={t().io}>
                            <div class="mgx-group mgx-push">
                                <Show when={!isReadonly()}>
                                    <Btn icon="upload" title="Impor XML mxGraphModel" onClick={() => fileInput.click()} />
                                </Show>
                                <select
                                    class="mgx-select"
                                    title="Ekspor diagram"
                                    value=""
                                    onChange={e => {
                                        const f = e.currentTarget.value as "xml" | "svg" | "png";
                                        e.currentTarget.value = "";
                                        if (f) download(f).catch(fail);
                                    }}
                                >
                                    <option value="">Ekspor…</option>
                                    <option value="xml">XML (.xml)</option>
                                    <option value="svg">SVG (.svg)</option>
                                    <option value="png">PNG (.png)</option>
                                </select>
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
                                                    <span class="mgx-palette-chip" style={{ background: t.color ?? "#475569" }}>
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

            <input ref={fileInput} type="file" accept=".xml,.drawio,.mxfile,text/xml,application/xml" hidden onChange={onFilePicked} />
        </div>
    );
};

export default SharedMaxgraphNodeEditor;
