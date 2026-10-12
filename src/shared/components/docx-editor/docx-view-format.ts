/** DocxView: docx-view-format.ts — fungsi bagian dari kelas (`this: DocxView`), dipasang di kelas sebagai properti agar API publik tidak berubah. */
import { type DocxFormatTarget, type DocxNavTarget, DOCX_FORMAT_KEYS, DOCX_TABLE_OPS } from "./docx-view-shared";
import type { DocxView } from "./docx-view";
import { first, mk, val, type XEl } from "./docx-xml";
import { condForParagraph } from "./docx-render";
import { applyMarkPatch, applyParaPatch, applyRunPatch, flatLength, flatText, insertText, normalize, runsInRange, units, type PPatch, type RunPatch } from "./docx-text";
import { clearFormatRange, deleteBlock, insertParagraphAfter, transformText } from "./docx-ops";
import { buildGrid } from "./docx-table";
import { setSize as setSizeOp } from "./docx-image";
import { splitFormatKeys, type FormatProps, type FormatReport } from "../editor-kit/format";
import { compositeOver } from "../editor-kit/color-util";
import { mergeP, readP, type RProps, type TabStop } from "./docx-style";

export function runAt(this: DocxView, p: XEl, off: number): XEl | undefined {
  const us = units(p);
  return (us.find(u => u.start < off && off <= u.end) ?? us.find(u => u.start >= off && u.end > u.start))?.run;
}

export function runsOverlapping(this: DocxView, p: XEl, a: number, b: number): XEl[] {
  const out: XEl[] = [];
  for (const u of units(p)) if (u.end > a && u.start < b && !out.includes(u.run)) out.push(u.run);
  return out;
}

export function applyRunCmd(this: DocxView, label: string, pick: (all: RProps[], collapsed: boolean) => RunPatch | null) {
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
    if (s.b <= s.a) {
      // paragraf kosong (mis. sel kosong dalam seleksi sel): tandai paragraf agar teks berikutnya mewarisi format
      if (flatLength(s.p) === 0) { applyMarkPatch(s.p, patch); touched.add(s.p); }
      continue;
    }
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

export function toggleRun(this: DocxView, key: "b" | "i" | "strike" | "caps" | "smallCaps") {
  const prop: Record<string, keyof RProps> = { b: "b", i: "i", strike: "strike", caps: "caps", smallCaps: "smallCaps" };
  this.applyRunCmd("hist.format", st => ({ [key]: !st.every(r => r[prop[key]]) }) as RunPatch);
}

export function toggleUnderline(this: DocxView) { this.applyRunCmd("hist.format", st => ({ u: st.every(r => r.u && r.u !== "none") ? "none" : "single" })); }

export function setUnderline(this: DocxView, style: string) { this.applyRunCmd("hist.format", () => ({ u: style })); }

export function setVert(this: DocxView, v: "superscript" | "subscript") { this.applyRunCmd("hist.format", st => ({ vert: st.every(r => r.vert === v) ? "baseline" : v })); }

export function setColor(this: DocxView, c: string | null) { this.applyRunCmd("hist.color", () => ({ color: c })); }

export function setHighlight(this: DocxView, c: string | null) { this.applyRunCmd("hist.color", () => ({ highlight: c })); }

export function setFont(this: DocxView, name: string | null) { this.applyRunCmd("hist.font", () => ({ font: name })); }

export function setSize(this: DocxView, pt: number | null) { this.applyRunCmd("hist.font", () => ({ sz: pt === null ? null : Math.round(pt * 2) })); }

export function bumpSize(this: DocxView, delta: number) { this.applyRunCmd("hist.font", st => { const cur = (st[0]?.sz ?? 22) / 2; const steps = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72]; const i = steps.findIndex(x => x >= cur - 0.01); const nx = delta > 0 ? steps[Math.min(steps.length - 1, (i < 0 ? steps.length - 1 : steps[i] > cur + 0.01 ? i : i + 1))] : steps[Math.max(0, (i < 0 ? steps.length : i) - 1)]; return { sz: Math.round(nx * 2) }; }); }

export function setLetterSpacing(this: DocxView, tw: number | null) { this.applyRunCmd("hist.format", () => ({ spacing: tw })); }

export function clearFormat(this: DocxView) {
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

export function changeCase(this: DocxView, mode: "upper" | "lower" | "title") {
  const sp = this.spans();
  if (!sp.length || this.readonly) return;
  const fn = mode === "upper" ? (s: string) => s.toUpperCase() : mode === "lower" ? (s: string) => s.toLowerCase() : (s: string) => s.toLowerCase().replace(/(^|[\s(\["'])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());
  const sel = this.captureSel();
  for (const s of sp) { transformText(s.p, s.b > s.a ? s.a : 0, s.b > s.a ? s.b : flatLength(s.p), fn); this.rerenderPara(s.p); }
  this.restoreSel(sel); this.commit("hist.format");
}

/** Pilih target `format.apply`; false bila tidak ditemukan. */
export function selectFormatTarget(this: DocxView, t?: DocxFormatTarget): boolean {
  const book = this.book;
  if (!book) return false;
  if (!t || t.kind === "selection") return !!this.selPoints();
  const paras = [...book.paragraphs()].map(x => x.p);
  switch (t.kind) {
    case "all": {
      const body = paras.filter(p => book.parentOf(p) === book.body);
      if (!body.length) return false;
      this.restoreSel({ a: { p: body[0], off: 0 }, b: { p: body[body.length - 1], off: flatLength(body[body.length - 1]) } });
      return true;
    }
    case "paragraph": {
      const p1 = paras[Math.round(t.index) - 1], p2 = paras[Math.round(t.to ?? t.index) - 1];
      if (!p1 || !p2) return false;
      if (t.to === undefined && t.start !== undefined && t.end !== undefined) { this.selectRange(p1, Math.max(0, t.start), Math.min(flatLength(p1), t.end)); return true; }
      this.restoreSel({ a: { p: p1, off: 0 }, b: { p: p2, off: flatLength(p2) } });
      return true;
    }
    case "table": {
      const tbl = book.tables()[Math.round(t.index) - 1];
      if (!tbl) return false;
      const g = buildGrid(tbl);
      const clamp = (v: number | undefined, d: number, max: number) => Math.max(0, Math.min(max, (v === undefined ? d : Math.round(v) - 1)));
      const r1 = clamp(t.row, 0, g.rows.length - 1), c1 = clamp(t.col, 0, g.ncols - 1);
      const r2 = clamp(t.toRow ?? (t.row === undefined ? undefined : t.row), g.rows.length - 1, g.rows.length - 1), c2 = clamp(t.toCol ?? (t.col === undefined ? undefined : t.col), g.ncols - 1, g.ncols - 1);
      const first0 = g.map[r1]?.[c1]?.origin;
      const p = first0 ? this.firstParaOfCell(first0.el) : undefined;
      if (!p) return false;
      this.focusPara(p, 0, false);
      this.setCellSel(tbl, { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) });
      return true;
    }
    default: return this.gotoTarget(t as DocxNavTarget).ok;
  }
}

/**
 * `format.apply` — properti umum + khusus DOCX. Run → seleksi teks, paragraf → paragraf terpilih, `fill`/`valign`/`wrap` → sel bila target berupa
 * sel tabel (selain itu shading paragraf). Seluruh perubahan = satu langkah undo. Alfa dikomposit di atas putih (OOXML tak punya alfa warna teks/shading).
 */
export function formatApply(this: DocxView, props: FormatProps, target?: DocxFormatTarget): FormatReport {
  const { use, skipped } = splitFormatKeys(props, DOCX_FORMAT_KEYS);
  const book = this.book;
  const none = (): FormatReport => ({ applied: [], skipped: [...skipped, ...use], targets: 0 });
  if (!book || this.readonly || !use.length || !this.selectFormatTarget(target)) return none();
  const sp0 = this.spans();
  const targets = new Set(sp0.map(s => s.p)).size;
  const start = book.histIdx;
  const ok = new Set<string>();
  const has = (k: string) => use.includes(k) && props[k] !== undefined;
  const flat = (c: string | null | undefined, a?: number) => (c ? (a !== undefined && a < 1 ? compositeOver(c, a) : c) : null);

  const rp: RunPatch = {};
  const set = (keys: string[], fn: () => void) => { fn(); keys.forEach(k => ok.add(k)); };
  if (has("bold")) set(["bold"], () => { rp.b = !!props.bold; });
  if (has("italic")) set(["italic"], () => { rp.i = !!props.italic; });
  if (has("underline")) set(["underline"], () => { rp.u = props.underline ? "single" : "none"; });
  if (has("strike")) set(["strike"], () => { rp.strike = !!props.strike; });
  if (has("caps")) set(["caps"], () => { rp.caps = !!props.caps; });
  if (has("smallCaps")) set(["smallCaps"], () => { rp.smallCaps = !!props.smallCaps; });
  if (has("fontFamily")) set(["fontFamily"], () => { rp.font = (props.fontFamily as string | null) ?? null; });
  if (has("fontSize")) set(["fontSize"], () => { rp.sz = props.fontSize === null ? null : Math.round((props.fontSize as number) * 2); });
  if (has("color")) set(["color", ...(props.colorAlpha !== undefined ? ["colorAlpha"] : [])], () => { rp.color = flat(props.color as string | null, props.colorAlpha as number | undefined); });
  if (has("highlight")) set(["highlight"], () => { rp.highlight = (props.highlight as string | null) ?? null; });
  if (has("superscript")) set(["superscript"], () => { rp.vert = props.superscript ? "superscript" : "baseline"; });
  if (has("subscript")) set(["subscript"], () => { rp.vert = props.subscript ? "subscript" : "baseline"; });
  if (has("letterSpacing")) set(["letterSpacing"], () => { rp.spacing = props.letterSpacing === null ? null : Math.round((props.letterSpacing as number) * 20); });
  if (Object.keys(rp).length) this.applyRunCmd("hist.format", () => rp);

  const pp: PPatch = {};
  if (has("align")) set(["align"], () => { pp.jc = props.align === "justify" ? "both" : (props.align as string); });
  if (has("style")) set(["style"], () => { pp.style = (props.style as string | null) ?? null; });
  if (has("lineSpacing")) set(["lineSpacing"], () => { pp.line = Math.round((props.lineSpacing as number) * 240); pp.lineRule = "auto"; });
  if (has("spaceBefore")) set(["spaceBefore"], () => { pp.before = props.spaceBefore === null ? null : Math.round((props.spaceBefore as number) * 20); });
  if (has("spaceAfter")) set(["spaceAfter"], () => { pp.after = props.spaceAfter === null ? null : Math.round((props.spaceAfter as number) * 20); });
  if (has("indentLeft")) set(["indentLeft"], () => { pp.indLeft = props.indentLeft === null ? null : Math.round((props.indentLeft as number) * 20); });
  if (has("indentRight")) set(["indentRight"], () => { pp.indRight = props.indentRight === null ? null : Math.round((props.indentRight as number) * 20); });
  if (has("indentFirst")) set(["indentFirst"], () => { pp.indFirst = props.indentFirst === null ? null : Math.round((props.indentFirst as number) * 20); });
  if (has("keepNext")) set(["keepNext"], () => { pp.keepNext = !!props.keepNext; });
  if (has("pageBreakBefore")) set(["pageBreakBefore"], () => { pp.pageBreakBefore = !!props.pageBreakBefore; });
  const inCells = !!this.cellSel;
  if (has("stroke") && !inCells) set(["stroke"], () => { const s = props.stroke as { color?: string | null } | null; pp.borders = s === null || s?.color === null ? null : { top: s?.color ?? "000000", left: s?.color ?? "000000", bottom: s?.color ?? "000000", right: s?.color ?? "000000" }; });
  if (has("fill") && !inCells) set(["fill", ...(props.fillAlpha !== undefined ? ["fillAlpha"] : [])], () => { pp.shd = flat(props.fill as string | null, props.fillAlpha as number | undefined); });
  if (Object.keys(pp).length) this.paraCmd("hist.format", pp);

  if (inCells) {
    if (has("fill")) { this.table("shade", flat(props.fill as string | null, props.fillAlpha as number | undefined)); ok.add("fill"); if (props.fillAlpha !== undefined) ok.add("fillAlpha"); }
    if (has("stroke")) { const s = props.stroke as { color?: string | null; width?: number } | null; this.table("borders", { preset: "all", spec: s === null || s?.color === null ? null : { style: "single", sz: Math.max(2, Math.round((s?.width ?? 0.5) * 8)), color: (s?.color ?? "000000").replace("#", "") } }); ok.add("stroke"); }
  }
  if (this.tctx()) {
    if (has("valign")) { this.table("valign", props.valign === "middle" ? "center" : props.valign); ok.add("valign"); }
    if (has("wrap")) { this.table("noWrap", !props.wrap); ok.add("wrap"); }
  }
  if (has("link")) { this.setLink((props.link as string | null) || null); ok.add("link"); }
  book.squashHistory(start, "hist.format");
  if (inCells) this.clearCellSel();
  return { applied: use.filter(k => ok.has(k)), skipped: [...skipped, ...use.filter(k => !ok.has(k))], targets };
}

/** `format.get` — format di titik awal target/seleksi sebagai `FormatProps` umum. */
export function formatGet(this: DocxView, target?: DocxFormatTarget): FormatProps | undefined {
  const book = this.book;
  if (!book || !this.selectFormatTarget(target)) return undefined;
  const sp = this.spans();
  if (!sp.length) return undefined;
  const p = sp[0].p;
  const r = this.runResolved(p, this.runAt(p, sp[0].b > sp[0].a ? sp[0].a + 1 : sp[0].a));
  const pf = readP(first(p, "pPr"), book.styles.theme);
  return {
    bold: !!r.b, italic: !!r.i, underline: !!r.u && r.u !== "none", strike: !!r.strike, fontFamily: r.fAscii ?? null, fontSize: r.sz ? r.sz / 2 : null, color: r.color ? `#${r.color.replace("#", "")}` : null,
    highlight: r.highlight ?? null, align: pf.jc === "both" ? "justify" : (pf.jc as FormatProps["align"]) ?? "left", style: val(first(p, "pPr"), "pStyle") ?? null,
  };
}

// struktur: paragraf & tabel
export function paragraphCount(this: DocxView): number { return this.book ? [...this.book.paragraphs()].length : 0; }

/** Sisipkan paragraf setelah paragraf ke-`after` (1-based; 0 = paling awal; default akhir dokumen). Mengembalikan indeks (1-based) paragraf baru. */
export function insertParagraphAt(this: DocxView, o: { text?: string; style?: string; after?: number } = {}): number | undefined {
  const book = this.book;
  if (!book || this.readonly) return undefined;
  const paras = [...book.paragraphs()].map(x => x.p);
  const afterIdx = o.after === undefined ? paras.length : Math.round(o.after);
  if (afterIdx < 0 || afterIdx > paras.length) return undefined;
  let np: XEl;
  if (afterIdx === 0) {
    const ref = paras[0];
    const parent = ref ? book.parentOf(ref) : book.body;
    if (!parent) return undefined;
    np = mk("p"); if (o.text) insertText(np, 0, o.text);
    parent.children.splice(ref ? parent.children.indexOf(ref) : 0, 0, np);
  } else {
    const ref = paras[afterIdx - 1];
    const parent = book.parentOf(ref);
    if (!parent) return undefined;
    // setelah paragraf yang mengakhiri tabel/sel tetap berada pada induk yang sama
    np = insertParagraphAfter(parent, ref, o.text ?? "");
  }
  if (o.style) applyParaPatch(np, { style: o.style });
  this.commitStructural("hist.insert", { p: np, off: flatLength(np) });
  return [...book.paragraphs()].map(x => x.p).indexOf(np) + 1;
}

export function removeParagraphAt(this: DocxView, index: number): boolean {
  const book = this.book;
  if (!book || this.readonly) return false;
  const paras = [...book.paragraphs()].map(x => x.p);
  const p = paras[Math.round(index) - 1];
  if (!p || paras.length < 2) return false;
  const parent = book.parentOf(p);
  if (!parent) return false;
  const nx = deleteBlock(parent, p);
  this.commitStructural("hist.delete", nx && nx.name.local === "p" ? { p: nx, off: 0 } : undefined);
  return true;
}

export function insertPageBreakAt(this: DocxView, paragraph?: number): boolean {
  if (this.readonly || !this.book) return false;
  if (paragraph !== undefined) { const p = [...this.book.paragraphs()].map(x => x.p)[Math.round(paragraph) - 1]; if (!p) return false; this.focusPara(p, flatLength(p), false); }
  this.insertPageBreakAtCaret();
  return true;
}

export function tableSummaries(this: DocxView): { index: number; rows: number; cols: number; text: string }[] {
  const book = this.book;
  if (!book) return [];
  return book.tables().map((tbl, i) => { const g = buildGrid(tbl); return { index: i + 1, rows: g.rows.length, cols: g.ncols, text: flatText(tbl).slice(0, 40) }; });
}

/** Sisipkan tabel baru setelah paragraf ke-`after` (default: kursor). Mengembalikan indeks (1-based) tabel baru. */
export function insertTableAfterPara(this: DocxView, rows: number, cols: number, after?: number): number | undefined {
  const book = this.book;
  if (!book || this.readonly || !(rows >= 1) || !(cols >= 1)) return undefined;
  const before = new Set(book.tables());
  if (after !== undefined) { const p = [...book.paragraphs()].map(x => x.p)[Math.round(after) - 1]; if (!p) return undefined; this.focusPara(p, flatLength(p), false); }
  this.insertTable(Math.round(rows), Math.round(cols));
  const i = book.tables().findIndex(t => !before.has(t));
  return i < 0 ? undefined : i + 1;
}

/** Jalankan operasi tabel (`DOCX_TABLE_OPS`) pada bagian tabel; false bila op/target tidak valid. */
export function tableApply(this: DocxView, o: { index: number; row?: number; col?: number; toRow?: number; toCol?: number; op: string; arg?: unknown }): boolean {
  if (this.readonly || !this.book || !(DOCX_TABLE_OPS as readonly string[]).includes(o.op)) return false;
  if (!this.selectFormatTarget({ kind: "table", index: o.index, row: o.row, col: o.col, toRow: o.toRow, toCol: o.toCol })) return false;
  const before = this.book.histIdx;
  this.table(o.op, o.arg);
  if (this.book.histIdx !== before) this.book.squashHistory(before);
  this.clearCellSel();
  return true;
}

export function paraCmd(this: DocxView, label: string, patch: PPatch | ((p: XEl) => PPatch), after?: () => void) {
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

export function setAlign(this: DocxView, jc: "left" | "center" | "right" | "both") { this.paraCmd("hist.align", { jc }); }

export function setStyle(this: DocxView, id: string | null) { this.paraCmd("hist.style", { style: id }); }

export function setLineSpacing(this: DocxView, mult: number) { this.paraCmd("hist.spacing", { line: Math.round(mult * 240), lineRule: "auto" }); }

export function setParaSpacing(this: DocxView, beforePt: number | null, afterPt: number | null) { this.paraCmd("hist.spacing", { before: beforePt === null ? null : Math.round(beforePt * 20), after: afterPt === null ? null : Math.round(afterPt * 20) }); }

/** Tab stop efektif paragraf (twip dari margin kiri): style + format langsung, tanpa entri `clear`. */
export function tabStopsOf(this: DocxView, p: XEl): TabStop[] {
  const book = this.book;
  if (!book) return [];
  const base = book.styles.paraBase(val(first(p, "pPr"), "pStyle"), condForParagraph(book, p)).p;
  return (mergeP(base, readP(first(p, "pPr"), book.styles.theme)).tabs ?? []).filter(t => t.val !== "clear");
}
