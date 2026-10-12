// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
});

/** Penjaga permukaan publik: ekspor yang dipakai host tidak boleh hilang tanpa disengaja. */
describe("permukaan publik (index.ts)", () => {
  it("editor-kit mengekspor kontrak bersama", async () => {
    const kit = await import("./index");
    for (const k of ["createEventBus", "dispatchCommand", "createDropController", "createLayoutController", "resolveLayout", "splitFormatKeys", "normalizeLink", "compositeOver", "RulerKit", "COMMON_FORMAT_KEYS", "DROP_KINDS", "LAYOUT_MODES"]) expect(kit, k).toHaveProperty(k);
  });
  it("tiap editor mengekspor komponen (default + bernama) dan kunci format", async () => {
    const [docx, pptx, xlsx, mx] = await Promise.all([import("../docx-editor"), import("../pptx-editor"), import("../xlsx-preview"), import("../maxgraph-editor")]);
    expect(typeof docx.default).toBe("function"); expect(docx.DocxEditor).toBe(docx.default); expect(docx.DOCX_FORMAT_KEYS).toContain("bold"); expect(docx.DOCX_TABLE_OPS).toContain("merge");
    expect(typeof pptx.default).toBe("function"); expect(pptx.PptxEditor).toBe(pptx.default); expect(pptx.PPTX_FORMAT_KEYS).toContain("fillAlpha");
    expect(typeof xlsx.default).toBe("function"); expect(xlsx.XlsxPreview).toBe(xlsx.default); expect(xlsx.XLSX_FORMAT_KEYS).toContain("numFmt");
    expect(typeof mx.default).toBe("function"); expect(mx.SharedMaxgraphNodeEditor).toBe(mx.default); expect(mx.MAXGRAPH_FORMAT_KEYS).toContain("fill");
  }, 60000);
  it("contoh data tidak ikut permukaan publik", async () => {
    const all = await Promise.all([import("../docx-editor"), import("../pptx-editor"), import("../xlsx-preview")]);
    for (const m of all) expect(Object.keys(m).filter(k => /sample/i.test(k))).toEqual([]);
  }, 60000);
});
