/** Matematika penggaris murni (tanpa DOM): satuan, pemilihan langkah tick, dan format ukuran. Satuan dasar dokumen = px CSS pada 96 dpi, zoom 100%. */

export type RulerUnit = "px" | "cm" | "mm" | "in" | "pt";
export const RULER_UNITS: readonly RulerUnit[] = ["cm", "mm", "in", "pt", "px"];
export const PX_PER_UNIT: Record<RulerUnit, number> = { px: 1, cm: 96 / 2.54, mm: 96 / 25.4, in: 96, pt: 96 / 72 };

export const pxToUnit = (px: number, unit: RulerUnit) => px / PX_PER_UNIT[unit];
export const unitToPx = (v: number, unit: RulerUnit) => v * PX_PER_UNIT[unit];
export const EMU_PER_PX = 9525;
export const pxToEmu = (px: number) => Math.round(px * EMU_PER_PX);
export const emuToPx = (emu: number) => emu / EMU_PER_PX;

/** Pembulatan tampilan: px → bulat, mm/pt → 1 desimal, cm/in → 2 desimal. */
export function unitDigits(unit: RulerUnit): number { return unit === "px" ? 0 : unit === "mm" || unit === "pt" ? 1 : 2; }

export function formatNumber(v: number, digits: number): string {
  const r = Number(v.toFixed(digits));
  return Object.is(r, -0) ? "0" : String(r);
}
export function formatMeasure(px: number, unit: RulerUnit, withUnit = true): string {
  const s = formatNumber(pxToUnit(px, unit), unitDigits(unit));
  return withUnit ? `${s} ${unit}` : s;
}

export interface Tick { /** posisi layar (px) sepanjang penggaris */ pos: number; /** nilai dalam satuan, relatif ke titik nol */ value: number; kind: "major" | "mid" | "minor"; label?: string }
export interface TickOptions {
  unit: RulerUnit;
  /** Zoom (1 = 100%). */
  scale: number;
  /** Posisi layar dari titik asal dokumen (doc px 0). */
  origin: number;
  /** Koordinat dokumen (px) yang menjadi angka 0 pada penggaris. */
  zero: number;
  /** Panjang area penggaris (px layar). */
  length: number;
  /** Jarak layar minimum antar tick mayor. Default 50. */
  minMajorPx?: number;
}

const MANTISSA: { m: number; parts: number }[] = [{ m: 1, parts: 10 }, { m: 2, parts: 4 }, { m: 5, parts: 5 }];

/** Pilih langkah mayor (dalam satuan) dan jumlah subdivisi sehingga jarak layar ≥ minPx. */
export function chooseStep(unit: RulerUnit, scale: number, minPx = 50): { major: number; parts: number } {
  const pxPerUnit = PX_PER_UNIT[unit] * Math.max(scale, 1e-6);
  for (let exp = -4; exp <= 9; exp++) {
    const base = 10 ** exp;
    for (const { m, parts } of MANTISSA) if (m * base * pxPerUnit >= minPx) return { major: m * base, parts };
  }
  return { major: 10 ** 9, parts: 10 };
}

export function buildTicks(o: TickOptions): Tick[] {
  const { unit, scale, origin, zero, length } = o;
  if (!(length > 0) || !(scale > 0)) return [];
  const { major, parts } = chooseStep(unit, scale, o.minMajorPx);
  const minor = major / parts;
  const pxPerUnit = PX_PER_UNIT[unit];
  const toValue = (screen: number) => ((screen - origin) / scale - zero) / pxPerUnit;
  const vmin = toValue(0), vmax = toValue(length);
  let k0 = Math.ceil(vmin / minor - 1e-9), k1 = Math.floor(vmax / minor + 1e-9);
  if (k1 - k0 > 4000) { k1 = k0 + 4000; } // jaring pengaman
  const digits = Math.max(0, Math.min(4, Math.ceil(-Math.log10(major)) + (parts === 4 ? 1 : 0) ));
  const out: Tick[] = [];
  for (let k = k0; k <= k1; k++) {
    const value = k * minor;
    const pos = origin + (zero + value * pxPerUnit) * scale;
    const isMajor = k % parts === 0;
    const kind: Tick["kind"] = isMajor ? "major" : parts % 2 === 0 && k % (parts / 2) === 0 ? "mid" : "minor";
    out.push({ pos, value, kind, label: isMajor ? formatNumber(value, Math.max(digits, 0)) : undefined });
  }
  return out;
}

/** Tempel `v` (koordinat dokumen, px) ke kandidat terdekat dalam toleransi; kembalikan `v` bila tidak ada. */
export function snapValue(v: number, candidates: readonly number[], tolerance: number): { value: number; hit: number | null } {
  let best: number | null = null, bd = tolerance;
  for (const c of candidates) { const d = Math.abs(c - v); if (d <= bd) { bd = d; best = c; } }
  return best === null ? { value: v, hit: null } : { value: best, hit: best };
}

/** Tempel rentang [a, a+size]: sisi awal, tengah, atau akhir ke kandidat terdekat. Mengembalikan `a` baru. */
export function snapSpan(a: number, size: number, candidates: readonly number[], tolerance: number): { value: number; hit: number | null; edge: "start" | "center" | "end" | null } {
  const tries: [number, "start" | "center" | "end"][] = [[a, "start"], [a + size / 2, "center"], [a + size, "end"]];
  let best: { value: number; hit: number; edge: "start" | "center" | "end" } | null = null, bd = tolerance;
  for (const [p, edge] of tries) for (const c of candidates) {
    const d = Math.abs(c - p);
    if (d <= bd) { bd = d; best = { value: a + (c - p), hit: c, edge }; }
  }
  return best ?? { value: a, hit: null, edge: null };
}
