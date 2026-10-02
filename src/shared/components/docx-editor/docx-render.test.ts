// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createSampleBook } from "./docx-sample";
import { DocxBook } from "./docx-model";
import { Registry, fillBlocks, refreshNumbering, type RenderCtx } from "./docx-render";
import { domFlatText, domFlatLength, domOffsetToFlat, flatToDomPos } from "./docx-dom";
import { flatText, flatLength } from "./docx-text";
import { exportHtml, exportText } from "./docx-export";
import { findAll } from "./docx-search";
import { readOle } from "./test-helpers";

if (!URL.createObjectURL) (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:test";

function ctxOf(book: DocxBook): RenderCtx {
  return { book, reg: new Registry(), opts: { readonly: false, showMarks: false, showRevisions: false }, doc: document, contentW: 600, editable: true, fnRefs: [], source: book.doc.partName, badImages: new Set() };
}

describe("render + dom mapping", () => {
  it("sampel: teks datar DOM identik dengan model untuk setiap paragraf", async () => {
    const book = await createSampleBook({ lang: "en" });
    const ctx = ctxOf(book);
    const root = document.createElement("div");
    fillBlocks(ctx, root, book.body);
    refreshNumbering(ctx);
    let n = 0;
    for (const { p } of book.paragraphs()) {
      const dom = ctx.reg.domOf.get(p)!;
      expect(dom, "paragraf harus punya DOM").toBeTruthy();
      expect(domFlatText(dom).replace(/￼/g, "￼")).toBe(flatText(p));
      expect(domFlatLength(dom)).toBe(flatLength(p));
      n++;
    }
    expect(n).toBeGreaterThan(20);
    expect(root.querySelectorAll("table.dx-tbl").length).toBe(1);
    expect(root.querySelectorAll(".dx-img").length).toBeGreaterThanOrEqual(2);
    // label daftar
    const nums = [...root.querySelectorAll(".dx-num")].map(e => e.textContent);
    expect(nums.some(t => /1\./.test(t ?? ""))).toBe(true);
    expect(nums.some(t => t === "•")).toBe(true);
  });

  it("offset: domOffsetToFlat ⇄ flatToDomPos round-trip", async () => {
    const book = await createSampleBook({ lang: "en" });
    const ctx = ctxOf(book);
    const root = document.createElement("div");
    fillBlocks(ctx, root, book.body);
    for (const { p } of book.paragraphs()) {
      const dom = ctx.reg.domOf.get(p)!;
      const len = flatLength(p);
      for (let o = 0; o <= len; o++) {
        const pos = flatToDomPos(dom, o);
        expect(domOffsetToFlat(dom, pos.node, pos.offset), `offset ${o} @ "${flatText(p).slice(0, 20)}"`).toBe(o);
      }
    }
  });

  it("cari + ekspor + simpan/buka ulang", async () => {
    const book = await createSampleBook({ lang: "en" });
    const r = findAll(book, { query: "pictur", regex: false, caseSensitive: false, wholeWord: false });
    expect(r.hits.length).toBeGreaterThan(2);
    const re = findAll(book, { query: "P[a-z]+e[sd]?", regex: true, caseSensitive: true, wholeWord: false });
    expect(re.hits.length).toBeGreaterThan(0);
    const bad = findAll(book, { query: "(", regex: true, caseSensitive: false, wholeWord: false });
    expect(bad.error).toBeTruthy();
    const txt = exportText(book);
    expect(txt).toContain("Sample Report");
    expect(txt).toMatch(/\t/);
    const html = exportHtml(book);
    expect(html).toContain("<table");
    expect(html).toContain("data:image/png;base64");
    const bytes = book.toBytes();
    const again = await DocxBook.open(bytes, "x.docx");
    expect(again.stats().tables).toBe(1);
    expect(again.plain()).toBe(book.plain());
    const ole = await readOle(again);
    expect(ole.length).toBe(1);
    expect(ole[0].native?.fileName).toBe("catatan.txt");
  });
});
