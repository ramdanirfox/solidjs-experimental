/** Presentasi contoh yang dibangun sepenuhnya dengan API `@office-kit/pptx` (shape, teks kaya, tabel, grafik, gambar, grup, catatan, transisi, animasi, komentar). */
import * as P from "@office-kit/pptx";
import { PptxDeck } from "./pptx-model";
import { samplePng } from "../office-shared/png";

const { inches: In } = P;

export async function createSampleDeck(lang: "id" | "en" = "id"): Promise<PptxDeck> {
  const id = lang === "id";
  const T = (a: string, b: string) => (id ? a : b);
  const pres = P.createPresentation({ size: "16:9" });
  P.setCoreProperties(pres, { title: T("Contoh Presentasi — PPTX Editor", "Sample Deck — PPTX Editor"), creator: "SolidJS Experimental", subject: T("Demo komponen editor", "Editor component demo"), keywords: "pptx, office-kit, solidjs" });
  const W = 13.333, H = 7.5;
  const blank = () => P.addBlankSlide(pres);
  const text = (s: P.SlideData, x: number, y: number, w: number, h: number, t: string, o: { size?: number; bold?: boolean; color?: string; align?: "left" | "center" | "right"; name?: string } = {}) => {
    const sh = P.addSlideTextBox(s, { x: In(x), y: In(y), w: In(w), h: In(h), text: t, name: o.name });
    P.setShapeTextFormat(sh, { size: o.size ?? 20, bold: o.bold, color: (o.color ?? "#1F2937") as P.Color, font: "Calibri" });
    if (o.align) P.setShapeAlignment(sh, o.align);
    return sh;
  };

  // ── 1. Judul ──
  const s1 = blank();
  P.setSlideBackground(s1, "#14213D");
  const orb = P.addSlideShape(s1, { preset: "ellipse", x: In(9.4), y: In(-1.2), w: In(5.5), h: In(5.5) });
  P.setShapeGradientFill(orb, { stops: [{ offset: 0, color: "#4F8FE0" }, { offset: 1, color: "#14213D" }], angleDeg: 45 });
  P.setShapeNoStroke(orb);
  const orb2 = P.addSlideShape(s1, { preset: "ellipse", x: In(10.8), y: In(4.6), w: In(3.2), h: In(3.2) });
  P.setShapeFill(orb2, "#FCA311"); P.setShapeNoStroke(orb2);
  text(s1, 0.9, 2.2, 9.5, 1.6, T("Editor PPTX di Browser", "PPTX Editor in the Browser"), { size: 54, bold: true, color: "#FFFFFF", name: "Title" });
  text(s1, 0.95, 3.9, 9, 1, T("Dibangun dengan @office-kit/pptx dan SolidJS", "Built with @office-kit/pptx and SolidJS"), { size: 24, color: "#E5E5E5", name: "Subtitle" });
  const ln = P.addSlideLine(s1, { from: { x: In(1), y: In(3.85) }, to: { x: In(4.6), y: In(3.85) }, color: "#FCA311", widthEmu: 38100 });
  void ln;
  P.setSlideTransition(s1, { effect: "fade", speed: "med" });
  P.setSlideNotes(s1, T("Selamat datang! Seret bentuk untuk memindah, klik dua kali untuk mengedit teks.", "Welcome! Drag shapes to move them, double-click to edit text."));

  // ── 2. Agenda (placeholder judul + isi dengan bullet) ──
  const s2 = P.addContentSlide(pres, { title: T("Agenda", "Agenda"), body: [T("Render slide dari model OOXML", "Slide rendering from the OOXML model"), T("Edit teks, bentuk, tabel, grafik, gambar", "Edit text, shapes, tables, charts, pictures"), T("Catatan, transisi, animasi, komentar", "Notes, transitions, animations, comments"), T("Cari, ganti, riwayat undo, unduh", "Find, replace, undo history, download")].join("\n") });
  const title2 = P.findSlidePlaceholder(s2, "title");
  if (title2) { P.setShapeBounds(title2, { x: In(0.8), y: In(0.5), w: In(W - 1.6), h: In(1.2) }); P.setShapeTextFormat(title2, { size: 40, bold: true, color: "#14213D" }); P.setShapeAlignment(title2, "left"); }
  const body2 = P.getSlideShapes(s2).find(x => x !== title2 && P.getShapeKind(x) === "shape");
  if (body2) { P.setShapeBounds(body2, { x: In(0.8), y: In(1.9), w: In(W - 1.6), h: In(H - 2.6) }); P.setShapeTextFormat(body2, { size: 28, color: "#1F2937" }); }
  const bar = P.addSlideShape(s2, { preset: "rect", x: In(0), y: In(0), w: In(0.25), h: In(H) });
  P.setShapeFill(bar, "#FCA311"); P.setShapeNoStroke(bar);
  P.setSlideNotes(s2, T("Poin utama presentasi.", "Key points of the presentation."));
  P.setSlideTransition(s2, { effect: "push", direction: "l" });

  // ── 3. Bentuk ──
  const s3 = blank();
  text(s3, 0.8, 0.4, 11, 0.9, T("Bentuk, garis, dan grup", "Shapes, lines and groups"), { size: 36, bold: true, color: "#14213D" });
  const presets = ["roundRect", "star5", "rightArrow", "hexagon", "heart", "cloud"] as const;
  const fills = ["#4F8FE0", "#FCA311", "#E63946", "#2A9D8F", "#B5179E", "#6C757D"];
  presets.forEach((p, i) => {
    const x = 0.9 + (i % 3) * 3.9, y = 1.6 + Math.floor(i / 3) * 2.6;
    const sh = P.addSlideShape(s3, { preset: p, x: In(x), y: In(y), w: In(3.2), h: In(2.0), text: p });
    P.setShapeFill(sh, fills[i] as P.Color); P.setShapeNoStroke(sh);
    P.setShapeTextFormat(sh, { size: 20, bold: true, color: "#FFFFFF" });
    if (i === 0) P.setShapeShadow(sh, { blurEmu: 76200, offsetEmu: 50800, opacity: 0.4 });
    if (i === 3) P.setShapeRotation(sh, 8);
  });
  const c1 = P.addSlideShape(s3, { preset: "ellipse", x: In(11.2), y: In(0.5), w: In(1.0), h: In(1.0) });
  const c2 = P.addSlideShape(s3, { preset: "rect", x: In(11.5), y: In(1.2), w: In(1.3), h: In(0.7), text: T("Grup", "Group") });
  P.setShapeFill(c1, "#FCA311"); P.setShapeFill(c2, "#14213D"); P.setShapeTextFormat(c2, { color: "#FFFFFF", size: 16 });
  P.groupShapes([c1, c2], { name: "Grup contoh" });
  const arrow = P.addSlideLine(s3, { from: { x: In(4.2), y: In(6.9) }, to: { x: In(9.2), y: In(6.9) }, color: "#E63946", widthEmu: 28575 });
  P.setShapeStrokeArrow(arrow, "tail", { type: "triangle" });
  P.setShapeStrokeDash(arrow, "dash");
  P.setSlideNotes(s3, T("Semua bentuk dapat diseret, diubah ukuran, dan diputar.", "All shapes can be dragged, resized and rotated."));

  // ── 4. Data: tabel + grafik ──
  const s4 = blank();
  text(s4, 0.8, 0.4, 11, 0.9, T("Tabel dan grafik", "Table and chart"), { size: 36, bold: true, color: "#14213D" });
  const tbl = P.addSlideTable(s4, { x: In(0.8), y: In(1.7), w: In(5.8), h: In(3), rows: [[T("Modul", "Module"), T("Status", "Status"), T("Skor", "Score")], [T("Render", "Render"), T("Selesai", "Done"), "95"], [T("Tabel", "Tables"), T("Selesai", "Done"), "90"], [T("Grafik", "Charts"), T("Berjalan", "Ongoing"), "80"], [T("Total", "Total"), "", "265"]], firstRow: true, bandRow: true, name: "Tabel skor" });
  P.mergeTableCells(tbl, { row: 4, col: 0, rowSpan: 1, colSpan: 2 });
  P.setTableCellFill(P.getTableCell(tbl, 4, 0), "#FFE8B0");
  P.addSlideChart(s4, { x: In(7), y: In(1.5), w: In(5.6), h: In(4.2), name: "Grafik", spec: { kind: "column", title: T("Skor per kuartal", "Score per quarter"), categories: ["Q1", "Q2", "Q3", "Q4"], series: [{ name: T("Rencana", "Plan"), values: [60, 75, 85, 95], color: "#4F8FE0" }, { name: T("Realisasi", "Actual"), values: [55, 80, 78, 90], color: "#FCA311" }] } });
  P.addSlideComment(s4, { author: { name: "Reviewer", initials: "RV" }, text: T("Periksa kembali angka kuartal ketiga.", "Please re-check the third quarter figures."), position: { x: 6_000_000, y: 1_400_000 } });
  P.setSlideTransition(s4, { effect: "wipe", direction: "r", speed: "fast" });

  // ── 5. Gambar & teks kaya ──
  const s5 = blank();
  text(s5, 0.8, 0.4, 11, 0.9, T("Gambar dan teks", "Pictures and text"), { size: 36, bold: true, color: "#14213D" });
  const pic = P.addSlideImage(s5, samplePng(320, 160), { x: In(0.9), y: In(1.7), w: In(5.6), h: In(2.8), name: "Logo", fit: "stretch" as never });
  P.setShapeDescription(pic, T("Logo contoh", "Sample logo"));
  P.setShapeAnimation(pic, { effect: "fadeIn", durationMs: 800 });
  const rich = P.addSlideTextBox(s5, { x: In(7), y: In(1.7), w: In(5.5), h: In(3.5), text: "", name: "Teks kaya" });
  P.setShapeParagraphs(rich, [
    { runs: [{ text: T("Teks ", "Rich "), format: { size: 28, bold: true, color: "#14213D" } }, { text: T("kaya", "text"), format: { size: 28, italic: true, color: "#E63946" } }] },
    { runs: [{ text: T("Garis bawah, ", "Underline, "), format: { size: 20, underline: true } }, { text: T("coret, ", "strike, "), format: { size: 20, strike: true } }, { text: "x²", format: { size: 20 } }, { text: T(" dan tautan.", " and a link."), format: { size: 20, color: "#0563C1" } }] },
    { runs: [{ text: T("Poin pertama", "First point"), format: { size: 20 } }] },
    { runs: [{ text: T("Poin kedua", "Second point"), format: { size: 20 } }] },
  ]);
  P.setParagraphBullet(rich, 2, "bullet"); P.setParagraphBullet(rich, 3, "number");
  P.setShapeRunHyperlink(rich, 1, 3, "https://office-kit.github.io/pptx/");
  const rot = P.addSlideShape(s5, { preset: "roundRect", x: In(1.5), y: In(5.2), w: In(4.4), h: In(1.3), text: T("Diputar & diberi bayangan", "Rotated & shadowed") });
  P.setShapeFill(rot, "#2A9D8F"); P.setShapeNoStroke(rot); P.setShapeRotation(rot, -4); P.setShapeShadow(rot, {}); P.setShapeTextFormat(rot, { size: 22, bold: true, color: "#FFFFFF" });
  P.setSlideNotes(s5, T("Gambar dapat diubah ukuran dengan kunci rasio.", "Pictures can be resized with aspect-ratio lock."));

  // ── 6. Slide tersembunyi ──
  const s6 = blank();
  text(s6, 0.8, 3, 11.7, 1.2, T("Slide tersembunyi (tidak tampil di slideshow)", "Hidden slide (not shown in the slideshow)"), { size: 32, color: "#6C757D", align: "center" });
  P.setSlideHidden(s6, true);

  return PptxDeck.fromPresentation(pres, T("contoh-presentasi.pptx", "sample-deck.pptx"));
}
