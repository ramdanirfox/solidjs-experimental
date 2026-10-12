/**
 * Daftar bullet/bernomor: galeri gaya (preset), membuat definisi `abstractNum`/`num` di numbering.xml, mengubah gaya daftar,
 * mulai ulang, lanjutkan, dan nilai awal. Mesin penomoran membaca numbering.xml lewat `book.rebuildEngines()`.
 *
 * Aturan Word yang diikuti: paragraf dengan `numId` sama = satu daftar; `num` baru yang menunjuk `abstractNum` yang sama
 * dengan `lvlOverride/startOverride` = daftar yang dimulai ulang; `num` yang menunjuk `abstractNum` baru = daftar baru bergaya lain.
 */
import { numberingPart } from "@office-kit/docx";
import { attr, els, first, mk, num as toNum, setAttr, val, type XEl } from "./docx-xml";
import { paragraphNum } from "./docx-text";
import { readP } from "./docx-style";
import type { DocxBook } from "./docx-model";

export type ListKind = "bullet" | "number" | "multi";
export interface ListPreset { id: string; kind: ListKind; label: string; /** Contoh tampilan level 1 untuk galeri. */ sample: string }

interface LevelSpec { fmt: string; text: (i: number) => string; start?: number; isLgl?: boolean }

const CYCLE_NUM = ["decimal", "lowerLetter", "lowerRoman", "decimal", "lowerLetter", "lowerRoman", "decimal", "lowerLetter", "lowerRoman"];
const BULLETS: Record<string, string[]> = {
  "bullet-disc": ["•", "○", "■", "•", "○", "■", "•", "○", "■"],
  "bullet-circle": ["○", "■", "•", "○", "■", "•", "○", "■", "•"],
  "bullet-square": ["■", "•", "○", "■", "•", "○", "■", "•", "○"],
  "bullet-arrow": ["➢", "•", "–", "➢", "•", "–", "➢", "•", "–"],
  "bullet-check": ["✓", "•", "–", "✓", "•", "–", "✓", "•", "–"],
  "bullet-dash": ["–", "•", "○", "–", "•", "○", "–", "•", "○"],
};

export const LIST_PRESETS: ListPreset[] = [
  { id: "bullet-disc", kind: "bullet", label: "Disc", sample: "•" },
  { id: "bullet-circle", kind: "bullet", label: "Circle", sample: "○" },
  { id: "bullet-square", kind: "bullet", label: "Square", sample: "■" },
  { id: "bullet-arrow", kind: "bullet", label: "Arrow", sample: "➢" },
  { id: "bullet-check", kind: "bullet", label: "Check", sample: "✓" },
  { id: "bullet-dash", kind: "bullet", label: "Dash", sample: "–" },
  { id: "num-dot", kind: "number", label: "1. 2. 3.", sample: "1." },
  { id: "num-paren", kind: "number", label: "1) 2) 3)", sample: "1)" },
  { id: "num-enclosed", kind: "number", label: "(1) (2) (3)", sample: "(1)" },
  { id: "alpha-lower", kind: "number", label: "a) b) c)", sample: "a)" },
  { id: "alpha-upper", kind: "number", label: "A. B. C.", sample: "A." },
  { id: "roman-lower", kind: "number", label: "i. ii. iii.", sample: "i." },
  { id: "roman-upper", kind: "number", label: "I. II. III.", sample: "I." },
  { id: "multi-decimal", kind: "multi", label: "1. a. i.", sample: "1." },
  { id: "multi-legal", kind: "multi", label: "1  1.1  1.1.1", sample: "1.1" },
];

const SIMPLE_NUM: Record<string, { fmt: string; text: string }> = {
  "num-dot": { fmt: "decimal", text: "%1." }, "num-paren": { fmt: "decimal", text: "%1)" }, "num-enclosed": { fmt: "decimal", text: "(%1)" },
  "alpha-lower": { fmt: "lowerLetter", text: "%1)" }, "alpha-upper": { fmt: "upperLetter", text: "%1." },
  "roman-lower": { fmt: "lowerRoman", text: "%1." }, "roman-upper": { fmt: "upperRoman", text: "%1." },
};

function levelSpec(preset: ListPreset, i: number): LevelSpec {
  if (preset.kind === "bullet") return { fmt: "bullet", text: () => BULLETS[preset.id]?.[i] ?? "•" };
  if (preset.id === "multi-legal") return { fmt: "decimal", isLgl: i > 0, text: lv => Array.from({ length: lv + 1 }, (_, k) => `%${k + 1}`).join(".") + (lv === 0 ? "." : "") };
  if (preset.id === "multi-decimal") return { fmt: CYCLE_NUM[i], text: () => `%${i + 1}.` };
  const s = SIMPLE_NUM[preset.id] ?? SIMPLE_NUM["num-dot"];
  // level pertama sesuai preset; level dalam bergantian desimal/huruf/romawi dengan akhiran yang sama
  const suffix = s.text.replace(/%1/, "").trim();
  return i === 0 ? { fmt: s.fmt, text: () => s.text } : { fmt: CYCLE_NUM[i], text: () => `%${i + 1}${suffix.startsWith("(") ? "" : suffix}` };
}

function buildAbstract(id: number, preset: ListPreset): XEl {
  const lvls = Array.from({ length: 9 }, (_, i) => {
    const sp = levelSpec(preset, i);
    const kids: XEl[] = [mk("start", { val: 1 }), mk("numFmt", { val: sp.fmt })];
    if (sp.isLgl) kids.push(mk("isLgl"));
    kids.push(mk("lvlText", { val: sp.text(i) }), mk("lvlJc", { val: "left" }), mk("pPr", undefined, [mk("ind", { left: 720 * (i + 1), hanging: 360 })]));
    return mk("lvl", { ilvl: i }, kids);
  });
  return mk("abstractNum", { abstractNumId: id }, [mk("multiLevelType", { val: preset.kind === "multi" ? "multilevel" : "hybridMultilevel" }), ...lvls]);
}

const np = (book: DocxBook) => numberingPart(book.doc) as unknown as { abstractNums: XEl[]; nums: XEl[] } | undefined;

function ensurePart(book: DocxBook) {
  let part = np(book);
  if (!part) {
    // dokumen tanpa numbering.xml: buat lewat library (daftar sementara dibuang)
    book.ensureList("bullet");
    part = np(book);
  }
  return part;
}

export function presetById(id: string): ListPreset | undefined { return LIST_PRESETS.find(p => p.id === id); }

const maxId = (list: XEl[], attrName: string) => list.reduce((m, e) => Math.max(m, toNum(attr(e, attrName)) ?? 0), 0);

/** Definisi `num` dengan id tertentu. */
function numEl(book: DocxBook, numId: number): XEl | undefined { return np(book)?.nums.find(n => toNum(attr(n, "numId")) === numId); }
export function abstractIdOf(book: DocxBook, numId: number): number | undefined { const n = numEl(book, numId); return n ? toNum(attr(first(n, "abstractNumId"), "val")) : undefined; }

/**
 * Buat daftar baru. `abstractId` (opsional) memakai ulang definisi yang ada (untuk "mulai ulang"/"lanjutkan");
 * `start` menambah `startOverride` pada level pertama. Mengembalikan numId baru.
 */
export function createList(book: DocxBook, presetId: string, o: { abstractId?: number; start?: number } = {}): number {
  const part = ensurePart(book);
  if (!part) throw new Error("numbering.xml tidak dapat dibuat");
  const preset = presetById(presetId) ?? LIST_PRESETS[0];
  let absId = o.abstractId;
  if (absId === undefined) {
    absId = Math.max(9000, maxId(part.abstractNums, "abstractNumId")) + 1;
    part.abstractNums.push(buildAbstract(absId, preset));
  }
  const numId = maxId(part.nums, "numId") + 1;
  const kids: XEl[] = [mk("abstractNumId", { val: absId })];
  if (o.start !== undefined) kids.push(mk("lvlOverride", { ilvl: 0 }, [mk("startOverride", { val: o.start })]));
  part.nums.push(mk("num", { numId }, kids));
  (book.doc as unknown as { numberingDirty: boolean }).numberingDirty = true; // library menulis ulang numbering.xml hanya bila ditandai
  book.rebuildEngines();
  return numId;
}

/** Ganti gaya daftar `numId` (semua paragrafnya) dengan preset: `num` diarahkan ke `abstractNum` baru. */
export function restyleList(book: DocxBook, numId: number, presetId: string): boolean {
  const part = ensurePart(book);
  const n = numEl(book, numId);
  if (!part || !n) return false;
  const absId = Math.max(9000, maxId(part.abstractNums, "abstractNumId")) + 1;
  part.abstractNums.push(buildAbstract(absId, presetById(presetId) ?? LIST_PRESETS[0]));
  const ref = first(n, "abstractNumId");
  if (ref) setAttr(ref, "val", String(absId));
  (book.doc as unknown as { numberingDirty: boolean }).numberingDirty = true;
  book.rebuildEngines();
  return true;
}

/** numId & level efektif paragraf (langsung atau dari style). */
export function listOf(book: DocxBook, p: XEl): { numId: number; ilvl: number } | undefined {
  const base = book.styles.paraBase(val(first(p, "pPr"), "pStyle"));
  const direct = readP(first(p, "pPr"), book.styles.theme);
  const numId = direct.numId ?? base.p.numId ?? paragraphNum(p)?.numId;
  if (!numId) return undefined;
  return { numId, ilvl: direct.ilvl ?? base.p.ilvl ?? paragraphNum(p)?.ilvl ?? 0 };
}

export interface ListInfo { numId: number; ilvl: number; kind: "bullet" | "number"; preset?: string; start: number; abstractId?: number }

/** Ringkasan daftar pada paragraf (untuk UI). */
export function listInfo(book: DocxBook, p: XEl): ListInfo | undefined {
  const l = listOf(book, p);
  if (!l) return undefined;
  const lvl = book.numbering.lvl(l.numId, l.ilvl);
  const l0 = book.numbering.lvl(l.numId, 0);
  if (!lvl || !l0) return undefined;
  const abs = abstractIdOf(book, l.numId);
  const n = numEl(book, l.numId);
  const ov = n ? els(n, "lvlOverride").find(o => toNum(attr(o, "ilvl")) === 0) : undefined;
  const l1 = book.numbering.lvl(l.numId, 1);
  const preset = LIST_PRESETS.find(pr => { const a = levelSpec(pr, 0), b = levelSpec(pr, 1); return a.fmt === l0.fmt && a.text(0) === l0.text && !!l1 && b.fmt === l1.fmt && b.text(1) === l1.text; });
  return { numId: l.numId, ilvl: l.ilvl, kind: l0.fmt === "bullet" ? "bullet" : "number", preset: preset?.id, start: toNum(attr(first(ov, "startOverride"), "val")) ?? lvl.start, abstractId: abs };
}
