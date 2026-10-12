/**
 * Controller imperatif editor DOCX: merender body ke "kertas", memetakan seleksi DOM ⇄ model XML, menangani input
 * (ketik, Enter, hapus, tempel), format, tabel, gambar, format painter, pencarian, dan riwayat undo/redo.
 * UI (toolbar, panel) berada di DocxEditor.tsx dan hanya memanggil metode kelas ini.
 */
import { attr, cloneEl, els, first, isEl, mk, removeNode, val, type XEl } from "./docx-xml";


import { ensureTocStyles } from "./docx-toc";

import { DocxBook, walkBlocks, type Section } from "./docx-model";

import { Registry, condForParagraph, fillBlocks, fillParagraph, refreshNumbering, renderParagraph, renderTable, type RenderCtx } from "./docx-render";

import { Paginator, geomOf } from "./docx-paginate";

import { domFlatText, domOffsetToFlat, flatToDomPos } from "./docx-dom";

import { applyParaPatch, applyRunPatch, flatLength, flatText, mergeParagraphs, normalize, replaceRange, runsInRange, splitParagraph, units, type RunPatch } from "./docx-text";

import { deleteSpan, extractFragment, insertLineBreak, insertPageBreak, insertPlainText, insertTableAfter, linkAt, pasteFragment, toggleList, type FormatClip } from "./docx-ops";

import { buildGrid, type GCell, type Grid, type Rect } from "./docx-table";

import * as T from "./docx-table";

import { setSize, type ImgInfo, type WrapMode } from "./docx-image";


import { type Hit } from "./docx-search";




import { LIST_PRESETS, type ListPreset } from "./docx-lists";

import { type DocxLink } from "./docx-nav";

import { createFindCursor, type FindMatch } from "../editor-kit/find-replace";


import { readP } from "./docx-style";


import * as hfMod from "./docx-view-hf";
import * as formatMod from "./docx-view-format";
import * as tabsMod from "./docx-view-tabs";
import * as listsMod from "./docx-view-lists";
import * as tableMod from "./docx-view-table";
import * as imageMod from "./docx-view-image";
import * as oleMod from "./docx-view-ole";
import * as painterMod from "./docx-view-painter";
import * as searchMod from "./docx-view-search";
import * as tocMod from "./docx-view-toc";
import { PX_PER_TWIP, serializeShort, type Sel2 } from "./docx-view-shared";


// Target & kunci format/tabel/navigasi ada di docx-view-shared (agar modul pecahan tidak saling bergantung); diekspor ulang di sini.
export { DOCX_FORMAT_KEYS, DOCX_TABLE_OPS } from "./docx-view-shared";
export type { DocxFormatTarget, DocxNavTarget } from "./docx-view-shared";

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
  region: "body" | "header" | "footer" | "other";
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
  imgClip: XEl | null = null;
  private composing = false;
  normTimer = 0;
  private pagTimer = 0;
  private selRaf = 0;
  notesEl: HTMLElement | null = null;
  fnRefs: RenderCtx["fnRefs"] = [];
  private ro: ResizeObserver;
  private disposers: (() => void)[] = [];
  private dragCell: { tbl: XEl; tc: XEl; r: number; c: number } | null = null;
  private lastSel: SelInfo | null = null;
  private hoverResize: { kind: "col" | "row"; tbl: XEl; index: number; tr?: XEl } | null = null;
  private resizeDrag: { kind: "col" | "row"; tbl: XEl; index: number; tr?: XEl; startX: number; startY: number; guide: HTMLElement; base: number } | null = null;
  imgDrag: { mode: "resize" | "move"; handle: string; sx: number; sy: number; w0: number; h0: number; l0: number; t0: number; ratio: number; el: HTMLElement; drawing: XEl } | null = null;
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
    this.paginator = new Paginator({ book: undefined as unknown as DocxBook, reg: this.reg, pagesEl: this.pagesEl, doc: document, makeCtx: (w, s) => this.makeCtx(w, s), hfEdit: () => this.hfEdit });
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
    this.paginator = new Paginator({ book, reg: this.reg, pagesEl: this.pagesEl, doc: document, makeCtx: (w, s) => this.makeCtx(w, s), hfEdit: () => this.hfEdit });
    this.hfEdit = null;
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

  contentWOf(sec: number) { const s = this.book!.sections(); return geomOf(s[Math.min(sec, s.length - 1)]).contentW; }

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
    this.bindActiveHF();
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
  saved: Sel2 | null = null;
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
    const scope = this.hfEdit ? this.pagesEl.querySelector<HTMLElement>("[data-edit]") ?? this.pagesEl : this.pagesEl;
    const all = [...scope.querySelectorAll<HTMLElement>(".dx-p")].map(d => this.reg.elOf.get(d)).filter((p): p is XEl => this.isBodyPara(p));
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
    if (this.hfEdit) this.book.touchHF(this.hfEdit.relId);
    this.book.checkpoint(label, false, merge);
    this.hooks.changed(label);
  }
  undo() { if (!this.book?.canUndo || this.readonly) return; const s = this.captureIndexSel(); this.book.undo(); this.afterRestore(s, "hist.undo"); }
  redo() { if (!this.book?.canRedo || this.readonly) return; const s = this.captureIndexSel(); this.book.redo(); this.afterRestore(s, "hist.redo"); }
  jumpTo(i: number) { if (!this.book || this.readonly) return; const s = this.captureIndexSel(); if (this.book.restore(i)) this.afterRestore(s, "hist.jump"); }
  private afterRestore(s: ReturnType<DocxView["captureIndexSel"]>, label: string) {
    this.imgSel = null; this.cellSel = null; this.pending = null;
    if (this.hfEdit && this.book) {
      // undo/redo mengurai ulang header/footer: sambungkan kembali ke akar yang baru
      const root = this.book.hf(this.hfEdit.relId);
      this.book.hfActive = root;
      if (!root) this.hfEdit = null;
      this.book.reindex();
    }
    this.renderAll({ sel: s });
    if (this.hfEdit) this.focusHFStart();
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
  refreshNums() { if (this.book) refreshNumbering(this.makeCtx(300, this.book.doc.partName), p => this.rerenderPara(p)); }

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
    if (e.key === "Escape" && this.hfEdit) { e.preventDefault(); this.exitHF(); return; }
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

  commitStructural(label: string, caret?: Point) {
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

  blockSiblings(parent: XEl) { return parent.children.filter(isEl).filter(c => c.name.local === "p" || c.name.local === "tbl"); }

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

  // ───────── drop (dipanggil kontroler drop bersama) ─────────

  /** Letakkan caret pada titik klien (x, y); false bila titik tidak berada pada paragraf. */
  placeCaretAtPoint(x: number, y: number): boolean {
    const pos = (document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }).caretPositionFromPoint?.(x, y);
    const range = pos ? null : document.caretRangeFromPoint?.(x, y);
    const node = pos?.offsetNode ?? range?.startContainer, off = pos?.offset ?? range?.startOffset ?? 0;
    if (!node) return false;
    const pt = this.pointOf(node, off);
    if (!pt) return false;
    this.setCaret(pt.p, pt.off);
    return true;
  }
  async insertImageAtPoint(f: File, x: number, y: number): Promise<boolean> {
    if (this.readonly) return false;
    this.placeCaretAtPoint(x, y);
    return this.insertImageFile(f);
  }
  /** Sisipkan teks polos (baris baru → paragraf) pada titik klien; titik tak valid = di caret saat ini. */
  insertTextAtPoint(text: string, x: number, y: number): boolean {
    if (!this.book || this.readonly || !text) return false;
    this.placeCaretAtPoint(x, y);
    const s = this.selPoints();
    if (!s) return false;
    let pt: Point = { p: s.a.p, off: s.a.off };
    if (!s.collapsed) { const d = this.deleteSelection(); if (!d) return false; pt = d; }
    const parent = this.book.parentOf(pt.p);
    if (!parent) return false;
    const t = text.replace(/\r\n?/g, "\n");
    const res = insertPlainText(parent, pt.p, pt.off, t);
    this.book.reindex();
    if (t.includes("\n")) this.commitStructural("hist.paste", res); else { this.rerenderPara(pt.p); this.setCaret(res.p, res.off); this.commit("hist.paste"); this.schedulePaginate(); }
    return true;
  }

  // ───────── mouse ─────────

  cellAt(target: EventTarget | null): { td: HTMLElement; tc: XEl; tbl: XEl; g: Grid; cell: GCell } | null {
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
    if (this.hfEdit && !t.closest("[data-edit]") && !t.closest(".dx-hdr,.dx-ftr")) this.exitHF();
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
    const t = e.target as HTMLElement;
    const ole = t.closest<HTMLElement>(".dx-ole");
    if (ole) { e.preventDefault(); this.hooks.ole(ole.dataset.ole ?? ""); return; }
    if (this.readonly || t.closest("[data-edit]") || t.closest(".dx-img")) return;
    const slot = t.closest<HTMLElement>(".dx-hdr,.dx-ftr");
    const page = slot?.closest<HTMLElement>(".dx-page");
    if (slot && page) { e.preventDefault(); this.editHeaderFooter(slot.classList.contains("dx-hdr") ? "hdr" : "ftr", Number(page.dataset.no)); }
  }

  // ───────── header / footer ─────────

  /** Header/footer yang sedang disunting (satu kotak pada satu halaman). */
  hfEdit: { relId: string; kind: "hdr" | "ftr"; page: number; sec: number } | null = null;

  hfTypeFor = hfMod.hfTypeFor;
  currentPageNo = hfMod.currentPageNo;
  editHeaderFooter = hfMod.editHeaderFooter;
  hfRelFor = hfMod.hfRelFor;
  focusHFStart = hfMod.focusHFStart;
  bindActiveHF = hfMod.bindActiveHF;
  exitHF = hfMod.exitHF;

  insertField = hfMod.insertField;

  currentSection = hfMod.currentSection;
  hfOptions = hfMod.hfOptions;
  setDifferentFirstPage = hfMod.setDifferentFirstPage;
  setDifferentOddEven = hfMod.setDifferentOddEven;
  setPageNumbering = hfMod.setPageNumbering;
  removeHeaderFooter = hfMod.removeHeaderFooter;
  openLink = hfMod.openLink;
  scrollToBookmark = hfMod.scrollToBookmark;
  private scrollToNote = hfMod.scrollToNote;

  private onContext = hfMod.onContext;

  // ───────── format karakter ─────────

  runResolved = hfMod.runResolved;
  runAt = formatMod.runAt;
  runsOverlapping = formatMod.runsOverlapping;

  applyRunCmd = formatMod.applyRunCmd;

  toggleRun = formatMod.toggleRun;
  toggleUnderline = formatMod.toggleUnderline;
  setUnderline = formatMod.setUnderline;
  setVert = formatMod.setVert;
  setColor = formatMod.setColor;
  setHighlight = formatMod.setHighlight;
  setFont = formatMod.setFont;
  setSize = formatMod.setSize;
  bumpSize = formatMod.bumpSize;
  setLetterSpacing = formatMod.setLetterSpacing;

  clearFormat = formatMod.clearFormat;

  changeCase = formatMod.changeCase;

  // ───────── format & struktur lewat bus ─────────

  selectFormatTarget = formatMod.selectFormatTarget;

  formatApply = formatMod.formatApply;

  formatGet = formatMod.formatGet;

  paragraphCount = formatMod.paragraphCount;
  insertParagraphAt = formatMod.insertParagraphAt;
  removeParagraphAt = formatMod.removeParagraphAt;
  insertPageBreakAt = formatMod.insertPageBreakAt;
  tableSummaries = formatMod.tableSummaries;
  insertTableAfterPara = formatMod.insertTableAfterPara;
  tableApply = formatMod.tableApply;

  // ───────── format paragraf ─────────

  paraCmd = formatMod.paraCmd;
  setAlign = formatMod.setAlign;
  setStyle = formatMod.setStyle;
  setLineSpacing = formatMod.setLineSpacing;
  setParaSpacing = formatMod.setParaSpacing;
  // ───────── tab stop ─────────

  tabStopsOf = formatMod.tabStopsOf;
  styleTabsOf = tabsMod.styleTabsOf;
  tabStopsAtCaret = tabsMod.tabStopsAtCaret;
  tabsCmd = tabsMod.tabsCmd;
  setTabStops = tabsMod.setTabStops;
  addTabStop = tabsMod.addTabStop;
  removeTabStop = tabsMod.removeTabStop;
  moveTabStop = tabsMod.moveTabStop;
  clearTabStops = tabsMod.clearTabStops;

  setShading = tabsMod.setShading;
  setParaBorder = tabsMod.setParaBorder;
  setIndent = tabsMod.setIndent;
  indent = tabsMod.indent;
  // ───────── galeri & pengelolaan daftar ─────────

  readonly listPresets: readonly ListPreset[] = LIST_PRESETS;
  listInfoAtCaret = listsMod.listInfoAtCaret;
  listParas = listsMod.listParas;
  afterListChange = listsMod.afterListChange;
  applyListPreset = listsMod.applyListPreset;
  listTail = listsMod.listTail;
  moveToList = listsMod.moveToList;
  restartList = listsMod.restartList;
  continueList = listsMod.continueList;
  setListStart = listsMod.setListStart;

  toggleList = listsMod.toggleList;

  // ───────── tautan / sisip ─────────

  setLink = listsMod.setLink;

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
  firstParaIn(el: XEl): XEl | undefined { let r: XEl | undefined; walkBlocks(el.name.local === "tbl" ? mk("x", undefined, [el]) : el, x => { if (!r && x.name.local === "p") r = x; }); return r; }

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
    let rect: Rect = { r1: cell.row, c1: cell.col, r2: cell.row + cell.rowspan - 1, c2: cell.col + cell.colspan - 1 };
    // seleksi asli yang melintasi beberapa sel pada tabel yang sama → rentang sel (bukan hanya sel di kursor)
    const fc = s.b.p !== s.a.p ? this.cellInTable(s.b.p, tbl) : undefined;
    const fcell = fc ? g.cells.find(c => c.el === fc) : undefined;
    if (fcell && fcell !== cell) {
      rect = T.expandRect(g, {
        r1: Math.min(rect.r1, fcell.row), c1: Math.min(rect.c1, fcell.col),
        r2: Math.max(rect.r2, fcell.row + fcell.rowspan - 1), c2: Math.max(rect.c2, fcell.col + fcell.colspan - 1),
      });
    }
    return { tbl, g, cell, rect };
  }

  private cellInTable = tableMod.cellInTable;

  outermostTable = tableMod.outermostTable;
  finishTable = tableMod.finishTable;
  lastCell: { row: number; col: number } | null = null;

  table = tableMod.table;
  cellSides = tableMod.cellSides;

  private clearCells = tableMod.clearCells;

  private tableNavigate = tableMod.tableNavigate;

  setCellSel = tableMod.setCellSel;
  clearCellSel = tableMod.clearCellSel;
  applyCellSelVisual = tableMod.applyCellSelVisual;

  // ───────── gambar ─────────

  drawingParaEl = tableMod.drawingParaEl;
  selectImageEl = imageMod.selectImageEl;
  clearImageSel = imageMod.clearImageSel;

  updateOverlay = imageMod.updateOverlay;

  imgDragStart = imageMod.imgDragStart;
  private imgDragMove = imageMod.imgDragMove;
  private imgDragEnd = imageMod.imgDragEnd;

  hfOf = imageMod.hfOf;

  afterHFImageChange = imageMod.afterHFImageChange;

  afterImageChange = imageMod.afterImageChange;

  imgInfo = imageMod.imgInfo;

  imgSetSize = imageMod.imgSetSize;
  imgSetLock = imageMod.imgSetLock;
  imgSetWrap = imageMod.imgSetWrap;
  imgSetAlt = imageMod.imgSetAlt;
  imgRotate = imageMod.imgRotate;
  imgFlip = imageMod.imgFlip;
  imgCrop = imageMod.imgCrop;
  imgReset = imageMod.imgReset;
  imgNudge = imageMod.imgNudge;
  imgDelete = imageMod.imgDelete;
  imgDuplicate = imageMod.imgDuplicate;
  imgPaste = imageMod.imgPaste;

  insertImageFile = imageMod.insertImageFile;
  // ───────── objek OLE ─────────

  insertOle = imageMod.insertOle;

  updateOle = oleMod.updateOle;

  resizeOle = oleMod.resizeOle;
  oleDisplaySize = oleMod.oleDisplaySize;

  pageGeometry = oleMod.pageGeometry;

  imgReplace = oleMod.imgReplace;

  // ───────── format painter ─────────

  startPainter = oleMod.startPainter;
  cancelPainter = painterMod.cancelPainter;
  private applyPainter = painterMod.applyPainter;

  // ───────── pencarian ─────────

  search = painterMod.search;
  clearSearch = searchMod.clearSearch;
  pageOfHit = searchMod.pageOfHit;
  gotoHit = searchMod.gotoHit;
  clearHighlights = searchMod.clearHighlights;
  applyHighlights = searchMod.applyHighlights;
  replaceHitsBy = searchMod.replaceHitsBy;

  // ───────── daftar isi ─────────

  /** Teks bawaan daftar isi (diisi editor sesuai bahasa). */
  tocText = { title: "Table of Contents", empty: "No table of contents entries found." };

  tocList = tocMod.tocList;
  pageOfPara = tocMod.pageOfPara;
  tocContentTw = tocMod.tocContentTw;
  ensureTocStyles = tocMod.ensureTocStyles;
  insertToc = tocMod.insertToc;
  updateToc = tocMod.updateToc;
  rebuildTocs = tocMod.rebuildTocs;
  refreshTocPages = tocMod.refreshTocPages;
  removeToc = tocMod.removeToc;

  // ───────── navigasi & cari/ganti lintas jenis (event bus) ─────────

  findCursor = createFindCursor<{ m: FindMatch; hit?: number; link?: DocxLink }>();

  findMatches = searchMod.findMatches;
  findStep = searchMod.findStep;
  findClear = searchMod.findClear;
  get findIndex() { return this.findCursor.index; }

  gotoPage = searchMod.gotoPage;
  firstParaOfCell = searchMod.firstParaOfCell;

  gotoTarget = searchMod.gotoTarget;

  linkItems = searchMod.linkItems;
  updateLink = searchMod.updateLink;
  removeLinkById = searchMod.removeLinkById;
  replaceLinks = searchMod.replaceLinks;

  replaceKinds = searchMod.replaceKinds;
  countValue = searchMod.countValue;

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

  scheduleSelection() { if (this.selRaf) return; this.selRaf = requestAnimationFrame(() => { this.selRaf = 0; this.emitSelection(); }); }

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
        has: true, collapsed: s.collapsed, region: this.hfEdit && d?.closest("[data-edit]") ? (this.hfEdit.kind === "hdr" ? "header" : "footer") : "body", page: Number(d?.closest<HTMLElement>(".dx-page")?.dataset.no ?? 0), paraIndex: list.indexOf(a.p) + 1, paraCount: list.length, col: a.off + 1,
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





