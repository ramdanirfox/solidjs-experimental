/**
 * Util hyperlink bersama editor: normalisasi, klasifikasi, dan pemeriksaan keamanan URL, plus tipe pengelolaan tautan.
 *
 * Perintah bus yang didaftarkan editor (nama sama di semua editor):
 *   - `link.list()`                       : semua tautan di dokumen → `LinkItem[]`
 *   - `link.set(url, opts?)`              : pasang/ubah tautan pada seleksi/objek terpilih (atau `opts.target`)
 *   - `link.remove(opts?)`                : hapus tautan pada seleksi/objek terpilih (atau `opts.target`)
 *   - `link.update(id, patch)`            : ubah satu tautan hasil `link.list`
 *   - `link.replace(from, to)`            : ganti URL secara massal → jumlah tautan yang berubah
 *   - `link.open(url)`                    : buka tautan (eksternal di tab baru; internal = navigasi di editor)
 * Event: `link` { action: "set"|"remove"|"update"|"replace", count, url? }.
 */
import type { NavTargetBase } from "./find-replace";

export type LinkKind = "web" | "mail" | "tel" | "file" | "anchor" | "other";

export interface LinkItem {
  /** Id stabil selama dokumen tidak berubah (dipakai `link.update`). */
  id: string;
  url: string;
  /** Teks yang ditautkan / nama objek. */
  text: string;
  tooltip?: string;
  kind: LinkKind;
  /** Lokasi manusiawi, mis. "Slide 2 · Title", "Sheet1!B2". */
  location: string;
  /** Target untuk `goto`. */
  target: NavTargetBase;
}

export interface LinkEvent { action: "set" | "remove" | "update" | "replace"; count: number; url?: string }
export interface OfficeLinkEvents { link: LinkEvent }

export interface LinkSetOptions { tooltip?: string; text?: string }

const UNSAFE = /^\s*(javascript|vbscript|data):/i;

/** Skema berbahaya yang tidak boleh dipasang/dibuka sebagai tautan */
export const isUnsafeUrl = (u: string) => UNSAFE.test(u);

/** Jenis tautan dari string URL. */
export function classifyLink(url: string): LinkKind {
  const u = url.trim();
  if (!u) return "other";
  if (u.startsWith("#")) return "anchor";
  if (/^mailto:/i.test(u)) return "mail";
  if (/^tel:/i.test(u)) return "tel";
  if (/^(https?|ftp):/i.test(u) || /^www\./i.test(u)) return "web";
  if (/^(file:|[a-z]:\\|\\\\|\.{0,2}\/)/i.test(u)) return "file";
  return "other";
}

/**
 * Rapikan masukan pengguna menjadi URL: alamat email → `mailto:`, `www.x` / `host.tld` → `https://…`, selain itu apa adanya.
 * Mengembalikan `null` bila kosong atau berskema berbahaya.
 */
export function normalizeLink(input: string): string | null {
  const u = input.trim();
  if (!u || u === "https://" || u === "http://") return null;
  if (isUnsafeUrl(u)) return null;
  if (u.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u)) return `mailto:${u}`;
  if (/^(www\.|[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$|:|\?))/i.test(u)) return `https://${u}`;
  return u;
}

/** Buka tautan eksternal dengan aman di tab baru. Mengembalikan false bila tidak dibuka. */
export function openExternal(url: string): boolean {
  const n = normalizeLink(url);
  if (!n || n.startsWith("#") || typeof window === "undefined") return false;
  window.open(n, "_blank", "noopener,noreferrer");
  return true;
}
