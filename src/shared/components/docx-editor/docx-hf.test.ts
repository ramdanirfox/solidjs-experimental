// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { DocxBook } from "./docx-model";
import { DocxView, type ViewHooks } from "./docx-view";
import { descendAll } from "./docx-xml";

const SAMPLE = join(__dirname, "../../../../public/test/DOCX_SAMPLE_LAYOUT_V2.docx");

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  if (!URL.createObjectURL) (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:test";
  if (!URL.revokeObjectURL) (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  Element.prototype.scrollIntoView = () => {};
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} }) as DOMRect;
  if (!(CSS as unknown as { escape?: unknown }).escape) (CSS as unknown as { escape: (s: string) => string }).escape = (s: string) => s;
});

const hooks = (): ViewHooks => ({
  changed: () => {}, selection: () => {}, pages: () => {}, painter: () => {}, ole: () => {}, openFile: () => {}, toast: () => {}, log: () => {}, context: () => {}, askLink: () => {},
});

async function setup() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const v = new DocxView(host, hooks());
  const book = await DocxBook.open(new Uint8Array(readFileSync(SAMPLE)), "sample.docx");
  v.load(book);
  return { v, book, host };
}
const headerImgs = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(".dx-hdr .dx-img")];

describe("gambar di header/footer", () => {
  it("header ditandai (data-hf), gambar di header dapat dipilih", async () => {
    const { v, host } = await setup();
    const imgs = headerImgs(host);
    expect(imgs.length).toBeGreaterThanOrEqual(2); // logo kiri (kotak teks) + logo kanan (gambar) pada halaman 2
    expect(host.querySelector(".dx-hdr [data-hf]")).toBeTruthy();
    const pic = imgs.find(i => i.querySelector("img") && !i.closest(".dx-txbx"))!;
    v.selectImageEl(pic);
    expect(v.imgSel?.el).toBe(pic);
  });

  it("ubah gambar header: tersimpan ke paket, masuk riwayat, undo/redo memulihkan", async () => {
    const { v, book, host } = await setup();
    const pic = headerImgs(host).find(i => i.querySelector("img") && !i.closest(".dx-txbx"))!;
    v.selectImageEl(pic);
    const before = book.toBytes();
    expect(book.hfEdited.size).toBe(0);

    v.imgSetAlt("Logo PDT kanan");
    expect(book.hfEdited.size).toBe(1);
    expect(book.modified).toBe(true);
    const re = await DocxBook.open(book.toBytes(), "x.docx");
    const [relId] = [...book.hfEdited];
    const hdr = re.hf(relId)!;
    expect(descendAll(hdr, "docPr").some(d => d.attrs.some(a => a.name.local === "descr" && a.value === "Logo PDT kanan"))).toBe(true);
    expect(book.toBytes().length).not.toBe(0);
    void before;

    // setelah render ulang, gambar yang sama terpilih kembali
    expect(v.imgSel).toBeTruthy();
    expect(v.imgSel!.el.isConnected).toBe(true);

    v.undo();
    const hdrAfterUndo = book.hf(relId)!;
    expect(descendAll(hdrAfterUndo, "docPr").some(d => d.attrs.some(a => a.name.local === "descr" && a.value === "Logo PDT kanan"))).toBe(false);
    const reUndo = await DocxBook.open(book.toBytes(), "u.docx");
    expect(descendAll(reUndo.hf(relId)!, "docPr").some(d => d.attrs.some(a => a.name.local === "descr" && a.value === "Logo PDT kanan"))).toBe(false);
    v.redo();
    expect(descendAll(book.hf(relId)!, "docPr").some(d => d.attrs.some(a => a.name.local === "descr" && a.value === "Logo PDT kanan"))).toBe(true);
  });

  it("hapus gambar header: hilang dari DOM dan dari paket, undo mengembalikan", async () => {
    const { v, book, host } = await setup();
    const n0 = headerImgs(host).length;
    const pic = headerImgs(host).find(i => i.querySelector("img") && !i.closest(".dx-txbx"))!;
    v.selectImageEl(pic);
    v.imgDelete();
    expect(headerImgs(host).length).toBe(n0 - 1);
    const re = await DocxBook.open(book.toBytes(), "x.docx");
    const [relId] = [...book.hfEdited];
    const orig = await DocxBook.open(new Uint8Array(readFileSync(SAMPLE)), "o.docx");
    expect(descendAll(re.hf(relId)!, "drawing").length).toBe(descendAll(orig.hf(relId)!, "drawing").length - 1);
    v.undo();
    expect(headerImgs(host).length).toBe(n0);
  });

  it("header tanpa perubahan tidak ditulis ulang (byte part tetap)", async () => {
    const { book } = await setup();
    const a = new Uint8Array(readFileSync(SAMPLE));
    const re = await DocxBook.open(book.toBytes(), "x.docx");
    const h = re.partNames().find(n => /header1\.xml$/.test(n))!;
    const orig = await DocxBook.open(a, "o.docx");
    expect(re.partText(h)).toBe(orig.partText(h));
  });
});
