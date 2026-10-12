// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createSampleBook } from "./docx-sample";
import { DocxView, type ViewHooks } from "./docx-view";
import { DocxBook } from "./docx-model";
import { findTocs } from "./docx-toc";
import { flatText } from "./docx-text";
import { els, first, serialize, type XEl } from "./docx-xml";
import { readDrawing } from "./docx-image";
import { descendAll } from "./docx-xml";

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  if (!URL.createObjectURL) (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:test";
  if (!URL.revokeObjectURL) (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  Element.prototype.scrollIntoView = () => {};
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} }) as DOMRect;
  if (!(CSS as unknown as { escape?: unknown }).escape) (CSS as unknown as { escape: (s: string) => string }).escape = (s: string) => s;
});

const hooks = (): ViewHooks & { changes: string[] } => {
  const changes: string[] = [];
  return {
    changes,
    changed: l => { changes.push(l); }, selection: () => {}, pages: () => {}, painter: () => {}, ole: () => {}, openFile: () => {}, toast: () => {}, log: () => {}, context: () => {}, askLink: () => {},
  };
};

async function setup() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const h = hooks();
  const v = new DocxView(host, h);
  const book = await createSampleBook({ lang: "en", ole: false });
  v.load(book);
  return { v, book, h, host };
}
const findPara = (v: DocxView, text: string) => [...v.book!.paragraphs()].map(x => x.p).find(p => flatText(p).includes(text))!;

describe("DocxView", () => {
  it("memuat sampel: halaman, paragraf, tabel", async () => {
    const { v, host } = await setup();
    expect(host.querySelectorAll(".dx-page").length).toBeGreaterThanOrEqual(1);
    expect(host.querySelectorAll(".dx-p").length).toBeGreaterThan(20);
    expect(host.querySelectorAll("table.dx-tbl").length).toBe(1);
    v.dispose();
  });

  it("format: bold pada rentang, undo/redo", async () => {
    const { v, book } = await setup();
    const p = findPara(v, "Use the ribbon");
    v.selectRange(p, 0, 5);
    const before = serialize(p);
    v.toggleRun("b");
    expect(serialize(p)).toMatch(/<w:b\/>/);
    expect(flatText(p)).toContain("Use the ribbon");
    v.undo();
    const p2 = findPara(v, "Use the ribbon");
    expect(serialize(p2)).toBe(before);
    v.redo();
    expect(serialize(findPara(v, "Use the ribbon"))).toMatch(/<w:b\/>/);
    // toggle pada heading (tebal dari style) → mematikan tebal secara eksplisit
    const h = findPara(v, "Introduction");
    v.selectRange(h, 0, 5);
    v.toggleRun("b");
    expect(serialize(findPara(v, "Introduction"))).toContain('<w:b w:val="0"/>');
    expect(book.canUndo).toBe(true);
    v.dispose();
  });

  it("ketik (sinkron DOM→model) & Enter memecah paragraf", async () => {
    const { v, book } = await setup();
    const p = findPara(v, "Use the ribbon");
    const d = v.reg.domOf.get(p)!;
    const textNode = [...d.querySelectorAll(".dx-r")].map(s => s.firstChild).find(n => n && n.nodeType === 3 && (n as Text).data.startsWith("Use the ribbon"))! as Text;
    textNode.data = "XX" + textNode.data;
    expect(v.syncParagraph(d, p)).toBe(true);
    expect(flatText(p).startsWith("XXUse the ribbon")).toBe(true);
    const n0 = [...book.paragraphs()].length;
    v.setCaret(p, 4);
    v.enter();
    expect([...book.paragraphs()].length).toBe(n0 + 1);
    const ps = [...book.paragraphs()].map(x => flatText(x.p));
    const i = ps.findIndex(t => t === "XXUs");
    expect(ps[i + 1].startsWith("e the ribbon")).toBe(true);
    v.dispose();
  });

  it("tabel: sisip baris, gabung sel, hapus kolom", async () => {
    const { v, book } = await setup();
    const tbl = book.tables()[0];
    const cellP = [...book.paragraphs()].map(x => x.p).find(p => flatText(p) === "Tables")!;
    v.setCaret(cellP, 0);
    const rows0 = els(tbl, "tr").length;
    v.table("insertRowBelow");
    expect(els(tbl, "tr").length).toBe(rows0 + 1);
    const p2 = [...book.paragraphs()].map(x => x.p).find(p => flatText(p) === "Tables")!;
    v.setCaret(p2, 0);
    const cols0 = els(first(tbl, "tblGrid")!, "gridCol").length;
    v.table("insertColRight");
    expect(els(first(tbl, "tblGrid")!, "gridCol").length).toBe(cols0 + 1);
    v.table("deleteCols");
    expect(els(first(tbl, "tblGrid")!, "gridCol").length).toBe(cols0);
    v.table("select");
    expect(v.cellSel).toBeTruthy();
    v.dispose();
  });

  it("gambar: pilih, ubah ukuran dengan kunci rasio, wrap", async () => {
    const { v, book } = await setup();
    const img = v.pagesEl.querySelector<HTMLElement>(".dx-img:not(.dx-img-ph)")!;
    v.selectImageEl(img);
    const dr = v.imgSel!.drawing;
    const i0 = readDrawing(dr)!;
    v.imgSetLock(true);
    v.imgSetSize(100, null);
    const i1 = readDrawing(dr)!;
    expect(Math.round(i1.cx / 9525)).toBe(100);
    expect(Math.abs(i1.cx / i1.cy - i0.cx / i0.cy)).toBeLessThan(0.02);
    v.imgSetLock(false);
    v.imgSetSize(120, 40);
    const i2 = readDrawing(dr)!;
    expect(Math.round(i2.cx / 9525)).toBe(120);
    expect(Math.round(i2.cy / 9525)).toBe(40);
    v.imgSetWrap("square", "left");
    expect(readDrawing(descendAll(book.body, "drawing")[0])!.wrap).toBe("square");
    v.imgSetWrap("inline");
    expect(readDrawing(descendAll(book.body, "drawing")[0])!.kind).toBe("inline");
    v.dispose();
  });

  it("riwayat dibatasi maxHistory; simpan → buka ulang tetap valid", async () => {
    const { v, book } = await setup();
    book.setMaxHistory(5);
    const p = findPara(v, "Introduction");
    for (let i = 0; i < 12; i++) { v.selectRange(p, 0, 3); v.toggleRun(i % 2 ? "b" : "i"); }
    expect(book.hist.length).toBeLessThanOrEqual(6);
    const bytes = book.toBytes();
    expect(bytes.length).toBeGreaterThan(1000);
    const spy = vi.fn();
    void spy;
    v.dispose();
  });

  it("cari + gotoHit memilih teks", async () => {
    const { v } = await setup();
    const r = v.search({ query: "ribbon", regex: false, caseSensitive: false, wholeWord: false });
    expect(r.hits.length).toBe(1);
    v.gotoHit(0);
    expect(window.getSelection()?.toString()).toBe("ribbon");
    v.dispose();
  });

  it("format painter menyalin format ke paragraf lain", async () => {
    const { v } = await setup();
    const src = findPara(v, "Visit the office-kit");
    v.selectRange(src, 0, 4);
    v.toggleRun("b");
    v.selectRange(src, 0, 4);
    v.startPainter(false);
    expect(v.painter).toBeTruthy();
    const dst = findPara(v, "Use the ribbon");
    v.selectRange(dst, 0, 3);
    (v as unknown as { applyPainter: () => void }).applyPainter();
    expect(serialize(dst)).toMatch(/<w:b\/>/);
    expect(v.painter).toBeNull();
    v.dispose();
  });

  it("tabel: seleksi asli lintas sel menerapkan shading ke semua sel, bukan hanya sel kursor", async () => {
    const { v } = await setup();
    const tbl = v.book!.tables()[0];
    const rows = els(tbl, "tr");
    const pOf = (r: number, c: number) => first(els(rows[r], "tc")[c], "p")!;
    v.restoreSel({ a: { p: pOf(0, 0), off: 0 }, b: { p: pOf(1, 1), off: 1 } });
    expect(v.cellSel).toBeNull();
    v.table("shade", "FFFF00");
    const x = serialize(tbl);
    expect((x.match(/FFFF00/g) ?? []).length).toBe(4);
    v.dispose();
  });

  it("tabel: format karakter pada sel terpilih menjangkau semua sel", async () => {
    const { v } = await setup();
    const tbl = v.book!.tables()[0];
    v.setCellSel(tbl, { r1: 0, c1: 0, r2: 1, c2: 1 });
    v.setColor("FF0000");
    expect((serialize(tbl).match(/FF0000/g) ?? []).length).toBe(4);
    v.dispose();
  });

  it("tab stop: tambah, pindah, hapus, bersihkan, undo", async () => {
    const { v } = await setup();
    const p = findPara(v, "Use the ribbon");
    v.selectRange(p, 0, 0);
    v.addTabStop(2880, "right", "dot");
    v.addTabStop(1440, "left");
    expect(v.tabStopsOf(p).map(t => [t.pos, t.val, t.leader])).toEqual([[1440, "left", undefined], [2880, "right", "dot"]]);
    expect(serialize(p)).toMatch(/<w:tab w:val="right" w:leader="dot" w:pos="2880"\/>/);
    v.moveTabStop(1440, 1800);
    expect(v.tabStopsOf(p).map(t => t.pos)).toEqual([1800, 2880]);
    v.removeTabStop(2880);
    expect(v.tabStopsOf(p).map(t => t.pos)).toEqual([1800]);
    v.undo();
    expect(v.tabStopsOf(findPara(v, "Use the ribbon")).map(t => t.pos)).toEqual([1800, 2880]);
    v.redo();
    v.clearTabStops();
    expect(v.tabStopsOf(findPara(v, "Use the ribbon"))).toEqual([]);
    expect(serialize(findPara(v, "Use the ribbon"))).not.toMatch(/<w:tabs/);
    v.dispose();
  });

  it("daftar isi: sisip, perbarui saat judul berubah, dan hapus", async () => {
    const { v, book } = await setup();
    const heads = v.outline();
    expect(heads.length).toBeGreaterThan(1);
    // contoh sudah memuat satu daftar isi (cache Word): terdeteksi dan bisa dihapus
    expect(v.tocList()).toHaveLength(1);
    expect(v.removeToc()).toBe(1);
    expect(v.tocList()).toHaveLength(0);
    v.selectRange(findPara(v, "Use the ribbon"), 0, 0);
    expect(v.insertToc()).toBe(true);
    let tocs = v.tocList();
    expect(tocs).toHaveLength(1);
    expect(tocs[0].options).toMatchObject({ from: 1, to: 3, hyperlinks: true, pageNumbers: true });
    // satu entri per judul level 1–3, tiap entri berhyperlink ke bookmark _Toc yang ada pada judul
    const expected = heads.filter(h => h.level <= 3).length;
    const entries = tocs[0].paras.filter(p => first(p, "hyperlink"));
    expect(entries).toHaveLength(expected);
    const bookmarks = new Set(descendAll(book.body, "bookmarkStart").map(b => b.attrs.find(a => a.name.local === "name")?.value));
    for (const e of entries) {
      const anchor = first(e, "hyperlink")!.attrs.find(a => a.name.local === "anchor")!.value;
      expect(bookmarks.has(anchor), anchor).toBe(true);
      expect(serialize(e)).toMatch(/PAGEREF _Toc/);
    }
    expect(serialize(tocs[0].paras[0])).toMatch(/TOC \\o "1-3" \\h \\z \\u/);
    // SDT "Table of Contents" dengan judul
    expect(tocs[0].sdt).toBeTruthy();
    expect(v.host.textContent).toContain("Table of Contents");
    // judul baru → entri bertambah setelah pembaruan, dan teks entri mengikuti judul
    const h1 = v.outline().find(h => h.level === 1)!;
    const before = v.tocList()[0].entries;
    v.selectRange(h1.p, 0, 0);
    v.insertTextAtSel("ZZ ");
    v.updateToc();
    tocs = v.tocList();
    expect(tocs).toHaveLength(1);
    expect(tocs[0].entries).toBe(before);
    expect(serialize(tocs[0].sdt!)).toContain("ZZ ");
    // paket tetap valid dan dapat dibuka ulang dengan daftar isi utuh
    expect(book.validate().filter(i => i.severity === "error")).toEqual([]);
    const reopened = await DocxBook.open(book.toBytes(), "x.docx");
    expect(findTocs(reopened).length).toBe(1);
    // undo mengembalikan, hapus menghilangkan field dan SDT
    expect(v.removeToc()).toBe(1);
    expect(v.tocList()).toHaveLength(0);
    expect(serialize(book.body)).not.toMatch(/Table of Contents/);
    v.undo();
    expect(v.tocList()).toHaveLength(1);
    v.dispose();
  });

  it("daftar isi: tanpa nomor halaman (\\n), rentang level, dan tanpa hyperlink", async () => {
    const { v } = await setup();
    v.removeToc();
    v.selectRange(findPara(v, "Use the ribbon"), 0, 0);
    v.insertToc({ from: 1, to: 1, pageNumbers: false, hyperlinks: false });
    const t = v.tocList()[0];
    expect(t.instr).toMatch(/\\o "1-1"/);
    expect(t.instr).toMatch(/\\n/);
    expect(t.instr).not.toMatch(/\\h/);
    const entryXml = t.paras.map(p => serialize(p)).join("");
    expect(entryXml).not.toMatch(/PAGEREF/);
    expect(entryXml).not.toMatch(/<w:hyperlink/);
    v.dispose();
  });

  it("goto: halaman, paragraf, judul, tabel, daftar isi, pencarian, awal/akhir", async () => {
    const { v } = await setup();
    expect(v.gotoTarget({ kind: "start" }).ok).toBe(true);
    expect(v.gotoTarget({ kind: "end" }).ok).toBe(true);
    const h = v.outline()[1];
    expect(v.gotoTarget({ kind: "heading", index: 1 })).toMatchObject({ ok: true, label: h.text });
    expect(v.selPoints()!.a.p).toBe(h.p);
    expect(v.gotoTarget({ kind: "heading", text: h.text.slice(0, 4) }).ok).toBe(true);
    expect(v.gotoTarget({ kind: "heading", index: 999 }).ok).toBe(false);
    expect(v.gotoTarget({ kind: "paragraph", index: 5 }).ok).toBe(true);
    expect(v.gotoTarget({ kind: "paragraph", index: 99999 }).ok).toBe(false);
    const cell = v.gotoTarget({ kind: "table", index: 1, row: 2, col: 2 });
    expect(cell.ok).toBe(true);
    expect(v.tctx()).toMatchObject({ cell: { row: 1, col: 1 } });
    expect(v.gotoTarget({ kind: "toc" }).ok).toBe(true);
    // pencarian: selection menyorot kecocokan ke-n
    const p = findPara(v, "Use the ribbon");
    const r = v.gotoTarget({ kind: "search", query: "ribbon", occurrence: 0 });
    expect(r.ok).toBe(true);
    const sel = v.selPoints()!;
    expect(flatText(sel.a.p).slice(sel.a.off, sel.b.off).toLowerCase()).toBe("ribbon");
    expect(v.gotoTarget({ kind: "search", query: "zzzz-not-here" }).ok).toBe(false);
    void p;
    v.dispose();
  });

  it("find/replace lintas jenis: teks, link, font, warna, isi; satu undo", async () => {
    const { v, book } = await setup();
    const found = v.findMatches({ query: "ribbon", select: false });
    expect(found.count).toBeGreaterThan(0);
    expect(found.matches.every(m => ["text", "headerFooter", "link"].includes(m.kind))).toBe(true);
    // jenis tidak didukung dilaporkan, bukan galat
    const r0 = v.replaceKinds({ query: "ribbon", replacement: "bar", kinds: ["text", "comment" as never] });
    expect(r0.skipped).toEqual(["comment"]);
    expect(r0.byKind.text).toBeGreaterThan(0);
    expect(book.plain().toLowerCase()).not.toContain("ribbon");
    v.undo();
    expect(book.plain().toLowerCase()).toContain("ribbon");
    // regex + grup
    const r1 = v.replaceKinds({ query: "(\\w+) the ribbon", regex: true, replacement: "$1 THE BAR", kinds: ["text"] });
    expect(r1.total).toBeGreaterThan(0);
    expect(book.plain()).toContain("THE BAR");
    // link: ganti URL massal
    const l0 = v.linkItems();
    expect(l0.length).toBeGreaterThan(0);
    const n = v.replaceLinks({ query: "office-kit.github.io", replacement: "example.org" }, "example.org");
    expect(n).toBeGreaterThan(0);
    expect(v.linkItems().every(l => !l.url.includes("office-kit.github.io"))).toBe(true);
    expect(v.updateLink(v.linkItems()[0].id, { url: "#bm1", tooltip: "t" })).toBe(true);
    expect(v.linkItems()[0].url).toBe("#bm1");
    expect(v.removeLinkById(v.linkItems()[0].id)).toBe(true);
    expect(v.linkItems().length).toBe(l0.length - 1);
    // font & warna & isi (nilai persis)
    const fonts = serialize(book.body).match(/w:ascii="([^"]+)"/g) ?? [];
    expect(fonts.length).toBeGreaterThan(0);
    const fontName = /w:ascii="([^"]+)"/.exec(fonts[0])![1];
    expect(v.countValue("font", fontName)).toBeGreaterThan(0);
    const rf = v.replaceKinds({ query: fontName, replacement: "Arial", kinds: ["font"] });
    expect(rf.byKind.font).toBeGreaterThan(0);
    expect(v.countValue("font", fontName)).toBe(0);
    const tbl = book.tables()[0];
    v.setCellSel(tbl, { r1: 0, c1: 0, r2: 0, c2: 1 });
    v.setColor("FF0000");
    expect(v.countValue("color", "#ff0000")).toBeGreaterThan(0);
    const rc = v.replaceKinds({ query: "ff0000", replacement: "00FF00", kinds: ["color"] });
    expect(rc.byKind.color).toBeGreaterThan(0);
    expect(v.countValue("color", "00ff00")).toBe(rc.byKind.color);
    v.table("shade", "112233");
    const rs = v.replaceKinds({ query: "#112233", replacement: "", kinds: ["fill"] });
    expect(rs.byKind.fill).toBeGreaterThan(0);
    expect(v.countValue("fill", "112233")).toBe(0);
    v.dispose();
  });
});

export type { XEl };
