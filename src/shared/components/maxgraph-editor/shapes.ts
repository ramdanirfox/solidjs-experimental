/**
 * Impor bentuk tambahan ("shape library") ke editor maxgraph. Tiga sumber didukung:
 *
 *  - **stensil** `<shapes name="mxgraph.xxx"><shape name="Foo" w h>…</shape></shapes>` (format stensil mxGraph/draw.io)
 *      → didaftarkan ke `StencilShapeRegistry` sebagai `mxgraph.xxx.foo`, sehingga diagram draw.io yang memakai `shape=mxgraph.xxx.foo` ikut tampil benar.
 *  - **SVG** → node bergambar (`shape=image`) dengan ukuran dari `viewBox`/`width`/`height`.
 *  - **pustaka draw.io** `<mxlibrary>[{xml,w,h,title}…]</mxlibrary>` → tiap entri menjadi "fragmen" (kumpulan sel) yang disisipkan sebagai grup.
 *
 * Pembacaan (`readShapeLibrary`) murni: tidak mengubah registry. `registerStencils` mengubah registry global maxGraph
 * (dipakai bersama semua instance editor di halaman; maxGraph tidak menyediakan penghapusan per-kunci).
 */
import { Graph, StencilShape, StencilShapeRegistry } from "@maxgraph/core";
import { DrawioError, importMxGraphModel, inflateDiagramText, readMxGraphModel } from "./drawio";
import { exportGraphSvg, svgToDataUri } from "./svg";
import type { MaxgraphLogger } from "./logger";
import type { MaxgraphNodeType } from "./types";

export type ShapeLibraryKind = "stencil" | "svg" | "mxlibrary";

export interface ShapeSpec {
    kind: ShapeLibraryKind;
    /** Kunci `shape=` untuk stensil; id unik untuk lainnya. */
    key: string;
    label: string;
    width: number;
    height: number;
    /** Stensil: elemen `<shape>`. */
    node?: Element;
    /** SVG: data URI. */
    image?: string;
    /** mxlibrary: `<mxGraphModel>` tanpa kompresi. */
    fragmentXml?: string;
}

export interface ShapeLibrary {
    id: string;
    name: string;
    kind: ShapeLibraryKind;
    specs: ShapeSpec[];
    skipped: { name: string; reason: string }[];
}

export interface ShapeImportReport {
    id: string;
    name: string;
    kind: ShapeLibraryKind;
    added: number;
    skipped: { name: string; reason: string }[];
    keys: string[];
    durationMs: number;
}

export interface ReadShapeOptions { name?: string; fileName?: string; logger?: MaxgraphLogger }

export function detectShapeLibrary(text: string): ShapeLibraryKind | "unknown" {
    const t = text.replace(/^﻿/, "").trimStart();
    if (/^(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<mxlibrary[\s>]/i.test(t) || /^\[\s*\{[\s\S]*"(xml|data)"\s*:/.test(t)) return "mxlibrary";
    if (/^(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(t)) return "svg";
    if (/^(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<shapes[\s>]/i.test(t)) return "stencil";
    return "unknown";
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "x";
const baseName = (f: string) => f.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
let libCounter = 0;

function parseXml(text: string): Document {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const err = doc.getElementsByTagName("parsererror")[0];
    if (err) throw new DrawioError("parse", `XML tidak valid: ${(err.textContent ?? "").split("\n")[0].slice(0, 200)}`);
    return doc;
}

// ───────────────────────── stensil ─────────────────────────

const STENCIL_DRAW = /^(path|rect|roundrect|ellipse|line|text|image|fillstroke|fill|stroke|strokewidth|fillcolor|strokecolor|alpha|fillalpha|strokealpha|dashed|dashpattern|linecap|linejoin|miterlimit|fontsize|fontstyle|fontfamily|fontcolor|shadow|save|restore|rotate|clip|include-shape|move|line|quad|curve|arc|close|constraint|connections|background|foreground)$/i;

function readStencils(text: string, lib: ShapeLibrary, opts: ReadShapeOptions) {
    const doc = parseXml(text);
    const root = doc.documentElement;
    const prefix = (root.getAttribute("name") || lib.name).toLowerCase();
    const seen = new Set<string>();
    for (const sh of [...root.children].filter(c => c.localName === "shape")) {
        const name = sh.getAttribute("name") ?? "";
        const w = Number(sh.getAttribute("w")), h = Number(sh.getAttribute("h"));
        if (!name) { lib.skipped.push({ name: "(tanpa nama)", reason: "atribut name tidak ada" }); continue; }
        if (!(w > 0) || !(h > 0)) { lib.skipped.push({ name, reason: "atribut w/h tidak valid (harus angka > 0)" }); continue; }
        const body = [...sh.children].filter(c => /^(background|foreground)$/i.test(c.localName));
        if (!body.length) { lib.skipped.push({ name, reason: "tidak ada <background>/<foreground>" }); continue; }
        const bad = [...sh.querySelectorAll("*")].map(e => e.localName).find(n => !STENCIL_DRAW.test(n));
        if (bad) { lib.skipped.push({ name, reason: `elemen tidak dikenal <${bad}>` }); continue; }
        let key = `${prefix}.${name.toLowerCase().replace(/\s+/g, "_")}`;
        if (seen.has(key)) { lib.skipped.push({ name, reason: `kunci ganda ${key}` }); continue; }
        seen.add(key);
        lib.specs.push({ kind: "stencil", key, label: name, width: w, height: h, node: sh });
    }
    opts.logger?.step("shapes", `Stensil "${lib.name}": ${lib.specs.length} bentuk`, lib.specs.length > 0, lib.skipped.length ? `${lib.skipped.length} dilewati (mis. ${lib.skipped[0].name}: ${lib.skipped[0].reason})` : `kunci berawalan "${prefix}."`);
}

// ───────────────────────── SVG ─────────────────────────

function readSvg(text: string, lib: ShapeLibrary, opts: ReadShapeOptions) {
    const doc = parseXml(text);
    const svg = doc.documentElement;
    if (svg.localName !== "svg") throw new DrawioError("structure", "Bukan dokumen SVG.");
    let removed = 0;
    for (const el of [...svg.querySelectorAll("script, foreignObject")]) { el.remove(); removed++; }
    for (const el of [svg, ...svg.querySelectorAll("*")]) for (const a of [...el.attributes]) if (/^on/i.test(a.name) || (/href$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) { el.removeAttribute(a.name); removed++; }
    const vb = (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
    const attr = (n: string) => { const v = parseFloat(svg.getAttribute(n) ?? ""); return Number.isFinite(v) && v > 0 ? v : NaN; };
    let w = attr("width"), h = attr("height");
    if (!(w > 0) && vb.length === 4 && vb[2] > 0) w = vb[2];
    if (!(h > 0) && vb.length === 4 && vb[3] > 0) h = vb[3];
    if (!(w > 0) || !(h > 0)) { w = 100; h = 100; }
    const k = Math.min(1, 120 / Math.max(w, h)); // ukuran awal di kanvas ≤ 120px
    if (!svg.getAttribute("xmlns")) svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    if (vb.length !== 4 && w && h) svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const label = lib.name;
    lib.specs.push({ kind: "svg", key: `svg_${slug(label)}_${++libCounter}`, label, width: Math.round(w * k), height: Math.round(h * k), image: svgToDataUri(new XMLSerializer().serializeToString(svg)) });
    opts.logger?.step("shapes", `SVG "${label}": ${Math.round(w)}×${Math.round(h)}`, true, removed ? `${removed} elemen/atribut aktif (script, foreignObject, on*) dibuang` : "dipakai sebagai gambar (shape=image)");
}

// ───────────────────────── mxlibrary ─────────────────────────

async function readMxLibrary(text: string, lib: ShapeLibrary, opts: ReadShapeOptions) {
    let json = text.trim();
    const m = /<mxlibrary[^>]*>([\s\S]*?)<\/mxlibrary>/i.exec(json);
    if (m) {
        // draw.io meng-escape isi sebagai teks XML; berkas buatan tangan sering tidak. Terima keduanya tanpa parser XML.
        json = m[1].trim();
        if (/&(lt|gt|quot|amp|#\d+);/.test(json)) json = json.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
    }
    let items: unknown;
    try { items = JSON.parse(json); } catch (e) { throw new DrawioError("parse", `JSON pustaka tidak valid: ${e instanceof Error ? e.message : String(e)}`); }
    if (!Array.isArray(items)) throw new DrawioError("structure", "Isi <mxlibrary> harus berupa array JSON.");
    let i = 0;
    for (const it of items as Record<string, unknown>[]) {
        i++;
        const title = String(it.title ?? `Item ${i}`);
        const src = typeof it.xml === "string" ? it.xml : typeof it.data === "string" ? it.data : "";
        if (!src) { if (it.type === "svg" || it.type === "image" || typeof it.url === "string") lib.skipped.push({ name: title, reason: "entri gambar/URL tidak didukung (hanya fragmen diagram)" }); else lib.skipped.push({ name: title, reason: "tidak ada xml/data" }); continue; }
        try {
            let xml = src.trimStart();
            if (!xml.startsWith("<")) xml = /^%3C/i.test(xml) ? decodeURIComponent(xml) : await inflateDiagramText(xml);
            if (!/^<mxGraphModel[\s>]/.test(xml.trimStart())) throw new DrawioError("structure", "bukan <mxGraphModel>");
            readMxGraphModel(xml, { hasNamedStyle: () => false, unknownShapes: new Set(), unknownNames: new Set() }, { htmlLabels: 0, sanitized: 0 }, false); // validasi dini
            const w = Number(it.w) > 0 ? Number(it.w) : 80, h = Number(it.h) > 0 ? Number(it.h) : 80;
            lib.specs.push({ kind: "mxlibrary", key: `frag_${slug(lib.name)}_${i}`, label: title, width: w, height: h, fragmentXml: xml });
        } catch (e) { lib.skipped.push({ name: title, reason: e instanceof Error ? e.message : String(e) }); }
    }
    opts.logger?.step("shapes", `Pustaka draw.io "${lib.name}": ${lib.specs.length}/${items.length} entri`, lib.specs.length > 0, lib.skipped.length ? `${lib.skipped.length} dilewati (mis. ${lib.skipped[0].name}: ${lib.skipped[0].reason})` : "semua entri valid");
}

/** Baca & validasi pustaka bentuk dari teks. Tidak mengubah registry. */
export async function readShapeLibrary(text: string, opts: ReadShapeOptions = {}): Promise<ShapeLibrary> {
    const kind = detectShapeLibrary(text);
    if (kind === "unknown") throw new DrawioError("unsupported", "Format tidak dikenal. Gunakan stensil <shapes>, SVG, atau pustaka draw.io <mxlibrary>.");
    const root = kind === "stencil" ? /<shapes[^>]*\sname\s*=\s*"([^"]*)"/i.exec(text)?.[1] : undefined;
    const name = opts.name ?? (root || (opts.fileName ? baseName(opts.fileName) : `${kind}-${libCounter + 1}`));
    const lib: ShapeLibrary = { id: `lib${++libCounter}_${slug(name)}`, name, kind, specs: [], skipped: [] };
    opts.logger?.debug("shapes", `Membaca pustaka "${name}" (${kind})`);
    if (kind === "stencil") readStencils(text, lib, opts);
    else if (kind === "svg") readSvg(text, lib, opts);
    else await readMxLibrary(text, lib, opts);
    if (!lib.specs.length) throw new DrawioError("structure", lib.skipped.length ? `Tidak ada bentuk valid. ${lib.skipped[0].name}: ${lib.skipped[0].reason}` : "Pustaka tidak berisi bentuk.");
    return lib;
}

/** Daftarkan stensil ke registry global maxGraph. Mengembalikan kunci yang terdaftar. */
export function registerStencils(lib: ShapeLibrary, logger?: MaxgraphLogger): string[] {
    const keys: string[] = [];
    for (const s of lib.specs) {
        if (s.kind !== "stencil" || !s.node) continue;
        try { StencilShapeRegistry.add(s.key, new StencilShape(s.node)); keys.push(s.key); }
        catch (e) { lib.skipped.push({ name: s.label, reason: `stensil gagal dibuat: ${e instanceof Error ? e.message : String(e)}` }); logger?.warn("shapes", `Stensil "${s.label}" gagal didaftarkan`, e); }
    }
    lib.specs = lib.specs.filter(s => s.kind !== "stencil" || keys.includes(s.key));
    return keys;
}

// ───────────────────────── thumbnail & node type ─────────────────────────

/** Pembuat thumbnail: satu graph tersembunyi dipakai ulang untuk semua item. Panggil `dispose()` setelah selesai. */
export function createThumbnailer(): { render(spec: ShapeSpec): string | undefined; dispose(): void } {
    let host: HTMLDivElement | undefined, g: Graph | undefined;
    const ensure = () => {
        if (g) return g;
        host = document.createElement("div");
        host.style.cssText = "position:fixed;left:-10000px;top:0;width:300px;height:300px;visibility:hidden;pointer-events:none";
        document.body.appendChild(host);
        g = new Graph(host);
        return g;
    };
    return {
        render(spec) {
            try {
                const graph = ensure();
                const model = graph.getDataModel();
                model.clear();
                if (spec.kind === "mxlibrary" && spec.fragmentXml) importMxGraphModel(graph, spec.fragmentXml, { mode: "replace", applySettings: false });
                else {
                    const k = Math.min(1, 56 / Math.max(spec.width, spec.height));
                    graph.insertVertex({
                        parent: graph.getDefaultParent(), value: "", position: [0, 0], size: [Math.max(8, spec.width * k), Math.max(8, spec.height * k)],
                        style: spec.kind === "stencil" ? { shape: spec.key, fillColor: "#cbd5e1", strokeColor: "#334155", strokeWidth: 1.5 } : { shape: "image", image: spec.image, aspect: "fixed" },
                    });
                }
                graph.refresh();
                return svgToDataUri(exportGraphSvg(graph, 4));
            } catch { return undefined; }
        },
        dispose() { g?.destroy(); host?.remove(); g = undefined; host = undefined; },
    };
}

export const MAX_THUMBNAILS = 300;

export function specToNodeType(spec: ShapeSpec, lib: ShapeLibrary, thumb?: string): MaxgraphNodeType {
    const id = `${slug(lib.id)}_${slug(spec.key)}`.slice(0, 80);
    const common = { id, label: spec.label, group: lib.name, width: spec.width, height: spec.height, icon: thumb, color: "#f1f5f9", source: lib.id } as const;
    if (spec.kind === "stencil") return { ...common, kind: "shape", style: { shape: spec.key, fillColor: "#e2e8f0", strokeColor: "#334155" } };
    if (spec.kind === "svg") return { ...common, kind: "shape", style: { shape: "image", image: spec.image, aspect: "fixed" } };
    return { ...common, kind: "fragment", fragmentXml: spec.fragmentXml };
}
