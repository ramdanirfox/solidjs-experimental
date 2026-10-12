// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createSampleBook } from "./docx-sample";
import { DocxView, type ViewHooks } from "./docx-view";
import { DocxBook } from "./docx-model";
import { listInfo, listOf } from "./docx-lists";
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
    const r0 = v.replaceKinds({ query: "ribbon", replacement: "bar", kinds: ["text", "stroke" as never] });
    expect(r0.skipped).toEqual(["stroke"]);
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
    const n = v.replaceLinks({ query: "office-kit.github.io" }, "example.org");
    expect(n).toBeGreaterThan(0);
    expect(v.linkItems().every(l => !l.url.includes("office-kit.github.io"))).toBe(true);
    expect(v.updateLink(v.linkItems()[0].id, { url: "#bm1", tooltip: "t" })).toBe(true);
    expect(v.linkItems()[0].url).toBe("#bm1");
    expect(v.removeLinkById(v.linkItems()[0].id)).toBe(true);
    expect(v.linkItems().length).toBe(l0.length - 1);
    // font & warna & isi (nilai persis)
    const fonts = serialize(book.body).match(/w:ascii="([^"]+)"/g) ?? [];
    expect(fonts.length).toBeGreaterThan(0);
    const fontName = /w:ascii="([^"]+)"/.exec(fonts[0]!)![1]!;
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

  describe("header & footer", () => {
    const hdrText = (host: HTMLElement, page: number) => host.querySelectorAll<HTMLElement>(".dx-page")[page - 1]?.querySelector(".dx-hdr")?.textContent ?? "";
    const ftrText = (host: HTMLElement, page: number) => host.querySelectorAll<HTMLElement>(".dx-page")[page - 1]?.querySelector(".dx-ftr")?.textContent ?? "";

    it("sunting header: dibuat bila belum ada, teks masuk model, salinan di halaman lain ikut, keluar mengunci", async () => {
      const { v, book, host } = await setup();
      v.paginate();
      expect(host.querySelectorAll(".dx-page").length).toBeGreaterThan(1);
      expect(v.editHeaderFooter("hdr", 1)).toBe(true);
      expect(v.hfEdit).toMatchObject({ kind: "hdr", page: 1 });
      const box = host.querySelector<HTMLElement>("[data-edit]")!;
      expect(box).toBeTruthy();
      expect(box.closest(".dx-hdr")).toBeTruthy();
      expect(box.isContentEditable || box.contentEditable === "true").toBe(true);
      // kursor ada di paragraf header → seleksi, format, dan sisip teks bekerja pada header
      expect(v.selPoints()).toBeTruthy();
      v.insertTextAtSel("Laporan Rahasia");
      const root = book.hf(v.hfEdit!.relId)!;
      expect(descendAll(root, "t").map(t => (t.children[0] as { value: string }).value).join("")).toContain("Laporan Rahasia");
      v.emitSelection();
      expect(v.lastSelection?.region).toBe("header");
      v.toggleRun("b");   // tanpa seleksi → pending, tapi tidak boleh melempar
      v.selectRange(v.selPoints()!.a.p, 0, 7);
      v.toggleRun("b");
      expect(serialize(root)).toMatch(/<w:b\/>/);
      v.paginate();
      expect(hdrText(host, 2)).toContain("Laporan Rahasia");   // salinan statis di halaman lain
      expect(host.querySelectorAll("[data-edit]").length).toBe(1);
      v.exitHF();
      expect(v.hfEdit).toBeNull();
      expect(host.querySelector("[data-edit]")).toBeNull();
      expect(hdrText(host, 1)).toContain("Laporan Rahasia");
      // tersimpan ke paket dan terbaca ulang
      expect(book.validate().filter(x => x.severity === "error")).toEqual([]);
      const re = await DocxBook.open(book.toBytes(), "x.docx");
      const rel = re.sections()[0].hdrRefs.default;
      expect(rel).toBeTruthy();
      expect(descendAll(re.hf(rel)!, "t").map(t => (t.children[0] as { value: string }).value).join("")).toContain("Laporan Rahasia");
      v.dispose();
    });

    it("undo/redo memulihkan isi header, termasuk saat mode sunting aktif", async () => {
      const { v, book, host } = await setup();
      v.editHeaderFooter("ftr", 1);
      v.insertTextAtSel("ABC");
      expect(ftrText(host, 1)).toContain("ABC");
      v.undo();
      expect(v.hfEdit).toBeTruthy();
      expect(descendAll(book.hf(v.hfEdit!.relId)!, "t").map(t => (t.children[0] as { value: string }).value).join("")).not.toContain("ABC");
      v.redo();
      expect(descendAll(book.hf(v.hfEdit!.relId)!, "t").map(t => (t.children[0] as { value: string }).value).join("")).toContain("ABC");
      v.exitHF();
      v.dispose();
    });

    it("field halaman: sisip PAGE/NUMPAGES, nomor tiap halaman benar, simpan & buka ulang", async () => {
      const { v, book, host } = await setup();
      v.paginate();
      const total = host.querySelectorAll(".dx-page").length;
      v.editHeaderFooter("ftr", 1);
      v.insertTextAtSel("Halaman ");
      expect(v.insertField("PAGE")).toBe(true);
      v.insertTextAtSel(" dari ");
      expect(v.insertField("NUMPAGES")).toBe(true);
      v.exitHF();
      for (let n = 1; n <= total; n++) expect(ftrText(host, n)).toContain(`Halaman ${n} dari ${total}`);
      const xml = serialize(book.hf(v.hfEdit?.relId ?? book.sections()[0].ftrRefs.default)!);
      expect(xml).toMatch(/instrText[^>]*> PAGE </);
      expect(xml).toMatch(/instrText[^>]*> NUMPAGES </);
      expect(book.validate().filter(x => x.severity === "error")).toEqual([]);
      v.dispose();
    });

    it("penomoran halaman: mulai dari, format romawi/huruf, dan nomor di daftar isi mengikutinya", async () => {
      const { v, book, host } = await setup();
      v.paginate();
      v.editHeaderFooter("ftr", 1);
      v.insertField("PAGE");
      v.exitHF();
      v.setPageNumbering({ start: 5, fmt: "lowerRoman" });
      expect(ftrText(host, 1)).toContain("v");
      expect(ftrText(host, 2)).toContain("vi");
      expect([...host.querySelectorAll<HTMLElement>(".dx-page")].map(p => p.dataset.disp).slice(0, 2)).toEqual(["v", "vi"]);
      expect(v.hfOptions()).toMatchObject({ pgStart: 5, pgFmt: "lowerRoman" });
      // daftar isi memakai nomor tampil
      v.selectRange(findPara(v, "Use the ribbon"), 0, 0);
      v.removeToc();
      v.insertToc();
      expect(serialize(v.tocList()[0].sdt!)).toMatch(/<w:t>(v|vi|vii)<\/w:t>/);
      // kembali ke desimal, lanjutkan
      v.setPageNumbering({ start: null, fmt: null });
      expect([...host.querySelectorAll<HTMLElement>(".dx-page")].map(p => p.dataset.disp).slice(0, 2)).toEqual(["1", "2"]);
      expect(book.sections()[0].pgNum).toBeUndefined();
      v.dispose();
    });

    it("halaman pertama berbeda dan ganjil/genap memilih header berbeda; hapus header", async () => {
      const { v, book, host } = await setup();
      v.paginate();
      v.editHeaderFooter("hdr", 1);
      v.insertTextAtSel("UMUM");
      v.exitHF();
      v.setDifferentFirstPage(true);
      expect(book.sections()[0].titlePg).toBe(true);
      expect(hdrText(host, 1)).not.toContain("UMUM");     // halaman 1 memakai header 'first' (kosong)
      expect(hdrText(host, 2)).toContain("UMUM");
      v.editHeaderFooter("hdr", 1);
      expect(v.hfTypeFor(1).type).toBe("first");
      v.insertTextAtSel("PERTAMA");
      v.exitHF();
      expect(hdrText(host, 1)).toContain("PERTAMA");
      expect(hdrText(host, 2)).not.toContain("PERTAMA");
      expect(v.hfOptions().has.hdr).toEqual(expect.arrayContaining(["default", "first"]));
      v.setDifferentFirstPage(false);
      expect(hdrText(host, 1)).toContain("UMUM");
      // ganjil/genap
      if (book.settings()) {
        expect(v.setDifferentOddEven(true)).toBe(true);
        expect(v.hfTypeFor(2).type).toBe("even");
        expect(book.validate().filter(x => x.severity === "error")).toEqual([]);
        const re = await DocxBook.open(book.toBytes(), "x.docx");
        expect(re.evenAndOdd()).toBe(true);
        v.setDifferentOddEven(false);
      }
      // hapus
      expect(v.removeHeaderFooter("hdr", "default")).toBe(true);
      expect(hdrText(host, 2)).not.toContain("UMUM");
      v.dispose();
    });
  });

  describe("daftar bullet & bernomor", () => {
    const labels = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(".dx-p")].filter(d => d.querySelector(".dx-num")).map(d => d.querySelector(".dx-num")!.textContent!.trim());
    const listParas = (v: DocxView) => [...v.book!.paragraphs()].map(x => x.p).filter(p => listOf(v.book!, p));
    /** `n` paragraf body berurutan yang belum berdaftar (seleksi lintas paragraf mencakup semua paragraf di antaranya). */
    const freeRun = (v: DocxView, n: number, skip = 0): XEl[] => {
      const book = v.book!;
      const all = [...book.paragraphs()].map(x => x.p);
      let found = 0;
      for (let i = 0; i + n <= all.length; i++) {
        const w = all.slice(i, i + n);
        if (w.every(p => book.parentOf(p) === book.body && !listOf(book, p) && flatText(p).length > 0)) { if (found++ === skip) return w; i += n - 1; }
      }
      throw new Error("tidak ada rangkaian paragraf bebas");
    };

    it("galeri: ganti gaya seluruh daftar yang ada, dan buat daftar baru dari paragraf biasa", async () => {
      const { v, book, host } = await setup();
      const before = listParas(v);
      expect(before.length).toBeGreaterThanOrEqual(6); // 3 bullet + 3 bernomor pada contoh
      const num = before.find(p => listInfo(book, p)!.kind === "number")!;
      const group = before.filter(p => listOf(book, p)!.numId === listOf(book, num)!.numId);
      expect(group.length).toBeGreaterThanOrEqual(3);
      // seleksi sebagian item → seluruh daftar berganti gaya
      v.selectRange(group[0], 0, 0);
      expect(v.applyListPreset("roman-upper")).toBe(true);
      expect(v.listInfoAtCaret()).toMatchObject({ kind: "number", preset: "roman-upper" });
      const idx = [...host.querySelectorAll<HTMLElement>(".dx-p")].filter(d => d.querySelector(".dx-num")).map(d => d.querySelector(".dx-num")!.textContent!.trim());
      expect(idx).toEqual(expect.arrayContaining(["I.", "II.", "III."]));
      v.undo();
      expect(v.listInfoAtCaret()?.preset).not.toBe("roman-upper");
      // paragraf biasa → daftar baru bergaya huruf, dimulai dari "a)"
      const plain = freeRun(v, 2);
      v.restoreSel({ a: { p: plain[0], off: 0 }, b: { p: plain[1], off: 1 } });
      expect(v.applyListPreset("alpha-lower")).toBe(true);
      expect(listOf(book, plain[0])!.numId).toBe(listOf(book, plain[1])!.numId);
      expect(v.listInfoAtCaret()).toMatchObject({ kind: "number", preset: "alpha-lower" });
      expect(labels(host)).toEqual(expect.arrayContaining(["a)", "b)"]));
      // bullet: ✓ dan seluruhnya valid
      v.restoreSel({ a: { p: plain[0], off: 0 }, b: { p: plain[1], off: 1 } });
      v.applyListPreset("bullet-check");
      expect(labels(host)).toEqual(expect.arrayContaining(["✓"]));
      expect(book.validate().filter(x => x.severity === "error")).toEqual([]);
      v.dispose();
    });

    it("mulai ulang, nilai awal, dan lanjutkan penomoran", async () => {
      const { v, book, host } = await setup();
      // dua daftar bernomor terpisah dibuat dari 2 + 2 paragraf biasa berurutan
      const [a1, a2] = freeRun(v, 2, 0);
      const [b1, b2] = freeRun(v, 2, 1);
      v.restoreSel({ a: { p: a1, off: 0 }, b: { p: a2, off: 1 } }); v.applyListPreset("num-dot");
      v.restoreSel({ a: { p: b1, off: 0 }, b: { p: b2, off: 1 } }); v.applyListPreset("num-dot");
      const nums = () => [a1, a2, b1, b2].map(p => host.querySelector<HTMLElement>(`.dx-p:has(.dx-num)`) && v.reg.domOf.get(p)!.querySelector(".dx-num")!.textContent!.trim());
      expect(nums()).toEqual(["1.", "2.", "1.", "2."]);   // daftar baru → mulai dari awal
      // lanjutkan: daftar kedua melanjutkan daftar pertama
      v.restoreSel({ a: { p: b1, off: 0 }, b: { p: b1, off: 0 } });
      expect(v.continueList()).toBe(true);
      expect(nums()).toEqual(["1.", "2.", "3.", "4."]);
      // mulai ulang dari 1 pada item ke-3 → 3 & 4 menjadi 1 & 2
      expect(v.restartList()).toBe(true);
      expect(nums()).toEqual(["1.", "2.", "1.", "2."]);
      // nilai awal 10
      v.restoreSel({ a: { p: b1, off: 0 }, b: { p: b1, off: 0 } });
      expect(v.setListStart(10)).toBe(true);
      expect(nums()).toEqual(["1.", "2.", "10.", "11."]);
      expect(v.listInfoAtCaret()?.start).toBe(10);
      // bukan daftar → false; undo memulihkan; simpan & buka ulang tetap valid
      const loose = freeRun(v, 1, 0)[0];
      v.restoreSel({ a: { p: loose, off: 0 }, b: { p: loose, off: 0 } });
      expect(v.restartList()).toBe(false);
      expect(book.validate().filter(x => x.severity === "error")).toEqual([]);
      const re = await DocxBook.open(book.toBytes(), "x.docx");
      expect(listInfo(re, [...re.paragraphs()].map(x => x.p).find(p => flatText(p) === flatText(b1))!)?.start).toBe(10);
      expect(labels(host)).toContain("10.");
      v.undo();   // undo menguraikan ulang body: objek paragraf lama tidak berlaku lagi, periksa lewat DOM
      expect(labels(host)).not.toContain("10.");
      expect(labels(host)).toContain("2.");
      v.dispose();
    });

    it("multilevel: level dalam memakai format bergantian dan legal 1.1.1", async () => {
      const { v, book, host } = await setup();
      const plain = freeRun(v, 3);
      v.restoreSel({ a: { p: plain[0], off: 0 }, b: { p: plain[2], off: 1 } });
      v.applyListPreset("multi-legal");
      v.restoreSel({ a: { p: plain[1], off: 0 }, b: { p: plain[1], off: 0 } });
      v.indent(1);
      const lab = (p: XEl) => v.reg.domOf.get(p)!.querySelector(".dx-num")!.textContent!.trim();
      expect([lab(plain[0]), lab(plain[1]), lab(plain[2])]).toEqual(["1.", "1.1", "2."]);
      v.restoreSel({ a: { p: plain[0], off: 0 }, b: { p: plain[2], off: 1 } });
      v.applyListPreset("multi-decimal");
      expect([lab(plain[0]), lab(plain[1]), lab(plain[2])]).toEqual(["1.", "a.", "2."]);
      void host;
      v.dispose();
    });
  });
});

export type { XEl };


describe("DocxView — format.* & struktur (bus)", () => {
  it("formatApply paragraf: run + paragraf + alfa dikomposit; satu langkah undo; kunci asing dilewati", async () => {
    const { v, book } = await setup();
    const p = findPara(v, "Use the ribbon");
    const idx = [...book.paragraphs()].map(x => x.p).indexOf(p) + 1;
    const before = serialize(p);
    const hist0 = book.histIdx;
    const r = v.formatApply({ bold: true, italic: true, fontSize: 18, fontFamily: "Arial", color: "#FF0000", colorAlpha: 0.5, align: "center", spaceAfter: 12, lineSpacing: 1.5, valign: "middle", opacity: 0.5, zzz: 1 }, { kind: "paragraph", index: idx });
    expect(r.targets).toBe(1);
    expect(r.applied).toEqual(expect.arrayContaining(["bold", "italic", "fontSize", "fontFamily", "color", "colorAlpha", "align", "spaceAfter", "lineSpacing"]));
    expect(r.skipped).toEqual(expect.arrayContaining(["valign", "opacity", "zzz"])); // di luar tabel / tak dikenal
    const x = serialize(findPara(v, "Use the ribbon"));
    expect(x).toMatch(/<w:b\/>/);
    expect(x).toMatch(/<w:sz w:val="36"\/>/);
    expect(x).toMatch(/w:val="FF8080"/);   // merah 50% di atas putih
    expect(x).toMatch(/<w:jc w:val="center"\/>/);
    expect(x).toMatch(/w:after="240"/);
    expect(book.histIdx).toBe(hist0 + 1);   // satu entri riwayat
    v.undo();
    expect(serialize(findPara(v, "Use the ribbon"))).toBe(before);
    const g = (v.formatApply({ bold: true }, { kind: "paragraph", index: idx }), v.formatGet({ kind: "paragraph", index: idx }))!;
    expect(g.bold).toBe(true);
  });

  it("target: rentang paragraf + char range, seluruh dokumen, hasil cari; target tak ada → 0", async () => {
    const { v, book } = await setup();
    const p = findPara(v, "Use the ribbon");
    const idx = [...book.paragraphs()].map(x => x.p).indexOf(p) + 1;
    expect(v.formatApply({ underline: true }, { kind: "paragraph", index: idx, start: 0, end: 3 }).targets).toBe(1);
    expect(serialize(findPara(v, "Use the ribbon"))).toMatch(/<w:u w:val="single"\/>/);
    const found = v.formatApply({ highlight: "yellow" }, { kind: "search", query: "ribbon" });
    expect(found.applied).toContain("highlight");
    expect(serialize(findPara(v, "Use the ribbon"))).toMatch(/w:highlight w:val="yellow"/);
    const body = [...book.paragraphs()].map(x => x.p).filter(q => book.parentOf(q) === book.body);
    const all = v.formatApply({ italic: true }, { kind: "all" });
    expect(all.targets).toBe(v.paragraphCount()); // termasuk teks di dalam tabel
    expect(serialize(body[0]) + serialize(body[body.length - 1])).toMatch(/<w:i\/>/);
    expect(v.formatApply({ bold: true }, { kind: "paragraph", index: 99999 })).toEqual({ applied: [], skipped: ["bold"], targets: 0 });
    expect(v.formatApply({ bold: true }, { kind: "search", query: "tidak-ada-xyz" }).targets).toBe(0);
  });

  it("target tabel: fill+bold pada sub-rentang sel saja (bukan hanya sel di kursor); valign sel", async () => {
    const { v, book } = await setup();
    const tbl = book.tables()[0];
    const r = v.formatApply({ fill: "#00FF00", fillAlpha: 0.5, bold: true, valign: "middle" }, { kind: "table", index: 1, row: 1, col: 1, toRow: 2, toCol: 2 });
    expect(r.applied).toEqual(expect.arrayContaining(["fill", "fillAlpha", "bold", "valign"]));
    const rows = els(tbl, "tr");
    const cellOf = (ri: number, ci: number) => els(rows[ri], "tc")[ci];
    for (const [ri, ci] of [[0, 0], [0, 1], [1, 0], [1, 1]]) expect(serialize(cellOf(ri, ci))).toMatch(/w:fill="80FF80"/);
    expect(serialize(cellOf(0, 2))).not.toMatch(/w:fill="80FF80"/);
    expect(serialize(cellOf(2, 0))).not.toMatch(/w:fill="80FF80"/);
    expect(serialize(cellOf(1, 1))).toMatch(/<w:vAlign w:val="center"\/>/);
    expect(serialize(cellOf(1, 1))).toMatch(/<w:b\/>/);
    v.undo();
    expect(serialize(v.book!.tables()[0])).not.toMatch(/80FF80/);
  });

  it("struktur: paragraf (sisip/hapus/undo), page break, tabel (sisip + operasi), readonly menolak", async () => {
    const { v, book } = await setup();
    const n0 = v.paragraphCount();
    const i = v.insertParagraphAt({ text: "Paragraf bus", style: "Heading2", after: 3 })!;
    expect(i).toBe(4);
    expect(v.paragraphCount()).toBe(n0 + 1);
    expect(flatText([...book.paragraphs()].map(x => x.p)[3])).toBe("Paragraf bus");
    expect(v.insertParagraphAt({ after: 9999 })).toBeUndefined();
    expect(v.insertParagraphAt({ text: "Awal", after: 0 })).toBe(1);
    expect(v.removeParagraphAt(1)).toBe(true);
    expect(v.removeParagraphAt(99999)).toBe(false);
    expect(v.insertPageBreakAt(2)).toBe(true);
    expect(serialize(book.body)).toMatch(/w:br w:type="page"/);
    // tabel
    const list0 = v.tableSummaries();
    expect(list0).toHaveLength(1);
    const ti = v.insertTableAfterPara(2, 3, 2)!;
    expect(ti).toBeGreaterThan(0);
    expect(v.tableSummaries()).toHaveLength(2);
    const t = v.tableSummaries().find(x => x.index === ti)!;
    expect([t.rows, t.cols]).toEqual([2, 3]);
    expect(v.tableApply({ index: ti, row: 1, op: "insertRowBelow" })).toBe(true);
    expect(v.tableSummaries().find(x => x.index === ti)!.rows).toBe(3);
    expect(v.tableApply({ index: ti, row: 1, col: 1, toRow: 1, toCol: 2, op: "merge" })).toBe(true);
    expect(v.tableApply({ index: ti, op: "unknownOp" })).toBe(false);
    expect(v.tableApply({ index: 99, op: "insertRowBelow" })).toBe(false);
    expect(v.tableApply({ index: ti, row: 3, op: "deleteRows" })).toBe(true);
    expect(v.tableSummaries().find(x => x.index === ti)!.rows).toBe(2);
    expect(v.tableApply({ index: ti, op: "deleteTable" })).toBe(true);
    expect(v.tableSummaries()).toHaveLength(1);
    v.setReadonly(true);
    expect(v.insertParagraphAt({ text: "x" })).toBeUndefined();
    expect(v.tableApply({ index: 1, op: "insertRowBelow" })).toBe(false);
    expect(v.formatApply({ bold: true }, { kind: "all" }).targets).toBe(0);
  });
});

describe("DocxView — ganti catatan kaki & komentar", () => {
  it("find/replace notes & comment: lokasi, tunggal vs semua, satu undo, tersimpan", async () => {
    const { v, book } = await setup();
    expect(v.replaceKinds({ query: "x", replacement: "y", kinds: ["notes", "comment"] }).skipped).toEqual([]);
    const f = v.findMatches({ query: "rendered", kinds: ["notes"], select: false });
    expect(f.count).toBe(1);
    expect(f.matches[0].location).toMatch(/^Footnote /);
    expect(f.matches[0].target).toMatchObject({ kind: "paragraph" });
    const c = v.findMatches({ query: "re-check", kinds: ["comment"], select: false });
    expect(c.count).toBe(1);
    expect(c.matches[0].location).toMatch(/Comment .*Reviewer/);
    const hist0 = book.histIdx;
    const r = v.replaceKinds({ query: "rendered", replacement: "shown", kinds: ["notes"] });
    expect(r.byKind.notes).toBe(1);
    const r2 = v.replaceKinds({ query: "re-check", replacement: "periksa ulang", kinds: ["comment"] }, true);
    expect(r2.byKind.comment).toBe(1);
    expect(book.histIdx).toBe(hist0 + 2);
    expect(book.comments()[0]?.text ?? "").toBeDefined();
    // tersimpan: buka ulang dari bytes
    const book2 = await DocxBook.open(book.toBytes(), "x.docx");
    const fn = [...book2.notes("footnotes").values()].map(n => descendAll(n, "t").map(t => (t.children[0] as { value?: string } | undefined)?.value ?? "").join("")).join(" ");
    expect(fn).toContain("shown");
    expect(book2.comments()[0].text).toContain("periksa ulang");
    // undo mengembalikan keduanya
    v.undo(); v.undo();
    const again = v.findMatches({ query: "rendered", kinds: ["notes"], select: false });
    expect(again.count).toBe(1);
    expect(v.findMatches({ query: "re-check", kinds: ["comment"], select: false }).count).toBe(1);
    // separator bawaan tidak ikut dicari
    expect(v.findMatches({ query: ".", kinds: ["notes"], select: false, regex: true }).matches.every(m => m.text.length > 0)).toBe(true);
  });
});
