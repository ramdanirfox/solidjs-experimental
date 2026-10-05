/**
 * Tipe & util bersama editor Office (docx, pptx, xlsx): event umum, event OLE, dan masukan berkas untuk OLE.
 * Event penggaris (`ruler:*`) berasal dari `RulerEventMap`.
 */
import type { PreparedOle, PrepareOptions } from "../office-shared/ole-embed";

export interface OleEventInfo {
  /** Id objek: docx = id relasi, pptx = id shape, xlsx = indeks objek pada sheet. */
  id: string;
  /** Nama part embedding di paket OPC. */
  part: string;
  progId: string;
  fileName: string;
  /** Ukuran isi tertanam (byte). */
  size: number;
  kind: PreparedOle["kind"];
  /** Lokasi singkat: paragraf / slide / sel. */
  location?: string;
}

export interface OfficeOleEvents {
  "ole:inserted": OleEventInfo;
  "ole:updated": OleEventInfo & { previousId?: string };
  /** Pengguna membuka (klik ganda) objek OLE di kanvas. */
  "ole:open": { id: string; progId?: string };
  /** Dialog pratinjau isi objek OLE dibuka (teks/gambar/audio/video/PDF). */
  "ole:preview": { id: string; fileName: string; kind: "text" | "image" | "audio" | "video" | "pdf"; size: number };
  "ole:error": { action: "insert" | "update" | "resize" | "preview"; message: string; fileName?: string };
}

export interface OfficeCommonEvents {
  /** Dokumen selesai dimuat/diganti. */
  load: { fileName: string; size: number; source: "sample" | "src" | "data" | "file" | "new" | "api" | "drop" };
  "load-error": { message: string; code: string; fileName: string };
  /** Dokumen berubah (label = nama operasi). */
  change: { label: string; modified: boolean };
  /** Dokumen disimpan (diunduh). */
  save: { fileName: string; size: number };
  export: { format: string; fileName: string; size: number };
  zoom: { zoom: number };
  history: { action: "undo" | "redo" };
  locale: { locale: "en" | "id" };
  panel: { panel: string | null };
  readonly: { readonly: boolean };
  error: { scope: string; error: unknown };
  destroy: Record<string, never>;
}

export type FileInput = File | Blob | { name: string; data: Uint8Array | ArrayBuffer };

/** Normalisasi masukan berkas dari aplikasi: File/Blob atau `{ name, data }`. */
export async function readFileInput(input: FileInput, fallbackName = "object.bin"): Promise<{ name: string; bytes: Uint8Array }> {
  if (input && typeof (input as { arrayBuffer?: unknown }).arrayBuffer === "function") {
    const f = input as File;
    return { name: f.name || fallbackName, bytes: new Uint8Array(await f.arrayBuffer()) };
  }
  const o = input as { name: string; data: Uint8Array | ArrayBuffer };
  if (!o || !o.data) throw new Error("Masukan berkas tidak valid: gunakan File/Blob atau { name, data }.");
  return { name: o.name || fallbackName, bytes: o.data instanceof Uint8Array ? o.data : new Uint8Array(o.data) };
}

export type OleInsertOptions = PrepareOptions & { size?: { wPx: number; hPx: number } };

/** Ringkasan `PreparedOle` + lokasi menjadi payload event. */
export const oleEventInfo = (id: string, part: string, p: PreparedOle, location?: string): OleEventInfo => ({
  id, part, progId: p.progId, fileName: p.fileName, size: p.bytes.length, kind: p.kind, ...(location ? { location } : {}),
});
