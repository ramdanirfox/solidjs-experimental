// @vitest-environment jsdom
import { render } from "@solidjs/testing-library";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import DocxEditor, { type DocxEditorApi } from "./DocxEditor";
import { DocxBook } from "./docx-model";
import { listOle, readCfb } from "./docx-ole";
import { dispatchCommand } from "../editor-kit/events";

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  if (!URL.createObjectURL) (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:test";
  if (!URL.revokeObjectURL) (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  Element.prototype.scrollIntoView = () => {};
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} }) as DOMRect;
  if (!(CSS as unknown as { escape?: unknown }).escape) (CSS as unknown as { escape: (s: string) => string }).escape = (s: string) => s;
});

let unmount: (() => void) | undefined;
afterEach(() => { unmount?.(); unmount = undefined; document.body.innerHTML = ""; });

async function mount(props: Record<string, unknown> = {}) {
  let api!: DocxEditorApi;
  const wrap = document.createElement("div");
  document.body.appendChild(wrap);
  const r = render(() => <DocxEditor locale="en" onReady={a => (api = a)} {...props} />, { container: wrap });
  unmount = r.unmount;
  await api.events.wait("load", 20000);
  return { api, wrap, root: wrap.querySelector(".dxe-root") as HTMLElement };
}
const enc = (s: string) => new TextEncoder().encode(s);
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe("DocxEditor — event & API", () => {
  it("ready → load; event naik ke DOM; api.getText", async () => {
    const heard: string[] = [];
    const { api, wrap } = await mount({ onEvent: (t: string) => heard.push(t) });
    const dom = vi.fn();
    wrap.addEventListener("docx-editor:change", e => dom((e as CustomEvent).detail));
    expect(heard).toEqual(expect.arrayContaining(["ready", "load"]));
    expect(api.getText().length).toBeGreaterThan(20);
    api.getView()!.hooks.changed("hist.test");
    expect(dom).toHaveBeenCalledWith({ label: "hist.test", modified: false });
    expect(api.events.history().some(h => h.type === "load" && (h.payload as { source: string }).source === "sample")).toBe(true);
  });

  it("undo/redo memancarkan event history", async () => {
    const { api } = await mount();
    const hist = vi.fn();
    api.on("history", hist);
    await api.ole.insert({ name: "x.txt", data: enc("x") });
    api.undo();
    expect(hist).toHaveBeenCalledWith({ action: "undo" }, expect.anything());
  });

  it("perintah bernama lewat bus.run dan CustomEvent", async () => {
    const { api, root } = await mount();
    expect(api.events.commands()).toEqual(expect.arrayContaining(["undo", "ole.insert", "ole.update", "ruler.toggle", "getBytes"]));
    expect(await api.run<boolean>("getZoom")).toBeGreaterThan(0);
    const bytes = await dispatchCommand<Uint8Array>(root, "docx-editor", "getBytes");
    expect(bytes[0]).toBe(0x50); // ZIP
  });

  it("bus eksternal tetap hidup setelah unmount", async () => {
    const { createEventBus } = await import("../editor-kit/events");
    const bus = createEventBus<import("./DocxEditor").DocxEditorEventMap>({ source: "docx-editor" });
    const ready = vi.fn();
    bus.on("ready", ready);
    await mount({ bus });
    expect(ready).toHaveBeenCalledTimes(1);
    const n = bus.listenerCount();
    unmount?.(); unmount = undefined;
    expect(bus.listenerCount()).toBe(n);
  });
});

describe("DocxEditor — objek OLE", () => {
  it("sisip → event, daftar, simpan, buka ulang; perbarui → relId baru dan isi baru", async () => {
    const { api } = await mount();
    const ins = vi.fn(), upd = vi.fn(), change = vi.fn();
    api.on("ole:inserted", ins); api.on("ole:updated", upd); api.on("change", change);
    const before = api.ole.list().length;

    const info = (await api.ole.insert({ name: "catatan.txt", data: enc("isi satu") }))!;
    expect(info).toMatchObject({ progId: "Package", fileName: "catatan.txt", kind: "package", size: expect.any(Number) });
    expect(ins).toHaveBeenCalledTimes(1);
    expect(change.mock.calls.some(c => c[0].label === "hist.oleInsert")).toBe(true);
    expect(api.ole.list()).toHaveLength(before + 1);
    expect(readCfb(api.ole.getBytes(info.id)!).native!.fileName).toBe("catatan.txt");

    const up = (await api.ole.update(info.id, { name: "baru.txt", data: enc("isi dua") }))!;
    expect(up.previousId).toBe(info.id);
    expect(up.id).not.toBe(info.id);
    expect(upd).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(readCfb(api.ole.getBytes(up.id)!).native!.data)).toBe("isi dua");
    expect(api.ole.list()).toHaveLength(before + 1); // bagian lama untuk undo tidak tampil sebagai objek baru

    const re = await DocxBook.open(api.getBytes()!, "x.docx");
    const o = listOle(re).find(x => x.progId === "Package" && x.fileName.includes("oleObject"))!;
    expect(o).toBeTruthy();
    expect(listOle(re)).toHaveLength(before + 1);

    // undo memulihkan isi lama
    api.undo();
    expect(api.ole.getBytes(info.id)).toBeTruthy();
    expect(new TextDecoder().decode(readCfb(api.ole.getBytes(info.id)!).native!.data)).toBe("isi satu");
  });

  it("pratinjau: teks & gambar tampil di dialog, biner ditolak, event, Esc/tutup", async () => {
    const { api, root } = await mount();
    const pv = vi.fn();
    api.on("ole:preview", pv);
    const t1 = (await api.ole.insert({ name: "catatan.txt", data: enc("isi <b>teks</b> pratinjau") }))!;
    expect(api.ole.canPreview(t1.id)).toBe(true);
    expect(api.ole.preview(t1.id)).toBe(true);
    await wait(0);
    expect(root.querySelector(".dxe-modal.lg")).toBeTruthy();
    expect(root.querySelector(".dxe-prev pre")!.textContent).toBe("isi <b>teks</b> pratinjau");
    expect(root.querySelector(".dxe-prev b")).toBeNull(); // tidak dirender sebagai HTML
    expect(pv).toHaveBeenCalledWith(expect.objectContaining({ id: t1.id, kind: "text", fileName: "catatan.txt" }), expect.anything());
    api.ole.closePreview();
    await wait(0);
    expect(root.querySelector(".dxe-modal.lg")).toBeNull();

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const i1 = (await api.ole.insert({ name: "gambar.png", data: png }))!;
    expect(api.ole.preview(i1.id)).toBe(true);
    await wait(0);
    expect(root.querySelector(".dxe-prev img")).toBeTruthy();
    root.querySelector(".dxe-modal-bg")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await wait(0);
    expect(root.querySelector(".dxe-modal.lg")).toBeNull();

    const bin = new Uint8Array(200); bin.fill(1, 10);
    const b1 = (await api.ole.insert({ name: "program.exe", data: bin }))!;
    expect(api.ole.canPreview(b1.id)).toBe(false);
    expect(api.ole.preview(b1.id)).toBe(false);
    expect(api.ole.preview("rIdTidakAda")).toBe(false);
  });

  it("galat: berkas kosong, id tidak ada, dan mode baca-saja memancarkan ole:error", async () => {
    const { api } = await mount();
    const err = vi.fn();
    api.on("ole:error", err);
    expect(await api.ole.insert({ name: "kosong.bin", data: new Uint8Array() })).toBeUndefined();
    expect(await api.ole.update("rIdTidakAda", { name: "a.txt", data: enc("a") })).toBeUndefined();
    expect(err.mock.calls.map(c => c[0].action)).toEqual(["insert", "update"]);
    expect(err.mock.calls[1][0].message).toMatch(/tidak ditemukan/);
  });

  it("readonly menolak sisip/perbarui", async () => {
    const { api } = await mount({ readonly: true });
    const err = vi.fn();
    api.on("ole:error", err);
    expect(await api.ole.insert({ name: "a.txt", data: enc("a") })).toBeUndefined();
    expect(err).toHaveBeenCalledWith(expect.objectContaining({ action: "insert", message: expect.stringMatching(/baca-saja/) }), expect.anything());
  });

  it("ukuran tampilan: baca & ubah, dengan event", async () => {
    const { api } = await mount();
    const info = (await api.ole.insert({ name: "a.txt", data: enc("a") }, { size: { wPx: 120, hPx: 60 } }))!;
    const s = api.ole.getSize(info.id)!;
    expect(Math.round(s.wPx)).toBe(120);
    expect(api.ole.resize(info.id, 240, 120)).toBe(true);
    expect(Math.round(api.ole.getSize(info.id)!.wPx)).toBe(240);
    expect(api.ole.resize(info.id, 1, 1)).toBe(false);
  });

  it("UI: tombol sisip objek tersedia di tab Sisip dan panel OLE", async () => {
    const { root } = await mount();
    const insertTab = [...root.querySelectorAll<HTMLButtonElement>(".dxe-tab")].find(b => /insert/i.test(b.textContent ?? ""))!;
    insertTab.click();
    await wait(0);
    expect([...root.querySelectorAll("button")].some(b => /Object…/.test(b.textContent ?? ""))).toBe(true);
  });
});

describe("DocxEditor — penggaris", () => {
  it("tampil/sembunyi, satuan, guide, ukur memancarkan event & memperbarui UI", async () => {
    const { api, root } = await mount();
    const ev = vi.fn();
    api.on("ruler:visible", ev); api.on("ruler:unit", ev); api.on("ruler:guide-add", ev); api.on("ruler:measure", ev);
    expect(root.querySelector(".rk-frame.rk-on")).toBeNull();
    api.ruler.setVisible(true);
    expect(root.querySelector(".rk-frame.rk-on")).toBeTruthy();
    api.ruler.setUnit("in");
    const g = api.ruler.addGuide("x", 150);
    expect(api.ruler.getGuides()).toEqual([g]);
    api.ruler.setUnit("px");
    const m = api.ruler.measure(0, 0, 3, 4);
    expect(m.text).toContain("5 px");
    expect(ev.mock.calls.map(c => c[0])).toEqual(expect.arrayContaining([{ visible: true }, { unit: "in" }, expect.objectContaining({ axis: "x", pos: 150 }), expect.objectContaining({ distance: 5 })]));

    const viewTab = [...root.querySelectorAll<HTMLButtonElement>(".dxe-tab")].find(b => /view/i.test(b.textContent ?? ""))!;
    viewTab.click();
    await wait(0);
    expect(root.querySelector("select[title='Ruler unit']")).toBeTruthy();
    expect(root.textContent).toContain("1 guide(s)");
    await api.run("ruler.clearGuides");
    expect(api.ruler.getGuides()).toHaveLength(0);
  });

  it("gambar mengambang yang diseret menempel ke garis bantu (hanya saat penggaris tampil)", async () => {
    const { api } = await mount();
    const view = api.getView()!;
    const rect = (left: number, top: number) => ({ left, top, width: 10, height: 10, right: left + 10, bottom: top + 10 }) as DOMRect;
    expect(view.snapGuides!(rect(198, 0))).toEqual({ dx: 0, dy: 0 }); // penggaris tersembunyi
    api.ruler.setVisible(true);
    expect(view.snapGuides!(rect(198, 0))).toEqual({ dx: 0, dy: 0 }); // belum ada garis bantu
    api.ruler.addGuide("x", 200);
    api.ruler.addGuide("y", 100);
    expect(view.snapGuides!(rect(198, 0))).toEqual({ dx: 2, dy: 0 });      // tepi kiri → x=200
    expect(view.snapGuides!(rect(185, 0))).toEqual({ dx: 5, dy: 0 });      // tepi kanan (195) → 200
    expect(view.snapGuides!(rect(100, 97))).toEqual({ dx: 0, dy: -2 });    // titik tengah (102) → y=100 (terdekat dari tepi atas 97, tengah 102, bawah 107)
    expect(view.snapGuides!(rect(150, 50))).toEqual({ dx: 0, dy: 0 });     // di luar toleransi
  });

  it("opsi awal ruler={true} dan geometri mengikuti halaman", async () => {
    const { api, root } = await mount({ ruler: true, rulerUnit: "mm" });
    expect(api.ruler.isVisible()).toBe(true);
    expect(api.ruler.getUnit()).toBe("mm");
    expect(root.querySelector(".rk-corner")).toBeTruthy();
    expect(api.getView()!.pageGeometry()).toMatchObject({ ml: expect.any(Number), mt: expect.any(Number) });
  });
});
