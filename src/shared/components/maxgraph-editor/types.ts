import type { Cell, CellStyle, Graph, MaxPopupMenu } from "@maxgraph/core";
import type { JSX } from "solid-js";

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
    /** Tampilkan impor/ekspor (XML, SVG, PNG). Default true. */
    io?: boolean;
}

export interface MaxgraphContextMenuContext {
    graph: Graph;
    cell: Cell | null;
    menu: MaxPopupMenu;
    api: MaxgraphNodeEditorApi;
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
    download(format: "xml" | "svg" | "png", filename?: string): Promise<void>;
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
    /** Faktor zoom per langkah. Default 1.2. */
    zoomFactor?: number;
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

    onReady?: (api: MaxgraphNodeEditorApi) => void;
    /** Dipanggil (didebounce) setelah diagram berubah. */
    onChange?: (xml: string, api: MaxgraphNodeEditorApi) => void;
    onSelectionChange?: (cells: Cell[], api: MaxgraphNodeEditorApi) => void;
    onNodeAdded?: (cell: Cell, type: MaxgraphNodeType | undefined, api: MaxgraphNodeEditorApi) => void;
    onCellDoubleClick?: (cell: Cell, evt: MouseEvent, api: MaxgraphNodeEditorApi) => void;
    onError?: (error: unknown) => void;
}
