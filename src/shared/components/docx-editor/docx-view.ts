/**
 * Controller imperatif editor DOCX: merender body ke "kertas", memetakan seleksi DOM ⇄ model XML, menangani input
 * (ketik, Enter, hapus, tempel), format, tabel, gambar, format painter, pencarian, dan riwayat undo/redo.
 * UI (toolbar, panel) berada di DocxEditor.tsx dan hanya memanggil metode kelas ini.
 */
import { attr, cloneEl, descendAll, els, first, isEl, mk, removeNode, serialize, setAttr, val, type XEl } from "./docx-xml";
import { DocxBook, walkBlocks, type Section } from "./docx-model";
import {
  Registry, condForCell, condForParagraph, fillBlocks, fillParagraph, refreshNumbering, renderParagraph, renderTable, type RenderCtx,
} from "./docx-render";
import { Paginator, geomOf } from "./docx-paginate";
import { domFlatText, domOffsetToFlat, flatToDomPos, rangeFromFlat } from "./docx-dom";
import {
  applyMarkPatch, applyParaPatch, applyRunPatch, deleteRange, flatLength, flatText, insertRunAt, mergeParagraphs, normalize, paragraphNum, replaceRange, runProps, runsInRange, splitParagraph, units,
  type PPatch, type RunPatch,
} from "./docx-text";
import {
  applyFormat, captureFormat, changeIndent, clearFormatRange, deleteBlock, deleteSpan, extractFragment, insertImageAt, insertLineBreak, insertPageBreak, insertPlainText, insertTableAfter, linkAt,
  pasteFragment, toggleList, transformText, unlinkRange, wrapRunsInLink, type FormatClip,
} from "./docx-ops";
import { buildGrid, type GCell, type Grid, type Rect } from "./docx-table";
import * as T from "./docx-table";
import { cloneDrawing, maxDocPrId, readDrawing, replaceBlip, setAlt, setCrop, setLockAspect, setPosition, setRotation, setSize, setWrapMode, sniffImageSize, type ImgInfo, type WrapMode } from "./docx-image";
import { findAll, replaceHits, type Hit, type SearchOpts, type SearchResult } from "./docx-search";
import { mergeR, readP, readR, type RProps } from "./docx-style";
import { createOleRun, findOleObject, oleSize, setOleSize, updateOleObject, type DocxOleRef } from "./docx-ole-edit";
import type { PreparedOle } from "../office-shared/ole-embed";

export interface SelInfo {
  has: boolean;
  collapsed: boolean;
  page: number;
  pages: number;
  paraIndex: number;
  paraCount: number;
  col: number;
  selChars: number;
  selWords: number;
  selParas: number;
  styleId?: string;
  styleName?: string;
  font?: string;
  size?: number;
  bold: boolean; italic: boolean; underline: boolean; strike: boolean; sup: boolean; sub: boolean;
  color?: string; highlight?: string;
  align?: string;
  list?: "bullet" | "number";
  indentLeft?: number;
  spaceBefore?: number; spaceAfter?: number; line?: string;
  table?: { index: number; row: number; col: number; rows: number; cols: number; merged: boolean; selRows?: number; selCols?: number };
  image?: ImgSelInfo;
  link?: string;
  pending?: boolean;
  region: "body" | "other";
}
export interface ImgSelInfo { name: string; descr: string; wPx: number; hPx: number; wrap: WrapMode; lock: boolean; rot: number; content: ImgInfo["content"]; floating: boolean; format: string; relId?: string; natural?: { w: number; h: number } }
export interface PainterInfo { char: [string, string][]; para: [string, string][]; sticky: boolean }

export interface ViewHooks {
  changed(label: string): void;
  selection(s: SelInfo): void;
  pages(n: number): void;
  painter(p: PainterInfo | null): void;
  ole(relId: string): void;
  openFile(file: File): void;
  toast(key: string, params?: Record<string, string | number>): void;
  log(level: "info" | "warn" | "error", cat: string, key: string, params?: Record<string, string | number>): void;
  context(x: number, y: number, kind: "text" | "table" | "image"): void;
  askLink(current: string | undefined): void;
}

export interface Point { p: XEl; off: number }
interface Sel2 { a: Point; b: Point }

const PX_PER_TWIP = 96 / 1440;
const MAX_IMG_W = 6.5 * 96;

export class DocxView {
  book?: DocxBook;
  reg = new Registry();
  readonly stage: HTMLElement;
  readonly sizer: HTMLElement;
  readonly zoomEl: HTMLElement;
  readonly pagesEl: HTMLElement;
  readonly overlay: HTMLElement;
  paginator: Paginator;
  readonly = false;
  showMarks = false;
  showRevisions = true;
  zoom = 1;
  lockAspect = true;
  painter: { clip: FormatClip; sticky: boolean } | null = null;
  imgSel: { el: HTMLElement; drawing: XEl } | null = null;
  cellSel: { tbl: XEl; r1: number; c1: number; r2: number; c2: number } | null = null;
  pending: { p: XEl; off: number; patch: RunPatch } | null = null;
  private clip: { text: string; frag: XEl[] } | null = null;
  private imgClip: XEl | null = null;
  private composing = false;
  private normTimer = 0;
  private pagTimer = 0;
  private selRaf = 0;
  private notesEl: HTMLElement | null = null;
  private fnRefs: RenderCtx["fnRefs"] = [];
  private ro: ResizeObserver;
  private disposers: (() => void)[] = [];
  private dragCell: { tbl: XEl; tc: XEl; r: number; c: number } | null = null;
  private lastSel: SelInfo | null = null;
  private hoverResize: { kind: "col" | "row"; tbl: XEl; index: number; tr?: XEl } | null = null;
  private resizeDrag: { kind: "col" | "row"; tbl: XEl; index: number; tr?: XEl; startX: number; startY: number; guide: HTMLElement; base: number } | null = null;
  private imgDrag: { mode: "resize" | "move"; handle: string; sx: number; sy: number; w0: number; h0: number; l0: number; t0: number; ratio: number; el: HTMLElement; drawing: XEl } | null = null;
  findHits: Hit[] = [];
  findCur = -1;
  /** Kait snapping: terima rect klien gambar yang diseret, kembalikan koreksi (px dokumen, tanpa zoom). Diisi editor dari penggaris. */
  snapGuides?: (rect: DOMRect) => { dx: number; dy: number };

  constructor(public host: HTMLElement, public hooks: ViewHooks) {
    host.classList.add("dx-scroll");
    this.stage = this.mkDiv("dx-stage");
    this.sizer = this.mkDiv("dx-sizer");
    this.zoomEl = this.mkDiv("dx-zoom");
    this.pagesEl = this.mkDiv("dx-pages");
    this.overlay = this.mkDiv("dx-overlay");
    this.zoomEl.appendChild(this.pagesEl);
    this.sizer.appendChild(this.zoomEl);
    this.stage.append(this.sizer, this.overlay);
    host.appendChild(this.stage);
    this.paginator = new Paginator({ book: undefined as unknown as DocxBook, reg: this.reg, pagesEl: this.pagesEl, doc: document, makeCtx: (w, s) => this.makeCtx(w, s) });
    this.ro = new ResizeObserver(() => { this.updateSizer(); this.updateOverlay(); });
    this.ro.observe(this.zoomEl);
    this.bind();
  }

  private mkDiv(cls: string) { const d = document.createElement("div"); d.className = cls; return d; }

  dispose() {
    this.ro.disconnect();
    for (const d of this.disposers) d();
    clearTimeout(this.normTimer); clearTimeout(this.pagTimer); cancelAnimationFrame(this.selRaf);
    this.clearHighlights();
    this.host.textContent = "";
    this.host.classList.remove("dx-scroll");
    this.book?.dispose();
  }

  // ───────── konteks render ─────────

  makeCtx(contentW: number, source: string): RenderCtx {
    return {
      book: this.book!, reg: this.reg, doc: document, contentW, editable: true, fnRefs: [], source, badImages: new Set(),
      opts: { readonly: this.readonly, showMarks: this.showMarks, showRevisions: this.showRevisions },
      onImageError: info => this.imageIssue(info),
    };
  }
  private imageIssue(info: string) {
    const [k, a, b] = info.split(":");
    if (k === "format") this.hooks.log("warn", "images", "log.imgFormat", { fmt: a, part: b ?? "" });
    else if (k === "decode") this.hooks.log("error", "images", "log.imgDecode", { fmt: a, part: b ?? "" });
    else if (k === "placeholder") this.hooks.log("warn", "unsupported", "log.placeholder", { kind: a });
  }

  // ───────── muat & render ─────────

  load(book: DocxBook) {
    this.book?.dispose();
    this.book = book;
    this.paginator = new Paginator({ book, reg: this.reg, pagesEl: this.pagesEl, doc: document, makeCtx: (w, s) => this.makeCtx(w, s) });
    this.imgSel = null; this.cellSel = null; this.pending = null; this.painter = null;
    if (!book.body.children.some(c => isEl(c) && (c.name.local === "p" || c.name.local === "tbl"))) book.body.children.push(mk("p"));
    book.reindex();
    this.renderAll();
    this.host.scrollTop = 0;
  }

  setReadonly(v: boolean) {
    if (this.readonly === v) return;
    this.readonly = v;
    if (v) { this.painter = null; this.hooks.painter(null); }
    if (this.book) this.renderAll();
  }
  setMarks(v: boolean) { this.showMarks = v; this.pagesEl.classList.toggle("dx-marks", v); if (this.book) this.renderAll(); }
  setRevisions(v: boolean) { this.showRevisions = v; if (this.book) this.renderAll(); }

  private contentWOf(sec: number) { const s = this.book!.sections(); return geomOf(s[Math.min(sec, s.length - 1)]).contentW; }

  /** Render ulang seluruh dokumen (mempertahankan scroll & seleksi). */
  renderAll(keep: { sel?: ReturnType<DocxView["captureIndexSel"]> } = {}) {
    const book = this.book;
    if (!book) return;
    const sel = "sel" in keep ? keep.sel : this.captureIndexSel();
    const st = this.host.scrollTop;
    this.reg = new Registry();
    this.paginator.reset();
    (this.paginator as unknown as { h: { reg: Registry } }).h.reg = this.reg;
    const blocks = this.renderBody();
    this.runPagination(blocks);
    this.host.scrollTop = st;
    if (sel) this.restoreIndexSel(sel);
    this.applyCellSelVisual();
    this.updateOverlay();
    this.scheduleSelection();
  }

  private renderBody(): HTMLElement[] {
    const book = this.book!;
    const secs = book.sections();
    const geoms = secs.map(geomOf);
    book.numbering.reset();
    const ctx = this.makeCtx(geoms[0].contentW, book.doc.partName);
    const holder = document.createElement("div");
    const blocks: HTMLElement[] = [];
    let si = 0;
    const walk = (parent: XEl) => {
      for (const c of parent.children) {
        if (!isEl(c)) continue;
        ctx.contentW = geoms[Math.min(si, geoms.length - 1)].contentW;
        const l = c.name.local;
        if (l === "p") {
          const d = renderParagraph(ctx, c);
          d.dataset.sec = String(si);
          holder.appendChild(d); blocks.push(d);
          if (d.dataset.sectEnd) si++;
        } else if (l === "tbl") {
          const t = renderTable(ctx, c);
          t.dataset.sec = String(si);
          holder.appendChild(t); blocks.push(t);
        } else if (l === "sdt") { const sc = first(c, "sdtContent"); if (sc) walk(sc); }
      }
    };
    walk(book.body);
    this.fnRefs = ctx.fnRefs;
    this.notesEl = this.buildNotes(ctx.fnRefs, Math.min(si, secs.length - 1), geoms[Math.min(si, geoms.length - 1)].contentW);
    return blocks;
  }

  private buildNotes(refs: RenderCtx["fnRefs"], sec: number, contentW: number): HTMLElement | null {
    const book = this.book!;
    if (!refs.length) return null;
    const box = document.createElement("div");
    box.className = "dx-notes";
    box.contentEditable = "false";
    box.dataset.sec = String(sec);
    const sep = document.createElement("div");
    sep.className = "dx-notes-sep";
    box.appendChild(sep);
    let any = false;
    for (const f of refs) {
      const n = book.notes(f.kind).get(f.id);
      if (!n) continue;
      const ctx = this.makeCtx(contentW, book.doc.partName);
      ctx.noteNum = f.num; ctx.editable = false;
      const wrap = document.createElement("div");
      wrap.className = "dx-note";
      wrap.style.display = "flex"; wrap.style.flexDirection = "column";
      fillBlocks(ctx, wrap, n, true);
      box.appendChild(wrap); any = true;
    }
    return any ? box : null;
  }

  /** Blok tingkat atas dalam urutan dokumen (dari model). */
  private collectBlocks(): HTMLElement[] {
    const out: HTMLElement[] = [];
    const walk = (parent: XEl) => {
      for (const c of parent.children) {
        if (!isEl(c)) continue;
        if (c.name.local === "p" || c.name.local === "tbl") { const d = this.reg.domOf.get(c); if (d) out.push(d); }
        else if (c.name.local === "sdt") { const sc = first(c, "sdtContent"); if (sc) walk(sc); }
      }
    };
    walk(this.book!.body);
    if (this.notesEl) out.push(this.notesEl);
    return out;
  }

  private runPagination(blocks?: HTMLElement[]) {
    if (!this.book) return;
    const n = this.paginator.run(blocks ?? this.collectBlocks());
    this.hooks.pages(n);
    this.updateSizer();
    this.updateOverlay();
    this.applyHighlights();
  }

  /** Paginasi ulang ringan (mempertahankan caret). */
  paginate() { this.withSel(() => this.runPagination()); }
  schedulePaginate(delay = 90) { clearTimeout(this.pagTimer); this.pagTimer = window.setTimeout(() => this.paginate(), delay); }

  updateSizer() {
    const w = this.zoomEl.offsetWidth, h = this.zoomEl.offsetHeight;
    this.sizer.style.width = `${Math.ceil(w * this.zoom)}px`;
    this.sizer.style.height = `${Math.ceil(h * this.zoom)}px`;
  }
  setZoom(z: number) {
    this.zoom = Math.max(0.25, Math.min(4, z));
    this.zoomEl.style.transform = `scale(${this.zoom})`;
    this.updateSizer(); this.updateOverlay();
    this.paginator.layoutAnchors();
  }
  fitWidth() {
    const first0 = this.pagesEl.querySelector<HTMLElement>(".dx-page");
    if (!first0) return;
    const avail = this.host.clientWidth - 48;
    this.setZoom(Math.max(0.3, Math.min(2.5, avail / first0.offsetWidth)));
  }
  fitPage() {
    const first0 = this.pagesEl.querySelector<HTMLElement>(".dx-page");
    if (!first0) return;
    const availW = this.host.clientWidth - 48, availH = this.host.clientHeight - 32;
    this.setZoom(Math.max(0.3, Math.min(2.5, Math.min(availW / first0.offsetWidth, availH / first0.offsetHeight))));
  }

  // ───────── pemetaan seleksi ─────────

  closestPara(n: Node | null): HTMLElement | null {
    if (!n) return null;
    const e = (n.nodeType === 1 ? n : n.parentElement) as HTMLElement | null;
    const d = e?.closest<HTMLElement>(".dx-p") ?? null;
    return d && this.reg.elOf.has(d) ? d : null;
  }
  /** Paragraf body yang diindeks model (bukan header/footer/catatan/text box). */
  isBodyPara(p: XEl | undefined): p is XEl { return !!p && !!this.book && this.book.parentOf(p) !== undefined; }
  pointOf(node: Node | null, offset: number): Point | null {
    const d = this.closestPara(node);
    if (!d) return null;
    const p = this.reg.elOf.get(d)!;
    if (!this.isBodyPara(p)) return null;
    return { p, off: domOffsetToFlat(d, node!, offset) };
  }
  private before(a: Point, b: Point): boolean {
    if (a.p === b.p) return a.off <= b.off;
    const da = this.reg.domOf.get(a.p), db = this.reg.domOf.get(b.p);
    if (!da || !db) return true;
    return !!(da.compareDocumentPosition(db) & Node.DOCUMENT_POSITION_FOLLOWING);
  }
  /** Seleksi terakhir yang valid di dokumen (dipakai saat fokus pindah ke toolbar/panel). */
  private saved: Sel2 | null = null;
  selPoints(): (Sel2 & { collapsed: boolean; anchor: Point; focus: Point }) | null {
    const s = window.getSelection();
    let anchor: Point | null = null, focus: Point | null = null, collapsed = true;
    if (s && s.rangeCount > 0 && s.anchorNode && this.pagesEl.contains(s.anchorNode)) {
      anchor = this.pointOf(s.anchorNode, s.anchorOffset); focus = this.pointOf(s.focusNode, s.focusOffset); collapsed = s.isCollapsed;
      if (anchor && focus) this.saved = { a: anchor, b: focus };
    } else if (this.saved && this.isBodyPara(this.saved.a.p) && this.isBodyPara(this.saved.b.p) && this.reg.domOf.get(this.saved.a.p)?.isConnected) {
      anchor = this.saved.a; focus = this.saved.b;
      collapsed = anchor.p === focus.p && anchor.off === focus.off;
    }
    if (!anchor || !focus) return null;
    const fwd = this.before(anchor, focus);
    return { a: fwd ? anchor : focus, b: fwd ? focus : anchor, collapsed, anchor, focus };
  }
  /** Daftar paragraf body (urutan dokumen) antara a dan b (inklusif). */
  parasBetween(a: XEl, b: XEl): XEl[] {
    if (a === b) return [a];
    const all = [...this.pagesEl.querySelectorAll<HTMLElement>(".dx-p")].map(d => this.reg.elOf.get(d)).filter((p): p is XEl => this.isBodyPara(p));
    const i = all.indexOf(a), j = all.indexOf(b);
    return i < 0 || j < 0 ? [a, b] : all.slice(i, j + 1);
  }
  /** Rentang (p,a,b) untuk seleksi atau sel terpilih. */
  spans(): { p: XEl; a: number; b: number }[] {
    const out: { p: XEl; a: number; b: number }[] = [];
    if (this.cellSel) {
      const g = buildGrid(this.cellSel.tbl);
      const r = T.expandRect(g, this.cellSel);
      const seen = new Set<XEl>();
      for (let rr = r.r1; rr <= r.r2; rr++) for (let cc = r.c1; cc <= r.c2; cc++) {
        const cell = g.map[rr]?.[cc]?.origin;
        if (!cell || seen.has(cell.el)) continue;
        seen.add(cell.el);
        walkBlocks(cell.el, el => { if (el.name.local === "p") out.push({ p: el, a: 0, b: flatLength(el) }); });
      }
      return out;
    }
    const s = this.selPoints();
    if (!s) return out;
    if (s.a.p === s.b.p) return [{ p: s.a.p, a: s.a.off, b: s.b.off }];
    for (const p of this.parasBetween(s.a.p, s.b.p)) out.push({ p, a: p === s.a.p ? s.a.off : 0, b: p === s.b.p ? s.b.off : flatLength(p) });
    return out;
  }

  captureSel(): Sel2 | null {
    const s = this.selPoints();
    return s ? { a: s.anchor, b: s.focus } : null;
  }
  restoreSel(sel: Sel2 | null) {
    if (!sel) return;
    const da = this.reg.domOf.get(sel.a.p), db = this.reg.domOf.get(sel.b.p);
    if (!da || !db || !da.isConnected || !db.isConnected) return;
    const pa = flatToDomPos(da, Math.min(sel.a.off, flatLength(sel.a.p))), pb = flatToDomPos(db, Math.min(sel.b.off, flatLength(sel.b.p)));
    if (!this.pagesEl.contains(document.activeElement) && da.isContentEditable) da.focus({ preventScroll: true });
    window.getSelection()?.setBaseAndExtent(pa.node, pa.offset, pb.node, pb.offset);
    this.saved = sel;
  }
  withSel<T>(fn: () => T): T {
    const sel = this.captureSel();
    const r = fn();
    const cur = window.getSelection();
    const lost = sel && (!cur || cur.rangeCount === 0 || !cur.anchorNode?.isConnected || !this.pagesEl.contains(cur.anchorNode) || this.pointOf(cur.anchorNode, cur.anchorOffset)?.p !== sel.a.p);
    if (lost) this.restoreSel(sel);
    return r;
  }
  setCaret(p: XEl, off: number) { this.restoreSel({ a: { p, off }, b: { p, off } }); }
  selectRange(p: XEl, a: number, b: number) { this.restoreSel({ a: { p, off: a }, b: { p, off: b } }); }
  focusPara(p: XEl, off = 0, scroll = true) {
    const d = this.reg.domOf.get(p);
    if (!d) return;
    if (d.isContentEditable) d.focus({ preventScroll: true });
    this.setCaret(p, off);
    if (scroll) d.scrollIntoView({ block: "center", behavior: "auto" });
  }

  /** Posisi berbasis indeks (tahan terhadap penggantian objek XML saat undo/redo). */
  captureIndexSel(): { a: number; ao: number; b: number; bo: number } | null {
    const s = this.captureSel();
    if (!s || !this.book) return null;
    let ia = -1, ib = -1, i = 0;
    for (const { p } of this.book.paragraphs()) { if (p === s.a.p) ia = i; if (p === s.b.p) ib = i; i++; if (ia >= 0 && ib >= 0) break; }
    return ia < 0 || ib < 0 ? null : { a: ia, ao: s.a.off, b: ib, bo: s.b.off };
  }
  restoreIndexSel(x: { a: number; ao: number; b: number; bo: number }) {
    if (!this.book) return;
    const ps = [...this.book.paragraphs()].map(v => v.p);
    const pa = ps[Math.min(x.a, ps.length - 1)], pb = ps[Math.min(x.b, ps.length - 1)];
    if (pa && pb) this.restoreSel({ a: { p: pa, off: x.ao }, b: { p: pb, off: x.bo } });
  }

  // ───────── riwayat ─────────

  /** Catat perubahan ke riwayat dan beri tahu UI. */
  commit(label: string, merge?: string) {
    if (!this.book) return;
    this.book.checkpoint(label, false, merge);
    this.hooks.changed(label);
  }
  undo() { if (!this.book?.canUndo || this.readonly) return; const s = this.captureIndexSel(); this.book.undo(); this.afterRestore(s, "hist.undo"); }
  redo() { if (!this.book?.canRedo || this.readonly) return; const s = this.captureIndexSel(); this.book.redo(); this.afterRestore(s, "hist.redo"); }
  jumpTo(i: number) { if (!this.book || this.readonly) return; const s = this.captureIndexSel(); if (this.book.restore(i)) this.afterRestore(s, "hist.jump"); }
  private afterRestore(s: ReturnType<DocxView["captureIndexSel"]>, label: string) {
    this.imgSel = null; this.cellSel = null; this.pending = null;
    this.renderAll({ sel: s });
    this.hooks.changed(label);
  }

  // ───────── pengikatan event ─────────

  private bind() {
    const on = (t: EventTarget, ev: string, fn: (e: never) => void, opts?: boolean | AddEventListenerOptions) => {
      t.addEventListener(ev, fn as EventListener, opts);
      this.disposers.push(() => t.removeEventListener(ev, fn as EventListener, opts));
    };
    const P = this.pagesEl;
    on(P, "input", (e: Event) => this.onInput(e));
    on(P, "beforeinput", (e: InputEvent) => this.onBeforeInput(e));
    on(P, "keydown", (e: KeyboardEvent) => this.onKeyDown(e));
    on(P, "paste", (e: ClipboardEvent) => this.onPaste(e));
    on(P, "copy", (e: ClipboardEvent) => this.onCopy(e, false));
    on(P, "cut", (e: ClipboardEvent) => this.onCopy(e, true));
    on(P, "compositionstart", () => { this.composing = true; });
    on(P, "compositionend", (e: Event) => { this.composing = false; this.onInput(e); });
    on(P, "mousedown", (e: MouseEvent) => this.onMouseDown(e));
    on(document, "mousemove", (e: MouseEvent) => this.onMouseMove(e));
    on(document, "mouseup", (e: MouseEvent) => this.onMouseUp(e));
    on(P, "click", (e: MouseEvent) => this.onClick(e));
    on(P, "dblclick", (e: MouseEvent) => this.onDblClick(e));
    on(P, "contextmenu", (e: MouseEvent) => this.onContext(e));
    on(P, "load", () => this.schedulePaginate(), true);
    on(this.host, "dragover", (e: DragEvent) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); });
    on(this.host, "drop", (e: DragEvent) => this.onDrop(e));
    on(document, "selectionchange", () => this.scheduleSelection());
    on(this.host, "scroll", () => this.updateOverlay());
    document.fonts?.ready.then(() => this.schedulePaginate(30));
  }

  // ───────── input & keyboard ─────────

  private onInput(e: Event) {
    if (this.readonly || !this.book || this.composing || (e as InputEvent).isComposing) return;
    const s = window.getSelection();
    const d = this.closestPara(s?.anchorNode ?? (e.target as Node));
    const p = d ? this.reg.elOf.get(d) : undefined;
    if (!d || !p || !this.isBodyPara(p)) return;
    this.syncParagraph(d, p);
  }

  /** Samakan model dengan teks DOM paragraf (diff awalan/akhiran). */
  syncParagraph(d: HTMLElement, p: XEl): boolean {
    const dom = domFlatText(d), model = flatText(p);
    if (dom === model) return false;
    const ml = Math.min(dom.length, model.length);
    let a = 0;
    while (a < ml && dom.charCodeAt(a) === model.charCodeAt(a)) a++;
    let e = 0;
    while (e < ml - a && dom.charCodeAt(dom.length - 1 - e) === model.charCodeAt(model.length - 1 - e)) e++;
    const removed = model.length - e - a;
    const inserted = dom.slice(a, dom.length - e);
    let src: XEl | undefined;
    if (inserted.length) {
      const pos = flatToDomPos(d, a + 1);
      const sp = (pos.node.nodeType === 3 ? pos.node.parentElement : (pos.node as HTMLElement))?.closest<HTMLElement>(".dx-r");
      const r = sp ? this.reg.elOf.get(sp) : undefined;
      if (r && units(p).some(u => u.run === r)) src = r;
    }
    replaceRange(p, a, a + removed, inserted, src);
    const pend = this.pending;
    if (pend && pend.p === p && pend.off === a && inserted.length) {
      for (const r of runsInRange(p, a, a + inserted.length)) applyRunPatch(r.run, pend.patch);
      this.pending = null;
      this.withSel(() => this.rerenderPara(p));
      this.setCaret(p, a + inserted.length);
    }
    this.commit("hist.typing", "hist.typing");
    this.schedulePaginate(140);
    clearTimeout(this.normTimer);
    this.normTimer = window.setTimeout(() => this.normalizePara(p), 900);
    this.scheduleSelection();
    return true;
  }
  private normalizePara(p: XEl) {
    if (this.composing || !this.book) return;
    normalize(p);
    const d = this.reg.domOf.get(p);
    if (!d || !d.isConnected) return;
    const sel = this.captureSel();
    this.rerenderPara(p);
    if (sel && (sel.a.p === p || sel.b.p === p)) this.restoreSel(sel);
  }

  rerenderPara(p: XEl) {
    const d = this.reg.domOf.get(p);
    if (!d || !d.isConnected || !this.book) return;
    const ctx = this.makeCtx(300, this.book.doc.partName);
    fillParagraph(ctx, d, p, condForParagraph(this.book, p), "body");
    this.applyCellSelVisual();
  }
  private refreshNums() { if (this.book) refreshNumbering(this.makeCtx(300, this.book.doc.partName), p => this.rerenderPara(p)); }

  private onBeforeInput(e: InputEvent) {
    if (this.readonly) { e.preventDefault(); return; }
    const t = e.inputType;
    const map: Record<string, () => void> = {
      formatBold: () => this.toggleRun("b"), formatItalic: () => this.toggleRun("i"), formatUnderline: () => this.toggleUnderline(), formatStrikeThrough: () => this.toggleRun("strike"),
      formatJustifyLeft: () => this.setAlign("left"), formatJustifyCenter: () => this.setAlign("center"), formatJustifyRight: () => this.setAlign("right"), formatJustifyFull: () => this.setAlign("both"),
    };
    if (t === "insertParagraph") { e.preventDefault(); this.enter(); return; }
    if (t === "insertLineBreak") { e.preventDefault(); this.softBreak(); return; }
    if (t === "historyUndo") { e.preventDefault(); this.undo(); return; }
    if (t === "historyRedo") { e.preventDefault(); this.redo(); return; }
    if (map[t]) { e.preventDefault(); map[t](); return; }
    if (t === "insertFromDrop" || t === "insertFromYank") { e.preventDefault(); return; }
    const s = this.selPoints();
    if (t.startsWith("delete")) {
      if (!s) return;
      if (!s.collapsed) { if (s.a.p !== s.b.p) { e.preventDefault(); this.deleteSelection(); } return; }
      const fwd = t.includes("Forward");
      if (!fwd && s.a.off === 0) { e.preventDefault(); this.backspaceStart(s.a.p); }
      else if (fwd && s.a.off >= flatLength(s.a.p)) { e.preventDefault(); this.deleteEnd(s.a.p); }
      return;
    }
    if (s && !s.collapsed && s.a.p !== s.b.p && /^insert(Text|CompositionText|ReplacementText)$/.test(t)) {
      e.preventDefault();
      const pt = this.deleteSelection();
      if (pt && e.data) this.insertAtPoint(pt, e.data);
    }
  }

  private onKeyDown(e: KeyboardEvent) {
    if (!this.book) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Escape") {
      if (this.painter) { this.cancelPainter(); e.preventDefault(); return; }
      if (this.imgSel) { this.clearImageSel(); return; }
      if (this.cellSel) { this.clearCellSel(); return; }
    }
    if (this.imgSel && !this.readonly) {
      const k = e.key;
      if (k === "Delete" || k === "Backspace") { e.preventDefault(); this.imgDelete(); return; }
      if (/^Arrow/.test(k) && this.imgSel.el.dataset.wrap === "abs") {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        this.imgNudge(k === "ArrowLeft" ? -d : k === "ArrowRight" ? d : 0, k === "ArrowUp" ? -d : k === "ArrowDown" ? d : 0);
        return;
      }
    }
    if (this.readonly) return;
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      const run = (fn: () => void) => { e.preventDefault(); fn(); };
      switch (k) {
        case "b": return run(() => this.toggleRun("b"));
        case "i": return run(() => this.toggleRun("i"));
        case "u": return run(() => this.toggleUnderline());
        case "z": return run(() => (e.shiftKey ? this.redo() : this.undo()));
        case "y": return run(() => this.redo());
        case "k": return run(() => this.hooks.askLink(this.linkUnderCaret()));
        case "l": return run(() => this.setAlign("left"));
        case "e": return run(() => this.setAlign("center"));
        case "r": return run(() => this.setAlign("right"));
        case "j": return run(() => this.setAlign("both"));
        case "a": return run(() => this.selectAll());
        case "enter": return run(() => this.insertPageBreakAtCaret());
        case ">": case ".": if (e.shiftKey) return run(() => this.bumpSize(1)); break;
        case "<": case ",": if (e.shiftKey) return run(() => this.bumpSize(-1)); break;
        default: break;
      }
    }
    if (e.key === "Tab" && !mod && !e.altKey) {
      e.preventDefault();
      const tc = this.tctx();
      if (tc) this.tableNavigate(tc, e.shiftKey ? -1 : 1); else if (!e.shiftKey) this.insertTextAtSel("\t");
    }
  }

  linkUnderCaret(): string | undefined {
    const s = this.selPoints();
    if (!s || !this.book) return undefined;
    const l = linkAt(s.a.p, s.a.off);
    if (!l) return undefined;
    const rid = attr(l, "id");
    return rid ? this.book.rel(rid)?.target : attr(l, "anchor") ? `#${attr(l, "anchor")}` : undefined;
  }

  // ───────── operasi paragraf ─────────

  private commitStructural(label: string, caret?: Point) {
    this.book!.reindex();
    this.renderAll({ sel: null });
    if (caret) this.setCaret(caret.p, caret.off);
    this.commit(label);
  }

  deleteSelection(): Point | null {
    const s = this.selPoints();
    const book = this.book;
    if (!s || !book) return null;
    if (s.collapsed) return { p: s.a.p, off: s.a.off };
    const p = deleteSpan(book, s.a.p, s.a.off, s.b.p, s.b.off);
    normalize(p);
    const pt = { p, off: s.a.off };
    if (s.a.p === s.b.p) { this.rerenderPara(p); this.setCaret(p, pt.off); this.commit("hist.delete"); this.schedulePaginate(); }
    else this.commitStructural("hist.delete", pt);
    return pt;
  }

  private insertAtPoint(pt: Point, text: string) {
    replaceRange(pt.p, pt.off, pt.off, text);
    this.rerenderPara(pt.p);
    this.setCaret(pt.p, pt.off + text.length);
    this.commit("hist.typing", "hist.typing");
    this.schedulePaginate();
  }
  insertTextAtSel(text: string) {
    const s = this.selPoints();
    if (!s || this.readonly) return;
    let pt: Point = { p: s.a.p, off: s.a.off };
    if (!s.collapsed) { const d = this.deleteSelection(); if (!d) return; pt = d; }
    this.insertAtPoint(pt, text);
  }

  enter() {
    const book = this.book;
    const s = this.selPoints();
    if (!book || !s || this.readonly) return;
    let pt: Point = { p: s.a.p, off: s.a.off };
    if (!s.collapsed) { const d = this.deleteSelection(); if (!d) return; pt = d; }
    const { p, off } = pt;
    const parent = book.parentOf(p);
    if (!parent) return;
    const pPr = first(p, "pPr");
    const sid = val(pPr, "pStyle");
    const base = book.styles.paraBase(sid);
    const inList = (readP(pPr, book.styles.theme).numId ?? base.p.numId ?? 0) > 0;
    if (inList && flatLength(p) === 0) {
      applyParaPatch(p, { num: base.p.numId ? { numId: 0, ilvl: 0 } : null });
      this.rerenderPara(p); this.refreshNums(); this.setCaret(p, 0);
      this.commit("hist.list"); this.schedulePaginate();
      return;
    }
    const next = book.styles.next(sid);
    const np = splitParagraph(parent, p, off, { nextStyle: next && next !== sid ? next : undefined });
    book.setParent(np, parent);
    this.rerenderPara(p);
    const od = this.reg.domOf.get(p)!;
    const nd = renderParagraph(this.makeCtx(300, book.doc.partName), np, condForParagraph(book, np));
    nd.dataset.sec = od.dataset.sec ?? "0";
    od.after(nd);
    this.refreshNums();
    this.focusPara(np, 0, false);
    this.commit("hist.enter");
    this.schedulePaginate(30);
    nd.scrollIntoView?.({ block: "nearest" });
  }

  softBreak() {
    const s = this.selPoints();
    if (!s || this.readonly) return;
    let pt: Point = { p: s.a.p, off: s.a.off };
    if (!s.collapsed) { const d = this.deleteSelection(); if (!d) return; pt = d; }
    insertLineBreak(pt.p, pt.off);
    this.rerenderPara(pt.p);
    this.setCaret(pt.p, pt.off + 1);
    this.commit("hist.break"); this.schedulePaginate();
  }

  insertPageBreakAtCaret() {
    const s = this.selPoints();
    if (!s || this.readonly) return;
    let pt: Point = { p: s.a.p, off: s.a.off };
    if (!s.collapsed) { const d = this.deleteSelection(); if (!d) return; pt = d; }
    insertPageBreak(pt.p, pt.off);
    this.rerenderPara(pt.p);
    this.setCaret(pt.p, pt.off + 1);
    this.commit("hist.pageBreak"); this.schedulePaginate(30);
  }

  private blockSiblings(parent: XEl) { return parent.children.filter(isEl).filter(c => c.name.local === "p" || c.name.local === "tbl"); }

  private backspaceStart(p: XEl) {
    const book = this.book!;
    const parent = book.parentOf(p);
    if (!parent) return;
    const pPr = first(p, "pPr");
    const base = book.styles.paraBase(val(pPr, "pStyle"));
    const direct = readP(pPr, book.styles.theme);
    if ((direct.numId ?? base.p.numId ?? 0) > 0) {
      applyParaPatch(p, { num: base.p.numId ? { numId: 0, ilvl: 0 } : null });
      this.rerenderPara(p); this.refreshNums(); this.setCaret(p, 0); this.commit("hist.list"); this.schedulePaginate();
      return;
    }
    const sibs = this.blockSiblings(parent);
    const prev = sibs[sibs.indexOf(p) - 1];
    if (!prev) return;
    if (prev.name.local === "tbl") {
      const rows = els(prev, "tr"); const cells = els(rows[rows.length - 1], "tc");
      const lastCell = cells[cells.length - 1];
      const ps: XEl[] = []; walkBlocks(lastCell, el => { if (el.name.local === "p") ps.push(el); });
      const lp = ps[ps.length - 1];
      if (lp) this.focusPara(lp, flatLength(lp));
      return;
    }
    const sectPr = first(first(prev, "pPr"), "sectPr");
    if (flatLength(prev) === 0 && !sectPr) {
      removeNode(parent, prev);
      this.reg.domOf.get(prev)?.remove();
      this.refreshNums(); this.setCaret(p, 0);
    } else {
      const o = flatLength(prev);
      mergeParagraphs(parent, prev, p);
      this.reg.domOf.get(p)?.remove();
      this.rerenderPara(prev); this.refreshNums(); this.setCaret(prev, o);
    }
    this.commit("hist.merge"); this.schedulePaginate(30);
  }

  private deleteEnd(p: XEl) {
    const book = this.book!;
    const parent = book.parentOf(p);
    if (!parent) return;
    const sibs = this.blockSiblings(parent);
    const next = sibs[sibs.indexOf(p) + 1];
    if (!next || next.name.local !== "p") return;
    if (flatLength(p) === 0 && !first(first(p, "pPr"), "sectPr")) {
      removeNode(parent, p); this.reg.domOf.get(p)?.remove(); this.refreshNums(); this.setCaret(next, 0);
    } else {
      const o = flatLength(p);
      mergeParagraphs(parent, p, next);
      this.reg.domOf.get(next)?.remove();
      this.rerenderPara(p); this.refreshNums(); this.setCaret(p, o);
    }
    this.commit("hist.merge"); this.schedulePaginate(30);
  }

  selectAll() {
    const all = [...this.pagesEl.querySelectorAll<HTMLElement>(".dx-p")].map(d => this.reg.elOf.get(d)).filter((p): p is XEl => this.isBodyPara(p));
    if (!all.length) return;
    this.restoreSel({ a: { p: all[0], off: 0 }, b: { p: all[all.length - 1], off: flatLength(all[all.length - 1]) } });
  }

  // ───────── clipboard ─────────

  private selectionText(): { text: string; frag: XEl[] } | null {
    const book = this.book!;
    if (this.cellSel) {
      const g = buildGrid(this.cellSel.tbl); const r = T.expandRect(g, this.cellSel);
      const rows: string[] = [];
      for (let rr = r.r1; rr <= r.r2; rr++) { const cols: string[] = []; for (let cc = r.c1; cc <= r.c2; cc++) { const c = g.map[rr]?.[cc]; cols.push(c && c.col === cc ? c.el.children.filter(isEl).filter(x => x.name.local === "p").map(x => flatText(x).replace(/￼/g, "")).join(" ") : ""); } rows.push(cols.join("\t")); }
      return { text: rows.join("\n"), frag: [] };
    }
    const s = this.selPoints();
    if (!s || s.collapsed) return null;
    const frag = extractFragment(book, s.a.p, s.a.off, s.b.p, s.b.off);
    const text = frag.filter(f => f.name.local === "p").map(f => flatText(f).replace(/￼/g, "")).join("\n");
    return { text, frag };
  }

  private onCopy(e: ClipboardEvent, cut: boolean) {
    if (!this.book) return;
    if (this.imgSel) {
      e.preventDefault();
      this.imgClip = cloneEl(this.imgSel.drawing);
      e.clipboardData?.setData("text/plain", "[image]");
      if (cut && !this.readonly) this.imgDelete();
      return;
    }
    const st = this.selectionText();
    if (!st) return;
    e.preventDefault();
    this.clip = st.frag.length ? st : null;
    const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    e.clipboardData?.setData("text/plain", st.text);
    e.clipboardData?.setData("text/html", st.text.split("\n").map(l => `<p>${esc(l)}</p>`).join(""));
    if (cut && !this.readonly) { if (this.cellSel) this.clearCells(); else this.deleteSelection(); }
  }

  private onPaste(e: ClipboardEvent) {
    if (this.readonly || !this.book) { e.preventDefault(); return; }
    const cd = e.clipboardData;
    if (!cd) return;
    e.preventDefault();
    const img = [...(cd.files ?? [])].find(f => f.type.startsWith("image/"));
    if (img) { void this.insertImageFile(img); return; }
    const text = cd.getData("text/plain").replace(/\r\n?/g, "\n");
    if (text === "[image]" && this.imgClip) { this.imgPaste(); return; }
    const s = this.selPoints();
    if (!s) return;
    let pt: Point = { p: s.a.p, off: s.a.off };
    if (!s.collapsed) { const d = this.deleteSelection(); if (!d) return; pt = d; }
    const parent = this.book.parentOf(pt.p);
    if (!parent || !text) return;
    if (this.clip && this.clip.text === text) {
      const res = pasteFragment(parent, pt.p, pt.off, this.clip.frag.map(f => cloneEl(f)));
      this.book.reindex();
      if (this.clip.frag.length > 1) this.commitStructural("hist.paste", res); else { this.rerenderPara(pt.p); this.setCaret(res.p, res.off); this.commit("hist.paste"); this.schedulePaginate(); }
      return;
    }
    const res = insertPlainText(parent, pt.p, pt.off, text);
    this.book.reindex();
    if (text.includes("\n")) this.commitStructural("hist.paste", res); else { this.rerenderPara(pt.p); this.setCaret(res.p, res.off); this.commit("hist.paste"); this.schedulePaginate(); }
  }

  private onDrop(e: DragEvent) {
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    const f = files[0];
    if (/\.(docx|docm|dotx|dotm)$/i.test(f.name)) { this.hooks.openFile(f); return; }
    if (f.type.startsWith("image/") && !this.readonly) {
      const pos = (document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }).caretPositionFromPoint?.(e.clientX, e.clientY);
      const range = pos ? null : document.caretRangeFromPoint?.(e.clientX, e.clientY);
      const node = pos?.offsetNode ?? range?.startContainer, off = pos?.offset ?? range?.startOffset ?? 0;
      if (node) { const pt = this.pointOf(node, off); if (pt) this.setCaret(pt.p, pt.off); }
      void this.insertImageFile(f);
    } else this.hooks.openFile(f);
  }

  // ───────── mouse ─────────

  private cellAt(target: EventTarget | null): { td: HTMLElement; tc: XEl; tbl: XEl; g: Grid; cell: GCell } | null {
    const td = (target as HTMLElement | null)?.closest?.("td") as HTMLElement | null;
    if (!td || td.closest(".dx-hdr,.dx-ftr,.dx-notes,.dx-txbx")) return null;
    const tc = this.reg.elOf.get(td);
    if (!tc || !this.book) return null;
    const tr = this.book.parentOf(tc), tbl = tr ? this.book.parentOf(tr) : undefined;
    if (!tbl) return null;
    const g = buildGrid(tbl);
    const cell = g.cells.find(c => c.el === tc);
    return cell ? { td, tc, tbl, g, cell } : null;
  }

  private onMouseDown(e: MouseEvent) {
    if (e.button !== 0 || !this.book) return;
    const t = e.target as HTMLElement;
    if (this.hoverResize && !this.readonly) {
      e.preventDefault();
      const hv = this.hoverResize;
      const guide = document.createElement("div");
      guide.className = "dx-guide " + (hv.kind === "col" ? "v" : "h");
      this.overlay.appendChild(guide);
      this.resizeDrag = { ...hv, startX: e.clientX, startY: e.clientY, guide, base: 0 };
      this.positionGuide(e);
      return;
    }
    const c = this.cellAt(t);
    if (c && !t.closest(".dx-img")) {
      if (e.shiftKey && this.tctx()?.tbl === c.tbl) {
        e.preventDefault();
        const cur = this.tctx()!;
        this.setCellSel(c.tbl, { r1: cur.rect.r1, c1: cur.rect.c1, r2: c.cell.row, c2: c.cell.col });
        return;
      }
      this.dragCell = { tbl: c.tbl, tc: c.tc, r: c.cell.row, c: c.cell.col };
    } else this.dragCell = null;
    if (this.cellSel) this.clearCellSel();
  }

  private onMouseMove(e: MouseEvent) {
    if (this.imgDrag) { this.imgDragMove(e); return; }
    if (this.resizeDrag) { this.positionGuide(e); return; }
    if (!this.book) return;
    if (e.buttons === 1 && this.dragCell) {
      const c = this.cellAt(e.target);
      if (c && c.tbl === this.dragCell.tbl && c.tc !== this.dragCell.tc) {
        window.getSelection()?.removeAllRanges();
        this.pagesEl.classList.add("dx-cellselecting");
        this.setCellSel(c.tbl, { r1: this.dragCell.r, c1: this.dragCell.c, r2: c.cell.row, c2: c.cell.col });
      } else if (c && c.tc === this.dragCell.tc && this.cellSel) this.clearCellSel();
      return;
    }
    if (e.buttons !== 0 || this.readonly) return;
    // deteksi tepi kolom/baris untuk resize
    const t = e.target as HTMLElement;
    const c = this.cellAt(t);
    let hv: DocxView["hoverResize"] = null;
    if (c) {
      const r = c.td.getBoundingClientRect();
      const tol = 4 * this.zoom;
      if (Math.abs(e.clientX - r.right) <= tol) hv = { kind: "col", tbl: c.tbl, index: c.cell.col + c.cell.colspan - 1 };
      else if (Math.abs(e.clientY - r.bottom) <= tol && c.cell.row + c.cell.rowspan >= 1) hv = { kind: "row", tbl: c.tbl, index: c.cell.row + c.cell.rowspan - 1, tr: c.g.rows[c.cell.row + c.cell.rowspan - 1] };
    }
    this.hoverResize = hv;
    this.pagesEl.classList.toggle("dx-col-resize", hv?.kind === "col");
    this.pagesEl.classList.toggle("dx-row-resize", hv?.kind === "row");
  }

  private positionGuide(e: MouseEvent) {
    const d = this.resizeDrag;
    if (!d) return;
    const o = this.stage.getBoundingClientRect();
    if (d.kind === "col") { d.guide.style.left = `${e.clientX - o.left}px`; d.guide.style.top = "0"; d.guide.style.height = `${this.stage.offsetHeight}px`; }
    else { d.guide.style.top = `${e.clientY - o.top}px`; d.guide.style.left = "0"; d.guide.style.width = `${this.stage.offsetWidth}px`; }
  }

  private onMouseUp(e: MouseEvent) {
    if (this.imgDrag) { this.imgDragEnd(); return; }
    const rd = this.resizeDrag;
    if (rd) {
      this.resizeDrag = null;
      rd.guide.remove();
      const dx = (e.clientX - rd.startX) / this.zoom, dy = (e.clientY - rd.startY) / this.zoom;
      if (rd.kind === "col" && Math.abs(dx) > 1) { T.resizeColumn(rd.tbl, rd.index, Math.round(dx / PX_PER_TWIP)); this.finishTable(rd.tbl, "hist.tblResize"); }
      else if (rd.kind === "row" && rd.tr && Math.abs(dy) > 1) {
        const dom = this.reg.domOf.get(rd.tr);
        const h = (dom?.offsetHeight ?? 0) + dy;
        T.setRowHeight(rd.tr, Math.max(120, Math.round(h / PX_PER_TWIP)));
        this.finishTable(rd.tbl, "hist.tblResize");
      }
      return;
    }
    this.pagesEl.classList.remove("dx-cellselecting");
    this.dragCell = null;
    if (this.painter && !this.readonly && this.pagesEl.contains(e.target as Node)) window.setTimeout(() => this.applyPainter(), 0);
  }

  private onClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    const a = t.closest<HTMLAnchorElement>("a.dx-link");
    if (a) {
      const href = a.dataset.href ?? "";
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || this.readonly) this.openLink(href);
      return;
    }
    const note = t.closest<HTMLElement>(".dx-fnref[data-note]");
    if (note) { this.scrollToNote(note.dataset.note!); return; }
    const img = t.closest<HTMLElement>(".dx-img");
    if (img) { this.selectImageEl(img); return; }
    if (this.imgSel) this.clearImageSel();
  }
  private onDblClick(e: MouseEvent) {
    const ole = (e.target as HTMLElement).closest<HTMLElement>(".dx-ole");
    if (ole) { e.preventDefault(); this.hooks.ole(ole.dataset.ole ?? ""); }
  }
  openLink(href: string) {
    if (!href) return;
    if (href.startsWith("#")) { this.scrollToBookmark(href.slice(1)); return; }
    const i = href.indexOf("#");
    if (/^(https?:|mailto:|tel:|ftp:)/i.test(href)) window.open(i > 0 && !/^https?:\/\/[^#]*#/.test(href) ? href : href, "_blank", "noopener,noreferrer");
    else this.hooks.toast("toast.linkBlocked", { href });
  }
  scrollToBookmark(name: string) {
    const el = this.pagesEl.querySelector<HTMLElement>(`[data-bm="${CSS.escape(name)}"]`);
    if (el) el.scrollIntoView({ block: "center" });
    else this.hooks.toast("toast.noBookmark", { name });
  }
  private scrollToNote(key: string) {
    const [kind, id] = key.split(":");
    const idx = this.fnRefs.findIndex(f => f.kind === kind && f.id === id);
    const note = this.notesEl?.querySelectorAll(".dx-note")[idx];
    (note as HTMLElement | undefined)?.scrollIntoView({ block: "center" });
  }

  private onContext(e: MouseEvent) {
    if (!this.book) return;
    const t = e.target as HTMLElement;
    const img = t.closest<HTMLElement>(".dx-img");
    if (img) { e.preventDefault(); if (this.imgSel?.el !== img) this.selectImageEl(img); this.hooks.context(e.clientX, e.clientY, "image"); return; }
    const c = this.cellAt(t);
    if (c) {
      if (!this.cellSel) { const pt = this.pointOf(window.getSelection()?.anchorNode ?? null, 0); if (!pt) { const p = ps0(c.tc, this.book); if (p) this.setCaret(p, 0); } }
      e.preventDefault(); this.hooks.context(e.clientX, e.clientY, "table"); return;
    }
    if (!this.readonly) { e.preventDefault(); this.hooks.context(e.clientX, e.clientY, "text"); }
  }

  // ───────── format karakter ─────────

  /** Properti run terselesaikan (style paragraf + tabel + style karakter + langsung). */
  runResolved(p: XEl, run: XEl | undefined): RProps {
    const book = this.book!;
    const base = book.styles.paraBase(val(first(p, "pPr"), "pStyle"), condForParagraph(book, p)).r;
    if (!run) return mergeR(base, readR(first(first(p, "pPr"), "rPr"), book.styles.theme));
    const rPr = runProps(run);
    const rs = val(rPr, "rStyle");
    return mergeR(mergeR(base, rs ? book.styles.charLayer(rs) : undefined), readR(rPr, book.styles.theme));
  }
  private runAt(p: XEl, off: number): XEl | undefined {
    const us = units(p);
    return (us.find(u => u.start < off && off <= u.end) ?? us.find(u => u.start >= off && u.end > u.start))?.run;
  }
  private runsOverlapping(p: XEl, a: number, b: number): XEl[] {
    const out: XEl[] = [];
    for (const u of units(p)) if (u.end > a && u.start < b && !out.includes(u.run)) out.push(u.run);
    return out;
  }

  private applyRunCmd(label: string, pick: (all: RProps[], collapsed: boolean) => RunPatch | null) {
    const sp = this.spans();
    if (!sp.length || this.readonly || !this.book) return;
    const collapsed = sp.length === 1 && sp[0].a === sp[0].b;
    const states: RProps[] = [];
    for (const s of sp) {
      if (collapsed) states.push(this.runResolved(s.p, this.runAt(s.p, s.a)));
      else for (const r of this.runsOverlapping(s.p, s.a, s.b)) states.push(this.runResolved(s.p, r));
    }
    if (!states.length) for (const s of sp) states.push(this.runResolved(s.p, undefined));
    const patch = pick(states, collapsed);
    if (!patch) return;
    const sel = this.captureSel();
    if (collapsed) {
      const { p, a } = sp[0];
      if (flatLength(p) === 0) { applyMarkPatch(p, patch); this.rerenderPara(p); }
      else this.pending = { p, off: a, patch: this.pending && this.pending.p === p && this.pending.off === a ? { ...this.pending.patch, ...patch } : patch };
      this.restoreSel(sel);
      this.scheduleSelection();
      if (flatLength(p) === 0) { this.commit(label); }
      return;
    }
    const touched = new Set<XEl>();
    for (const s of sp) {
      if (s.b <= s.a) continue;
      for (const r of runsInRange(s.p, s.a, s.b)) applyRunPatch(r.run, patch);
      normalize(s.p);
      touched.add(s.p);
    }
    for (const p of touched) this.rerenderPara(p);
    this.restoreSel(sel);
    this.commit(label);
    this.schedulePaginate();
    this.scheduleSelection();
  }

  toggleRun(key: "b" | "i" | "strike" | "caps" | "smallCaps") {
    const prop: Record<string, keyof RProps> = { b: "b", i: "i", strike: "strike", caps: "caps", smallCaps: "smallCaps" };
    this.applyRunCmd("hist.format", st => ({ [key]: !st.every(r => r[prop[key]]) }) as RunPatch);
  }
  toggleUnderline() { this.applyRunCmd("hist.format", st => ({ u: st.every(r => r.u && r.u !== "none") ? "none" : "single" })); }
  setUnderline(style: string) { this.applyRunCmd("hist.format", () => ({ u: style })); }
  setVert(v: "superscript" | "subscript") { this.applyRunCmd("hist.format", st => ({ vert: st.every(r => r.vert === v) ? "baseline" : v })); }
  setColor(c: string | null) { this.applyRunCmd("hist.color", () => ({ color: c })); }
  setHighlight(c: string | null) { this.applyRunCmd("hist.color", () => ({ highlight: c })); }
  setFont(name: string | null) { this.applyRunCmd("hist.font", () => ({ font: name })); }
  setSize(pt: number | null) { this.applyRunCmd("hist.font", () => ({ sz: pt === null ? null : Math.round(pt * 2) })); }
  bumpSize(delta: number) { this.applyRunCmd("hist.font", st => { const cur = (st[0]?.sz ?? 22) / 2; const steps = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72]; const i = steps.findIndex(x => x >= cur - 0.01); const nx = delta > 0 ? steps[Math.min(steps.length - 1, (i < 0 ? steps.length - 1 : steps[i] > cur + 0.01 ? i : i + 1))] : steps[Math.max(0, (i < 0 ? steps.length : i) - 1)]; return { sz: Math.round(nx * 2) }; }); }
  setLetterSpacing(tw: number | null) { this.applyRunCmd("hist.format", () => ({ spacing: tw })); }

  clearFormat() {
    const sp = this.spans();
    if (!sp.length || this.readonly) return;
    const sel = this.captureSel();
    for (const s of sp) {
      if (s.b > s.a) clearFormatRange(s.p, s.a, s.b);
      else { applyParaPatch(s.p, { style: null }); clearFormatRange(s.p, 0, flatLength(s.p)); }
      this.rerenderPara(s.p);
    }
    this.restoreSel(sel); this.commit("hist.clear"); this.schedulePaginate();
  }

  changeCase(mode: "upper" | "lower" | "title") {
    const sp = this.spans();
    if (!sp.length || this.readonly) return;
    const fn = mode === "upper" ? (s: string) => s.toUpperCase() : mode === "lower" ? (s: string) => s.toLowerCase() : (s: string) => s.toLowerCase().replace(/(^|[\s(\["'])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());
    const sel = this.captureSel();
    for (const s of sp) { transformText(s.p, s.b > s.a ? s.a : 0, s.b > s.a ? s.b : flatLength(s.p), fn); this.rerenderPara(s.p); }
    this.restoreSel(sel); this.commit("hist.format");
  }

  // ───────── format paragraf ─────────

  private paraCmd(label: string, patch: PPatch | ((p: XEl) => PPatch), after?: () => void) {
    if (this.readonly || !this.book) return;
    const sp = this.spans();
    if (!sp.length) return;
    const sel = this.captureSel();
    const seen = new Set<XEl>();
    for (const s of sp) { if (seen.has(s.p)) continue; seen.add(s.p); applyParaPatch(s.p, typeof patch === "function" ? patch(s.p) : patch); this.rerenderPara(s.p); }
    after?.();
    this.refreshNums();
    this.restoreSel(sel);
    this.commit(label); this.schedulePaginate();
    this.scheduleSelection();
  }
  setAlign(jc: "left" | "center" | "right" | "both") { this.paraCmd("hist.align", { jc }); }
  setStyle(id: string | null) { this.paraCmd("hist.style", { style: id }); }
  setLineSpacing(mult: number) { this.paraCmd("hist.spacing", { line: Math.round(mult * 240), lineRule: "auto" }); }
  setParaSpacing(beforePt: number | null, afterPt: number | null) { this.paraCmd("hist.spacing", { before: beforePt === null ? null : Math.round(beforePt * 20), after: afterPt === null ? null : Math.round(afterPt * 20) }); }
  setShading(color: string | null) { this.paraCmd("hist.color", { shd: color }); }
  setParaBorder(on: boolean) { this.paraCmd("hist.border", { borders: on ? { top: "000000", left: "000000", bottom: "000000", right: "000000" } : null }); }
  setIndent(leftPt: number | null, firstPt: number | null, hangingPt?: number | null) {
    this.paraCmd("hist.indent", { indLeft: leftPt === null ? null : Math.round(leftPt * 20), ...(hangingPt ? { indHanging: Math.round(hangingPt * 20) } : { indFirst: firstPt === null ? null : Math.round(firstPt * 20) }) });
  }
  indent(delta: number) {
    if (this.readonly || !this.book) return;
    const sp = this.spans();
    const sel = this.captureSel();
    changeIndent(this.book, [...new Set(sp.map(s => s.p))], delta * 720);
    for (const p of new Set(sp.map(s => s.p))) this.rerenderPara(p);
    this.refreshNums(); this.restoreSel(sel); this.commit("hist.indent"); this.schedulePaginate();
  }
  toggleList(kind: "bullet" | "number") {
    if (this.readonly || !this.book) return;
    const sp = this.spans();
    if (!sp.length) return;
    const sel = this.captureSel();
    const ps = [...new Set(sp.map(s => s.p))];
    toggleList(this.book, ps, kind);
    for (const p of ps) this.rerenderPara(p);
    this.refreshNums(); this.restoreSel(sel); this.commit("hist.list"); this.schedulePaginate();
  }

  // ───────── tautan / sisip ─────────

  setLink(url: string | null, tooltip?: string) {
    const book = this.book;
    const sp = this.spans();
    if (!book || !sp.length || this.readonly) return;
    const sel = this.captureSel();
    for (const s of sp) {
      if (url === null) unlinkRange(book, s.p, s.a, s.b);
      else if (s.b > s.a) wrapRunsInLink(book, s.p, s.a, s.b, url, tooltip);
      else {
        const l = linkAt(s.p, s.a);
        if (l) { const rid = attr(l, "id"); if (rid) book.setLinkTarget(rid, url); else setAttr(l, "anchor", url.replace(/^#/, "")); }
      }
      this.rerenderPara(s.p);
    }
    this.restoreSel(sel); this.commit("hist.link"); this.schedulePaginate();
  }

  insertTable(rows: number, cols: number) {
    const book = this.book;
    const s = this.selPoints();
    if (!book || !s || this.readonly) return;
    const parent = book.parentOf(s.b.p);
    if (!parent) return;
    const sec = this.sectionOfPara(s.b.p);
    const full = sec ? sec.w - sec.ml - sec.mr : 9000;
    const width = parent.name.local === "tc" ? Math.max(1200, Math.round((this.reg.domOf.get(s.b.p)?.offsetWidth ?? 400) / PX_PER_TWIP)) : full;
    const tbl = insertTableAfter(book, parent, s.b.p, rows, cols, width);
    book.reindex();
    this.renderAll({ sel: null });
    const first0 = this.firstParaIn(tbl);
    if (first0) this.focusPara(first0, 0);
    this.commit("hist.tblInsert");
  }
  sectionOfPara(p: XEl): Section | undefined {
    const d = this.reg.domOf.get(p);
    const page = d?.closest<HTMLElement>(".dx-page");
    const secs = this.book?.sections();
    return secs?.[Math.min(Number(page?.dataset.sec ?? 0), (secs?.length ?? 1) - 1)];
  }
  private firstParaIn(el: XEl): XEl | undefined { let r: XEl | undefined; walkBlocks(el.name.local === "tbl" ? mk("x", undefined, [el]) : el, x => { if (!r && x.name.local === "p") r = x; }); return r; }

  // ───────── tabel ─────────

  /** Konteks tabel dari caret / sel terpilih. */
  tctx(): { tbl: XEl; g: Grid; rect: Rect; cell: GCell } | null {
    const book = this.book;
    if (!book) return null;
    if (this.cellSel) {
      const g = buildGrid(this.cellSel.tbl);
      const rect = T.expandRect(g, this.cellSel);
      const cell = g.map[rect.r1]?.[rect.c1]?.origin;
      return cell ? { tbl: this.cellSel.tbl, g, rect, cell } : null;
    }
    const s = this.selPoints();
    if (!s) return null;
    const tc = book.parentOf(s.a.p);
    if (!tc || tc.name.local !== "tc") return null;
    const tr = book.parentOf(tc), tbl = tr ? book.parentOf(tr) : undefined;
    if (!tbl) return null;
    const g = buildGrid(tbl);
    const cell = g.cells.find(c => c.el === tc);
    if (!cell) return null;
    return { tbl, g, cell, rect: { r1: cell.row, c1: cell.col, r2: cell.row + cell.rowspan - 1, c2: cell.col + cell.colspan - 1 } };
  }

  private outermostTable(tbl: XEl): XEl {
    let cur = tbl;
    for (;;) {
      const tc = this.book!.parentOf(cur);
      if (!tc || tc.name.local !== "tc") return cur;
      const tr = this.book!.parentOf(tc), up = tr ? this.book!.parentOf(tr) : undefined;
      if (!up) return cur;
      cur = up;
    }
  }
  private finishTable(tbl: XEl, label: string, focusTc?: XEl) {
    const book = this.book!;
    book.reindex();
    const top = this.outermostTable(tbl);
    const old = this.reg.domOf.get(top);
    if (old) {
      const sec = old.dataset.sec ?? "0";
      const nd = renderTable(this.makeCtx(this.contentWOf(Number(sec)), book.doc.partName), top);
      nd.dataset.sec = sec;
      old.replaceWith(nd);
    } else this.renderAll({ sel: null });
    this.refreshNums();
    this.applyCellSelVisual();
    let target = focusTc;
    if (!target || !this.book!.parentOf(target)) {
      const g2 = buildGrid(tbl);
      const lc = this.lastCell;
      target = lc ? g2.map[Math.min(lc.row, g2.rows.length - 1)]?.[Math.min(lc.col, g2.ncols - 1)]?.origin.el : undefined;
    }
    if (target) { const p = this.firstParaIn(target); if (p) this.focusPara(p, 0, false); }
    this.commit(label);
    this.schedulePaginate(30);
  }
  private lastCell: { row: number; col: number } | null = null;

  /** Perintah tabel. `arg` bergantung pada `op`. */
  table(op: string, arg?: unknown): void {
    const c = this.tctx();
    const book = this.book;
    if (!c || !book || this.readonly) return;
    const { tbl, g, rect, cell } = c;
    const focusTc = cell.el;
    this.lastCell = { row: rect.r1, col: rect.c1 };
    const cellsInRect = () => { const set = new Set<XEl>(); for (let r = rect.r1; r <= rect.r2; r++) for (let cc = rect.c1; cc <= rect.c2; cc++) { const x = g.map[r]?.[cc]?.origin; if (x) set.add(x.el); } return [...set]; };
    const sides = (p: string): T.BorderSide[] => p === "all" ? ["top", "left", "bottom", "right", "insideH", "insideV"] : p === "outer" ? ["top", "left", "bottom", "right"] : p === "inner" ? ["insideH", "insideV"] : [p as T.BorderSide];
    switch (op) {
      case "insertRowAbove": T.insertRow(tbl, rect.r1, "above"); return this.finishTable(tbl, "hist.tblRow", focusTc);
      case "insertRowBelow": T.insertRow(tbl, rect.r2, "below"); return this.finishTable(tbl, "hist.tblRow", focusTc);
      case "insertColLeft": T.insertCol(tbl, rect.c1, "left"); return this.finishTable(tbl, "hist.tblCol", focusTc);
      case "insertColRight": T.insertCol(tbl, rect.c2, "right"); return this.finishTable(tbl, "hist.tblCol", focusTc);
      case "deleteRows": if (T.deleteRows(tbl, rect.r1, rect.r2) === "table") return this.table("deleteTable"); this.clearCellSel(); return this.finishTable(tbl, "hist.tblDelRow");
      case "deleteCols": if (T.deleteCols(tbl, rect.c1, rect.c2) === "table") return this.table("deleteTable"); this.clearCellSel(); return this.finishTable(tbl, "hist.tblDelCol");
      case "deleteTable": {
        const parent = book.parentOf(tbl);
        if (!parent) return;
        const sibs = this.blockSiblings(parent); const nx = sibs[sibs.indexOf(tbl) + 1] ?? sibs[sibs.indexOf(tbl) - 1];
        deleteBlock(parent, tbl);
        this.cellSel = null;
        this.commitStructural("hist.tblDelete");
        const p = nx && nx.name.local === "p" ? nx : undefined;
        if (p) this.focusPara(p, 0, false);
        return;
      }
      case "merge": { const k = T.mergeCells(tbl, rect); if (!k) return; this.clearCellSel(); return this.finishTable(tbl, "hist.tblMerge", k); }
      case "split": { const k = T.splitCell(tbl, cell.row, cell.col, typeof arg === "number" ? arg : 2); this.clearCellSel(); return this.finishTable(tbl, "hist.tblSplit", k); }
      case "shade": for (const tc of cellsInRect()) T.setCellShading(tc, arg as string | null); return this.finishTable(tbl, "hist.tblShade", focusTc);
      case "valign": for (const tc of cellsInRect()) T.setCellVAlign(tc, arg as "top" | "center" | "bottom"); return this.finishTable(tbl, "hist.tblAlign", focusTc);
      case "noWrap": for (const tc of cellsInRect()) T.setCellNoWrap(tc, !!arg); return this.finishTable(tbl, "hist.tbl", focusTc);
      case "direction": for (const tc of cellsInRect()) T.setCellDirection(tc, arg as "lrTb" | "btLr" | "tbRl"); return this.finishTable(tbl, "hist.tbl", focusTc);
      case "cellMargins": for (const tc of cellsInRect()) T.setCellMargins(tc, arg as { top?: number; left?: number; bottom?: number; right?: number } | null); return this.finishTable(tbl, "hist.tbl", focusTc);
      case "borders": {
        const a = arg as { preset: string; spec: T.BorderSpec | null; scope?: "cells" | "table" };
        const whole = a.scope === "table" || (rect.r1 === 0 && rect.c1 === 0 && rect.r2 === g.rows.length - 1 && rect.c2 === g.ncols - 1);
        if (whole) { if (a.preset === "all" || a.preset === "none") T.clearCellBorders(tbl); T.setTableBorders(tbl, sides(a.preset === "none" ? "all" : a.preset), a.preset === "none" ? null : a.spec); }
        else for (const cl of g.cells) {
          if (cl.row < rect.r1 || cl.row > rect.r2 || cl.col < rect.c1 || cl.col > rect.c2) continue;
          const ss = a.preset === "none" ? (["top", "left", "bottom", "right"] as T.BorderSide[]) : this.cellSides(a.preset, cl, rect);
          T.setCellBorders(cl.el, ss, a.preset === "none" ? null : a.spec);
        }
        return this.finishTable(tbl, "hist.tblBorder", focusTc);
      }
      case "align": T.setTableAlign(tbl, arg as "left" | "center" | "right"); return this.finishTable(tbl, "hist.tblAlign", focusTc);
      case "style": T.setTableStyle(tbl, arg as string | null); return this.finishTable(tbl, "hist.tblStyle", focusTc);
      case "look": T.setTableLook(tbl, arg as Parameters<typeof T.setTableLook>[1]); return this.finishTable(tbl, "hist.tblStyle", focusTc);
      case "layout": T.setTableLayout(tbl, !!arg); return this.finishTable(tbl, "hist.tbl", focusTc);
      case "width": { const a = arg as { mode: "auto" | "pct" | "dxa"; value?: number }; T.setTableWidthMode(tbl, a.mode, a.value); if (a.mode === "dxa" && a.value) { const w = T.gridWidths(g); const sum = w.reduce((x, y) => x + y, 0); T.setTableWidths(tbl, w.map(x => (x * a.value!) / sum)); } return this.finishTable(tbl, "hist.tbl", focusTc); }
      case "rowHeight": for (const r of new Set(Array.from({ length: rect.r2 - rect.r1 + 1 }, (_, i) => g.rows[rect.r1 + i]))) T.setRowHeight(r, arg === null ? null : Math.round((arg as number) * 20)); return this.finishTable(tbl, "hist.tbl", focusTc);
      case "headerRow": for (const r of new Set(Array.from({ length: rect.r2 - rect.r1 + 1 }, (_, i) => g.rows[rect.r1 + i]))) T.setHeaderRow(r, !!arg); return this.finishTable(tbl, "hist.tbl", focusTc);
      case "distCols": T.distributeColumns(tbl, rect.c1 === rect.c2 ? 0 : rect.c1, rect.c1 === rect.c2 ? g.ncols - 1 : rect.c2); return this.finishTable(tbl, "hist.tblResize", focusTc);
      case "caption": { const a = arg as { title?: string; desc?: string }; T.setTableCaption(tbl, a.title, a.desc); return this.finishTable(tbl, "hist.tbl", focusTc); }
      case "select": { this.setCellSel(tbl, { r1: 0, c1: 0, r2: g.rows.length - 1, c2: g.ncols - 1 }); return; }
      case "selectRow": { this.setCellSel(tbl, { r1: rect.r1, c1: 0, r2: rect.r2, c2: g.ncols - 1 }); return; }
      case "selectCol": { this.setCellSel(tbl, { r1: 0, c1: rect.c1, r2: g.rows.length - 1, c2: rect.c2 }); return; }
      default: return;
    }
  }
  private cellSides(preset: string, cl: GCell, rect: Rect): T.BorderSide[] {
    const endR = cl.row + cl.rowspan - 1, endC = cl.col + cl.colspan - 1;
    if (preset === "all") return ["top", "left", "bottom", "right"];
    if (preset === "outer") { const o: T.BorderSide[] = []; if (cl.row === rect.r1) o.push("top"); if (endR === rect.r2) o.push("bottom"); if (cl.col === rect.c1) o.push("left"); if (endC === rect.c2) o.push("right"); return o; }
    if (preset === "inner") { const o: T.BorderSide[] = []; if (cl.row > rect.r1) o.push("top"); if (endR < rect.r2) o.push("bottom"); if (cl.col > rect.c1) o.push("left"); if (endC < rect.c2) o.push("right"); return o; }
    if (preset === "top") return cl.row === rect.r1 ? ["top"] : [];
    if (preset === "bottom") return endR === rect.r2 ? ["bottom"] : [];
    if (preset === "left") return cl.col === rect.c1 ? ["left"] : [];
    if (preset === "right") return endC === rect.c2 ? ["right"] : [];
    if (preset === "insideH") return [...(cl.row > rect.r1 ? ["top" as const] : []), ...(endR < rect.r2 ? ["bottom" as const] : [])];
    if (preset === "insideV") return [...(cl.col > rect.c1 ? ["left" as const] : []), ...(endC < rect.c2 ? ["right" as const] : [])];
    return [];
  }

  private clearCells() {
    const c = this.tctx();
    if (!c) return;
    const sel = c.g.cells.filter(x => x.row >= c.rect.r1 && x.row <= c.rect.r2 && x.col >= c.rect.c1 && x.col <= c.rect.c2);
    for (const cl of sel) { const keep = cl.el.children.find(k => isEl(k) && k.name.local === "tcPr"); cl.el.children = keep ? [keep, mk("p")] : [mk("p")]; }
    this.finishTable(c.tbl, "hist.delete");
  }

  private tableNavigate(c: NonNullable<ReturnType<DocxView["tctx"]>>, dir: 1 | -1) {
    const { g, cell } = c;
    const order = g.cells.filter(x => x.vm !== "continue");
    const i = order.indexOf(cell) + dir;
    if (i >= 0 && i < order.length) { const p = this.firstParaIn(order[i].el); if (p) this.focusPara(p, 0, false); return; }
    if (dir === 1 && !this.readonly) {
      T.insertRow(c.tbl, g.rows.length - 1, "below");
      const g2 = buildGrid(c.tbl);
      const target = g2.map[g2.rows.length - 1]?.[0]?.el;
      this.finishTable(c.tbl, "hist.tblRow", target);
    }
  }

  setCellSel(tbl: XEl, r: Rect) {
    const g = buildGrid(tbl);
    const rect = T.expandRect(g, r);
    this.cellSel = { tbl, ...rect };
    this.applyCellSelVisual();
    this.scheduleSelection();
  }
  clearCellSel() { this.cellSel = null; this.applyCellSelVisual(); this.scheduleSelection(); }
  private applyCellSelVisual() {
    this.pagesEl.querySelectorAll(".dx-sel").forEach(e => e.classList.remove("dx-sel"));
    if (!this.cellSel) return;
    const g = buildGrid(this.cellSel.tbl);
    const r = T.expandRect(g, this.cellSel);
    for (const cl of g.cells) {
      if (cl.vm === "continue" || cl.row < r.r1 || cl.row > r.r2 || cl.col < r.c1 || cl.col > r.c2) continue;
      this.reg.domOf.get(cl.el)?.classList.add("dx-sel");
    }
  }

  // ───────── gambar ─────────

  private drawingParaEl(el: HTMLElement) { return el.closest<HTMLElement>(".dx-p"); }
  selectImageEl(el: HTMLElement | undefined | null) {
    if (!el || el.classList.contains("dx-ole")) { this.clearImageSel(); return; }
    const dr = this.reg.elOf.get(el);
    if (!dr || dr.name.local !== "drawing") { this.clearImageSel(); return; }
    this.imgSel = { el, drawing: dr };
    this.lockAspect = readDrawing(dr)?.lockAspect ?? this.lockAspect;
    // pindahkan caret tepat sebelum gambar agar info paragraf/tabel di status bar mengikuti gambar (bukan seleksi lama)
    const pd = el.closest<HTMLElement>(".dx-p");
    const pp = pd ? this.reg.elOf.get(pd) : undefined;
    if (pp && this.isBodyPara(pp)) {
      const u = units(pp).find(x => x.piece === dr || descendAll(x.piece, "drawing").includes(dr));
      this.saved = { a: { p: pp, off: u?.start ?? 0 }, b: { p: pp, off: u?.start ?? 0 } };
      this.cellSel = null;
      this.applyCellSelVisual();
      const f = flatToDomPos(pd!, u?.start ?? 0);
      window.getSelection()?.setBaseAndExtent(f.node, f.offset, f.node, f.offset);
    }
    this.updateOverlay();
    this.scheduleSelection();
    el.classList.add("dx-selected");
  }
  clearImageSel() { if (this.imgSel) { this.imgSel.el.classList.remove("dx-selected"); this.imgSel = null; this.updateOverlay(); this.scheduleSelection(); } }

  updateOverlay() {
    this.overlay.querySelectorAll(".dx-imgsel").forEach(e => e.remove());
    const s = this.imgSel;
    if (!s || !s.el.isConnected) return;
    const r = s.el.getBoundingClientRect(), o = this.stage.getBoundingClientRect();
    const box = document.createElement("div");
    box.className = "dx-imgsel";
    box.style.cssText = `left:${r.left - o.left}px;top:${r.top - o.top}px;width:${r.width}px;height:${r.height}px;`;
    if (!this.readonly) for (const h of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
      const hd = document.createElement("div");
      hd.className = `dx-h dx-h-${h}`; hd.dataset.h = h;
      hd.addEventListener("mousedown", ev => { ev.preventDefault(); ev.stopPropagation(); this.imgDragStart(h, ev); });
      box.appendChild(hd);
    }
    const label = document.createElement("div");
    label.className = "dx-imglabel";
    label.textContent = `${Math.round(s.el.offsetWidth)} × ${Math.round(s.el.offsetHeight)} px`;
    box.appendChild(label);
    if (s.el.dataset.wrap === "abs" && !this.readonly) {
      box.style.pointerEvents = "auto"; box.style.cursor = "move";
      box.addEventListener("mousedown", ev => { if ((ev.target as HTMLElement).classList.contains("dx-h")) return; ev.preventDefault(); this.imgDragStart("move", ev); });
    }
    this.overlay.appendChild(box);
  }

  private imgDragStart(handle: string, e: MouseEvent) {
    const s = this.imgSel;
    if (!s) return;
    const w0 = s.el.offsetWidth, h0 = s.el.offsetHeight;
    this.imgDrag = { mode: handle === "move" ? "move" : "resize", handle, sx: e.clientX, sy: e.clientY, w0, h0, l0: parseFloat(s.el.style.left) || 0, t0: parseFloat(s.el.style.top) || 0, ratio: w0 / Math.max(1, h0), el: s.el, drawing: s.drawing };
  }
  private imgDragMove(e: MouseEvent) {
    const d = this.imgDrag!;
    const dx = (e.clientX - d.sx) / this.zoom, dy = (e.clientY - d.sy) / this.zoom;
    if (d.mode === "move") {
      let l = d.l0 + dx, t = d.t0 + dy;
      d.el.style.left = `${l}px`; d.el.style.top = `${t}px`;
      if (this.snapGuides && !e.altKey) { // menempel ke garis bantu penggaris (Alt = tanpa snap)
        const sn = this.snapGuides(d.el.getBoundingClientRect());
        if (sn.dx || sn.dy) { l += sn.dx; t += sn.dy; d.el.style.left = `${l}px`; d.el.style.top = `${t}px`; }
      }
      this.updateOverlay();
      return;
    }
    const h = d.handle;
    let w = d.w0, hh = d.h0;
    if (h.includes("e")) w = d.w0 + dx; if (h.includes("w")) w = d.w0 - dx;
    if (h.includes("s")) hh = d.h0 + dy; if (h.includes("n")) hh = d.h0 - dy;
    const lock = this.lockAspect !== e.shiftKey;
    const corner = h.length === 2;
    if (lock) {
      if (corner) { const sx = w / d.w0, sy = hh / d.h0; const k = Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy; w = d.w0 * k; hh = d.h0 * k; }
      else if (h === "e" || h === "w") hh = w / d.ratio;
      else w = hh * d.ratio;
    }
    w = Math.max(12, w); hh = Math.max(12, hh);
    d.el.style.width = `${w}px`; d.el.style.height = `${hh}px`;
    if (d.el.dataset.wrap === "abs") { if (h.includes("w")) d.el.style.left = `${d.l0 + (d.w0 - w)}px`; if (h.includes("n")) d.el.style.top = `${d.t0 + (d.h0 - hh)}px`; }
    this.updateOverlay();
  }
  private imgDragEnd() {
    const d = this.imgDrag!;
    this.imgDrag = null;
    const book = this.book!;
    const info = readDrawing(d.drawing);
    if (d.mode === "move") {
      const fr = info ? this.paginator.anchorBase(d.el, info) : undefined;
      if (info && fr) {
        const x = fr.px0 + (parseFloat(d.el.style.left) || 0), y = fr.py0 + (parseFloat(d.el.style.top) || 0);
        const relH = info.posH?.rel ?? "page", relV = info.posV?.rel ?? "page";
        setPosition(d.drawing, (x - fr.baseX(relH)[0]) * 9525, (y - fr.baseY(relV)[0]) * 9525, relH, relV);
        const hfm = this.hfOf(d.el);
        if (hfm) this.book!.touchHF(hfm);
        this.commit("hist.imgMove");
        this.paginator.layoutAnchors();
      }
      this.updateOverlay();
      return;
    }
    const w = d.el.offsetWidth, h = d.el.offsetHeight;
    if (Math.abs(w - d.w0) < 1 && Math.abs(h - d.h0) < 1) return;
    setSize(d.drawing, w * 9525, h * 9525);
    void book;
    this.afterImageChange("hist.imgResize");
  }

  /** relId header/footer tempat elemen berada (undefined bila di body). */
  private hfOf(el: HTMLElement): string | undefined { return el.closest<HTMLElement>("[data-hf]")?.dataset.hf; }

  /** Perubahan pada gambar di header/footer: simpan ke pohon header, gambar ulang semua halaman, pilih ulang gambar. */
  private afterHFImageChange(label: string, relId: string, reselect: boolean) {
    const drawing = this.imgSel?.drawing;
    this.book!.touchHF(relId);
    this.commit(label);
    this.paginate();
    this.selectImageEl(reselect && drawing ? this.reg.domOf.get(drawing) : null);
  }

  private afterImageChange(label: string, reselect = true) {
    const hf = this.imgSel ? this.hfOf(this.imgSel.el) : undefined;
    if (hf) { this.afterHFImageChange(label, hf, reselect); return; }
    const s = this.imgSel;
    const p = s ? this.reg.elOf.get(this.drawingParaEl(s.el) ?? s.el) : undefined;
    const drawing = s?.drawing;
    if (p) this.rerenderPara(p);
    if (reselect && drawing) this.selectImageEl(this.reg.domOf.get(drawing));
    this.commit(label);
    this.schedulePaginate(30);
  }

  imgInfo(): ImgSelInfo | undefined {
    const s = this.imgSel;
    if (!s || !this.book) return undefined;
    const i = readDrawing(s.drawing);
    if (!i) return undefined;
    let natural: { w: number; h: number } | undefined;
    let format = "";
    if (i.relId) {
      const part = this.book.mediaPart(i.relId);
      if (part) { const z = sniffImageSize(part.data); if (z) natural = { w: z.w, h: z.h }; format = part.contentType.replace("image/", "") + ` · ${Math.round(part.data.length / 1024)} KB`; }
    }
    return { name: i.name, descr: i.descr, wPx: Math.round(i.cx / 9525), hPx: Math.round(i.cy / 9525), wrap: i.wrap, lock: this.lockAspect, rot: i.rot, content: i.content, floating: i.kind === "anchor", format, relId: i.relId, natural };
  }

  imgSetSize(wPx: number | null, hPx: number | null) {
    const s = this.imgSel;
    if (!s || this.readonly) return;
    const i = readDrawing(s.drawing);
    if (!i) return;
    let w = wPx ?? i.cx / 9525, h = hPx ?? i.cy / 9525;
    if (this.lockAspect) { const r = i.cx / Math.max(1, i.cy); if (wPx !== null && hPx === null) h = w / r; else if (hPx !== null && wPx === null) w = h * r; }
    setSize(s.drawing, Math.max(8, w) * 9525, Math.max(8, h) * 9525);
    this.afterImageChange("hist.imgResize");
  }
  imgSetLock(on: boolean) { this.lockAspect = on; if (this.imgSel) setLockAspect(this.imgSel.drawing, on); this.updateOverlay(); this.scheduleSelection(); }
  imgSetWrap(mode: WrapMode, h?: "left" | "center" | "right") {
    const s = this.imgSel;
    if (!s || this.readonly) return;
    setWrapMode(s.drawing, mode, { h, rel: mode === "behind" || mode === "front" ? "margin" : undefined });
    this.afterImageChange("hist.imgWrap");
  }
  imgSetAlt(descr: string, title?: string) { if (this.imgSel && !this.readonly) { setAlt(this.imgSel.drawing, descr, title); this.afterImageChange("hist.imgAlt"); } }
  imgRotate(deg: number) { const s = this.imgSel; if (!s || this.readonly) return; setRotation(s.drawing, deg); this.afterImageChange("hist.imgRotate"); }
  imgFlip(axis: "h" | "v") { const s = this.imgSel; if (!s || this.readonly) return; const i = readDrawing(s.drawing)!; setRotation(s.drawing, i.rot, axis === "h" ? !i.flipH : i.flipH, axis === "v" ? !i.flipV : i.flipV); this.afterImageChange("hist.imgRotate"); }
  imgCrop(c: { l: number; t: number; r: number; b: number } | null) { const s = this.imgSel; if (!s || this.readonly) return; setCrop(s.drawing, c ? { l: c.l * 1000, t: c.t * 1000, r: c.r * 1000, b: c.b * 1000 } : null); this.afterImageChange("hist.imgCrop"); }
  imgReset() {
    const s = this.imgSel; const i = s && readDrawing(s.drawing);
    if (!s || !i?.relId || this.readonly) return;
    const part = this.book!.mediaPart(i.relId);
    const z = part && sniffImageSize(part.data);
    if (!z) return;
    setSize(s.drawing, z.w * 9525 * 0.75, z.h * 9525 * 0.75);
    setCrop(s.drawing, null); setRotation(s.drawing, 0, false, false);
    this.afterImageChange("hist.imgResize");
  }
  imgNudge(dx: number, dy: number) {
    const s = this.imgSel; const i = s && readDrawing(s.drawing);
    if (!s || !i || i.kind !== "anchor") return;
    const fr = this.paginator.anchorBase(s.el, i);
    if (!fr) return;
    const x = fr.px0 + (parseFloat(s.el.style.left) || 0) + dx, y = fr.py0 + (parseFloat(s.el.style.top) || 0) + dy;
    const relH = i.posH?.rel ?? "page", relV = i.posV?.rel ?? "page";
    setPosition(s.drawing, (x - fr.baseX(relH)[0]) * 9525, (y - fr.baseY(relV)[0]) * 9525, relH, relV);
    this.paginator.layoutAnchors(); this.updateOverlay(); this.commit("hist.imgMove", "hist.imgMove");
  }
  imgDelete() {
    const s = this.imgSel;
    if (!s || this.readonly || !this.book) return;
    const p = this.reg.elOf.get(this.drawingParaEl(s.el) ?? s.el);
    if (!p) return;
    const u = units(p).find(x => x.piece === s.drawing || descendAll(x.piece, "drawing").includes(s.drawing));
    if (!u) return;
    const hf = this.hfOf(s.el);
    deleteRange(p, u.start, u.end);
    normalize(p);
    if (hf) { this.afterHFImageChange("hist.imgDelete", hf, false); return; }
    this.imgSel = null;
    this.rerenderPara(p);
    this.setCaret(p, u.start);
    this.updateOverlay();
    this.commit("hist.imgDelete"); this.schedulePaginate(30);
  }
  imgDuplicate() { if (this.imgSel) { this.imgClip = cloneEl(this.imgSel.drawing); this.imgPaste(); } }
  imgPaste() {
    const book = this.book;
    const s = this.selPoints();
    if (!book || !this.imgClip || this.readonly) return;
    let pt: Point | null = s ? { p: s.a.p, off: s.a.off } : null;
    if (!pt && this.imgSel) { const p = this.reg.elOf.get(this.drawingParaEl(this.imgSel.el) ?? this.imgSel.el); if (p) pt = { p, off: flatLength(p) }; }
    if (!pt) return;
    if (s && !s.collapsed) { const d = this.deleteSelection(); if (d) pt = d; }
    const nd = cloneDrawing(this.imgClip, maxDocPrId(book.body) + 1);
    insertTextRunDrawing(pt.p, pt.off, nd);
    this.rerenderPara(pt.p);
    this.selectImageEl(this.reg.domOf.get(nd));
    this.commit("hist.imgInsert"); this.schedulePaginate(30);
  }

  async insertImageFile(file: File) {
    const book = this.book;
    if (!book || this.readonly) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let size = sniffImageSize(bytes);
      if (!size) size = await decodeImageSize(file);
      if (!size) { this.hooks.toast("toast.imgUnsupported", { name: file.name }); return; }
      const s = this.selPoints();
      const ps = [...book.paragraphs()];
      let pt: Point | null = s ? { p: s.a.p, off: s.a.off } : ps.length ? { p: ps[ps.length - 1].p, off: flatLength(ps[ps.length - 1].p) } : null;
      if (!pt) return;
      if (s && !s.collapsed) { const d = this.deleteSelection(); if (d) pt = d; }
      const sec = this.sectionOfPara(pt.p);
      const maxW = Math.min(MAX_IMG_W, sec ? ((sec.w - sec.ml - sec.mr) * 96) / 1440 : MAX_IMG_W);
      const maxH = sec ? ((sec.h - sec.mt - sec.mb) * 96) / 1440 * 0.9 : 800;
      let w = size.w * 0.75 > 4 ? size.w * 0.75 : size.w, h = size.h * 0.75 > 4 ? size.h * 0.75 : size.h;
      const k = Math.min(1, maxW / w, maxH / h);
      w = Math.max(8, w * k); h = Math.max(8, h * k);
      const drawing = insertImageAt(book, pt.p, pt.off, bytes, w, h, file.name.replace(/\.[^.]+$/, ""), file.type || size.type);
      this.rerenderPara(pt.p);
      this.selectImageEl(this.reg.domOf.get(drawing));
      this.commit("hist.imgInsert"); this.schedulePaginate(30);
    } catch (err) {
      this.hooks.log("error", "images", "log.imgInsertFail", { msg: err instanceof Error ? err.message : String(err) });
      this.hooks.toast("toast.imgFail", { name: file.name });
    }
  }
  // ───────── objek OLE ─────────

  /** Sisipkan objek OLE di kursor (mengganti seleksi bila ada). */
  insertOle(prep: PreparedOle, size?: { wPx: number; hPx: number }): (DocxOleRef & { paragraph: number }) | undefined {
    const book = this.book;
    if (!book || this.readonly) return undefined;
    const s = this.selPoints();
    const ps = [...book.paragraphs()];
    let pt: Point | null = s ? { p: s.a.p, off: s.a.off } : ps.length ? { p: ps[ps.length - 1].p, off: flatLength(ps[ps.length - 1].p) } : null;
    if (!pt) return undefined;
    if (s && !s.collapsed) { const d = this.deleteSelection(); if (d) pt = d; }
    const sec = this.sectionOfPara(pt.p);
    const maxW = sec ? ((sec.w - sec.ml - sec.mr) * 96) / 1440 : MAX_IMG_W;
    const w = Math.min(size?.wPx ?? prep.previewWidth, maxW), h = (size?.hPx ?? prep.previewHeight) * (w / (size?.wPx ?? prep.previewWidth));
    const { run, ref } = createOleRun(book, prep, { wPx: w, hPx: h });
    insertRunAt(pt.p, pt.off, run);
    this.rerenderPara(pt.p);
    this.commit("hist.oleInsert");
    this.schedulePaginate(30);
    return { ...ref, paragraph: [...book.paragraphs()].findIndex(x => x.p === pt!.p) + 1 };
  }

  /** Ganti isi objek OLE `relId`. Mengembalikan referensi baru (relId berubah agar undo tetap benar). */
  updateOle(relId: string, prep: PreparedOle, opts: { keepPreview?: boolean } = {}): ReturnType<typeof updateOleObject> | undefined {
    const book = this.book;
    if (!book || this.readonly) return undefined;
    const found = findOleObject(book, relId);
    if (!found) return undefined;
    const res = updateOleObject(book, relId, prep, opts);
    this.rerenderPara(found.p);
    this.commit("hist.oleUpdate");
    this.schedulePaginate(30);
    return res;
  }

  /** Ubah ukuran tampilan objek OLE (px CSS). */
  resizeOle(relId: string, wPx: number, hPx: number): boolean {
    const book = this.book;
    if (!book || this.readonly || !(wPx > 4) || !(hPx > 4)) return false;
    const found = findOleObject(book, relId);
    if (!found || !setOleSize(book, relId, wPx, hPx)) return false;
    this.rerenderPara(found.p);
    this.commit("hist.oleSize");
    this.schedulePaginate(30);
    return true;
  }
  oleDisplaySize(relId: string) { return this.book ? oleSize(this.book, relId) : undefined; }

  /** Halaman yang paling dekat dengan pusat area gulir beserta ukuran & margin (px dokumen) — dasar penggaris. */
  pageGeometry(): { el: HTMLElement; width: number; height: number; ml: number; mr: number; mt: number; mb: number; no: number } | null {
    const pages = [...this.pagesEl.querySelectorAll<HTMLElement>(".dx-page")];
    if (!pages.length) return null;
    const sr = this.host.getBoundingClientRect(); // area gulir yang terlihat (bukan stage: tingginya seluruh dokumen)
    const mid = sr.top + sr.height / 2;
    let best = pages[0], bd = Infinity;
    for (const p of pages) {
      const r = p.getBoundingClientRect();
      const d = mid >= r.top && mid <= r.bottom ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid));
      if (d < bd) { bd = d; best = p; }
    }
    const secs = this.book?.sections();
    const sec = secs?.[Math.min(Number(best.dataset.sec ?? 0), (secs?.length ?? 1) - 1)];
    const k = 96 / 1440;
    return {
      el: best, width: best.offsetWidth, height: best.offsetHeight, no: Number(best.dataset.no ?? 0),
      ml: sec ? (sec.ml + sec.gutter) * k : 96, mr: sec ? sec.mr * k : 96, mt: sec ? sec.mt * k : 96, mb: sec ? sec.mb * k : 96,
    };
  }

  async imgReplace(file: File) {
    const s = this.imgSel; const book = this.book;
    if (!s || !book || this.readonly) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const i = readDrawing(s.drawing);
    const tmp = book.createImageDrawing(bytes, i?.cx ?? 914400, i?.cy ?? 914400, { name: i?.name, contentType: file.type || undefined });
    const rid = readDrawing(tmp)?.relId;
    if (rid) replaceBlip(s.drawing, rid);
    this.afterImageChange("hist.imgReplace");
  }

  // ───────── format painter ─────────

  startPainter(sticky = false) {
    const book = this.book;
    const s = this.selPoints();
    if (!book || !s || this.readonly) return;
    const clip = captureFormat(book, s.a.p, s.a.off, !s.collapsed);
    this.painter = { clip, sticky };
    this.pagesEl.classList.add("dx-painter");
    this.hooks.painter({ char: clip.desc.char, para: clip.desc.para, sticky });
  }
  cancelPainter() {
    this.painter = null;
    this.pagesEl.classList.remove("dx-painter");
    this.hooks.painter(null);
  }
  private applyPainter() {
    const pn = this.painter;
    const book = this.book;
    if (!pn || !book) return;
    const sp = this.spans();
    if (!sp.length) return;
    const collapsed = sp.length === 1 && sp[0].a === sp[0].b;
    const sel = this.captureSel();
    const targets = sp.map(s => ({ ...s, whole: collapsed }));
    const para = collapsed || sp.length > 1 || sp.some(s => s.a === 0 && s.b === flatLength(s.p));
    applyFormat(book, targets, pn.clip, { char: true, para });
    for (const s of sp) this.rerenderPara(s.p);
    this.refreshNums(); this.restoreSel(sel);
    this.commit("hist.painter"); this.schedulePaginate();
    if (!pn.sticky) this.cancelPainter();
  }

  // ───────── pencarian ─────────

  search(o: SearchOpts): SearchResult {
    const r = this.book ? findAll(this.book, o) : { hits: [], truncated: false, paragraphs: 0 };
    this.findHits = r.hits;
    this.findCur = -1;
    this.applyHighlights();
    return r;
  }
  clearSearch() { this.findHits = []; this.findCur = -1; this.clearHighlights(); }
  pageOfHit(h: Hit): number { return Number(this.reg.domOf.get(h.p)?.closest<HTMLElement>(".dx-page")?.dataset.no ?? 0); }
  gotoHit(i: number) {
    const h = this.findHits[i];
    if (!h) return;
    this.findCur = i;
    const d = this.reg.domOf.get(h.p);
    if (!d) return;
    this.applyHighlights();
    const r = rangeFromFlat(d, h.start, h.end);
    if (typeof r.getBoundingClientRect === "function") {
      const rect = r.getBoundingClientRect();
      const hr = this.host.getBoundingClientRect();
      if (rect.top < hr.top + 40 || rect.bottom > hr.bottom - 40) this.host.scrollTop += rect.top - hr.top - hr.height / 3;
      if (rect.left < hr.left || rect.right > hr.right) this.host.scrollLeft += rect.left - hr.left - 60;
    }
    window.getSelection()?.setBaseAndExtent(r.startContainer, r.startOffset, r.endContainer, r.endOffset);
  }
  private clearHighlights() {
    const hl = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    hl?.delete("dx-find"); hl?.delete("dx-find-cur");
  }
  applyHighlights() {
    const hl = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const H = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!hl || !H) return;
    this.clearHighlights();
    if (!this.findHits.length) return;
    const all: Range[] = []; let cur: Range | undefined;
    this.findHits.forEach((h, i) => {
      const d = this.reg.domOf.get(h.p);
      if (!d || !d.isConnected) return;
      const r = rangeFromFlat(d, h.start, h.end);
      if (i === this.findCur) cur = r; else all.push(r);
    });
    hl.set("dx-find", new H(...all));
    if (cur) hl.set("dx-find-cur", new H(cur));
  }
  replaceHitsBy(hits: Hit[], o: SearchOpts, replacement: string): number {
    if (!this.book || this.readonly || !hits.length) return 0;
    const n = replaceHits(hits, o, replacement);
    for (const p of new Set(hits.map(h => h.p))) { normalize(p); this.rerenderPara(p); }
    this.commit("hist.replace"); this.schedulePaginate(30);
    return n;
  }

  // ───────── info ─────────

  private plist: XEl[] | null = null;
  invalidateIndex() { this.plist = null; }
  outline(): { p: XEl; level: number; text: string }[] {
    const book = this.book;
    if (!book) return [];
    const out: { p: XEl; level: number; text: string }[] = [];
    for (const { p } of book.paragraphs()) {
      const pPr = first(p, "pPr");
      const sid = val(pPr, "pStyle");
      const h = book.styles.isHeading(sid);
      const ol = readP(pPr, book.styles.theme).outline ?? book.styles.paraLayer(sid).p.outline;
      const level = h !== undefined && h > 0 ? h : ol !== undefined ? ol + 1 : h === 0 ? 1 : 0;
      if (level > 0) { const t = flatText(p).replace(/[￼\f]/g, "").trim(); if (t) out.push({ p, level, text: t }); }
    }
    return out;
  }
  scrollToPara(p: XEl) { this.reg.domOf.get(p)?.scrollIntoView({ block: "start", behavior: "smooth" }); }

  private scheduleSelection() { if (this.selRaf) return; this.selRaf = requestAnimationFrame(() => { this.selRaf = 0; this.emitSelection(); }); }

  emitSelection() {
    const book = this.book;
    if (!book) return;
    const s = this.selPoints();
    const base: SelInfo = {
      has: false, collapsed: true, page: 0, pages: this.paginator.count, paraIndex: 0, paraCount: 0, col: 0, selChars: 0, selWords: 0, selParas: 0,
      bold: false, italic: false, underline: false, strike: false, sup: false, sub: false, region: "other",
    };
    base.image = this.imgInfo();
    if (this.cellSel) {
      const g = buildGrid(this.cellSel.tbl); const r = T.expandRect(g, this.cellSel);
      base.table = { index: book.tables().indexOf(this.cellSel.tbl) + 1, row: r.r1 + 1, col: r.c1 + 1, rows: g.rows.length, cols: g.ncols, merged: false, selRows: r.r2 - r.r1 + 1, selCols: r.c2 - r.c1 + 1 };
    }
    if (s) {
      const { a, b } = s;
      const d = this.reg.domOf.get(a.p);
      if (!this.plist) this.plist = [...book.paragraphs()].map(x => x.p);
      const list = this.plist;
      const spans = this.spans();
      let chars = 0, words = 0;
      for (const sp of spans) { if (sp.b > sp.a) { const t = flatText(sp.p).slice(sp.a, sp.b).replace(/[￼\f]/g, ""); chars += t.length; words += (t.match(/\S+/g) ?? []).length; } }
      const sid = val(first(a.p, "pPr"), "pStyle");
      const pb = book.styles.paraBase(sid, condForParagraph(book, a.p));
      const direct = readP(first(a.p, "pPr"), book.styles.theme);
      const pr = { ...pb.p, ...direct };
      const run = this.runAt(a.p, a.off);
      let r = this.runResolved(a.p, run);
      const pend = this.pending && this.pending.p === a.p && this.pending.off === a.off ? this.pending.patch : undefined;
      Object.assign(base, {
        has: true, collapsed: s.collapsed, region: "body", page: Number(d?.closest<HTMLElement>(".dx-page")?.dataset.no ?? 0), paraIndex: list.indexOf(a.p) + 1, paraCount: list.length, col: a.off + 1,
        selChars: chars, selWords: words, selParas: new Set(spans.map(x => x.p)).size, styleId: pb.styleId, styleName: book.styles.name(pb.styleId),
      });
      if (pend) r = { ...r, ...(pend.b !== undefined ? { b: !!pend.b } : {}), ...(pend.i !== undefined ? { i: !!pend.i } : {}), ...(pend.u !== undefined ? { u: pend.u ?? undefined } : {}), ...(pend.strike !== undefined ? { strike: !!pend.strike } : {}), ...(pend.vert ? { vert: pend.vert } : {}) };
      base.pending = !!pend;
      base.font = r.fAscii ?? r.fHAnsi;
      base.size = r.sz ? r.sz / 2 : undefined;
      base.bold = !!r.b; base.italic = !!r.i; base.underline = !!r.u && r.u !== "none"; base.strike = !!r.strike;
      base.sup = r.vert === "superscript"; base.sub = r.vert === "subscript";
      base.color = r.color && r.color !== "auto" ? r.color : undefined;
      base.highlight = r.highlight;
      base.align = pr.jc;
      base.indentLeft = pr.indLeft;
      base.spaceBefore = pr.before; base.spaceAfter = pr.after;
      base.line = pr.line ? (pr.lineRule && pr.lineRule !== "auto" ? `${pr.line / 20}pt` : String(Math.round((pr.line / 240) * 100) / 100)) : undefined;
      if (pr.numId) { const lvl = book.numbering.lvl(pr.numId, pr.ilvl ?? 0); base.list = lvl ? (lvl.fmt === "bullet" ? "bullet" : "number") : undefined; }
      const link = linkAt(a.p, a.off);
      if (link) { const rid = attr(link, "id"); base.link = rid ? book.rel(rid)?.target : `#${attr(link, "anchor")}`; }
      if (!this.cellSel) {
        const tc = book.parentOf(a.p);
        if (tc && tc.name.local === "tc") {
          const tr = book.parentOf(tc), tbl = tr ? book.parentOf(tr) : undefined;
          if (tbl) {
            const g = buildGrid(tbl);
            const cell = g.cells.find(x => x.el === tc);
            if (cell) base.table = { index: book.tables().indexOf(tbl) + 1, row: cell.row + 1, col: cell.col + 1, rows: g.rows.length, cols: g.ncols, merged: cell.colspan > 1 || cell.rowspan > 1 };
          }
        }
      }
      void b;
    }
    this.lastSel = base;
    this.hooks.selection(base);
  }
  get lastSelection() { return this.lastSel; }

  /** Info debug untuk paragraf pada caret. */
  debugAtCaret(): Record<string, unknown> {
    const book = this.book;
    const s = this.selPoints();
    if (!book) return {};
    const out: Record<string, unknown> = { pages: this.paginator.count, zoom: this.zoom, history: { index: book.histIdx, length: book.hist.length, max: book.maxHistory }, readonly: this.readonly };
    if (s) {
      const p = s.a.p;
      const pPr = first(p, "pPr");
      const sid = val(pPr, "pStyle");
      const base = book.styles.paraBase(sid, condForParagraph(book, p));
      const run = this.runAt(p, s.a.off);
      out.selection = { collapsed: s.collapsed, offset: s.a.off, paragraphLength: flatLength(p), text: flatText(p).slice(0, 200) };
      out.paragraph = { styleId: sid ?? null, styleName: book.styles.name(base.styleId), resolved: { ...base.p, direct: readP(pPr, book.styles.theme) }, xml: serializeShort(p) };
      out.run = run ? { resolved: this.runResolved(p, run), xml: serializeShort(run) } : null;
      const dom = this.reg.domOf.get(p);
      out.dom = dom ? { tag: dom.tagName, className: dom.className, datasets: { ...dom.dataset }, flat: domFlatText(dom).slice(0, 120), style: dom.getAttribute("style") } : null;
      const tc = this.tctx();
      if (tc) out.table = { rows: tc.g.rows.length, cols: tc.g.ncols, cell: { row: tc.cell.row, col: tc.cell.col, colspan: tc.cell.colspan, rowspan: tc.cell.rowspan, vm: tc.cell.vm }, rect: tc.rect, xml: serializeShort(tc.tbl, 1500) };
    }
    if (this.imgSel) out.image = { info: this.imgInfo(), xml: serializeShort(this.imgSel.drawing, 2500) };
    return out;
  }

}

// ───────── util ─────────

function serializeShort(el: XEl, max = 1200): string { const s = serialize(el); return s.length > max ? s.slice(0, max) + `… (+${s.length - max})` : s; }
function ps0(tc: XEl, book: DocxBook): XEl | undefined { let r: XEl | undefined; walkBlocks(tc, el => { if (!r && el.name.local === "p") r = el; }); void book; return r; }
function insertTextRunDrawing(p: XEl, off: number, drawing: XEl) {
  insertRunAt(p, off, mk("r", undefined, [mk("rPr", undefined, [mk("noProof")]), drawing]));
}
async function decodeImageSize(file: Blob): Promise<{ w: number; h: number; type: string } | undefined> {
  try {
    const bmp = await createImageBitmap(file);
    const r = { w: bmp.width, h: bmp.height, type: file.type };
    bmp.close();
    return r;
  } catch { return undefined; }
}
