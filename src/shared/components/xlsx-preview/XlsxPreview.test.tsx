// @vitest-environment jsdom
import { render } from "@solidjs/testing-library";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import XlsxPreview, { type XlsxPreviewApi } from "./XlsxPreview";
import { dispatchCommand } from "../editor-kit/events";
import { minimalXlsx } from "./test-fixture";

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  if (!URL.createObjectURL) (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:test";
  if (!URL.revokeObjectURL) (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  Element.prototype.scrollIntoView = () => {};
  HTMLCanvasElement.prototype.getContext = (() => null) as never; // jsdom tanpa canvas: ukur teks jatuh ke perkiraan
});

let unmount: (() => void) | undefined;
afterEach(() => { unmount?.(); unmount = undefined; document.body.innerHTML = ""; });

async function mount(props: Record<string, unknown> = {}) {
  let api!: XlsxPreviewApi;
  const wrap = document.createElement("div");
  document.body.appendChild(wrap);
  const r = render(() => <XlsxPreview sample={false} onReady={a => (api = a)} {...props} />, { container: wrap });
  unmount = r.unmount;
  const loaded = api.events.wait("load", 20000);
  await api.load(minimalXlsx(), "uji.xlsx");
  await loaded;
  return { api, wrap, root: wrap.querySelector(".xl-root") as HTMLElement };
}
const enc = (s: string) => new TextEncoder().encode(s);
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe("XlsxPreview — event & API", () => {
  it("ready → load; sheet, sel, cell-edit; event naik ke DOM", async () => {
    const heard: string[] = [];
    const { api, wrap } = await mount({ onEvent: (t: string) => heard.push(t) });
    expect(heard).toEqual(expect.arrayContaining(["ready", "load"]));
    expect(api.getSheets().map(s => s.name)).toEqual(["Data", "Lain"]);
    expect(api.getCell("A1")).toEqual({ text: "halo", raw: "halo" });
    expect(api.getCell("B2")!.text).toBe("42");
    expect(api.getCell("Lain!A1")!.text).toBe("7");
    expect(api.getCell("bukan-alamat")).toBeUndefined();

    const edit = vi.fn(), sheet = vi.fn(), selEv = vi.fn(), dom = vi.fn();
    api.on("cell-edit", edit); api.on("sheet", sheet); api.on("selection", selEv);
    wrap.addEventListener("xlsx-preview:cell-edit", e => dom((e as CustomEvent).detail));
    expect(api.setCell("C1", "123")).toBe(true);
    expect(api.getCell("C1")!.text).toBe("123");
    expect(edit).toHaveBeenCalledWith({ sheet: "Data", row: 1, col: 3, address: "C1", text: "123" }, expect.anything());
    expect(dom).toHaveBeenCalledTimes(1);
    api.setSheet("Lain");
    await wait(0);
    expect(sheet).toHaveBeenCalledWith({ index: 1, name: "Lain" }, expect.anything());
    expect(() => api.setSheet("tidak-ada")).toThrow(/tidak ditemukan/);
    api.setSheet(0);
    api.select("B2:C3");
    await wait(0);
    expect(api.getSelection()).toEqual({ sheet: "Data", range: "B2:C3", active: "B2" });
    expect(selEv).toHaveBeenCalled();
    api.undo();
    expect(api.getCell("C1")!.text).toBe("");
  });

  it("perintah bernama via bus.run dan CustomEvent", async () => {
    const { api, root } = await mount();
    expect(api.events.commands()).toEqual(expect.arrayContaining(["setCell", "getCell", "ole.insert", "ole.update", "ruler.toggle", "getBytes"]));
    await api.run("setCell", "A2", "99");
    expect(await dispatchCommand<{ text: string }>(root, "xlsx-preview", "getCell", "A2")).toEqual({ text: "99", raw: "99" });
  });

  it("readonly menolak setCell dan memancarkan event readonly saat berubah", async () => {
    const { api } = await mount({ readonly: true });
    expect(api.setCell("A1", "x")).toBe(false);
    expect(api.getCell("A1")!.text).toBe("halo");
  });

  it("bus eksternal tetap hidup setelah unmount", async () => {
    const { createEventBus } = await import("../editor-kit/events");
    const bus = createEventBus<import("./XlsxPreview").XlsxPreviewEventMap>({ source: "xlsx-preview" });
    const ready = vi.fn();
    bus.on("ready", ready);
    await mount({ bus });
    expect(ready).toHaveBeenCalledTimes(1);
    const n = bus.listenerCount();
    unmount?.(); unmount = undefined;
    expect(bus.listenerCount()).toBe(n);
  });
});

describe("XlsxPreview — objek OLE", () => {
  it("sisip → event, daftar, tampil di grid, panel; perbarui; ubah ukuran; undo/redo", async () => {
    const { api, root } = await mount();
    const ins = vi.fn(), upd = vi.fn();
    api.on("ole:inserted", ins); api.on("ole:updated", upd);
    expect(api.ole.list()).toHaveLength(0);

    const info = (await api.ole.insert({ name: "catatan.txt", data: enc("isi satu") }, { cell: "C3", size: { wPx: 120, hPx: 60 } }))!;
    expect(info).toMatchObject({ progId: "Package", fileName: "catatan.txt", kind: "package", location: "Data!C3" });
    expect(info.id).toMatch(/^new:\d+$/);
    expect(ins).toHaveBeenCalledTimes(1);
    expect(api.getBook()!.dirty).toBe(true);
    expect(api.ole.list()).toHaveLength(1);
    expect(api.ole.list("Lain")).toHaveLength(0);
    expect(new TextDecoder().decode((await api.ole.getBytes(info.id))!).length).toBeGreaterThan(8);

    await wait(0);
    expect(root.querySelector(".xl-float.ole")).toBeTruthy(); // digambar sebagai objek OLE di grid
    expect(root.querySelector(".xl-ole-badge")!.textContent).toBe("OLE");

    const up = (await api.ole.update(info.id, { name: "hitung.xlsx", data: (await import("../office-shared/test-zip")).zipSync({ "[Content_Types].xml": "<x/>" }) }))!;
    expect(up).toMatchObject({ id: info.id, previousId: info.id, progId: "Excel.Sheet.12" });
    expect(upd).toHaveBeenCalledTimes(1);
    expect(api.ole.list()[0]).toMatchObject({ progId: "Excel.Sheet.12", fileName: "hitung.xlsx" });

    expect(api.ole.resize(info.id, 240, 120)).toBe(true);
    api.undo(); // urungkan ukuran
    api.undo(); // urungkan perbarui
    expect(api.ole.list()[0]).toMatchObject({ progId: "Package", fileName: "catatan.txt" });
    api.undo(); // urungkan sisip
    expect(api.ole.list()).toHaveLength(0);
    api.redo();
    expect(api.ole.list()).toHaveLength(1);
  });

  it("galat memancarkan ole:error: berkas kosong, id tak ada, sel tidak valid; readonly menolak", async () => {
    const { api } = await mount();
    const err = vi.fn();
    api.on("ole:error", err);
    expect(await api.ole.insert({ name: "kosong.bin", data: new Uint8Array() })).toBeUndefined();
    expect(await api.ole.insert({ name: "a.txt", data: enc("a") }, { cell: "zzz" })).toBeUndefined();
    expect(await api.ole.update("0:999", { name: "a.txt", data: enc("a") })).toBeUndefined();
    expect(api.ole.resize("0:999", 100, 100)).toBe(false);
    expect(err.mock.calls.map(c => c[0].action)).toEqual(["insert", "insert", "update", "resize"]);
    expect(err.mock.calls[1][0].message).toMatch(/tidak valid/);
    unmount?.(); unmount = undefined; document.body.innerHTML = "";
    const ro = await mount({ readonly: true });
    const err2 = vi.fn();
    ro.api.on("ole:error", err2);
    expect(await ro.api.ole.insert({ name: "a.txt", data: enc("a") })).toBeUndefined();
    expect(err2).toHaveBeenCalledWith(expect.objectContaining({ action: "insert", message: expect.stringMatching(/baca-saja/) }), expect.anything());
  });

  it("UI: tombol OLE membuka panel yang memuat objek; klik ganda di grid memancarkan ole:open", async () => {
    const { api, root } = await mount();
    const info = (await api.ole.insert({ name: "a.txt", data: enc("a") }))!;
    await api.run("setPanel", "ole");
    await wait(0);
    expect(root.textContent).toContain("Objek tertanam");
    expect(root.textContent).toContain("a.txt");
    const open = vi.fn();
    api.on("ole:open", open);
    const el = root.querySelector<HTMLElement>(".xl-float.ole")!;
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(open).toHaveBeenCalledWith({ id: info.id, progId: "Package" }, expect.anything());
  });
});

describe("XlsxPreview — penggaris & garis bantu", () => {
  it("event ruler, kontrol di menu Tampilan, dan hapus garis bantu", async () => {
    const { api, root } = await mount();
    const ev = vi.fn();
    api.on("ruler:visible", ev); api.on("ruler:guide-add", ev); api.on("ruler:measure", ev);
    api.ruler.setVisible(true);
    api.ruler.addGuide("x", 200);
    const m = api.ruler.measure(0, 0, 300, 400);
    expect(m.distance).toBe(500);
    expect(ev.mock.calls.length).toBe(3);
    const view = [...root.querySelectorAll<HTMLButtonElement>(".xl-btn")].find(b => /Tampilan/.test(b.textContent ?? ""))!;
    view.click();
    await wait(0);
    expect(root.querySelector("select[title='Satuan penggaran']")).toBeNull();
    expect(root.querySelector("select[title='Satuan penggaris']")).toBeTruthy();
    expect(root.textContent).toContain("Hapus garis bantu (1)");
    await api.run("ruler.clearGuides");
    expect(api.ruler.getGuides()).toHaveLength(0);
    expect(root.querySelector(".rk-frame.rk-on")).toBeTruthy();
  });

  it("opsi awal ruler={true}", async () => {
    const { api, root } = await mount({ ruler: true, rulerUnit: "in" });
    expect(api.ruler.isVisible()).toBe(true);
    expect(api.ruler.getUnit()).toBe("in");
    expect(root.querySelector(".rk-corner")).toBeTruthy();
  });
});
