// @vitest-environment jsdom
import { render } from "@solidjs/testing-library";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import PptxEditor, { type PptxEditorApi } from "./PptxEditor";
import { PptxDeck } from "./pptx-model";
import { listPptxOle } from "./pptx-ole";
import { readCfb } from "../office-shared/ole-core";
import { dispatchCommand } from "../editor-kit/events";

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  if (!URL.createObjectURL) (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:test";
  if (!URL.revokeObjectURL) (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  Element.prototype.scrollIntoView = () => {};
  if (!window.requestAnimationFrame) (window as unknown as { requestAnimationFrame: (f: () => void) => number }).requestAnimationFrame = f => setTimeout(f, 0) as unknown as number;
});

let unmount: (() => void) | undefined;
afterEach(() => { unmount?.(); unmount = undefined; document.body.innerHTML = ""; });

async function mount(props: Record<string, unknown> = {}) {
  let api!: PptxEditorApi;
  const wrap = document.createElement("div");
  document.body.appendChild(wrap);
  const r = render(() => <PptxEditor locale="en" onReady={a => (api = a)} {...props} />, { container: wrap });
  unmount = r.unmount;
  await api.events.wait("load", 20000);
  return { api, wrap, root: wrap.querySelector(".pxe-root") as HTMLElement };
}
const enc = (s: string) => new TextEncoder().encode(s);
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe("PptxEditor — event & API", () => {
  it("ready → load, event naik ke DOM, perubahan slide memancarkan event", async () => {
    const heard: string[] = [];
    const { api, wrap } = await mount({ onEvent: (t: string) => heard.push(t) });
    expect(heard).toEqual(expect.arrayContaining(["ready", "load"]));
    expect(api.getSlideCount()).toBeGreaterThan(2);
    const slide = vi.fn(), dom = vi.fn();
    api.on("slide", slide);
    wrap.addEventListener("pptx-editor:slide", e => dom((e as CustomEvent).detail));
    api.goTo(2);
    expect(slide).toHaveBeenCalledWith({ index: 2, count: api.getSlideCount() }, expect.anything());
    expect(dom).toHaveBeenCalledTimes(1);
    expect(api.getText()).toContain("#");
    expect(api.events.history().some(h => h.type === "load" && (h.payload as { source: string }).source === "sample")).toBe(true);
  });

  it("perintah bernama via bus.run dan CustomEvent", async () => {
    const { api, root } = await mount();
    expect(api.events.commands()).toEqual(expect.arrayContaining(["undo", "ole.insert", "ole.update", "ruler.toggle", "getBytes", "goTo"]));
    expect(await api.run<number>("getSlideCount")).toBe(api.getSlideCount());
    const bytes = await dispatchCommand<Uint8Array>(root, "pptx-editor", "getBytes");
    expect(bytes[0]).toBe(0x50);
  });

  it("bus eksternal tetap hidup setelah unmount", async () => {
    const { createEventBus } = await import("../editor-kit/events");
    const bus = createEventBus<import("./PptxEditor").PptxEditorEventMap>({ source: "pptx-editor" });
    const ready = vi.fn();
    bus.on("ready", ready);
    await mount({ bus });
    expect(ready).toHaveBeenCalledTimes(1);
    const n = bus.listenerCount();
    unmount?.(); unmount = undefined;
    expect(bus.listenerCount()).toBe(n);
  });
});

describe("PptxEditor — objek OLE", () => {
  it("sisip → event, daftar, simpan/buka ulang; perbarui; ukuran; undo", async () => {
    const { api } = await mount();
    const ins = vi.fn(), upd = vi.fn(), change = vi.fn();
    api.on("ole:inserted", ins); api.on("ole:updated", upd); api.on("change", change);
    const before = api.ole.list().length;
    api.goTo(1);

    const info = (await api.ole.insert({ name: "catatan.txt", data: enc("isi satu") }))!;
    expect(info).toMatchObject({ progId: "Package", fileName: "catatan.txt", kind: "package", location: "slide 2" });
    expect(info.id).toMatch(/^1:\d+$/);
    expect(ins).toHaveBeenCalledTimes(1);
    expect(change.mock.calls.some(c => c[0].label === "hist.oleInsert")).toBe(true);
    expect(api.ole.list()).toHaveLength(before + 1);
    expect(readCfb(api.ole.getBytes(info.id)!).native!.fileName).toBe("catatan.txt");
    expect(api.getView()!.slide).toBeTruthy();

    const up = (await api.ole.update(info.id, { name: "baru.txt", data: enc("isi dua") }))!;
    expect(up).toMatchObject({ id: info.id, previousId: info.id });
    expect(upd).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(readCfb(api.ole.getBytes(info.id)!).native!.data)).toBe("isi dua");

    expect(await api.ole.resize(info.id, 300, 200)).toBe(true);
    const o = api.ole.list().find(x => x.shapeId === Number(info.id.split(":")[1]))!;
    expect(o.bounds.w).toBe(300 * 9525);

    const re = await PptxDeck.open((await api.getBytes())!, "x.pptx");
    expect(listPptxOle(re.pres)).toHaveLength(before + 1);

    await api.undo(); // urungkan ukuran
    await api.undo(); // urungkan perbarui → isi lama
    expect(new TextDecoder().decode(readCfb(api.ole.getBytes(info.id)!).native!.data)).toBe("isi satu");
  });

  it("galat memancarkan ole:error: berkas kosong, id salah, id tidak ada", async () => {
    const { api } = await mount();
    const err = vi.fn();
    api.on("ole:error", err);
    expect(await api.ole.insert({ name: "kosong.bin", data: new Uint8Array() })).toBeUndefined();
    expect(await api.ole.update("bukan-id", { name: "a.txt", data: enc("a") })).toBeUndefined();
    expect(await api.ole.update("0:9999", { name: "a.txt", data: enc("a") })).toBeUndefined();
    expect(await api.ole.resize("0:9999", 100, 100)).toBe(false);
    expect(err.mock.calls.map(c => c[0].action)).toEqual(["insert", "update", "update", "resize"]);
    expect(err.mock.calls[1][0].message).toMatch(/tidak valid/);
    expect(err.mock.calls[2][0].message).toMatch(/tidak ditemukan/);
  });

  it("readonly menolak sisip", async () => {
    const { api } = await mount({ readonly: true });
    const err = vi.fn();
    api.on("ole:error", err);
    expect(await api.ole.insert({ name: "a.txt", data: enc("a") })).toBeUndefined();
    expect(err).toHaveBeenCalledWith(expect.objectContaining({ action: "insert", message: expect.stringMatching(/baca-saja/) }), expect.anything());
  });

  it("UI: tombol Object… di tab Insert dan panel OLE memuat objek", async () => {
    const { api, root } = await mount();
    await api.ole.insert({ name: "a.txt", data: enc("a") });
    const tab = [...root.querySelectorAll<HTMLButtonElement>(".pxe-tab")].find(b => /insert/i.test(b.textContent ?? ""))!;
    tab.click();
    await wait(0);
    expect([...root.querySelectorAll("button")].some(b => /Object…/.test(b.textContent ?? ""))).toBe(true);
    await api.run("setPanel", "ole");
    await wait(0);
    expect(root.textContent).toContain("Objects on slides");
  });
});

describe("PptxEditor — penggaris & garis bantu", () => {
  it("event ruler, UI tab View, dan garis bantu menjadi target snapping", async () => {
    const { api, root } = await mount();
    const ev = vi.fn();
    api.on("ruler:visible", ev); api.on("ruler:guide-add", ev); api.on("ruler:measure", ev);
    const view = api.getView()!;
    expect(view.guideSource!()).toEqual({ x: [], y: [] }); // penggaris tersembunyi → tidak ada snapping
    api.ruler.setVisible(true);
    const g = api.ruler.addGuide("x", 640);
    api.ruler.addGuide("y", 360);
    expect(view.guideSource!()).toEqual({ x: [640], y: [360] });
    api.ruler.removeGuide(g.id);
    expect(view.guideSource!().x).toEqual([]);
    const m = api.ruler.measure(0, 0, 1280, 0);
    expect(m.distance).toBe(1280);
    expect(ev.mock.calls.length).toBeGreaterThanOrEqual(4);

    const tab = [...root.querySelectorAll<HTMLButtonElement>(".pxe-tab")].find(b => /view/i.test(b.textContent ?? ""))!;
    tab.click();
    await wait(0);
    expect(root.querySelector("select[title='Ruler unit']")).toBeTruthy();
    expect(root.textContent).toContain("1 guide(s)");
    await api.run("ruler.clearGuides");
    expect(api.ruler.getGuides()).toHaveLength(0);
  });
});
