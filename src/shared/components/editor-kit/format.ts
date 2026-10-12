/**
 * Kontrak `format.*` bersama untuk bus perintah semua editor (PPTX / XLSX / DOCX / maxGraph).
 *
 * `format.apply({ target?, props })` menerapkan properti ke target (default: seleksi saat ini). Bentuk `target` mengikuti
 * editor (bentuk PPTX, rentang XLSX, paragraf DOCX, sel maxGraph). Properti yang tak didukung editor TIDAK melempar:
 * dicatat di `skipped`. Seluruh perubahan = satu langkah undo.
 */

export type FormatAlign = "left" | "center" | "right" | "justify";

export interface FormatStroke {
  /** "#RRGGBB"; null = tanpa garis. */
  color?: string | null;
  /** Tebal garis (pt). */
  width?: number;
  dash?: "solid" | "dash" | "dot" | "dashDot";
  /** 0–1 */
  alpha?: number;
}

/** Properti umum. Editor boleh menambah kunci khusus (lihat `format.keys`). */
export interface FormatProps {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** Nama font; null = bawaan. */
  fontFamily?: string | null;
  /** Ukuran font (pt); null = bawaan. */
  fontSize?: number | null;
  /** Warna teks "#RRGGBB"; null = hapus warna. */
  color?: string | null;
  /** Opasitas teks 0–1 (editor tanpa kanal alfa mengomposit di atas putih atau melewatkannya). */
  colorAlpha?: number;
  /** Warna isi (bentuk/sel/shading); null = tanpa isi. */
  fill?: string | null;
  fillAlpha?: number;
  stroke?: FormatStroke | null;
  /** Rata teks horizontal. */
  align?: FormatAlign;
  /** Rata teks vertikal. */
  valign?: "top" | "middle" | "bottom";
  wrap?: boolean;
  /** Opasitas keseluruhan objek 0–1. */
  opacity?: number;
  /** Tautan pada target; null = hapus. */
  link?: string | null;
  [custom: string]: unknown;
}

export interface FormatSpec<Target = unknown> {
  target?: Target;
  props: FormatProps;
}

export interface FormatReport {
  /** Kunci yang diterapkan. */
  applied: string[];
  /** Kunci yang tak didukung editor ini / tak berlaku pada target. */
  skipped: string[];
  /** Jumlah objek/sel/paragraf yang dikenai. */
  targets: number;
}

export interface OfficeFormatEvents {
  format: { action: "apply"; report: FormatReport; target?: unknown };
}

/** Event struktur dokumen (slide/sheet/tabel/node ditambah, dihapus, dipindah, …). `scope` = jenis objek, `action` = operasi. */
export interface OfficeStructureEvents {
  structure: { scope: string; action: string; ok: boolean; detail?: unknown };
}

/** Kunci umum yang dikenali kontrak. */
export const COMMON_FORMAT_KEYS = [
  "bold", "italic", "underline", "strike", "fontFamily", "fontSize", "color", "colorAlpha",
  "fill", "fillAlpha", "stroke", "align", "valign", "wrap", "opacity", "link",
] as const;

/** Pisahkan kunci `props` menjadi yang didukung dan tidak (`undefined` diabaikan). */
export function splitFormatKeys(props: FormatProps, supported: readonly string[]): { use: string[]; skipped: string[] } {
  const ok = new Set(supported);
  const use: string[] = [], skipped: string[] = [];
  for (const k of Object.keys(props)) {
    if (props[k] === undefined) continue;
    (ok.has(k) ? use : skipped).push(k);
  }
  return { use, skipped };
}

export const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 1));
