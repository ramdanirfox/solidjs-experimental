/**
 * Cari/ganti lintas jenis, tautan sel, dan penggantian warna/font untuk diagram maxGraph (tanpa DOM editor).
 * Semua perubahan memakai `graph.batchUpdate` sehingga satu panggilan = satu langkah undo.
 */
import { type Cell, type Graph, domUtils } from "@maxgraph/core";
import { htmlToPlain, sanitizeHtmlLabel } from "./drawio";
import { classifyLink, type LinkItem } from "../editor-kit/hyperlink";
import { matchRanges, replaceInString, sameColor, sameFont, type ReplaceKind } from "../editor-kit/find-replace";

export const MAXGRAPH_REPLACE_KINDS: readonly ReplaceKind[] = ["text", "link", "data", "font", "color", "fill", "stroke"];

/** Semua vertex & edge (tanpa root/layer), urutan dokumen. */
export function allCells(graph: Graph): Cell[] {
  const out: Cell[] = [];
  const root = graph.getDataModel().getRoot();
  const walk = (c: Cell) => {
    for (let i = 0; i < c.getChildCount(); i++) {
      const k = c.getChildAt(i);
      if (k.isVertex() || k.isEdge()) out.push(k);
      walk(k);
    }
  };
  if (root) walk(root);
  return out;
}

export const isNodeValue = (c: Cell) => domUtils.isNode(c.value);
export const attrsOf = (c: Cell): [string, string][] => (isNodeValue(c) ? [...(c.value as Element).attributes].map(a => [a.name, a.value]) : []);
export const rawLabel = (c: Cell): string => (isNodeValue(c) ? ((c.value as Element).getAttribute("label") ?? "") : c.value == null ? "" : String(c.value));
export const isHtml = (g: Graph, c: Cell) => !!(g.getCellStyle(c) as Record<string, unknown>).html;
export const labelPlain = (g: Graph, c: Cell) => (isHtml(g, c) ? htmlToPlain(rawLabel(c)) : rawLabel(c));
export const cellName = (c: Cell, g?: Graph) => `${c.isEdge() ? "edge" : "node"} ${c.getId() ?? ""}${g ? ` “${labelPlain(g, c).slice(0, 24)}”` : ""}`;

// ───────── satuan teks ─────────

export interface GUnit {
  kind: "text" | "link" | "data";
  cell: Cell;
  /** Teks datar yang dicari. */
  text: string;
  /** Nama atribut (link/data). */
  attr?: string;
  /** Ganti kecocokan ke-`nth` (0-based) — atau semua bila `nth` kosong. Mengembalikan jumlah penggantian. */
  replace(re: RegExp, replacement: string, regex: boolean, nth?: number): number;
}

/** Ganti kemunculan teks hanya pada simpul teks HTML (tag/atribut tidak disentuh). */
export function replaceInHtml(html: string, re: RegExp, replacement: string, regex: boolean, nth?: number): { html: string; count: number } {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  let count = 0, seen = 0;
  const walk = (n: Node) => {
    for (const c of [...n.childNodes]) {
      if (c.nodeType === 3) {
        const t = c.nodeValue ?? "";
        const ranges = matchRanges(t, re);
        if (!ranges.length) continue;
        let out = "", last = 0;
        for (const r of ranges) {
          out += t.slice(last, r.start);
          if (nth === undefined || seen === nth) {
            const seg = t.slice(r.start, r.end);
            out += regex ? replaceInString(seg, re, replacement, true).text : replacement;
            count++;
          } else out += t.slice(r.start, r.end);
          seen++;
          last = r.end;
        }
        out += t.slice(last);
        c.nodeValue = out;
      } else if (c.nodeType === 1) walk(c);
    }
  };
  walk(doc.body);
  return { html: doc.body.innerHTML, count };
}

function replaceNthString(text: string, re: RegExp, replacement: string, regex: boolean, nth?: number): { text: string; count: number } {
  if (nth === undefined) return replaceInString(text, re, replacement, regex);
  const r = matchRanges(text, re)[nth];
  if (!r) return { text, count: 0 };
  const seg = text.slice(r.start, r.end);
  return { text: text.slice(0, r.start) + (regex ? replaceInString(seg, re, replacement, true).text : replacement) + text.slice(r.end), count: 1 };
}

/** Ubah satu atribut XML pada nilai sel (nilai diganti dengan klon agar tercatat sebagai satu perubahan model). */
export function setCellAttr(graph: Graph, cell: Cell, name: string, value: string | null) {
  const model = graph.getDataModel();
  let node: Element;
  if (isNodeValue(cell)) node = (cell.value as Element).cloneNode(true) as Element;
  else {
    node = document.implementation.createDocument(null, "object").documentElement;
    node.setAttribute("label", cell.value == null ? "" : String(cell.value));
  }
  if (value === null || value === "") node.removeAttribute(name); else node.setAttribute(name, value);
  graph.batchUpdate(() => model.setValue(cell, node as never));
}

export function collectUnits(graph: Graph, kinds: ReplaceKind[], setLabel: (cell: Cell, value: string) => boolean): GUnit[] {
  const want = new Set(kinds);
  const out: GUnit[] = [];
  for (const cell of allCells(graph)) {
    if (want.has("text")) {
      const html = isHtml(graph, cell);
      const raw = rawLabel(cell);
      if (raw) {
        out.push({
          kind: "text", cell, text: html ? htmlToPlain(raw) : raw,
          replace: (re, rep, regex, nth) => {
            if (html) { const r = replaceInHtml(rawLabel(cell), re, rep, regex, nth); if (r.count) setLabel(cell, sanitizeHtmlLabel(r.html)); return r.count; }
            const r = replaceNthString(rawLabel(cell), re, rep, regex, nth);
            if (r.count) setLabel(cell, r.text);
            return r.count;
          },
        });
      }
    }
    for (const [name, value] of attrsOf(cell)) {
      if (name === "label" || name === "id") continue;
      const isLink = name === "link";
      if ((isLink && !want.has("link")) || (!isLink && !want.has("data"))) continue;
      out.push({
        kind: isLink ? "link" : "data", cell, attr: name, text: value,
        replace: (re, rep, regex, nth) => {
          const r = replaceNthString(value, re, rep, regex, nth);
          if (!r.count || (isLink && !r.text.trim())) return 0;
          setCellAttr(graph, cell, name, r.text);
          return r.count;
        },
      });
    }
  }
  return out;
}

// ───────── hyperlink sel ─────────

export const linkOf = (c: Cell): string => (isNodeValue(c) ? ((c.value as Element).getAttribute("link") ?? "") : "");

export function listLinks(graph: Graph): LinkItem[] {
  const out: LinkItem[] = [];
  for (const c of allCells(graph)) {
    const url = linkOf(c);
    if (!url) continue;
    const id = c.getId() ?? "";
    out.push({ id, url, text: labelPlain(graph, c).slice(0, 80) || cellName(c), tooltip: (c.value as Element).getAttribute("tooltip") ?? undefined, kind: classifyLink(url), location: cellName(c), target: { kind: c.isEdge() ? "edge" : "node", id } });
  }
  return out;
}

// ───────── nilai: font / warna ─────────

const STYLE_KEY: Record<"font" | "color" | "fill" | "stroke", string> = { font: "fontFamily", color: "fontColor", fill: "fillColor", stroke: "strokeColor" };

function currentMatches(graph: Graph, cell: Cell, kind: "font" | "color" | "fill" | "stroke", from: string): boolean {
  const v = (graph.getCurrentCellStyle(cell) as Record<string, unknown>)[STYLE_KEY[kind]];
  if (typeof v !== "string") return false;
  return kind === "font" ? sameFont(v, from) : sameColor(v, from);
}

/** Ganti font/warna persis pada semua sel. `to` kosong: fill/stroke → "none", fontColor → kembali ke bawaan. */
export function replaceStyleValue(graph: Graph, kind: "font" | "color" | "fill" | "stroke", from: string, to: string): number {
  const cells = allCells(graph).filter(c => currentMatches(graph, c, kind, from));
  if (!cells.length) return 0;
  const key = STYLE_KEY[kind];
  const value = to ? (kind === "font" ? to : to.startsWith("#") ? to : `#${to}`) : kind === "color" || kind === "font" ? null : "none";
  graph.batchUpdate(() => graph.setCellStyles(key as never, value as never, cells));
  return cells.length;
}
export function countStyleValue(graph: Graph, kind: "font" | "color" | "fill" | "stroke", value: string): number {
  return allCells(graph).filter(c => currentMatches(graph, c, kind, value)).length;
}
