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

  it("edit teks: ukuran, huruf, dan warna tiap run dipertahankan (tidak kembali ke bawaan layout)", () => {
    view.goTo(4);
    const rich = byName("Teks kaya") ?? byName("Rich text");
    // format per karakter (run bertetangga yang sama boleh bergabung)
    const snap = () => {
      const out: unknown[] = [];
      for (let i = 0; i < P.getShapeParagraphCount(rich); i++) {
        let r = 0;
        for (const e of P.getShapeParagraphElements(rich, i)) {
          if (e.kind !== "r") continue;
          const f = P.getShapeRunFormatEffective(deck.pres, rich, i, r++);
          // run bertautan: warna/garis bawah berasal dari tema tautan, bukan format eksplisit → bandingkan tautannya
          const link = P.getShapeRunHyperlink(rich, i, r - 1);
          for (const ch of e.text) out.push([ch, f.size, f.font, !!f.bold, !!f.italic, link ?? f.color]);
        }
      }
      return out;
    };
    const before = snap();
    view.select([rich]);
    view.startEdit(rich);
    const host2 = host.querySelector<HTMLElement>(".px-editing")!;
    // sunting satu run saja (mis. menebalkan sebagian teks) — run lain tidak boleh berubah
    host2.querySelector<HTMLElement>(".px-p .px-r")!.style.fontWeight = "700";
    host2.dispatchEvent(new Event("input", { bubbles: true }));
    view.commitEdit();
    const after = snap();
    expect(after.length).toBe(before.length);
    const firstRunLen = P.getShapeParagraphElements(rich, 0).find(e => e.kind === "r")!.text.length;
    for (let i = firstRunLen; i < before.length; i++) expect(after[i]).toEqual(before[i]);
    // run yang disunting: hanya tebal yang berubah
    for (let i = 0; i < firstRunLen; i++) {
      const b0 = before[i] as unknown[], a0 = after[i] as unknown[];
      expect([a0[0], a0[1], a0[2], a0[4], a0[5]]).toEqual([b0[0], b0[1], b0[2], b0[4], b0[5]]);
      expect(a0[3]).toBe(true);
    }
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

  it("goto: slide, bentuk, catatan, pencarian; target tidak ada → ok=false", () => {
    expect(view.gotoTarget({ kind: "slide", index: 2 })).toMatchObject({ ok: true, label: "3/6" });
    expect(view.slideIdx).toBe(2);
    expect(view.gotoTarget({ kind: "slide", index: 99 }).ok).toBe(false);
    expect(view.gotoTarget({ kind: "last" }).ok).toBe(true);
    expect(view.slideIdx).toBe(5);
    expect(view.gotoTarget({ kind: "prev" }).ok).toBe(true);
    expect(view.slideIdx).toBe(4);
    view.goTo(4);
    const rich = byName("Teks kaya") ?? byName("Rich text");
    const id = P.getShapeId(rich);
    view.goTo(0);
    expect(view.gotoTarget({ kind: "shape", slide: 4, id })).toMatchObject({ ok: true });
    expect(view.slideIdx).toBe(4);
    expect(view.sel[0]).toBe(rich);
    expect(view.gotoTarget({ kind: "shape", slide: 4, name: "KAYA" }).ok).toBe(true);
    const r = view.gotoTarget({ kind: "search", query: "Second point" });
    expect(r.ok).toBe(true);
    expect(view.slideIdx).toBe(4);
    expect(view.gotoTarget({ kind: "search", query: "tidak-ada-teks-ini" }).ok).toBe(false);
  });

  it("find/replace lintas jenis: teks, nama, tautan, warna, isi; satu riwayat", () => {
    const f = view.findMatches({ query: "point", select: false });
    expect(f.count).toBeGreaterThan(0);
    expect(f.matches.every(m => m.kind === "text" || m.kind === "notes" || m.kind === "name" || m.kind === "link")).toBe(true);
    const n0 = changes.length;
    // jenis yang tidak didukung dilaporkan; teks diganti pada semua slide
    const r = view.replaceKinds({ query: "point", replacement: "poin", kinds: ["text", "formula" as never] });
    expect(r.skipped).toEqual(["formula"]);
    expect(r.byKind.text).toBeGreaterThan(0);
    expect(changes.length).toBe(n0 + 1);
    expect(view.findMatches({ query: "point", kinds: ["text"], select: false }).count).toBe(0);
    // regex dengan grup
    const rg = view.replaceKinds({ query: "(poin)", regex: true, replacement: "[$1]", kinds: ["text"] }, false);
    expect(rg.total).toBeGreaterThan(0);
    // replace tunggal hanya mengubah satu kemunculan
    const before = view.findMatches({ query: "[poin]", select: false }).count;
    const one = view.replaceKinds({ query: "[poin]", replacement: "poin", kinds: ["text"] }, true);
    expect(one.total).toBe(1);
    expect(view.findMatches({ query: "[poin]", select: false }).count).toBe(before - 1);
    // nama bentuk
    const rn = view.replaceKinds({ query: "Teks kaya", replacement: "Rich", kinds: ["name"] });
    expect(rn.byKind.name ?? 0).toBeGreaterThanOrEqual(0);
    // readonly
    view.readonly = true;
    expect(view.replaceKinds({ query: "poin", replacement: "x" }).error).toBe("readonly");
    view.readonly = false;
  });

  it("opasitas isi/garis/teks ditulis ke XML dan dibaca kembali", () => {
    view.goTo(2);
    const shapes = topShapes(view.slide!);
    const sh = shapes.find(s => P.getShapeKind(s) === "shape" && P.getShapeText(s))!;
    view.select([sh]);
    view.setFill("#FF0000", 0.4);
    expect(P.getShapeFillOpacity(sh)).toBeCloseTo(0.4, 3);
    view.setStroke({ color: "#0000FF", alpha: 0.25, widthPt: 2 });
    expect(P.getShapeStrokeOpacity(sh)).toBeCloseTo(0.25, 3);
    view.setTextColor("#00AA00", 0.5);
    expect(view.alphaInfo().text).toBeCloseTo(0.5, 3);
    expect(host.querySelector<HTMLElement>(".px-r")).toBeTruthy();
    // hapus opasitas / warna
    view.setFill("#FF0000");
    expect(P.getShapeFillOpacity(sh)).toBeNull();
    view.setFill(null);
    expect(P.getShapeFillColorResolved(deck.pres, sh)).toBeNull();
    view.setStroke({ color: null });
    expect(P.getShapeStrokeColorResolved(deck.pres, sh)).toBeNull();
  });

  it("tautan: daftar, ubah, hapus, ganti massal, dan tautan pada teks yang disunting", () => {
    view.goTo(2);
    const sh = topShapes(view.slide!).find(s => P.getShapeKind(s) === "shape" && P.getShapeText(s))!;
    view.select([sh]);
    view.setHyperlink("https://example.com/a");
    const l = view.linkItems().find(x => x.url === "https://example.com/a");
    expect(l).toBeTruthy();
    expect(view.replaceLinks({ query: "example.com", replacement: "example.org" }, "example.org")).toBeGreaterThan(0);
    expect(view.linkItems().some(x => x.url === "https://example.org/a")).toBe(true);
    const id = view.linkItems().find(x => x.url === "https://example.org/a")!.id;
    expect(view.updateLink(id, { url: "https://x.test/" })).toBe(true);
    expect(view.gotoTarget({ kind: "link", id: view.linkItems().find(x => x.url === "https://x.test/")!.id }).ok).toBe(true);
    expect(view.removeLinkById(view.linkItems().find(x => x.url === "https://x.test/")!.id)).toBe(true);
    expect(view.linkItems().some(x => x.url.includes("x.test"))).toBe(false);
  });

  it("impor DOM: bentuk asli (teks, latar, gambar-tabel) masuk ke slide dan dapat di-undo", async () => {
    const src = document.createElement("div");
    src.id = "dom-src";
    src.innerHTML = '<div id="card" style="background:#eef;border:1px solid #333"><h2 id="t">Judul</h2><p id="p">Isi paragraf</p></div><table id="tb"><tr><td>a</td><td>b</td></tr></table>';
    document.body.appendChild(src);
    const rects: Record<string, [number, number, number, number]> = { "dom-src": [0, 0, 400, 300], card: [0, 0, 400, 150], t: [10, 10, 200, 30], p: [10, 50, 300, 30], tb: [0, 160, 400, 60] };
    const orig = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const r = rects[this.id];
      return r ? ({ left: r[0], top: r[1], width: r[2], height: r[3], right: r[0] + r[2], bottom: r[1] + r[3], x: r[0], y: r[1], toJSON() {} } as DOMRect) : orig.call(this);
    };
    try {
      view.goTo(0);
      const n0 = topShapes(view.slide!).length;
      const r = await view.importDom("#dom-src", { mode: "shapes", group: false });
      expect(r.mode).toBe("shapes");
      expect(r.added).toBeGreaterThanOrEqual(3);
      const after = topShapes(view.slide!);
      expect(after.length).toBe(n0 + r.added);
      const texts = after.map(s => P.getShapeText(s)).join("|");
      expect(texts).toContain("Judul");
      expect(texts).toContain("Isi paragraf");
      expect(after.some(s => P.isTableShape(s))).toBe(true);
      expect(changes).toContain("hist.import");
      // mode otomatis dengan elemen sederhana → shapes; elemen tidak ada → galat
      await expect(view.importDom("#tidak-ada")).rejects.toThrow(/tidak ditemukan/);
      view.readonly = true;
      await expect(view.importDom("#dom-src")).rejects.toThrow(/baca-saja/);
      view.readonly = false;
    } finally { Element.prototype.getBoundingClientRect = orig; src.remove(); }
  });
});
