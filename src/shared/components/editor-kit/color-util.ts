/** Util warna bersama editor: parsing, komposit alfa, dan konversi hex ↔ rgba. */

export interface Rgb { r: number; g: number; b: number }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const h2 = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0").toUpperCase();

/** "#RGB" | "#RRGGBB" | "RRGGBB" | "#RRGGBBAA" → {r,g,b,a?}. Null bila tidak valid. */
export function parseHex(c: string | null | undefined): (Rgb & { a?: number }) | null {
  if (!c) return null;
  let s = c.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split("").map(x => x + x).join("");
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s)) return null;
  const o: Rgb & { a?: number } = { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) };
  if (s.length === 8) o.a = parseInt(s.slice(6, 8), 16) / 255;
  return o;
}

/** "#RRGGBB" huruf besar dari rgb. */
export const toHex = (c: Rgb) => `#${h2(c.r)}${h2(c.g)}${h2(c.b)}`;

/** Kembalikan "#RRGGBB" atau null. */
export function normalizeHex(c: string | null | undefined): string | null {
  const p = parseHex(c);
  return p ? toHex(p) : null;
}

/** `rgb(…)`/`rgba(…)` CSS → {hex, alpha}. Null bila bukan rgb(a). */
export function parseCssColor(css: string | null | undefined): { hex: string; alpha: number } | null {
  if (!css) return null;
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(css);
  if (!m) return null;
  let a = 1;
  if (m[4] !== undefined) a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return { hex: toHex({ r: +m[1], g: +m[2], b: +m[3] }), alpha: clamp(a, 0, 1) };
}

/** CSS `rgba()` dari hex + alfa. */
export function cssRgba(hex: string, alpha = 1): string {
  const p = parseHex(hex) ?? { r: 0, g: 0, b: 0 };
  return alpha >= 1 ? toHex(p) : `rgba(${p.r}, ${p.g}, ${p.b}, ${Math.round(clamp(alpha, 0, 1) * 1000) / 1000})`;
}

/**
 * Komposit warna `hex` ber-alfa di atas `over` (default putih) → "#RRGGBB" opak.
 * Dipakai untuk format yang tidak punya kanal alfa (mis. shading DOCX, isi sel XLSX).
 */
export function compositeOver(hex: string, alpha: number, over = "#FFFFFF"): string {
  const f = parseHex(hex), b = parseHex(over) ?? { r: 255, g: 255, b: 255 };
  if (!f) return over;
  const a = clamp(alpha, 0, 1);
  return toHex({ r: f.r * a + b.r * (1 - a), g: f.g * a + b.g * (1 - a), b: f.b * a + b.b * (1 - a) });
}

/** Nilai alfa → persen bulat (0–100). */
export const alphaPct = (a: number) => Math.round(clamp(a, 0, 1) * 100);
