/** DocxView: docx-view-tabs.ts — fungsi bagian dari kelas (`this: DocxView`), dipasang di kelas sebagai properti agar API publik tidak berubah. */
import type { DocxView } from "./docx-view";
import { first, val, type XEl } from "./docx-xml";
import { condForParagraph } from "./docx-render";
import { changeIndent } from "./docx-ops";
import { type TabStop } from "./docx-style";

export function styleTabsOf(this: DocxView, p: XEl): TabStop[] {
  const book = this.book!;
  return book.styles.paraBase(val(first(p, "pPr"), "pStyle"), condForParagraph(book, p)).p.tabs?.filter(t => t.val !== "clear") ?? [];
}

export function tabStopsAtCaret(this: DocxView): TabStop[] {
  const s = this.selPoints();
  return s ? this.tabStopsOf(s.a.p) : [];
}

/** Terapkan perubahan daftar tab ke semua paragraf terpilih (`mutate` menerima tab efektif tiap paragraf). */
export function tabsCmd(this: DocxView, label: string, mutate: (cur: TabStop[], p: XEl) => TabStop[]) {
  this.paraCmd(label, p => {
    const next = mutate(this.tabStopsOf(p), p).filter(t => t.pos > 0).sort((a, b) => a.pos - b.pos);
    const styleTabs = this.styleTabsOf(p);
    const same = (a: TabStop, b: TabStop) => a.pos === b.pos && a.val === b.val && (a.leader ?? "none") === (b.leader ?? "none");
    const direct = next.filter(t => !styleTabs.some(st => same(st, t)));
    const clears = styleTabs.filter(st => !next.some(n => n.pos === st.pos)).map(st => ({ pos: st.pos, val: "clear" as const }));
    const all = [...direct.map(t => ({ pos: t.pos, val: t.val as "left" | "center" | "right" | "decimal" | "bar", leader: t.leader })), ...clears];
    return { tabs: all.length ? all : null };
  });
}

/** Ganti seluruh tab stop paragraf terpilih dengan `list` (twip). */
export function setTabStops(this: DocxView, list: TabStop[]) { this.tabsCmd("hist.tabs", () => list.map(t => ({ pos: Math.round(t.pos), val: t.val, leader: t.leader }))); }

export function addTabStop(this: DocxView, posTw: number, val: TabStop["val"] = "left", leader?: string) {
  const pos = Math.round(posTw);
  this.tabsCmd("hist.tabs", cur => [...cur.filter(t => t.pos !== pos), { pos, val, leader }]);
}

export function removeTabStop(this: DocxView, posTw: number) { const pos = Math.round(posTw); this.tabsCmd("hist.tabs", cur => cur.filter(t => t.pos !== pos)); }

export function moveTabStop(this: DocxView, fromTw: number, toTw: number) {
  const from = Math.round(fromTw), to = Math.round(toTw);
  this.tabsCmd("hist.tabs", cur => cur.map(t => (t.pos === from ? { ...t, pos: to } : t)).filter((t, i, a) => a.findIndex(x => x.pos === t.pos) === i));
}

export function clearTabStops(this: DocxView) { this.tabsCmd("hist.tabs", () => []); }

export function setShading(this: DocxView, color: string | null) { this.paraCmd("hist.color", { shd: color }); }

export function setParaBorder(this: DocxView, on: boolean) { this.paraCmd("hist.border", { borders: on ? { top: "000000", left: "000000", bottom: "000000", right: "000000" } : null }); }

export function setIndent(this: DocxView, leftPt: number | null, firstPt: number | null, hangingPt?: number | null) {
  this.paraCmd("hist.indent", { indLeft: leftPt === null ? null : Math.round(leftPt * 20), ...(hangingPt ? { indHanging: Math.round(hangingPt * 20) } : { indFirst: firstPt === null ? null : Math.round(firstPt * 20) }) });
}

export function indent(this: DocxView, delta: number) {
  if (this.readonly || !this.book) return;
  const sp = this.spans();
  const sel = this.captureSel();
  changeIndent(this.book, [...new Set(sp.map(s => s.p))], delta * 720);
  for (const p of new Set(sp.map(s => s.p))) this.rerenderPara(p);
  this.refreshNums(); this.restoreSel(sel); this.commit("hist.indent"); this.schedulePaginate();
}
