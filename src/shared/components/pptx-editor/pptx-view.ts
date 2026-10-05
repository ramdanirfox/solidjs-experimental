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
    P.setShapeBounds(sh, { x: b.x, y: b.y, w: Math.round(wPx * PX), h: Math.round(hPx * PX) });
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
  setFill(color: string | null) { this.apply("hist.fill", s => { if (color === null) P.setShapeNoFill(s); else P.setShapeFill(s, color as P.Color); }); }
  setGradient(c1: string, c2: string, angle = 90) { this.apply("hist.fill", s => P.setShapeGradientFill(s, { stops: [{ offset: 0, color: c1 as P.Color }, { offset: 1, color: c2 as P.Color }], angleDeg: angle })); }
  setStroke(o: { color?: string | null; widthPt?: number; dash?: P.LineDash }) {
    this.apply("hist.stroke", s => {
      if (o.color === null) { P.setShapeNoStroke(s); return; }
      if (o.color || o.widthPt) P.setShapeStroke(s, { ...(o.color ? { color: o.color as P.Color } : {}), ...(o.widthPt ? { widthEmu: Math.round(o.widthPt * 12700) } : {}) });
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
  setHyperlink(url: string | null) { this.apply("hist.link", s => P.setShapeHyperlink(s, url)); }
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
  private parseEdit(host: HTMLElement, base: ReadTextFormat | null, scale = 1): { align: string | null; runs: { text: string; format: TextFormat }[] }[] {
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
    const baseSize = base?.size ?? 18;
    const result: { align: string | null; runs: { text: string; format: TextFormat }[] }[] = [];
    for (const p of paras) {
      const runs: { text: string; format: TextFormat }[] = [];
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
          const px = parseFloat(st.fontSize);
          const size = Math.round(((px * 72) / 96 / scale) * 10) / 10;
          if (Math.abs(size - baseSize) > 0.3) f.size = size;
          const bold = parseInt(st.fontWeight) >= 600, italic = st.fontStyle === "italic";
          if (bold !== !!base?.bold) f.bold = bold;
          if (italic !== !!base?.italic) f.italic = italic;
          const ul = /underline/.test(st.textDecorationLine), stk = /line-through/.test(st.textDecorationLine);
          if (ul !== !!base?.underline) f.underline = ul;
          if (stk !== (!!base?.strike && base.strike !== "noStrike")) f.strike = stk;
          const col = this.rgbHex(st.color);
          if (col && col !== (base?.color ? themeColor(this.ctx, base.color)?.toUpperCase() : "#000000")) f.color = col as P.Color;
          const prev = runs[runs.length - 1];
          if (prev && JSON.stringify(prev.format) === JSON.stringify(f)) prev.text += text; else runs.push({ text, format: f });
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
          P.setShapeParagraphs(ed.shape, parsed.map(p => ({ align: this.toAlign(p.align), runs: p.runs })));
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
    if (f.color) { ex("styleWithCSS", "true"); ex("foreColor", f.color as string); }
    if (f.size) {
      ex("fontSize", "7");
      this.editing.host.querySelectorAll<HTMLElement>("font[size='7']").forEach(el => { el.removeAttribute("size"); el.style.fontSize = `${(f.size! * 96) / 72}px`; });
    }
    this.editing.changed = true;
  }

  // ───────── slide ─────────

  addSlide(layoutName?: string) {
    if (this.readonly || !this.deck) return;
    const pres = this.deck.pres;
    const layouts = P.getSlideLayouts(pres);
    const layout = layoutName ? layouts.find(l => P.getSlideLayoutName(l) === layoutName) : (this.slide ? P.getSlideLayout(this.slide) : null) ?? layouts[layouts.length - 1];
    if (!layout) return;
    const s = P.addSlideAt(pres, this.slideIdx + 1, { layout });
    void s;
    this.changed("hist.slide");
    this.slideIdx += 1;
    this.hooks.slide(this.slideIdx); this.render(false); this.hooks.thumbs("all");
  }
  duplicateSlide() { if (this.readonly || !this.slide) return; P.duplicateSlideAt(this.deck!.pres, this.slideIdx + 1, this.slide); this.changed("hist.slide"); this.slideIdx += 1; this.hooks.slide(this.slideIdx); this.render(false); this.hooks.thumbs("all"); }
  deleteSlide() { if (this.readonly || !this.slide || this.slides.length < 2) return; P.removeSlide(this.deck!.pres, this.slide); this.changed("hist.slide"); this.slideIdx = Math.min(this.slideIdx, this.slides.length - 1); this.hooks.slide(this.slideIdx); this.render(false); this.hooks.thumbs("all"); }
  moveSlide(from: number, to: number) { if (this.readonly || from === to || !this.deck) return; const s = this.slides[from]; if (!s) return; P.moveSlide(this.deck.pres, s, to); this.changed("hist.slide"); this.slideIdx = to; this.hooks.slide(to); this.render(false); this.hooks.thumbs("all"); }
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
