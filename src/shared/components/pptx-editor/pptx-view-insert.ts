/** PptxView: pptx-view-insert.ts — fungsi bagian dari kelas (`this: PptxView`), dipasang di kelas sebagai properti agar API publik tidak berubah. */
import type { PptxView } from "./pptx-view";
import * as P from "@office-kit/pptx";
import type { ReadTextFormat } from "@office-kit/pptx";
import { IN } from "./pptx-view-shared";

export async function replaceImage(this: PptxView, f: File) { const s = this.sel[0]; if (this.readonly || !s || P.getShapeKind(s) !== "picture") return; P.setShapeImage(s, new Uint8Array(await f.arrayBuffer())); this.changed("hist.image"); this.rerenderShape(s); this.hooks.thumbs([this.slideIdx]); this.scheduleEmit(); }

export function imageProps(this: PptxView, o: { crop?: { left?: number; top?: number; right?: number; bottom?: number } | null; brightness?: number | null; contrast?: number | null; opacity?: number | null }) {
  this.apply("hist.image", s => {
    if (P.getShapeKind(s) !== "picture") return;
    if (o.crop !== undefined) P.setShapeImageCrop(s, o.crop);
    if (o.brightness !== undefined) P.setShapeImageBrightness(s, o.brightness);
    if (o.contrast !== undefined) P.setShapeImageContrast(s, o.contrast);
    if (o.opacity !== undefined) P.setShapeImageOpacity(s, o.opacity);
  });
}

export function insertTable(this: PptxView, rows: number, cols: number) {
  if (this.readonly || !this.slide) return;
  const size = P.getSlideSize(this.deck!.pres)!;
  const w = Math.round(size.width * 0.7), h = Math.round(Math.min(size.height * 0.6, rows * IN(0.5)));
  const t = P.addSlideTable(this.slide, { x: Math.round((size.width - w) / 2) as P.Emu, y: Math.round(size.height * 0.25) as P.Emu, w: w as P.Emu, h: h as P.Emu, rows: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (r === 0 ? `${c + 1}` : ""))), firstRow: true, bandRow: true });
  this.changed("hist.insert"); this.render(false); this.sel = [t]; this.updateOverlay(); this.emit(); this.hooks.thumbs([this.slideIdx]);
}

export function insertChart(this: PptxView, kind: P.ChartKind) {
  if (this.readonly || !this.slide) return;
  const size = P.getSlideSize(this.deck!.pres)!;
  const w = Math.round(size.width * 0.55), h = Math.round(size.height * 0.55);
  const cats = ["A", "B", "C", "D"];
  const series = kind === "pie" || kind === "doughnut" ? [{ name: "S1", values: [40, 25, 20, 15] }] : [{ name: "S1", values: [30, 45, 38, 60] }, { name: "S2", values: [20, 35, 50, 40] }];
  const spec = (kind === "scatter" ? { kind: "scatter", series: [{ name: "S1", xValues: [1, 2, 3, 4], values: [2, 5, 3, 6] }] } : { kind, categories: cats, series }) as unknown as P.ChartSpec;
  const c = P.addSlideChart(this.slide, { spec, x: Math.round((size.width - w) / 2) as P.Emu, y: Math.round((size.height - h) / 2) as P.Emu, w: w as P.Emu, h: h as P.Emu });
  this.changed("hist.insert"); this.render(false); this.sel = [c]; this.updateOverlay(); this.emit(); this.hooks.thumbs([this.slideIdx]);
}

export function chartSpecPatch(this: PptxView, patch: Record<string, unknown>) {
  const s = this.sel[0];
  if (this.readonly || !s || !P.isChartShape(s)) return;
  const charts = P.getSlideCharts(this.slide!);
  const ch = charts.find(c => c.shape === s);
  const cur = P.getShapeChartSpec(s);
  if (!ch || !cur) return;
  P.setChartSpec(ch, { ...(cur as unknown as P.ChartSpec), ...patch } as P.ChartSpec);
  this.changed("hist.chart"); this.rerenderShape(s); this.hooks.thumbs([this.slideIdx]); this.scheduleEmit();
}

// tabel
export function tableOp(this: PptxView, op: string, arg?: unknown) {
  const s = this.sel[0];
  if (this.readonly || !s || !P.isTableShape(s)) return;
  const cs = this.cellSel ?? { row: 0, col: 0 };
  const cell = () => P.getTableCell(s, cs.row, cs.col);
  try {
    switch (op) {
      case "rowAbove": P.insertTableRow(s, cs.row); break;
      case "rowBelow": P.insertTableRow(s, cs.row + 1); break;
      case "colLeft": P.insertTableColumn(s, cs.col); break;
      case "colRight": P.insertTableColumn(s, cs.col + 1); break;
      case "delRow": if (P.getTableDimensions(s).rows > 1) P.removeTableRow(s, cs.row); break;
      case "delCol": if (P.getTableDimensions(s).cols > 1) P.removeTableColumn(s, cs.col); break;
      case "delTable": this.deleteSelected(); return;
      case "merge": { const a = arg as { rowSpan: number; colSpan: number } | undefined; P.mergeTableCells(s, { row: cs.row, col: cs.col, rowSpan: a?.rowSpan ?? 1, colSpan: a?.colSpan ?? 2 }); break; }
      case "fill": if (arg === null) P.clearTableCellFill(cell()); else P.setTableCellFill(cell(), arg as P.Color); break;
      case "anchor": P.setTableCellAnchor(cell(), arg as "top" | "center" | "bottom"); break;
      case "flags": P.setTableStyleFlags(s, arg as Parameters<typeof P.setTableStyleFlags>[1]); break;
      case "border": { const a = arg as { color: string; widthPt: number }; P.setTableCellBorders(cell(), { left: { color: a.color, widthEmu: Math.round(a.widthPt * 12700) }, right: { color: a.color, widthEmu: Math.round(a.widthPt * 12700) }, top: { color: a.color, widthEmu: Math.round(a.widthPt * 12700) }, bottom: { color: a.color, widthEmu: Math.round(a.widthPt * 12700) } }); break; }
      case "colW": P.setTableColumnWidth(s, cs.col, Math.round((arg as number) * 360000) as P.Emu); break;
      case "rowH": P.setTableRowHeight(s, cs.row, Math.round((arg as number) * 360000) as P.Emu); break;
      default: return;
    }
  } catch (e) { this.hooks.log("error", "log.opFail", { op: `table.${op}`, msg: e instanceof Error ? e.message : String(e) }); this.hooks.toast("toast.opFail"); return; }
  this.changed("hist.table"); this.rerenderShape(s); this.hooks.thumbs([this.slideIdx]); this.scheduleEmit();
}

export function startPainter(this: PptxView) {
  const s = this.sel[0];
  if (!s || this.readonly) return;
  const i = this.info().shape!;
  let fmt: ReadTextFormat | null = null;
  try { for (let k = 0; k < P.getShapeParagraphCount(s); k++) if (P.getShapeRunCount(s, k) > 0) { fmt = P.getShapeRunFormatEffective(this.deck!.pres, s, k, 0); break; } } catch { /* abaikan */ }
  this.painterClip = { fill: i.fill, stroke: i.stroke, strokeW: i.strokeW, fmt, align: i.fmt?.align ?? null };
  const items: [string, string][] = [];
  if (i.fill) items.push(["fill", i.fill]);
  if (i.stroke) items.push(["stroke", `${i.stroke} ${Math.round(((i.strokeW ?? 12700) / 12700) * 10) / 10}pt`]);
  if (fmt?.font) items.push(["font", fmt.font]);
  if (fmt?.size) items.push(["size", `${fmt.size} pt`]);
  if (fmt?.bold) items.push(["bold", "✓"]);
  if (fmt?.italic) items.push(["italic", "✓"]);
  if (fmt?.color) items.push(["color", fmt.color]);
  if (i.fmt?.align) items.push(["align", i.fmt.align]);
  this.host.classList.add("px-painter");
  this.hooks.painter({ items });
}
