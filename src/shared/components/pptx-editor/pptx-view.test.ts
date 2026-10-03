// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as P from "@office-kit/pptx";
import { topShapes } from "./pptx-render";
import { PptxView, type PxHooks, type PxSelInfo } from "./pptx-view";
import { createSampleDeck } from "./pptx-sample";
import type { PptxDeck } from "./pptx-model";

beforeAll(() => {
  if (!URL.createObjectURL) (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:t";
  if (!(globalThis as { ResizeObserver?: unknown }).ResizeObserver) (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
});

let host: HTMLElement, view: PptxView, deck: PptxDeck, last: PxSelInfo | null, changes: string[], thumbs: unknown[];

beforeEach(async () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  changes = []; thumbs = []; last = null;
  const hooks: PxHooks = {
    changed: l => changes.push(l), selection: s => { last = s; }, slide: () => {}, thumbs: w => thumbs.push(w), toast: () => {}, log: () => {},
    context: () => {}, painter: () => {}, tool: () => {}, openFile: () => {},
  };
  view = new PptxView(host, hooks);
  deck = await createSampleDeck("en");
  view.load(deck);
});

const byName = (n: string) => P.findShapeByName(view.slide!, n)!;

describe("PptxView", () => {
  it("memuat sampel, menampilkan slide aktif, berpindah slide", () => {
    expect(view.slides).toHaveLength(6);
    expect(host.querySelector(".px-slide")).toBeTruthy();
    view.goTo(1);
    expect(view.slideIdx).toBe(1);
    expect(host.textContent).toContain("Agenda");
    view.goTo(99);
    expect(view.slideIdx).toBe(5);
  });

  it("seleksi, info bentuk, mengubah posisi/ukuran/isi/garis", () => {
    const title = byName("Title");
    view.select([title]);
    const i = view.info();
    expect(i.count).toBe(1);
    expect(i.shape?.name).toBe("Title");
    expect(i.shape?.fmt?.size).toBeGreaterThan(40);
    view.setBoundsCm({ x: 2, y: 3, w: 10 });
    const b = P.getShapeBounds(title)!;
    expect(Math.round(b.x / 360000)).toBe(2);
    expect(Math.round(b.y / 360000)).toBe(3);
    expect(Math.round(b.w / 360000)).toBe(10);
    view.setFill("#FF0000"); view.setStroke({ color: "#00FF00", widthPt: 2 });
    expect(view.info().shape?.fill?.toLowerCase()).toBe("#ff0000");
    expect(view.info().shape?.stroke?.toLowerCase()).toBe("#00ff00");
    view.setRotation(30);
    expect(P.getShapeRotation(title)).toBe(30);
    expect(changes.length).toBeGreaterThanOrEqual(4);
  });

  it("susunan: depan/belakang, rata, grup/pisah grup, hapus, tempel", () => {
    view.goTo(2);
    const shapes = topShapes(view.slide!);
    const n0 = shapes.length;
    view.select([shapes[1], shapes[2]]);
    view.alignShapes("left");
    expect(P.getShapeBounds(shapes[1])!.x).toBe(P.getShapeBounds(shapes[2])!.x);
    view.group();
    expect(topShapes(view.slide!).length).toBe(n0 - 1);
    expect(view.sel[0] && P.getShapeKind(view.sel[0])).toBe("group");
    view.ungroup();
    expect(topShapes(view.slide!).length).toBe(n0);
    view.select([topShapes(view.slide!)[0]]);
    view.copy(); view.paste();
    expect(topShapes(view.slide!).length).toBe(n0 + 1);
    view.deleteSelected();
    expect(topShapes(view.slide!).length).toBe(n0);
  });

  it("edit teks langsung: teks & format kembali ke model", () => {
    view.goTo(4);
    const rich = byName("Teks kaya") ?? byName("Rich text");
    expect(rich).toBeTruthy();
    view.select([rich]);
    view.startEdit(rich);
    expect(view.isEditing()).toBe(true);
    const host2 = host.querySelector<HTMLElement>(".px-editing")!;
    const first = host2.querySelector<HTMLElement>(".px-p .px-r")!;
    first.textContent = "Diubah ";
    host2.dispatchEvent(new Event("input", { bubbles: true }));
    view.commitEdit();
    expect(view.isEditing()).toBe(false);
    const text = P.getShapeText(rich);
    expect(text).toContain("Diubah");
    expect(text).toContain("Second point");
    // bullet pada paragraf 3-4 dipertahankan
    expect(P.getParagraphPropertiesEffective(deck.pres, rich, 2).bullet).toBeTruthy();
  });

  it("slide: tambah, duplikat, pindah, sembunyikan, hapus, latar, catatan, transisi", () => {
    const n = view.slides.length;
    view.addSlide();
    expect(view.slides.length).toBe(n + 1);
    view.duplicateSlide();
    expect(view.slides.length).toBe(n + 2);
    view.hideSlide(true);
    expect(P.isSlideHidden(view.slide!)).toBe(true);
    view.setNotes("catatan uji");
    expect(P.getSlideNotes(view.slide!)).toBe("catatan uji");
    view.setTransition({ effect: "fade", speed: "fast" });
    expect(P.getSlideTransition(view.slide!)?.effect).toBe("fade");
    view.setBackground("#123456");
    expect(P.getSlideBackground(view.slide!).kind).toBe("solid");
    const from = view.slideIdx;
    view.moveSlide(from, 0);
    expect(view.slideIdx).toBe(0);
    view.deleteSlide();
    expect(view.slides.length).toBe(n + 1);
  });

  it("sisip tabel/grafik dan operasi tabel", () => {
    view.addSlide();
    view.insertTable(3, 3);
    const tbl = view.sel[0];
    expect(P.isTableShape(tbl)).toBe(true);
    view.cellSel = { row: 1, col: 1 };
    view.tableOp("rowBelow");
    expect(P.getTableDimensions(tbl).rows).toBe(4);
    view.tableOp("colRight");
    expect(P.getTableDimensions(tbl).cols).toBe(4);
    view.tableOp("merge", { rowSpan: 1, colSpan: 2 });
    expect(P.getTableCellSpan(P.getTableCell(tbl, 1, 1)).gridSpan).toBe(2);
    view.insertChart("pie");
    expect(P.isChartShape(view.sel[0])).toBe(true);
    expect(host.querySelector(".px-chart svg")).toBeTruthy();
  });

  it("cari & ganti: biasa, regex, kata utuh, lintas slide dan catatan", () => {
    let r = view.search({ query: "shapes", regex: false, caseSensitive: false, wholeWord: false });
    expect(r.hits.length).toBeGreaterThan(1);
    r = view.search({ query: "^Agenda$", regex: true, caseSensitive: true, wholeWord: false });
    expect(r.hits.length).toBe(1);
    expect(r.hits[0].slide).toBe(1);
    r = view.search({ query: "(", regex: true, caseSensitive: false, wholeWord: false });
    expect(r.error).toBeTruthy();
    r = view.search({ query: "Welcome", regex: false, caseSensitive: false, wholeWord: true });
    expect(r.hits.some(h => h.where === "notes")).toBe(true);
    view.gotoHit(0);
    expect(view.slideIdx).toBe(r.hits[0].slide);
    r = view.search({ query: "Agenda", regex: false, caseSensitive: true, wholeWord: false });
    const n = view.replaceHits(r.hits, { query: "Agenda", regex: false, caseSensitive: true, wholeWord: false }, "Rencana");
    expect(n).toBe(1);
    expect(P.getSlideText(view.slides[1])).toContain("Rencana");
  });

  it("format painter menyalin isi/garis/format teks", () => {
    view.goTo(2);
    const shapes = topShapes(view.slide!).filter(s => P.getShapePreset(s) === "roundRect" || P.getShapePreset(s) === "star5");
    view.select([shapes[0]]);
    view.setFill("#112233");
    const painter = vi.fn();
    (view.hooks as { painter: unknown }).painter = painter;
    view.startPainter();
    expect(painter).toHaveBeenCalled();
    (view as unknown as { applyPainter(s: unknown): void }).applyPainter(shapes[1]);
    expect(view.sel[0]).toBe(shapes[1]);
    expect(view.info().shape?.fill?.toLowerCase()).toBe("#112233");
  });

  it("riwayat: commit → undo → afterRestore memulihkan seleksi dan slide", async () => {
    view.goTo(1);
    const t = topShapes(view.slide!)[0];
    const id = P.getShapeId(t);
    view.select([t]);
    view.setBoundsCm({ x: 5 });
    await deck.flushQueue();
    const ids = view.selectedIds();
    expect(await deck.undo()).toBe(true);
    view.afterRestore(ids, 1);
    expect(view.slideIdx).toBe(1);
    expect(view.sel).toHaveLength(1);
    expect(P.getShapeId(view.sel[0])).toBe(id);
    expect(Math.round(P.getShapeBounds(view.sel[0])!.x / 360000)).not.toBe(5);
  });

  it("readonly menolak perubahan", () => {
    view.readonly = true;
    const t = byName("Title");
    view.select([t]);
    const before = JSON.stringify(P.getShapeBounds(t));
    view.setBoundsCm({ x: 9 }); view.deleteSelected(); view.addSlide();
    expect(JSON.stringify(P.getShapeBounds(t))).toBe(before);
    expect(view.slides).toHaveLength(6);
  });

  it("miniatur dirender tanpa placeholder prompt", () => {
    const el = view.renderThumb(view.slides[1], 160);
    expect(el.querySelector(".px-slide")).toBeTruthy();
    expect(el.querySelector(".px-prompt")).toBeNull();
    expect(el.style.width).toBe("160px");
  });
});
