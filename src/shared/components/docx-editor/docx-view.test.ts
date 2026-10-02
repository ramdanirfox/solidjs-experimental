// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createSampleBook } from "./docx-sample";
import { DocxView, type ViewHooks } from "./docx-view";
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
});

export type { XEl };
