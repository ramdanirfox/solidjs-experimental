import type { Cell, CellStyle, Graph, MaxPopupMenu } from "@maxgraph/core";
import type { JSX } from "solid-js";
import type { EditorEventBus } from "../editor-kit/events";
import type { DrawioFormat, DrawioImportReport, DrawioPage } from "./drawio";
import type { LogEntry, LogLevel, MaxgraphLogger } from "./logger";
import type { ShapeImportReport } from "./shapes";

/** Definisi satu jenis node: tampil di palet, dan menjadi named-style pada graph. */
export interface MaxgraphNodeType {
    /** Id unik. Dipakai sebagai nama style (disimpan di XML), jadi gunakan huruf/angka/underscore. */
    id: string;
    /** Label di palet dan label awal node saat dibuat. */
    label: string;
    /** URL / data-URI ikon (putih disarankan). Tanpa ikon, node hanya menampilkan teks. */
    icon?: string;
    /** Warna isi node. */
    color?: string;
    /** Ukuran node saat dijatuhkan. Default 140x44. */
    width?: number;
    height?: number;
    /** Style tambahan (menimpa style dasar node). */
    style?: CellStyle;
    /** Pengelompokan di palet. */
    group?: string;
    /** Data bebas milik aplikasi. */
    data?: unknown;
    /**
     * `card` (default): kotak berwarna dengan ikon putih. `shape`: bentuk apa adanya (stensil / SVG) — warna dan label mengikuti `style`.
     * `fragment`: kumpulan sel draw.io (`fragmentXml`) yang disisipkan sebagai satu kelompok.
     */
    kind?: "card" | "shape" | "fragment";
    /** `<mxGraphModel>` untuk jenis `fragment`. */
    fragmentXml?: string;
    /** Id pustaka bentuk asal (diisi saat impor bentuk). */
    source?: string;
}

export type MaxgraphEdgeStyle = "orthogonal" | "straight" | "curved" | "elbow" | "entity";
export type MaxgraphLayoutKind = "horizontal" | "vertical" | "organic" | "tree";

export interface MaxgraphToolbarOptions {
    /** Tampilkan tombol undo/redo. Default true. */
    history?: boolean;
    /** Tampilkan tombol salin/tempel/duplikat/hapus. Default true. */
    edit?: boolean;
    /** Tampilkan kontrol zoom. Default true. */
    zoom?: boolean;
    /** Tampilkan pemilih gaya garis. Default true. */
    edgeStyle?: boolean;
    /** Tampilkan menu tata letak otomatis. Default true. */
    layout?: boolean;
    /** Tampilkan tombol grid & minimap. Default true. */
    view?: boolean;
    /** Tampilkan impor/ekspor (XML, draw.io, SVG, PNG). Default true. */
    io?: boolean;
    /** Tampilkan impor bentuk tambahan. Default true. */
    shapes?: boolean;
    /** Tombol kelompokkan / pisahkan kelompok. Default true. */
    group?: boolean;
    /** Tombol layar penuh. Default true. */
    fullscreen?: boolean;
}

export interface MaxgraphContextMenuContext {
    graph: Graph;
    cell: Cell | null;
    menu: MaxPopupMenu;
    api: MaxgraphNodeEditorApi;
}

export type MaxgraphExportFormat = "xml" | "svg" | "png" | "drawio" | "drawio-compressed";

/** Event yang dipancarkan editor (lihat `api.events`, prop `onEvent`, dan CustomEvent `maxgraph-editor:<tipe>` pada elemen akar). */
export interface MaxgraphEventMap {
    ready: { api: MaxgraphNodeEditorApi };
    /** Segera setelah model berubah. */
    "model-change": { changes: number };
    /** Didebounce 250 ms setelah perubahan; `xml` = format asli maxGraph. */
    change: { xml: string };
    selection: { cells: Cell[] };
    "node-added": { cell: Cell; type?: MaxgraphNodeType };
    "cells-added": { cells: Cell[] };
    "cells-removed": { cells: Cell[] };
    "cells-moved": { cells: Cell[]; dx: number; dy: number };
    "cells-resized": { cells: Cell[] };
    "label-changed": { cell: Cell; value: unknown; previous: unknown };
    "edge-connected": { edge: Cell; terminal: Cell | null; previous: Cell | null; source: boolean };
    click: { cell: Cell | null; event: MouseEvent };
    "double-click": { cell: Cell | null; event: MouseEvent };
    zoom: { scale: number };
    history: { action: "undo" | "redo"; canUndo: boolean; canRedo: boolean };
    import: { format: DrawioFormat | "xml"; source: string; mode: "replace" | "merge"; report?: DrawioImportReport };
    export: { format: MaxgraphExportFormat; size: number; filename?: string };
    layout: { kind: MaxgraphLayoutKind };
    /** Sel dikelompokkan (`group` = sel kelompok baru, `cells` = anggota). */
    "cells-grouped": { group: Cell; cells: Cell[] };
    /** Kelompok dibubarkan (`cells` = anggota yang dilepas). */
    "cells-ungrouped": { cells: Cell[] };
    fullscreen: { fullscreen: boolean };
    shapes: { action: "added" | "removed"; id: string; name: string; report?: ShapeImportReport };
    page: { index: number; id: string; name: string; count: number };
    readonly: { readonly: boolean };
    /** Setiap catatan logger (lihat `api.logger`). */
    log: LogEntry;
    error: { scope: string; error: unknown };
    destroy: Record<string, never>;
}

export interface MaxgraphDrawioImportOptions {
    /** `replace` (default) mengganti diagram; `merge` menambahkan ke diagram yang ada. */
    mode?: "replace" | "merge";
    /** Halaman yang dimuat: indeks (0-based), id, atau nama. Default: halaman pertama. */
    page?: number | string;
    /** Pas ke layar setelah impor (mode replace). Default true. */
    fit?: boolean;
}

export interface MaxgraphDrawioExportOptions {
    /** Kompresi isi `<diagram>` (default draw.io). Default false agar mudah dibaca. */
    compress?: boolean;
    /** `all` (default) menulis semua halaman; `current` hanya halaman aktif. */
    pages?: "all" | "current";
    pretty?: boolean;
}

export interface MaxgraphInfo {
    cells: { vertices: number; edges: number; layers: number; total: number };
    selection: { count: number; ids: string[] };
    zoom: number;
    readonly: boolean;
    page: { index: number; name: string; count: number };
    nodeTypes: number;
    shapeLibraries: { id: string; name: string; kind: string; count: number }[];
    stencils: number;
    history: { canUndo: boolean; canRedo: boolean };
    listeners: number;
    commands: string[];
    log: { total: number; warn: number; error: number; failed: number };
}

export interface MaxgraphCellInspection {
    id: string | null;
    kind: "vertex" | "edge" | "layer" | "root";
    label: string;
    parent: string | null;
    source?: string | null;
    target?: string | null;
    geometry?: { x: number; y: number; width: number; height: number; relative: boolean; points: number };
    /** Style hasil gabungan (default + named style + milik sel). */
    style: Record<string, unknown>;
    /** Style milik sel saja. */
    ownStyle: Record<string, unknown>;
    namedStyles: string[];
    /** Bentuk yang dipakai dan apakah tersedia di registry. */
    shape: { name: string; resolved: "builtin" | "stencil" | "missing" };
    children: number;
}

/** Handle imperatif yang diberikan lewat `onReady` / `apiRef`. */
export interface MaxgraphNodeEditorApi {
    /** Instance maxGraph mentah untuk kebutuhan lanjutan. */
    readonly graph: Graph;
    getXml(pretty?: boolean): string;
    /** Ganti isi diagram. Riwayat undo dikosongkan. */
    setXml(xml: string): void;
    clear(): void;
    undo(): void;
    redo(): void;
    canUndo(): boolean;
    canRedo(): boolean;
    zoomIn(): void;
    zoomOut(): void;
    zoomActual(): void;
    /** Paskan seluruh diagram ke area tampilan. */
    fit(): void;
    getZoom(): number;
    addNode(typeId: string, x?: number, y?: number, label?: string): Cell | null;
    addEdge(source: Cell, target: Cell, label?: string): Cell | null;
    getSelection(): Cell[];
    selectAll(): void;
    deleteSelection(): void;
    copy(): void;
    paste(): void;
    duplicate(): void;
    layout(kind: MaxgraphLayoutKind): void;
    toSvg(): string;
    toPngBlob(scale?: number): Promise<Blob>;
    /** Unduh sebagai berkas. */
    download(format: MaxgraphExportFormat, filename?: string): Promise<void>;

    // ── pengelompokan, label, layar penuh, zoom ──
    /** Kelompokkan sel (default: seleksi). Mengembalikan sel kelompok, atau null bila kurang dari 1 sel yang dapat dikelompokkan. */
    group(cells?: Cell[]): Cell | null;
    /** Bubarkan kelompok (default: seleksi). Mengembalikan anggota yang dilepas. */
    ungroup(cells?: Cell[]): Cell[];
    /** Label sel: `html` benar bila style `html=1`; `value` = HTML (bila html) atau teks polos. */
    getLabel(cell?: Cell | null): { value: string; html: boolean } | undefined;
    /** Ubah label. `opts.html` mengubah mode (teks ⇄ HTML) dan mengonversi isi; HTML selalu disanitasi. */
    setLabel(cell: Cell, value: string, opts?: { html?: boolean }): boolean;
    /** Buka dialog Kelola label untuk sel (default: sel terpilih). */
    openLabelEditor(cell?: Cell | null): void;
    /** Zoom ke skala tertentu (dibatasi `minZoom`/`maxZoom`), berpusat di tengah tampilan atau titik klien. */
    zoomTo(scale: number, clientX?: number, clientY?: number): void;
    setFullscreen(on: boolean): Promise<void>;
    toggleFullscreen(): Promise<void>;
    isFullscreen(): boolean;

    // ── draw.io ──
    /** Ekspor ke draw.io (`<mxfile>`; style diratakan). */
    exportDrawio(opts?: MaxgraphDrawioExportOptions): Promise<string>;
    /**
     * Impor draw.io (.drawio / `<mxfile>` terkompresi atau tidak / `<mxGraphModel>`) atau XML asli maxGraph.
     * Atomik: bila gagal, diagram yang terbuka tidak berubah. Mengembalikan laporan (apa yang berhasil dan peringatan).
     */
    importDrawio(xml: string, opts?: MaxgraphDrawioImportOptions): Promise<DrawioImportReport | undefined>;
    getPages(): readonly DrawioPage[];
    setPage(indexOrId: number | string): Promise<void>;

    // ── bentuk tambahan ──
    /** Impor pustaka bentuk (stensil `<shapes>`, SVG, atau `<mxlibrary>`) dan tambahkan ke palet. */
    importShapes(content: string, opts?: { name?: string; fileName?: string }): Promise<ShapeImportReport>;
    removeShapeLibrary(id: string): void;
    listShapeLibraries(): MaxgraphInfo["shapeLibraries"];
    /** Tambah jenis node saat runtime (muncul di palet). */
    registerNodeType(type: MaxgraphNodeType): void;
    getNodeTypes(): readonly MaxgraphNodeType[];

    // ── pemrograman & penelusuran ──
    /** Bus event: `on / once / off / onAny / emit / registerCommand / run`. */
    readonly events: EditorEventBus<MaxgraphEventMap>;
    on: EditorEventBus<MaxgraphEventMap>["on"];
    off: EditorEventBus<MaxgraphEventMap>["off"];
    once: EditorEventBus<MaxgraphEventMap>["once"];
    /** Jalankan perintah bernama (sama dengan CustomEvent `maxgraph-editor:command`). */
    run<T = unknown>(command: string, ...args: unknown[]): Promise<T>;
    readonly logger: MaxgraphLogger;
    /** Ringkasan keadaan editor untuk debugging. */
    getInfo(): MaxgraphInfo;
    /** Ringkasan satu sel: style gabungan, bentuk yang dipakai, apakah tersedia di registry, dsb. */
    inspect(cell?: Cell | null): MaxgraphCellInspection | undefined;
    /** Tampilkan / sembunyikan panel Log/Info/Events. */
    showPanel(panel: "log" | "info" | "events" | null): void;
}

export interface SharedMaxgraphNodeEditorProps {
    class?: string;
    style?: JSX.CSSProperties;
    /** Tinggi komponen. Angka = px. Default "100%". */
    height?: string | number;

    /** XML `mxGraphModel` awal. Mengubah prop ini (selain hasil `onChange` sendiri) memuat ulang diagram. */
    xml?: string;
    /** Jenis node yang tersedia. Default: start, process, condition, sql, trigger, end. */
    nodeTypes?: MaxgraphNodeType[];
    /** Mode baca-saja: tidak bisa memindah/mengubah/menghapus/menyambung. Panning & zoom tetap jalan. */
    readonly?: boolean;

    /** Tampilkan toolbar (true) atau atur tombolnya satu per satu. Default true. */
    toolbar?: boolean | MaxgraphToolbarOptions;
    /** Tampilkan palet node di kiri. Default true (disembunyikan otomatis saat readonly). */
    palette?: boolean;
    paletteTitle?: string;
    /** Tampilkan minimap (Outline). Default false. */
    outline?: boolean;
    /** Tampilkan bilah status (zoom, jumlah node/garis, seleksi). Default true. */
    statusBar?: boolean;

    /** Grid latar & snap. Default true. */
    grid?: boolean;
    gridSize?: number;
    /** Faktor zoom per langkah tombol / API. Default 1.2. */
    zoomFactor?: number;
    /** Kecepatan zoom roda mouse / pinch (kelipatan; 1 = bawaan ≈ 1,17× per ketukan roda). Default 1. */
    wheelZoomSpeed?: number;
    /** Batas zoom. Default 0.1 – 8. */
    minZoom?: number;
    maxZoom?: number;
    /** Animasi singkat (±140 ms) untuk zoom lewat tombol / API. Default true. */
    zoomAnimation?: boolean;
    /** Maks. entri undo. Default 100. */
    maxHistory?: number;
    /** Seleksi kotak dengan drag di latar. Default true. */
    rubberband?: boolean;
    /** Pan dengan tombol tengah mouse / spasi + drag. Default true. */
    panning?: boolean;
    /** Ctrl + roda mouse untuk zoom. Default true. */
    wheelZoom?: boolean;
    /** Pintasan keyboard (Del, Ctrl+Z/Y/C/V/D/A, panah). Default true. */
    keyboard?: boolean;
    /** Label bisa diedit dengan klik ganda. Default true. */
    labelEditable?: boolean;

    /** Boleh menyambung antar node. Default true. */
    connectable?: boolean;
    allowLoops?: boolean;
    allowDanglingEdges?: boolean;
    /** Izinkan lebih dari satu garis antara dua node yang sama. Default false. */
    multigraph?: boolean;
    edgeStyle?: MaxgraphEdgeStyle;
    /** Style tambahan untuk garis baru. */
    defaultEdgeStyle?: CellStyle;
    /** Style tambahan untuk semua node (di bawah style jenis node). */
    defaultNodeStyle?: CellStyle;
    /** Kembalikan false untuk menolak sambungan. */
    validateConnection?: (source: Cell, target: Cell, graph: Graph) => boolean;

    /** Menu klik kanan. `false` menonaktifkan; fungsi menambah item di atas item bawaan. */
    contextMenu?: boolean | ((ctx: MaxgraphContextMenuContext) => void);

    /** Bus event milik aplikasi (opsional). Tanpa ini editor membuat bus sendiri; selalu tersedia lewat `api.events`. */
    bus?: EditorEventBus<MaxgraphEventMap>;
    /** Menerima SETIAP event editor (selain handler per-tipe di bawah). */
    onEvent?: <K extends keyof MaxgraphEventMap>(type: K, payload: MaxgraphEventMap[K], api: MaxgraphNodeEditorApi) => void;
    /** Logger milik aplikasi (opsional). */
    logger?: MaxgraphLogger;
    /** Tingkat minimum log. Default "info"; "debug" menyertakan jejak tiap langkah. */
    logLevel?: LogLevel;
    /** Cetak log juga ke console. Default false. */
    consoleLog?: boolean;
    /** Panel debug yang terbuka di awal. Default tertutup. */
    panel?: "log" | "info" | "events" | null;
    /** Tombol Log/Info pada toolbar. Default true. */
    debugTools?: boolean;
    /** Pustaka bentuk (stensil / SVG / mxlibrary) yang diimpor saat mulai. */
    shapeLibraries?: { name?: string; content: string }[];

    onReady?: (api: MaxgraphNodeEditorApi) => void;
    /** Dipanggil (didebounce) setelah diagram berubah. */
    onChange?: (xml: string, api: MaxgraphNodeEditorApi) => void;
    onSelectionChange?: (cells: Cell[], api: MaxgraphNodeEditorApi) => void;
    onNodeAdded?: (cell: Cell, type: MaxgraphNodeType | undefined, api: MaxgraphNodeEditorApi) => void;
    onCellDoubleClick?: (cell: Cell, evt: MouseEvent, api: MaxgraphNodeEditorApi) => void;
    onError?: (error: unknown) => void;
}
