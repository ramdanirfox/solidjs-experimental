/**
 * Grid worksheet tervirtualisasi (client-only).
 * Struktur: kontainer scroll + stage sticky berisi 4 pane (kiri-atas beku, atas, kiri, utama) + header baris/kolom.
 * Posisi semua sel berasal dari Layout (lebar/tinggi/hidden/freeze dibaca dari OOXML).
 */
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, type Accessor, type JSX } from "solid-js";
import type { Worksheet } from "@office-kit/xlsx/worksheet";
import type { Cell } from "@office-kit/xlsx/cell";
import { columnLetterFromIndex } from "@office-kit/xlsx/utils";
import {
  HEADER_H, HEADER_W, anchorRect, colW, locate, measureTextPx, pxToColChars, pxToPt, rowH,
  type Layout,
} from "./xlsx-layout";
import { XlsxBook, normSel, type FilterState, type Sel, type DrawingView } from "./xlsx-model";
import type { ResolvedStyle } from "./xlsx-style";

export interface GridApi {
  scrollTo(row: number, col: number): void;
  focus(): void;
}

export interface XlsxGridProps {
  book: XlsxBook;
  sheet: Worksheet;
  /** Naik setiap kali isi sel berubah. */
  version: Accessor<number>;
  /** Naik setiap kali geometri (lebar/tinggi/hidden/freeze/filter) berubah. */
  layoutVersion: Accessor<number>;
  layout: Accessor<Layout>;
  showHidden: Accessor<boolean>;
  showGridlines: Accessor<boolean>;
  showFormulas: Accessor<boolean>;
  sel: Accessor<Sel>;
  active: Accessor<{ row: number; col: number }>;
  onSelect(sel: Sel, active: { row: number; col: number }, extend?: boolean): void;
  hits?: Accessor<Set<number>>;
  currentHit?: Accessor<number | undefined>;
  editing: Accessor<{ row: number; col: number; text: string } | null>;
  onStartEdit(row: number, col: number, initial?: string): void;
  onEditText(text: string): void;
  onCommitEdit(move?: "down" | "right" | "none" | "up" | "left"): void;
  onCancelEdit(): void;
  onKeyDown(e: KeyboardEvent): void;
  onResizeColumn(col: number, px: number): void;
  onResizeRow(row: number, px: number): void;
  onAutofitColumn(col: number): void;
  onOpenFilter(col: number, anchor: HTMLElement): void;
  filter: Accessor<FilterState | undefined>;
  onDebug?(row: number, col: number): void;
  onZoomWheel?(delta: number): void;
  onContextMenu?(e: MouseEvent, row: number, col: number): void;
  onLink?(row: number, col: number, link: any): void;
  /** Mode baca-saja: menonaktifkan edit sel, resize kolom/baris, dan manipulasi gambar. */
  readonly?: Accessor<boolean>;
  /** Mode "point": saat mengetik formula, klik/drag sel menyisipkan referensi ke formula. */
  pointMode?: Accessor<boolean>;
  onPoint?(phase: "start" | "move" | "end", cell?: { row: number; col: number }): void;
  /** Rentang yang dirujuk formula yang sedang diedit (disorot berwarna). */
  refRanges?: Accessor<{ sel: Sel; color: string }[]>;
  selectedImage?: Accessor<string | undefined>;
  onSelectImage?(key: string | undefined): void;
  onImageRect?(d: DrawingView, rect: { x: number; y: number; w: number; h: number }): void;
  ref?(api: GridApi): void;
  initialScroll?: { x: number; y: number };
  onScrollChange?(x: number, y: number): void;
}

const OVERSCAN = 2;
const MAX_SCROLL_PX = 8_000_000;
const FONT_FALLBACK = `"Segoe UI", "Helvetica Neue", Arial, sans-serif`;

export default function XlsxGrid(props: XlsxGridProps) {
  let scroller!: HTMLDivElement;
  let stage!: HTMLDivElement;
  let editorEl: HTMLTextAreaElement | undefined;

  const [sx, setSx] = createSignal(0);
  const [sy, setSy] = createSignal(0);
  const [vw, setVw] = createSignal(800);
  const [vh, setVh] = createSignal(500);

  const layout = props.layout;

  // ukuran frozen & area scroll
  const geo = createMemo(() => {
    const l = layout();
    const frozenW = Math.min(l.colStart[l.fc + 1]!, Math.max(0, vw() - HEADER_W - 40));
    const frozenH = Math.min(l.rowStart[l.fr + 1]!, Math.max(0, vh() - HEADER_H - 30));
    const totalW = l.colStart[l.maxCol + 1]!;
    const totalH = l.rowStart[l.maxRow + 1]!;
    const originX = l.colStart[l.fc + 1]!; // koordinat sheet tempat area scroll dimulai
    const originY = l.rowStart[l.fr + 1]!;
    const scrollW = Math.max(0, vw() - HEADER_W - frozenW);
    const scrollH = Math.max(0, vh() - HEADER_H - frozenH);
    // Sheet sangat tinggi (>~8 juta px, ±400 ribu baris) melampaui batas tinggi elemen browser (Firefox ≈17,8 juta px):
    // posisi scrollbar dipetakan secara proporsional ke koordinat sheet.
    const maxSy = Math.max(0, totalH - originY - scrollH);
    const scaleY = maxSy > MAX_SCROLL_PX ? MAX_SCROLL_PX / maxSy : 1;
    const sizerH = scaleY < 1 ? vh() + MAX_SCROLL_PX : HEADER_H + totalH;
    return { frozenW, frozenH, totalW, totalH, originX, originY, scrollW, scrollH, scaleY, sizerH };
  });

  // jendela kolom/baris yang terlihat
  const colWin = createMemo(() => {
    const l = layout(), g = geo();
    const x0 = g.originX + sx();
    const a = Math.max(l.fc + 1, locate(l.colStart, x0, l.maxCol) - OVERSCAN);
    const b = Math.min(l.maxCol, locate(l.colStart, x0 + g.scrollW, l.maxCol) + OVERSCAN);
    return [a, b] as const;
  });
  const rowWin = createMemo(() => {
    const l = layout(), g = geo();
    const y0 = g.originY + sy();
    const a = Math.max(l.fr + 1, locate(l.rowStart, y0, l.maxRow) - OVERSCAN);
    const b = Math.min(l.maxRow, locate(l.rowStart, y0 + g.scrollH, l.maxRow) + OVERSCAN);
    return [a, b] as const;
  });

  const range = (a: number, b: number): number[] => {
    const out: number[] = [];
    for (let i = a; i <= b; i++) out.push(i);
    return out;
  };
  const frozenCols = createMemo(() => range(1, layout().fc).filter(c => colW(layout(), c) > 0));
  const frozenRows = createMemo(() => range(1, layout().fr).filter(r => rowH(layout(), r) > 0));
  const scrollCols = createMemo(() => { const [a, b] = colWin(); return range(a, b).filter(c => colW(layout(), c) > 0); });
  const scrollRows = createMemo(() => { const [a, b] = rowWin(); return range(a, b).filter(r => rowH(layout(), r) > 0); });

  const onScroll = () => {
    setSx(scroller.scrollLeft);
    setSy(scroller.scrollTop / geo().scaleY);
    props.onScrollChange?.(scroller.scrollLeft, sy());
  };

  onMount(() => {
    const ro = new ResizeObserver(() => { setVw(scroller.clientWidth); setVh(scroller.clientHeight); });
    ro.observe(scroller);
    setVw(scroller.clientWidth); setVh(scroller.clientHeight);
    if (props.initialScroll) { scroller.scrollLeft = props.initialScroll.x; scroller.scrollTop = props.initialScroll.y * geo().scaleY; }
    onScroll();
    props.ref?.({
      scrollTo: (r, c) => ensureVisible(r, c),
      focus: () => scroller.focus({ preventScroll: true }),
    });
    onCleanup(() => ro.disconnect());
  });

  // ───── koordinat ─────
  /** Rect sel pada koordinat stage (px dari pojok kiri-atas stage). */
  function stageRect(r: number, c: number, r2 = r, c2 = c) {
    const l = layout(), g = geo();
    const x1 = l.colStart[c]!, x2 = l.colStart[c2 + 1]!;
    const y1 = l.rowStart[r]!, y2 = l.rowStart[r2 + 1]!;
    const px = (x: number, cc: number) => cc <= l.fc ? HEADER_W + x : HEADER_W + g.frozenW + (x - g.originX) - sx();
    const py = (y: number, rr: number) => rr <= l.fr ? HEADER_H + y : HEADER_H + g.frozenH + (y - g.originY) - sy();
    return { x: px(x1, c), y: py(y1, r), w: x2 - x1, h: y2 - y1 };
  }

  function ensureVisible(r: number, c: number) {
    const l = layout(), g = geo();
    if (c > l.fc) {
      const left = l.colStart[c]! - g.originX, right = l.colStart[c + 1]! - g.originX;
      if (left < sx()) scroller.scrollLeft = left;
      else if (right > sx() + g.scrollW) scroller.scrollLeft = right - g.scrollW;
    }
    if (r > l.fr) {
      const top = l.rowStart[r]! - g.originY, bottom = l.rowStart[r + 1]! - g.originY;
      if (top < sy()) scroller.scrollTop = top * g.scaleY;
      else if (bottom > sy() + g.scrollH) scroller.scrollTop = (bottom - g.scrollH) * g.scaleY;
    }
  }

  createEffect(on(() => [props.active().row, props.active().col] as const, ([r, c]) => ensureVisible(r, c), { defer: true }));

  function hit(clientX: number, clientY: number): { row: number; col: number; zone: "cell" | "colHead" | "rowHead" | "corner" } {
    const l = layout(), g = geo();
    const rc = stage.getBoundingClientRect();
    const x = clientX - rc.left, y = clientY - rc.top;
    const colAt = (px: number) => {
      if (px < g.frozenW) return Math.min(l.fc, locate(l.colStart, px, l.maxCol));
      return locate(l.colStart, px - g.frozenW + g.originX + sx(), l.maxCol);
    };
    const rowAt = (py: number) => {
      if (py < g.frozenH) return Math.min(l.fr, locate(l.rowStart, py, l.maxRow));
      return locate(l.rowStart, py - g.frozenH + g.originY + sy(), l.maxRow);
    };
    const inHeadX = x < HEADER_W, inHeadY = y < HEADER_H;
    if (inHeadX && inHeadY) return { row: 1, col: 1, zone: "corner" };
    const col = colAt(Math.max(0, x - HEADER_W));
    const row = rowAt(Math.max(0, y - HEADER_H));
    return { row, col, zone: inHeadY ? "colHead" : inHeadX ? "rowHead" : "cell" };
  }

  // ───── mouse: seleksi ─────
  let dragging: "cell" | "col" | "row" | null = null;
  let anchorCell = { row: 1, col: 1 };

  function applyDrag(h: ReturnType<typeof hit>) {
    const l = layout();
    if (dragging === "cell") props.onSelect({ r1: anchorCell.row, c1: anchorCell.col, r2: h.row, c2: h.col }, anchorCell, true);
    else if (dragging === "col") props.onSelect({ r1: 1, c1: anchorCell.col, r2: l.maxRow, c2: h.col }, { row: 1, col: anchorCell.col }, true);
    else if (dragging === "row") props.onSelect({ r1: anchorCell.row, c1: 1, r2: h.row, c2: l.maxCol }, { row: anchorCell.row, col: 1 }, true);
  }

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0 && e.button !== 2) return;
    if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
    if (e.button === 0 && props.pointMode?.()) {
      const hp = hit(e.clientX, e.clientY);
      if (hp.zone === "cell") {
        e.preventDefault(); // pertahankan fokus & caret pada editor formula
        props.onPoint?.("start", { row: hp.row, col: hp.col });
        const mv = (ev: MouseEvent) => { const h2 = hit(ev.clientX, ev.clientY); props.onPoint?.("move", { row: h2.row, col: h2.col }); };
        const up = () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); props.onPoint?.("end"); };
        window.addEventListener("mousemove", mv);
        window.addEventListener("mouseup", up);
        return;
      }
    }
    const h = hit(e.clientX, e.clientY);
    const l = layout();
    if (props.editing()) props.onCommitEdit("none");
    scroller.focus({ preventScroll: true });
    if (e.button === 2) {
      const s = normSel(props.sel());
      const inside = h.zone === "cell" && h.row >= s.r1 && h.row <= s.r2 && h.col >= s.c1 && h.col <= s.c2;
      if (!inside && h.zone === "cell") props.onSelect({ r1: h.row, c1: h.col, r2: h.row, c2: h.col }, { row: h.row, col: h.col });
      return;
    }
    if (h.zone === "corner") { props.onSelect({ r1: 1, c1: 1, r2: l.maxRow, c2: l.maxCol }, { row: 1, col: 1 }); return; }
    if (h.zone === "colHead") {
      dragging = "col"; anchorCell = { row: 1, col: e.shiftKey ? props.active().col : h.col };
      props.onSelect({ r1: 1, c1: anchorCell.col, r2: l.maxRow, c2: h.col }, { row: 1, col: anchorCell.col }, true);
    } else if (h.zone === "rowHead") {
      dragging = "row"; anchorCell = { row: e.shiftKey ? props.active().row : h.row, col: 1 };
      props.onSelect({ r1: anchorCell.row, c1: 1, r2: h.row, c2: l.maxCol }, { row: anchorCell.row, col: 1 }, true);
    } else {
      dragging = "cell";
      anchorCell = e.shiftKey ? props.active() : { row: h.row, col: h.col };
      // sel merged: perluas seleksi ke seluruh merge
      props.onSelect({ r1: anchorCell.row, c1: anchorCell.col, r2: h.row, c2: h.col }, anchorCell, true);
    }
    const move = (ev: MouseEvent) => applyDrag(hit(ev.clientX, ev.clientY));
    const up = () => { dragging = null; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  function onDblClick(e: MouseEvent) {
    if (props.readonly?.()) return;
    if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
    const h = hit(e.clientX, e.clientY);
    if (h.zone === "cell") props.onStartEdit(h.row, h.col);
  }

  function onCtx(e: MouseEvent) {
    e.preventDefault();
    const h = hit(e.clientX, e.clientY);
    props.onContextMenu?.(e, h.row, h.col);
  }

  function onWheel(e: WheelEvent) {
    if (e.ctrlKey && props.onZoomWheel) { e.preventDefault(); props.onZoomWheel(e.deltaY < 0 ? 0.1 : -0.1); }
  }

  // ───── resize kolom/baris ─────
  function startResize(kind: "col" | "row", idx: number, e: MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    if (props.readonly?.()) return;
    const l = layout();
    const start = kind === "col" ? e.clientX : e.clientY;
    const size0 = kind === "col" ? colW(l, idx) : rowH(l, idx);
    const guide = document.createElement("div");
    guide.className = "xl-resize-guide";
    stage.appendChild(guide);
    let size = size0;
    const move = (ev: MouseEvent) => {
      size = Math.max(4, size0 + ((kind === "col" ? ev.clientX : ev.clientY) - start));
      const r = stageRect(kind === "row" ? idx : 1, kind === "col" ? idx : 1);
      if (kind === "col") { guide.style.cssText = `left:${r.x + size}px;top:0;bottom:0;width:0;border-left:2px solid #2563eb`; }
      else { guide.style.cssText = `top:${r.y + size}px;left:0;right:0;height:0;border-top:2px solid #2563eb`; }
    };
    const up = () => {
      window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up);
      guide.remove();
      if (size !== size0) (kind === "col" ? props.onResizeColumn : props.onResizeRow)(idx, size / l.zoom);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  // ───── render sel ─────
  const mergeIdx = createMemo(() => { props.version(); props.layoutVersion(); return props.book.mergeIndex(props.sheet); });

  function cellVisual(r: number, c: number) {
    props.version();
    const ws = props.sheet;
    const cell = ws.rows.get(r)?.get(c);
    if (!cell) return undefined;
    return buildCellVisual(cell);
  }

  function buildCellVisual(cell: Cell) {
    const ws = props.sheet, book = props.book;
    let st: ResolvedStyle = book.styleOf(ws, cell);
    if (book.cf.hasRules(ws)) st = book.cf.styleFor(ws, cell.row, cell.col, st) ?? st;
    const showF = props.showFormulas();
    const text = book.cellText(ws, cell, showF);
    const kind = showF ? "string" : book.kindOf(ws, cell);
    const link = book.hyperlinkAt(ws, cell.row, cell.col);
    const note = book.commentAt(ws, cell.row, cell.col);
    return { st, text, kind, link, note, cell };
  }

  /** Tentukan lebar tampilan teks (spill ke sel kosong di sebelah). */
  function spillWidth(v: NonNullable<ReturnType<typeof cellVisual>>, r: number, c: number, own: number): { w: number; shift: number; side: "l" | "r" } | undefined {
    const st = v.st;
    if (st.wrap || !v.text || v.kind === "error") return undefined;
    if (v.kind === "number" || v.kind === "bool") return undefined; // angka tidak meluber (Excel menampilkan ####)
    const l = layout();
    const ws = props.sheet;
    const font = `${st.italic ? "italic " : ""}${st.bold ? "bold " : ""}${(st.sizePt * 96 / 72) * l.zoom}px ${st.fontName}, ${FONT_FALLBACK}`;
    const need = measureTextPx(v.text, font) + 8 * l.zoom + st.indent * 9 * l.zoom;
    if (need <= own) return undefined;
    const h = st.h;
    const right = h === "right";
    if (h === "center" || h === "centerContinuous" || h === "fill" || h === "justify") return undefined;
    let w = own, shift = 0;
    const dir = right ? -1 : 1;
    for (let k = 1; k <= 40 && w < need; k++) {
      const cc = c + dir * k;
      if (cc < 1 || cc > l.maxCol) break;
      const other = ws.rows.get(r)?.get(cc);
      if (other && other.value !== null && other.value !== "") break;
      if (props.book.mergeIndex(ws).covered.has(r * 16385 + cc)) break;
      const cw = colW(l, cc);
      w += cw;
      if (right) shift += cw;
    }
    return w > own ? { w, shift, side: right ? "r" : "l" } : undefined;
  }

  function cellStyleCss(st: ResolvedStyle, kind: string, w: number, h: number): JSX.CSSProperties {
    const z = layout().zoom;
    const css: JSX.CSSProperties = {
      width: `${w}px`, height: `${h}px`,
      "font-family": `"${st.fontName}", ${FONT_FALLBACK}`,
      "font-size": `${((st.sizePt * 96) / 72) * z}px`,
    };
    if (st.bold) css["font-weight"] = "700";
    if (st.italic) css["font-style"] = "italic";
    const deco: string[] = [];
    if (st.underline !== "none") deco.push("underline");
    if (st.strike) deco.push("line-through");
    if (deco.length) css["text-decoration"] = deco.join(" ") + (st.underline === "double" ? " double" : "");
    if (st.color) css.color = st.color;
    if (st.bg) css["background-color"] = st.bg;
    if (st.bgImage) css["background-image"] = st.bgImage;
    for (const k of ["left", "right", "top", "bottom"] as const) {
      const b = st[k];
      if (b) css[`border-${k}` as "border-left"] = `${Math.max(1, b.width * (z < 1 ? 1 : Math.min(z, 2)))}px ${b.css} ${b.color}`;
    }
    const jc = st.h === "center" || st.h === "centerContinuous" ? "center" : st.h === "right" ? "flex-end" : st.h === "left" ? "flex-start" : kind === "number" ? "flex-end" : kind === "bool" || kind === "error" ? "center" : "flex-start";
    css["justify-content"] = st.h === "justify" || st.h === "distributed" ? "stretch" : jc;
    css["align-items"] = st.v === "top" ? "flex-start" : st.v === "center" ? "center" : "flex-end";
    css["text-align"] = jc === "flex-end" ? "right" : jc === "center" ? "center" : "left";
    if (st.indent) css["padding-left"] = `${st.indent * 9 * z + 3}px`;
    return css;
  }

  const isHit = (r: number, c: number) => props.hits?.().has(r * 16385 + c) ?? false;
  const isCurHit = (r: number, c: number) => props.currentHit?.() === r * 16385 + c;

  /** Satu sel (div) — dirender di pane mana pun. */
  const CellView = (p: { r: number; c: number; merged?: any }) => {
    const l = () => layout();
    const idx = () => mergeIdx();
    const v = createMemo(() => cellVisual(p.r, p.c));
    // sel merge digambar oleh lapisan merge pada tiap pane (agar tetap tampil melewati garis freeze)
    const covered = () => !p.merged && (idx().covered.has(p.r * 16385 + p.c) || idx().anchors.has(p.r * 16385 + p.c));
    const merge = () => p.merged;
    const w = () => { const m = merge(); return m ? l().colStart[m.maxCol + 1]! - l().colStart[p.c]! : colW(l(), p.c); };
    const h = () => { const m = merge(); return m ? l().rowStart[m.maxRow + 1]! - l().rowStart[p.r]! : rowH(l(), p.r); };
    return (
      <Show when={v() && !covered()}>
        {(() => {
          const vis = () => v()!;
          const spill = createMemo(() => spillWidth(vis(), p.r, p.c, w()));
          return (
            <div
              class="xl-cell"
              classList={{ "xl-hit": isHit(p.r, p.c), "xl-hit-cur": isCurHit(p.r, p.c), "xl-link": !!vis().link, "xl-hidden-mark": l().hiddenCols.has(p.c) || l().hiddenRows.has(p.r) }}
              style={{ left: `${l().colStart[p.c]!}px`, top: p.merged ? `${l().rowStart[p.r]!}px` : "0", ...cellStyleCss(vis().st, vis().kind, w(), h()) }}
              data-r={p.r}
              data-c={p.c}
              title={vis().link ? (vis().link.tooltip || vis().link.target || vis().link.location || "") : undefined}
              onClick={e => { if (vis().link && (e.ctrlKey || e.metaKey)) props.onLink?.(p.r, p.c, vis().link); }}
            >
              <span
                class="xl-text"
                classList={{ wrap: vis().st.wrap, spill: !!spill() }}
                style={{
                  ...(spill() ? { width: `${spill()!.w}px`, [spill()!.side === "r" ? "right" : "left"]: "0", position: "absolute", top: "0", height: "100%", display: "flex", "align-items": cellStyleCss(vis().st, vis().kind, 0, 0)["align-items"], "justify-content": spill()!.side === "r" ? "flex-end" : "flex-start", padding: "0 3px", ...(spill()!.side === "r" ? { transform: `translateX(0)` } : {}) } : {}),
                  ...(vis().st.rotation && vis().st.rotation !== 255 ? { transform: `rotate(${vis().st.rotation <= 90 ? -vis().st.rotation : vis().st.rotation - 90}deg)`, "transform-origin": "center" } : {}),
                  ...(vis().link && !vis().st.color ? { color: "#0563c1", "text-decoration": "underline" } : {}),
                  "text-overflow": spill() || vis().st.wrap ? "clip" : "ellipsis",
                }}
              >
                {vis().text}
              </span>
              <Show when={vis().note}><i class="xl-note" title={vis().note.text} /></Show>
            </div>
          );
        })()}
      </Show>
    );
  };

  /** Pane: kumpulan baris × kolom pada satu kuadran. */
  const Pane = (p: { rows: Accessor<number[]>; cols: Accessor<number[]>; ox: () => number; oy: () => number; x: () => number; y: () => number; w: () => number; h: () => number; scrollX: boolean; scrollY: boolean; name: string }) => {
    const l = layout;
    const paneSel = createMemo(() => {
      const s = normSel(props.sel());
      const rs = p.rows(), cs = p.cols();
      if (!rs.length || !cs.length) return null;
      const r1 = Math.max(s.r1, rs[0]!), r2 = Math.min(s.r2, rs[rs.length - 1]!);
      const c1 = Math.max(s.c1, cs[0]!), c2 = Math.min(s.c2, cs[cs.length - 1]!);
      if (r1 > r2 || c1 > c2) return null;
      return { x: l().colStart[c1]!, y: l().rowStart[r1]!, w: l().colStart[c2 + 1]! - l().colStart[c1]!, h: l().rowStart[r2 + 1]! - l().rowStart[r1]! };
    });
    const paneRefs = createMemo(() => {
      const refs = props.refRanges?.() ?? [];
      const rs = p.rows(), cs = p.cols();
      if (!refs.length || !rs.length || !cs.length) return [];
      return refs.flatMap(rf => {
        const s = normSel(rf.sel);
        const r1 = Math.max(s.r1, rs[0]!), r2 = Math.min(s.r2, rs[rs.length - 1]!);
        const c1 = Math.max(s.c1, cs[0]!), c2 = Math.min(s.c2, cs[cs.length - 1]!);
        if (r1 > r2 || c1 > c2) return [];
        return [{ x: l().colStart[c1]!, y: l().rowStart[r1]!, w: l().colStart[c2 + 1]! - l().colStart[c1]!, h: l().rowStart[r2 + 1]! - l().rowStart[r1]!, color: rf.color }];
      });
    });
    const paneActive = createMemo(() => {
      const a = props.active();
      if (!p.rows().includes(a.row) || !p.cols().includes(a.col)) return null;
      const m = props.book.mergeIndex(props.sheet).anchors.get(a.row * 16385 + a.col);
      const r2 = m ? m.maxRow : a.row, c2 = m ? m.maxCol : a.col;
      return { x: l().colStart[a.col]!, y: l().rowStart[a.row]!, w: l().colStart[c2 + 1]! - l().colStart[a.col]!, h: l().rowStart[r2 + 1]! - l().rowStart[a.row]! };
    });
    const pictures = createMemo(() => {
      props.version();
      const rs = p.rows(), cs = p.cols();
      if (!rs.length && !cs.length) return [] as DrawingView[];
      const rMin = rs[0] ?? 1, rMax = rs[rs.length - 1] ?? 0, cMin = cs[0] ?? 1, cMax = cs[cs.length - 1] ?? 0;
      const fr = l().fr, fc = l().fc;
      return props.book.drawingsOf(props.sheet).filter(d => {
        if (d.hidden) return false;
        const rr = d.anchorCell.row, cc = d.anchorCell.col;
        const inRow = p.scrollY ? rr > fr : rr <= fr;
        const inCol = p.scrollX ? cc > fc : cc <= fc;
        void rMin; void rMax; void cMin; void cMax;
        return inRow && inCol;
      });
    });
    const gridCols = () => p.cols();
    const gridRows = () => p.rows();
    const paneMerges = createMemo(() => {
      mergeIdx();
      const rs = p.rows(), cs = p.cols();
      if (!rs.length || !cs.length) return [];
      const r0 = rs[0]!, r1 = rs[rs.length - 1]!, c0 = cs[0]!, c1 = cs[cs.length - 1]!;
      return (props.sheet.mergedCells ?? []).filter((m: any) => m.maxRow >= r0 && m.minRow <= r1 && m.maxCol >= c0 && m.minCol <= c1 && colW(l(), m.minCol) + rowH(l(), m.minRow) > 0);
    });
    return (
      <div class={`xl-pane xl-pane-${p.name}`} style={{ left: `${p.x()}px`, top: `${p.y()}px`, width: `${p.w()}px`, height: `${p.h()}px` }}>
        <div class="xl-pane-content" style={{ transform: `translate(${-p.ox()}px, ${-p.oy()}px)` }}>
          <Show when={props.showGridlines()}>
            <For each={gridRows()}>{r => <div class="xl-gl-h" style={{ top: `${l().rowStart[r + 1]! - 1}px`, left: `${l().colStart[gridCols()[0] ?? 1]!}px`, width: `${(l().colStart[(gridCols()[gridCols().length - 1] ?? 0) + 1] ?? 0) - l().colStart[gridCols()[0] ?? 1]!}px` }} />}</For>
            <For each={gridCols()}>{c => <div class="xl-gl-v" style={{ left: `${l().colStart[c + 1]! - 1}px`, top: `${l().rowStart[gridRows()[0] ?? 1]!}px`, height: `${(l().rowStart[(gridRows()[gridRows().length - 1] ?? 0) + 1] ?? 0) - l().rowStart[gridRows()[0] ?? 1]!}px` }} />}</For>
          </Show>
          <For each={gridRows()}>
            {r => (
              <div class="xl-row" style={{ top: `${l().rowStart[r]!}px`, height: `${rowH(l(), r)}px` }}>
                <For each={gridCols()}>{c => <CellView r={r} c={c} />}</For>
              </div>
            )}
          </For>
          <For each={paneMerges()}>{m => <CellView r={m.minRow} c={m.minCol} merged={m} />}</For>
          {/* gambar mengambang */}
          <For each={pictures()}>
            {d => {
              const rect = createMemo(() => anchorRect(l(), d.anchor));
              const [drag, setDrag] = createSignal<{ dx: number; dy: number; dw: number; dh: number } | null>(null);
              const editable = () => d.kind === "picture" && !props.readonly?.() && !!props.onImageRect;
              const isSel = () => props.selectedImage?.() === d.key;
              const start = (mode: "move" | "resize", e: MouseEvent) => {
                if (!editable() || e.button !== 0) return;
                e.preventDefault(); e.stopPropagation();
                if (props.editing()) props.onCommitEdit("none");
                props.onSelectImage?.(d.key);
                scroller.focus({ preventScroll: true });
                const x0 = e.clientX, y0 = e.clientY;
                let moved = false;
                const move = (ev: MouseEvent) => {
                  const dx = ev.clientX - x0, dy = ev.clientY - y0;
                  if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
                  moved = true;
                  setDrag(mode === "move" ? { dx, dy, dw: 0, dh: 0 } : { dx: 0, dy: 0, dw: dx, dh: dy });
                };
                const up = () => {
                  window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up);
                  const dr = drag(); setDrag(null);
                  if (moved && dr) { const r = rect(); props.onImageRect?.(d, { x: r.x + dr.dx, y: r.y + dr.dy, w: r.w + dr.dw, h: r.h + dr.dh }); }
                };
                window.addEventListener("mousemove", move);
                window.addEventListener("mouseup", up);
              };
              return (
                <div
                  class="xl-float"
                  classList={{ chart: d.kind !== "picture", broken: d.kind === "picture" && !d.url, editable: editable(), selected: isSel() && editable() }}
                  style={{ left: `${rect().x + (drag()?.dx ?? 0)}px`, top: `${rect().y + (drag()?.dy ?? 0)}px`, width: `${Math.max(4, rect().w + (drag()?.dw ?? 0))}px`, height: `${Math.max(4, rect().h + (drag()?.dh ?? 0))}px` }}
                  title={d.descr || d.name || ""}
                  data-nodrag
                  onMouseDown={e => start("move", e)}
                >
                  <Show when={d.kind === "picture" && d.url} fallback={<div class="xl-float-ph"><b>{d.kind === "chart" ? "📊 Grafik" : d.kind === "picture" ? "🖼 Gambar" : d.text ?? "◻ Objek"}</b><Show when={!d.text}><small>{d.note}</small></Show></div>}>
                    <img src={d.url} alt={d.descr || d.name || "gambar"} draggable={false} />
                  </Show>
                  <Show when={isSel() && editable()}><i class="xl-img-h" title="Ubah ukuran" onMouseDown={e => start("resize", e)} /></Show>
                </div>
              );
            }}
          </For>
          <Show when={paneSel()}>{s => <div class="xl-sel" style={{ left: `${s().x}px`, top: `${s().y}px`, width: `${s().w}px`, height: `${s().h}px` }} />}</Show>
          <For each={paneRefs()}>{r => <div class="xl-ref" style={{ left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, "border-color": r.color, background: r.color + "22" }} />}</For>
          <Show when={paneActive()}>{s => <div class="xl-active" style={{ left: `${s().x}px`, top: `${s().y}px`, width: `${s().w}px`, height: `${s().h}px` }} />}</Show>
          {/* tombol autofilter */}
          <Show when={props.filter()}>
            {f => (
              <For each={gridCols().filter(c => c >= f().range.minCol && c <= f().range.maxCol)}>
                {c => (
                  <Show when={gridRows().includes(f().range.minRow)}>
                    <button
                      data-nodrag
                      class="xl-filter-btn"
                      classList={{ on: f().selected.has(c) }}
                      title="Filter"
                      style={{ left: `${l().colStart[c + 1]! - 18}px`, top: `${l().rowStart[f().range.minRow + 1]! - 18}px` }}
                      onMouseDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); props.onOpenFilter(c, e.currentTarget); }}
                    >
                      <svg viewBox="0 0 10 10" width="9" height="9"><path d="M1 2h8L6 5.5V9L4 8V5.5z" fill="currentColor" /></svg>
                    </button>
                  </Show>
                )}
              </For>
            )}
          </Show>
        </div>
      </div>
    );
  };

  // header
  const HeaderCells = (p: { cols: Accessor<number[]>; ox: () => number; x: () => number; w: () => number }) => {
    const l = layout;
    const selCols = createMemo(() => { const s = normSel(props.sel()); return [s.c1, s.c2] as const; });
    return (
      <div class="xl-head xl-head-col" style={{ left: `${p.x()}px`, width: `${p.w()}px`, height: `${HEADER_H}px` }}>
        <div style={{ transform: `translateX(${-p.ox()}px)`, position: "absolute", left: "0", top: "0", height: "100%" }}>
          <For each={p.cols()}>
            {c => (
              <div class="xl-hc" classList={{ sel: c >= selCols()[0] && c <= selCols()[1], filtered: !!props.filter()?.selected.has(c) }} style={{ left: `${l().colStart[c]!}px`, width: `${colW(l(), c)}px` }}>
                {columnLetterFromIndex(c)}
                <i class="xl-grip" data-nodrag onMouseDown={e => startResize("col", c, e)} onDblClick={e => { e.stopPropagation(); props.onAutofitColumn(c); }} />
              </div>
            )}
          </For>
          {/* penanda kolom tersembunyi */}
          <For each={[...layout().hiddenCols].filter(c => !props.showHidden() && c <= layout().maxCol && (c === 1 || !layout().hiddenCols.has(c - 1)))}>
            {c => <div class="xl-hmark" title={`Kolom tersembunyi dari ${columnLetterFromIndex(c)}`} style={{ left: `${l().colStart[c]! - 3}px` }} />}
          </For>
        </div>
      </div>
    );
  };
  const HeaderRows = (p: { rows: Accessor<number[]>; oy: () => number; y: () => number; h: () => number }) => {
    const l = layout;
    const selRows = createMemo(() => { const s = normSel(props.sel()); return [s.r1, s.r2] as const; });
    return (
      <div class="xl-head xl-head-row" style={{ top: `${p.y()}px`, height: `${p.h()}px`, width: `${HEADER_W}px` }}>
        <div style={{ transform: `translateY(${-p.oy()}px)`, position: "absolute", left: "0", top: "0", width: "100%" }}>
          <For each={p.rows()}>
            {r => (
              <div class="xl-hr" classList={{ sel: r >= selRows()[0] && r <= selRows()[1], filtered: !!props.filter()?.hiddenRows.size && r > props.filter()!.range.minRow && r <= props.filter()!.range.maxRow }} style={{ top: `${l().rowStart[r]!}px`, height: `${rowH(l(), r)}px` }}>
                {r}
                <i class="xl-grip" data-nodrag onMouseDown={e => startResize("row", r, e)} />
              </div>
            )}
          </For>
          <For each={[...layout().hiddenRows].filter(r => !props.showHidden() && r <= layout().maxRow && (r === 1 || !layout().hiddenRows.has(r - 1)) && r > 0).slice(0, 400)}>
            {r => <div class="xl-hmark-r" title={`Baris tersembunyi dari ${r}`} style={{ top: `${l().rowStart[r]! - 3}px` }} />}
          </For>
        </div>
      </div>
    );
  };

  // editor in-cell
  const editRect = createMemo(() => {
    const e = props.editing();
    if (!e) return null;
    layout(); sx(); sy();
    const m = props.book.mergeIndex(props.sheet).anchors.get(e.row * 16385 + e.col);
    const r = stageRect(e.row, e.col, m?.maxRow ?? e.row, m?.maxCol ?? e.col);
    return r;
  });
  createEffect(() => { if (props.editing()) queueMicrotask(() => { editorEl?.focus(); const len = editorEl?.value.length ?? 0; editorEl?.setSelectionRange(len, len); }); });

  const g = geo;
  return (
    <div
      ref={scroller}
      class="xl-scroller"
      tabIndex={0}
      onScroll={onScroll}
      onKeyDown={e => { if (!props.editing()) props.onKeyDown(e); }}
      onWheel={onWheel}
      onContextMenu={onCtx}
    >
      <div class="xl-sizer" style={{ width: `${HEADER_W + g().totalW}px`, height: `${g().sizerH}px` }}>
        <div ref={stage} class="xl-stage" style={{ width: `${vw()}px`, height: `${vh()}px` }} onMouseDown={onMouseDown} onDblClick={onDblClick}>
          {/* pane */}
          <Pane name="tl" rows={frozenRows} cols={frozenCols} ox={() => 0} oy={() => 0} x={() => HEADER_W} y={() => HEADER_H} w={() => g().frozenW} h={() => g().frozenH} scrollX={false} scrollY={false} />
          <Pane name="tr" rows={frozenRows} cols={scrollCols} ox={() => g().originX + sx()} oy={() => 0} x={() => HEADER_W + g().frozenW} y={() => HEADER_H} w={() => g().scrollW} h={() => g().frozenH} scrollX={true} scrollY={false} />
          <Pane name="bl" rows={scrollRows} cols={frozenCols} ox={() => 0} oy={() => g().originY + sy()} x={() => HEADER_W} y={() => HEADER_H + g().frozenH} w={() => g().frozenW} h={() => g().scrollH} scrollX={false} scrollY={true} />
          <Pane name="br" rows={scrollRows} cols={scrollCols} ox={() => g().originX + sx()} oy={() => g().originY + sy()} x={() => HEADER_W + g().frozenW} y={() => HEADER_H + g().frozenH} w={() => g().scrollW} h={() => g().scrollH} scrollX={true} scrollY={true} />
          {/* header */}
          <div class="xl-corner" style={{ width: `${HEADER_W}px`, height: `${HEADER_H}px` }} />
          <HeaderCells cols={frozenCols} ox={() => 0} x={() => HEADER_W} w={() => g().frozenW} />
          <HeaderCells cols={scrollCols} ox={() => g().originX + sx()} x={() => HEADER_W + g().frozenW} w={() => g().scrollW} />
          <HeaderRows rows={frozenRows} oy={() => 0} y={() => HEADER_H} h={() => g().frozenH} />
          <HeaderRows rows={scrollRows} oy={() => g().originY + sy()} y={() => HEADER_H + g().frozenH} h={() => g().scrollH} />
          {/* garis pemisah freeze */}
          <Show when={layout().fc > 0}><div class="xl-freeze-v" style={{ left: `${HEADER_W + g().frozenW}px` }} /></Show>
          <Show when={layout().fr > 0}><div class="xl-freeze-h" style={{ top: `${HEADER_H + g().frozenH}px` }} /></Show>
          {/* editor */}
          <Show when={editRect()}>
            {r => (
              <textarea
                ref={editorEl}
                data-nodrag
                class="xl-editor"
                style={{ left: `${r().x}px`, top: `${r().y}px`, "min-width": `${Math.max(r().w, 40)}px`, "min-height": `${Math.max(r().h, 20)}px`, "font-size": `${14 * layout().zoom}px` }}
                value={props.editing()!.text}
                spellcheck={false}
                onInput={e => props.onEditText(e.currentTarget.value)}
                onKeyDown={e => {
                  e.stopPropagation();
                  if (e.key === "Enter" && !e.altKey) { e.preventDefault(); props.onCommitEdit(e.shiftKey ? "up" : "down"); }
                  else if (e.key === "Tab") { e.preventDefault(); props.onCommitEdit(e.shiftKey ? "left" : "right"); }
                  else if (e.key === "Escape") { e.preventDefault(); props.onCancelEdit(); scroller.focus({ preventScroll: true }); }
                  else if (e.key === "Enter" && e.altKey) { const t = e.currentTarget; const s = t.selectionStart; t.setRangeText("\n", s, t.selectionEnd, "end"); props.onEditText(t.value); e.preventDefault(); }
                }}
                onMouseDown={e => e.stopPropagation()}
              />
            )}
          </Show>
        </div>
      </div>
    </div>
  );
}

export { pxToColChars, pxToPt };
