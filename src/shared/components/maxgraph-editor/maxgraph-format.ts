/**
 * `format.*` dan perintah struktur sel untuk diagram maxGraph (tanpa DOM editor).
 * Satu panggilan = satu langkah undo (`graph.batchUpdate`). Properti memetakan ke style maxGraph:
 * `fill`→fillColor, `color`→fontColor, `stroke`→strokeColor/strokeWidth/dashed, alfa→fillOpacity/strokeOpacity/textOpacity (0–100),
 * `bold/italic/underline`→bit `fontStyle`, `opacity`→opacity.
 */
import { type Cell, type Graph } from "@maxgraph/core";
import { allCells, rawLabel, labelPlain } from "./maxgraph-nav";
import { splitFormatKeys, clamp01, type FormatProps, type FormatReport } from "../editor-kit/format";

/** Target `format.apply`: sel menurut id (atau seluruh vertex/edge), default seleksi. */
export interface MaxgraphFormatTarget { id?: string; ids?: string[]; kind?: "vertex" | "edge" | "all" }

export const MAXGRAPH_FORMAT_KEYS = [
  "bold", "italic", "underline", "fontFamily", "fontSize", "color", "colorAlpha", "fill", "fillAlpha", "stroke", "align", "valign", "wrap", "opacity", "link",
  "rounded", "shadow", "dashed", "startArrow", "endArrow", "edgeStyle", "curved", "rotation", "bounds", "label",
] as const;

const FONT_BOLD = 1, FONT_ITALIC = 2, FONT_UNDERLINE = 4;
const pct = (a: number) => Math.round(clamp01(a) * 100);
const hexOrNull = (c: string | null | undefined, none: string | null): string | null => (c ? (c.startsWith("#") ? c : `#${c}`) : none);

export function resolveCells(graph: Graph, target: MaxgraphFormatTarget | undefined, selection: Cell[]): Cell[] {
  if (!target || (!target.id && !target.ids && !target.kind)) return selection.filter(c => c.isVertex() || c.isEdge());
  const model = graph.getDataModel();
  const out: Cell[] = [];
  for (const id of [...(target.ids ?? []), ...(target.id ? [target.id] : [])]) { const c = model.getCell(id); if (c && !out.includes(c)) out.push(c); }
  if (!target.ids && !target.id) {
    for (const c of allCells(graph)) if (target.kind === "all" || (target.kind === "vertex" && c.isVertex()) || (target.kind === "edge" && c.isEdge())) out.push(c);
  }
  return out;
}

/** Terapkan `props` ke `cells`; kunci tak didukung/tak berlaku dilaporkan di `skipped`. */
export function applyFormat(graph: Graph, cells: Cell[], props: FormatProps, hooks: { setLink?: (url: string | null, cells: Cell[]) => boolean } = {}): FormatReport {
  const { use, skipped } = splitFormatKeys(props, MAXGRAPH_FORMAT_KEYS);
  if (!cells.length || !use.length) return { applied: [], skipped: [...skipped, ...use], targets: 0 };
  const applied = new Set<string>();
  const vertices = cells.filter(c => c.isVertex()), edges = cells.filter(c => c.isEdge());
  const has = (k: string) => use.includes(k) && props[k] !== undefined;
  const style = (key: string, value: string | number | null, on: Cell[] = cells) => { if (on.length) graph.setCellStyles(key as never, value as never, on); };
  graph.batchUpdate(() => {
    // gaya huruf (bit fontStyle) dihitung per sel dalam satu langkah agar bit lain tetap dan bold+italic tidak saling menimpa
    const bits = ([["bold", FONT_BOLD], ["italic", FONT_ITALIC], ["underline", FONT_UNDERLINE]] as const).filter(([k]) => has(k));
    if (bits.length) {
      for (const c of cells) {
        let fs = Number((graph.getCurrentCellStyle(c) as Record<string, unknown>).fontStyle ?? 0) || 0;
        for (const [k, bit] of bits) fs = props[k] ? fs | bit : fs & ~bit;
        graph.setCellStyles("fontStyle" as never, (fs || null) as never, [c]);
      }
      for (const [k] of bits) applied.add(k);
    }
    if (has("fontFamily")) { style("fontFamily", (props.fontFamily as string | null) || null); applied.add("fontFamily"); }
    if (has("fontSize")) { style("fontSize", props.fontSize === null ? null : Number(props.fontSize)); applied.add("fontSize"); }
    if (has("color")) { style("fontColor", hexOrNull(props.color as string | null, null)); style("textOpacity", props.color === null ? null : props.colorAlpha !== undefined && props.colorAlpha < 1 ? pct(props.colorAlpha) : null); applied.add("color"); if (props.colorAlpha !== undefined) applied.add("colorAlpha"); }
    else if (has("colorAlpha")) { style("textOpacity", props.colorAlpha! < 1 ? pct(props.colorAlpha!) : null); applied.add("colorAlpha"); }
    if (has("fill")) { style("fillColor", hexOrNull(props.fill as string | null, "none")); style("fillOpacity", props.fill === null ? null : props.fillAlpha !== undefined && props.fillAlpha < 1 ? pct(props.fillAlpha) : null); applied.add("fill"); if (props.fillAlpha !== undefined) applied.add("fillAlpha"); }
    else if (has("fillAlpha")) { style("fillOpacity", props.fillAlpha! < 1 ? pct(props.fillAlpha!) : null); applied.add("fillAlpha"); }
    if (has("stroke")) {
      const s = props.stroke as { color?: string | null; width?: number; dash?: string; alpha?: number } | null;
      if (s === null || s?.color === null) style("strokeColor", "none");
      else if (s) {
        if (s.color) style("strokeColor", hexOrNull(s.color, null));
        if (s.width !== undefined) style("strokeWidth", s.width);
        if (s.dash) { style("dashed", s.dash === "solid" ? null : 1); style("dashPattern", s.dash === "dot" ? "1 3" : s.dash === "dashDot" ? "8 4 1 4" : null); }
        if (s.alpha !== undefined) style("strokeOpacity", s.alpha < 1 ? pct(s.alpha) : null);
      }
      applied.add("stroke");
    }
    if (has("align")) { style("align", props.align === "justify" ? "left" : (props.align as string)); applied.add("align"); }
    if (has("valign")) { style("verticalAlign", props.valign as string); applied.add("valign"); }
    if (has("wrap")) { style("whiteSpace", props.wrap ? "wrap" : null); applied.add("wrap"); }
    if (has("opacity")) { style("opacity", props.opacity! < 1 ? pct(props.opacity!) : null); applied.add("opacity"); }
    if (has("rounded")) { style("rounded", props.rounded ? 1 : 0); applied.add("rounded"); }
    if (has("shadow")) { style("shadow", props.shadow ? 1 : null); applied.add("shadow"); }
    if (has("dashed")) { style("dashed", props.dashed ? 1 : null); applied.add("dashed"); }
    if (has("rotation") && vertices.length) { style("rotation", Number(props.rotation) || null, vertices); applied.add("rotation"); }
    if (has("startArrow") && edges.length) { style("startArrow", (props.startArrow as string | null) || "none", edges); applied.add("startArrow"); }
    if (has("endArrow") && edges.length) { style("endArrow", (props.endArrow as string | null) || "none", edges); applied.add("endArrow"); }
    if (has("edgeStyle") && edges.length) { style("edgeStyle", (props.edgeStyle as string | null) || null, edges); applied.add("edgeStyle"); }
    if (has("curved") && edges.length) { style("curved", props.curved ? 1 : null, edges); applied.add("curved"); }
    if (has("label") && typeof props.label === "string") { for (const c of cells) graph.getDataModel().setValue(c, setLabelValue(c, props.label)); applied.add("label"); }
    if (has("bounds") && vertices.length && props.bounds && typeof props.bounds === "object") {
      const b = props.bounds as Partial<{ x: number; y: number; w: number; h: number }>;
      for (const c of vertices) {
        const g0 = c.getGeometry();
        if (!g0) continue;
        const g1 = g0.clone();
        if (b.x !== undefined) g1.x = b.x;
        if (b.y !== undefined) g1.y = b.y;
        if (b.w !== undefined) g1.width = b.w;
        if (b.h !== undefined) g1.height = b.h;
        graph.getDataModel().setGeometry(c, g1);
      }
      applied.add("bounds");
    }
  });
  if (has("link") && hooks.setLink && hooks.setLink((props.link as string | null) || null, cells)) applied.add("link");
  return { applied: use.filter(k => applied.has(k)), skipped: [...skipped, ...use.filter(k => !applied.has(k))], targets: cells.length };
}

/** Nilai label baru tanpa kehilangan atribut XML kustom pada sel bernilai Element. */
function setLabelValue(c: Cell, label: string): unknown {
  const v = c.value as unknown;
  if (v && typeof v === "object" && "setAttribute" in (v as object)) { const n = (v as Element).cloneNode(true) as Element; n.setAttribute("label", label); return n; }
  return label;
}

/** Format sel pertama sebagai `FormatProps` umum. */
export function readFormat(graph: Graph, cell: Cell): FormatProps {
  const s = graph.getCurrentCellStyle(cell) as Record<string, unknown>;
  const fs = Number(s.fontStyle ?? 0) || 0;
  const num = (k: string) => (typeof s[k] === "number" ? (s[k] as number) : undefined);
  const col = (k: string) => (typeof s[k] === "string" && s[k] !== "none" ? (s[k] as string) : null);
  return {
    bold: !!(fs & FONT_BOLD), italic: !!(fs & FONT_ITALIC), underline: !!(fs & FONT_UNDERLINE),
    fontFamily: typeof s.fontFamily === "string" ? s.fontFamily : null, fontSize: num("fontSize") ?? null,
    color: col("fontColor"), colorAlpha: num("textOpacity") !== undefined ? num("textOpacity")! / 100 : 1,
    fill: col("fillColor"), fillAlpha: num("fillOpacity") !== undefined ? num("fillOpacity")! / 100 : 1,
    stroke: { color: col("strokeColor"), width: num("strokeWidth"), dash: s.dashed ? "dash" : "solid", alpha: num("strokeOpacity") !== undefined ? num("strokeOpacity")! / 100 : 1 },
    align: (typeof s.align === "string" ? s.align : "center") as FormatProps["align"], valign: (typeof s.verticalAlign === "string" ? s.verticalAlign : "middle") as FormatProps["valign"],
    wrap: s.whiteSpace === "wrap", opacity: num("opacity") !== undefined ? num("opacity")! / 100 : 1,
    rounded: !!s.rounded, shadow: !!s.shadow, dashed: !!s.dashed,
  };
}

// ───────── struktur sel ─────────

export interface CellSummary { id: string; kind: "vertex" | "edge"; label: string; x?: number; y?: number; w?: number; h?: number; source?: string; target?: string; parent?: string; style: string }

export function listCells(graph: Graph, filter?: { kind?: "vertex" | "edge" }): CellSummary[] {
  return allCells(graph).filter(c => !filter?.kind || (filter.kind === "vertex" ? c.isVertex() : c.isEdge())).map(c => {
    const g = c.getGeometry();
    return {
      id: c.getId() ?? "", kind: c.isEdge() ? "edge" : "vertex", label: labelPlain(graph, c),
      ...(g && c.isVertex() ? { x: g.x, y: g.y, w: g.width, h: g.height } : {}),
      ...(c.isEdge() ? { source: c.source?.getId() ?? undefined, target: c.target?.getId() ?? undefined } : {}),
      parent: c.getParent()?.getId() ?? undefined,
      style: typeof c.style === "string" ? c.style : JSON.stringify(c.style ?? {}),
    };
  });
}

export interface CellPatch { label?: string; x?: number; y?: number; w?: number; h?: number; style?: Record<string, string | number | null> }

export function updateCell(graph: Graph, cell: Cell, patch: CellPatch): boolean {
  const model = graph.getDataModel();
  graph.batchUpdate(() => {
    if (patch.label !== undefined) model.setValue(cell, setLabelValue(cell, patch.label));
    if (cell.isVertex() && (patch.x !== undefined || patch.y !== undefined || patch.w !== undefined || patch.h !== undefined)) {
      const g0 = cell.getGeometry();
      if (g0) {
        const g1 = g0.clone();
        if (patch.x !== undefined) g1.x = patch.x;
        if (patch.y !== undefined) g1.y = patch.y;
        if (patch.w !== undefined) g1.width = patch.w;
        if (patch.h !== undefined) g1.height = patch.h;
        model.setGeometry(cell, g1);
      }
    }
    for (const [k, v] of Object.entries(patch.style ?? {})) graph.setCellStyles(k as never, v as never, [cell]);
  });
  return true;
}

export { rawLabel };
