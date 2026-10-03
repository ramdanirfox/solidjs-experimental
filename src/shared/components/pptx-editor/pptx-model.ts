/**
 * `PptxDeck`: pembungkus `PresentationData` dengan nama berkas, riwayat undo (snapshot bytes), status ubah, dan laporan baca (log).
 * Seluruh pembacaan/penulisan isi slide dilakukan langsung lewat API `@office-kit/pptx`.
 */
import * as P from "@office-kit/pptx";
import type { PresentationData, SlideData } from "@office-kit/pptx";

export type LogLevel = "info" | "warn" | "error";
export interface LogEntry { level: LogLevel; key: string; params?: Record<string, string | number>; time: number }
export interface HistEntry { label: string; at: number; bytes: Uint8Array }

export class PptxLoadError extends Error {
  constructor(public code: "empty" | "legacy-ppt" | "encrypted" | "not-zip" | "parse", message: string, public bytes?: Uint8Array) { super(message); }
}

export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export class PptxDeck {
  pres: PresentationData;
  fileName: string;
  originalBytes: Uint8Array;
  log: LogEntry[] = [];
  hist: HistEntry[] = [];
  histIdx = -1;
  maxHistory = 100;
  modified = false;
  private savedIdx = 0;
  private queue: Promise<void> = Promise.resolve();
  /** Berubah setiap kali `pres` diganti (undo/redo/buka) — UI memakainya untuk membuang cache DOM. */
  generation = 0;

  constructor(pres: PresentationData, fileName: string, bytes: Uint8Array) {
    this.pres = pres;
    this.fileName = fileName;
    this.originalBytes = bytes;
  }

  static async open(bytes: Uint8Array, fileName: string): Promise<PptxDeck> {
    if (!bytes || bytes.length === 0) throw new PptxLoadError("empty", "File kosong");
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
      let code: "legacy-ppt" | "encrypted" = "legacy-ppt";
      try {
        const { cfbSummary } = await import("../office-shared/ole-core");
        const s = cfbSummary(bytes);
        if (s.streams.some(x => /EncryptedPackage|EncryptionInfo/i.test(x))) code = "encrypted";
      } catch { /* abaikan */ }
      throw new PptxLoadError(code, code === "encrypted" ? "Presentasi terenkripsi (password)" : "Format .ppt biner (PowerPoint 97–2003) tidak didukung", bytes);
    }
    if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new PptxLoadError("not-zip", "Bukan berkas PPTX (ZIP/OPC)", bytes);
    let pres: PresentationData;
    try { pres = await P.loadPresentation(bytes); } catch (e) { throw new PptxLoadError("parse", e instanceof Error ? e.message : String(e), bytes); }
    const d = new PptxDeck(pres, fileName, bytes);
    await d.snapshot("open", true);
    d.buildReport();
    return d;
  }

  static async fromPresentation(pres: PresentationData, fileName: string): Promise<PptxDeck> {
    const bytes = await P.savePresentation(pres);
    const d = new PptxDeck(pres, fileName, bytes);
    await d.snapshot("open", true);
    d.buildReport();
    return d;
  }

  get slides(): readonly SlideData[] { return P.getSlides(this.pres); }
  get canUndo() { return this.histIdx > 0; }
  get canRedo() { return this.histIdx < this.hist.length - 1; }

  // ───────── riwayat ─────────

  private async snapshot(label: string, init = false, merge?: string) {
    const bytes = await P.savePresentation(this.pres);
    const now = Date.now();
    if (!init) this.modified = true;
    const last = this.hist[this.histIdx];
    if (!init && merge && last && last.label === merge && now - last.at < 1500 && this.histIdx === this.hist.length - 1) {
      this.hist[this.histIdx] = { label: merge, at: now, bytes };
      return;
    }
    this.hist.length = this.histIdx + 1;
    this.hist.push({ label: merge ?? label, at: now, bytes });
    this.histIdx = this.hist.length - 1;
    this.trim();
  }
  private trim() {
    const total = this.hist.reduce((a, h) => a + h.bytes.length, 0);
    const max = total > 400_000_000 ? Math.min(this.maxHistory, 15) : this.maxHistory;
    const keep = Math.max(2, max + 1);
    while (this.hist.length > keep) { this.hist.shift(); this.histIdx--; this.savedIdx--; }
  }
  setMaxHistory(n: number) { this.maxHistory = Math.max(1, Math.floor(n)); this.trim(); }

  /** Catat keadaan saat ini (serial; aman dipanggil beruntun). */
  commit(label: string, merge?: string): Promise<void> {
    this.modified = true;
    this.queue = this.queue.then(() => this.snapshot(label, false, merge)).catch(() => { /* log di UI */ });
    return this.queue;
  }
  async flushQueue() { await this.queue; }

  async restore(idx: number): Promise<boolean> {
    await this.queue;
    if (idx < 0 || idx >= this.hist.length || idx === this.histIdx) return false;
    this.pres = await P.loadPresentation(this.hist[idx].bytes);
    this.histIdx = idx;
    this.modified = idx !== this.savedIdx;
    this.generation++;
    return true;
  }
  undo() { return this.restore(this.histIdx - 1); }
  redo() { return this.restore(this.histIdx + 1); }
  markSaved() { this.savedIdx = this.histIdx; this.modified = false; }

  async toBytes(): Promise<Uint8Array> { await this.queue; return P.savePresentation(this.pres); }
  async toBlob(): Promise<Blob> { return new Blob([(await this.toBytes()) as BlobPart], { type: PPTX_MIME }); }

  // ───────── log & statistik ─────────

  addLog(level: LogLevel, key: string, params?: Record<string, string | number>) {
    if (this.log.some(l => l.level === level && l.key === key && JSON.stringify(l.params) === JSON.stringify(params))) return;
    this.log.push({ level, key, params, time: Date.now() });
  }

  buildReport() {
    const L = (level: LogLevel, key: string, params?: Record<string, string | number>) => this.addLog(level, key, params);
    const pres = this.pres;
    L("info", "log.loaded", { name: this.fileName, size: this.originalBytes.length });
    const sum = P.getPresentationSummary(pres);
    L("info", "log.summary", { slides: sum.slideCount, shapes: sum.totalShapes, layouts: sum.layoutCount, parts: sum.partCount });
    const k = sum.shapesByKind;
    L("info", "log.kinds", { shape: k.shape, picture: k.picture, group: k.group, frame: k.graphicFrame, connector: k.connector });
    if (sum.hiddenSlideCount) L("info", "log.hidden", { n: sum.hiddenSlideCount });
    if (sum.sectionCount) L("info", "log.sections", { n: sum.sectionCount });
    if (P.getPresentationTheme(pres)) L("info", "log.theme", { name: sum.themeName ?? "-" });
    const parts = P.listPackageParts(pres).map(p => p.name);
    const count = (re: RegExp) => parts.filter(n => re.test(n)).length;
    const charts = count(/^\/ppt\/charts\/chart\d+\.xml$/);
    if (charts) L("info", "log.charts", { n: charts });
    const diagrams = count(/^\/ppt\/diagrams\/data\d*\.xml$/);
    if (diagrams) L("warn", "log.diagrams", { n: diagrams });
    const ole = parts.filter(n => /^\/ppt\/embeddings\//.test(n) && !/\.xlsx$/i.test(n));
    if (ole.length) L("info", "log.ole", { n: ole.length });
    const media = P.getMediaParts(pres);
    const av = media.filter(m => /^(video|audio)\//.test(m.contentType));
    if (av.length) L("info", "log.media", { n: av.length });
    if (parts.some(n => /vbaProject\.bin$/i.test(n))) L("warn", "log.macro");
    if (sum.hasComments) L("info", "log.comments", { n: P.getAllComments(pres).length });
    if (sum.hasAnimations) L("warn", "log.animations");
    if (parts.some(n => /^\/ppt\/notesSlides\//.test(n))) L("info", "log.notes", { n: P.getAllNotes(pres).length });
    if (parts.some(n => /^\/ppt\/tags\//.test(n) || /^\/customXml\//.test(n))) L("info", "log.custom");
    if (parts.some(n => /^\/ppt\/slideMasters\/slideMaster\d+\.xml$/.test(n)) && P.getSlideMasterCount(pres) > 1) L("info", "log.masters", { n: P.getSlideMasterCount(pres) });
    let custom = 0, frames = 0, tiff = 0;
    for (const e of P.getAllShapes(pres)) {
      try {
        if (P.getShapeKind(e.shape) === "shape" && P.getShapePreset(e.shape) === null && P.getShapeCustomGeometry(e.shape)) custom++;
        if (P.getShapeKind(e.shape) === "graphicFrame" && !P.isTableShape(e.shape) && !P.isChartShape(e.shape)) frames++;
        if (P.getShapeKind(e.shape) === "picture" && P.getShapeImageFormat(e.shape) === "tiff") tiff++;
      } catch { /* abaikan */ }
    }
    if (custom) L("info", "log.custom-geom", { n: custom });
    if (frames) L("warn", "log.frames", { n: frames });
    if (tiff) L("warn", "log.tiff", { n: tiff });
    try {
      for (const v of P.validatePresentation(pres)) L(v.severity === "error" ? "error" : "warn", "log.validation", { msg: v.message });
    } catch (e) { L("error", "log.validateFail", { msg: e instanceof Error ? e.message : String(e) }); }
  }
}
