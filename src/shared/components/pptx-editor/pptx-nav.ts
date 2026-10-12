/**
 * Cari/ganti lintas jenis dan daftar hyperlink untuk deck PPTX (tanpa DOM). Dipakai `PptxView` untuk perintah bus
 * (`find`, `replace`, `replaceAll`, `link.*`) dan panel tautan.
 */
import * as P from "@office-kit/pptx";
import type { PresentationData, SlideData, SlideShapeData } from "@office-kit/pptx";
import { classifyLink, type LinkItem } from "../editor-kit/hyperlink";
import { sameColor, sameFont, type ReplaceKind } from "../editor-kit/find-replace";

export const PPTX_REPLACE_KINDS: readonly ReplaceKind[] = ["text", "notes", "link", "name", "font", "color", "fill", "stroke"];

/** Satu potongan teks yang dapat dicari & diganti (run, sel tabel, catatan, nama bentuk, URL tautan). */
export interface PptxUnit {
  kind: "text" | "notes" | "name" | "link";
  slide: number;
  /** -1 = catatan slide. */
  shapeId: number;
  shape: SlideShapeData | null;
  where: string;
  text: string;
  /** Untuk `link`: teks yang ditautkan. */
  label?: string;
  set(next: string): void;
}

export type TopShapes = (slide: SlideData) => SlideShapeData[];

const safe = <T>(fn: () => T, d: T): T => { try { return fn(); } catch { return d; } };

/** Bentuk teratas beserta anak grupnya (satu tingkat). */
function walkShapes(slide: SlideData, tops: TopShapes): { shape: SlideShapeData; group: boolean }[] {
  const out: { shape: SlideShapeData; group: boolean }[] = [];
  for (const s of tops(slide)) {
    if (safe(() => P.getShapeKind(s), "") === "group") { for (const c of safe(() => P.getGroupChildren(s), [])) out.push({ shape: c, group: true }); }
    else out.push({ shape: s, group: false });
  }
  return out;
}

export function collectUnits(slides: SlideData[], kinds: ReplaceKind[], tops: TopShapes): PptxUnit[] {
  const out: PptxUnit[] = [];
  const want = new Set(kinds);
  slides.forEach((slide, si) => {
    for (const { shape } of walkShapes(slide, tops)) {
      const id = safe(() => P.getShapeId(shape), -1);
      const name = safe(() => P.getShapeName(shape), "");
      if (want.has("name")) out.push({ kind: "name", slide: si, shapeId: id, shape, where: name, text: name, set: t => P.renameShape(shape, t) });
      if (safe(() => P.isTableShape(shape), false)) {
        if (want.has("text")) {
          const d = P.getTableDimensions(shape);
          for (let r = 0; r < d.rows; r++) for (let c = 0; c < d.cols; c++) {
            const cell = P.getTableCell(shape, r, c);
            out.push({ kind: "text", slide: si, shapeId: id, shape, where: `${name} T${r + 1}×${c + 1}`, text: P.getTableCellText(cell), set: t => P.setTableCellText(cell, t) });
          }
        }
        continue;
      }
      if (want.has("link")) {
        const u = safe(() => P.getShapeHyperlink(shape), null);
        if (u) out.push({ kind: "link", slide: si, shapeId: id, shape, where: name, text: u, label: name, set: t => P.setShapeHyperlink(shape, t || null) });
      }
      if (!want.has("text") && !want.has("link")) continue;
      const np = safe(() => P.getShapeParagraphCount(shape), 0);
      for (let p = 0; p < np; p++) {
        const nr = safe(() => P.getShapeRunCount(shape, p), 0);
        for (let r = 0; r < nr; r++) {
          if (want.has("text")) out.push({ kind: "text", slide: si, shapeId: id, shape, where: name, text: P.getShapeRunText(shape, p, r), set: t => P.setShapeRunText(shape, p, r, t) });
          if (want.has("link")) {
            const u = safe(() => P.getShapeRunHyperlink(shape, p, r), null);
            if (u) out.push({ kind: "link", slide: si, shapeId: id, shape, where: name, text: u, label: P.getShapeRunText(shape, p, r), set: t => P.setShapeRunHyperlink(shape, p, r, t || null) });
          }
        }
      }
    }
    if (want.has("notes")) {
      const n = safe(() => P.getSlideNotes(slide), "") ?? "";
      if (n) out.push({ kind: "notes", slide: si, shapeId: -1, shape: null, where: "notes", text: n, set: t => P.setSlideNotes(slide, t) });
    }
  });
  return out;
}

export function listLinks(slides: SlideData[], tops: TopShapes): LinkItem[] {
  const out: LinkItem[] = [];
  const units = collectUnits(slides, ["link"], tops);
  units.forEach((u, i) => out.push({
    id: `${u.slide}:${u.shapeId}:${i}`, url: u.text, text: u.label ?? "", kind: classifyLink(u.text),
    location: `Slide ${u.slide + 1} · ${u.where}`, target: { kind: "shape", slide: u.slide, id: u.shapeId },
  }));
  return out;
}

type ResolveColor = (c: string | null | undefined) => string | null;

/** Ganti nilai persis (font / warna teks / isi / garis). `to` kosong pada warna = hapus. Mengembalikan jumlah perubahan. */
export function replaceValues(pres: PresentationData, slides: SlideData[], tops: TopShapes, resolve: ResolveColor, kind: "font" | "color" | "fill" | "stroke", from: string, to: string): number {
  let n = 0;
  for (const slide of slides) {
    for (const { shape } of walkShapes(slide, tops)) {
      if (kind === "fill") {
        const cur = safe(() => P.getShapeFillColorResolved(pres, shape), null);
        if (cur && sameColor(cur, from)) { if (to) P.setShapeFill(shape, to as P.Color); else P.setShapeNoFill(shape); n++; }
        if (safe(() => P.isTableShape(shape), false)) {
          const d = P.getTableDimensions(shape);
          for (let r = 0; r < d.rows; r++) for (let c = 0; c < d.cols; c++) {
            const cell = P.getTableCell(shape, r, c);
            if (to && sameColor(resolve(safe(() => P.getTableCellFill(cell), null)), from)) { P.setTableCellFill(cell, to as P.Color); n++; }
          }
        }
      } else if (kind === "stroke") {
        const cur = safe(() => P.getShapeStrokeColorResolved(pres, shape), null);
        if (cur && sameColor(cur, from)) { if (to) P.setShapeStroke(shape, { color: to as P.Color }); else P.setShapeNoStroke(shape); n++; }
      } else {
        const np = safe(() => P.getShapeParagraphCount(shape), 0);
        for (let p = 0; p < np; p++) {
          const nr = safe(() => P.getShapeRunCount(shape, p), 0);
          for (let r = 0; r < nr; r++) {
            const f = safe(() => P.getShapeRunFormat(shape, p, r), null);
            if (!f) continue;
            if (kind === "font" && sameFont(f.font, from) && to) { P.setShapeRunFormat(shape, p, r, { font: to }); n++; }
            else if (kind === "color" && f.color && sameColor(resolve(f.color), from)) { P.setShapeRunFormat(shape, p, r, { color: to ? (to as P.Color) : null }); n++; }
          }
        }
      }
    }
  }
  return n;
}

/** Hitungan nilai (untuk pratinjau). */
export function countValues(pres: PresentationData, slides: SlideData[], tops: TopShapes, resolve: ResolveColor, kind: "font" | "color" | "fill" | "stroke", value: string): number {
  let n = 0;
  for (const slide of slides) for (const { shape } of walkShapes(slide, tops)) {
    if (kind === "fill") { if (sameColor(safe(() => P.getShapeFillColorResolved(pres, shape), null), value)) n++; }
    else if (kind === "stroke") { if (sameColor(safe(() => P.getShapeStrokeColorResolved(pres, shape), null), value)) n++; }
    else {
      const np = safe(() => P.getShapeParagraphCount(shape), 0);
      for (let p = 0; p < np; p++) for (let r = 0; r < safe(() => P.getShapeRunCount(shape, p), 0); r++) {
        const f = safe(() => P.getShapeRunFormat(shape, p, r), null);
        if (!f) continue;
        if (kind === "font" ? sameFont(f.font, value) : f.color && sameColor(resolve(f.color), value)) n++;
      }
    }
  }
  return n;
}
