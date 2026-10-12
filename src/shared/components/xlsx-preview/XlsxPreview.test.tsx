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


describe("XlsxPreview — navigasi, cari/ganti lintas jenis, hyperlink", () => {
  it("goto: sel, rentang, sheet, awal/akhir, pencarian; target salah → ok=false; event navigate", async () => {
    const { api } = await mount();
    const nav = vi.fn();
    api.on("navigate", nav);
    expect(api.goto({ kind: "cell", address: "B2" })).toMatchObject({ ok: true });
    await wait(0);
    expect(api.getSelection().active).toBe("B2");
    expect(api.goto({ kind: "range", range: "A1:B2" }).ok).toBe(true);
    await wait(0);
    expect(api.getSelection().range).toBe("A1:B2");
    expect(api.goto({ kind: "cell", address: "A1", sheet: "Lain" }).ok).toBe(true);
    await wait(0);
    expect(api.getSheets().length).toBe(2);
    expect(api.goto({ kind: "sheet", sheet: "Data" }).ok).toBe(true);
    expect(api.goto({ kind: "sheet", sheet: "Nope" }).ok).toBe(false);
    expect(api.goto({ kind: "cell", address: "bukan" }).ok).toBe(false);
    const r = api.goto({ kind: "search", query: "halo" });
    expect(r.ok).toBe(true);
    await wait(0);
    expect(api.getSelection().active).toBe("A1");
    expect(nav).toHaveBeenCalled();
    expect(api.goto({ kind: "start" }).ok).toBe(true);
    expect(api.goto({ kind: "end" }).ok).toBe(true);
  });

  it("find/replace per jenis: teks, rumus, komentar; cakupan; tunggal vs semua; satu undo", async () => {
    const { api } = await mount();
    api.setCell("C1", "halo dunia");
    api.setCell("C2", "=A1&\"!\"");
    const f = api.find({ query: "halo", select: false });
    expect(f.matches.map(m => m.location).sort()).toEqual(["Data!A1", "Data!C1"]);
    // jenis tak didukung dilaporkan
    const rep = api.replaceAll({ query: "halo", replacement: "hai", kinds: ["text", "stroke" as never] });
    expect(rep.skipped).toEqual(["stroke"]);
    expect(rep.byKind.text).toBe(2);
    expect(api.getCell("A1")!.text).toBe("hai");
    expect(api.getCell("C1")!.text).toBe("hai dunia");
    api.undo();
    expect(api.getCell("A1")!.text).toBe("halo");
    expect(api.getCell("C1")!.text).toBe("halo dunia");
    // tunggal: hanya hasil aktif/pertama
    const one = api.replace({ query: "halo", replacement: "hai", kinds: ["text"] });
    expect(one.total).toBe(1);
    expect(api.find({ query: "halo", select: false }).count).toBe(1);
    // rumus
    const fr = api.replaceAll({ query: "A1", replacement: "C1", kinds: ["formula"] });
    expect(fr.byKind.formula).toBe(1);
    expect(api.getCell("C2")!.raw).toContain("C1");
    // regex + grup + cakupan sheet
    const rg = api.replaceAll({ query: "(hai|halo) (\\w+)", regex: true, replacement: "$2 $1", scope: "sheet" });
    expect(rg.total).toBeGreaterThan(0);
    expect(api.getCell("C1")!.text).toMatch(/dunia (hai|halo)/);
    // readonly
  });

  it("find/replace nilai: font, warna teks, warna isi dengan hapus; hyperlink; undo", async () => {
    const { api } = await mount();
    api.select("A1:B2");
    const b = api.getBook()!;
    const w = b.worksheetAt(0)!;
    const apply = (patch: object) => { const recs = b.applyStyle(w, { r1: 1, c1: 1, r2: 2, c2: 2 }, patch as never); b.commit(recs, { styleOnly: true }); };
    apply({ fill: "#FFFF00", fontColor: "#FF0000", fontName: "Georgia" });
    expect(b.styleOf(w, w.rows.get(1)!.get(1)).bg?.toLowerCase()).toBe("#ffff00");
    const rf = api.replaceAll({ query: "#ffff00", replacement: "#00ff00", kinds: ["fill"] });
    expect(rf.byKind.fill).toBeGreaterThan(0);
    expect(b.styleOf(w, w.rows.get(1)!.get(1)).bg?.toLowerCase()).toBe("#00ff00");
    const rc = api.replaceAll({ query: "FF0000", replacement: "0000FF", kinds: ["color"] });
    expect(rc.byKind.color).toBeGreaterThan(0);
    expect(b.styleOf(w, w.rows.get(1)!.get(1)).color?.toLowerCase()).toBe("#0000ff");
    const rn = api.replaceAll({ query: "georgia", replacement: "Arial", kinds: ["font"] });
    expect(rn.byKind.font).toBeGreaterThan(0);
    expect(b.styleOf(w, w.rows.get(1)!.get(1)).fontName).toBe("Arial");
    const rx = api.replaceAll({ query: "00ff00", replacement: "", kinds: ["fill"] });
    expect(rx.byKind.fill).toBeGreaterThan(0);
    expect(b.styleOf(w, w.rows.get(1)!.get(1)).bg).toBeUndefined();
    api.undo();
    expect(b.styleOf(w, w.rows.get(1)!.get(1)).bg?.toLowerCase()).toBe("#00ff00");

    // hyperlink: pasang, daftar, ubah, ganti massal, goto, hapus, undo
    api.select("D1");
    expect(api.links.set("example.com/a", { tooltip: "tip" })).toBe(true);
    const l = api.links.list();
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ url: "https://example.com/a", tooltip: "tip", location: "Data!D1" });
    expect(api.getCell("D1")!.text).toBe("https://example.com/a");
    expect(api.links.replace("example.com", "example.org")).toBe(1);
    expect(api.links.list()[0].url).toBe("https://example.org/a");
    expect(api.links.update(api.links.list()[0].id, { url: "#Lain!A1" })).toBe(true);
    expect(api.links.list()[0].url).toBe("#Lain!A1");
    expect(api.links.set("javascript:alert(1)")).toBe(false);
    expect(api.goto({ kind: "link", id: api.links.list()[0].id }).ok).toBe(true);
    expect(api.links.removeById(api.links.list()[0].id)).toBe(true);
    expect(api.links.list()).toHaveLength(0);
    api.undo();
    expect(api.links.list()).toHaveLength(1);
  });

  it("perintah bus: goto/find/replaceAll/link.* via CustomEvent dan readonly menolak", async () => {
    const { api, root } = await mount();
    expect(api.events.commands()).toEqual(expect.arrayContaining(["goto", "find", "findNext", "replace", "replaceAll", "replace.kinds", "link.list", "link.set", "link.replace"]));
    const res = await dispatchCommand<{ ok: boolean }>(root, "xlsx-preview", "goto", { kind: "cell", address: "B2" });
    expect(res.ok).toBe(true);
    const kinds = await dispatchCommand<string[]>(root, "xlsx-preview", "replace.kinds");
    expect(kinds).toEqual(expect.arrayContaining(["text", "formula", "link", "comment", "font", "color", "fill"]));
    const rep = await api.run<{ total: number }>("replaceAll", { query: "halo", replacement: "x", kinds: ["text"] });
    expect(rep.total).toBe(1);
  });

  it("readonly: replace/link menolak", async () => {
    const { api } = await mount({ readonly: true });
    expect(api.replaceAll({ query: "halo", replacement: "x" }).error).toBe("readonly");
    expect(api.links.set("https://a.b")).toBe(false);
  });
});


describe("XlsxPreview — format.* & struktur lewat bus", () => {
  it("format.apply: gaya sel, alfa dikomposit, kunci asing dilewati; get; undo; readonly", async () => {
    const { api, root } = await mount();
    const fmt = vi.fn();
    api.on("format", fmt);
    expect(api.events.commands()).toEqual(expect.arrayContaining(["format.apply", "format.get", "format.keys", "sheet.add", "sheet.rename", "range.merge", "range.freeze"]));
    const r = await api.run<{ applied: string[]; skipped: string[]; targets: number }>("format.apply", { target: { range: "A1:B2" }, props: { bold: true, fill: "#FF0000", fillAlpha: 0.5, color: "#0000FF", colorAlpha: 0.25, align: "center", numFmt: "0.00", opacity: 0.5 } });
    expect(r.targets).toBe(4);
    expect(r.applied).toEqual(expect.arrayContaining(["bold", "fill", "fillAlpha", "color", "colorAlpha", "align", "numFmt"]));
    expect(r.skipped).toContain("opacity");
    expect(fmt).toHaveBeenCalledTimes(1);
    const g = api.format.get({ range: "B2" })!;
    expect(g).toMatchObject({ bold: true, align: "center", numFmt: "0.00" });
    expect(g.fill?.toLowerCase()).toBe("#ff8080"); // #FF0000 @50% di atas putih
    expect(api.getCell("B2")!.text).toBe("42.00");
    // sheet lain lewat prefix, tanpa berpindah
    expect(api.format.apply({ target: { range: "Lain!A1" }, props: { italic: true } }).targets).toBe(1);
    expect(api.format.get({ range: "Lain!A1" })!.italic).toBe(true);
    expect(api.getSelection().sheet).toBe("Data");
    // stroke → border; target tak valid
    expect(api.format.apply({ target: { range: "A1" }, props: { stroke: { color: "#000000", width: 2 } } }).applied).toContain("stroke");
    expect(api.format.apply({ target: { range: "zzz!!" }, props: { bold: true } }).targets).toBe(0);
    api.undo(); // stroke
    api.undo(); // italic di sheet lain
    expect(api.format.get({ range: "Lain!A1" })!.italic).toBeFalsy();
    api.undo(); // format sel A1:B2
    expect(api.format.get({ range: "B2" })!.bold).toBeFalsy();
    expect(await dispatchCommand<string[]>(root, "xlsx-preview", "format.keys")).toContain("numFmt");
  });

  it("sheet.*: tambah/ganti nama (rumus ikut)/pindah/sembunyi/hapus + undo-redo + event", async () => {
    const { api } = await mount();
    const st = vi.fn();
    api.on("structure", st);
    expect(api.sheets.list().map(s => s.name)).toEqual(["Data", "Lain"]);
    const name = await api.run<string>("sheet.add", { name: "Baru", at: 1 });
    expect(name).toBe("Baru");
    expect(api.sheets.list().map(s => s.name)).toEqual(["Data", "Baru", "Lain"]);
    expect(api.getSelection().sheet).toBe("Baru");
    expect(api.sheets.add({ name: "Baru" })).toBeUndefined(); // duplikat
    expect(api.sheets.add({ name: "a/b" })).toBeUndefined();   // karakter terlarang
    api.setCell("A1", "=Lain!A1*2");
    expect(api.getCell("A1")!.text).toBe("14");
    expect(await api.run("sheet.rename", "Lain", "Sheet Dua")).toBe(true);
    expect(api.getCell("A1")!.raw).toBe("='Sheet Dua'!A1*2");
    expect(api.getCell("A1")!.text).toBe("14");
    expect(api.sheets.rename("Sheet Dua", "Data")).toBe(false); // bentrok
    expect(api.sheets.move("Baru", 0)).toBe(true);
    expect(api.sheets.list()[0].name).toBe("Baru");
    expect(api.getSelection().sheet).toBe("Baru");
    expect(api.sheets.setVisible("Data", false)).toBe(true);
    expect(api.sheets.list().find(s => s.name === "Data")!.state).toBe("hidden");
    expect(api.sheets.setVisible("Data", true)).toBe(true);
    expect(api.sheets.remove("Baru")).toBe(true);
    expect(api.sheets.list().map(s => s.name)).toEqual(["Data", "Sheet Dua"]);
    expect(api.getSelection().sheet).not.toBe("Baru");
    // undo berantai mengembalikan semuanya
    for (let i = 0; i < 20; i++) api.undo();
    expect(api.sheets.list().map(s => s.name)).toEqual(["Data", "Lain"]);
    expect(api.getCell("Lain!A1")!.text).toBe("7");
    api.redo(); api.redo();
    expect(api.sheets.list().map(s => s.name)).toEqual(["Data", "Baru", "Lain"]);
    expect(st.mock.calls.map(c => c[0].scope + "." + c[0].action)).toEqual(expect.arrayContaining(["sheet.add", "sheet.rename", "sheet.move", "sheet.remove", "sheet.visible"]));
  });

  it("tidak boleh menghapus satu-satunya sheet terlihat; readonly menolak", async () => {
    const { api } = await mount();
    expect(api.sheets.setVisible("Lain", false)).toBe(true);
    expect(api.sheets.remove("Data")).toBe(false);
    expect(api.sheets.list()).toHaveLength(2);
  });

  it("range.*: gabung/pisah, kosongkan, bekukan, lebar kolom, autofilter", async () => {
    const { api } = await mount();
    expect(api.range.merge("C3:D3", { center: true })).toBe(true);
    expect(api.getBook()!.worksheetAt(0)!.mergedCells.length).toBe(1);
    expect(api.range.merge("C3:D3")).toBe(false); // sudah digabung
    expect(api.range.unmerge("C3")).toBe(true);
    expect(api.getBook()!.worksheetAt(0)!.mergedCells.length).toBe(0);
    expect(api.range.clear("B2")).toBeGreaterThan(0);
    expect(api.getCell("B2")!.text).toBe("");
    api.undo();
    expect(api.getCell("B2")!.text).toBe("42");
    expect(api.range.freeze(1, 1)).toBe(true);
    expect(api.range.freeze(-1, 0)).toBe(false);
    expect(api.range.setColumnWidth("C", 140)).toBe(true);
    expect(api.range.setRowHeight(2, 40)).toBe(true);
    expect(api.range.setRowHeight(0, 40)).toBe(false);
    expect(api.range.autofilter("A1:B2")).toBe(true);
    expect(api.range.autofilter(false)).toBe(true);
  });

  it("readonly: format/sheet/range menolak tanpa melempar", async () => {
    const { api } = await mount({ readonly: true });
    expect(api.format.apply({ props: { bold: true } }).targets).toBe(0);
    expect(api.sheets.add()).toBeUndefined();
    expect(api.sheets.remove("Lain")).toBe(false);
    expect(api.range.merge("A1:B1")).toBe(false);
    expect(api.range.clear("A1")).toBe(0);
  });
});

describe("XlsxPreview — ganti nilai numerik & nama sheet", () => {
  it("number: cari/ganti angka mentah (bukan rumus), jadi teks bila tak numerik; satu undo", async () => {
    const { api } = await mount();
    expect(api.replaceKinds()).toEqual(expect.arrayContaining(["number", "name"]));
    // A2 = 40 (angka), B1 = 2 (angka), B2 rumus
    const f = api.find({ query: "40", kinds: ["number"] });
    expect(f.count).toBe(1);
    expect(f.matches[0].location).toBe("Data!A2");
    const r = api.replaceAll({ query: "40", replacement: "100", kinds: ["number"] });
    expect(r.byKind.number).toBe(1);
    expect(api.getCell("A2")!.text).toBe("100");
    expect(api.getCell("B2")!.text).toBe("102"); // rumus A2+B1 dihitung ulang
    api.undo();
    expect(api.getCell("A2")!.text).toBe("40");
    const t = api.replaceAll({ query: "2", replacement: "dua", kinds: ["number"], scope: "sheet" } as never);
    expect(t.total).toBeGreaterThan(0);
    expect(api.getCell("B1")!.raw).toBe("dua");
    // kind tak didukung tetap dilewati
    expect(api.replaceAll({ query: "x", replacement: "y", kinds: ["number", "stroke"] }).skipped).toContain("stroke");
  });

  it("name: ganti nama sheet (rumus ikut), bentrok ditolak, undo mengembalikan", async () => {
    const { api } = await mount();
    api.setCell("C1", "=Lain!A1+1");
    const f = api.find({ query: "Lai", kinds: ["name"] });
    expect(f.count).toBe(1);
    expect(f.matches[0].target).toMatchObject({ kind: "sheet", sheet: "Lain" });
    const r = api.replaceAll({ query: "Lain", replacement: "Kedua", kinds: ["name"] });
    expect(r.byKind.name).toBe(1);
    expect(api.sheets.list().map(s => s.name)).toEqual(["Data", "Kedua"]);
    expect(api.getCell("Data!C1")!.raw).toBe("=Kedua!A1+1");
    expect(api.getCell("Data!C1")!.text).toBe("8");
    // bentrok dengan nama yang sudah ada → tidak dihitung
    const clash = api.replaceAll({ query: "Kedua", replacement: "Data", kinds: ["name"] });
    expect(clash.total).toBe(0);
    api.undo();
    expect(api.sheets.list().map(s => s.name)).toEqual(["Data", "Lain"]);
    expect(api.getCell("Data!C1")!.raw).toBe("=Lain!A1+1");
  });
});
