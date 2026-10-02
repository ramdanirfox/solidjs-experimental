/**
 * Workbook contoh yang dibangun dengan @office-kit/xlsx — memperlihatkan semua fitur preview:
 * style OOXML, merge, freeze, hidden row/col, autofilter, conditional formatting, formula lintas sheet,
 * komentar, hyperlink, defined name, dan gambar mengambang.
 */
import { createWorkbook, addWorksheet, addDefinedName, type Workbook } from "@office-kit/xlsx/workbook";
import {
  setCell, mergeCells, setFreezePanes, setColumnWidth, setRowHeight, hideColumn, hideRow, setAutoFilter,
  setComment, setHyperlink, addConditionalFormatting, addDataValidation, setSheetTabColor,
  makeConditionalFormatting, makeCfRule, makeDataValidation,
} from "@office-kit/xlsx/worksheet";
import { makeFormula } from "@office-kit/xlsx/cell";
import { addDxf, setCellStyle, type CellStyleSpec } from "@office-kit/xlsx/styles";
import { addImageAt } from "@office-kit/xlsx/drawing";
import type { Worksheet } from "@office-kit/xlsx/worksheet";

const rgb = (hex: string) => ({ rgb: "FF" + hex });
const solid = (hex: string) => ({ kind: "pattern" as const, patternType: "solid" as const, fgColor: rgb(hex) });
const side = (style: any, hex = "808080") => ({ style, color: rgb(hex) });

function style(wb: Workbook, ws: Worksheet, r: number, c: number, spec: CellStyleSpec) {
  const cell = ws.rows.get(r)?.get(c) ?? setCell(ws, r, c, null);
  setCellStyle(wb, cell, spec);
}

async function samplePng(): Promise<Uint8Array> {
  const W = 320, H = 180;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, "#1e3a8a"); grad.addColorStop(1, "#0ea5e9");
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(255,255,255,.9)";
    const bars = [60, 95, 75, 120, 100, 140];
    bars.forEach((h, i) => g.fillRect(24 + i * 46, H - 24 - h, 32, h));
    g.font = "bold 20px sans-serif"; g.fillText("Gambar mengambang", 20, 32);
    g.font = "12px sans-serif"; g.fillText("dirender dari xl/media/*.png", 20, 52);
    const blob: Blob = await new Promise(res => canvas.toBlob(b => res(b!), "image/png"));
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));
  }
}

export async function createSampleWorkbook(): Promise<Workbook> {
  const wb = createWorkbook();
  const ws = addWorksheet(wb, "Penjualan");
  const sum = addWorksheet(wb, "Ringkasan");
  const fmt = addWorksheet(wb, "Gaya & Format");
  const secret = addWorksheet(wb, "Rahasia", { state: "hidden" });
  wb.properties = { ...(wb.properties ?? {}), title: "Contoh Preview XLSX", creator: "SolidJS Experimental", description: "Dibuat otomatis oleh @office-kit/xlsx" } as any;

  // ── Penjualan ──
  setCell(ws, 1, 1, "Laporan Penjualan Kuartal 1");
  mergeCells(ws, "A1:H1");
  style(wb, ws, 1, 1, { font: { name: "Calibri", size: 18, bold: true, color: rgb("FFFFFF") }, fill: solid("1F3864"), alignment: { horizontal: "center", vertical: "center" } });
  setRowHeight(ws, 1, 32);
  setCell(ws, 2, 1, "Data fiktif — coba filter, cari, ubah sel, hitung ulang formula, lalu unduh.");
  mergeCells(ws, "A2:H2");
  style(wb, ws, 2, 1, { font: { italic: true, size: 10, color: rgb("595959") }, alignment: { horizontal: "left" } });

  const head = ["No", "Tanggal", "Produk", "Wilayah", "Qty", "Harga", "Diskon", "Total", "Catatan internal"];
  head.forEach((h, i) => {
    setCell(ws, 3, i + 1, h);
    style(wb, ws, 3, i + 1, {
      font: { bold: true, color: rgb("FFFFFF") }, fill: solid("2F75B5"),
      border: { bottom: side("medium", "1F4E79"), left: side("thin", "BDD7EE"), right: side("thin", "BDD7EE") },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
    });
  });
  setRowHeight(ws, 3, 24);

  const products = ["Laptop Pro", "Monitor 27\"", "Keyboard", "Mouse", "Dock USB-C", "Webcam HD"];
  const regions = ["Jakarta", "Bandung", "Surabaya", "Medan"];
  const prices = [14500000, 3200000, 650000, 350000, 1200000, 780000];
  let seed = 7;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const first = 4, n = 20;
  for (let i = 0; i < n; i++) {
    const r = first + i;
    const p = Math.floor(rnd() * products.length);
    setCell(ws, r, 1, i + 1);
    setCell(ws, r, 2, new Date(Date.UTC(2025, Math.floor(i / 7), 1 + ((i * 4) % 28))));
    setCell(ws, r, 3, products[p]!);
    setCell(ws, r, 4, regions[Math.floor(rnd() * regions.length)]!);
    setCell(ws, r, 5, 1 + Math.floor(rnd() * 12));
    setCell(ws, r, 6, prices[p]!);
    setCell(ws, r, 7, [0, 0.05, 0.1, 0.15][Math.floor(rnd() * 4)]!);
    setCell(ws, r, 8, makeFormula(`E${r}*F${r}*(1-G${r})`));
    if (i % 5 === 0) setCell(ws, r, 9, "cek stok");
    const band = i % 2 ? "F2F7FC" : "FFFFFF";
    const base = { fill: solid(band), border: { bottom: side("hair", "BFBFBF") } };
    style(wb, ws, r, 1, { ...base, alignment: { horizontal: "center" } });
    style(wb, ws, r, 2, { ...base, numberFormat: "dd mmm yyyy", alignment: { horizontal: "center" } });
    style(wb, ws, r, 3, base);
    style(wb, ws, r, 4, base);
    style(wb, ws, r, 5, { ...base, numberFormat: "0", alignment: { horizontal: "center" } });
    style(wb, ws, r, 6, { ...base, numberFormat: '"Rp" #,##0' });
    style(wb, ws, r, 7, { ...base, numberFormat: "0%", alignment: { horizontal: "center" } });
    style(wb, ws, r, 8, { ...base, numberFormat: '"Rp" #,##0', font: { bold: true } });
    style(wb, ws, r, 9, { ...base, font: { italic: true, color: rgb("C00000") } });
  }
  const last = first + n - 1;
  const tr = last + 2;
  setCell(ws, tr, 7, "Total");
  setCell(ws, tr, 8, makeFormula(`SUM(H${first}:H${last})`));
  setCell(ws, tr + 1, 7, "Rata-rata");
  setCell(ws, tr + 1, 8, makeFormula(`AVERAGE(H${first}:H${last})`));
  setCell(ws, tr + 2, 7, "Qty besar (≥8)");
  setCell(ws, tr + 2, 8, makeFormula(`COUNTIF(E${first}:E${last},">=8")`));
  for (const rr of [tr, tr + 1, tr + 2]) {
    style(wb, ws, rr, 7, { font: { bold: true }, alignment: { horizontal: "right" } });
    style(wb, ws, rr, 8, { font: { bold: true }, numberFormat: rr === tr + 2 ? "0" : '"Rp" #,##0', border: { top: side("thin", "000000"), bottom: rr === tr + 2 ? side("double", "000000") : undefined } as any });
  }
  setCell(ws, tr + 4, 1, "Dokumentasi library @office-kit/xlsx");
  setHyperlink(ws, `A${tr + 4}`, { target: "https://office-kit.github.io/xlsx/", display: "Dokumentasi library @office-kit/xlsx", tooltip: "Buka dokumentasi" });
  style(wb, ws, tr + 4, 1, { font: { color: rgb("0563C1"), underline: "single" } });
  setComment(ws, { ref: "H3", author: "Contoh", text: "Total = Qty × Harga × (1 − Diskon).\nDihitung ulang oleh mesin formula bawaan." });

  [5, 13, 16, 12, 8, 17, 9, 19, 20].forEach((w, i) => setColumnWidth(ws, i + 1, w));
  hideColumn(ws, 9);       // kolom I disembunyikan
  hideRow(ws, 8);          // baris 8 disembunyikan
  setFreezePanes(ws, { rows: 3, cols: 3 });
  setAutoFilter(ws, { ref: `A3:H${last}`, filterColumns: [] } as any);

  // Conditional formatting
  try {
    const red = addDxf(wb.styles, { font: { color: rgb("9C0006"), bold: true }, fill: { kind: "pattern", patternType: "solid", bgColor: rgb("FFC7CE"), fgColor: rgb("FFC7CE") } } as any);
    addConditionalFormatting(ws, makeConditionalFormatting({ sqref: `E${first}:E${last}`, rules: [makeCfRule({ type: "cellIs", priority: 1, operator: "lessThan", dxfId: red, formulas: ["3"] })] }));
    addConditionalFormatting(ws, makeConditionalFormatting({
      sqref: `H${first}:H${last}`,
      rules: [makeCfRule({ type: "colorScale", priority: 2, formulas: [], innerXml: '<colorScale><cfvo type="min"/><cfvo type="percentile" val="50"/><cfvo type="max"/><color rgb="FFF8696B"/><color rgb="FFFFEB84"/><color rgb="FF63BE7B"/></colorScale>' })],
    }));
  } catch { /* CF opsional */ }
  try { addDataValidation(ws, makeDataValidation({ type: "list", sqref: `D${first}:D${last}`, formula1: `"${regions.join(",")}"`, showInputMessage: true, prompt: "Pilih wilayah" })); } catch { /* opsional */ }
  setSheetTabColor(ws, "2F75B5");

  // Gambar mengambang
  try { addImageAt(ws, "K5", await samplePng(), { widthPx: 260, heightPx: 146 }); } catch { /* opsional */ }

  // ── Ringkasan ──
  setCell(sum, 1, 1, "Ringkasan per Wilayah");
  mergeCells(sum, "A1:D1");
  style(wb, sum, 1, 1, { font: { size: 16, bold: true, color: rgb("1F3864") }, border: { bottom: side("thick", "2F75B5") } as any });
  ["Wilayah", "Transaksi", "Qty", "Omzet"].forEach((h, i) => { setCell(sum, 3, i + 1, h); style(wb, sum, 3, i + 1, { font: { bold: true, color: rgb("FFFFFF") }, fill: solid("548235"), alignment: { horizontal: "center" } }); });
  regions.forEach((rg, i) => {
    const r = 4 + i;
    setCell(sum, r, 1, rg);
    setCell(sum, r, 2, makeFormula(`COUNTIF(Penjualan!$D$${first}:$D$${last},A${r})`));
    setCell(sum, r, 3, makeFormula(`SUMIF(Penjualan!$D$${first}:$D$${last},A${r},Penjualan!$E$${first}:$E$${last})`));
    setCell(sum, r, 4, makeFormula(`SUMIF(Penjualan!$D$${first}:$D$${last},A${r},Penjualan!$H$${first}:$H$${last})`));
    style(wb, sum, r, 4, { numberFormat: '"Rp" #,##0' });
  });
  setCell(sum, 8, 1, "Total");
  setCell(sum, 8, 2, makeFormula("SUM(B4:B7)")); setCell(sum, 8, 3, makeFormula("SUM(C4:C7)")); setCell(sum, 8, 4, makeFormula("SUM(D4:D7)"));
  for (let c = 1; c <= 4; c++) style(wb, sum, 8, c, { font: { bold: true }, border: { top: side("thin", "000000") } as any, numberFormat: c === 4 ? '"Rp" #,##0' : undefined as any });
  setCell(sum, 10, 1, "Wilayah terbesar");
  setCell(sum, 10, 2, makeFormula("INDEX(A4:A7,MATCH(MAX(D4:D7),D4:D7,0))"));
  setCell(sum, 11, 1, "Cek total = Penjualan");
  setCell(sum, 11, 2, makeFormula(`IF(D8=Penjualan!H${tr},"✔ cocok","✘ selisih")`));
  setCell(sum, 12, 1, "Contoh error");
  setCell(sum, 12, 2, makeFormula("1/0"));
  setCell(sum, 13, 1, "Dengan IFERROR");
  setCell(sum, 13, 2, makeFormula('IFERROR(1/0,"aman")'));
  setCell(sum, 14, 1, "Lookup Keyboard");
  setCell(sum, 14, 2, makeFormula('IFERROR(VLOOKUP("Keyboard",Penjualan!C4:F23,4,FALSE),"n/a")'));
  setCell(sum, 15, 1, "Teks");
  setCell(sum, 15, 2, makeFormula('UPPER(LEFT(B10,3))&" / "&TEXT(D8,"#,##0")'));
  try {
    addConditionalFormatting(sum, makeConditionalFormatting({ sqref: "D4:D7", rules: [makeCfRule({ type: "dataBar", priority: 1, formulas: [], innerXml: '<dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF5B9BD5"/></dataBar>' })] }));
  } catch { /* opsional */ }
  try { addDefinedName(wb, { name: "TotalOmzet", value: "Ringkasan!$D$8" }); } catch { /* opsional */ }
  setCell(sum, 17, 1, "Pakai nama terdefinisi");
  setCell(sum, 17, 2, makeFormula("TotalOmzet/1000000"));
  [22, 12, 10, 20].forEach((w, i) => setColumnWidth(sum, i + 1, w));
  setSheetTabColor(sum, "548235");

  // ── Gaya & Format ──
  setCell(fmt, 1, 1, "Galeri gaya sel OOXML");
  style(wb, fmt, 1, 1, { font: { size: 16, bold: true } });
  const borders: [string, any][] = [["thin", "thin"], ["medium", "medium"], ["thick", "thick"], ["dashed", "dashed"], ["dotted", "dotted"], ["double", "double"], ["hair", "hair"]];
  borders.forEach(([label, st], i) => {
    setCell(fmt, 3 + i, 1, `border ${label}`);
    style(wb, fmt, 3 + i, 1, { border: { left: side(st, "1F3864"), right: side(st, "1F3864"), top: side(st, "1F3864"), bottom: side(st, "1F3864") } });
  });
  const fonts: [string, CellStyleSpec][] = [
    ["Tebal", { font: { bold: true } }], ["Miring", { font: { italic: true } }], ["Garis bawah", { font: { underline: "single" } }],
    ["Coret", { font: { strike: true } }], ["Warna merah", { font: { color: rgb("C00000") } }], ["Font besar 20", { font: { size: 20 } }],
    ["Courier New", { font: { name: "Courier New" } }], ["Latar kuning", { fill: solid("FFF2CC") }],
  ];
  fonts.forEach(([label, spec], i) => { setCell(fmt, 3 + i, 3, label); style(wb, fmt, 3 + i, 3, spec); });
  const aligns: [string, CellStyleSpec][] = [
    ["Rata kiri", { alignment: { horizontal: "left" } }], ["Rata tengah", { alignment: { horizontal: "center" } }], ["Rata kanan", { alignment: { horizontal: "right" } }],
    ["Indent 2", { alignment: { horizontal: "left", indent: 2 } }], ["Teks panjang yang dibungkus (wrap) agar tampil beberapa baris", { alignment: { wrapText: true, vertical: "top" } }],
    ["Rotasi 45°", { alignment: { textRotation: 45 } }], ["Vertikal tengah", { alignment: { vertical: "center" } }],
  ];
  aligns.forEach(([label, spec], i) => { setCell(fmt, 3 + i, 5, label); style(wb, fmt, 3 + i, 5, spec); });
  setRowHeight(fmt, 7, 48); setRowHeight(fmt, 8, 40); setRowHeight(fmt, 9, 30); setRowHeight(fmt, 10, 30);
  const nums: [string, number, string][] = [
    ["General", 1234.5678, "General"], ["0.00", 1234.5678, "0.00"], ["#,##0", 1234567.891, "#,##0"], ["Persen", 0.256, "0.0%"],
    ["Rupiah", 1500000, '"Rp" #,##0'], ["Ilmiah", 123456789, "0.00E+00"], ["Tanggal panjang", 45678, "dddd, d mmmm yyyy"], ["Jam", 0.75, "h:mm AM/PM"], ["Pecahan", 0.75, "# ?/?"],
  ];
  nums.forEach(([label, v, code], i) => { setCell(fmt, 3 + i, 7, label); setCell(fmt, 3 + i, 8, v); style(wb, fmt, 3 + i, 8, { numberFormat: code }); });
  [20, 3, 22, 3, 24, 3, 18, 22].forEach((w, i) => setColumnWidth(fmt, i + 1, w));

  setCell(secret, 1, 1, "Sheet ini bersembunyi (state=hidden). Aktifkan “Tampilkan tersembunyi” untuk melihatnya.");

  setActiveFirst(wb);
  return wb;
}

function setActiveFirst(wb: Workbook) { wb.activeSheetIndex = 0; }
