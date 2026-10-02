/**
 * `DocxBook`: fasad atas dokumen DOCX. Library `@office-kit/docx` dipakai untuk membuka/menyimpan paket OPC, relasi, styles,
 * numbering, properti dokumen, validasi, dan pembuatan part gambar. Isi `<w:body>` dikelola sebagai pohon `XEl` (lihat docx-xml.ts)
 * dan ditulis balik sebagai blok `raw` lewat `flush()`.
 */
import {
  addBulletList, addHyperlink, addImageRun, addNumberedList, appProperties, coreProperties, numberingPart, openDocx, setCoreProperties, stylesPart, toUint8Array, validate,
  getParagraphNumbering, type Docx,
} from "@office-kit/docx";
import { NS, astBodyToXml, attr, cloneEl, descendAll, els, first, isEl, mk, num, parseXmlString, serialize, setAttr, setChild, val, type XEl, type XNode } from "./docx-xml";
import { StyleEngine } from "./docx-style";
import { NumberingEngine } from "./docx-numbering";
import { flatText, plainText } from "./docx-text";
import { maxDocPrId, sniffImageSize } from "./docx-image";

export type LogLevel = "info" | "warn" | "error";
export interface LogEntry { level: LogLevel; cat: string; key: string; params?: Record<string, string | number>; time?: number }

export class DocxLoadError extends Error {
  constructor(public code: "empty" | "legacy-doc" | "encrypted" | "not-zip" | "no-main" | "parse", message: string, public bytes?: Uint8Array) { super(message); }
}

export const REL = {
  image: `${NS.r}/image`, hyperlink: `${NS.r}/hyperlink`, header: `${NS.r}/header`, footer: `${NS.r}/footer`, footnotes: `${NS.r}/footnotes`, endnotes: `${NS.r}/endnotes`,
  comments: `${NS.r}/comments`, theme: `${NS.r}/theme`, settings: `${NS.r}/settings`, oleObject: `${NS.r}/oleObject`, package: `${NS.r}/package`, styles: `${NS.r}/styles`,
  numbering: `${NS.r}/numbering`, fontTable: `${NS.r}/fontTable`, vba: "http://schemas.microsoft.com/office/2006/relationships/vbaProject",
};

export interface Section {
  sectPr: XEl;
  w: number; h: number; mt: number; mr: number; mb: number; ml: number; hdr: number; ftr: number; gutter: number;
  orient: "portrait" | "landscape";
  type: string;
  titlePg: boolean;
  cols: { num: number; space: number };
  hdrRefs: Record<string, string>;
  ftrRefs: Record<string, string>;
}

export interface HistEntry { label: string; at: number; xml: string; size: number }
export interface DocStats { paragraphs: number; words: number; chars: number; charsNoSpaces: number; tables: number; images: number; headings: number; lines?: number }

export const PAGE_SIZES: Record<string, { w: number; h: number }> = {
  A3: { w: 16838, h: 23811 }, A4: { w: 11906, h: 16838 }, A5: { w: 8391, h: 11906 }, B5: { w: 10319, h: 14571 }, Letter: { w: 12240, h: 15840 }, Legal: { w: 12240, h: 20160 }, Executive: { w: 10440, h: 15120 },
};

function readSect(sp: XEl): Section {
  const pg = first(sp, "pgSz");
  const pm = first(sp, "pgMar");
  const w = num(attr(pg, "w")) ?? 12240, h = num(attr(pg, "h")) ?? 15840;
  const g = (n: string, d: number) => num(attr(pm, n)) ?? d;
  const cols = first(sp, "cols");
  const refs = (local: string) => { const o: Record<string, string> = {}; for (const r of els(sp, local)) { const id = attr(r, "id"); if (id) o[attr(r, "type") ?? "default"] = id; } return o; };
  return {
    sectPr: sp, w, h, mt: g("top", 1440), mr: g("right", 1440), mb: g("bottom", 1440), ml: g("left", 1440), hdr: g("header", 708), ftr: g("footer", 708), gutter: g("gutter", 0),
    orient: attr(pg, "orient") === "landscape" || w > h ? "landscape" : "portrait",
    type: val(sp, "type") ?? "nextPage",
    titlePg: !!first(sp, "titlePg"),
    cols: { num: num(attr(cols, "num")) ?? 1, space: num(attr(cols, "space")) ?? 720 },
    hdrRefs: refs("headerReference"), ftrRefs: refs("footerReference"),
  };
}

const DEFAULT_SECT = (): XEl => mk("sectPr", undefined, [mk("pgSz", { w: 12240, h: 15840 }), mk("pgMar", { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708, gutter: 0 })]);

/** Telusuri blok (p, tbl, sdt) beserta induknya. */
export function walkBlocks(parent: XEl, cb: (el: XEl, parent: XEl) => void | "skip") {
  for (const c of [...parent.children]) {
    if (!isEl(c)) continue;
    const l = c.name.local;
    if (l === "p") cb(c, parent);
    else if (l === "tbl") {
      if (cb(c, parent) === "skip") continue;
      for (const tr of els(c, "tr")) { cb(tr, c); for (const tc of els(tr, "tc")) { cb(tc, tr); walkBlocks(tc, cb); } }
    } else if (l === "sdt") {
      const sc = first(c, "sdtContent");
      if (sc) { cb(sc, c); walkBlocks(sc, cb); }
    }
  }
}

export class DocxBook {
  doc!: Docx;
  body!: XEl;
  sectPr?: XEl;
  styles!: StyleEngine;
  numbering!: NumberingEngine;
  fileName: string;
  originalBytes: Uint8Array;
  log: LogEntry[] = [];
  hist: HistEntry[] = [];
  histIdx = -1;
  maxHistory = 100;
  private parents = new WeakMap<XEl, XEl>();
  private imgUrls = new Map<string, string>();
  private hfCache = new Map<string, XEl | null>();
  private notesCache = new Map<string, Map<string, XEl>>();
  private settingsEl: XEl | null | undefined;
  /** Berubah sejak dibuka / disimpan terakhir. */
  modified = false;
  private savedIdx = 0;
  ole: { relId: string; part: string; progId?: string }[] = [];

  constructor(doc: Docx, fileName: string, bytes: Uint8Array) {
    this.fileName = fileName;
    this.originalBytes = bytes;
    this.attach(doc);
  }

  /** Buka dari bytes. Melempar `DocxLoadError` untuk berkas non-ZIP / .doc biner / terenkripsi. */
  static async open(bytes: Uint8Array, fileName: string): Promise<DocxBook> {
    if (!bytes || bytes.length === 0) throw new DocxLoadError("empty", "File kosong");
    const sig = (i: number) => bytes[i];
    if (sig(0) === 0xd0 && sig(1) === 0xcf && sig(2) === 0x11 && sig(3) === 0xe0) {
      let code: "legacy-doc" | "encrypted" = "legacy-doc";
      try {
        const { cfbSummary } = await import("./docx-ole");
        const s = cfbSummary(bytes);
        if (s.streams.some(n => /EncryptedPackage|EncryptionInfo/i.test(n))) code = "encrypted";
      } catch { /* abaikan */ }
      throw new DocxLoadError(code, code === "encrypted" ? "Dokumen terenkripsi (password)" : "Format .doc biner (Word 97–2003) tidak didukung", bytes);
    }
    if (!(sig(0) === 0x50 && sig(1) === 0x4b)) throw new DocxLoadError("not-zip", "Bukan berkas DOCX (ZIP/OPC)", bytes);
    let doc: Docx;
    try { doc = openDocx(bytes); } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new DocxLoadError(/main WordprocessingML/i.test(msg) ? "no-main" : "parse", msg, bytes);
    }
    const b = new DocxBook(doc, fileName, bytes);
    b.buildLoadReport();
    return b;
  }

  /** Bungkus Docx yang dibuat dengan `createDocx` (mis. sampel). */
  static fromDocx(doc: Docx, fileName: string): DocxBook {
    const bytes = toUint8Array(doc);
    const b = new DocxBook(doc, fileName, bytes);
    b.buildLoadReport();
    return b;
  }

  private attach(doc: Docx) {
    this.doc = doc;
    const { body, sectPr } = astBodyToXml(doc.document.body);
    this.body = body;
    this.sectPr = sectPr;
    this.rebuildEngines();
    this.reindex();
    this.checkpoint("open", true);
  }

  rebuildEngines() {
    const sp = stylesPart(this.doc);
    const themePart = this.relsOf(this.doc.partName).find(r => r.type === REL.theme);
    const themeXml = themePart ? this.partText(this.resolve(this.doc.partName, themePart.target)) : undefined;
    this.styles = new StyleEngine(sp ? { docDefaults: sp.docDefaults as unknown as XEl | undefined, styles: sp.styles as unknown as XEl[] } : undefined, themeXml);
    const np = numberingPart(this.doc);
    this.numbering = new NumberingEngine(np ? { abstractNums: np.abstractNums as unknown as XEl[], nums: np.nums as unknown as XEl[] } : undefined, this.styles.theme);
  }

  // ───────── paket ─────────

  part(name: string) { return this.doc.opc.parts.get(name); }
  partText(name: string): string | undefined { const p = this.part(name); return p ? new TextDecoder("utf-8").decode(p.data) : undefined; }
  partNames(): string[] { return [...this.doc.opc.parts.keys()]; }
  relsOf(source: string) { return this.doc.opc.relsBySource.get(source)?.relationships ?? []; }
  rel(id: string, source = this.doc.partName) { return this.relsOf(source).find(r => r.id === id); }
  /** Resolusi target relatif → nama part absolut. */
  resolve(source: string, target: string): string {
    if (target.startsWith("/")) return target;
    const base = source.slice(0, source.lastIndexOf("/") + 1);
    const parts = (base + target).split("/");
    const out: string[] = [];
    for (const p of parts) { if (p === "..") out.pop(); else if (p && p !== ".") out.push(p); }
    return "/" + out.join("/");
  }
  mediaPart(relId: string, source = this.doc.partName) {
    const r = this.rel(relId, source);
    if (!r || r.targetMode === "External") return undefined;
    return this.part(this.resolve(source, r.target));
  }
  imageUrl(relId: string, source = this.doc.partName): { url: string; type: string; name: string } | undefined {
    const p = this.mediaPart(relId, source);
    if (!p) return undefined;
    let url = this.imgUrls.get(p.name);
    if (!url) {
      url = URL.createObjectURL(new Blob([p.data as BlobPart], { type: p.contentType }));
      this.imgUrls.set(p.name, url);
    }
    return { url, type: p.contentType, name: p.name };
  }
  imageDataUri(relId: string, source = this.doc.partName): string | undefined {
    const p = this.mediaPart(relId, source);
    if (!p) return undefined;
    let bin = "";
    const d = p.data;
    for (let i = 0; i < d.length; i += 0x8000) bin += String.fromCharCode(...d.subarray(i, i + 0x8000));
    return `data:${p.contentType};base64,${btoa(bin)}`;
  }
  dispose() { for (const u of this.imgUrls.values()) URL.revokeObjectURL(u); this.imgUrls.clear(); }
  /** Cabut URL object gambar (setelah gambar ditambahkan/diganti agar tidak basi). */
  forgetUrl(partName: string) { const u = this.imgUrls.get(partName); if (u) { URL.revokeObjectURL(u); this.imgUrls.delete(partName); } }

  private xmlPart(name: string | undefined): XEl | undefined {
    if (!name) return undefined;
    const t = this.partText(name);
    if (!t) return undefined;
    try { return parseXmlString(t); } catch { return undefined; }
  }
  settings(): XEl | undefined {
    if (this.settingsEl === undefined) {
      const r = this.relsOf(this.doc.partName).find(x => x.type === REL.settings);
      this.settingsEl = r ? this.xmlPart(this.resolve(this.doc.partName, r.target)) ?? null : null;
    }
    return this.settingsEl ?? undefined;
  }
  evenAndOdd(): boolean { return !!first(this.settings(), "evenAndOddHeaders"); }
  defaultTab(): number { return num(val(this.settings(), "defaultTabStop")) ?? 720; }
  compatMode(): number | undefined {
    const compat = first(this.settings(), "compat");
    for (const s of els(compat ?? mk("x"), "compatSetting")) if (attr(s, "name") === "compatibilityMode") return num(attr(s, "val"));
    return undefined;
  }

  /** Isi header/footer (`<w:hdr>`/`<w:ftr>`) untuk rId. */
  hf(relId: string): XEl | undefined {
    if (this.hfCache.has(relId)) return this.hfCache.get(relId) ?? undefined;
    const r = this.rel(relId);
    const root = r ? this.xmlPart(this.resolve(this.doc.partName, r.target)) : undefined;
    this.hfCache.set(relId, root ?? null);
    return root;
  }
  hfPart(relId: string): string | undefined { const r = this.rel(relId); return r ? this.resolve(this.doc.partName, r.target) : undefined; }
  notes(kind: "footnotes" | "endnotes"): Map<string, XEl> {
    const hit = this.notesCache.get(kind);
    if (hit) return hit;
    const m = new Map<string, XEl>();
    const r = this.relsOf(this.doc.partName).find(x => x.type === (kind === "footnotes" ? REL.footnotes : REL.endnotes));
    const root = r ? this.xmlPart(this.resolve(this.doc.partName, r.target)) : undefined;
    if (root) for (const n of els(root)) { const id = attr(n, "id"); if (id !== undefined) m.set(id, n); }
    this.notesCache.set(kind, m);
    return m;
  }
  comments(): { id: string; author: string; date?: string; initials?: string; text: string }[] {
    const r = this.relsOf(this.doc.partName).find(x => x.type === REL.comments);
    const root = r ? this.xmlPart(this.resolve(this.doc.partName, r.target)) : undefined;
    if (!root) return [];
    return els(root, "comment").map(c => ({ id: attr(c, "id") ?? "", author: attr(c, "author") ?? "", date: attr(c, "date"), initials: attr(c, "initials"), text: descendAll(c, "t").map(t => t.children.map(k => (k.kind === "text" ? k.value : "")).join("")).join("") }));
  }

  // ───────── struktur ─────────

  reindex() {
    this.parents = new WeakMap();
    walkBlocks(this.body, (el, parent) => { this.parents.set(el, parent); });
  }
  parentOf(el: XEl): XEl | undefined { return this.parents.get(el); }
  setParent(el: XEl, parent: XEl) { this.parents.set(el, parent); }

  *paragraphs(root: XEl = this.body): Generator<{ p: XEl; parent: XEl }> {
    const out: { p: XEl; parent: XEl }[] = [];
    walkBlocks(root, (el, parent) => { if (el.name.local === "p") out.push({ p: el, parent }); });
    yield* out;
  }
  tables(root: XEl = this.body): XEl[] {
    const out: XEl[] = [];
    walkBlocks(root, el => { if (el.name.local === "tbl") out.push(el); });
    return out;
  }

  sections(): Section[] {
    const out: Section[] = [];
    let prev: Section | undefined;
    const push = (sp: XEl) => {
      const s = readSect(sp);
      if (prev) {
        if (!Object.keys(s.hdrRefs).length) s.hdrRefs = { ...prev.hdrRefs };
        if (!Object.keys(s.ftrRefs).length) s.ftrRefs = { ...prev.ftrRefs };
      }
      out.push(s); prev = s;
    };
    for (const { p } of this.paragraphs()) { const sp = first(first(p, "pPr"), "sectPr"); if (sp) push(sp); }
    push(this.sectPr ?? (this.sectPr = DEFAULT_SECT()));
    return out;
  }

  /** Atur ukuran halaman / margin untuk semua section (atau hanya terakhir). */
  setPage(opts: { size?: string | { w: number; h: number }; orient?: "portrait" | "landscape"; margins?: Partial<{ top: number; right: number; bottom: number; left: number; header: number; footer: number; gutter: number }>; allSections?: boolean }) {
    const targets = opts.allSections === false ? [this.sections().pop()!.sectPr] : this.sections().map(s => s.sectPr);
    for (const sp of targets) {
      let pg = first(sp, "pgSz");
      if (!pg) { pg = mk("pgSz", { w: 12240, h: 15840 }); setChild(sp, pg); }
      let w = num(attr(pg, "w")) ?? 12240, h = num(attr(pg, "h")) ?? 15840;
      if (opts.size) { const s = typeof opts.size === "string" ? PAGE_SIZES[opts.size] : opts.size; if (s) { w = s.w; h = s.h; } }
      const orient = opts.orient ?? (w > h ? "landscape" : "portrait");
      const lo = Math.max(w, h), sh = Math.min(w, h);
      if (opts.orient || opts.size) { if (orient === "landscape") { w = lo; h = sh; } else { w = sh; h = lo; } }
      setAttr(pg, "w", String(w)); setAttr(pg, "h", String(h)); setAttr(pg, "orient", orient === "landscape" ? "landscape" : undefined);
      if (opts.margins) {
        let pm = first(sp, "pgMar");
        if (!pm) { pm = mk("pgMar", { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708, gutter: 0 }); setChild(sp, pm); }
        for (const [k, v] of Object.entries(opts.margins)) if (v !== undefined) setAttr(pm, k, String(Math.round(v)));
      }
    }
  }

  // ───────── gambar & tautan (memakai library untuk part/relasi) ─────────

  /** Tambahkan part gambar + relasi, kembalikan elemen `<w:drawing>` inline siap sisip. */
  createImageDrawing(bytes: Uint8Array, widthEmu: number, heightEmu: number, opts?: { name?: string; altText?: string; contentType?: string }): XEl {
    const run = addImageRun(this.doc, bytes, { widthEmu, heightEmu, name: opts?.name, altText: opts?.altText, contentType: opts?.contentType });
    const piece = run.pieces[0];
    if (!piece || piece.kind !== "drawing") throw new Error("drawing expected");
    const drawing = piece.node as unknown as XEl;
    const dp = descendAll(drawing, "docPr")[0];
    if (dp) setAttr(dp, "id", String(maxDocPrId(this.body) + 1), "", "");
    return drawing;
  }
  /** Daftarkan hubungan hyperlink eksternal dan kembalikan rId. */
  linkRel(url: string): string {
    const before = this.doc.document.body.blocks.length;
    const p = addHyperlink(this.doc, url, "x");
    this.doc.document.body.blocks.length = before; // buang paragraf sementara
    const node = p.children[0];
    const el = node.kind === "raw" ? (node.node as unknown as XEl) : undefined;
    return attr(el, "id") ?? "";
  }
  setLinkTarget(relId: string, url: string) { const r = this.rel(relId); if (r) r.target = url; }
  /** Pastikan definisi daftar tersedia; mengembalikan numId. */
  ensureList(kind: "bullet" | "number"): number {
    const found = this.numbering.findNumId(kind);
    if (found !== undefined) return found;
    const before = this.doc.document.body.blocks.length;
    const ps = kind === "bullet" ? addBulletList(this.doc, ["x"]) : addNumberedList(this.doc, ["x"]);
    const info = getParagraphNumbering(ps[0]);
    this.doc.document.body.blocks.length = before;
    this.rebuildEngines();
    return info?.numId ?? 1;
  }

  // ───────── riwayat (undo/redo) ─────────

  private snapshot(): string {
    const wrap: XEl = { ...mk("body"), attrs: this.doc.document.rootAttrs.map(a => ({ ...a, name: { ...a.name } })) as XEl["attrs"], children: [...this.body.children, ...(this.sectPr ? [this.sectPr] : [])], selfClosing: false };
    return serialize(wrap);
  }
  /** Catat keadaan saat ini. `merge` = gabungkan dengan entri terakhir bila label sama (mis. mengetik). */
  checkpoint(label: string, init = false, merge?: string) {
    const xml = this.snapshot();
    const now = Date.now();
    if (!init) this.modified = true;
    const last = this.hist[this.histIdx];
    if (!init && merge && last && last.label === merge && now - last.at < 1800 && this.histIdx === this.hist.length - 1) {
      this.hist[this.histIdx] = { label: merge, at: now, xml, size: xml.length };
      return;
    }
    this.hist.length = this.histIdx + 1;
    this.hist.push({ label: merge ?? label, at: now, xml, size: xml.length });
    this.histIdx = this.hist.length - 1;
    this.trim();
  }
  private trim() {
    const heavy = this.hist.reduce((a, h) => a + h.size, 0) > 60_000_000;
    const max = heavy ? Math.min(this.maxHistory, 20) : this.maxHistory;
    const keep = Math.max(2, max + 1);
    while (this.hist.length > keep) { this.hist.shift(); this.histIdx--; this.savedIdx--; }
  }
  setMaxHistory(n: number) { this.maxHistory = Math.max(1, Math.floor(n)); this.trim(); }
  get canUndo() { return this.histIdx > 0; }
  get canRedo() { return this.histIdx < this.hist.length - 1; }
  /** Pindah ke entri riwayat `idx`; mengembalikan true bila berubah. */
  restore(idx: number): boolean {
    if (idx < 0 || idx >= this.hist.length || idx === this.histIdx) return false;
    const wrap = parseXmlString(this.hist[idx].xml);
    const kids = wrap.children.filter(isEl) as XEl[];
    const last = kids[kids.length - 1];
    if (last && last.name.local === "sectPr") { this.sectPr = last; kids.pop(); } else this.sectPr = this.sectPr ?? DEFAULT_SECT();
    this.body = mk("body", undefined, kids);
    this.histIdx = idx;
    this.modified = idx !== this.savedIdx;
    this.reindex();
    return true;
  }
  undo() { return this.restore(this.histIdx - 1); }
  redo() { return this.restore(this.histIdx + 1); }
  markSaved() { this.savedIdx = this.histIdx; this.modified = false; }

  // ───────── simpan ─────────

  flush() {
    const b = this.doc.document.body;
    b.blocks = this.body.children.filter(isEl).map(node => ({ kind: "raw" as const, node: node as never }));
    b.extras = [];
    (b as { sectPr?: unknown }).sectPr = this.sectPr as never;
    this.doc.dirty = true;
  }
  toBytes(): Uint8Array { this.flush(); return toUint8Array(this.doc); }
  toBlob(): Blob { return new Blob([this.toBytes() as BlobPart], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }); }
  validate() { this.flush(); return validate(this.doc); }

  coreProps() { return coreProperties(this.doc); }
  appProps() { return appProperties(this.doc); }
  setCore(p: Parameters<typeof setCoreProperties>[1]) { setCoreProperties(this.doc, p); this.modified = true; }

  // ───────── statistik ─────────

  stats(): DocStats {
    let paragraphs = 0, words = 0, chars = 0, charsNoSpaces = 0, headings = 0;
    for (const { p } of this.paragraphs()) {
      const t = plainText(p);
      paragraphs++;
      chars += t.length; charsNoSpaces += t.replace(/\s/g, "").length;
      const m = t.match(/\S+/g);
      if (m) words += m.length;
      const sid = val(first(p, "pPr"), "pStyle");
      if (this.styles.isHeading(sid) !== undefined) headings++;
    }
    return { paragraphs, words, chars, charsNoSpaces, tables: this.tables().length, images: descendAll(this.body, "drawing").length + descendAll(this.body, "pict").length, headings };
  }

  /** Hitung kemunculan nama elemen (prefix:local) di body — dasar laporan fitur. */
  census(): Map<string, number> {
    const m = new Map<string, number>();
    const walk = (e: XEl) => {
      for (const c of e.children) if (isEl(c)) { const k = c.name.prefix ? `${c.name.prefix}:${c.name.local}` : c.name.local; m.set(k, (m.get(k) ?? 0) + 1); walk(c); }
    };
    walk(this.body);
    return m;
  }

  addLog(level: LogLevel, cat: string, key: string, params?: Record<string, string | number>) {
    // gabungkan duplikat identik
    const dup = this.log.find(l => l.level === level && l.key === key && JSON.stringify(l.params) === JSON.stringify(params));
    if (dup) return;
    this.log.push({ level, cat, key, params, time: Date.now() });
  }

  /** Laporan awal: apa yang berhasil dibaca, apa yang tidak dirender / dilewati. */
  buildLoadReport() {
    const L = (level: LogLevel, cat: string, key: string, params?: Record<string, string | number>) => this.addLog(level, cat, key, params);
    const names = this.partNames();
    L("info", "file", "log.loaded", { name: this.fileName, size: this.originalBytes.length });
    L("info", "file", "log.parts", { n: names.length });
    L("info", "file", "log.mainPart", { part: this.doc.partName });
    const st = this.styles.list();
    L("info", "styles", "log.styles", { n: st.length });
    if (stylesPart(this.doc)) L("info", "styles", "log.theme", { n: Object.keys(this.styles.theme.colors).length });
    else L("warn", "styles", "log.noStyles");
    const np = numberingPart(this.doc);
    if (np) L("info", "numbering", "log.numbering", { abstract: np.abstractNums.length, nums: np.nums.length });
    const sections = this.sections();
    L("info", "layout", "log.sections", { n: sections.length });
    const c = this.census();
    const cnt = (k: string) => c.get(k) ?? 0;
    const s = this.stats();
    L("info", "content", "log.content", { paragraphs: s.paragraphs, tables: s.tables, words: s.words });
    const inl = cnt("wp:inline"), anc = cnt("wp:anchor");
    if (inl + anc > 0) L("info", "images", "log.images", { inline: inl, floating: anc });
    const media = names.filter(n => n.startsWith("/word/media/"));
    const badFmt = media.filter(n => /\.(emf|wmf|tif|tiff|wdp|jxr|pict)$/i.test(n));
    if (badFmt.length) L("warn", "images", "log.imageFormat", { n: badFmt.length, list: badFmt.map(n => n.split(".").pop()).filter((v, i, a) => a.indexOf(v) === i).join(", ") });
    const hdrs = this.relsOf(this.doc.partName).filter(r => r.type === REL.header).length;
    const ftrs = this.relsOf(this.doc.partName).filter(r => r.type === REL.footer).length;
    if (hdrs || ftrs) L("info", "layout", "log.headerFooter", { h: hdrs, f: ftrs });
    const fn = Math.max(0, this.notes("footnotes").size - 2), en = Math.max(0, this.notes("endnotes").size - 2);
    if (fn || en) L("info", "content", "log.notes", { fn, en });
    const cm = this.comments().length;
    if (cm) L("info", "content", "log.comments", { n: cm });
    const ins = cnt("w:ins"), del = cnt("w:del");
    if (ins + del) L("warn", "review", "log.revisions", { ins, del });
    const fields = cnt("w:fldSimple") + cnt("w:instrText");
    if (fields) L("info", "content", "log.fields", { n: fields });
    if (cnt("w:hyperlink")) L("info", "content", "log.links", { n: cnt("w:hyperlink") });
    if (cnt("w:sdt")) L("info", "content", "log.sdt", { n: cnt("w:sdt") });
    if (cnt("w:bookmarkStart")) L("info", "content", "log.bookmarks", { n: cnt("w:bookmarkStart") });
    // tidak dirender / terbatas
    if (cnt("m:oMath") + cnt("m:oMathPara")) L("warn", "unsupported", "log.math", { n: cnt("m:oMath") + cnt("m:oMathPara") });
    const charts = names.filter(n => n.startsWith("/word/charts/") && n.endsWith(".xml")).length;
    if (charts) L("warn", "unsupported", "log.charts", { n: charts });
    if (names.some(n => n.startsWith("/word/diagrams/"))) L("warn", "unsupported", "log.diagrams");
    const wps = cnt("wps:wsp");
    if (wps) L("warn", "unsupported", "log.shapes", { n: wps });
    if (cnt("v:shape") + cnt("v:rect") + cnt("v:oval") + cnt("v:line")) L("warn", "unsupported", "log.vml", { n: cnt("v:shape") + cnt("v:rect") + cnt("v:oval") + cnt("v:line") });
    if (cnt("w:framePr")) L("warn", "unsupported", "log.frames", { n: cnt("w:framePr") });
    if (descendAll(this.body, "tblpPr").length) L("warn", "unsupported", "log.floatingTables");
    if (sections.some(x => x.cols.num > 1)) L("warn", "unsupported", "log.columns");
    if (cnt("w:ruby")) L("warn", "unsupported", "log.ruby");
    if (descendAll(this.body, "textDirection").length) L("warn", "unsupported", "log.textDir");
    if (cnt("w:fldChar") && descendAll(this.body, "instrText").some(i => /\bTOC\b|\bINDEX\b|\bSEQ\b|\bREF\b|\bPAGEREF\b/.test(i.children.map(k => (k.kind === "text" ? k.value : "")).join("")))) L("info", "content", "log.fieldCache");
    // makro, OLE, ActiveX, tanda tangan
    const ct = this.doc.opc.contentTypes;
    const macroEnabled = ct.overrides.some(o => /macroEnabled/i.test(o.contentType));
    const vba = names.find(n => /vbaProject\.bin$/i.test(n));
    if (macroEnabled || vba) L("warn", "security", "log.macro", { part: vba ?? "-" });
    const emb = names.filter(n => n.startsWith("/word/embeddings/"));
    if (emb.length) L("info", "ole", "log.ole", { n: emb.length });
    if (names.some(n => n.startsWith("/word/activeX/"))) L("warn", "security", "log.activeX");
    if (names.some(n => n.startsWith("/_xmlsignatures/"))) L("warn", "security", "log.signature");
    if (names.some(n => n.startsWith("/customXml/"))) L("info", "file", "log.customXml");
    const cm2 = this.compatMode();
    if (cm2 !== undefined && cm2 < 15) L("warn", "layout", "log.compat", { mode: cm2 });
    // validasi paket oleh library
    try {
      for (const v of this.validate()) L(v.level === "error" ? "error" : "warn", "validation", "log.validation", { code: v.code, msg: v.message });
    } catch (e) { L("error", "validation", "log.validateFail", { msg: e instanceof Error ? e.message : String(e) }); }
  }

  /** Teks dokumen datar (untuk debug/ekspor cepat). */
  plain(): string { const out: string[] = []; for (const { p } of this.paragraphs()) out.push(flatText(p)); return out.join("\n"); }
}

export { sniffImageSize, cloneEl, setChild };
export type { XNode };
