/** Mesin penomoran (numbering.xml): penghitung per-level, format angka/huruf/romawi, dan bullet. */
import { attr, els, first, num, val, type XEl } from "./docx-xml";
import { readP, readR, type PProps, type RProps, type Theme } from "./docx-style";

export interface Lvl {
  ilvl: number;
  start: number;
  fmt: string;
  text: string;
  suff: "tab" | "space" | "nothing";
  jc?: string;
  pStyle?: string;
  isLgl: boolean;
  restart?: number;
  p: PProps;
  r: RProps;
  /** Font bullet (Symbol/Wingdings) — dipakai untuk memetakan karakter private-use. */
  font?: string;
}
interface Abstract { id: string; levels: Map<number, Lvl>; multi?: string }
interface NumDef { id: string; abstractId: string; overrides: Map<number, { start?: number; lvl?: Lvl }> }

const ROMAN: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
export function toRoman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  let s = ""; for (const [v, r] of ROMAN) while (n >= v) { s += r; n -= v; } return s;
}
export function toLetters(n: number): string {
  if (n <= 0) return String(n);
  let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s;
}
export function formatNumber(n: number, fmt: string): string {
  switch (fmt) {
    case "decimal": return String(n);
    case "decimalZero": return n < 10 ? `0${n}` : String(n);
    case "upperRoman": return toRoman(n);
    case "lowerRoman": return toRoman(n).toLowerCase();
    case "upperLetter": return toLetters(n);
    case "lowerLetter": return toLetters(n).toLowerCase();
    case "ordinal": { const s = ["th", "st", "nd", "rd"]; const v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
    case "none": return "";
    case "decimalEnclosedCircle": return n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : String(n);
    case "decimalEnclosedParen": return n >= 1 && n <= 20 ? String.fromCodePoint(0x2474 + n - 1) : `(${n})`;
    default: return String(n);
  }
}

const SYMBOL_MAP: Record<string, string> = {
  "B7": "•", "A7": "▪", "A8": "♦", "D8": "➢", "FC": "✓", "76": "❖", "71": "❑", "6E": "■", "6C": "●", "6F": "□", "77": "◆", "A8W": "◻", "FB": "✗", "D0": "➔", "E0": "→",
};
/** Karakter bullet private-use (F0xx) font Symbol/Wingdings → Unicode umum. */
export function bulletChar(text: string, font?: string): string {
  if (!text) return "•";
  const ch = text[0];
  const code = ch.codePointAt(0)!;
  if (code >= 0xf000 && code <= 0xf0ff) return SYMBOL_MAP[(code - 0xf000).toString(16).toUpperCase()] ?? "•";
  if (/wingdings|symbol/i.test(font ?? "")) {
    const m = SYMBOL_MAP[code.toString(16).toUpperCase()];
    if (m) return m;
    if (code === 0x6f) return "o";
  }
  if (ch === "o" && /courier/i.test(font ?? "")) return "○";
  if (ch === "·") return "•";
  return text;
}

export class NumberingEngine {
  private abstracts = new Map<string, Abstract>();
  private nums = new Map<string, NumDef>();
  private counters = new Map<string, number[]>();
  private theme: Theme;

  constructor(part: { abstractNums: XEl[]; nums: XEl[] } | undefined, theme: Theme) {
    this.theme = theme;
    if (!part) return;
    for (const a of part.abstractNums) {
      const id = attr(a, "abstractNumId");
      if (id === undefined) continue;
      const levels = new Map<number, Lvl>();
      for (const l of els(a, "lvl")) { const lv = this.readLvl(l); levels.set(lv.ilvl, lv); }
      this.abstracts.set(id, { id, levels, multi: val(a, "multiLevelType") });
    }
    for (const n of part.nums) {
      const id = attr(n, "numId");
      const absId = val(n, "abstractNumId");
      if (id === undefined || absId === undefined) continue;
      const overrides = new Map<number, { start?: number; lvl?: Lvl }>();
      for (const o of els(n, "lvlOverride")) {
        const il = num(attr(o, "ilvl")) ?? 0;
        const lvlEl = first(o, "lvl");
        overrides.set(il, { start: num(val(o, "startOverride")), lvl: lvlEl ? this.readLvl(lvlEl) : undefined });
      }
      this.nums.set(id, { id, abstractId: absId, overrides });
    }
  }

  private readLvl(l: XEl): Lvl {
    const rPr = first(l, "rPr");
    const r = readR(rPr, this.theme);
    const suff = (val(l, "suff") as Lvl["suff"] | undefined) ?? "tab";
    return {
      ilvl: num(attr(l, "ilvl")) ?? 0,
      start: num(val(l, "start")) ?? 1,
      fmt: val(l, "numFmt") ?? "decimal",
      text: val(l, "lvlText") ?? "",
      suff,
      jc: val(l, "lvlJc"),
      pStyle: val(l, "pStyle"),
      isLgl: !!first(l, "isLgl"),
      restart: num(val(l, "lvlRestart")),
      p: readP(first(l, "pPr"), this.theme),
      r,
      font: attr(first(rPr, "rFonts"), "ascii"),
    };
  }

  has(numId: number | undefined): boolean { return numId !== undefined && this.nums.has(String(numId)); }

  lvl(numId: number, ilvl: number): Lvl | undefined {
    const n = this.nums.get(String(numId));
    if (!n) return undefined;
    const ov = n.overrides.get(ilvl);
    const base = this.abstracts.get(n.abstractId)?.levels.get(ilvl);
    if (ov?.lvl) return ov.lvl;
    return base;
  }

  /** Cari numId yang memetakan abstractNum dengan format tertentu (untuk toggle daftar). */
  findNumId(kind: "bullet" | "number"): number | undefined {
    for (const n of this.nums.values()) {
      const l0 = this.abstracts.get(n.abstractId)?.levels.get(0);
      if (!l0) continue;
      const isBullet = l0.fmt === "bullet";
      if (kind === "bullet" ? isBullet : (!isBullet && l0.fmt !== "none")) return Number(n.id);
    }
    return undefined;
  }

  reset() { this.counters.clear(); }

  /** Dapatkan label berikutnya (menaikkan penghitung). */
  next(numId: number, ilvl: number): { text: string; lvl: Lvl; bullet: boolean } | undefined {
    const n = this.nums.get(String(numId));
    if (!n) return undefined;
    const abs = this.abstracts.get(n.abstractId);
    if (!abs) return undefined;
    const lv = this.lvl(numId, ilvl);
    if (!lv) return undefined;
    const hasOverride = [...n.overrides.values()].some(o => o.start !== undefined);
    const key = hasOverride ? `n${n.id}` : `a${abs.id}`;
    let c = this.counters.get(key);
    if (!c) { c = new Array(9).fill(0); this.counters.set(key, c); }
    const startOf = (i: number) => {
      const ov = n.overrides.get(i);
      return ov?.start ?? (this.lvl(numId, i)?.start ?? 1);
    };
    if (c[ilvl] === 0) {
      // level pertama kali: pastikan level induk minimal bernilai start agar "1.1" tidak menjadi "0.1"
      for (let i = 0; i < ilvl; i++) if (c[i] === 0) c[i] = startOf(i);
      c[ilvl] = startOf(ilvl);
    } else c[ilvl]++;
    for (let i = ilvl + 1; i < 9; i++) {
      const lr = this.lvl(numId, i)?.restart;
      if (lr === 0) continue; // tidak pernah restart
      if (lr === undefined || lr - 1 >= ilvl) c[i] = 0;
    }
    if (lv.fmt === "bullet") return { text: bulletChar(lv.text, lv.font), lvl: lv, bullet: true };
    const text = lv.text.replace(/%([1-9])/g, (_m, d: string) => {
      const li = Number(d) - 1;
      const l2 = this.lvl(numId, li);
      const cur = c![li] || startOf(li);
      return formatNumber(cur, lv.isLgl ? "decimal" : l2?.fmt ?? "decimal");
    });
    return { text, lvl: lv, bullet: false };
  }
}
