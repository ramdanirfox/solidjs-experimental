// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { compileFind, createFindCursor, makeReport, matchRanges, normHex, replaceInString, sameColor, sameFont } from "./find-replace";
import { classifyLink, isUnsafeUrl, normalizeLink } from "./hyperlink";
import { compositeOver, cssRgba, normalizeHex, parseCssColor, parseHex } from "./color-util";
import { RulerKit, type RulerEventMap } from "./ruler-kit";
import { clamp01, COMMON_FORMAT_KEYS, splitFormatKeys } from "./format";
import { classifyDataTransfer, createDropController, isExternalDrag, itemsFromInput } from "./drop";
import { createLayoutController, isLayoutSetting, NARROW_MAX, resolveLayout } from "./layout";

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

describe("layout (mode tata letak)", () => {
  it("resolveLayout: eksplisit menang; auto = touch bila pointer kasar, compact bila sempit, selain itu desktop", () => {
    expect(resolveLayout("touch", 2000, false)).toBe("touch");
    expect(resolveLayout("desktop", 100, true)).toBe("desktop");
    expect(resolveLayout("auto", 1200, true)).toBe("touch");
    expect(resolveLayout("auto", NARROW_MAX - 1, false)).toBe("compact");
    expect(resolveLayout("auto", NARROW_MAX, false)).toBe("desktop");
    expect(resolveLayout("auto", 0, false)).toBe("desktop"); // belum terukur
    expect(["auto", "desktop", "compact", "touch"].every(isLayoutSetting)).toBe(true);
    expect(isLayoutSetting("phone")).toBe(false);
  });

  it("controller: data-layout/data-narrow, ResizeObserver, matchMedia, set() dan onChange hanya saat berubah", () => {
    const ros: { cb: () => void }[] = [];
    const mqls: { matches: boolean; cbs: (() => void)[] } = { matches: false, cbs: [] };
    const RO0 = (globalThis as { ResizeObserver?: unknown }).ResizeObserver, MM0 = window.matchMedia;
    (globalThis as { ResizeObserver: unknown }).ResizeObserver = class { constructor(public cb: () => void) { ros.push(this); } observe() {} disconnect() {} unobserve() {} };
    window.matchMedia = (() => ({ get matches() { return mqls.matches; }, addEventListener: (_: string, f: () => void) => mqls.cbs.push(f), removeEventListener: () => {} })) as never;
    try {
      const el = document.createElement("div");
      let w = 1000;
      Object.defineProperty(el, "clientWidth", { get: () => w });
      const seen: string[] = [];
      const c = createLayoutController(el, { onChange: i => seen.push(`${i.setting}/${i.mode}/${i.narrow}`) });
      expect(el.dataset.layout).toBe("desktop");
      expect(el.dataset.narrow).toBeUndefined();
      w = 500; ros[0].cb();
      expect(el.dataset.layout).toBe("compact");
      expect(el.dataset.narrow).toBe("true");
      w = 480; ros[0].cb(); // tidak berubah → tidak ada onChange baru
      mqls.matches = true; mqls.cbs.forEach(f => f());
      expect(el.dataset.layout).toBe("touch");
      expect(c.info()).toMatchObject({ setting: "auto", mode: "touch", coarse: true, narrow: true });
      expect(c.set("desktop")).toBe(true);
      expect(el.dataset.layout).toBe("desktop");
      expect(el.dataset.narrow).toBe("true"); // ukuran tetap dilaporkan
      expect(c.set("bogus" as never)).toBe(false);
      expect(c.setting()).toBe("desktop");
      expect(seen).toEqual(["auto/desktop/false", "auto/compact/true", "auto/touch/true", "desktop/desktop/true"]);
      c.destroy();
    } finally {
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO0; window.matchMedia = MM0;
    }
  });

  it("pengaturan awal eksplisit dan tanpa ResizeObserver/matchMedia tetap aman", () => {
    const RO0 = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    try {
      const el = document.createElement("div");
      const c = createLayoutController(el, { setting: "compact" });
      expect(el.dataset.layout).toBe("compact");
      expect(c.mode()).toBe("compact");
      c.destroy();
    } finally { (globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO0; }
  });
});

describe("drop (jalur drop bersama)", () => {
  const file = (name: string, type = "", size = 10) => { const f = new File(["x".repeat(size)], name, { type }); return f; };
  const dtOf = (o: { files?: File[]; text?: string; uri?: string; types?: string[] }) => ({
    files: o.files ?? [], types: o.types ?? [...(o.files?.length ? ["Files"] : []), ...(o.text ? ["text/plain"] : []), ...(o.uri ? ["text/uri-list"] : [])],
    getData: (k: string) => (k === "text/plain" ? o.text ?? "" : k === "text/uri-list" ? o.uri ?? "" : ""), dropEffect: "none",
  }) as unknown as DataTransfer;

  it("klasifikasi: gambar, office, berkas lain, url, teks; berkas didahulukan atas teks", () => {
    const re = /\.docx$/i;
    const items = classifyDataTransfer(dtOf({ files: [file("a.png", "image/png"), file("b.docx"), file("c.pdf", "application/pdf")], text: "abaikan" }), re);
    expect(items.map(i => i.kind)).toEqual(["image", "office", "file"]);
    expect(classifyDataTransfer(dtOf({ text: "https://example.com/x" }))[0]).toMatchObject({ kind: "url", text: "https://example.com/x" });
    expect(classifyDataTransfer(dtOf({ uri: "# komentar\nhttps://a.b/c" }))[0].kind).toBe("url");
    expect(classifyDataTransfer(dtOf({ text: "dua\nbaris" }))[0].kind).toBe("text");
    expect(classifyDataTransfer(dtOf({ text: "  " }))).toEqual([]);
    expect(itemsFromInput({ files: [file("z.png", "image/png")], text: "halo", url: "mailto:a@b.co" }).map(i => i.kind)).toEqual(["image", "url", "text"]);
    expect(isExternalDrag(dtOf({ files: [file("a.png")] }))).toBe(true);
    expect(isExternalDrag(dtOf({ types: ["application/x-internal"] }))).toBe(false);
    expect(isExternalDrag(null)).toBe(false);
  });

  it("jalur: saringan readonly/jenis/ukuran, before membatalkan, handler false/lempar → ditolak, laporan & onReport", async () => {
    const el = document.createElement("div");
    const calls: string[] = [];
    let ro = false, allow = true;
    const reports: number[] = [];
    const c = createDropController(el, {
      maxSize: 100, readonly: () => ro, onReport: (_i, r) => reports.push(r.handled.length), officeExt: /\.docx$/i,
      before: () => allow ? undefined : false,
      handlers: {
        image: it => { calls.push("image:" + it.name); },
        office: () => false,
        text: () => { throw new Error("gagal"); },
        url: it => { calls.push("url:" + it.text); },
      },
    });
    const r = await c.handle({ files: [file("a.png", "image/png"), file("big.png", "image/png", 500), file("x.docx"), file("c.pdf")], text: "t", url: "https://a.b" });
    expect(calls).toEqual(["image:a.png", "url:https://a.b"]);
    expect(r.handled.map(i => i.kind)).toEqual(["image", "url"]);
    const why = Object.fromEntries(r.rejected.map(x => [x.item.name || x.item.kind, x.reason]));
    expect(why).toMatchObject({ "big.png": "too-large", "x.docx": "unsupported", "c.pdf": "not-accepted", text: "error" });
    expect(r.rejected.find(x => x.reason === "error")!.error).toBe("gagal");
    expect(reports).toEqual([2]);
    // before membatalkan semuanya
    allow = false;
    const r2 = await c.handle({ files: [file("a.png", "image/png")] });
    expect(r2.cancelled).toBe(true);
    expect(r2.rejected[0].reason).toBe("cancelled");
    allow = true; ro = true;
    expect((await c.handle({ files: [file("a.png", "image/png")] })).rejected[0].reason).toBe("readonly");
    ro = false;
    // accept dapat diubah; nilai tak valid ditolak
    expect(c.setAccept(["file"])).toBe(true);
    expect(c.accept()).toEqual(["file"]);
    expect(c.setAccept(["nonsense" as never])).toBe(false);
    expect(c.accept()).toEqual(["file"]);
    c.destroy();
  });

  it("DOM: dragenter/over/leave mengatur status & preventDefault; drop memicu handler; drag internal diabaikan", async () => {
    const el = document.createElement("div");
    const states: boolean[] = [];
    const got: string[] = [];
    createDropController(el, { onState: v => states.push(v), ignore: dt => dt.types.includes("application/x-internal"), handlers: { image: it => { got.push(it.name); } } });
    const fire = (type: string, dt: DataTransfer) => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "dataTransfer", { value: dt }); Object.defineProperty(ev, "clientX", { value: 5 }); Object.defineProperty(ev, "clientY", { value: 6 });
      el.dispatchEvent(ev);
      return ev;
    };
    const ext = dtOf({ files: [file("a.png", "image/png")] });
    expect(fire("dragenter", ext).defaultPrevented).toBe(true);
    expect(fire("dragover", ext).defaultPrevented).toBe(true);
    expect(states).toEqual([true]);
    fire("dragleave", ext);
    expect(states).toEqual([true, false]);
    fire("dragenter", ext);
    expect(fire("drop", ext).defaultPrevented).toBe(true);
    await new Promise(r => setTimeout(r, 0));
    expect(got).toEqual(["a.png"]);
    expect(states.at(-1)).toBe(false);
    const internal = dtOf({ types: ["application/x-internal", "text/plain"], text: "geser" });
    expect(fire("dragover", internal).defaultPrevented).toBe(false);
    expect(fire("drop", internal).defaultPrevented).toBe(false);
  });
});
