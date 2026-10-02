/**
 * Conditional formatting: cellIs, expression, teks, blank/error, top/bottom N, above/below average,
 * duplikat/unik, colorScale & dataBar. Hasil berupa ResolvedStyle yang ditimpa di atas style dasar.
 * Rule yang belum didukung (iconSet, timePeriod) dicatat lewat onUnsupported.
 */
import type { Worksheet } from "@office-kit/xlsx/worksheet";
import type { Workbook } from "@office-kit/xlsx/workbook";
import { Evaluator, isErr, type Scalar } from "./xlsx-formula";
import { StyleResolver, type ResolvedStyle, mixHex, resolveColor, readableOn } from "./xlsx-style";

export interface CfHost {
  wb: Workbook;
  ev: Evaluator;
  styles: StyleResolver;
  textAt(ws: Worksheet, r: number, c: number): string;
}

interface Range { minRow: number; minCol: number; maxRow: number; maxCol: number }
interface Compiled {
  rule: any;
  ranges: Range[];
  anchor: { row: number; col: number };
  stats?: any;
}

export function shiftRefs(formula: string, dr: number, dc: number): string {
  if (!dr && !dc) return formula;
  return formula.split(/("(?:[^"]|"")*")/).map((part, i) => {
    if (i % 2) return part;
    return part.replace(/(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\w(])/g, (m, a, col, b, row) => {
      let c = col.toUpperCase().split("").reduce((n: number, ch: string) => n * 26 + ch.charCodeAt(0) - 64, 0);
      let r = parseInt(row, 10);
      if (!a) c += dc;
      if (!b) r += dr;
      if (c < 1 || r < 1) return "#REF!";
      let s = "";
      for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
      return `${a}${s}${b}${r}`;
    });
  }).join("");
}

function parseColors(innerXml: string | undefined, palette: string[]): { cfvos: { type: string; val?: string }[]; colors: string[] } {
  const cfvos: { type: string; val?: string }[] = [];
  const colors: string[] = [];
  if (!innerXml) return { cfvos, colors };
  for (const m of innerXml.matchAll(/<(?:\w+:)?cfvo\b([^>]*)\/?>/g)) {
    const type = /type="([^"]+)"/.exec(m[1]!)?.[1] ?? "min";
    const val = /val="([^"]*)"/.exec(m[1]!)?.[1];
    cfvos.push({ type, val });
  }
  for (const m of innerXml.matchAll(/<(?:\w+:)?color\b([^>]*)\/?>/g)) {
    const a = m[1]!;
    const color = {
      rgb: /rgb="([^"]+)"/.exec(a)?.[1],
      theme: /theme="(\d+)"/.exec(a)?.[1] !== undefined ? parseInt(/theme="(\d+)"/.exec(a)![1]!, 10) : undefined,
      indexed: /indexed="(\d+)"/.exec(a)?.[1] !== undefined ? parseInt(/indexed="(\d+)"/.exec(a)![1]!, 10) : undefined,
      tint: /tint="([-\d.eE]+)"/.exec(a)?.[1] !== undefined ? parseFloat(/tint="([-\d.eE]+)"/.exec(a)![1]!) : undefined,
    };
    const hex = resolveColor(color, palette);
    if (hex) colors.push(hex);
  }
  return { cfvos, colors };
}

export class CfEngine {
  private compiled = new Map<Worksheet, Compiled[]>();
  private reported = new Set<string>();
  onUnsupported?: (what: string) => void;

  constructor(private host: CfHost) {}

  invalidate() { this.compiled.clear(); }

  hasRules(ws: Worksheet): boolean {
    return (ws.conditionalFormatting?.length ?? 0) > 0;
  }

  private compile(ws: Worksheet): Compiled[] {
    let list = this.compiled.get(ws);
    if (list) return list;
    list = [];
    for (const cf of ws.conditionalFormatting ?? []) {
      const ranges = (cf.sqref?.ranges ?? []) as Range[];
      if (!ranges.length) continue;
      const anchor = { row: Math.min(...ranges.map(r => r.minRow)), col: Math.min(...ranges.map(r => r.minCol)) };
      for (const rule of cf.rules) list.push({ rule, ranges, anchor });
    }
    list.sort((a, b) => (a.rule.priority ?? 0) - (b.rule.priority ?? 0));
    this.compiled.set(ws, list);
    return list;
  }

  private numsIn(ws: Worksheet, c: Compiled): number[] {
    if (c.stats?.nums) return c.stats.nums;
    const nums: number[] = [];
    for (const rg of c.ranges) {
      const rows = rg.maxRow - rg.minRow + 1;
      if (rows * (rg.maxCol - rg.minCol + 1) > 200000) continue;
      for (let r = rg.minRow; r <= rg.maxRow; r++) for (let col = rg.minCol; col <= rg.maxCol; col++) {
        const v = this.host.ev.cellValue(ws, r, col);
        if (typeof v === "number") nums.push(v);
      }
    }
    nums.sort((a, b) => a - b);
    (c.stats ??= {}).nums = nums;
    return nums;
  }

  private cfvoValue(ws: Worksheet, c: Compiled, vo: { type: string; val?: string }, nums: number[]): number {
    switch (vo.type) {
      case "min": return nums[0] ?? 0;
      case "max": return nums[nums.length - 1] ?? 0;
      case "num": return Number(vo.val ?? 0);
      case "percent": return (nums[0] ?? 0) + ((nums[nums.length - 1] ?? 0) - (nums[0] ?? 0)) * (Number(vo.val ?? 0) / 100);
      case "percentile": { const i = Math.round((Number(vo.val ?? 0) / 100) * (nums.length - 1)); return nums[Math.max(0, i)] ?? 0; }
      case "formula": { const v = this.host.ev.evalText(vo.val ?? "0", { ws, row: c.anchor.row, col: c.anchor.col }); return typeof v === "number" ? v : 0; }
    }
    return 0;
  }

  /** Style hasil CF untuk satu sel, atau undefined bila tidak ada rule yang cocok. */
  styleFor(ws: Worksheet, r: number, c: number, base: ResolvedStyle): ResolvedStyle | undefined {
    const rules = this.compile(ws);
    if (!rules.length) return undefined;
    const matched: ResolvedStyle[] = [];
    let out: ResolvedStyle | undefined;
    const value = this.host.ev.cellValue(ws, r, c);
    for (const cr of rules) {
      if (!cr.ranges.some(rg => r >= rg.minRow && r <= rg.maxRow && c >= rg.minCol && c <= rg.maxCol)) continue;
      const res = this.evalRule(ws, cr, r, c, value, base);
      if (!res) continue;
      matched.push(res.style);
      if (res.stop) break;
    }
    if (!matched.length) return undefined;
    // rule prioritas tertinggi (angka terkecil) menang: terapkan dari yang terendah.
    out = base;
    for (let i = matched.length - 1; i >= 0; i--) out = { ...out, ...diff(base, matched[i]!) };
    return out;
  }

  private dxf(rule: any, base: ResolvedStyle): ResolvedStyle {
    const dxfs = (this.host.wb.styles as any).dxfs as any[] | undefined;
    const d = rule.dxfId !== undefined ? dxfs?.[rule.dxfId] : undefined;
    return this.host.styles.applyDxf(base, d);
  }

  private evalRule(ws: Worksheet, cr: Compiled, r: number, c: number, v: Scalar, base: ResolvedStyle): { style: ResolvedStyle; stop: boolean } | undefined {
    const rule = cr.rule;
    const stop = !!rule.stopIfTrue;
    const ev = this.host.ev;
    const hit = (b: boolean) => (b ? { style: this.dxf(rule, base), stop } : undefined);
    const isNum = typeof v === "number";
    switch (rule.type) {
      case "cellIs": {
        const f1 = ev.evalText(rule.formulas?.[0] ?? "0", { ws, row: r, col: c });
        const f2 = rule.formulas?.[1] !== undefined ? ev.evalText(rule.formulas[1], { ws, row: r, col: c }) : null;
        const cmp = (a: Scalar, b: Scalar) => (typeof a === "number" && typeof b === "number" ? a - b : String(a ?? "").toLowerCase() < String(b ?? "").toLowerCase() ? -1 : String(a ?? "").toLowerCase() > String(b ?? "").toLowerCase() ? 1 : 0);
        if (isErr(v) || isErr(f1)) return undefined;
        switch (rule.operator) {
          case "lessThan": return hit(cmp(v, f1) < 0);
          case "lessThanOrEqual": return hit(cmp(v, f1) <= 0);
          case "equal": return hit(cmp(v, f1) === 0);
          case "notEqual": return hit(cmp(v, f1) !== 0);
          case "greaterThan": return hit(cmp(v, f1) > 0);
          case "greaterThanOrEqual": return hit(cmp(v, f1) >= 0);
          case "between": return hit(cmp(v, f1) >= 0 && cmp(v, f2) <= 0);
          case "notBetween": return hit(cmp(v, f1) < 0 || cmp(v, f2) > 0);
        }
        return undefined;
      }
      case "expression": {
        const f = shiftRefs(rule.formulas?.[0] ?? "FALSE", r - cr.anchor.row, c - cr.anchor.col);
        const res = ev.evalText(f, { ws, row: r, col: c });
        return hit(!isErr(res) && !!res && res !== "0" && res !== 0);
      }
      case "containsText": case "notContainsText": case "beginsWith": case "endsWith": {
        const t = String(rule.text ?? "").toLowerCase();
        const s = this.host.textAt(ws, r, c).toLowerCase();
        const op = rule.type;
        const ok = op === "containsText" ? s.includes(t) : op === "notContainsText" ? !s.includes(t) : op === "beginsWith" ? s.startsWith(t) : s.endsWith(t);
        return hit(ok);
      }
      case "containsBlanks": return hit(v === null || v === "");
      case "notContainsBlanks": return hit(!(v === null || v === ""));
      case "containsErrors": return hit(isErr(v));
      case "notContainsErrors": return hit(!isErr(v));
      case "top10": {
        if (!isNum) return undefined;
        const nums = this.numsIn(ws, cr);
        const k = rule.percent ? Math.max(1, Math.floor((nums.length * (rule.rank ?? 10)) / 100)) : (rule.rank ?? 10);
        const thr = rule.bottom ? nums[Math.min(k, nums.length) - 1] : nums[Math.max(0, nums.length - k)];
        return hit(thr !== undefined && (rule.bottom ? v <= thr : v >= thr));
      }
      case "aboveAverage": {
        if (!isNum) return undefined;
        const nums = this.numsIn(ws, cr);
        const avg = nums.reduce((a, b) => a + b, 0) / (nums.length || 1);
        const above = rule.aboveAverage !== false;
        return hit(above ? (rule.equalAverage ? v >= avg : v > avg) : (rule.equalAverage ? v <= avg : v < avg));
      }
      case "duplicateValues": case "uniqueValues": {
        if (v === null || v === "") return undefined;
        let counts: Map<string, number> = cr.stats?.counts;
        if (!counts) {
          counts = new Map();
          for (const rg of cr.ranges) for (let rr = rg.minRow; rr <= Math.min(rg.maxRow, rg.minRow + 50000); rr++) for (let cc = rg.minCol; cc <= rg.maxCol; cc++) {
            const k = String(ev.cellValue(ws, rr, cc)); counts.set(k, (counts.get(k) ?? 0) + 1);
          }
          (cr.stats ??= {}).counts = counts;
        }
        const n = counts.get(String(v)) ?? 0;
        return hit(rule.type === "duplicateValues" ? n > 1 : n === 1);
      }
      case "colorScale": {
        if (!isNum) return undefined;
        const { cfvos, colors } = (cr.stats ??= {}).scale ??= parseColors(rule.innerXml, this.host.styles.palette);
        if (colors.length < 2) return undefined;
        const nums = this.numsIn(ws, cr);
        const pts: number[] = cfvos.map((vo: any) => this.cfvoValue(ws, cr, vo, nums));
        let col: string;
        if (v <= pts[0]!) col = colors[0]!;
        else if (v >= pts[pts.length - 1]!) col = colors[colors.length - 1]!;
        else {
          let i = 0; while (i < pts.length - 2 && v > pts[i + 1]!) i++;
          const span = pts[i + 1]! - pts[i]!;
          col = mixHex(colors[i]!, colors[i + 1]!, span === 0 ? 0 : (v - pts[i]!) / span);
        }
        return { style: { ...base, bg: col, bgImage: undefined, color: base.color ?? readableOn(col) }, stop };
      }
      case "dataBar": {
        if (!isNum) return undefined;
        const { cfvos, colors } = (cr.stats ??= {}).bar ??= parseColors(rule.innerXml, this.host.styles.palette);
        const nums = this.numsIn(ws, cr);
        const lo = cfvos[0] ? this.cfvoValue(ws, cr, cfvos[0], nums) : nums[0] ?? 0;
        const hi = cfvos[1] ? this.cfvoValue(ws, cr, cfvos[1], nums) : nums[nums.length - 1] ?? 0;
        const pct = hi === lo ? 100 : Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
        const color = colors[0] ?? "#638EC6";
        return { style: { ...base, bgImage: `linear-gradient(to right, ${color} ${pct}%, transparent ${pct}%)` }, stop };
      }
      default:
        if (!this.reported.has(rule.type)) { this.reported.add(rule.type); this.onUnsupported?.(rule.type); }
        return undefined;
    }
  }
}

/** Hanya properti yang berubah terhadap base. */
function diff(base: ResolvedStyle, s: ResolvedStyle): Partial<ResolvedStyle> {
  const out: any = {};
  for (const k of Object.keys(s) as (keyof ResolvedStyle)[]) if (s[k] !== base[k]) out[k] = s[k];
  return out;
}
