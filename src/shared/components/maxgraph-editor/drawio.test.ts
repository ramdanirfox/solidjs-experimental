// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { Graph } from "@maxgraph/core";
import {
  DrawioError, buildMxfile, deflateDiagramText, detectFormat, exportMxGraphModel, importMxGraphModel, inflateDiagramText, parseDrawioFile,
  htmlToPlain, parseStyleString, plainToHtml, sanitizeHtmlLabel, styleFromString, styleToString,
} from "./drawio";
import { MaxgraphLogger } from "./logger";

const MODEL = `<mxGraphModel grid="1" gridSize="20"><root><mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="2" value="Hello &lt;b&gt;bold&lt;/b&gt;&lt;script&gt;alert(1)&lt;/script&gt;" style="rounded=1;fillColor=#dae8fc;strokeColor=#6c8ebf;html=1;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell>
  <mxCell id="3" value="B" style="ellipse;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="240" y="40" width="80" height="80" as="geometry"/></mxCell>
  <mxCell id="4" value="edge" style="edgeStyle=orthogonalEdgeStyle;endArrow=classic;" edge="1" parent="1" source="2" target="3"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="200" y="70"/></Array></mxGeometry></mxCell>
  <mxCell id="5" value="X" style="shape=cube3d;" vertex="1" parent="1"><mxGeometry x="10" y="200" width="50" height="50" as="geometry"/></mxCell>
  <mxCell id="6" style="endArrow=classic;" edge="1" parent="1" source="2" target="999"><mxGeometry relative="1" as="geometry"/></mxCell>
  </root></mxGraphModel>`;

let graph: Graph;
beforeEach(() => { graph = new Graph(document.body.appendChild(document.createElement("div"))); });

describe("format & kompresi", () => {
  it("mendeteksi format", () => {
    expect(detectFormat(`<?xml version="1.0"?><mxfile><diagram/></mxfile>`)).toBe("mxfile");
    expect(detectFormat(`<!-- c --><mxGraphModel/>`)).toBe("mxGraphModel");
    expect(detectFormat(`<GraphDataModel/>`)).toBe("GraphDataModel");
    expect(detectFormat(`<svg/>`)).toBe("unknown");
    expect(detectFormat(``)).toBe("unknown");
  });

  it("deflate ⇄ inflate bolak-balik, termasuk karakter non-ASCII", async () => {
    const xml = `<mxGraphModel><root><mxCell id="0" value="Ünï ✓ 日本"/></root></mxGraphModel>`;
    const enc = await deflateDiagramText(xml);
    expect(enc).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(await inflateDiagramText(enc)).toBe(xml);
  });

  it("inflate memberi galat jelas untuk data rusak", async () => {
    await expect(inflateDiagramText("bukan-deflate!!")).rejects.toBeInstanceOf(DrawioError);
  });

  it("parse mxfile: banyak halaman, terkompresi & tidak", async () => {
    const m = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>`;
    const file = `<mxfile><diagram id="a" name="Satu">${await deflateDiagramText(m)}</diagram><diagram id="b" name="Dua">${m}</diagram></mxfile>`;
    const logger = new MaxgraphLogger({ level: "debug" });
    const f = await parseDrawioFile(file, logger);
    expect(f.pages.map(p => [p.id, p.name, p.compressed])).toEqual([["a", "Satu", true], ["b", "Dua", false]]);
    expect(f.pages[0].xml).toBe(m);
    expect(logger.entries().some(e => e.why?.includes("deflate-raw"))).toBe(true);
  });

  it("parse menolak berkas kosong, bukan-XML, dan mxfile tanpa diagram", async () => {
    await expect(parseDrawioFile("  ")).rejects.toMatchObject({ code: "empty" });
    await expect(parseDrawioFile("<svg/>")).rejects.toMatchObject({ code: "unsupported" });
    await expect(parseDrawioFile("<mxfile></mxfile>")).rejects.toMatchObject({ code: "structure" });
    await expect(parseDrawioFile("<mxfile><diagram")).rejects.toBeInstanceOf(DrawioError);
  });
});

describe("style", () => {
  it("parse & konversi nilai", () => {
    expect(parseStyleString("ellipse;rounded=1;fillColor=#fff;")).toEqual({ names: ["ellipse"], props: [["rounded", "1"], ["fillColor", "#fff"]] });
    const unknownShapes = new Set<string>(), unknownNames = new Set<string>();
    const s = styleFromString("ellipse;fontSize=12;strokeWidth=2.5;shape=cube3d;mystyle;fontFamily=123", { hasNamedStyle: () => false, unknownShapes, unknownNames }) as Record<string, unknown>;
    expect(s.shape).toBe("cube3d");
    expect(s.fontSize).toBe(12);
    expect(s.strokeWidth).toBe(2.5);
    expect(s.fontFamily).toBe("123");
    expect([...unknownShapes]).toEqual(["cube3d"]);
    expect([...unknownNames]).toEqual(["mystyle"]);
  });

  it("data URI gambar: gaya draw.io ⇄ base64", () => {
    const s = styleFromString("image=data:image/png,AAAA;") as Record<string, unknown>;
    expect(s.image).toBe("data:image/png;base64,AAAA");
    expect(styleToString({ image: "data:image/png;base64,AAAA", rounded: true, x: undefined, fontSize: 12 })).toBe("image=data:image/png,AAAA;rounded=1;fontSize=12;");
  });
});

describe("sanitasi label HTML", () => {
  it("membuang script/handler/javascript:, mempertahankan format", () => {
    const st = { removed: 0 };
    const out = sanitizeHtmlLabel(`<b onclick="x()">tebal</b><script>alert(1)</script><a href="javascript:alert(1)">l</a><a href="https://ok.test">ok</a><span style="color:red;background:url(x)">w</span><img src="http://evil/x.png"><iframe src="x"></iframe>`, st);
    expect(out).toContain("<b>tebal</b>");
    expect(out).not.toMatch(/script|onclick|javascript:|iframe|evil|url\(/i);
    expect(out).toContain('href="https://ok.test"');
    expect(out).toContain("color:red");
    expect(st.removed).toBeGreaterThan(3);
  });
  it("teks biasa tidak diubah", () => { expect(sanitizeHtmlLabel("plain text")).toBe("plain text"); });
});

describe("impor mxGraphModel", () => {
  it("mengimpor sel, style, geometri, terminal, dan melaporkan masalah", () => {
    const logger = new MaxgraphLogger({ level: "debug" });
    const { report } = importMxGraphModel(graph, MODEL, { logger });
    const parent = graph.getDefaultParent();
    const v = graph.getChildCells(parent, true, false), e = graph.getChildCells(parent, false, true);
    expect(v).toHaveLength(3);
    expect(e).toHaveLength(2);
    expect(report.cells).toMatchObject({ vertices: 3, edges: 2, layers: 1 });
    const a = graph.getDataModel().getCell("2")!;
    expect((a.style as Record<string, unknown>).fillColor).toBe("#dae8fc");
    expect((a.style as Record<string, unknown>).rounded).toBe(1);
    expect(a.getGeometry()!.width).toBe(120);
    expect(String(a.value)).toContain("<b>bold</b>");
    expect(String(a.value)).not.toContain("script");
    expect(report.htmlLabels).toBe(2);
    expect(report.sanitized).toBe(1);
    const b = graph.getDataModel().getCell("3")!;
    expect((b.style as Record<string, unknown>).shape).toBe("ellipse");
    const edge = graph.getDataModel().getCell("4")!;
    expect(edge.source?.getId()).toBe("2");
    expect(edge.target?.getId()).toBe("3");
    expect(edge.getGeometry()!.points![0].x).toBe(200);
    expect(report.unknownShapes).toEqual(["cube3d"]);
    expect(report.danglingEdges).toBe(1);
    expect(graph.getGridSize()).toBe(20);
    expect(logger.entries({ onlyFailed: true }).some(x => /cube3d/.test(x.message) && /persegi/.test(x.why ?? ""))).toBe(true);
  });

  it("atomik: XML rusak tidak mengubah graph yang sedang terbuka", () => {
    importMxGraphModel(graph, MODEL);
    const before = graph.getChildCells(graph.getDefaultParent(), true, true).length;
    expect(() => importMxGraphModel(graph, "<mxGraphModel><root>")).toThrow(DrawioError);
    expect(() => importMxGraphModel(graph, "<mxGraphModel/>")).toThrow(/root/);
    expect(graph.getChildCells(graph.getDefaultParent(), true, true)).toHaveLength(before);
  });

  it("mode merge: id baru, pergeseran, sel level-atas dikembalikan", () => {
    importMxGraphModel(graph, MODEL);
    const before = graph.getChildCells(graph.getDefaultParent(), true, false).length;
    const { cells, report } = importMxGraphModel(graph, MODEL, { mode: "merge", dx: 100, dy: 50 });
    expect(report.mode).toBe("merge");
    expect(cells.length).toBe(5);
    expect(graph.getChildCells(graph.getDefaultParent(), true, false)).toHaveLength(before + 3);
    const moved = cells.find(c => c.value && String(c.value).startsWith("Hello"))!;
    expect(moved.getGeometry()!.x).toBe(140);
    expect(moved.getGeometry()!.y).toBe(90);
    expect(moved.getId()).not.toBe("2");
  });

  it("mempertahankan atribut kustom <object>", () => {
    const xml = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><object label="Hai" owner="tim-a" id="7"><mxCell style="rounded=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="10" height="10" as="geometry"/></mxCell></object></root></mxGraphModel>`;
    importMxGraphModel(graph, xml);
    const c = graph.getDataModel().getCell("7")!;
    expect((c.value as Element).getAttribute("owner")).toBe("tim-a");
    const out = exportMxGraphModel(graph);
    expect(out).toContain('owner="tim-a"');
    expect(out).toContain('<object id="7"');
  });
});

describe("ekspor draw.io", () => {
  it("round-trip: ekspor → impor memberi struktur yang sama", async () => {
    importMxGraphModel(graph, MODEL);
    const xml = exportMxGraphModel(graph);
    expect(xml).toContain("<mxGraphModel");
    expect(xml).toContain('vertex="1"');
    expect(xml).not.toContain("_x=");
    expect(xml).not.toContain("GraphDataModel");

    const g2 = new Graph(document.body.appendChild(document.createElement("div")));
    const { report } = importMxGraphModel(g2, xml);
    expect(report.cells).toMatchObject({ vertices: 3, edges: 2 });
    const a = g2.getDataModel().getCell("2")!;
    expect((a.style as Record<string, unknown>).fillColor).toBe("#dae8fc");
    expect(a.getGeometry()!.x).toBe(40);
    const e = g2.getDataModel().getCell("4")!;
    expect(e.source?.getId()).toBe("2");
    expect(e.getGeometry()!.points![0].y).toBe(70);
    expect(g2.getGridSize()).toBe(20);
  });

  it("mxfile: tanpa kompresi dan terkompresi dapat dibaca kembali", async () => {
    importMxGraphModel(graph, MODEL);
    const model = exportMxGraphModel(graph);
    for (const compress of [false, true]) {
      const file = await buildMxfile([{ id: "p1", name: "Halaman <1>", xml: model, compressed: false }], { compress });
      expect(detectFormat(file)).toBe("mxfile");
      const parsed = await parseDrawioFile(file);
      expect(parsed.pages).toHaveLength(1);
      expect(parsed.pages[0].name).toBe("Halaman <1>");
      expect(parsed.pages[0].compressed).toBe(compress);
      const g2 = new Graph(document.body.appendChild(document.createElement("div")));
      expect(importMxGraphModel(g2, parsed.pages[0].xml).report.cells.vertices).toBe(3);
    }
  });

  it("ratakan named style: node bertipe tetap tampil sama di draw.io", () => {
    graph.getStylesheet().putCellStyle("start", { fillColor: "#7c3aed", fontColor: "#ffffff", rounded: true } as never);
    graph.insertVertex({ parent: graph.getDefaultParent(), value: "S", position: [0, 0], size: [100, 40], style: { baseStyleNames: ["start"] } });
    const xml = exportMxGraphModel(graph);
    expect(xml).toContain("fillColor=#7c3aed");
    expect(xml).toContain("rounded=1");
    expect(xml).not.toContain("baseStyleNames");
    const flat = exportMxGraphModel(graph, { flatten: false });
    expect(flat).not.toContain("fillColor=#7c3aed");
  });
});

describe("konversi label teks ⇄ HTML", () => {
  it("teks → HTML meng-escape dan mengubah baris baru", () => {
    expect(plainToHtml("a < b & c\nbaris 2")).toBe("a &lt; b &amp; c<br>baris 2");
  });
  it("HTML → teks: br/blok jadi baris baru, tag dibuang, entitas didekode", () => {
    expect(htmlToPlain("a<br>b")).toBe("a\nb");
    expect(htmlToPlain("<div>satu</div><div>dua</div>")).toBe("satu\ndua");
    expect(htmlToPlain("<b>tebal</b> &amp; &lt;i&gt;")).toBe("tebal & <i>");
    expect(htmlToPlain("<script>x()</script>aman")).toBe("aman");
    expect(htmlToPlain("polos")).toBe("polos");
  });
  it("round-trip teks → HTML → teks", () => {
    const t = "x < y & z\nbaris";
    expect(htmlToPlain(plainToHtml(t))).toBe(t);
  });
});
