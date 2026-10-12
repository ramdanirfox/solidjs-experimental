/**
 * Controller kanvas slide: render slide aktif, seleksi (klik / Shift / marquee), seret–ubah ukuran–putar dengan garis pandu,
 * edit teks langsung di tempat (contenteditable pada kerangka teks), alat sisip (seret untuk menggambar), clipboard internal,
 * susunan (z-order, rata, grup), tabel, gambar, format painter, serta cari/ganti. Semua perubahan model memakai API `@office-kit/pptx`.
 */
import * as P from "@office-kit/pptx";
import type { SlideData, SlideShapeData, TextFormat, ReadTextFormat, PresetShape } from "@office-kit/pptx";
import { PptxDeck } from "./pptx-model";
import { PX, renderShape, renderSlide, themeColor, topShapes, type RenderCtx } from "./pptx-render";
import { insertOleFrame, readOleFrame, updateOleFrame, type InsertedOleFrame, type OleFrameBounds, type UpdatedOleFrame } from "./pptx-ole";
import type { PreparedOle } from "../office-shared/ole-embed";
import { setFillAlpha, setRunAlpha, setStrokeAlpha, setTextAlpha, textAlphaOf } from "./pptx-alpha";
import { PPTX_REPLACE_KINDS, collectUnits, countValues, listLinks, replaceValues, type PptxUnit } from "./pptx-nav";
import { elementToPng, loadImageBytes, planDom, type DomImportOptions, type DomImportResult } from "./pptx-dom-import";
import { compileFind, createFindCursor, isValueKind, makeReport, matchRanges, replaceInString, snippet, type FindMatch, type FindResult, type FindSpec, type NavEvent, type ReplaceKind, type ReplaceReport, type ReplaceSpec } from "../editor-kit/find-replace";
import { parseCssColor } from "../editor-kit/color-util";
import type { LinkItem } from "../editor-kit/hyperlink";
import { splitFormatKeys, type FormatProps, type FormatReport } from "../editor-kit/format";

/** Target `format.apply` PPTX: bentuk pada slide (default: seleksi). */
export interface PptxFormatTarget { slide?: number; id?: number; ids?: number[]; name?: string; all?: boolean }
/** Kunci `format.*` yang dipahami PPTX (umum + khusus). */
export const PPTX_FORMAT_KEYS = ["bold", "italic", "underline", "strike", "fontFamily", "fontSize", "color", "colorAlpha", "fill", "fillAlpha", "stroke", "align", "valign", "opacity", "link", "rotation", "hidden", "name", "alt", "shadow", "bounds"] as const;

export interface PxSelInfo {
  slideIndex: number; slideCount: number; layout: string | null; hidden: boolean;
  count: number;
  shape?: { id: number; name: string; kind: string; placeholder: string | null; x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean;
    text: string; hasText: boolean; isTable: boolean; isChart: boolean; isPicture: boolean; isGroup: boolean; isLine: boolean; preset: string | null; z: number; alt: string; hidden: boolean;
    fill: string | null; stroke: string | null; strokeW: number | null; dash: string | null; shadow: boolean; hyperlink: string | null;
    fmt?: { font?: string; size?: number; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; color?: string | null; align?: string | null; bullet?: string | null; level?: number; lineSpacing?: number | null };
    cell?: { row: number; col: number; rows: number; cols: number; merged: boolean };
    image?: { format: string | null; bytes: number; crop: { left?: number; top?: number; right?: number; bottom?: number } | null; opacity: number | null; brightness: number | null; contrast: number | null };
    animation: string | null;
  };
  editing: boolean;
  tool: string | null;
}

/** Target `goto` untuk editor PPTX. Indeks slide berbasis 0. */
export type PptxNavTarget =
  | { kind: "slide"; index: number }
  | { kind: "first" } | { kind: "last" } | { kind: "next" } | { kind: "prev" }
  | { kind: "shape"; slide?: number; id?: number; name?: string }
  | { kind: "notes"; slide?: number }
  | { kind: "link"; id: string }
  | { kind: "search"; query: string; regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean; occurrence?: number }
  | { kind: "match"; index: number };

export type Tool = { type: "textbox" } | { type: "shape"; preset: PresetShape | string } | { type: "line"; arrow?: boolean } | null;

export interface PxHooks {
  changed(label: string): void;
  /** Dipanggil setelah snapshot riwayat selesai (status undo/redo sudah final). */
  committed?(): void;
  selection(s: PxSelInfo): void;
  slide(index: number): void;
  thumbs(indices: number[] | "all"): void;
  toast(key: string, params?: Record<string, string | number>): void;
  log(level: "info" | "warn" | "error", key: string, params?: Record<string, string | number>): void;
  context(x: number, y: number, kind: "shape" | "slide"): void;
  painter(p: { items: [string, string][] } | null): void;
  tool(t: Tool): void;
  openFile(f: File): void;
  /** Klik ganda pada objek OLE. */
  ole?(slideIndex: number, shapeId: number, progId: string): void;
}

export interface FindOpts { query: string; regex: boolean; caseSensitive: boolean; wholeWord: boolean }
export interface FindHit { index: number; slide: number; shapeId: number; where: string; text: string; before: string; after: string; start: number; end: number }

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
const IN = (n: number) => P.inches(n);
type Bounds = { x: number; y: number; w: number; h: number };

export class PptxView {
  deck?: PptxDeck;
  slideIdx = 0;
  zoom = 1;
  fit = true;
  readonly = false;
  lockAspect = true;
  showGrid = false;
  snapOn = true;
  tool: Tool = null;
  sel: SlideShapeData[] = [];
  private ctx!: RenderCtx;
  private slideEl: HTMLElement | null = null;
  readonly stage: HTMLElement;
  readonly zoomEl: HTMLElement;
  readonly overlay: HTMLElement;
  private urls = new Map<Uint8Array, string>();
  private disposers: (() => void)[] = [];
  private editing: { shape: SlideShapeData; host: HTMLElement; cell?: { row: number; col: number }; before: string; props: P.ParagraphProperties[]; baseFmt: ReadTextFormat | null; changed: boolean } | null = null;
  private clip: SlideShapeData[] = [];
  private clipSlide: SlideData | null = null;
  private painterClip: { fill: string | null; stroke: string | null; strokeW: number | null; fmt: ReadTextFormat | null; align: string | null } | null = null;
  private drag: { mode: "move" | "resize" | "rotate" | "marquee" | "draw"; handle?: string; sx: number; sy: number; init: Map<SlideShapeData, Bounds>; rot0?: number; box?: Bounds; moved: boolean; shift: boolean; start?: { x: number; y: number }; cx?: number; cy?: number } | null = null;
  private raf = 0;
  private roRaf = 0;
  private selRaf = 0;
  private resizeRO: ResizeObserver;
  prompts: Record<string, string> = {};
  hits: FindHit[] = [];
  hitCur = -1;
  private seen = new Set<string>();

  constructor(public host: HTMLElement, public hooks: PxHooks) {
    host.classList.add("px-scroll");
    this.stage = this.mk("px-stage");
    this.zoomEl = this.mk("px-zoom");
    this.overlay = this.mk("px-overlay");
    this.stage.appendChild(this.zoomEl);
    host.appendChild(this.stage);
    this.zoomEl.appendChild(this.overlay);
    this.resizeRO = new ResizeObserver(() => { if (!this.fit || this.roRaf) return; this.roRaf = requestAnimationFrame(() => { this.roRaf = 0; if (this.fit) this.fitNow(); }); });
    this.resizeRO.observe(host);
    this.bind();
  }
  private mk(cls: string) { const d = document.createElement("div"); d.className = cls; return d; }

  dispose() {
    this.resizeRO.disconnect();
    for (const d of this.disposers) d();
    cancelAnimationFrame(this.raf); cancelAnimationFrame(this.selRaf); cancelAnimationFrame(this.roRaf);
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    this.urls.clear();
    this.host.textContent = "";
    this.host.classList.remove("px-scroll");
  }

  // ───────── muat & render ─────────

  makeCtx(interactive: boolean): RenderCtx {
    const pres = this.deck!.pres;
    return {
      pres, doc: document, reg: new WeakMap(), domOf: new Map(), interactive, prompts: this.prompts, seenIssues: this.seen,
      theme: P.getPresentationTheme(pres), fonts: P.getPresentationFonts(pres),
      imgUrl: (bytes, fmt) => {
        let u = this.urls.get(bytes);
        if (!u) { u = URL.createObjectURL(new Blob([bytes as BlobPart], { type: ({ png: "image/png", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", svg: "image/svg+xml" } as Record<string, string>)[fmt] ?? "image/png" })); this.urls.set(bytes, u); }
        return u;
      },
      log: (key, params) => this.hooks.log(key.startsWith("log.imgFormat") || key === "log.preset" || key === "log.frame" ? "warn" : "error", key, params),
    };
  }

  load(deck: PptxDeck) {
    this.deck = deck;
    this.slideIdx = 0;
    this.sel = [];
    this.editing = null;
    this.seen = new Set();
    this.render();
    this.fitNow();
  }

  get slides() { return this.deck ? this.deck.slides : []; }
  get slide(): SlideData | undefined { return this.slides[this.slideIdx]; }

  render(keepSel = true) {
    if (!this.deck) return;
    const slide = this.slide;
    if (this.slideEl) this.slideEl.remove();
    if (!slide) { this.slideEl = null; this.updateOverlay(); this.emit(); return; }
    this.ctx = this.makeCtx(true);
    this.slideEl = renderSlide(this.ctx, slide);
    this.zoomEl.insertBefore(this.slideEl, this.overlay);
    const size = P.getSlideSize(this.deck.pres);
    if (size) { this.zoomEl.style.width = `${size.width / PX}px`; this.zoomEl.style.height = `${size.height / PX}px`; }
    if (!keepSel) this.sel = [];
    else this.sel = this.sel.filter(s => this.ctx.domOf.has(s));
    this.applyGrid();
    this.updateOverlay();
    this.emit();
    this.markHits();
  }

  /** Render slide ke elemen kecil (miniatur) berskala `width` px; tanpa placeholder prompt & tanpa pendaftaran seleksi. */
  renderThumb(slide: SlideData, width: number): HTMLElement {
    const size = P.getSlideSize(this.deck!.pres)!;
    const full = size.width / PX, high = size.height / PX;
    const k = width / full;
    const wrap = this.mk("px-thumb-box");
    wrap.style.cssText = `width:${width}px;height:${Math.round(high * k)}px;`;
    const ctx = this.makeCtx(false);
    ctx.log = undefined;
    const el = renderSlide(ctx, slide);
    el.style.transform = `scale(${k})`;
    el.style.transformOrigin = "0 0";
    wrap.appendChild(el);
    return wrap;
  }

  /** Render ulang satu bentuk tingkat-atas (cepat) tanpa merender seluruh slide. */
  rerenderShape(shape: SlideShapeData) {
    const old = this.ctx.domOf.get(shape);
    if (!old || !this.slideEl) { this.render(); return; }
    const layer = old.parentElement!;
    const idx = [...layer.children].indexOf(old);
    const tmp = document.createElement("div");
    renderShape(this.ctx, shape, tmp, b => ({ x: b.x / PX, y: b.y / PX, w: b.w / PX, h: b.h / PX }), true, true);
    const fresh = tmp.firstElementChild as HTMLElement | null;
    if (!fresh) { old.remove(); return; }
    old.replaceWith(fresh);
    void idx;
    this.updateOverlay();
  }

  goTo(i: number) {
    const n = this.slides.length;
    if (!n) return;
    const k = Math.max(0, Math.min(n - 1, i));
    if (k === this.slideIdx && this.slideEl) return;
    this.commitEdit();
    this.slideIdx = k;
    this.sel = [];
    this.hooks.slide(k);
    this.render(false);
  }

  /** Setelah undo/redo: pres diganti — render ulang dan pulihkan seleksi berdasarkan id bentuk. */
  afterRestore(ids: number[], slideIdx: number) {
    this.editing = null;
    this.slideIdx = Math.max(0, Math.min(slideIdx, this.slides.length - 1));
    this.seen = new Set();
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    this.urls.clear();
    this.sel = [];
    this.render(false);
    const slide = this.slide;
    if (slide) this.sel = ids.map(id => P.findShapeById(slide, id)).filter((s): s is SlideShapeData => !!s && this.ctx.domOf.has(s));
    this.updateOverlay(); this.emit();
    this.hooks.thumbs("all");
  }
  selectedIds() { return this.sel.map(s => P.getShapeId(s)); }

  // ───────── objek OLE ─────────

  /** Sisipkan objek OLE di slide aktif (bingkai dipilih setelahnya). Paket diubah langsung lalu model dimuat ulang. */
  async insertOle(prep: PreparedOle, at?: OleFrameBounds): Promise<InsertedOleFrame | undefined> {
    const deck = this.deck;
    if (!deck || this.readonly || !this.slides.length) return undefined;
    this.commitEdit();
    const idx = this.slideIdx;
    const res = await deck.mutatePackage("hist.oleInsert", pres => insertOleFrame(pres, idx, prep, at));
    this.afterRestore([res.shapeId], idx);
    this.hooks.changed("hist.oleInsert"); // riwayat sudah dicatat oleh mutatePackage/commit
    return res;
  }

  /** Ganti isi objek OLE `shapeId` pada slide `slideIndex` (posisi & ukuran tetap). */
  async updateOle(slideIndex: number, shapeId: number, prep: PreparedOle): Promise<UpdatedOleFrame | undefined> {
    const deck = this.deck;
    if (!deck || this.readonly) return undefined;
    this.commitEdit();
    const res = await deck.mutatePackage("hist.oleUpdate", pres => updateOleFrame(pres, slideIndex, shapeId, prep));
    this.afterRestore([shapeId], slideIndex);
    this.hooks.changed("hist.oleUpdate"); // riwayat sudah dicatat oleh mutatePackage/commit
    return res;
  }

  /** Ubah ukuran bingkai (px slide) dan catat riwayat. */
  async resizeOle(slideIndex: number, shapeId: number, wPx: number, hPx: number): Promise<boolean> {
    const deck = this.deck;
    const slide = deck && !this.readonly ? P.getSlides(deck.pres)[slideIndex] : undefined;
    const sh = slide ? P.findShapeById(slide, shapeId) : undefined;
    if (!deck || !sh || !(wPx > 4) || !(hPx > 4)) return false;
    this.commitEdit();
    const b = P.getShapeBounds(sh);
    if (!b) return false;
    P.setShapeBounds(sh, { x: b.x, y: b.y, w: Math.round(wPx * PX) as P.Emu, h: Math.round(hPx * PX) as P.Emu });
    await deck.commit("hist.oleSize");
    this.afterRestore([shapeId], slideIndex);
    this.hooks.changed("hist.oleSize"); // riwayat sudah dicatat oleh mutatePackage/commit
    return true;
  }

  /** Kotak slide pada layar + ukuran slide (px dokumen) — dasar penggaris. */
  slideBox(): { rect: DOMRect; width: number; height: number } | null {
    if (!this.slideEl) return null;
    return { rect: this.slideEl.getBoundingClientRect(), width: this.slideEl.offsetWidth, height: this.slideEl.offsetHeight };
  }

  // ───────── zoom ─────────

  setZoom(z: number, fit = false) {
    this.fit = fit;
    this.zoom = Math.max(0.1, Math.min(4, z));
    this.zoomEl.style.transform = `scale(${this.zoom})`;
    this.zoomEl.style.setProperty("--z", String(this.zoom));
    const w = this.zoomEl.offsetWidth * this.zoom, h = this.zoomEl.offsetHeight * this.zoom;
    this.stage.style.width = `${Math.ceil(w + 48)}px`; this.stage.style.height = `${Math.ceil(h + 48)}px`;
    this.zoomEl.style.left = "24px"; this.zoomEl.style.top = "24px";
    this.updateOverlay();
  }
  fitNow() {
    const w = this.zoomEl.offsetWidth || 1280, h = this.zoomEl.offsetHeight || 720;
    const k = Math.min((this.host.clientWidth - 48) / w, (this.host.clientHeight - 48) / h);
    if (k > 0) this.setZoom(k, true);
  }

  // ───────── seleksi & overlay ─────────

  private shapeOfTarget(t: EventTarget | null): SlideShapeData | null {
    let e = t as HTMLElement | null;
    while (e && e !== this.zoomEl) {
      const s = this.ctx?.reg.get(e);
      if (s) return s;
      e = e.parentElement;
    }
    return null;
  }

  select(shapes: SlideShapeData[], additive = false) {
    if (additive) {
      const set = new Set(this.sel);
      for (const s of shapes) { if (set.has(s)) set.delete(s); else set.add(s); }
      this.sel = [...set];
    } else this.sel = shapes;
    this.updateOverlay(); this.scheduleEmit();
  }
  selectAll() { this.select(topShapes(this.slide!).filter(s => this.ctx.domOf.has(s) && !P.isShapeHidden(s))); }
  clearSelection() { this.commitEdit(); this.sel = []; this.updateOverlay(); this.scheduleEmit(); }

  private boundsOf(s: SlideShapeData): Bounds { const b = P.getShapeBoundsResolved(this.deck!.pres, s) ?? { x: 0, y: 0, w: 0, h: 0 }; return { x: b.x, y: b.y, w: b.w, h: b.h }; }

  updateOverlay() {
    this.overlay.querySelectorAll(".px-sel,.px-guide,.px-marquee").forEach(e => e.remove());
    if (!this.slideEl || this.editing) return;
    for (const s of this.sel) {
      const dom = this.ctx.domOf.get(s);
      if (!dom) continue;
      const b = this.boundsOf(s);
      const box = this.mk("px-sel");
      box.style.cssText = `left:${b.x / PX}px;top:${b.y / PX}px;width:${b.w / PX}px;height:${b.h / PX}px;transform:rotate(${P.getShapeRotation(s)}deg);`;
      if (this.sel.length === 1 && !this.readonly) {
        for (const h of HANDLES) { const hd = this.mk(`px-h px-h-${h}`); hd.dataset.h = h; box.appendChild(hd); }
        const rot = this.mk("px-rot"); rot.dataset.h = "rot"; box.appendChild(rot);
      }
      this.overlay.appendChild(box);
    }
  }

  private scheduleEmit() { if (this.selRaf) return; this.selRaf = requestAnimationFrame(() => { this.selRaf = 0; this.emit(); }); }

  info(): PxSelInfo {
    const deck = this.deck!;
    const slide = this.slide;
    const base: PxSelInfo = { slideIndex: this.slideIdx, slideCount: this.slides.length, layout: slide ? (() => { const l = P.getSlideLayout(slide); return l ? P.getSlideLayoutName(l) : null; })() : null, hidden: slide ? P.isSlideHidden(slide) : false, count: this.sel.length, editing: !!this.editing, tool: this.tool ? this.tool.type : null };
    if (this.sel.length !== 1) return base;
    const s = this.sel[0];
    const kind = P.getShapeKind(s);
    const b = this.boundsOf(s);
    const f = P.getShapeFlip(s);
    const isTable = P.isTableShape(s), isChart = P.isChartShape(s);
    let fill: string | null = null, stroke: string | null = null, strokeW: number | null = null, dash: string | null = null;
    try { const ff = P.getShapeFillEffective(deck.pres, s); if (ff.kind === "solid") fill = ff.color; } catch { /* abaikan */ }
    try { const st = P.getShapeStrokeEffective(deck.pres, s); if (st.kind === "solid") { stroke = st.color; strokeW = st.widthEmu ?? 12700; } dash = P.getShapeStrokeDash(s); } catch { /* abaikan */ }
    let fmt: NonNullable<PxSelInfo["shape"]>["fmt"];
    try {
      if (kind === "shape" && P.getShapeParagraphCount(s) > 0) {
        let rf: ReadTextFormat | null = null;
        for (let i = 0; i < P.getShapeParagraphCount(s); i++) if (P.getShapeRunCount(s, i) > 0) { rf = P.getShapeRunFormatEffective(deck.pres, s, i, 0); break; }
        const pp = P.getParagraphPropertiesEffective(deck.pres, s, 0);
        const bl = pp.bullet;
        fmt = { font: rf?.font, size: rf?.size, bold: rf?.bold, italic: rf?.italic, underline: !!rf?.underline, strike: !!rf?.strike && rf?.strike !== "noStrike", color: rf?.color ?? null, align: pp.align, bullet: bl ? (typeof bl === "string" ? bl : "char" in bl ? "bullet" : "number") : null, level: pp.level, lineSpacing: pp.lineSpacing?.kind === "pct" ? pp.lineSpacing.value : null };
      }
    } catch { /* abaikan */ }
    let cell: NonNullable<PxSelInfo["shape"]>["cell"];
    if (isTable && this.cellSel) { const d = P.getTableDimensions(s); const sp = P.getTableCellSpan(P.getTableCell(s, this.cellSel.row, this.cellSel.col)); cell = { row: this.cellSel.row + 1, col: this.cellSel.col + 1, rows: d.rows, cols: d.cols, merged: sp.gridSpan > 1 || sp.rowSpan > 1 }; }
    let image: NonNullable<PxSelInfo["shape"]>["image"];
    if (kind === "picture") { const by = P.getShapeImageBytes(s); image = { format: P.getShapeImageFormat(s), bytes: by?.length ?? 0, crop: P.getShapeImageCrop(s), opacity: P.getShapeImageOpacity(s), brightness: P.getShapeImageBrightness(s), contrast: P.getShapeImageContrast(s) }; }
    let hyperlink: string | null = null;
    try { hyperlink = P.getShapeHyperlink(s); } catch { /* abaikan */ }
    base.shape = {
      id: P.getShapeId(s), name: P.getShapeName(s), kind, placeholder: P.getShapePlaceholderType(s), x: b.x, y: b.y, w: b.w, h: b.h, rot: P.getShapeRotation(s), flipH: !!f?.horizontal, flipV: !!f?.vertical,
      text: P.getShapeText(s), hasText: kind === "shape" || kind === "group" ? P.hasShapeText(s) : false, isTable, isChart, isPicture: kind === "picture", isGroup: kind === "group", isLine: kind === "connector" || P.getShapePreset(s) === "line",
      preset: P.getShapePreset(s), z: P.getShapeZIndex(s), alt: P.getShapeDescription(s) ?? "", hidden: P.isShapeHidden(s), fill, stroke, strokeW, dash, shadow: (() => { try { return P.getShapeEffectsEffective(deck.pres, s).some(e => e.kind === "outerShdw"); } catch { return false; } })(), hyperlink,
      fmt, cell, image, animation: P.getShapeAnimation(s),
    };
    return base;
  }
  emit() { if (this.deck) this.hooks.selection(this.info()); }

  // ───────── event ─────────

  cellSel: { row: number; col: number } | null = null;

  private bind() {
    const on = (t: EventTarget, ev: string, fn: (e: never) => void, o?: boolean | AddEventListenerOptions) => { t.addEventListener(ev, fn as EventListener, o); this.disposers.push(() => t.removeEventListener(ev, fn as EventListener, o)); };
    on(this.host, "mousedown", (e: MouseEvent) => this.onDown(e));
    on(document, "mousemove", (e: MouseEvent) => this.onMove(e));
    on(document, "mouseup", (e: MouseEvent) => this.onUp(e));
    on(this.host, "dblclick", (e: MouseEvent) => this.onDbl(e));
    on(this.host, "keydown", (e: KeyboardEvent) => this.onKey(e));
    on(this.host, "contextmenu", (e: MouseEvent) => this.onContext(e));
    on(this.host, "dragover", (e: DragEvent) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); });
    on(this.host, "drop", (e: DragEvent) => this.onDrop(e));
    on(this.host, "paste", (e: ClipboardEvent) => this.onPaste(e));
    on(this.host, "click", (e: MouseEvent) => this.onClick(e));
    this.host.tabIndex = 0;
  }

  private toSlide(e: MouseEvent): { x: number; y: number } {
    const r = this.slideEl!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.zoom, y: (e.clientY - r.top) / this.zoom };
  }

  private onClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest<HTMLElement>("[data-href]");
    if (a && (e.ctrlKey || e.metaKey || this.readonly) && a.dataset.href) { window.open(a.dataset.href, "_blank", "noopener,noreferrer"); }
  }

  private onDown(e: MouseEvent) {
    if (!this.deck || !this.slideEl || e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (this.editing && this.editing.host.contains(t)) return; // biarkan caret
    if (this.editing) this.commitEdit();
    this.host.focus({ preventScroll: true });
    // alat sisip: mulai menggambar
    if (this.tool && !this.readonly) {
      const p = this.toSlide(e);
      this.drag = { mode: "draw", sx: p.x, sy: p.y, init: new Map(), moved: false, shift: e.shiftKey, start: p, box: { x: p.x, y: p.y, w: 0, h: 0 } };
      e.preventDefault();
      return;
    }
    // format painter
    if (this.painterClip && !this.readonly) {
      const s = this.shapeOfTarget(t);
      if (s) { this.applyPainter(s); e.preventDefault(); return; }
    }
    const h = t.closest<HTMLElement>("[data-h]");
    if (h && this.sel.length === 1 && !this.readonly) {
      const s = this.sel[0];
      const dom = this.ctx.domOf.get(s);
      const p = this.toSlide(e);
      const init = new Map<SlideShapeData, Bounds>([[s, this.boundsOf(s)]]);
      const b = init.get(s)!;
      this.drag = { mode: h.dataset.h === "rot" ? "rotate" : "resize", handle: h.dataset.h, sx: p.x, sy: p.y, init, moved: false, shift: e.shiftKey, rot0: P.getShapeRotation(s), cx: (b.x + b.w / 2) / PX, cy: (b.y + b.h / 2) / PX };
      void dom;
      e.preventDefault();
      return;
    }
    const s = this.shapeOfTarget(t);
    const td = t.closest<HTMLElement>("td");
    if (s) {
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (!this.sel.includes(s)) this.select([s], additive); else if (additive) this.select([s], true);
      if (td && P.isTableShape(s)) { this.cellSel = { row: Number(td.dataset.r), col: Number(td.dataset.c) }; this.scheduleEmit(); } else this.cellSel = null;
      if (!this.readonly && this.sel.includes(s)) {
        const p = this.toSlide(e);
        const init = new Map<SlideShapeData, Bounds>();
        for (const x of this.sel) init.set(x, this.boundsOf(x));
        this.drag = { mode: "move", sx: p.x, sy: p.y, init, moved: false, shift: e.shiftKey };
      }
      e.preventDefault();
      return;
    }
    // area kosong → marquee
    const p = this.toSlide(e);
    if (p.x < -5 || p.y < -5) { this.clearSelection(); return; }
    this.cellSel = null;
    if (!(e.shiftKey)) this.sel = [];
    this.drag = { mode: "marquee", sx: p.x, sy: p.y, init: new Map(), moved: false, shift: e.shiftKey, box: { x: p.x, y: p.y, w: 0, h: 0 } };
    this.updateOverlay(); this.scheduleEmit();
  }

  /** Garis bantu penggaris (px slide) yang ikut menjadi target snapping. */
  guideSource?: () => { x: number[]; y: number[] };
  private guides: { v: number[]; h: number[] } = { v: [], h: [] };
  private snap(box: Bounds, moving: Set<SlideShapeData>, kinds: ("x" | "y")[] = ["x", "y"]): { dx: number; dy: number } {
    if (!this.snapOn) { this.guides = { v: [], h: [] }; return { dx: 0, dy: 0 }; }
    const size = P.getSlideSize(this.deck!.pres)!;
    const xs: number[] = [0, size.width / 2, size.width], ys: number[] = [0, size.height / 2, size.height];
    const gs = this.guideSource?.();
    if (gs) { for (const x of gs.x) xs.push(x * PX); for (const y of gs.y) ys.push(y * PX); }
    for (const s of topShapes(this.slide!)) { if (moving.has(s) || P.isShapeHidden(s)) continue; const b = this.boundsOf(s); xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h); }
    const th = 6 / this.zoom * PX;
    const best = (vals: number[], cands: number[]) => { let d = Infinity, g: number | undefined; for (const v of vals) for (const c of cands) { const dd = c - v; if (Math.abs(dd) < Math.abs(d) && Math.abs(dd) <= th) { d = dd; g = c; } } return { d: g === undefined ? 0 : d, g }; };
    const bx = kinds.includes("x") ? best([box.x, box.x + box.w / 2, box.x + box.w], xs) : { d: 0, g: undefined }, by = kinds.includes("y") ? best([box.y, box.y + box.h / 2, box.y + box.h], ys) : { d: 0, g: undefined };
    this.guides = { v: bx.g !== undefined ? [bx.g] : [], h: by.g !== undefined ? [by.g] : [] };
    return { dx: bx.d, dy: by.d };
  }
  private drawGuides() {
    this.overlay.querySelectorAll(".px-guide").forEach(e => e.remove());
    for (const v of this.guides.v) { const g = this.mk("px-guide v"); g.style.left = `${v / PX}px`; this.overlay.appendChild(g); }
    for (const h of this.guides.h) { const g = this.mk("px-guide h"); g.style.top = `${h / PX}px`; this.overlay.appendChild(g); }
  }

  private onMove(e: MouseEvent) {
    const d = this.drag;
    if (!d || !this.slideEl) return;
    const p = this.toSlide(e);
    const dx = p.x - d.sx, dy = p.y - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 3 / Math.max(this.zoom, 0.3)) return;
    d.moved = true;
    if (d.mode === "move") {
      let ddx = dx * PX, ddy = dy * PX;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) ddy = 0; else ddx = 0; }
      // bounding box seluruh seleksi untuk snapping
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const b of d.init.values()) { minX = Math.min(minX, b.x); minY = Math.min(minY, b.y); maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h); }
      const sn = e.altKey ? { dx: 0, dy: 0 } : this.snap({ x: minX + ddx, y: minY + ddy, w: maxX - minX, h: maxY - minY }, new Set(d.init.keys()));
      if (e.altKey) this.guides = { v: [], h: [] };
      ddx += sn.dx; ddy += sn.dy;
      for (const [s, b] of d.init) { const dom = this.ctx.domOf.get(s); if (dom) { dom.style.left = `${(b.x + ddx) / PX}px`; dom.style.top = `${(b.y + ddy) / PX}px`; } }
      this.moveOverlay(ddx, ddy, d.init);
      this.drawGuides();
    } else if (d.mode === "resize") {
      const [s, b0] = [...d.init][0];
      const nb = this.resizeBounds(b0, d.handle!, dx * PX, dy * PX, e.shiftKey !== (this.lockAspect && P.getShapeKind(s) === "picture"), P.getShapeRotation(s));
      const sn = this.snap(nb, new Set([s]));
      void sn;
      d.box = nb;
      if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; if (this.drag?.box) { P.setShapeBounds(s, this.toEmu(this.drag.box)); this.rerenderShape(s); this.drawGuides(); } });
    } else if (d.mode === "rotate") {
      const s = [...d.init.keys()][0];
      const a = (Math.atan2(p.y - d.cy!, p.x - d.cx!) * 180) / Math.PI + 90;
      let deg = ((a % 360) + 360) % 360;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      P.setShapeRotation(s, Math.round(deg * 10) / 10);
      if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.rerenderShape(s); });
    } else if (d.mode === "marquee" || d.mode === "draw") {
      const x = Math.min(d.sx, p.x), y = Math.min(d.sy, p.y);
      let w = Math.abs(p.x - d.sx), h = Math.abs(p.y - d.sy);
      if (d.mode === "draw" && e.shiftKey && this.tool?.type !== "line") { const m = Math.max(w, h); w = m; h = m; }
      d.box = { x, y, w, h };
      this.overlay.querySelectorAll(".px-marquee").forEach(el => el.remove());
      const m = this.mk("px-marquee");
      m.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;
      if (d.mode === "draw" && this.tool?.type === "line") { m.classList.add("line"); m.style.cssText = `left:${Math.min(d.sx, p.x)}px;top:${Math.min(d.sy, p.y)}px;width:${Math.abs(p.x - d.sx)}px;height:${Math.abs(p.y - d.sy)}px;`; d.start = { x: d.sx, y: d.sy }; d.box = { x: p.x, y: p.y, w: 0, h: 0 }; }
      this.overlay.appendChild(m);
      if (d.mode === "marquee") {
        const hit = P.findShapesInRect(this.slide!, x * PX, y * PX, w * PX, h * PX).filter(s => this.ctx.domOf.has(s));
        this.sel = d.shift ? [...new Set([...this.sel, ...hit])] : hit;
        this.overlay.querySelectorAll(".px-sel").forEach(el => el.remove());
        for (const s of this.sel) { const b = this.boundsOf(s); const bx = this.mk("px-sel"); bx.style.cssText = `left:${b.x / PX}px;top:${b.y / PX}px;width:${b.w / PX}px;height:${b.h / PX}px;`; this.overlay.appendChild(bx); }
      }
    }
  }

  private moveOverlay(dx: number, dy: number, init: Map<SlideShapeData, Bounds>) {
    const boxes = [...this.overlay.querySelectorAll<HTMLElement>(".px-sel")];
    [...init.values()].forEach((b, i) => { const bx = boxes[i]; if (bx) { bx.style.left = `${(b.x + dx) / PX}px`; bx.style.top = `${(b.y + dy) / PX}px`; } });
  }

  private toEmu(b: Bounds): { x: P.Emu; y: P.Emu; w: P.Emu; h: P.Emu } { return { x: Math.round(b.x) as P.Emu, y: Math.round(b.y) as P.Emu, w: Math.max(12700, Math.round(b.w)) as P.Emu, h: Math.max(12700, Math.round(b.h)) as P.Emu }; }

  /** Hitung bounds baru saat menarik handle (ruang tak-berputar; pada bentuk berputar delta diproyeksikan ke sumbu bentuk). */
  private resizeBounds(b: Bounds, handle: string, dx: number, dy: number, keep: boolean, rot: number): Bounds {
    const a = (-rot * Math.PI) / 180;
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    let { x, y, w, h } = b;
    const r = b.w / Math.max(1, b.h);
    if (handle.includes("e")) w = b.w + lx;
    if (handle.includes("w")) { w = b.w - lx; x = b.x + lx; }
    if (handle.includes("s")) h = b.h + ly;
    if (handle.includes("n")) { h = b.h - ly; y = b.y + ly; }
    if (keep) {
      if (handle.length === 2) { const k = Math.abs(w / b.w - 1) > Math.abs(h / b.h - 1) ? w / b.w : h / b.h; w = b.w * k; h = b.h * k; }
      else if (handle === "e" || handle === "w") h = w / r; else w = h * r;
      if (handle.includes("w")) x = b.x + b.w - w;
      if (handle.includes("n")) y = b.y + b.h - h;
      if (handle === "n" || handle === "s") x = b.x + (b.w - w) / 2;
      if (handle === "e" || handle === "w") y = b.y + (b.h - h) / 2;
    }
    if (w < 12700) { if (handle.includes("w")) x -= 12700 - w; w = 12700; }
    if (h < 12700) { if (handle.includes("n")) y -= 12700 - h; h = 12700; }
    return { x, y, w, h };
  }

  private onUp(e: MouseEvent) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.guides = { v: [], h: [] };
    const pt = this.slideEl ? this.toSlide(e) : { x: 0, y: 0 };
    if (d.mode === "move" && d.moved) {
      const dx = (pt.x - d.sx) * PX, dy = (pt.y - d.sy) * PX;
      void dx; void dy;
      for (const s of d.init.keys()) {
        const dom = this.ctx.domOf.get(s);
        if (!dom) continue;
        P.setShapePosition(s, Math.round(parseFloat(dom.style.left) * PX) as P.Emu, Math.round(parseFloat(dom.style.top) * PX) as P.Emu);
      }
      this.changed("hist.move"); this.render(); this.hooks.thumbs([this.slideIdx]);
    } else if ((d.mode === "resize" || d.mode === "rotate") && d.moved) {
      if (d.mode === "resize" && d.box) P.setShapeBounds([...d.init.keys()][0], this.toEmu(d.box));
      this.changed(d.mode === "resize" ? "hist.resize" : "hist.rotate"); this.render(); this.hooks.thumbs([this.slideIdx]);
    } else if (d.mode === "marquee") {
      this.overlay.querySelectorAll(".px-marquee").forEach(el => el.remove());
      this.updateOverlay(); this.scheduleEmit();
    } else if (d.mode === "draw") {
      this.overlay.querySelectorAll(".px-marquee").forEach(el => el.remove());
      this.finishDraw(d, pt);
    } else this.updateOverlay();
    this.drawGuides();
  }

  private finishDraw(d: NonNullable<PptxView["drag"]>, pt: { x: number; y: number }) {
    const tool = this.tool;
    if (!tool) return;
    const slide = this.slide!;
    const px = (v: number) => Math.round(v * PX) as P.Emu;
    let shape: SlideShapeData;
    if (tool.type === "line") {
      const x2 = d.moved ? pt.x : d.sx + 200, y2 = d.moved ? pt.y : d.sy;
      shape = P.addSlideLine(slide, { from: { x: px(d.sx), y: px(d.sy) }, to: { x: px(x2), y: px(y2) }, color: "#1F2937", widthEmu: 28575 });
      if (tool.arrow) P.setShapeStrokeArrow(shape, "tail", { type: "triangle" });
    } else {
      const bx = d.box ?? { x: d.sx, y: d.sy, w: 0, h: 0 };
      const w = d.moved && bx.w > 8 ? bx.w : tool.type === "textbox" ? 360 : 220, h = d.moved && bx.h > 8 ? bx.h : tool.type === "textbox" ? 60 : 140;
      const x = d.moved && bx.w > 8 ? bx.x : d.sx - w / 2, y = d.moved && bx.h > 8 ? bx.y : d.sy - h / 2;
      if (tool.type === "textbox") {
        shape = P.addSlideTextBox(slide, { x: px(x), y: px(y), w: px(w), h: px(h), text: "" });
        P.setShapeTextFormat(shape, { size: 24 });
      } else {
        shape = P.addSlideShape(slide, { preset: tool.preset, x: px(x), y: px(y), w: px(w), h: px(h) });
        const acc = this.ctx.theme?.accent1 ?? "#4F81BD";
        P.setShapeFill(shape, acc as P.Color);
        P.setShapeStroke(shape, { color: "#FFFFFF", widthEmu: 12700 });
      }
    }
    const kind = tool.type;
    this.setTool(null);
    this.changed("hist.insert"); this.render(false);
    this.sel = [shape]; this.updateOverlay(); this.emit();
    this.hooks.thumbs([this.slideIdx]);
    if (kind === "textbox") this.startEdit(shape);
  }

  setTool(t: Tool) { this.tool = t; this.host.classList.toggle("px-drawing", !!t); this.hooks.tool(t); this.emit(); }

  private onDbl(e: MouseEvent) {
    if (!this.deck) return;
    const staticOle = (e.target as HTMLElement).closest<HTMLElement>(".px-ole-static");
    if (staticOle) { this.hooks.ole?.(this.slideIdx, Number(staticOle.dataset.oleId), staticOle.dataset.progId ?? ""); return; }
    const s = this.shapeOfTarget(e.target);
    if (!s) return;
    const ole = P.getShapeKind(s) === "graphicFrame" && !P.isTableShape(s) && !P.isChartShape(s) ? readOleFrame(s) : null;
    if (ole) { this.hooks.ole?.(this.slideIdx, P.getShapeId(s), ole.progId); return; }
    if (this.readonly) return;
    const td = (e.target as HTMLElement).closest<HTMLElement>("td");
    if (td && P.isTableShape(s)) { this.startEdit(s, { row: Number(td.dataset.r), col: Number(td.dataset.c) }); return; }
    if (P.getShapeKind(s) === "shape") this.startEdit(s);
  }

  private onContext(e: MouseEvent) {
    if (!this.deck) return;
    const s = this.shapeOfTarget(e.target);
    e.preventDefault();
    if (s) { if (!this.sel.includes(s)) this.select([s]); this.hooks.context(e.clientX, e.clientY, "shape"); }
    else { this.clearSelection(); this.hooks.context(e.clientX, e.clientY, "slide"); }
  }

  private onDrop(e: DragEvent) {
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    e.preventDefault();
    if (/\.(pptx|pptm|potx)$/i.test(f.name)) { this.hooks.openFile(f); return; }
    if (f.type.startsWith("image/") && !this.readonly) void this.insertImage(f, this.slideEl ? this.toSlide(e) : undefined);
    else this.hooks.openFile(f);
  }

  private onPaste(e: ClipboardEvent) {
    if (this.editing || this.readonly) return;
    const img = [...(e.clipboardData?.files ?? [])].find(f => f.type.startsWith("image/"));
    if (img) { e.preventDefault(); void this.insertImage(img); return; }
    if (this.clip.length) { e.preventDefault(); this.paste(); }
  }

  private onKey(e: KeyboardEvent) {
    if (!this.deck) return;
    const mod = e.ctrlKey || e.metaKey;
    if (this.editing) {
      if (e.key === "Escape") { e.preventDefault(); this.commitEdit(); this.host.focus(); }
      else if (mod && ["b", "i", "u"].includes(e.key.toLowerCase())) { e.preventDefault(); document.execCommand(e.key.toLowerCase() === "b" ? "bold" : e.key.toLowerCase() === "i" ? "italic" : "underline"); this.editing.changed = true; }
      else if (e.key === "Enter" && mod) { e.preventDefault(); this.commitEdit(); }
      return;
    }
    const k = e.key;
    if (k === "Escape") { if (this.painterClip) this.cancelPainter(); else if (this.tool) this.setTool(null); else this.clearSelection(); return; }
    if (mod && k.toLowerCase() === "a") { e.preventDefault(); this.selectAll(); return; }
    if (this.readonly) { if (k === "PageDown" || k === "ArrowRight") this.goTo(this.slideIdx + 1); if (k === "PageUp" || k === "ArrowLeft") this.goTo(this.slideIdx - 1); return; }
    if (mod && k.toLowerCase() === "c") { e.preventDefault(); this.copy(); return; }
    if (mod && k.toLowerCase() === "x") { e.preventDefault(); this.copy(); this.deleteSelected(); return; }
    if (mod && k.toLowerCase() === "v") { e.preventDefault(); this.paste(); return; }
    if (mod && k.toLowerCase() === "d") { e.preventDefault(); this.duplicateSelected(); return; }
    if (mod && k.toLowerCase() === "g") { e.preventDefault(); if (e.shiftKey) this.ungroup(); else this.group(); return; }
    if (k === "Delete" || k === "Backspace") { if (this.sel.length) { e.preventDefault(); this.deleteSelected(); } return; }
    if ((k === "Enter" || k === "F2") && this.sel.length === 1) { e.preventDefault(); if (P.getShapeKind(this.sel[0]) === "shape") this.startEdit(this.sel[0]); return; }
    if (k === "Tab") { e.preventDefault(); this.cycle(e.shiftKey ? -1 : 1); return; }
    if (/^Arrow/.test(k) && this.sel.length) {
      e.preventDefault();
      const step = (e.shiftKey ? 1 : 10) * (this.zoom < 0.5 ? 2 : 1);
      const dx = k === "ArrowLeft" ? -step : k === "ArrowRight" ? step : 0, dy = k === "ArrowUp" ? -step : k === "ArrowDown" ? step : 0;
      for (const s of this.sel) { const b = this.boundsOf(s); P.setShapePosition(s, Math.round(b.x + dx * PX) as P.Emu, Math.round(b.y + dy * PX) as P.Emu); }
      this.changed("hist.move", "hist.move"); this.render(); this.hooks.thumbs([this.slideIdx]);
      return;
    }
    if (!this.sel.length) {
      if (k === "PageDown" || k === "ArrowRight" || k === "ArrowDown") this.goTo(this.slideIdx + 1);
      else if (k === "PageUp" || k === "ArrowLeft" || k === "ArrowUp") this.goTo(this.slideIdx - 1);
    }
  }

  private cycle(d: 1 | -1) {
    const all = topShapes(this.slide!).filter(s => this.ctx.domOf.has(s));
    if (!all.length) return;
    const i = this.sel.length ? all.indexOf(this.sel[0]) : -1;
    this.select([all[(i + d + all.length) % all.length]]);
  }

  // ───────── perubahan model ─────────

  /** Catat ke riwayat + beri tahu UI. */
  changed(label: string, merge?: string) {
    if (!this.deck) return;
    void this.deck.commit(label, merge).then(() => this.hooks.committed?.());
    this.hooks.changed(label);
  }

  private apply(label: string, fn: (s: SlideShapeData) => void, opts?: { shapes?: SlideShapeData[]; merge?: string; renderAll?: boolean }) {
    if (this.readonly || !this.deck) return;
    const list = opts?.shapes ?? this.sel;
    if (!list.length) return;
    this.commitEdit();
    for (const s of list) { try { fn(s); } catch (e) { this.hooks.log("error", "log.opFail", { op: label, msg: e instanceof Error ? e.message : String(e) }); } }
    this.changed(label, opts?.merge);
    if (opts?.renderAll) this.render(); else { for (const s of list) this.rerenderShape(s); }
    this.hooks.thumbs([this.slideIdx]);
    this.scheduleEmit();
  }

  // formatting / properti bentuk
  setFill(color: string | null, alpha?: number) { this.apply("hist.fill", s => { if (color === null) P.setShapeNoFill(s); else { P.setShapeFill(s, color as P.Color); setFillAlpha(s, alpha !== undefined && alpha < 1 ? alpha : null); } }); }
  /** Opasitas isi solid (0–1) tanpa mengganti warna. */
  setFillOpacity(alpha: number) { this.apply("hist.fill", s => { setFillAlpha(s, alpha < 1 ? alpha : null); }); }
  /** Warna teks seluruh bentuk terpilih (null = hapus warna eksplisit) dengan opasitas opsional. Saat mengedit teks, hanya warna yang berlaku pada seleksi. */
  setTextColor(color: string | null, alpha?: number) {
    if (this.editing) { this.execFormat({ color: color as P.Color | null, alpha } as TextFormat & { alpha?: number }); return; }
    this.textFormat({ color: color as P.Color | null });
    if (color !== null) this.apply("hist.format", s => { setTextAlpha(s, alpha !== undefined && alpha < 1 ? alpha : null); });
  }
  setGradient(c1: string, c2: string, angle = 90) { this.apply("hist.fill", s => P.setShapeGradientFill(s, { stops: [{ offset: 0, color: c1 as P.Color }, { offset: 1, color: c2 as P.Color }], angleDeg: angle })); }
  setStroke(o: { color?: string | null; widthPt?: number; dash?: P.LineDash; alpha?: number }) {
    this.apply("hist.stroke", s => {
      if (o.color === null) { P.setShapeNoStroke(s); return; }
      if (o.color || o.widthPt) P.setShapeStroke(s, { ...(o.color ? { color: o.color as P.Color } : {}), ...(o.widthPt ? { widthEmu: Math.round(o.widthPt * 12700) } : {}) });
      if (o.alpha !== undefined) setStrokeAlpha(s, o.alpha < 1 ? o.alpha : null);
      if (o.dash) P.setShapeStrokeDash(s, o.dash);
    });
  }
  setShadow(on: boolean) { this.apply("hist.effect", s => { if (on) P.setShapeShadow(s, {}); else P.clearShapeEffects(s); }); }
  setOpacity(v: number) { this.apply("hist.image", s => P.setShapeImageOpacity(s, v >= 1 ? null : v)); }
  setRotation(deg: number) { this.apply("hist.rotate", s => P.setShapeRotation(s, deg)); }
  flip(axis: "h" | "v") { this.apply("hist.rotate", s => { const f = P.getShapeFlip(s); P.setShapeFlip(s, axis === "h" ? { horizontal: !f?.horizontal } : { vertical: !f?.vertical }); }); }
  setBoundsCm(patch: Partial<{ x: number; y: number; w: number; h: number }>, lock = false) {
    this.apply("hist.resize", s => {
      const b = this.boundsOf(s);
      const cm = (v: number) => Math.round(v * 360000);
      const n = { ...b };
      if (patch.x !== undefined) n.x = cm(patch.x);
      if (patch.y !== undefined) n.y = cm(patch.y);
      if (patch.w !== undefined) { n.w = cm(patch.w); if (lock && patch.h === undefined) n.h = Math.round((n.w * b.h) / Math.max(1, b.w)); }
      if (patch.h !== undefined) { n.h = cm(patch.h); if (lock && patch.w === undefined) n.w = Math.round((n.h * b.w) / Math.max(1, b.h)); }
      P.setShapeBounds(s, this.toEmu(n));
    });
  }
  rename(name: string) { this.apply("hist.props", s => P.renameShape(s, name), { merge: "hist.props" }); }
  setAlt(text: string) { this.apply("hist.props", s => P.setShapeDescription(s, text || null), { merge: "hist.props" }); }
  setHidden(h: boolean) { this.apply("hist.props", s => P.setShapeHidden(s, h)); }

  /** Daftar bentuk dari target `format.*` (berpindah ke slide target bila perlu). */
  resolveFormatShapes(target?: PptxFormatTarget): SlideShapeData[] {
    if (!this.deck) return [];
    if (!target) return [...this.sel];
    if (target.slide !== undefined) { if (!Number.isInteger(target.slide) || target.slide < 0 || target.slide >= this.slides.length) return []; if (target.slide !== this.slideIdx) this.goTo(target.slide); }
    const slide = this.slide;
    if (!slide) return [];
    if (target.all) return topShapes(slide);
    const out: SlideShapeData[] = [];
    for (const id of [...(target.ids ?? []), ...(target.id !== undefined ? [target.id] : [])]) { const s = P.findShapeById(slide, id); if (s && !out.includes(s)) out.push(s); }
    if (target.name) for (const s of P.getSlideShapes(slide)) if (P.getShapeName(s).toLowerCase() === target.name.toLowerCase() && !out.includes(s)) out.push(s);
    if (!target.ids && target.id === undefined && !target.name) return [...this.sel];
    return out;
  }

  /**
   * `format.apply` — properti umum + khusus PPTX pada bentuk target. Satu langkah undo. Kunci tak dikenal masuk `skipped`.
   * `bounds` dalam px slide (1280×720); `colorAlpha`/`fillAlpha`/`stroke.alpha` asli (`<a:alpha>`).
   */
  formatShapes(props: FormatProps, target?: PptxFormatTarget): FormatReport {
    const { use, skipped } = splitFormatKeys(props, PPTX_FORMAT_KEYS);
    const shapes = this.readonly ? [] : this.resolveFormatShapes(target);
    if (!shapes.length || !use.length) return { applied: [], skipped: [...skipped, ...use], targets: 0 };
    const tf: TextFormat = {};
    if (props.bold !== undefined) tf.bold = !!props.bold;
    if (props.italic !== undefined) tf.italic = !!props.italic;
    if (props.underline !== undefined) tf.underline = !!props.underline;
    if (props.strike !== undefined) tf.strike = !!props.strike;
    if (props.fontFamily !== undefined) tf.font = props.fontFamily ?? undefined;
    if (props.fontSize !== undefined && props.fontSize !== null) tf.size = props.fontSize;
    if (props.color !== undefined) tf.color = (props.color as P.Color | null);
    const hasText = Object.keys(tf).length > 0;
    const applied = new Set<string>();
    this.apply("hist.format", s => {
      const isTable = P.isTableShape(s);
      /** Tiap kelompok properti berdiri sendiri: gagal di satu bentuk/kelompok tidak membatalkan yang lain. */
      const step = (keys: string[], f: () => void) => { const ks = keys.filter(k => use.includes(k)); if (!ks.length) return; try { f(); ks.forEach(k => applied.add(k)); } catch { /* tidak berlaku pada bentuk ini */ } };
      if (hasText) step(["bold", "italic", "underline", "strike", "fontFamily", "fontSize", "color"], () => {
        if (isTable) { const d = P.getTableDimensions(s); for (let r = 0; r < d.rows; r++) for (let c = 0; c < d.cols; c++) P.setTableCellTextFormat(P.getTableCell(s, r, c), tf); }
        else P.setShapeTextFormat(s, tf);
      });
      if (!isTable) step(["colorAlpha"], () => setTextAlpha(s, props.colorAlpha! < 1 ? props.colorAlpha! : null));
      step(["align"], () => {
        if (isTable) { const d = P.getTableDimensions(s); for (let r = 0; r < d.rows; r++) for (let c = 0; c < d.cols; c++) P.setTableCellAlignment(P.getTableCell(s, r, c), props.align!); } else P.setShapeAlignment(s, props.align!);
      });
      if (!isTable) {
        step(["valign"], () => P.setShapeTextAnchor(s, props.valign === "middle" ? "center" : props.valign!));
        step(["fill", "fillAlpha"], () => {
          if (props.fill === null) P.setShapeNoFill(s);
          else if (props.fill !== undefined) { P.setShapeFill(s, props.fill as P.Color); setFillAlpha(s, props.fillAlpha !== undefined && props.fillAlpha < 1 ? props.fillAlpha : null); }
          else if (props.fillAlpha !== undefined) setFillAlpha(s, props.fillAlpha < 1 ? props.fillAlpha : null);
        });
        step(["stroke"], () => {
          const o = props.stroke;
          if (o === null || o?.color === null) { P.setShapeNoStroke(s); return; }
          if (!o) return;
          if (o.color || o.width) P.setShapeStroke(s, { ...(o.color ? { color: o.color as P.Color } : {}), ...(o.width ? { widthEmu: Math.round(o.width * 12700) } : {}) });
          if (o.alpha !== undefined) setStrokeAlpha(s, o.alpha < 1 ? o.alpha : null);
          if (o.dash) P.setShapeStrokeDash(s, o.dash);
        });
        step(["shadow"], () => { if (props.shadow) P.setShapeShadow(s, {}); else P.clearShapeEffects(s); });
        step(["rotation"], () => P.setShapeRotation(s, Number(props.rotation) || 0));
        step(["bounds"], () => {
          const bp = (props.bounds ?? {}) as Partial<{ x: number; y: number; w: number; h: number }>, b = this.boundsOf(s);
          const e = (v: number | undefined, cur: number) => (v === undefined ? cur : Math.round(v * PX));
          P.setShapeBounds(s, this.toEmu({ x: e(bp.x, b.x), y: e(bp.y, b.y), w: e(bp.w, b.w), h: e(bp.h, b.h) }));
        });
      }
      if (P.getShapeKind(s) === "picture") step(["opacity"], () => P.setShapeImageOpacity(s, props.opacity! >= 1 ? null : props.opacity!));
      step(["link"], () => P.setShapeHyperlink(s, props.link || null));
      step(["hidden"], () => P.setShapeHidden(s, !!props.hidden));
      if (typeof props.name === "string") step(["name"], () => P.renameShape(s, props.name as string));
      if (typeof props.alt === "string") step(["alt"], () => P.setShapeDescription(s, (props.alt as string) || null));
    }, { shapes });
    // sebuah kunci dianggap diterapkan bila berhasil pada sedikitnya satu bentuk (mis. teks tidak berlaku pada gambar)
    return { applied: use.filter(k => applied.has(k)), skipped: [...skipped, ...use.filter(k => !applied.has(k))], targets: shapes.length };
  }

  /** `format.get` — nilai umum dari seleksi (satu bentuk) sebagai `FormatProps`. */
  formatGet(target?: PptxFormatTarget): FormatProps | undefined {
    const shapes = this.resolveFormatShapes(target);
    if (shapes.length !== 1 || !this.deck) return undefined;
    const keep = this.sel;
    this.sel = shapes;
    const sh = this.info().shape;
    this.sel = keep;
    if (!sh) return undefined;
    const f = sh.fmt;
    const out: FormatProps = { fill: sh.fill, hidden: sh.hidden, name: sh.name, alt: sh.alt, rotation: sh.rot, shadow: sh.shadow, bounds: { x: Math.round(sh.x / PX), y: Math.round(sh.y / PX), w: Math.round(sh.w / PX), h: Math.round(sh.h / PX) }, link: sh.hyperlink };
    out.stroke = sh.stroke ? { color: sh.stroke, width: sh.strokeW ? sh.strokeW / 12700 : undefined, dash: (sh.dash ?? undefined) as never } : null;
    if (f) Object.assign(out, { bold: !!f.bold, italic: !!f.italic, underline: !!f.underline, strike: !!f.strike, fontFamily: f.font ?? null, fontSize: f.size ?? null, color: f.color ?? null, align: f.align });
    const fa = P.getShapeFillOpacity(shapes[0]);
    if (typeof fa === "number") out.fillAlpha = fa;
    return out;
  }
  private editRange: Range | null = null;
  /** Simpan seleksi teks yang sedang disunting (sebelum dialog mengambil fokus). */
  rememberEditSelection() {
    const s = window.getSelection();
    this.editRange = this.editing && s && s.rangeCount && this.editing.host.contains(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null;
  }
  setHyperlink(url: string | null) {
    if (this.editing && !this.editing.cell) {
      // teks yang sedang disunting: tautan pada seleksi (disimpan sebagai hyperlink run saat commit)
      if (this.editRange) { this.editing.host.focus(); const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(this.editRange); }
      document.execCommand(url ? "createLink" : "unlink", false, url ?? undefined);
      this.editing.changed = true;
      return;
    }
    this.apply("hist.link", s => P.setShapeHyperlink(s, url));
  }
  setAnimation(effect: P.AnimationEffect | null, ms = 600) { this.apply("hist.anim", s => { if (effect) P.setShapeAnimation(s, { effect, durationMs: ms }); else P.clearSlideAnimations(this.slide!); }); }

  // teks
  textFormat(f: TextFormat) {
    if (this.editing) { this.execFormat(f); return; }
    this.apply("hist.format", s => { if (P.isTableShape(s)) { if (this.cellSel) P.setTableCellTextFormat(P.getTableCell(s, this.cellSel.row, this.cellSel.col), f); else { const d = P.getTableDimensions(s); for (let r = 0; r < d.rows; r++) for (let c = 0; c < d.cols; c++) P.setTableCellTextFormat(P.getTableCell(s, r, c), f); } } else P.setShapeTextFormat(s, f); });
  }
  toggle(key: "bold" | "italic" | "underline" | "strike") {
    const cur = this.info().shape?.fmt;
    const v = !(cur as Record<string, boolean | undefined> | undefined)?.[key];
    this.textFormat({ [key]: v } as TextFormat);
  }
  align(a: "left" | "center" | "right" | "justify") {
    if (this.editing) { document.execCommand(a === "left" ? "justifyLeft" : a === "center" ? "justifyCenter" : a === "right" ? "justifyRight" : "justifyFull"); this.editing.changed = true; return; }
    this.apply("hist.align", s => { if (P.isTableShape(s) && this.cellSel) P.setTableCellAlignment(P.getTableCell(s, this.cellSel.row, this.cellSel.col), a); else P.setShapeAlignment(s, a); });
  }
  bullets(style: P.BulletStyle) { this.apply("hist.list", s => { const n = P.getShapeParagraphCount(s); for (let i = 0; i < n; i++) P.setParagraphBullet(s, i, style); }); }
  level(d: number) { this.apply("hist.indent", s => { const n = P.getShapeParagraphCount(s); for (let i = 0; i < n; i++) P.setParagraphLevel(s, i, Math.max(0, Math.min(8, P.getParagraphLevel(s, i) + d))); }); }
  lineSpacing(mult: number) { this.apply("hist.spacing", s => { const n = P.getShapeParagraphCount(s); for (let i = 0; i < n; i++) P.setParagraphLineSpacing(s, i, { kind: "pct", value: mult }); }); }
  textAnchor(a: "top" | "center" | "bottom") { this.apply("hist.align", s => P.setShapeTextAnchor(s, a)); }
  autoFit(m: P.TextAutoFit) { this.apply("hist.props", s => P.setShapeTextAutoFit(s, m)); }
  replaceText(text: string) { this.apply("hist.text", s => P.setShapeText(s, text)); }

  // susunan
  zOrder(op: "front" | "back" | "forward" | "backward") { this.apply("hist.arrange", s => { if (op === "front") P.bringShapeToFront(s); else if (op === "back") P.sendShapeToBack(s); else if (op === "forward") P.bringShapeForward(s); else P.sendShapeBackward(s); }, { renderAll: true, shapes: op === "front" || op === "forward" ? [...this.sel] : [...this.sel].reverse() }); }
  alignShapes(mode: "left" | "center" | "right" | "top" | "middle" | "bottom" | "hdist" | "vdist") {
    if (this.readonly || !this.sel.length) return;
    const size = P.getSlideSize(this.deck!.pres)!;
    const list = this.sel.map(s => ({ s, b: this.boundsOf(s) }));
    const ref = list.length > 1 ? { x: Math.min(...list.map(l => l.b.x)), y: Math.min(...list.map(l => l.b.y)), r: Math.max(...list.map(l => l.b.x + l.b.w)), b: Math.max(...list.map(l => l.b.y + l.b.h)) } : { x: 0, y: 0, r: size.width, b: size.height };
    if (mode === "hdist" || mode === "vdist") {
      if (list.length < 3) return;
      const h = mode === "hdist";
      const sorted = [...list].sort((a, b) => (h ? a.b.x - b.b.x : a.b.y - b.b.y));
      const total = h ? ref.r - ref.x : ref.b - ref.y;
      const sum = sorted.reduce((a, l) => a + (h ? l.b.w : l.b.h), 0);
      const gap = (total - sum) / (sorted.length - 1);
      let pos = h ? ref.x : ref.y;
      for (const l of sorted) { if (h) P.setShapePosition(l.s, Math.round(pos) as P.Emu, Math.round(l.b.y) as P.Emu); else P.setShapePosition(l.s, Math.round(l.b.x) as P.Emu, Math.round(pos) as P.Emu); pos += (h ? l.b.w : l.b.h) + gap; }
    } else for (const l of list) {
      let x = l.b.x, y = l.b.y;
      if (mode === "left") x = ref.x; else if (mode === "right") x = ref.r - l.b.w; else if (mode === "center") x = (ref.x + ref.r) / 2 - l.b.w / 2;
      else if (mode === "top") y = ref.y; else if (mode === "bottom") y = ref.b - l.b.h; else y = (ref.y + ref.b) / 2 - l.b.h / 2;
      P.setShapePosition(l.s, Math.round(x) as P.Emu, Math.round(y) as P.Emu);
    }
    this.changed("hist.arrange"); this.render(); this.hooks.thumbs([this.slideIdx]);
  }
  group() { if (this.sel.length < 2 || this.readonly) return; const g = P.groupShapes(this.sel); this.changed("hist.group"); this.render(false); this.sel = [g]; this.updateOverlay(); this.emit(); this.hooks.thumbs([this.slideIdx]); }
  ungroup() { if (this.readonly) return; const gs = this.sel.filter(s => P.getShapeKind(s) === "group"); if (!gs.length) return; const out: SlideShapeData[] = []; for (const g of gs) out.push(...P.ungroupShapes(g)); this.changed("hist.group"); this.render(false); this.sel = out.filter(s => this.ctx.domOf.has(s)); this.updateOverlay(); this.emit(); this.hooks.thumbs([this.slideIdx]); }
  deleteSelected() { if (this.readonly || !this.sel.length) return; for (const s of this.sel) P.removeShape(s); this.sel = []; this.cellSel = null; this.changed("hist.delete"); this.render(false); this.hooks.thumbs([this.slideIdx]); }
  copy() { this.clip = [...this.sel]; this.clipSlide = this.slide ?? null; if (this.clip.length) this.hooks.toast("toast.copied", { n: this.clip.length }); }
  paste() {
    if (this.readonly || !this.clip.length || !this.slide) return;
    const out: SlideShapeData[] = [];
    const off = this.clipSlide === this.slide ? 0.25 : 0;
    for (const s of this.clip) {
      try {
        const c = P.copyShape(this.slide, s);
        if (off) { const b = this.boundsOf(c); P.setShapePosition(c, Math.round(b.x + IN(off)) as P.Emu, Math.round(b.y + IN(off)) as P.Emu); }
        out.push(c);
      } catch (e) { this.hooks.log("error", "log.opFail", { op: "paste", msg: e instanceof Error ? e.message : String(e) }); }
    }
    this.changed("hist.paste"); this.render(false);
    this.sel = out.filter(s => this.ctx.domOf.has(s)); this.updateOverlay(); this.emit(); this.hooks.thumbs([this.slideIdx]);
  }
  duplicateSelected() { const keep = this.clip, ks = this.clipSlide; this.clip = [...this.sel]; this.clipSlide = this.slide ?? null; this.paste(); this.clip = keep; this.clipSlide = ks; }

  // ───────── edit teks langsung ─────────

  isEditing() { return !!this.editing; }

  startEdit(shape: SlideShapeData, cell?: { row: number; col: number }) {
    if (this.readonly || this.editing) return;
    const dom = this.ctx.domOf.get(shape);
    if (!dom) return;
    let host: HTMLElement | null = null;
    if (cell) host = dom.querySelector<HTMLElement>(`td[data-r="${cell.row}"][data-c="${cell.col}"]`);
    else {
      host = dom.querySelector<HTMLElement>(".px-text");
      if (!host) { host = document.createElement("div"); host.className = "px-text"; host.style.cssText = "padding:4px 8px;justify-content:flex-start;"; dom.appendChild(host); }
      host.querySelector(".px-prompt")?.remove();
    }
    if (!host) return;
    const props: P.ParagraphProperties[] = [];
    let baseFmt: ReadTextFormat | null = null;
    if (!cell) {
      const n = P.getShapeParagraphCount(shape);
      for (let i = 0; i < n; i++) { props.push(P.getParagraphPropertiesEffective(this.deck!.pres, shape, i)); if (!baseFmt && P.getShapeRunCount(shape, i) > 0) baseFmt = P.getShapeRunFormatEffective(this.deck!.pres, shape, i, 0); }
      if (!host.querySelector(".px-p")) { const p = document.createElement("div"); p.className = "px-p"; p.style.cssText = "line-height:1.2;"; p.innerHTML = "<br>"; host.appendChild(p); }
    }
    host.contentEditable = "true";
    host.classList.add("px-editing");
    host.spellcheck = true;
    this.editing = { shape, host, cell, before: host.innerHTML, props, baseFmt, changed: false };
    host.addEventListener("input", this.onEditInput);
    this.overlay.querySelectorAll(".px-sel").forEach(e => e.remove());
    host.focus();
    const r = document.createRange(); r.selectNodeContents(host); const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r);
    this.emit();
  }
  private onEditInput = () => { if (this.editing) this.editing.changed = true; };

  private rgbHex(c: string): string | null { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c); return m ? "#" + [m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, "0")).join("").toUpperCase() : null; }

  /** DOM yang disunting → daftar paragraf berformat (hanya selisih terhadap format dasar). */
  private parseEdit(host: HTMLElement, base: ReadTextFormat | null, scale = 1): { align: string | null; runs: { text: string; format: TextFormat; href?: string; alpha?: number }[] }[] {
    const root = host;
    const paras: HTMLElement[] = [];
    const loose: Node[] = [];
    const flushLoose = () => { if (loose.length) { const d = document.createElement("div"); for (const n of loose) d.appendChild(n.cloneNode(true)); paras.push(d); loose.length = 0; } };
    for (const n of [...root.childNodes]) {
      if (n instanceof HTMLElement && /^(DIV|P|LI)$/.test(n.tagName) && !n.classList.contains("px-prompt")) { flushLoose(); paras.push(n); }
      else if (n instanceof HTMLElement && n.tagName === "BR") { loose.push(n); flushLoose(); }
      else loose.push(n);
    }
    flushLoose();
    const result: { align: string | null; runs: { text: string; format: TextFormat; href?: string; alpha?: number }[] }[] = [];
    for (const p of paras) {
      const runs: { text: string; format: TextFormat; href?: string; alpha?: number }[] = [];
      const cs = getComputedStyle(p);
      const align = p.style.textAlign || (cs.textAlign && cs.textAlign !== "start" ? cs.textAlign : null);
      const walk = (n: Node) => {
        if (n instanceof HTMLElement && (n.classList.contains("px-bullet") || n.classList.contains("px-prompt"))) return;
        if (n instanceof HTMLElement && n.tagName === "BR") { return; }
        if (n.nodeType === 3) {
          const text = (n.nodeValue ?? "").replace(/​/g, "");
          if (!text) return;
          const st = getComputedStyle(n.parentElement!);
          const f: TextFormat = {};
          // Setiap run ditulis dengan format efektifnya (ukuran, huruf, warna, gaya): `setShapeParagraphs` mereset properti run,
          // jadi format yang hanya "sama dengan run pertama" akan hilang dan jatuh ke bawaan layout.
          const px = parseFloat(st.fontSize);
          if (px > 0) f.size = Math.round(((px * 72) / 96 / scale) * 10) / 10;
          const src = n.parentElement!.closest<HTMLElement>("[data-font],[data-clr]");
          const fam = (st.fontFamily.split(",")[0] ?? "").trim().replace(/^['"]|['"]$/g, "");
          if (fam) {
            const orig = src?.dataset.font;
            const origName = orig?.startsWith("+mj") ? this.ctx.fonts?.majorLatin ?? "Calibri Light" : orig?.startsWith("+mn") ? this.ctx.fonts?.minorLatin ?? "Calibri" : orig;
            f.font = orig && origName === fam ? orig : fam;
          }
          f.bold = parseInt(st.fontWeight) >= 600;
          f.italic = st.fontStyle === "italic";
          f.underline = /underline/.test(st.textDecorationLine);
          f.strike = /line-through/.test(st.textDecorationLine);
          const col = this.rgbHex(st.color);
          if (col) {
            const tok = src?.dataset.clr;
            f.color = (tok && themeColor(this.ctx, tok)?.toUpperCase() === col ? tok : col) as P.Color;
          }
          const al = parseCssColor(st.color)?.alpha;
          const alpha = al !== undefined && al < 1 ? Math.round(al * 1000) / 1000 : undefined;
          const lk = n.parentElement!.closest<HTMLElement>("a[href],[data-href]");
          const href = lk?.getAttribute("href") ?? lk?.dataset.href ?? undefined;
          // run bertautan memakai tampilan tautan dari tema: jangan membakar warna/garis bawah ke dalam run
          if (href) { delete f.underline; delete f.color; }
          const prev = runs[runs.length - 1];
          if (prev && JSON.stringify(prev.format) === JSON.stringify(f) && prev.href === href && prev.alpha === alpha) prev.text += text; else runs.push({ text, format: f, href, alpha });
          return;
        }
        n.childNodes.forEach(walk);
      };
      p.childNodes.forEach(walk);
      result.push({ align, runs });
    }
    return result;
  }

  commitEdit() {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    ed.host.removeEventListener("input", this.onEditInput);
    ed.host.contentEditable = "false";
    ed.host.classList.remove("px-editing");
    window.getSelection()?.removeAllRanges();
    const dirty = ed.changed || ed.host.innerHTML !== ed.before;
    if (dirty && this.deck) {
      try {
        const fit = P.getShapeTextAutoFitParams(ed.shape);
        const parsed = this.parseEdit(ed.host, ed.baseFmt, fit?.fontScale ?? 1);
        if (ed.cell) {
          const cell = P.getTableCell(ed.shape, ed.cell.row, ed.cell.col);
          P.setTableCellParagraphs(cell, parsed.map(p => ({ align: this.toAlign(p.align), runs: p.runs.length ? p.runs : [{ text: "", format: {} }] })));
        } else {
          P.setShapeParagraphs(ed.shape, parsed.map(p => ({ align: this.toAlign(p.align), runs: p.runs.map(r => ({ text: r.text, format: r.format })) })));
          parsed.forEach((p, pi) => p.runs.forEach((r, ri) => {
            try {
              if (r.href) P.setShapeRunHyperlink(ed.shape, pi, ri, r.href);
              if (r.alpha !== undefined) setRunAlpha(ed.shape, pi, ri, r.alpha);
            } catch { /* abaikan */ }
          }));
          // pulihkan properti paragraf (bullet, level, spasi, perataan)
          parsed.forEach((p, i) => {
            const pr = ed.props[Math.min(i, ed.props.length - 1)];
            if (!pr) return;
            try {
              if (pr.bullet) P.setParagraphBullet(ed.shape, i, pr.bullet);
              if (pr.level) P.setParagraphLevel(ed.shape, i, pr.level);
              if (pr.align && !p.align) P.setParagraphAlignment(ed.shape, i, pr.align);
              if (pr.lineSpacing) P.setParagraphLineSpacing(ed.shape, i, pr.lineSpacing);
              if (pr.spcBefPts || pr.spcAftPts) P.setParagraphSpacing(ed.shape, i, { beforePts: pr.spcBefPts, afterPts: pr.spcAftPts });
            } catch { /* abaikan */ }
          });
        }
        this.changed("hist.text");
        this.hooks.thumbs([this.slideIdx]);
      } catch (e) { this.hooks.log("error", "log.opFail", { op: "edit", msg: e instanceof Error ? e.message : String(e) }); }
    }
    this.render();
  }
  private toAlign(a: string | null): P.ParagraphAlignment | undefined { return a === "center" ? "center" : a === "right" ? "right" : a === "justify" ? "justify" : a === "left" ? "left" : undefined; }

  private execFormat(f: TextFormat) {
    if (!this.editing) return;
    const ex = (c: string, v?: string) => document.execCommand(c, false, v);
    if (f.bold !== undefined && f.bold !== document.queryCommandState("bold")) ex("bold");
    if (f.italic !== undefined && f.italic !== document.queryCommandState("italic")) ex("italic");
    if (f.underline !== undefined && !!f.underline !== document.queryCommandState("underline")) ex("underline");
    if (f.strike !== undefined && !!f.strike !== document.queryCommandState("strikeThrough")) ex("strikeThrough");
    const fa = f as TextFormat & { alpha?: number };
    if (f.color === null) { ex("styleWithCSS", "true"); ex("foreColor", getComputedStyle(this.editing.host).color || "#000000"); }
    else if (f.color) {
      ex("styleWithCSS", "true");
      const a = fa.alpha !== undefined && fa.alpha < 1 ? fa.alpha : null;
      const p = /^#?([0-9a-f]{6})$/i.exec(String(f.color));
      ex("foreColor", a !== null && p ? `rgba(${parseInt(p[1].slice(0, 2), 16)}, ${parseInt(p[1].slice(2, 4), 16)}, ${parseInt(p[1].slice(4, 6), 16)}, ${a})` : String(f.color));
    }
    if (f.size) {
      ex("fontSize", "7");
      this.editing.host.querySelectorAll<HTMLElement>("font[size='7']").forEach(el => { el.removeAttribute("size"); el.style.fontSize = `${(f.size! * 96) / 72}px`; });
    }
    this.editing.changed = true;
  }

  // ───────── slide ─────────

  addSlide(layoutName?: string, at?: number): boolean {
    if (this.readonly || !this.deck) return false;
    const pres = this.deck.pres;
    const layouts = P.getSlideLayouts(pres);
    const layout = layoutName ? layouts.find(l => P.getSlideLayoutName(l) === layoutName) : (this.slide ? P.getSlideLayout(this.slide) : null) ?? layouts[layouts.length - 1];
    if (!layout) return false;
    const pos = at === undefined ? this.slideIdx + 1 : Math.max(0, Math.min(this.slides.length, Math.floor(at)));
    P.addSlideAt(pres, pos, { layout });
    this.changed("hist.slide");
    this.slideIdx = pos;
    this.hooks.slide(this.slideIdx); this.render(false); this.hooks.thumbs("all");
    return true;
  }
  duplicateSlide() { if (this.readonly || !this.slide) return; P.duplicateSlideAt(this.deck!.pres, this.slideIdx + 1, this.slide); this.changed("hist.slide"); this.slideIdx += 1; this.hooks.slide(this.slideIdx); this.render(false); this.hooks.thumbs("all"); }
  deleteSlide() { if (this.readonly || !this.slide || this.slides.length < 2) return; P.removeSlide(this.deck!.pres, this.slide); this.changed("hist.slide"); this.slideIdx = Math.min(this.slideIdx, this.slides.length - 1); this.hooks.slide(this.slideIdx); this.render(false); this.hooks.thumbs("all"); }
  moveSlide(from: number, to: number) { if (this.readonly || from === to || !this.deck) return; const s = this.slides[from]; if (!s) return; P.moveSlide(this.deck.pres, s, to); this.changed("hist.slide"); this.slideIdx = to; this.hooks.slide(to); this.render(false); this.hooks.thumbs("all"); }
  // ── struktur via bus (`slide.*`, `shape.*`) ──
  slideSummaries(): { index: number; title: string; layout: string | null; hidden: boolean; shapes: number; notes: boolean }[] {
    return this.slides.map((s, index) => {
      const l = P.getSlideLayout(s);
      let title = ""; try { title = P.getSlideTitle(s) ?? ""; } catch { /* abaikan */ }
      return { index, title, layout: l ? P.getSlideLayoutName(l) : null, hidden: P.isSlideHidden(s), shapes: P.getSlideShapes(s).length, notes: !!(P.getSlideNotes(s) ?? "") };
    });
  }
  layoutNames(): string[] { return this.deck ? P.getSlideLayouts(this.deck.pres).map(l => P.getSlideLayoutName(l)) : []; }
  /** Pindah ke slide `i` (default: slide aktif); false bila di luar jangkauan. */
  private slideAt(i?: number): boolean {
    if (!this.deck || this.readonly) return false;
    if (i === undefined) return !!this.slide;
    if (!Number.isInteger(i) || i < 0 || i >= this.slides.length) return false;
    if (i !== this.slideIdx) this.goTo(i);
    return true;
  }
  slideDuplicate(i?: number): boolean { if (!this.slideAt(i)) return false; this.duplicateSlide(); return true; }
  slideRemove(i?: number): boolean { if (!this.slideAt(i) || this.slides.length < 2) return false; this.deleteSlide(); return true; }
  slideMove(from: number, to: number): boolean {
    const n = this.slides.length;
    if (!this.deck || this.readonly || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= n || to >= n || from === to) return false;
    this.moveSlide(from, to); return true;
  }
  slideSetBackground(color: string | null, i?: number): boolean { if (!this.slideAt(i)) return false; this.setBackground(color); return true; }
  slideSetNotes(text: string, i?: number): boolean { if (!this.slideAt(i)) return false; this.setNotes(text); return true; }
  slideSetHidden(h: boolean, i?: number): boolean { if (!this.slideAt(i)) return false; this.hideSlide(h); return true; }
  slideSetLayout(name: string, i?: number): boolean {
    if (!this.slideAt(i) || !this.deck) return false;
    const l = P.getSlideLayouts(this.deck.pres).find(x => P.getSlideLayoutName(x) === name);
    if (!l) return false;
    P.setSlideLayout(this.slide!, l); this.changed("hist.slide"); this.render(false); this.hooks.thumbs("all"); return true;
  }

  shapeSummaries(slide?: number): { id: number; name: string; kind: string; text: string; x: number; y: number; w: number; h: number; hidden: boolean }[] {
    const s = this.slides[slide ?? this.slideIdx];
    if (!s || !this.deck) return [];
    return topShapes(s).map(sh => { const b = this.boundsOf(sh); return { id: P.getShapeId(sh), name: P.getShapeName(sh), kind: P.getShapeKind(sh), text: P.getShapeKind(sh) === "shape" ? P.getShapeText(sh) : "", x: Math.round(b.x / PX), y: Math.round(b.y / PX), w: Math.round(b.w / PX), h: Math.round(b.h / PX), hidden: P.isShapeHidden(sh) }; });
  }
  /** Tambah bentuk lewat bus. Posisi/ukuran dalam px slide. Mengembalikan id bentuk baru. */
  shapeAdd(spec: { type: "textbox" | "shape" | "line" | "table" | "chart"; slide?: number; x?: number; y?: number; w?: number; h?: number; text?: string; preset?: PresetShape; rows?: number; cols?: number; chart?: P.ChartKind; arrow?: boolean; fill?: string; fontSize?: number }): number | undefined {
    if (!this.slideAt(spec.slide)) return undefined;
    const slide = this.slide!, px = (v: number) => Math.round(v * PX) as P.Emu;
    const x = spec.x ?? 100, y = spec.y ?? 100;
    let shape: SlideShapeData | undefined;
    if (spec.type === "table") { const before = new Set(topShapes(slide)); this.insertTable(Math.max(1, spec.rows ?? 3), Math.max(1, spec.cols ?? 3)); shape = topShapes(this.slide!).find(s => !before.has(s)); return shape ? P.getShapeId(shape) : undefined; }
    if (spec.type === "chart") { const before = new Set(topShapes(slide)); this.insertChart(spec.chart ?? "bar"); shape = topShapes(this.slide!).find(s => !before.has(s)); return shape ? P.getShapeId(shape) : undefined; }
    if (spec.type === "line") {
      shape = P.addSlideLine(slide, { from: { x: px(x), y: px(y) }, to: { x: px(x + (spec.w ?? 200)), y: px(y + (spec.h ?? 0)) }, color: "#1F2937", widthEmu: 28575 });
      if (spec.arrow) P.setShapeStrokeArrow(shape, "tail", { type: "triangle" });
    } else if (spec.type === "textbox") {
      shape = P.addSlideTextBox(slide, { x: px(x), y: px(y), w: px(spec.w ?? 360), h: px(spec.h ?? 60), text: spec.text ?? "" });
      P.setShapeTextFormat(shape, { size: spec.fontSize ?? 24 });
    } else {
      shape = P.addSlideShape(slide, { preset: spec.preset ?? "rect", x: px(x), y: px(y), w: px(spec.w ?? 220), h: px(spec.h ?? 140), text: spec.text ?? "" });
      P.setShapeFill(shape, (spec.fill ?? this.ctx.theme?.accent1 ?? "#4F81BD") as P.Color);
      P.setShapeStroke(shape, { color: "#FFFFFF", widthEmu: 12700 });
    }
    this.changed("hist.insert"); this.render(false);
    this.sel = [shape]; this.updateOverlay(); this.emit(); this.hooks.thumbs([this.slideIdx]);
    return P.getShapeId(shape);
  }
  private shapesFor(t?: PptxFormatTarget): SlideShapeData[] | undefined {
    if (this.readonly || !this.deck) return undefined;
    const list = this.resolveFormatShapes(t).filter(s => this.ctx.domOf.has(s));
    if (!list.length) return undefined;
    this.select(list);
    return list;
  }
  shapeRemove(t?: PptxFormatTarget): number { const l = this.shapesFor(t); if (!l) return 0; this.deleteSelected(); return l.length; }
  shapeDuplicate(t?: PptxFormatTarget): number { const l = this.shapesFor(t); if (!l) return 0; this.duplicateSelected(); return l.length; }
  shapeAlign(mode: Parameters<PptxView["alignShapes"]>[0], t?: PptxFormatTarget): boolean { if (!this.shapesFor(t)) return false; this.alignShapes(mode); return true; }
  shapeOrder(op: "front" | "back" | "forward" | "backward", t?: PptxFormatTarget): boolean { if (!this.shapesFor(t)) return false; this.zOrder(op); return true; }
  shapeGroup(t?: PptxFormatTarget): boolean { const l = this.shapesFor(t); if (!l || l.length < 2) return false; this.group(); return true; }
  shapeUngroup(t?: PptxFormatTarget): boolean { if (!this.shapesFor(t)) return false; this.ungroup(); return true; }

  hideSlide(h: boolean) { if (this.readonly || !this.slide) return; P.setSlideHidden(this.slide, h); this.changed("hist.slide"); this.emit(); this.hooks.thumbs([this.slideIdx]); }
  changeLayout(name: string) { if (this.readonly || !this.slide) return; const l = P.findSlideLayout(this.deck!.pres, name); if (!l) return; P.setSlideLayout(this.slide, l); this.changed("hist.layout"); this.render(false); this.hooks.thumbs([this.slideIdx]); }
  setBackground(color: string | null) { if (this.readonly || !this.slide) return; if (color) P.setSlideBackground(this.slide, color as P.Color); else P.clearSlideBackground(this.slide); this.changed("hist.background"); this.render(); this.hooks.thumbs([this.slideIdx]); }
  async setBackgroundImage(f: File) { if (this.readonly || !this.slide) return; P.setSlideBackgroundImage(this.slide, new Uint8Array(await f.arrayBuffer())); this.changed("hist.background"); this.render(); this.hooks.thumbs([this.slideIdx]); }
  setNotes(text: string) { if (this.readonly || !this.slide) return; P.setSlideNotes(this.slide, text); this.changed("hist.notes", "hist.notes"); }
  setTransition(o: P.TransitionOptions | null) { if (this.readonly || !this.slide) return; if (o) P.setSlideTransition(this.slide, o); else P.clearSlideTransition(this.slide); this.changed("hist.transition"); this.emit(); }
  applyTransitionAll() { if (this.readonly || !this.slide) return; const t = P.getSlideTransition(this.slide); for (const s of this.slides) { if (t) P.setSlideTransition(s, t as P.TransitionOptions); else P.clearSlideTransition(s); } this.changed("hist.transition"); }

  // ───────── sisip ─────────

  async insertImage(f: File, at?: { x: number; y: number }) {
    if (this.readonly || !this.slide) return;
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      let nat = { w: 400, h: 300 };
      try { const bmp = await createImageBitmap(f); nat = { w: bmp.width, h: bmp.height }; bmp.close(); } catch { /* svg dll. */ }
      const size = P.getSlideSize(this.deck!.pres)!;
      const maxW = size.width * 0.6, maxH = size.height * 0.7;
      const k = Math.min(1, maxW / (nat.w * PX * 0.75), maxH / (nat.h * PX * 0.75));
      const w = Math.round(nat.w * PX * 0.75 * k), h = Math.round(nat.h * PX * 0.75 * k);
      const x = at ? Math.round(at.x * PX - w / 2) : Math.round((size.width - w) / 2), y = at ? Math.round(at.y * PX - h / 2) : Math.round((size.height - h) / 2);
      const s = P.addSlideImage(this.slide, bytes, { x: Math.max(0, x) as P.Emu, y: Math.max(0, y) as P.Emu, w: w as P.Emu, h: h as P.Emu, name: f.name.replace(/\.[^.]+$/, "") });
      this.changed("hist.insert"); this.render(false); this.sel = [s]; this.updateOverlay(); this.emit(); this.hooks.thumbs([this.slideIdx]);
    } catch (e) { this.hooks.log("error", "log.imgInsertFail", { msg: e instanceof Error ? e.message : String(e) }); this.hooks.toast("toast.imgFail", { name: f.name }); }
  }
  async replaceImage(f: File) { const s = this.sel[0]; if (this.readonly || !s || P.getShapeKind(s) !== "picture") return; P.setShapeImage(s, new Uint8Array(await f.arrayBuffer())); this.changed("hist.image"); this.rerenderShape(s); this.hooks.thumbs([this.slideIdx]); this.scheduleEmit(); }
  imageProps(o: { crop?: { left?: number; top?: number; right?: number; bottom?: number } | null; brightness?: number | null; contrast?: number | null; opacity?: number | null }) {
    this.apply("hist.image", s => {
      if (P.getShapeKind(s) !== "picture") return;
      if (o.crop !== undefined) P.setShapeImageCrop(s, o.crop);
      if (o.brightness !== undefined) P.setShapeImageBrightness(s, o.brightness);
      if (o.contrast !== undefined) P.setShapeImageContrast(s, o.contrast);
      if (o.opacity !== undefined) P.setShapeImageOpacity(s, o.opacity);
    });
  }
  insertTable(rows: number, cols: number) {
    if (this.readonly || !this.slide) return;
    const size = P.getSlideSize(this.deck!.pres)!;
    const w = Math.round(size.width * 0.7), h = Math.round(Math.min(size.height * 0.6, rows * IN(0.5)));
    const t = P.addSlideTable(this.slide, { x: Math.round((size.width - w) / 2) as P.Emu, y: Math.round(size.height * 0.25) as P.Emu, w: w as P.Emu, h: h as P.Emu, rows: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (r === 0 ? `${c + 1}` : ""))), firstRow: true, bandRow: true });
    this.changed("hist.insert"); this.render(false); this.sel = [t]; this.updateOverlay(); this.emit(); this.hooks.thumbs([this.slideIdx]);
  }
  insertChart(kind: P.ChartKind) {
    if (this.readonly || !this.slide) return;
    const size = P.getSlideSize(this.deck!.pres)!;
    const w = Math.round(size.width * 0.55), h = Math.round(size.height * 0.55);
    const cats = ["A", "B", "C", "D"];
    const series = kind === "pie" || kind === "doughnut" ? [{ name: "S1", values: [40, 25, 20, 15] }] : [{ name: "S1", values: [30, 45, 38, 60] }, { name: "S2", values: [20, 35, 50, 40] }];
    const spec = (kind === "scatter" ? { kind: "scatter", series: [{ name: "S1", xValues: [1, 2, 3, 4], values: [2, 5, 3, 6] }] } : { kind, categories: cats, series }) as unknown as P.ChartSpec;
    const c = P.addSlideChart(this.slide, { spec, x: Math.round((size.width - w) / 2) as P.Emu, y: Math.round((size.height - h) / 2) as P.Emu, w: w as P.Emu, h: h as P.Emu });
    this.changed("hist.insert"); this.render(false); this.sel = [c]; this.updateOverlay(); this.emit(); this.hooks.thumbs([this.slideIdx]);
  }
  chartSpecPatch(patch: Record<string, unknown>) {
    const s = this.sel[0];
    if (this.readonly || !s || !P.isChartShape(s)) return;
    const charts = P.getSlideCharts(this.slide!);
    const ch = charts.find(c => c.shape === s);
    const cur = P.getShapeChartSpec(s);
    if (!ch || !cur) return;
    P.setChartSpec(ch, { ...(cur as unknown as P.ChartSpec), ...patch } as P.ChartSpec);
    this.changed("hist.chart"); this.rerenderShape(s); this.hooks.thumbs([this.slideIdx]); this.scheduleEmit();
  }

  // tabel
  tableOp(op: string, arg?: unknown) {
    const s = this.sel[0];
    if (this.readonly || !s || !P.isTableShape(s)) return;
    const cs = this.cellSel ?? { row: 0, col: 0 };
    const cell = () => P.getTableCell(s, cs.row, cs.col);
    try {
      switch (op) {
        case "rowAbove": P.insertTableRow(s, cs.row); break;
        case "rowBelow": P.insertTableRow(s, cs.row + 1); break;
        case "colLeft": P.insertTableColumn(s, cs.col); break;
        case "colRight": P.insertTableColumn(s, cs.col + 1); break;
        case "delRow": if (P.getTableDimensions(s).rows > 1) P.removeTableRow(s, cs.row); break;
        case "delCol": if (P.getTableDimensions(s).cols > 1) P.removeTableColumn(s, cs.col); break;
        case "delTable": this.deleteSelected(); return;
        case "merge": { const a = arg as { rowSpan: number; colSpan: number } | undefined; P.mergeTableCells(s, { row: cs.row, col: cs.col, rowSpan: a?.rowSpan ?? 1, colSpan: a?.colSpan ?? 2 }); break; }
        case "fill": if (arg === null) P.clearTableCellFill(cell()); else P.setTableCellFill(cell(), arg as P.Color); break;
        case "anchor": P.setTableCellAnchor(cell(), arg as "top" | "center" | "bottom"); break;
        case "flags": P.setTableStyleFlags(s, arg as Parameters<typeof P.setTableStyleFlags>[1]); break;
        case "border": { const a = arg as { color: string; widthPt: number }; P.setTableCellBorders(cell(), { left: { color: a.color, widthEmu: Math.round(a.widthPt * 12700) }, right: { color: a.color, widthEmu: Math.round(a.widthPt * 12700) }, top: { color: a.color, widthEmu: Math.round(a.widthPt * 12700) }, bottom: { color: a.color, widthEmu: Math.round(a.widthPt * 12700) } }); break; }
        case "colW": P.setTableColumnWidth(s, cs.col, Math.round((arg as number) * 360000) as P.Emu); break;
        case "rowH": P.setTableRowHeight(s, cs.row, Math.round((arg as number) * 360000) as P.Emu); break;
        default: return;
      }
    } catch (e) { this.hooks.log("error", "log.opFail", { op: `table.${op}`, msg: e instanceof Error ? e.message : String(e) }); this.hooks.toast("toast.opFail"); return; }
    this.changed("hist.table"); this.rerenderShape(s); this.hooks.thumbs([this.slideIdx]); this.scheduleEmit();
  }

  // ───────── format painter ─────────

  startPainter() {
    const s = this.sel[0];
    if (!s || this.readonly) return;
    const i = this.info().shape!;
    let fmt: ReadTextFormat | null = null;
    try { for (let k = 0; k < P.getShapeParagraphCount(s); k++) if (P.getShapeRunCount(s, k) > 0) { fmt = P.getShapeRunFormatEffective(this.deck!.pres, s, k, 0); break; } } catch { /* abaikan */ }
    this.painterClip = { fill: i.fill, stroke: i.stroke, strokeW: i.strokeW, fmt, align: i.fmt?.align ?? null };
    const items: [string, string][] = [];
    if (i.fill) items.push(["fill", i.fill]);
    if (i.stroke) items.push(["stroke", `${i.stroke} ${Math.round(((i.strokeW ?? 12700) / 12700) * 10) / 10}pt`]);
    if (fmt?.font) items.push(["font", fmt.font]);
    if (fmt?.size) items.push(["size", `${fmt.size} pt`]);
    if (fmt?.bold) items.push(["bold", "✓"]);
    if (fmt?.italic) items.push(["italic", "✓"]);
    if (fmt?.color) items.push(["color", fmt.color]);
    if (i.fmt?.align) items.push(["align", i.fmt.align]);
    this.host.classList.add("px-painter");
    this.hooks.painter({ items });
  }
  cancelPainter() { this.painterClip = null; this.host.classList.remove("px-painter"); this.hooks.painter(null); }
  private applyPainter(target: SlideShapeData) {
    const c = this.painterClip;
    if (!c) return;
    try {
      if (c.fill) P.setShapeFill(target, c.fill as P.Color); else if (P.getShapeKind(target) === "shape") P.setShapeNoFill(target);
      if (c.stroke) P.setShapeStroke(target, { color: c.stroke as P.Color, widthEmu: c.strokeW ?? 12700 }); else P.setShapeNoStroke(target);
      if (c.fmt && P.getShapeKind(target) === "shape") {
        const f: TextFormat = { font: c.fmt.font, size: c.fmt.size, bold: !!c.fmt.bold, italic: !!c.fmt.italic, underline: !!c.fmt.underline, color: (c.fmt.color ?? undefined) as P.Color | undefined };
        P.setShapeTextFormat(target, f);
        if (c.align) P.setShapeAlignment(target, (c.align === "ctr" ? "center" : c.align === "r" ? "right" : c.align === "l" ? "left" : c.align) as P.ParagraphAlignment);
      }
    } catch (e) { this.hooks.log("error", "log.opFail", { op: "painter", msg: e instanceof Error ? e.message : String(e) }); }
    this.cancelPainter();
    this.changed("hist.painter"); this.rerenderShape(target); this.select([target]); this.hooks.thumbs([this.slideIdx]);
  }

  // ───────── navigasi & cari/ganti lintas jenis (event bus) ─────────

  private fcur = createFindCursor<{ m: FindMatch; unit: PptxUnit; start: number; end: number }>();
  private resolveColor = (c: string | null | undefined) => themeColor(this.ctx, c);

  /** Cari lintas jenis: `text` (run/sel tabel), `notes`, `link` (URL), `name`. Hasil pertama disorot kecuali `select === false`. */
  findMatches(spec: FindSpec): FindResult {
    const empty: FindResult = { query: spec.query, count: 0, matches: [], current: -1 };
    if (!this.deck || !spec.query) { this.clearSearch(); this.fcur.clear(); return empty; }
    const all: ReplaceKind[] = ["text", "notes", "link", "name"];
    const kinds = (spec.kinds?.length ? spec.kinds.filter(k => all.includes(k)) : all) as ReplaceKind[];
    const { re, error } = compileFind(spec);
    if (!re) return { ...empty, error };
    const limit = spec.limit ?? 2000;
    const items: { m: FindMatch; unit: PptxUnit; start: number; end: number }[] = [];
    let truncated = false;
    outer: for (const u of collectUnits(this.slides, kinds, topShapes)) {
      for (const r of matchRanges(u.text, re)) {
        if (items.length >= limit) { truncated = true; break outer; }
        items.push({
          m: { index: items.length, kind: u.kind, text: u.text.slice(r.start, r.end), ...snippet(u.text, r.start, r.end), location: `Slide ${u.slide + 1} · ${u.where}`, target: u.kind === "notes" ? { kind: "notes", slide: u.slide } : { kind: "shape", slide: u.slide, id: u.shapeId } },
          unit: u, start: r.start, end: r.end,
        });
      }
    }
    this.fcur.set(items, -1);
    this.hits = items.map((it, i) => ({ index: i, slide: it.unit.slide, shapeId: it.unit.shapeId, where: it.unit.where, text: it.m.text, before: it.m.before, after: it.m.after, start: it.start, end: it.end }));
    this.hitCur = -1; this.markHits();
    const res: FindResult = { query: spec.query, count: items.length, matches: items.map(i => i.m), truncated, current: -1 };
    if (spec.select !== false && items.length) res.current = this.findStep(1)?.index ?? -1;
    return res;
  }
  findStep(dir: 1 | -1): FindMatch | undefined {
    const it = this.fcur.step(dir);
    if (!it) return undefined;
    this.gotoHit(this.fcur.index);
    return it.m;
  }
  findClear() { this.fcur.clear(); this.clearSearch(); }
  get findIndex() { return this.fcur.index; }

  /** Pindahkan fokus ke slide/bentuk/catatan/tautan/hasil cari. */
  gotoTarget(t: PptxNavTarget): NavEvent {
    const fail = (): NavEvent => ({ target: t, ok: false });
    if (!this.deck) return fail();
    const n = this.slides.length;
    const toSlide = (i: number): boolean => { if (!Number.isInteger(i) || i < 0 || i >= n) return false; this.goTo(i); return true; };
    const toShape = (si: number, id?: number, name?: string): SlideShapeData | undefined => {
      const slide = this.slides[si];
      if (!slide) return undefined;
      let sh: SlideShapeData | undefined = id !== undefined && id >= 0 ? P.findShapeById(slide, id) ?? undefined : undefined;
      if (!sh && name) sh = P.getSlideShapes(slide).find(s => P.getShapeName(s).toLowerCase() === name.toLowerCase()) ?? P.getSlideShapes(slide).find(s => P.getShapeName(s).toLowerCase().includes(name.toLowerCase()));
      return sh;
    };
    const focus = (si: number, sh?: SlideShapeData): boolean => {
      if (!toSlide(si)) return false;
      if (sh) { const top = topShapes(this.slide!).find(x => x === sh || (P.getShapeKind(x) === "group" && P.getGroupChildren(x).includes(sh))); if (top && this.ctx.domOf.has(top)) this.select([top]); }
      else this.select([]);
      return true;
    };
    switch (t.kind) {
      case "slide": return toSlide(t.index) ? { target: t, ok: true, label: `${t.index + 1}/${n}` } : fail();
      case "first": return toSlide(0) ? { target: t, ok: true, label: `1/${n}` } : fail();
      case "last": return toSlide(n - 1) ? { target: t, ok: true, label: `${n}/${n}` } : fail();
      case "next": return toSlide(Math.min(n - 1, this.slideIdx + 1)) ? { target: t, ok: true, label: `${this.slideIdx + 1}/${n}` } : fail();
      case "prev": return toSlide(Math.max(0, this.slideIdx - 1)) ? { target: t, ok: true, label: `${this.slideIdx + 1}/${n}` } : fail();
      case "shape": {
        const si = t.slide ?? this.slideIdx;
        const sh = toShape(si, t.id, t.name);
        return sh && focus(si, sh) ? { target: t, ok: true, label: `${si + 1}/${n} · ${P.getShapeName(sh)}` } : fail();
      }
      case "notes": { const si = t.slide ?? this.slideIdx; return focus(si) ? { target: t, ok: true, label: `${si + 1}/${n} · notes` } : fail(); }
      case "link": {
        const l = listLinks(this.slides, topShapes).find(x => x.id === t.id);
        const tg = l?.target as { slide?: number; id?: number } | undefined;
        if (!l || tg?.slide === undefined) return fail();
        return focus(tg.slide, toShape(tg.slide, tg.id)) ? { target: t, ok: true, label: l.url } : fail();
      }
      case "search": {
        const r = this.findMatches({ query: t.query, regex: t.regex, caseSensitive: t.caseSensitive, wholeWord: t.wholeWord, select: false });
        const i = t.occurrence ?? 0;
        if (!r.count || i < 0 || i >= r.count) return fail();
        this.fcur.index = i - 1;
        this.findStep(1);
        return { target: t, ok: true, label: `${i + 1}/${r.count}` };
      }
      case "match": {
        if (!this.fcur.items[t.index]) return fail();
        this.fcur.index = t.index - 1;
        this.findStep(1);
        return { target: t, ok: true, label: `${t.index + 1}/${this.fcur.items.length}` };
      }
    }
  }

  /**
   * Ganti berdasarkan jenis, satu entri riwayat. `text`/`notes`/`link`/`name`: `query` teks/regex (cocokkan per run — teks yang terbelah
   * antar run tidak terganti). `font`/`color`/`fill`/`stroke`: `query` nilai persis, `replacement` kosong = hapus warna.
   */
  replaceKinds(spec: ReplaceSpec, onlyCurrent = false): ReplaceReport {
    const kinds = (spec.kinds?.length ? spec.kinds : ["text"]) as ReplaceKind[];
    const rep = (counts: Partial<Record<ReplaceKind, number>>) => makeReport(kinds, PPTX_REPLACE_KINDS, counts);
    if (!this.deck || this.readonly || !spec.query) return { ...rep({}), error: this.readonly ? "readonly" : undefined };
    this.commitEdit();
    const supported = kinds.filter(k => PPTX_REPLACE_KINDS.includes(k));
    const strKinds = supported.filter(k => !isValueKind(k));
    const valKinds = supported.filter(isValueKind) as ("font" | "color" | "fill" | "stroke")[];
    const counts: Partial<Record<ReplaceKind, number>> = {};
    const { re } = compileFind(spec);
    const sub = (text: string) => (re ? replaceInString(text, re, spec.replacement, !!spec.regex) : { text, count: 0 });
    if (onlyCurrent && !valKinds.length) {
      if (!this.fcur.items.length) this.findMatches({ ...spec, kinds: strKinds, select: false });
      const cur = this.fcur.current ?? this.fcur.items[0];
      if (!cur || !re) return rep({});
      const single = new RegExp(re.source, re.flags.replace("g", ""));
      const seg = cur.unit.text.slice(cur.start, cur.end);
      const out = cur.unit.text.slice(0, cur.start) + (spec.regex ? seg.replace(single, spec.replacement) : spec.replacement) + cur.unit.text.slice(cur.end);
      if ((cur.unit.kind === "link" || cur.unit.kind === "name") && !out.trim()) return rep({});
      cur.unit.set(out);
      counts[cur.unit.kind] = 1;
    } else {
      if (strKinds.length && re) {
        for (const u of collectUnits(this.slides, strKinds, topShapes)) {
          const r = sub(u.text);
          if (!r.count || r.text === u.text) continue;
          if ((u.kind === "link" || u.kind === "name") && !r.text.trim()) continue;
          u.set(r.text);
          counts[u.kind] = (counts[u.kind] ?? 0) + r.count;
        }
      }
      for (const k of valKinds) counts[k] = replaceValues(this.deck.pres, this.slides, topShapes, this.resolveColor, k, spec.query, spec.replacement);
    }
    const report = rep(counts);
    if (report.total) { this.changed("hist.replace"); this.fcur.clear(); this.clearSearch(); this.render(); this.hooks.thumbs("all"); }
    return report;
  }
  countValue(kind: "font" | "color" | "fill" | "stroke", value: string): number {
    return this.deck ? countValues(this.deck.pres, this.slides, topShapes, this.resolveColor, kind, value) : 0;
  }

  // ───────── hyperlink ─────────

  linkItems(): LinkItem[] { return this.deck ? listLinks(this.slides, topShapes) : []; }
  private linkUnit(id: string): PptxUnit | undefined {
    const units = collectUnits(this.slides, ["link"], topShapes);
    const i = Number(id.split(":")[2]);
    const u = units[i];
    return u && id.startsWith(`${u.slide}:${u.shapeId}:`) ? u : undefined;
  }
  updateLink(id: string, patch: { url?: string }): boolean {
    if (this.readonly || !patch.url) return false;
    const u = this.linkUnit(id);
    if (!u) return false;
    u.set(patch.url);
    this.changed("hist.link"); this.render(false); this.hooks.thumbs([u.slide]);
    return true;
  }
  removeLinkById(id: string): boolean {
    if (this.readonly) return false;
    const u = this.linkUnit(id);
    if (!u) return false;
    u.set("");
    this.changed("hist.link"); this.render(false); this.hooks.thumbs([u.slide]);
    return true;
  }
  /** Ganti URL massal. Mengembalikan jumlah tautan yang berubah. */
  replaceLinks(spec: { query: string; regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean }, replacement: string): number {
    if (this.readonly) return 0;
    const r = this.replaceKinds({ ...spec, replacement, kinds: ["link"] });
    return r.byKind.link ?? 0;
  }

  // ───────── impor elemen DOM ─────────

  /**
   * Impor elemen DOM (selector CSS atau Element) ke slide sebagai gambar (`image`), bentuk asli (`shapes`), atau otomatis.
   * Tanpa `x/y/w/h`, hasil dimuat ke slide dengan margin 5% dan di tengah.
   */
  async importDom(source: string | Element, o: DomImportOptions = {}): Promise<DomImportResult> {
    if (this.readonly) throw new Error("Mode baca-saja: impor DOM tidak diizinkan.");
    if (!this.deck) throw new Error("Tidak ada presentasi yang terbuka.");
    const el = typeof source === "string" ? document.querySelector(source) : source;
    if (!el) throw new Error(`Elemen tidak ditemukan: ${String(source)}`);
    this.commitEdit();
    const si = o.slide ?? this.slideIdx;
    if (si < 0 || si >= this.slides.length) throw new Error(`Slide ${si} tidak ada.`);
    if (si !== this.slideIdx) this.goTo(si);
    const slide = this.slide!;
    const size = P.getSlideSize(this.deck.pres)!;
    const SW = size.width / PX, SH = size.height / PX;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) throw new Error("Elemen tidak terlihat (ukuran 0).");
    const bw = o.w ?? SW * 0.9, bh = o.h ?? SH * 0.9;
    const fit = o.fit !== false;
    const kx = bw / rect.width, ky = bh / rect.height;
    const k = fit ? Math.min(kx, ky) : kx;
    const w = rect.width * k, h = fit ? rect.height * k : rect.height * ky;
    const x = o.x ?? (SW - w) / 2, y = o.y ?? (SH - h) / 2;
    const emu = (v: number) => Math.round(v * PX) as P.Emu;
    const maxShapes = o.maxShapes ?? 250;
    let mode: "image" | "shapes";
    const plan = o.mode === "image" ? null : planDom(el, maxShapes);
    if (o.mode === "image") mode = "image";
    else if (o.mode === "shapes") mode = "shapes";
    else mode = plan && !plan.complex && plan.items.length > 0 && plan.items.length <= maxShapes ? "shapes" : "image";
    const added: SlideShapeData[] = [];
    const sel = typeof source === "string" ? source : undefined;
    if (mode === "image") {
      const png = await elementToPng(el, { pixelRatio: o.pixelRatio, background: o.background });
      added.push(P.addSlideImage(slide, png.bytes, { x: emu(x), y: emu(y), w: emu(w), h: emu(h), name: o.name ?? (sel ? `DOM ${sel}` : "DOM") }));
    } else {
      for (const it of plan!.items) {
        const ix = x + it.x * k, iy = y + it.y * (fit ? k : ky), iw = Math.max(1, it.w * k), ih = Math.max(1, it.h * (fit ? k : ky));
        try {
          if (it.type === "rect") {
            const s = P.addSlideShape(slide, { preset: it.round ? "roundRect" : "rect", x: emu(ix), y: emu(iy), w: emu(iw), h: emu(ih) });
            if (it.fill) { P.setShapeFill(s, it.fill as P.Color); if (it.fillAlpha < 1) setFillAlpha(s, it.fillAlpha); } else P.setShapeNoFill(s);
            if (it.stroke) P.setShapeStroke(s, { color: it.stroke as P.Color, widthEmu: Math.max(3175, Math.round(it.strokeW * k * PX)) }); else P.setShapeNoStroke(s);
            added.push(s);
          } else if (it.type === "text") {
            const s = P.addSlideTextBox(slide, { x: emu(ix), y: emu(iy), w: emu(iw), h: emu(ih), text: it.text });
            added.push(s);
            P.setShapeTextFormat(s, { size: Math.max(6, Math.round(it.sizePt * k * 2) / 2), bold: it.bold, italic: it.italic, underline: it.underline, color: it.color as P.Color, ...(it.font ? { font: it.font } : {}) });
            P.setShapeAlignment(s, it.align);
          } else if (it.type === "image") {
            const bytes = await loadImageBytes(it.src, it.svg, iw, ih);
            if (bytes) added.push(P.addSlideImage(slide, bytes, { x: emu(ix), y: emu(iy), w: emu(iw), h: emu(ih), name: "DOM image" }));
          } else if (it.type === "table") {
            const cols = Math.max(...it.rows.map(r => r.length), 1);
            const rows = it.rows.map(r => Array.from({ length: cols }, (_, c) => r[c] ?? ""));
            added.push(P.addSlideTable(slide, { x: emu(ix), y: emu(iy), w: emu(iw), h: emu(ih), rows, firstRow: true, bandRow: true }));
          }
        } catch (e) { this.hooks.log("error", "log.opFail", { op: "import-dom", msg: e instanceof Error ? e.message : String(e) }); }
      }
      if (!added.length) throw new Error("Tidak ada konten yang dapat diimpor dari elemen ini.");
    }
    const ids = added.map(s => P.getShapeId(s));
    let result: SlideShapeData[] = added;
    if (mode === "shapes" && added.length > 1 && o.group !== false) { try { result = [P.groupShapes(added)]; } catch { /* biarkan tanpa grup */ } }
    this.changed("hist.import"); this.render(false);
    this.sel = result.filter(s => this.ctx.domOf.has(s)); this.updateOverlay(); this.emit(); this.hooks.thumbs([this.slideIdx]);
    return { mode, added: added.length, slide: this.slideIdx, selector: sel, ids };
  }

  /** Opasitas isi / garis / teks bentuk terpilih (null = opak atau tidak seragam). */
  alphaInfo(): { fill: number | null; stroke: number | null; text: number | null } {
    const s = this.sel[0];
    if (!s) return { fill: null, stroke: null, text: null };
    return { fill: P.getShapeFillOpacity(s) ?? null, stroke: P.getShapeStrokeOpacity(s) ?? null, text: textAlphaOf(s) };
  }

  // ───────── cari & ganti ─────────

  private compile(o: FindOpts): { re: RegExp | null; error?: string } {
    if (!o.query) return { re: null };
    try {
      let src = o.regex ? o.query : o.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (o.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
      return { re: new RegExp(src, "gu" + (o.caseSensitive ? "" : "i")) };
    } catch (e) { return { re: null, error: e instanceof Error ? e.message : String(e) }; }
  }

  search(o: FindOpts): { hits: FindHit[]; error?: string } {
    this.hits = []; this.hitCur = -1;
    const { re, error } = this.compile(o);
    if (!re || !this.deck) { this.markHits(); return { hits: [], error }; }
    const slides = this.slides;
    const push = (si: number, shape: SlideShapeData | null, where: string, text: string) => {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        const s = m.index, e = s + m[0].length;
        this.hits.push({ index: this.hits.length, slide: si, shapeId: shape ? P.getShapeId(shape) : -1, where, text: m[0], before: text.slice(Math.max(0, s - 24), s).replace(/\s+/g, " "), after: text.slice(e, e + 24).replace(/\s+/g, " "), start: s, end: e });
        if (this.hits.length >= 3000) return;
      }
    };
    slides.forEach((slide, si) => {
      for (const s of topShapes(slide)) {
        if (this.hits.length >= 3000) return;
        try {
          if (P.isTableShape(s)) { const d = P.getTableDimensions(s); for (let r = 0; r < d.rows; r++) for (let c = 0; c < d.cols; c++) push(si, s, `T ${r + 1}×${c + 1}`, P.getTableCellText(P.getTableCell(s, r, c))); }
          else if (P.getShapeKind(s) === "group") for (const ch of P.getGroupChildren(s)) push(si, s, P.getShapeName(ch), P.getShapeText(ch));
          else push(si, s, P.getShapeName(s), P.getShapeText(s));
        } catch { /* abaikan */ }
      }
      const notes = P.getSlideNotes(slide);
      if (notes) push(si, null, "notes", notes);
    });
    this.markHits();
    return { hits: this.hits };
  }
  clearSearch() { this.hits = []; this.hitCur = -1; this.markHits(); }
  gotoHit(i: number) {
    const h = this.hits[i];
    if (!h) return;
    this.hitCur = i;
    if (h.slide !== this.slideIdx) this.goTo(h.slide);
    const shape = h.shapeId >= 0 ? P.findShapeById(this.slide!, h.shapeId) : null;
    if (shape && this.ctx.domOf.has(shape)) this.select([shape]);
    this.markHits();
  }
  private markHits() {
    this.slideEl?.querySelectorAll(".px-hit,.px-hit-cur").forEach(e => e.classList.remove("px-hit", "px-hit-cur"));
    if (!this.slideEl || !this.hits.length) return;
    this.hits.forEach((h, i) => {
      if (h.slide !== this.slideIdx || h.shapeId < 0) return;
      const shape = P.findShapeById(this.slide!, h.shapeId);
      const dom = shape ? this.ctx.domOf.get(shape) : null;
      dom?.classList.add(i === this.hitCur ? "px-hit-cur" : "px-hit");
    });
  }
  replaceHits(hits: FindHit[], o: FindOpts, repl: string): number {
    if (this.readonly || !this.deck) return 0;
    const { re } = this.compile(o);
    if (!re) return 0;
    const one = new RegExp(re.source, re.flags.replace("g", ""));
    let n = 0;
    const doShape = (shape: SlideShapeData) => {
      const np = P.getShapeParagraphCount(shape);
      for (let p = 0; p < np; p++) for (let r = 0; r < P.getShapeRunCount(shape, p); r++) {
        const t = P.getShapeRunText(shape, p, r);
        re.lastIndex = 0;
        const nt = t.replace(re, m => { n++; return o.regex ? m.replace(one, repl) : repl; });
        if (nt !== t) P.setShapeRunText(shape, p, r, nt);
      }
    };
    const seen = new Set<string>();
    for (const h of hits) {
      const key = `${h.slide}:${h.shapeId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const slide = this.slides[h.slide];
      if (!slide) continue;
      if (h.shapeId < 0) { const nt = (P.getSlideNotes(slide) ?? "").replace(re, m => { n++; return o.regex ? m.replace(one, repl) : repl; }); P.setSlideNotes(slide, nt); continue; }
      const shape = P.findShapeById(slide, h.shapeId);
      if (!shape) continue;
      if (P.isTableShape(shape)) { const d = P.getTableDimensions(shape); for (let r = 0; r < d.rows; r++) for (let c = 0; c < d.cols; c++) { const cell = P.getTableCell(shape, r, c); const t = P.getTableCellText(cell); re.lastIndex = 0; const nt = t.replace(re, m => { n++; return o.regex ? m.replace(one, repl) : repl; }); if (nt !== t) P.setTableCellText(cell, nt); } }
      else if (P.getShapeKind(shape) === "group") for (const ch of P.getGroupChildren(shape)) doShape(ch);
      else doShape(shape);
    }
    this.changed("hist.replace"); this.render(); this.hooks.thumbs("all");
    return n;
  }

  // ───────── debug ─────────

  debug(): Record<string, unknown> {
    const deck = this.deck;
    if (!deck) return {};
    const out: Record<string, unknown> = { slide: this.slideIdx + 1, slides: this.slides.length, zoom: this.zoom, selection: this.sel.map(s => P.getShapeId(s)), history: { index: deck.histIdx, length: deck.hist.length, max: deck.maxHistory }, readonly: this.readonly };
    if (this.slide) out.slideXml = P.getSlideXmlString(this.slide).slice(0, 6000);
    if (this.sel[0]) { const s = this.sel[0]; out.shapeXml = P.getShapeXmlString(s).slice(0, 5000); try { out.effective = { bounds: P.getShapeBoundsResolved(deck.pres, s), fill: P.getShapeFillEffective(deck.pres, s), stroke: P.getShapeStrokeEffective(deck.pres, s), effects: P.getShapeEffectsEffective(deck.pres, s), body: P.getShapeBodyPrEffective(deck.pres, s) }; } catch { /* abaikan */ } }
    return out;
  }

  private applyGrid() { this.slideEl?.classList.toggle("px-grid", this.showGrid); }
  setGrid(v: boolean) { this.showGrid = v; this.applyGrid(); }
}
