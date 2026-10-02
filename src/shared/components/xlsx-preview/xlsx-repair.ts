/**
 * Perbaikan paket OOXML setelah penyimpanan agar Excel tidak meminta "recover".
 *
 * Penyebab nyata yang ditemukan pada @office-kit/xlsx 0.23.4:
 *  - `<customSheetViews>` ditulis SETELAH `<mergeCells>`, padahal CT_Worksheet mewajibkan sebelumnya. LibreOffice toleran,
 *    Excel menolak seluruh sheet ("XML error. Line 1, column 0") sehingga sheet hilang saat recover.
 *  - `xl/calcChain.xml` lama dipertahankan walau formula berubah → "Removed Records: Formula from /xl/calcChain.xml".
 *
 * Perbaikan dilakukan pada teks XML saja (tanpa parse penuh) sehingga isi lain tidak tersentuh, dan hanya bila diperlukan.
 */
import { openZip, createZipWriter } from "@office-kit/xlsx/zip";
import { fromArrayBuffer, toArrayBuffer } from "@office-kit/xlsx/io";

/** Urutan anak langsung <worksheet> menurut CT_Worksheet (ECMA-376). */
export const WORKSHEET_ORDER = [
  "sheetPr", "dimension", "sheetViews", "sheetFormatPr", "cols", "sheetData", "sheetCalcPr", "sheetProtection", "protectedRanges",
  "scenarios", "autoFilter", "sortState", "dataConsolidate", "customSheetViews", "mergeCells", "phoneticPr", "conditionalFormatting",
  "dataValidations", "hyperlinks", "printOptions", "pageMargins", "pageSetup", "headerFooter", "rowBreaks", "colBreaks", "customProperties",
  "cellWatches", "ignoredErrors", "smartTags", "drawing", "legacyDrawing", "legacyDrawingHF", "drawingHF", "picture", "oleObjects",
  "controls", "webPublishItems", "tableParts", "extLst",
];

/** Urutan anak langsung <workbook> menurut CT_Workbook. */
export const WORKBOOK_ORDER = [
  "fileVersion", "fileSharing", "workbookPr", "workbookProtection", "bookViews", "sheets", "functionGroups", "externalReferences",
  "definedNames", "calcPr", "oleSize", "customWorkbookViews", "pivotCaches", "smartTagPr", "smartTagTypes", "webPublishing",
  "fileRecoveryPr", "webPublishObjects", "extLst",
];

interface Tag { end: number; kind: "open" | "close" | "self" | "skip"; name: string }

/** Baca satu tag mulai dari `<` pada indeks i; aman terhadap '>' di dalam nilai atribut, komentar, CDATA, PI. */
function readTag(xml: string, i: number): Tag {
  if (xml.startsWith("<!--", i)) { const e = xml.indexOf("-->", i + 4); return { end: e < 0 ? xml.length : e + 3, kind: "skip", name: "" }; }
  if (xml.startsWith("<![CDATA[", i)) { const e = xml.indexOf("]]>", i + 9); return { end: e < 0 ? xml.length : e + 3, kind: "skip", name: "" }; }
  if (xml.startsWith("<?", i)) { const e = xml.indexOf("?>", i + 2); return { end: e < 0 ? xml.length : e + 2, kind: "skip", name: "" }; }
  if (xml.startsWith("<!", i)) { const e = xml.indexOf(">", i + 2); return { end: e < 0 ? xml.length : e + 1, kind: "skip", name: "" }; }
  const close = xml[i + 1] === "/";
  let j = i + (close ? 2 : 1);
  const nameStart = j;
  while (j < xml.length && !/[\s>/]/.test(xml[j]!)) j++;
  const name = xml.slice(nameStart, j);
  let quote = "";
  for (; j < xml.length; j++) {
    const ch = xml[j]!;
    if (quote) { if (ch === quote) quote = ""; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === ">") break;
  }
  const self = xml[j - 1] === "/";
  return { end: j + 1, kind: close ? "close" : self ? "self" : "open", name };
}

interface Child { name: string; text: string }

/** Pecah anak langsung elemen akar. Mengembalikan null bila struktur tidak dikenali. */
function splitRoot(xml: string, rootLocal: string): { head: string; children: Child[]; tail: string } | null {
  let i = 0;
  let rootEnd = -1;
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) return null;
    const t = readTag(xml, lt);
    if (t.kind === "skip") { i = t.end; continue; }
    if (t.kind !== "open" || t.name !== rootLocal) return null;
    rootEnd = t.end;
    break;
  }
  if (rootEnd < 0) return null;
  const children: Child[] = [];
  let pos = rootEnd;
  for (;;) {
    const lt = xml.indexOf("<", pos);
    if (lt < 0) return null;
    const t = readTag(xml, lt);
    if (t.kind === "skip") { pos = t.end; continue; }
    if (t.kind === "close") {
      if (t.name !== rootLocal) return null;
      return { head: xml.slice(0, rootEnd), children, tail: xml.slice(lt) };
    }
    let end = t.end;
    if (t.kind === "open") {
      let depth = 1;
      let k = t.end;
      while (depth > 0) {
        const n = xml.indexOf("<", k);
        if (n < 0) return null;
        const tt = readTag(xml, n);
        if (tt.kind === "open") depth++;
        else if (tt.kind === "close") depth--;
        k = tt.end;
      }
      end = k;
    }
    children.push({ name: t.name, text: xml.slice(lt, end) });
    // teks di antara anak (spasi/newline) dibuang agar urutan bersih; XML SpreadsheetML tidak peka spasi di level ini
    pos = end;
  }
}

/** Urutkan ulang anak elemen akar menurut `order`. Mengembalikan null bila sudah benar / tidak aman diubah. */
export function reorderChildren(xml: string, rootLocal: string, order: string[]): { xml: string; moved: string[] } | null {
  const parts = splitRoot(xml, rootLocal);
  if (!parts) return null;
  const local = (n: string) => n.replace(/^.*:/, "");
  const idx = parts.children.map(c => order.indexOf(local(c.name)));
  if (idx.some(v => v < 0)) return null; // elemen tak dikenal: jangan disentuh
  let ok = true;
  for (let i = 1; i < idx.length; i++) if (idx[i]! < idx[i - 1]!) { ok = false; break; }
  if (ok) return null;
  const sorted = parts.children.map((c, i) => ({ c, k: idx[i]!, i })).sort((a, b) => a.k - b.k || a.i - b.i);
  const moved: string[] = [];
  sorted.forEach((s, pos) => { if (s.i !== pos) moved.push(local(s.c.name)); });
  return { xml: parts.head + sorted.map(s => s.c.text).join("") + parts.tail, moved: [...new Set(moved)] };
}

export interface RepairReport {
  reordered: { part: string; moved: string[] }[];
  removed: string[];
  changed: boolean;
}

const WS_RE = /^xl\/worksheets\/[^/]+\.xml$/;
const dec = new TextDecoder("utf-8");
const enc = new TextEncoder();

/** Bangun ulang ZIP hanya bila ada perbaikan yang diperlukan. */
export async function repairPackage(bytes: Uint8Array): Promise<{ bytes: Uint8Array; report: RepairReport }> {
  const report: RepairReport = { reordered: [], removed: [], changed: false };
  const zip = await openZip(fromArrayBuffer(bytes));
  try {
    const names = zip.list();
    const out = new Map<string, Uint8Array | null>(); // null = buang
    const calc = names.filter(n => /(^|\/)calcChain\.xml$/i.test(n));
    for (const n of calc) { out.set(n, null); report.removed.push(n); }
    for (const n of names) {
      if (WS_RE.test(n)) {
        const fixed = reorderChildren(dec.decode(zip.read(n)), "worksheet", WORKSHEET_ORDER);
        if (fixed) { out.set(n, enc.encode(fixed.xml)); report.reordered.push({ part: n, moved: fixed.moved }); }
      } else if (n === "xl/workbook.xml") {
        const fixed = reorderChildren(dec.decode(zip.read(n)), "workbook", WORKBOOK_ORDER);
        if (fixed) { out.set(n, enc.encode(fixed.xml)); report.reordered.push({ part: n, moved: fixed.moved }); }
      }
    }
    if (calc.length) {
      const ct = "[Content_Types].xml";
      if (zip.has(ct)) out.set(ct, enc.encode(dec.decode(zip.read(ct)).replace(/<Override\b[^>]*calcChain[^>]*\/>/gi, "")));
      const rels = "xl/_rels/workbook.xml.rels";
      if (zip.has(rels)) out.set(rels, enc.encode(dec.decode(zip.read(rels)).replace(/<Relationship\b[^>]*calcChain[^>]*\/>/gi, "")));
    }
    report.changed = out.size > 0;
    if (!report.changed) return { bytes, report };

    const sink = toArrayBuffer();
    const writer = createZipWriter(sink);
    for (const n of names) {
      const replaced = out.get(n);
      if (replaced === null) continue;
      await writer.addEntry(n, replaced ?? zip.read(n), { compress: !/\.(png|jpe?g|gif|webp|zip)$/i.test(n) });
    }
    const fin = await writer.finalize();
    const result = fin && fin.length ? fin : new Uint8Array(sink.result());
    return { bytes: result, report };
  } finally {
    zip.close();
  }
}
