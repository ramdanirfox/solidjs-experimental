/**
 * Pratinjau isi objek OLE di browser: tentukan jenis (teks / gambar / audio / video / PDF) dari nama berkas dan magic bytes,
 * ambil payload yang sebenarnya (berkas tertanam di dalam `Ole10Native`, atau bytes mentah), lalu siapkan data siap tampil.
 * Tidak ada yang dieksekusi: HTML/SVG/skrip hanya ditampilkan sebagai teks atau lewat <img>.
 */
import { isCfb, readCfb } from "./ole-core";

export type OlePreviewKind = "text" | "image" | "audio" | "video" | "pdf";
export interface OlePayload { fileName: string; data: Uint8Array; mime: string; kind?: OlePreviewKind }
export interface OlePreviewData extends OlePayload { kind: OlePreviewKind; text?: string; truncated?: boolean }

/** Batas teks yang dimuat ke dialog (byte). */
export const OLE_TEXT_LIMIT = 512 * 1024;

const EXT: Record<string, [string, OlePreviewKind]> = {
  png: ["image/png", "image"], jpg: ["image/jpeg", "image"], jpeg: ["image/jpeg", "image"], gif: ["image/gif", "image"], webp: ["image/webp", "image"],
  bmp: ["image/bmp", "image"], svg: ["image/svg+xml", "image"], ico: ["image/x-icon", "image"], avif: ["image/avif", "image"],
  mp3: ["audio/mpeg", "audio"], wav: ["audio/wav", "audio"], ogg: ["audio/ogg", "audio"], oga: ["audio/ogg", "audio"], m4a: ["audio/mp4", "audio"], aac: ["audio/aac", "audio"], flac: ["audio/flac", "audio"],
  mp4: ["video/mp4", "video"], webm: ["video/webm", "video"], ogv: ["video/ogg", "video"], m4v: ["video/mp4", "video"], mov: ["video/quicktime", "video"],
  pdf: ["application/pdf", "pdf"],
};
const TEXT_EXT = new Set(["txt", "text", "md", "markdown", "csv", "tsv", "json", "xml", "html", "htm", "css", "js", "mjs", "ts", "tsx", "jsx", "yaml", "yml", "ini", "cfg", "conf", "log", "sql", "sh", "bat", "ps1", "py", "java", "c", "h", "cpp", "cs", "go", "rs", "rb", "php", "toml", "properties", "rtf", "tex", "srt", "vtt"]);

const ext = (name: string) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase();
const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

/** Deteksi dari magic bytes (menimpa ekstensi yang salah/hilang). */
export function sniff(b: Uint8Array): [string, OlePreviewKind] | undefined {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47])) return EXT.png;
  if (startsWith(b, [0xff, 0xd8, 0xff])) return EXT.jpg;
  if (ascii(b, 0, 4) === "GIF8") return EXT.gif;
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return EXT.webp;
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WAVE") return EXT.wav;
  if (ascii(b, 0, 5) === "%PDF-") return EXT.pdf;
  if (ascii(b, 0, 4) === "OggS") return EXT.ogg;
  if (ascii(b, 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return EXT.mp3;
  if (ascii(b, 4, 8) === "ftyp") return EXT.mp4;
  if (startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) return EXT.webm;
  return undefined;
}

/** Heuristik teks: tidak ada NUL dan sebagian besar byte dapat dicetak (UTF-8/ASCII). */
export function looksLikeText(b: Uint8Array): boolean {
  const n = Math.min(b.length, 4096);
  if (!n) return true;
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const c = b[i];
    if (c === 0) return false;
    if (c < 9 || (c > 13 && c < 32)) bad++;
  }
  return bad / n < 0.02;
}

function classify(name: string, data: Uint8Array): { mime: string; kind?: OlePreviewKind } {
  const s = sniff(data);
  if (s) return { mime: s[0], kind: s[1] };
  const e = ext(name);
  const known = EXT[e];
  if (known) {
    // SVG & kawan-kawan berupa teks; tipe biner dengan ekstensi tapi isi tidak cocok tetap dicoba oleh browser
    return { mime: known[0], kind: known[1] };
  }
  if (TEXT_EXT.has(e) || looksLikeText(data)) return { mime: e === "html" || e === "htm" ? "text/plain" : "text/plain", kind: "text" };
  return { mime: "application/octet-stream" };
}

/**
 * Ambil payload objek: CFB dengan `Ole10Native` → berkas tertanamnya; CFB lain → tidak ada payload yang dapat ditampilkan;
 * zip (paket Office) → tidak dapat dipratinjau; selain itu bytes mentah dengan nama berkas part.
 */
export function oleSource(data: Uint8Array, fileName: string): OlePayload | undefined {
  if (isCfb(data)) {
    let n;
    try { n = readCfb(data).native; } catch { return undefined; }
    if (!n) return undefined;
    return { fileName: n.fileName || fileName, data: n.data, ...classify(n.fileName, n.data) };
  }
  // paket zip (xlsx/docx/pptx/…): bukan media/teks
  if (data[0] === 0x50 && data[1] === 0x4b) return undefined;
  return { fileName, data, ...classify(fileName, data) };
}

/** Apakah isi objek dapat dipratinjau langsung di browser? */
export function canPreviewOle(data: Uint8Array | undefined, fileName: string): boolean {
  if (!data) return false;
  return !!oleSource(data, fileName)?.kind;
}

/** Siapkan data pratinjau (teks didekode & dipotong). `undefined` bila tidak dapat dipratinjau. */
export function prepareOlePreview(data: Uint8Array, fileName: string): OlePreviewData | undefined {
  const src = oleSource(data, fileName);
  if (!src?.kind) return undefined;
  const out: OlePreviewData = { ...src, kind: src.kind };
  if (src.kind === "text") {
    const cut = src.data.length > OLE_TEXT_LIMIT;
    const slice = cut ? src.data.subarray(0, OLE_TEXT_LIMIT) : src.data;
    // UTF-16 BOM, lalu UTF-8 (fatal → cadangan windows-1252)
    let enc = "utf-8";
    if (slice[0] === 0xff && slice[1] === 0xfe) enc = "utf-16le";
    else if (slice[0] === 0xfe && slice[1] === 0xff) enc = "utf-16be";
    let text: string;
    try { text = new TextDecoder(enc, { fatal: enc === "utf-8" }).decode(slice); } catch { text = new TextDecoder("windows-1252").decode(slice); }
    out.text = text.replace(/^﻿/, "");
    out.truncated = cut;
  }
  return out;
}
