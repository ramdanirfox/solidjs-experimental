/**
 * `RulerKit`: penggaris (horizontal + vertikal), garis bantu (guide) dan alat ukur jarak untuk editor berbasis DOM.
 *
 * Kontrak DOM — editor menyediakan bingkai dengan satu anak `.rk-body` (area yang berisi stage/scroll editor):
 *
 *   <div class="rk-frame">
 *     <div class="rk-body"> …stage editor… </div>
 *   </div>
 *
 * Kit menambahkan sudut + penggaris sebagai sel grid bingkai dan lapisan `.rk-layer` (guide & ukur) di atas `.rk-body`.
 * Seluruh koordinat dokumen memakai px CSS pada zoom 100% (96 dpi). `getGeometry()` memetakan dokumen → layar:
 *   layar(relatif ke .rk-body) = origin + koordinatDokumen × scale,  angka 0 penggaris = koordinat dokumen `zero`.
 * Panggil `refresh()` setiap scroll / zoom / perubahan tata letak (kit juga mengamati resize dan scroll `scrollEl`).
 */
import { buildTicks, formatMeasure, pxToUnit, PX_PER_UNIT, RULER_UNITS, snapSpan, snapValue, type RulerUnit } from "./ruler-core";
import "./ruler.css";

export interface RulerGeometry { originX: number; originY: number; scale: number; zeroX: number; zeroY: number }
export interface RulerRegion { axis: "x" | "y"; from: number; to: number; kind?: "margin" | "content" | "mark"; label?: string }
export interface Guide { id: string; axis: "x" | "y"; pos: number }
export interface MeasureResult { x1: number; y1: number; x2: number; y2: number; dx: number; dy: number; distance: number; angle: number; unit: RulerUnit; text: string }

export interface RulerEventMap {
  "ruler:visible": { visible: boolean };
  "ruler:unit": { unit: RulerUnit };
  "ruler:guide-add": Guide;
  "ruler:guide-move": Guide & { from: number };
  "ruler:guide-remove": Guide;
  "ruler:measure": MeasureResult;
  "ruler:measure-mode": { active: boolean };
}

export interface RulerKitOptions {
  /** Bingkai `.rk-frame`. */
  frame: HTMLElement;
  getGeometry: () => RulerGeometry;
  unit?: RulerUnit;
  visible?: boolean;
  /** Tebal penggaris (px). Default 20. */
  thickness?: number;
  /** Elemen scroll yang perlu didengarkan (default: `.rk-body` dan turunan scroll tidak diamati otomatis). */
  scrollEl?: HTMLElement | null;
  emit?: <K extends keyof RulerEventMap>(type: K, payload: RulerEventMap[K]) => void;
  /** Wilayah berwarna pada penggaris (margin, area konten, dsb.). */
  getRegions?: () => RulerRegion[];
  /** Toleransi tempel ke guide (px layar). Default 6. */
  snapTolerance?: number;
  /** Teks tombol sudut/ukur (i18n). */
  labels?: { corner?: string; measure?: string; removeGuide?: string };
}

let uid = 0;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: Element) => {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
};
const SVGNS = "http://www.w3.org/2000/svg";

export class RulerKit {
  readonly frame: HTMLElement;
  readonly body: HTMLElement;
  private opts: RulerKitOptions;
  private corner: HTMLButtonElement;
  private hBox: HTMLElement; private vBox: HTMLElement;
  private hCv: HTMLCanvasElement; private vCv: HTMLCanvasElement;
  private hCur: HTMLElement; private vCur: HTMLElement;
  private layer: HTMLElement;
  private svg: SVGSVGElement; private mLine: SVGLineElement; private mLabel: HTMLElement;
  private tip: HTMLElement;
  private guideEls = new Map<string, HTMLElement>();
  private guides: Guide[] = [];
  private unit: RulerUnit;
  private visible: boolean;
  private measuring = false;
  private last: MeasureResult | null = null;
  private raf = 0;
  private ro?: ResizeObserver;
  private cleanups: (() => void)[] = [];

  constructor(opts: RulerKitOptions) {
    this.opts = opts;
    this.frame = opts.frame;
    const body = this.frame.querySelector<HTMLElement>(":scope > .rk-body");
    if (!body) throw new Error("RulerKit: bingkai harus punya anak .rk-body");
    this.body = body;
    this.unit = opts.unit ?? "cm";
    this.visible = opts.visible ?? false;
    this.frame.style.setProperty("--rk-t", `${opts.thickness ?? 20}px`);
    this.frame.classList.add("rk-frame");

    this.corner = el("button", "rk-corner", this.frame);
    this.corner.type = "button";
    this.corner.title = opts.labels?.corner ?? "Satuan penggaris (klik untuk ganti)";
    this.corner.addEventListener("click", () => this.cycleUnit());
    this.hBox = el("div", "rk-ruler rk-h", this.frame);
    this.vBox = el("div", "rk-ruler rk-v", this.frame);
    this.hCv = el("canvas", "rk-cv", this.hBox);
    this.vCv = el("canvas", "rk-cv", this.vBox);
    this.hCur = el("div", "rk-cursor", this.hBox);
    this.vCur = el("div", "rk-cursor", this.vBox);
    this.layer = el("div", "rk-layer", this.body);
    this.svg = document.createElementNS(SVGNS, "svg");
    this.svg.setAttribute("class", "rk-svg");
    this.mLine = document.createElementNS(SVGNS, "line");
    this.mLine.setAttribute("class", "rk-mline");
    this.svg.appendChild(this.mLine);
    this.layer.appendChild(this.svg);
    this.mLabel = el("div", "rk-mlabel", this.layer);
    this.tip = el("div", "rk-tip", this.layer);
    this.tip.hidden = true;

    this.hBox.addEventListener("pointerdown", e => this.startGuideFromRuler(e, "y"));
    this.vBox.addEventListener("pointerdown", e => this.startGuideFromRuler(e, "x"));
    this.layer.addEventListener("pointerdown", e => this.onMeasureDown(e));
    const onMove = (e: PointerEvent) => this.moveCursor(e);
    this.body.addEventListener("pointermove", onMove);
    this.body.addEventListener("pointerleave", () => this.moveCursor(null));
    this.cleanups.push(() => this.body.removeEventListener("pointermove", onMove));
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && (this.measuring || this.last)) { this.clearMeasure(); if (this.measuring) this.setMeasureMode(false); } };
    this.frame.addEventListener("keydown", onKey);
    this.cleanups.push(() => this.frame.removeEventListener("keydown", onKey));

    if (typeof ResizeObserver !== "undefined") { this.ro = new ResizeObserver(() => this.refresh()); this.ro.observe(this.body); }
    if (opts.scrollEl) {
      const sc = () => this.refresh();
      opts.scrollEl.addEventListener("scroll", sc, { passive: true });
      this.cleanups.push(() => opts.scrollEl?.removeEventListener("scroll", sc));
    }
    this.applyVisible();
    this.refresh();
  }

  // ───────── konfigurasi ─────────

  isVisible() { return this.visible; }
  setVisible(v: boolean) {
    if (v === this.visible) return;
    this.visible = v;
    this.applyVisible();
    this.refresh();
    this.opts.emit?.("ruler:visible", { visible: v });
  }
  toggle() { this.setVisible(!this.visible); }
  private applyVisible() { this.frame.classList.toggle("rk-on", this.visible); this.layer.hidden = !this.visible; }

  getUnit() { return this.unit; }
  setUnit(u: RulerUnit) {
    if (u === this.unit || !(u in PX_PER_UNIT)) return;
    this.unit = u;
    this.refresh();
    this.opts.emit?.("ruler:unit", { unit: u });
  }
  cycleUnit() { this.setUnit(RULER_UNITS[(RULER_UNITS.indexOf(this.unit) + 1) % RULER_UNITS.length]); }

  /** Terapkan geometri lagi (jadwalkan satu kali per frame). */
  refresh() {
    if (this.raf) return;
    const run = () => { this.raf = 0; this.paint(); };
    this.raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame(run) : (setTimeout(run, 0) as unknown as number);
  }
  /** Gambar sekarang juga (untuk uji / setelah perubahan besar). */
  paintNow() { if (this.raf) { (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout)(this.raf); this.raf = 0; } this.paint(); }

  // ───────── gambar ─────────

  private colors() {
    const cs = getComputedStyle(this.frame);
    const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
    return { bg: v("--rk-bg", "#f8fafc"), fg: v("--rk-fg", "#475569"), line: v("--rk-line", "#94a3b8"), region: v("--rk-region", "#e2e8f0"), accent: v("--rk-accent", "#2563eb") };
  }

  private paint() {
    if (!this.visible) return;
    const g = this.opts.getGeometry();
    const regions = this.opts.getRegions?.() ?? [];
    const c = this.colors();
    this.paintRuler(this.hCv, "x", g, regions, c);
    this.paintRuler(this.vCv, "y", g, regions, c);
    this.positionGuides(g);
    this.drawLast(g);
  }

  private paintRuler(cv: HTMLCanvasElement, axis: "x" | "y", g: RulerGeometry, regions: RulerRegion[], c: ReturnType<RulerKit["colors"]>) {
    const parent = cv.parentElement!;
    const w = parent.clientWidth, h = parent.clientHeight;
    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = `${w}px`; cv.style.height = `${h}px`; }
    if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) return; // tanpa canvas
    const ctx = cv.getContext?.("2d");
    if (!ctx) return; // jsdom / tanpa canvas
    const horizontal = axis === "x";
    const length = horizontal ? w : h, thick = horizontal ? h : w;
    const origin = horizontal ? g.originX : g.originY, zero = horizontal ? g.zeroX : g.zeroY;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = c.bg; ctx.fillRect(0, 0, w, h);
    // wilayah (margin / konten)
    for (const r of regions) {
      if (r.axis !== axis) continue;
      const a = origin + r.from * g.scale, b = origin + r.to * g.scale;
      ctx.fillStyle = r.kind === "margin" ? c.region : r.kind === "mark" ? c.accent + "33" : c.bg;
      if (r.kind === "content") { ctx.fillStyle = "#ffffff22"; }
      if (horizontal) ctx.fillRect(a, 0, b - a, thick); else ctx.fillRect(0, a, thick, b - a);
    }
    const ticks = buildTicks({ unit: this.unit, scale: g.scale, origin, zero, length });
    ctx.strokeStyle = c.line; ctx.fillStyle = c.fg; ctx.lineWidth = 1;
    ctx.font = "10px system-ui, sans-serif"; ctx.textBaseline = "top";
    ctx.beginPath();
    for (const t of ticks) {
      const p = Math.round(t.pos) + 0.5;
      const len = t.kind === "major" ? thick * 0.6 : t.kind === "mid" ? thick * 0.4 : thick * 0.25;
      if (horizontal) { ctx.moveTo(p, thick); ctx.lineTo(p, thick - len); } else { ctx.moveTo(thick, p); ctx.lineTo(thick - len, p); }
    }
    ctx.stroke();
    for (const t of ticks) {
      if (!t.label) continue;
      if (horizontal) ctx.fillText(t.label, t.pos + 3, 2);
      else { ctx.save(); ctx.translate(2, t.pos + 3); ctx.rotate(-Math.PI / 2); ctx.textBaseline = "top"; ctx.fillText(t.label, -ctx.measureText(t.label).width - 2, 0); ctx.restore(); }
    }
    ctx.strokeStyle = c.line;
    ctx.beginPath();
    if (horizontal) { ctx.moveTo(0, thick - 0.5); ctx.lineTo(w, thick - 0.5); } else { ctx.moveTo(thick - 0.5, 0); ctx.lineTo(thick - 0.5, h); }
    ctx.stroke();
    // guide
    ctx.fillStyle = c.accent;
    for (const gd of this.guides) {
      if (gd.axis !== axis) continue;
      const p = origin + gd.pos * g.scale;
      if (horizontal) ctx.fillRect(p - 1, thick - 6, 3, 6); else ctx.fillRect(thick - 6, p - 1, 6, 3);
    }
  }

  private moveCursor(e: PointerEvent | null) {
    if (!this.visible) return;
    if (!e) { this.hCur.style.display = "none"; this.vCur.style.display = "none"; return; }
    const r = this.body.getBoundingClientRect();
    this.hCur.style.display = "block"; this.vCur.style.display = "block";
    this.hCur.style.left = `${e.clientX - r.left}px`;
    this.vCur.style.top = `${e.clientY - r.top}px`;
  }

  // ───────── koordinat ─────────

  /** Titik klien → koordinat dokumen (px). */
  toDoc(clientX: number, clientY: number): { x: number; y: number } {
    const g = this.opts.getGeometry();
    const r = this.body.getBoundingClientRect();
    return { x: (clientX - r.left - g.originX) / g.scale, y: (clientY - r.top - g.originY) / g.scale };
  }
  /** Koordinat dokumen → posisi relatif `.rk-body` (px layar). */
  toScreen(x: number, y: number): { x: number; y: number } {
    const g = this.opts.getGeometry();
    return { x: g.originX + x * g.scale, y: g.originY + y * g.scale };
  }
  /** Koordinat dokumen relatif ke titik nol penggaris, dalam satuan aktif. */
  fromZero(axis: "x" | "y", docPx: number): number {
    const g = this.opts.getGeometry();
    return pxToUnit(docPx - (axis === "x" ? g.zeroX : g.zeroY), this.unit);
  }
  format(px: number) { return formatMeasure(px, this.unit); }

  // ───────── guide ─────────

  getGuides(): Guide[] { return this.guides.map(g => ({ ...g })); }
  addGuide(axis: "x" | "y", pos: number, silent = false): Guide {
    const guide: Guide = { id: `g${++uid}`, axis, pos };
    this.guides.push(guide);
    this.renderGuide(guide);
    this.refresh();
    if (!silent) this.opts.emit?.("ruler:guide-add", { ...guide });
    return guide;
  }
  removeGuide(id: string, silent = false) {
    const i = this.guides.findIndex(g => g.id === id);
    if (i < 0) return;
    const [g] = this.guides.splice(i, 1);
    this.guideEls.get(id)?.remove(); this.guideEls.delete(id);
    this.refresh();
    if (!silent) this.opts.emit?.("ruler:guide-remove", { ...g });
  }
  clearGuides() { for (const g of [...this.guides]) this.removeGuide(g.id); }
  setGuides(list: { axis: "x" | "y"; pos: number }[]) {
    for (const g of [...this.guides]) this.removeGuide(g.id, true);
    for (const g of list) this.addGuide(g.axis, g.pos, true);
  }
  moveGuide(id: string, pos: number) {
    const g = this.guides.find(x => x.id === id);
    if (!g || g.pos === pos) return;
    const from = g.pos;
    g.pos = pos;
    this.refresh();
    this.opts.emit?.("ruler:guide-move", { ...g, from });
  }

  /** Posisi guide sebagai kandidat tempel (koordinat dokumen). */
  guidePositions(axis: "x" | "y"): number[] { return this.guides.filter(g => g.axis === axis).map(g => g.pos); }

  /** Tempel nilai (atau rentang) ke guide terdekat. Dipakai handler drag editor untuk alignment. */
  snap(p: { x?: number; y?: number; w?: number; h?: number }, tolerancePx = this.opts.snapTolerance ?? 6): { x?: number; y?: number; hitX: number | null; hitY: number | null } {
    const g = this.opts.getGeometry();
    const tol = tolerancePx / (g.scale || 1);
    let x = p.x, y = p.y, hitX: number | null = null, hitY: number | null = null;
    if (this.visible) {
      if (x !== undefined) { const r = p.w !== undefined ? snapSpan(x, p.w, this.guidePositions("x"), tol) : snapValue(x, this.guidePositions("x"), tol); x = r.value; hitX = r.hit; }
      if (y !== undefined) { const r = p.h !== undefined ? snapSpan(y, p.h, this.guidePositions("y"), tol) : snapValue(y, this.guidePositions("y"), tol); y = r.value; hitY = r.hit; }
    }
    return { x, y, hitX, hitY };
  }

  private renderGuide(g: Guide) {
    const e = el("div", `rk-guide rk-g${g.axis}`, this.layer);
    e.dataset.guide = g.id;
    e.title = this.opts.labels?.removeGuide ?? "Seret untuk memindah · seret ke penggaris / klik ganda untuk menghapus";
    e.addEventListener("pointerdown", ev => this.dragGuide(ev, g.id));
    e.addEventListener("dblclick", () => this.removeGuide(g.id));
    this.guideEls.set(g.id, e);
  }

  private positionGuides(g: RulerGeometry) {
    for (const gd of this.guides) {
      const e = this.guideEls.get(gd.id);
      if (!e) continue;
      if (gd.axis === "x") e.style.left = `${g.originX + gd.pos * g.scale}px`;
      else e.style.top = `${g.originY + gd.pos * g.scale}px`;
    }
  }

  private showTip(axis: "x" | "y", docPos: number, clientX: number, clientY: number) {
    const r = this.body.getBoundingClientRect();
    this.tip.hidden = false;
    this.tip.textContent = formatMeasure(docPos - (axis === "x" ? this.opts.getGeometry().zeroX : this.opts.getGeometry().zeroY), this.unit);
    this.tip.style.left = `${clientX - r.left + 12}px`;
    this.tip.style.top = `${clientY - r.top + 12}px`;
  }

  private startGuideFromRuler(e: PointerEvent, axis: "x" | "y") {
    if (e.button !== 0 || !this.visible) return;
    e.preventDefault();
    const guide = this.addGuide(axis, this.toDoc(e.clientX, e.clientY)[axis], true);
    this.dragGuide(e, guide.id, true);
  }

  private dragGuide(e: PointerEvent, id: string, isNew = false) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const g = this.guides.find(x => x.id === id);
    if (!g) return;
    const from = g.pos;
    const target = e.currentTarget as HTMLElement;
    try { target.setPointerCapture?.(e.pointerId); } catch { /* abaikan */ }
    const move = (ev: PointerEvent) => {
      g.pos = this.toDoc(ev.clientX, ev.clientY)[g.axis];
      this.positionGuides(this.opts.getGeometry());
      this.showTip(g.axis, g.pos, ev.clientX, ev.clientY);
      this.refresh();
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      this.tip.hidden = true;
      const r = this.body.getBoundingClientRect();
      const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      if (!inside || ev.type === "pointercancel") { this.removeGuide(id, isNew); return; }
      if (isNew) this.opts.emit?.("ruler:guide-add", { ...g });
      else if (g.pos !== from) this.opts.emit?.("ruler:guide-move", { ...g, from });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    move(e);
  }

  // ───────── alat ukur ─────────

  isMeasuring() { return this.measuring; }
  setMeasureMode(on: boolean) {
    if (on === this.measuring) return;
    this.measuring = on;
    this.layer.classList.toggle("rk-measuring", on);
    if (!on) this.clearMeasure();
    this.opts.emit?.("ruler:measure-mode", { active: on });
    if (on && !this.visible) this.setVisible(true);
  }
  getLastMeasure() { return this.last; }
  clearMeasure() { this.last = null; this.mLine.setAttribute("visibility", "hidden"); this.mLabel.hidden = true; }

  /** Ukur dua titik (koordinat dokumen) secara programatik; hasilnya digambar dan dipancarkan sebagai event. */
  measure(x1: number, y1: number, x2: number, y2: number, silent = false): MeasureResult {
    const dx = x2 - x1, dy = y2 - y1, distance = Math.hypot(dx, dy);
    const angle = (Math.atan2(-dy, dx) * 180) / Math.PI;
    const text = `${formatMeasure(distance, this.unit)}  (Δx ${formatMeasure(Math.abs(dx), this.unit, false)}, Δy ${formatMeasure(Math.abs(dy), this.unit, false)}, ${Math.round(angle)}°)`;
    const res: MeasureResult = { x1, y1, x2, y2, dx, dy, distance, angle, unit: this.unit, text };
    this.last = res;
    this.drawLast(this.opts.getGeometry());
    if (!silent) this.opts.emit?.("ruler:measure", res);
    return res;
  }

  private drawLast(g: RulerGeometry) {
    const m = this.last;
    if (!m) return;
    const a = { x: g.originX + m.x1 * g.scale, y: g.originY + m.y1 * g.scale }, b = { x: g.originX + m.x2 * g.scale, y: g.originY + m.y2 * g.scale };
    this.mLine.setAttribute("visibility", "visible");
    this.mLine.setAttribute("x1", String(a.x)); this.mLine.setAttribute("y1", String(a.y));
    this.mLine.setAttribute("x2", String(b.x)); this.mLine.setAttribute("y2", String(b.y));
    this.mLabel.hidden = false;
    this.mLabel.textContent = m.text;
    this.mLabel.style.left = `${(a.x + b.x) / 2 + 8}px`;
    this.mLabel.style.top = `${(a.y + b.y) / 2 + 8}px`;
  }

  private onMeasureDown(e: PointerEvent) {
    if (!this.measuring || e.button !== 0 || e.target !== this.layer && e.target !== this.svg) return;
    e.preventDefault(); e.stopPropagation();
    const start = this.toDoc(e.clientX, e.clientY);
    const move = (ev: PointerEvent) => {
      const p = this.toDoc(ev.clientX, ev.clientY);
      let { x, y } = p;
      if (ev.shiftKey) { if (Math.abs(x - start.x) > Math.abs(y - start.y)) y = start.y; else x = start.x; } // Shift = kunci sumbu
      this.measure(start.x, start.y, x, y, true);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      const p = this.toDoc(ev.clientX, ev.clientY);
      let { x, y } = p;
      if (ev.shiftKey) { if (Math.abs(x - start.x) > Math.abs(y - start.y)) y = start.y; else x = start.x; }
      if (Math.hypot(x - start.x, y - start.y) < 1) { this.clearMeasure(); return; }
      this.measure(start.x, start.y, x, y);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  destroy() {
    if (this.raf) (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout)(this.raf);
    this.ro?.disconnect();
    this.cleanups.forEach(c => c());
    this.corner.remove(); this.hBox.remove(); this.vBox.remove(); this.layer.remove();
    this.frame.classList.remove("rk-on");
  }
}
