// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { compileFind, createFindCursor, makeReport, matchRanges, normHex, replaceInString, sameColor, sameFont } from "./find-replace";
import { classifyLink, isUnsafeUrl, normalizeLink } from "./hyperlink";
import { compositeOver, cssRgba, normalizeHex, parseCssColor, parseHex } from "./color-util";
import { RulerKit, type RulerEventMap } from "./ruler-kit";
import { clamp01, COMMON_FORMAT_KEYS, splitFormatKeys } from "./format";

describe("find-replace", () => {
  it("compileFind: literal, kata utuh, regex tidak valid", () => {
    const { re } = compileFind({ query: "a.b" });
    expect("a.b axb".match(re!)!.length).toBe(1);
    expect(matchRanges("cat concat cat", compileFind({ query: "cat", wholeWord: true }).re!).length).toBe(2);
    expect(compileFind({ query: "(", regex: true }).error).toBeTruthy();
    expect(compileFind({ query: "" }).re).toBeNull();
  });
  it("replaceInString: grup regex hanya pada mode regex", () => {
    const re = compileFind({ query: "(a)(b)", regex: true }).re!;
    expect(replaceInString("ab ab", re, "$2$1", true)).toEqual({ text: "ba ba", count: 2 });
    expect(replaceInString("ab", compileFind({ query: "ab" }).re!, "$1", false).text).toBe("$1");
  });
  it("normHex / sameColor / sameFont", () => {
    expect(normHex("#abc")).toBe("AABBCC");
    expect(normHex("ff000080")).toBe("FF0000");
    expect(normHex("zz")).toBeNull();
    expect(sameColor("#FF0000", "ff0000")).toBe(true);
    expect(sameColor(null, null)).toBe(false);
    expect(sameFont(" Arial ", "arial")).toBe(true);
  });
  it("makeReport + createFindCursor berputar", () => {
    expect(makeReport(["text", "formula"], ["text"], { text: 2 })).toEqual({ total: 2, byKind: { text: 2 }, skipped: ["formula"] });
    const c = createFindCursor<number>();
    c.set([1, 2, 3]);
    expect([c.step(1), c.step(1), c.step(1), c.step(1)]).toEqual([1, 2, 3, 1]);
    expect(c.step(-1)).toBe(3);
    c.clear();
    expect(c.step(1)).toBeUndefined();
  });
});

describe("hyperlink", () => {
  it("normalizeLink: email, domain, anchor, berbahaya", () => {
    expect(normalizeLink("a@b.co")).toBe("mailto:a@b.co");
    expect(normalizeLink("example.com/x")).toBe("https://example.com/x");
    expect(normalizeLink("#bm")).toBe("#bm");
    expect(normalizeLink("javascript:alert(1)")).toBeNull();
    expect(normalizeLink("https://")).toBeNull();
    expect(isUnsafeUrl(" DATA:text/html,x")).toBe(true);
  });
  it("classifyLink", () => {
    expect(["https://a.b", "mailto:x@y.z", "tel:1", "#a", "./f.docx", "zzz"].map(classifyLink)).toEqual(["web", "mail", "tel", "anchor", "file", "other"]);
  });
});

describe("color-util", () => {
  it("parse/format/komposit", () => {
    expect(parseHex("#f00")).toMatchObject({ r: 255, g: 0, b: 0 });
    expect(normalizeHex("00ff00")).toBe("#00FF00");
    expect(parseCssColor("rgba(255, 0, 0, 0.5)")).toEqual({ hex: "#FF0000", alpha: 0.5 });
    expect(cssRgba("#FF0000", 0.5)).toBe("rgba(255, 0, 0, 0.5)");
    expect(cssRgba("#FF0000", 1)).toBe("#FF0000");
    expect(compositeOver("#000000", 0.5)).toBe("#808080");
    expect(compositeOver("#FF0000", 0)).toBe("#FFFFFF");
  });
});

describe("RulerKit tab stop", () => {
  const mk = () => {
    const frame = document.createElement("div");
    frame.innerHTML = '<div class="rk-body"></div>';
    document.body.appendChild(frame);
    const events: [string, unknown][] = [];
    const ruler = new RulerKit({
      frame, visible: true, tabs: true, getGeometry: () => ({ originX: 0, originY: 0, scale: 1, zeroX: 100, zeroY: 0 }),
      emit: <K extends keyof RulerEventMap>(t: K, p: RulerEventMap[K]) => { events.push([t, p]); },
    });
    return { ruler, frame, events };
  };
  it("penanda tab, jenis, dan dblclick memicu edit", () => {
    const { ruler, frame, events } = mk();
    expect(ruler.isTabsEnabled()).toBe(true);
    ruler.setTabs([{ id: "720", pos: 48, type: "right" }, { id: "1440", pos: 96, type: "left" }]);
    const els = frame.querySelectorAll<HTMLElement>(".rk-tab");
    expect(els.length).toBe(2);
    expect(els[0].dataset.type).toBe("right");
    ruler.setTabType("decimal");
    expect(events.at(-1)).toEqual(["ruler:tab-type", { type: "decimal" }]);
    els[1].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(events.at(-1)).toEqual(["ruler:tab-edit", { id: "1440", pos: 96, type: "left" }]);
    ruler.setTabs([{ id: "720", pos: 48, type: "right" }]);
    expect(frame.querySelectorAll(".rk-tab").length).toBe(1);
    ruler.setTabsEnabled(false);
    expect(frame.querySelectorAll(".rk-tab").length).toBe(0);
    ruler.destroy();
  });
});
void vi;

describe("format (kontrak bersama)", () => {
  it("splitFormatKeys memisahkan kunci didukung/tidak, mengabaikan undefined", () => {
    const r = splitFormatKeys({ bold: true, fill: null, zzz: 1, color: undefined }, ["bold", "fill", "color"]);
    expect(r.use).toEqual(["bold", "fill"]);   // null tetap kunci sah (= hapus)
    expect(r.skipped).toEqual(["zzz"]);
    expect(splitFormatKeys({}, ["bold"])).toEqual({ use: [], skipped: [] });
  });
  it("clamp01 dan daftar kunci umum", () => {
    expect([clamp01(-1), clamp01(0.4), clamp01(9), clamp01(NaN)]).toEqual([0, 0.4, 1, 1]);
    expect(COMMON_FORMAT_KEYS).toEqual(expect.arrayContaining(["fill", "fillAlpha", "color", "colorAlpha", "stroke", "link"]));
  });
});
