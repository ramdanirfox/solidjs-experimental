// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import * as P from "@office-kit/pptx";
import { createSampleDeck } from "./pptx-sample";
import { PptxDeck } from "./pptx-model";
import { renderSlide, topShapes, type RenderCtx } from "./pptx-render";
import { presetPath } from "./pptx-geom";
import { chartSvg } from "./pptx-chart";

beforeAll(() => { if (!URL.createObjectURL) (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:t"; });

function ctxOf(deck: PptxDeck): RenderCtx {
  return {
    pres: deck.pres, doc: document, reg: new WeakMap(), domOf: new Map(), imgUrl: () => "blob:img", interactive: true, prompts: { default: "Click", title: "Title" },
    theme: P.getPresentationTheme(deck.pres), fonts: P.getPresentationFonts(deck.pres), seenIssues: new Set(), log: () => {},
  };
}

describe("pptx render", () => {
  it("sampel: 6 slide, bentuk tertata, tabel/grafik/gambar/grup dirender", async () => {
    const deck = await createSampleDeck("en");
    expect(deck.slides).toHaveLength(6);
    const ctx = ctxOf(deck);
    const html = deck.slides.map(s => renderSlide(ctx, s));
    for (const h of html) { expect(h.style.width).toBe("1280px"); expect(h.querySelector(".px-shapes")).toBeTruthy(); }
    expect(html[0].querySelectorAll("svg.px-geom").length).toBeGreaterThanOrEqual(3);
    expect(html[0].textContent).toContain("PPTX Editor in the Browser");
    expect(html[1].textContent).toContain("Agenda");
    expect(html[1].querySelectorAll(".px-bullet").length).toBe(4);
    expect(html[2].querySelectorAll(".px-k-group").length).toBe(1);
    // anak grup hanya dirender di dalam grup (getSlideShapes meratakan anak grup)
    expect(html[2].querySelectorAll(".px-shapes > .px-shape").length).toBe(topShapes(deck.slides[2]).length);
    expect(html[2].querySelectorAll(".px-k-group > .px-shape").length).toBe(2);
    expect(html[3].querySelector("table.px-table")).toBeTruthy();
    expect(html[3].querySelector("td[colspan='2']")).toBeTruthy();
    expect(html[3].querySelector(".px-chart svg")).toBeTruthy();
    expect(html[4].querySelector(".px-pic img")).toBeTruthy();
    expect(html[4].querySelectorAll(".px-p").length).toBeGreaterThanOrEqual(4);
    expect(html[4].querySelector("[data-href]")?.getAttribute("data-href")).toContain("office-kit");
  });

  it("riwayat undo/redo dengan snapshot; simpan → buka ulang valid", async () => {
    const deck = await createSampleDeck("id");
    deck.setMaxHistory(3);
    const s = deck.slides[0];
    const title = P.findShapeByName(s, "Title")!;
    for (let i = 0; i < 5; i++) { P.setShapeText(title, `Judul ${i}`); await deck.commit(`h${i}`); }
    expect(deck.hist.length).toBeLessThanOrEqual(4);
    expect(P.getShapeText(P.findShapeByName(deck.slides[0], "Title")!)).toBe("Judul 4");
    await deck.undo();
    expect(P.getShapeText(P.findShapeByName(deck.slides[0], "Title")!)).toBe("Judul 3");
    await deck.redo();
    expect(P.getShapeText(P.findShapeByName(deck.slides[0], "Title")!)).toBe("Judul 4");
    const bytes = await deck.toBytes();
    const again = await PptxDeck.open(bytes, "x.pptx");
    expect(again.slides).toHaveLength(6);
    expect(P.validatePresentation(again.pres)).toHaveLength(0);
    expect(again.log.some(l => l.key === "log.loaded")).toBe(true);
  });

  it("geometri preset & grafik menghasilkan markup yang valid", () => {
    for (const p of ["rect", "roundRect", "ellipse", "star5", "rightArrow", "heart", "cloud", "donut", "cube"]) expect(presetPath(p, 100, 60).known).toBe(true);
    expect(presetPath("tidakAda", 100, 60).known).toBe(false);
    const svg = chartSvg({ kind: "column", categories: ["A", "B"], series: [{ name: "S", values: [1, 3] }] } as never, 400, 300, ["#f00", "#0f0"]);
    expect(svg).toContain("<rect");
    const pie = chartSvg({ kind: "pie", categories: ["A", "B"], series: [{ name: "S", values: [1, 3] }] } as never, 400, 300, ["#f00", "#0f0"]);
    expect(pie).toContain("<path");
  });
});
