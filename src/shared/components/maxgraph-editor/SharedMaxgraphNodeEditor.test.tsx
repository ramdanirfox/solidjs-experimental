// @vitest-environment jsdom
import { render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import SharedMaxgraphNodeEditor from "./SharedMaxgraphNodeEditor";
import { dispatchCommand } from "../editor-kit/events";
import type { MaxgraphNodeEditorApi } from "./types";

const drawio = (shape: string) => `<mxfile><diagram id="p1" name="Satu"><mxGraphModel grid="1" gridSize="10"><root><mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="a" value="A" style="rounded=1;fillColor=#dae8fc;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="100" height="50" as="geometry"/></mxCell>
<mxCell id="b" value="B" style="shape=${shape};fillColor=#f8cecc;" vertex="1" parent="1"><mxGeometry x="240" y="40" width="100" height="50" as="geometry"/></mxCell>
<mxCell id="e" value="" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>
</root></mxGraphModel></diagram><diagram id="p2" name="Dua"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="c" value="C" vertex="1" parent="1"><mxGeometry x="10" y="10" width="60" height="30" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`;
// registry stensil bersifat global: bentuk "tak dikenal" harus unik per skenario
const DRAWIO = drawio("mxgraph.nope.unknown_shape");

const STENCIL = `<shapes name="mxgraph.test"><shape name="Arrow Box" w="100" h="50" aspect="variable" strokewidth="inherit"><connections/><background><path><move x="0" y="10"/><line x="70" y="10"/><line x="70" y="0"/><line x="100" y="25"/><line x="70" y="50"/><line x="70" y="40"/><line x="0" y="40"/><close/></path></background><foreground><fillstroke/></foreground></shape>
<shape name="Broken" w="0" h="10"><background/></shape></shapes>`;

let unmount: (() => void) | undefined;
afterEach(() => { unmount?.(); unmount = undefined; document.body.innerHTML = ""; });

function mount(props: Record<string, unknown> = {}) {
  let api!: MaxgraphNodeEditorApi;
  const wrap = document.createElement("div");
  document.body.appendChild(wrap);
  const r = render(() => <SharedMaxgraphNodeEditor height={500} onReady={a => (api = a)} {...props} />, { container: wrap });
  unmount = r.unmount;
  return { api, wrap, root: wrap.querySelector(".mgx-root") as HTMLElement };
}
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe("SharedMaxgraphNodeEditor — event", () => {
  it("memancarkan event ke bus, onEvent, dan CustomEvent DOM", async () => {
    const onEvent = vi.fn();
    const { api, wrap } = mount({ onEvent });
    const domHeard = vi.fn();
    wrap.addEventListener("maxgraph-editor:node-added", e => domHeard((e as CustomEvent).detail));
    const added = vi.fn(), sel = vi.fn(), cells = vi.fn(), change = vi.fn();
    api.on("node-added", added); api.on("selection", sel); api.on("cells-added", cells); api.on("change", change);

    const cell = api.addNode("process", 40, 40, "Satu")!;
    expect(cell).toBeTruthy();
    expect(added).toHaveBeenCalledTimes(1);
    expect(added.mock.calls[0][0].type.id).toBe("process");
    expect(domHeard).toHaveBeenCalledTimes(1);
    expect(sel).toHaveBeenCalled();
    expect(cells).toHaveBeenCalled();
    expect(onEvent.mock.calls.some(c => c[0] === "node-added")).toBe(true);
    await wait(300);
    expect(change).toHaveBeenCalledTimes(1); // didebounce
    expect(change.mock.calls[0][0].xml).toContain("Satu");
    expect(api.events.history().some(h => h.type === "ready")).toBe(true);
  });

  it("perintah lewat bus.run dan lewat CustomEvent DOM", async () => {
    const { api, wrap } = mount();
    const c = await api.run<{ getId(): string }>("addNode", "start", 10, 10, "X");
    expect(c.getId()).toBeTruthy();
    expect(api.events.commands()).toEqual(expect.arrayContaining(["addNode", "importDrawio", "exportDrawio", "importShapes", "undo", "getInfo"]));
    const root = wrap.querySelector(".mgx-root") as HTMLElement;
    const info = await dispatchCommand<{ cells: { vertices: number } }>(root, "maxgraph-editor", "getInfo");
    expect(info.cells.vertices).toBe(1);
    await expect(api.run("tidakAda")).rejects.toThrow(/tidak dikenal/);
  });

  it("event history undo/redo dan zoom", () => {
    const { api } = mount();
    const hist = vi.fn(), zoom = vi.fn();
    api.on("history", hist); api.on("zoom", zoom);
    api.addNode("start", 0, 0);
    api.undo();
    expect(hist).toHaveBeenCalledWith({ action: "undo", canUndo: false, canRedo: true }, expect.anything());
    api.zoomActual();
  });

  it("bus eksternal dari aplikasi dipakai dan tidak dibersihkan saat unmount", async () => {
    const { createEventBus } = await import("../editor-kit/events");
    const bus = createEventBus<import("./types").MaxgraphEventMap>({ source: "maxgraph-editor" });
    const ready = vi.fn();
    bus.on("ready", ready);
    mount({ bus });
    expect(ready).toHaveBeenCalledTimes(1);
    const n = bus.listenerCount();
    unmount?.(); unmount = undefined;
    expect(bus.listenerCount()).toBe(n);
  });
});

describe("SharedMaxgraphNodeEditor — draw.io", () => {
  it("impor mxfile 2 halaman, laporan, ganti halaman, ekspor kembali", async () => {
    const { api, root } = mount();
    const imported = vi.fn(), page = vi.fn();
    api.on("import", imported); api.on("page", page);
    const report = await api.importDrawio(DRAWIO);
    expect(report).toMatchObject({ format: "mxfile", pageCount: 2, cells: { vertices: 2, edges: 1 } });
    expect(report!.unknownShapes).toEqual(["mxgraph.nope.unknown_shape"]);
    expect(imported).toHaveBeenCalledTimes(1);
    expect(api.getPages().map(p => p.name)).toEqual(["Satu", "Dua"]);
    expect(root.querySelector("select[title='Halaman diagram draw.io']")).toBeTruthy();

    await api.setPage("Dua");
    expect(page).toHaveBeenLastCalledWith({ index: 1, id: "p2", name: "Dua", count: 2 }, expect.anything());
    expect(api.getInfo().cells.vertices).toBe(1);
    await expect(api.setPage("tidak-ada")).rejects.toThrow(/tidak ditemukan/);
    await api.setPage(0);
    expect(api.getInfo().cells.vertices).toBe(2);

    const out = await api.exportDrawio({ compress: true });
    expect(out).toContain("<mxfile");
    const back = await api.importDrawio(out, { mode: "replace" });
    expect(back!.pageCount).toBe(2);
    expect(back!.compressed).toBe(true);
    expect(api.getInfo().cells.vertices).toBe(2);
  });

  it("impor atomik: berkas rusak tidak menghapus diagram yang terbuka, galat tampil dan tercatat", async () => {
    const { api, root } = mount();
    api.addNode("start", 0, 0);
    const err = vi.fn(), onError = vi.fn();
    api.on("error", err);
    await expect(api.importDrawio("<mxfile><diagram")).rejects.toThrow(/XML tidak valid/);
    await expect(api.importDrawio("<svg/>")).rejects.toThrow(/Bukan draw.io/);
    expect(api.getInfo().cells.vertices).toBe(1);
    expect(err).toHaveBeenCalledTimes(2);
    expect(root.querySelector(".mgx-notice[role='alert']")).toBeTruthy();
    const failed = api.logger.entries({ onlyFailed: true });
    expect(failed.some(e => e.ok === false && /Impor draw\.io/.test(e.message) && e.why)).toBe(true);
    void onError;
  });

  it("setXml: XML asli rusak tidak mengosongkan diagram", () => {
    const { api } = mount();
    api.addNode("start", 0, 0);
    api.setXml("<GraphDataModel><root><Cell");
    expect(api.getInfo().cells.vertices).toBe(1);
    // XML asli yang valid tetap dapat dimuat ulang
    const xml = api.getXml();
    api.clear();
    api.setXml(xml);
    expect(api.getInfo().cells.vertices).toBe(1);
  });

  it("merge menambahkan ke diagram yang ada dan memilih sel baru", async () => {
    const { api } = mount();
    api.addNode("start", 0, 0);
    await api.importDrawio(DRAWIO, { mode: "merge" });
    expect(api.getInfo().cells.vertices).toBe(3);
    expect(api.getSelection().length).toBe(3);
  });

  it("ekspor draw.io meratakan named style", async () => {
    const { api } = mount();
    api.addNode("start", 0, 0, "S");
    const xml = await api.exportDrawio();
    expect(xml).toContain("fillColor=#7c3aed");
    expect(xml).not.toContain("baseStyleNames");
  });
});

describe("SharedMaxgraphNodeEditor — bentuk tambahan", () => {
  it("impor stensil: palet bertambah, bentuk terdaftar, sel lama digambar ulang, entri rusak dilewati", async () => {
    const { api, root } = mount();
    await api.importDrawio(drawio("mxgraph.test.arrow_box"));
    const b = api.graph.getDataModel().getCell("b")!;
    expect(api.inspect(b)!.shape).toEqual({ name: "mxgraph.test.arrow_box", resolved: "missing" });

    const shapesEv = vi.fn();
    api.on("shapes", shapesEv);
    const report = await api.importShapes(STENCIL);
    expect(report.added).toBe(1);
    expect(report.skipped).toEqual([{ name: "Broken", reason: "atribut w/h tidak valid (harus angka > 0)" }]);
    expect(report.keys).toEqual(["mxgraph.test.arrow_box"]);
    expect(shapesEv).toHaveBeenCalledTimes(1);
    expect(api.inspect(b)!.shape.resolved).toBe("stencil");
    expect(api.getNodeTypes().some(t => t.label === "Arrow Box" && t.group === "mxgraph.test")).toBe(true);
    expect(root.textContent).toContain("Arrow Box");
    expect(api.listShapeLibraries()).toEqual([{ id: expect.any(String), name: "mxgraph.test", kind: "stencil", count: 1 }]);

    const type = api.getNodeTypes().find(t => t.label === "Arrow Box")!;
    const cell = api.addNode(type.id, 100, 200)!;
    expect(api.inspect(cell)!.shape.resolved).toBe("stencil");

    api.removeShapeLibrary(report.id);
    expect(api.getNodeTypes().some(t => t.label === "Arrow Box")).toBe(false);
  });

  it("impor SVG menjadi node gambar; format tidak dikenal ditolak dengan alasan", async () => {
    const { api } = mount();
    const r = await api.importShapes(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><script>alert(1)</script><rect width="40" height="20" onclick="x()"/></svg>`, { name: "kotak" });
    expect(r).toMatchObject({ kind: "svg", added: 1 });
    const t = api.getNodeTypes().find(x => x.group === "kotak")!;
    expect(t.width).toBe(40);
    expect(String(t.style!.image)).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(atob(String(t.style!.image).split(",")[1])).not.toMatch(/script|onclick/);
    await expect(api.importShapes("<html/>")).rejects.toThrow(/Format tidak dikenal/);
  });

  it("pustaka draw.io (mxlibrary): fragmen disisipkan sebagai kelompok sel", async () => {
    const { api } = mount();
    const frag = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="X" vertex="1" parent="1"><mxGeometry x="500" y="500" width="40" height="40" as="geometry"/></mxCell><mxCell id="3" value="Y" vertex="1" parent="1"><mxGeometry x="600" y="500" width="40" height="40" as="geometry"/></mxCell></root></mxGraphModel>`;
    const lib = `<mxlibrary>${JSON.stringify([{ xml: frag, w: 140, h: 40, title: "Pasangan" }, { title: "tanpa isi" }])}</mxlibrary>`;
    const r = await api.importShapes(lib, { name: "pustakaku" });
    expect(r).toMatchObject({ kind: "mxlibrary", added: 1 });
    expect(r.skipped).toHaveLength(1);
    const t = api.getNodeTypes().find(x => x.kind === "fragment")!;
    const first = api.addNode(t.id, 20, 30)!;
    expect(first).toBeTruthy();
    expect(api.getInfo().cells.vertices).toBe(2);
    const xs = api.getSelection().map(c => c.getGeometry()!.x).sort((a, b) => a - b);
    expect(xs[0]).toBe(20); // fragmen dipindah ke titik jatuh
    expect(xs[1] - xs[0]).toBe(100);
  });
});

describe("SharedMaxgraphNodeEditor — log & info", () => {
  it("mencatat langkah berhasil/gagal beserta alasannya dan mengeksposnya sebagai event", async () => {
    const { api } = mount({ logLevel: "debug" });
    const logEv = vi.fn();
    api.on("log", logEv);
    await api.importDrawio(DRAWIO);
    const entries = api.logger.entries();
    expect(entries.some(e => e.scope === "import" && e.ok === true && /deflate|tidak terkompresi/.test(`${e.message} ${e.why}`))).toBe(true);
    const bad = entries.find(e => e.ok === false && /Bentuk tidak tersedia/.test(e.message))!;
    expect(bad.why).toMatch(/ShapeRegistry/);
    expect(logEv).toHaveBeenCalled();
    expect(api.logger.toText()).toContain("↳");
    expect(api.logger.stats().failed).toBeGreaterThan(0);
  });

  it("panel Log/Info dapat dibuka dan menampilkan inspeksi sel", async () => {
    const { api, root } = mount();
    await api.importDrawio(DRAWIO);
    api.showPanel("log");
    await wait(0);
    expect(root.querySelector(".mgx-dock")).toBeTruthy();
    expect(root.querySelector(".mgx-log-row")).toBeTruthy();
    api.graph.setSelectionCell(api.graph.getDataModel().getCell("b")!);
    api.showPanel("info");
    await wait(0);
    expect(root.querySelector(".mgx-info")!.textContent).toMatch(/TIDAK TERSEDIA/);
    expect(root.querySelector(".mgx-info")!.textContent).toContain("Impor terakhir");
    api.showPanel("events");
    await wait(0);
    expect(root.querySelector(".mgx-dock")!.textContent).toContain("selection");
    api.showPanel(null);
    await wait(0);
    expect(root.querySelector(".mgx-dock")).toBeNull();
  });

  it("label HTML disanitasi saat digambar", async () => {
    const { api } = mount();
    await api.importDrawio(`<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="h" value="&lt;b&gt;ok&lt;/b&gt;&lt;img src=x onerror=alert(1)&gt;" style="html=1;" vertex="1" parent="1"><mxGeometry width="80" height="30" as="geometry"/></mxCell></root></mxGraphModel>`);
    const cell = api.graph.getDataModel().getCell("h")!;
    const label = api.graph.getLabel(cell) as string;
    expect(label).toContain("<b>ok</b>");
    expect(label).not.toMatch(/onerror|<img/);
  });
});

describe("SharedMaxgraphNodeEditor — kelompok, label HTML, layar penuh, zoom", () => {
  it("kelompokkan & pisahkan: sel menjadi anak, event, undo, ekspor draw.io memuat induk", async () => {
    const { api } = mount();
    const a = api.addNode("start", 40, 40)!, b = api.addNode("end", 240, 40)!;
    const grouped = vi.fn(), ungrouped = vi.fn();
    api.on("cells-grouped", grouped); api.on("cells-ungrouped", ungrouped);
    api.graph.setSelectionCells([a, b]);
    const g = api.group()!;
    expect(g).toBeTruthy();
    expect(a.getParent()).toBe(g);
    expect(b.getParent()).toBe(g);
    expect(String(g.value)).toBe("Group");
    expect((g.style as Record<string, unknown>).dashed).toBe(true);
    expect(grouped).toHaveBeenCalledTimes(1);
    expect(api.getSelection()).toEqual([g]);
    const xml = await api.exportDrawio();
    expect(xml).toContain(`parent="${g.getId()}"`);

    const freed = api.ungroup();
    expect(freed.length).toBe(2);
    expect(a.getParent()).not.toBe(g);
    expect(ungrouped).toHaveBeenCalledTimes(1);
    api.undo();
    expect(a.getParent()).toBe(g); // undo memulihkan kelompok
    expect(api.group([])).toBeNull();
    expect(api.ungroup([a])).toEqual([]); // bukan kelompok
  });

  it("kelompok tidak dibuat saat readonly", () => {
    const { api } = mount({ readonly: true });
    expect(api.group([])).toBeNull();
  });

  it("label: getLabel/setLabel, konversi mode teks ⇄ HTML, sanitasi, event", async () => {
    const { api } = mount();
    const c = api.addNode("process", 40, 40, "Baris 1\nBaris <2>")!;
    const ev = vi.fn();
    api.on("label-changed", ev);
    expect(api.getLabel(c)).toEqual({ value: "Baris 1\nBaris <2>", html: false });

    expect(api.setLabel(c, "<b>Tebal</b><script>x()</script><i onclick=y()>m</i>", { html: true })).toBe(true);
    const l = api.getLabel(c)!;
    expect(l.html).toBe(true);
    expect(l.value).toBe("<b>Tebal</b><i>m</i>");
    expect(ev).toHaveBeenCalled();
    expect(api.graph.getLabel(c)).toBe("<b>Tebal</b><i>m</i>");

    api.setLabel(c, "a\nb & c", { html: false });
    expect(api.getLabel(c)).toEqual({ value: "a\nb & c", html: false });
    expect((api.graph.getCellStyle(c) as Record<string, unknown>).html).toBeFalsy();

    expect(api.setLabel(api.graph.getDataModel().getRoot()!, "x")).toBe(false);
  });

  it("dialog Kelola label: ubah mode mengonversi isi, pratinjau disanitasi, terapkan ke label", async () => {
    const { api, root } = mount();
    const c = api.addNode("process", 40, 40, "Satu\nDua")!;
    api.graph.setSelectionCell(c);
    api.openLabelEditor();
    await wait(0);
    expect(root.querySelector(".mgx-modal")).toBeTruthy();
    expect(root.querySelector<HTMLTextAreaElement>(".mgx-src")!.value).toBe("Satu\nDua");
    [...root.querySelectorAll<HTMLButtonElement>(".mgx-seg button")].find(b => b.textContent === "HTML")!.click();
    await wait(0);
    const ta = root.querySelector<HTMLTextAreaElement>(".mgx-src")!;
    expect(ta.value).toBe("Satu<br>Dua");
    ta.value = "<b>Judul</b><img src=x onerror=alert(1)>";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(0);
    expect(root.querySelector(".mgx-prev")!.innerHTML).toBe("<b>Judul</b>");
    expect(root.querySelector(".mgx-warn")!.textContent).toMatch(/tidak aman/);
    [...root.querySelectorAll<HTMLButtonElement>(".mgx-modal-foot button")].find(b => b.textContent === "Terapkan")!.click();
    await wait(0);
    expect(root.querySelector(".mgx-modal")).toBeNull();
    expect(api.getLabel(c)).toEqual({ value: "<b>Judul</b>", html: true });

    api.openLabelEditor(c);
    await wait(0);
    root.querySelector(".mgx-modal")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await wait(0);
    expect(root.querySelector(".mgx-modal")).toBeNull();
    expect(api.getLabel(c)!.value).toBe("<b>Judul</b>");
  });

  it("layar penuh: fallback CSS di lingkungan tanpa Fullscreen API, event, Esc, perintah", async () => {
    const { api, root } = mount();
    const ev = vi.fn();
    api.on("fullscreen", ev);
    expect(api.isFullscreen()).toBe(false);
    await api.setFullscreen(true);
    expect(api.isFullscreen()).toBe(true);
    expect(root.classList.contains("mgx-full")).toBe(true);
    expect(ev).toHaveBeenCalledWith({ fullscreen: true }, expect.anything());
    expect(api.logger.entries().some(e => /Fullscreen API ditolak/.test(e.why ?? ""))).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wait(0);
    expect(api.isFullscreen()).toBe(false);
    expect(root.classList.contains("mgx-full")).toBe(false);
    await api.run("toggleFullscreen");
    expect(api.isFullscreen()).toBe(true);
    await api.toggleFullscreen();
    expect(api.isFullscreen()).toBe(false);
  });

  it("zoom: dibatasi min/max, tombol bertahap, roda kontinu dan lembut", async () => {
    const { api } = mount({ minZoom: 0.5, maxZoom: 2, zoomAnimation: false, zoomFactor: 1.5 });
    api.zoomTo(10);
    expect(api.getZoom()).toBe(2);
    api.zoomTo(0.01);
    expect(api.getZoom()).toBe(0.5);
    api.zoomActual();
    expect(api.getZoom()).toBe(1);
    api.zoomIn();
    expect(api.getZoom()).toBeCloseTo(1.5);
    api.zoomIn();
    expect(api.getZoom()).toBe(2);
    api.zoomOut();
    expect(api.getZoom()).toBeCloseTo(2 / 1.5);

    api.zoomActual();
    const canvas = document.querySelector(".mgx-canvas")!;
    const wheel = (dy: number) => canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: dy, ctrlKey: true, cancelable: true, bubbles: true }));
    wheel(-100);
    await wait(40);
    const notch = api.getZoom();
    expect(notch).toBeGreaterThan(1.1);
    expect(notch).toBeLessThan(1.25);
    api.zoomActual();
    wheel(-4);
    await wait(40);
    expect(api.getZoom()).toBeGreaterThan(1);
    expect(api.getZoom()).toBeLessThan(1.02);
    api.zoomActual();
    wheel(-100000);
    await wait(40);
    expect(api.getZoom()).toBeLessThan(2.0001);
    api.zoomActual();
    wheel(-100); wheel(-100);
    await wait(40);
    expect(api.getZoom()).toBeGreaterThan(notch);
  });

  it("zoom beranimasi mencapai target dan klik beruntun akumulatif", async () => {
    const { api } = mount({ zoomFactor: 1.5 });
    api.zoomIn(); api.zoomIn();
    await wait(300);
    expect(api.getZoom()).toBeCloseTo(2.25, 1);
  });
});


describe("SharedMaxgraphNodeEditor — navigasi, cari/ganti lintas jenis, warna & tautan", () => {
  const load = async (api: MaxgraphNodeEditorApi) => { await api.importDrawio(DRAWIO); };

  it("goto: node, edge, halaman, pencarian, titik; salah → ok=false; event navigate", async () => {
    const { api } = mount();
    await load(api);
    const nav = vi.fn();
    api.on("navigate", nav);
    expect(await api.goto({ kind: "node", id: "a" })).toMatchObject({ ok: true });
    expect(api.getSelection().map(c => c.getId())).toEqual(["a"]);
    expect((await api.goto({ kind: "edge", id: "a" })).ok).toBe(false); // a bukan edge
    expect((await api.goto({ kind: "edge", id: "e" })).ok).toBe(true);
    expect((await api.goto({ kind: "node", id: "zzz" })).ok).toBe(false);
    expect((await api.goto({ kind: "page", page: "Dua" })).ok).toBe(true);
    expect(api.getInfo().page.name).toBe("Dua");
    expect((await api.goto({ kind: "page", page: 0 })).ok).toBe(true);
    expect((await api.goto({ kind: "page", page: 9 })).ok).toBe(false);
    const r = await api.goto({ kind: "search", query: "B", caseSensitive: true });
    expect(r.ok).toBe(true);
    expect(api.getSelection()[0].getId()).toBe("b");
    expect((await api.goto({ kind: "all" })).ok).toBe(true);
    expect(nav.mock.calls.length).toBeGreaterThan(0);
  });

  it("find/replace: label plain & HTML (tag tidak disentuh), data, regex, satu langkah undo", async () => {
    const { api } = mount();
    await load(api);
    const a = api.graph.getDataModel().getCell("a")!;
    api.setLabel(a, "Halo <b>dunia</b> halo", { html: true });
    const f = api.find({ query: "halo", select: false });
    expect(f.count).toBe(2);
    expect(f.matches.every(m => m.kind === "text")).toBe(true);
    const un = vi.fn();
    api.on("replace", un);
    const rep = api.replaceAll({ query: "halo", replacement: "hai", kinds: ["text", "formula" as never] });
    expect(rep.skipped).toEqual(["formula"]);
    expect(rep.byKind.text).toBe(2);
    expect(api.getLabel(a)!.value).toBe("hai <b>dunia</b> hai");
    expect(un).toHaveBeenCalled();
    api.undo();
    expect(api.getLabel(a)!.value).toBe("Halo <b>dunia</b> halo");
    // satu kemunculan saja
    const one = api.replace({ query: "halo", replacement: "hai", kinds: ["text"] });
    expect(one.total).toBe(1);
    expect(api.find({ query: "halo", select: false }).count).toBe(1);
    // regex dengan grup
    const rg = api.replaceAll({ query: "(du)nia", regex: true, replacement: "[$1]", kinds: ["text"] });
    expect(rg.total).toBe(1);
    expect(api.getLabel(a)!.value).toContain("<b>[du]</b>");
    // readonly
  });

  it("replace nilai: fill, stroke, font, warna teks; kosong = hapus; satu undo", async () => {
    const { api } = mount();
    await load(api);
    const g = api.graph;
    const style = (id: string, k: string) => (g.getCurrentCellStyle(g.getDataModel().getCell(id)!) as Record<string, unknown>)[k];
    expect(style("a", "fillColor")).toBe("#dae8fc");
    const r1 = api.replaceAll({ query: "DAE8FC", replacement: "#00ff00", kinds: ["fill"] });
    expect(r1.byKind.fill).toBe(1);
    expect(style("a", "fillColor")).toBe("#00ff00");
    const r2 = api.replaceAll({ query: "#00ff00", replacement: "", kinds: ["fill"] });
    expect(r2.byKind.fill).toBe(1);
    // "none" dibaca maxGraph sebagai tanpa isi: nilai gabungan hilang, style milik sel menyimpan "none"
    expect((g.getDataModel().getCell("a")!.style as Record<string, unknown>).fillColor).toBe("none");
    expect(style("a", "fillColor")).toBeFalsy();
    api.undo();
    expect(style("a", "fillColor")).toBe("#00ff00");
    g.setCellStyles("strokeColor", "#112233", [g.getDataModel().getCell("b")!]);
    g.setCellStyles("fontColor", "#445566", [g.getDataModel().getCell("b")!]);
    g.setCellStyles("fontFamily", "Georgia", [g.getDataModel().getCell("b")!]);
    expect(api.replaceAll({ query: "112233", replacement: "FF0000", kinds: ["stroke"] }).byKind.stroke).toBe(1);
    expect(api.replaceAll({ query: "445566", replacement: "", kinds: ["color"] }).byKind.color).toBe(1);
    expect(style("b", "fontColor")).toBeFalsy();
    expect(api.replaceAll({ query: "georgia", replacement: "Arial", kinds: ["font"] }).byKind.font).toBe(1);
    expect(style("b", "fontFamily")).toBe("Arial");
  });

  it("tautan sel: pasang, daftar, ubah, ganti massal, hapus, undo, round-trip draw.io", async () => {
    const { api } = mount();
    await load(api);
    api.graph.setSelectionCells([api.graph.getDataModel().getCell("a")!, api.graph.getDataModel().getCell("b")!]);
    const ev = vi.fn();
    api.on("link", ev);
    expect(api.links.set("javascript:alert(1)")).toBe(false);
    expect(api.links.set("example.com/x", { tooltip: "tip" })).toBe(true);
    const l = api.links.list();
    expect(l.map(x => x.url)).toEqual(["https://example.com/x", "https://example.com/x"]);
    expect(l[0]).toMatchObject({ tooltip: "tip", kind: "web" });
    expect(api.getLabel(api.graph.getDataModel().getCell("a")!)!.value).toBe("A");
    // draw.io menyimpan sebagai atribut link pada <object>
    const xml = await api.exportDrawio();
    expect(xml).toMatch(/<object[^>]*link="https:\/\/example.com\/x"/);
    expect(api.links.replace("example.com", "example.org")).toBe(2);
    expect(api.links.update("a", { url: "#b" })).toBe(true);
    expect(api.links.list().find(x => x.id === "a")!.url).toBe("#b");
    expect((await api.goto({ kind: "link", id: "a" })).ok).toBe(true);
    expect(api.links.open("#b")).toBe(true);
    expect(api.getSelection()[0].getId()).toBe("b");
    expect(api.links.removeById("a")).toBe(true);
    expect(api.links.list().map(x => x.id)).toEqual(["b"]);
    api.undo();
    expect(api.links.list().map(x => x.id).sort()).toEqual(["a", "b"]);
    expect(ev).toHaveBeenCalled();
    // impor ulang mempertahankan tautan
    await api.importDrawio(xml);
    expect(api.links.list().length).toBe(2);
  });

  it("perintah bus + readonly", async () => {
    const { api, root } = mount();
    await load(api);
    expect(api.events.commands()).toEqual(expect.arrayContaining(["goto", "find", "replace", "replaceAll", "replace.kinds", "link.list", "link.set", "link.replace"]));
    expect(((await dispatchCommand(root, "maxgraph-editor", "goto", { kind: "node", id: "b" })) as { ok: boolean }).ok).toBe(true);
    expect(await dispatchCommand<string[]>(root, "maxgraph-editor", "replace.kinds")).toEqual(expect.arrayContaining(["text", "link", "data", "font", "color", "fill", "stroke"]));
    const { api: ro } = mount({ readonly: true });
    await load(ro);
    expect(ro.replaceAll({ query: "A", replacement: "x" }).error).toBe("readonly");
    expect(ro.links.set("https://a.b", { ids: ["a"] })).toBe(false);
  });
});
