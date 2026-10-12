// @vitest-environment jsdom
import { render } from "@solidjs/testing-library";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import DocxEditor, { type DocxEditorApi } from "./DocxEditor";
import { DocxBook } from "./docx-model";
import { listOle, readCfb } from "./docx-ole";
import { dispatchCommand } from "../editor-kit/events";
import { serialize } from "./docx-xml";

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


describe("DocxEditor — header/footer, penomoran halaman, daftar (bus & UI)", () => {
  it("hf.* lewat bus: sunting, sisip field, opsi, penomoran, event headerfooter", async () => {
    const { api, root } = await mount();
    const ev = vi.fn();
    api.on("headerfooter", ev);
    expect(api.events.commands()).toEqual(expect.arrayContaining(["hf.edit", "hf.exit", "hf.insertField", "hf.options", "hf.firstPage", "hf.oddEven", "hf.pageNumbering", "hf.remove"]));
    expect(await api.run("hf.edit", "ftr", 1)).toBe(true);
    [...root.querySelectorAll<HTMLElement>(".dxe-tab")].find(t => /Insert|Sisip/.test(t.textContent ?? ""))!.click();
    await new Promise(r => setTimeout(r, 0));
    expect([...root.querySelectorAll(".dxe-btn.primary")].map(b => b.textContent).join("|")).toMatch(/Close header|Tutup header/);
    await api.run("hf.insertField", "PAGE");
    expect((await api.run<{ editing: unknown }>("hf.options")).editing).toMatchObject({ kind: "ftr", page: 1 });
    await api.run("hf.exit");
    expect(ev.mock.calls.map(c => c[0].action)).toEqual(expect.arrayContaining(["enter", "field", "exit"]));
    await api.run("hf.pageNumbering", { start: 3, fmt: "upperRoman" });
    expect(await api.run("hf.options")).toMatchObject({ pgStart: 3, pgFmt: "upperRoman" });
    expect(root.querySelector(".dx-page .dx-ftr")?.textContent).toContain("III");
    await api.run("hf.firstPage", true);
    expect((await api.run<{ titlePg: boolean }>("hf.options")).titlePg).toBe(true);
    // via CustomEvent DOM
    expect(await dispatchCommand<{ section: number }>(root, "docx-editor", "hf.options")).toMatchObject({ section: 0 });
    // UI: kontrol di tab Sisip
    api.getView()!.paginate();
    const btns = [...root.querySelectorAll<HTMLElement>(".dxe-btn")].map(b => b.textContent ?? "");
    expect(btns.some(t => /Header/.test(t))).toBe(true);
    expect(btns.some(t => /Footer/.test(t))).toBe(true);
  });

  it("list.* lewat bus: galeri, restart, nilai awal, info; readonly menolak", async () => {
    const { api } = await mount();
    const view = api.getView()!;
    expect((await api.run<unknown[]>("list.presets")).length).toBeGreaterThanOrEqual(13);
    const book = api.getBook()!;
    const p = [...book.paragraphs()].map(x => x.p).find(x => book.parentOf(x) === book.body && !view.listInfoAtCaret() && x.children.length > 1)!;
    view.selectRange(p, 0, 0);
    expect(await api.run("list.apply", "alpha-upper")).toBe(true);
    expect(await api.run<{ preset: string; kind: string }>("list.info")).toMatchObject({ kind: "number", preset: "alpha-upper" });
    expect(await api.run("list.setStart", 7)).toBe(true);
    expect((await api.run<{ start: number }>("list.info")).start).toBe(7);
    expect(await api.run("list.restart")).toBe(true);
    expect(await api.run("list.apply", "nope")).toBe(false);
  });

  it("readonly: hf & list menolak", async () => {
    const { api } = await mount({ readonly: true });
    expect(api.headerFooter.edit("hdr", 1)).toBe(false);
    expect(api.lists.apply("num-dot")).toBe(false);
    expect(api.headerFooter.setDifferentOddEven(true)).toBe(false);
  });
});


describe("DocxEditor — format.* & struktur lewat bus", () => {
  it("format.apply/get/keys, paragraph.*, table.*, event format/structure, DOM CustomEvent", async () => {
    const { api, root } = await mount();
    const fmt = vi.fn(), st = vi.fn();
    api.on("format", fmt); api.on("structure", st);
    expect(api.events.commands()).toEqual(expect.arrayContaining(["format.apply", "format.get", "format.keys", "paragraph.insert", "table.apply", "pageBreak.insert"]));
    expect(await api.run<string[]>("format.keys")).toContain("colorAlpha");
    const rep = await api.run<{ applied: string[]; targets: number }>("format.apply", { target: { kind: "paragraph", index: 2 }, props: { bold: true, color: "#0000FF", colorAlpha: 0.25, fill: "#FFFF00" } });
    expect(rep.targets).toBe(1);
    expect(rep.applied).toEqual(expect.arrayContaining(["bold", "color", "fill"]));
    expect(fmt).toHaveBeenCalledTimes(1);
    expect((await api.run<{ bold: boolean }>("format.get", { kind: "paragraph", index: 2 })).bold).toBe(true);
    const n0 = await api.run<number>("paragraph.count");
    const idx = await api.run<number>("paragraph.insert", { text: "dari bus", after: 1 });
    expect(idx).toBe(2);
    expect(await api.run<number>("paragraph.count")).toBe(n0 + 1);
    const ti = await dispatchCommand<number>(root, "docx-editor", "table.insert", 2, 2, 1);
    expect(ti).toBeGreaterThan(0);
    expect(await api.run("table.apply", { index: ti, op: "insertColRight", col: 1 })).toBe(true);
    expect((await api.run<{ cols: number; index: number }[]>("table.list")).find(t => t.index === ti)!.cols).toBe(3);
    expect(await api.run("table.apply", { index: ti, op: "nope" })).toBe(false);
    expect(await api.run<string[]>("table.ops")).toContain("merge");
    expect(st.mock.calls.map(c => c[0].scope + "." + c[0].action)).toEqual(expect.arrayContaining(["paragraph.insert", "table.insert", "table.insertColRight"]));
  });

  it("readonly: format & struktur menolak", async () => {
    const { api } = await mount({ readonly: true });
    expect(api.format.apply({ props: { bold: true } }).targets).toBe(0);
    expect(api.blocks.insertParagraph({ text: "x" })).toBeUndefined();
    expect(api.tables.insert(2, 2)).toBeUndefined();
    expect(api.blocks.insertPageBreak()).toBe(false);
  });
});


describe("DocxEditor — layout (mode tata letak)", () => {
  it("prop layout → data-layout; layout.get/set lewat bus & API; event layout; nilai tak valid ditolak", async () => {
    const { api, root } = await mount({ layout: "touch" });
    expect(root.dataset.layout).toBe("touch");
    expect(api.layout.get().mode).toBe("touch");
    expect(api.layout.get().setting).toBe("touch");
    const ev = vi.fn();
    api.on("layout", ev);
    expect(await api.run("layout.set", "compact")).toBe(true);
    expect(root.dataset.layout).toBe("compact");
    expect(ev.mock.calls.at(-1)![0]).toMatchObject({ mode: "compact", setting: "compact" });
    expect((await dispatchCommand<{ mode: string }>(root, "docx-editor", "layout.get")).mode).toBe("compact");
    expect(await api.run("layout.set", "phone")).toBe(false);
    expect(root.dataset.layout).toBe("compact");
    expect(api.layout.set("auto")).toBe(true);
    expect(api.layout.get().setting).toBe("auto");
    expect(api.events.commands()).toEqual(expect.arrayContaining(["layout.get", "layout.set"]));
  });

  it("tanpa prop: auto → desktop di lingkungan uji (lebar 0, pointer halus)", async () => {
    const { root } = await mount();
    expect(root.dataset.layout).toBe("desktop");
  });
});


describe("DocxEditor — drop (jalur bersama)", () => {
  // jsdom belum punya Blob.arrayBuffer
  if (!File.prototype.arrayBuffer) File.prototype.arrayBuffer = function (this: Blob) { return new Promise<ArrayBuffer>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result as ArrayBuffer); fr.onerror = () => rej(fr.error); fr.readAsArrayBuffer(this); }); };
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const png = () => new File([Uint8Array.from(atob(PNG), c => c.charCodeAt(0))], "p.png", { type: "image/png" });

  it("gambar, teks, url, berkas office lewat api.drop.handle & bus; event drop; saringan jenis", async () => {
    const { api } = await mount();
    const ev = vi.fn();
    api.on("drop", ev);
    expect(api.events.commands()).toEqual(expect.arrayContaining(["drop.handle", "drop.accept"]));
    expect(await api.run<string[]>("drop.accept")).toEqual(["image", "office", "text", "url"]);
    const draw0 = (api.getText().match(/\[image\]/g) ?? []).length;
    const body = () => serialize(api.getBook()!.body);
    const n0 = (body().match(/<w:drawing/g) ?? []).length;
    const r = await api.run<{ handled: unknown[]; rejected: unknown[] }>("drop.handle", { files: [png()] });
    expect(r.handled).toHaveLength(1);
    expect((body().match(/<w:drawing/g) ?? []).length).toBe(n0 + 1);
    void draw0;
    const t = await api.drop.handle({ text: "Teks jatuhan\nbaris dua" });
    expect(t.handled).toHaveLength(1);
    expect(api.getText()).toContain("Teks jatuhan");
    expect(api.getText()).toContain("baris dua");
    expect((await api.drop.handle({ url: "https://example.com/drop" })).handled).toHaveLength(1);
    expect(api.getText()).toContain("https://example.com/drop");
    expect(ev.mock.calls.map(c => c[0].info.items.map((i: { kind: string }) => i.kind))).toEqual([["image"], ["text"], ["url"]]);
    expect(ev).toHaveBeenCalledTimes(3);
    expect(ev.mock.calls[0][0].report.handled[0].kind).toBe("image");
    // berkas sembarang tidak diterima kecuali diminta
    const pdf = new File(["%PDF"], "a.pdf", { type: "application/pdf" });
    expect((await api.drop.handle({ files: [pdf] })).rejected[0]).toMatchObject({ reason: "not-accepted" });
    expect(await api.run("drop.accept", ["image"])).toBe(true);
    expect((await api.drop.handle({ text: "x" })).rejected[0]).toMatchObject({ reason: "not-accepted" });
    expect(await api.run("drop.accept", ["bogus"])).toBe(false);
    // berkas docx dibuka
    (window as unknown as { confirm: () => boolean }).confirm = () => true;
    api.drop.setAccept(["office"]);
    const bytes = (await api.getBytes())!;
    const loaded = api.events.wait("load", 10000);
    const o = await api.drop.handle({ files: [new File([bytes as BlobPart], "lain.docx")] });
    expect(o.handled).toHaveLength(1);
    await loaded;
  });

  it("before membatalkan, readonly menolak, drop={false} menonaktifkan", async () => {
    const a = await mount({ drop: { before: () => false } });
    expect((await a.api.drop.handle({ text: "x" })).cancelled).toBe(true);
    unmount?.(); document.body.innerHTML = "";
    const b = await mount({ readonly: true });
    expect((await b.api.drop.handle({ text: "x" })).rejected[0]).toMatchObject({ reason: "readonly" });
    unmount?.(); document.body.innerHTML = "";
    const c = await mount({ drop: false });
    expect(c.api.drop.accept()).toEqual([]);
    expect((await c.api.drop.handle({ text: "x" })).handled).toEqual([]);
  });
});
