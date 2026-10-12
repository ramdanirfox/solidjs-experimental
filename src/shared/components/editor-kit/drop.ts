/**
 * Seret-dan-jatuhkan (drop) eksternal bersama untuk semua editor.
 *
 * Satu jalur: klasifikasi isi drop → saring (readonly / jenis diterima / ukuran) → `before` yang dapat membatalkan → handler per jenis milik editor
 * → laporan `{ handled, rejected, cancelled }` (event `drop`). Jalur yang sama dipakai oleh drop DOM dan oleh API/bus (`drop.handle`), sehingga
 * perilaku dapat diuji tanpa DragEvent.
 *
 * Jenis (`DropKind`): `image` (berkas gambar), `office` (berkas format editor ini → dibuka/diimpor), `file` (berkas lain; opt-in, mis. objek OLE),
 * `text` (teks polos), `url` (tautan http/https/mailto). Drag internal editor (palet, miniatur) diabaikan lewat `ignore`.
 */

export type DropKind = "image" | "office" | "file" | "text" | "url";
export const DROP_KINDS: readonly DropKind[] = ["image", "office", "file", "text", "url"];
/** Default: `file` (berkas sembarang) harus diminta secara eksplisit. */
export const DEFAULT_DROP_ACCEPT: readonly DropKind[] = ["image", "office", "text", "url"];
export const DEFAULT_DROP_MAX_SIZE = 25 * 1024 * 1024;

export interface DropItem {
  kind: DropKind;
  name: string;
  type: string;
  size: number;
  file?: File;
  /** Isi untuk `text` / `url`. */
  text?: string;
}

export interface DropInfo {
  items: DropItem[];
  /** Koordinat klien tempat jatuh (default 0,0 untuk API). */
  x: number;
  y: number;
  source: "dom" | "api";
}

export type DropRejectReason = "readonly" | "not-accepted" | "too-large" | "unsupported" | "cancelled" | "error";
export interface DropRejection { item: DropItem; reason: DropRejectReason; error?: string }
export interface DropReport { handled: DropItem[]; rejected: DropRejection[]; cancelled: boolean }

export interface OfficeDropEvents {
  drop: { info: DropInfo; report: DropReport };
}

export interface DropConfig {
  /** Jenis yang diterima (default `DEFAULT_DROP_ACCEPT`). */
  accept?: DropKind[];
  /** Ukuran berkas maksimum (byte). */
  maxSize?: number;
  /** Dipanggil sebelum diproses dengan item yang lolos saringan; kembalikan `false` untuk membatalkan seluruh drop. */
  before?: (info: DropInfo) => boolean | void | Promise<boolean | void>;
}

export type DropHandler = (item: DropItem, info: DropInfo) => boolean | void | Promise<boolean | void>;

export interface DropControllerOptions extends DropConfig {
  handlers: Partial<Record<DropKind, DropHandler>>;
  /** Ekstensi berkas format editor ini (jenis `office`). */
  officeExt?: RegExp;
  readonly?: () => boolean;
  /** `true` bila drag eksternal sedang berada di atas editor (untuk lapisan petunjuk). */
  onState?: (active: boolean) => void;
  /** Dipanggil setelah tiap drop selesai. */
  onReport?: (info: DropInfo, report: DropReport) => void;
  /** Kembalikan `true` untuk drag internal yang tidak boleh disentuh kontroler. */
  ignore?: (dt: DataTransfer) => boolean;
}

const URL_RE = /^(https?:\/\/|mailto:)\S+$/i;

function fileItem(f: File, officeExt?: RegExp): DropItem {
  const kind: DropKind = officeExt?.test(f.name) ? "office" : f.type.startsWith("image/") ? "image" : "file";
  return { kind, name: f.name, type: f.type, size: f.size, file: f };
}
function textItem(text: string): DropItem | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const first = t.split(/\r?\n/).find(l => l.trim() && !l.startsWith("#"))?.trim() ?? "";
  if (URL_RE.test(first) && t.split(/\r?\n/).filter(l => l.trim() && !l.startsWith("#")).length === 1) return { kind: "url", name: first, type: "text/uri-list", size: first.length, text: first };
  return { kind: "text", name: "", type: "text/plain", size: text.length, text };
}

/** Item dari `DataTransfer` (berkas didahulukan; teks hanya bila tak ada berkas). */
export function classifyDataTransfer(dt: DataTransfer, officeExt?: RegExp): DropItem[] {
  const files = [...(dt.files ?? [])];
  if (files.length) return files.map(f => fileItem(f, officeExt));
  const uri = dt.getData("text/uri-list");
  const plain = dt.getData("text/plain");
  const it = textItem(uri || plain);
  return it ? [it] : [];
}

/** Item dari masukan terprogram (API/bus). */
export function itemsFromInput(input: { files?: File[]; text?: string; url?: string }, officeExt?: RegExp): DropItem[] {
  const out: DropItem[] = (input.files ?? []).map(f => fileItem(f, officeExt));
  if (input.url) out.push({ kind: "url", name: input.url, type: "text/uri-list", size: input.url.length, text: input.url });
  if (input.text) { const t = textItem(input.text); if (t) out.push(t); }
  return out;
}

/** Drag eksternal (berkas / teks / tautan), bukan drag internal editor. */
export function isExternalDrag(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false;
  const t = [...(dt.types ?? [])];
  return t.includes("Files") || t.includes("text/uri-list") || t.includes("text/plain") || t.includes("text/html");
}

export interface DropController {
  /** Jalankan jalur drop untuk `input` (API/bus) pada koordinat klien `(x, y)`. */
  handle(input: { files?: File[]; text?: string; url?: string; x?: number; y?: number } | DropItem[], pos?: { x: number; y: number }): Promise<DropReport>;
  accept(): DropKind[];
  setAccept(list: DropKind[]): boolean;
  destroy(): void;
}

export function createDropController(el: HTMLElement, opts: DropControllerOptions): DropController {
  let accept: DropKind[] = (opts.accept ?? [...DEFAULT_DROP_ACCEPT]).filter(k => DROP_KINDS.includes(k));
  const maxSize = opts.maxSize ?? DEFAULT_DROP_MAX_SIZE;
  let depth = 0;
  const setActive = (v: boolean) => { opts.onState?.(v); };

  async function run(info: DropInfo): Promise<DropReport> {
    const report: DropReport = { handled: [], rejected: [], cancelled: false };
    const reject = (item: DropItem, reason: DropRejectReason, error?: string) => report.rejected.push({ item, reason, ...(error ? { error } : {}) });
    const ok: DropItem[] = [];
    for (const item of info.items) {
      if (opts.readonly?.()) reject(item, "readonly");
      else if (!accept.includes(item.kind)) reject(item, "not-accepted");
      else if (item.file && item.size > maxSize) reject(item, "too-large");
      else ok.push(item);
    }
    if (ok.length && opts.before) {
      let go: boolean | void = true;
      try { go = await opts.before({ ...info, items: ok }); } catch { go = false; }
      if (go === false) { report.cancelled = true; for (const i of ok) reject(i, "cancelled"); ok.length = 0; }
    }
    for (const item of ok) {
      const h = opts.handlers[item.kind];
      if (!h) { reject(item, "unsupported"); continue; }
      try {
        const r = await h(item, info);
        if (r === false) reject(item, "unsupported"); else report.handled.push(item);
      } catch (e) { reject(item, "error", e instanceof Error ? e.message : String(e)); }
    }
    opts.onReport?.(info, report);
    return report;
  }

  const onEnter = (e: DragEvent) => {
    if (!isExternalDrag(e.dataTransfer) || opts.ignore?.(e.dataTransfer!)) return;
    e.preventDefault();
    depth++;
    setActive(true);
  };
  const onOver = (e: DragEvent) => {
    if (!isExternalDrag(e.dataTransfer) || opts.ignore?.(e.dataTransfer!)) return;
    e.preventDefault(); // tanpa ini browser membuka berkas yang dijatuhkan
    e.dataTransfer!.dropEffect = opts.readonly?.() ? "none" : "copy";
  };
  const onLeave = (e: DragEvent) => {
    if (!isExternalDrag(e.dataTransfer) || opts.ignore?.(e.dataTransfer!)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) setActive(false);
  };
  const onDropEv = (e: DragEvent) => {
    const dt = e.dataTransfer;
    if (!isExternalDrag(dt) || opts.ignore?.(dt!)) return;
    e.preventDefault();
    e.stopPropagation();
    depth = 0;
    setActive(false);
    const items = classifyDataTransfer(dt!, opts.officeExt);
    if (!items.length) return;
    void run({ items, x: e.clientX, y: e.clientY, source: "dom" });
  };
  el.addEventListener("dragenter", onEnter);
  el.addEventListener("dragover", onOver);
  el.addEventListener("dragleave", onLeave);
  el.addEventListener("drop", onDropEv);

  return {
    handle(input, pos) {
      if (Array.isArray(input)) return run({ items: input, x: pos?.x ?? 0, y: pos?.y ?? 0, source: "api" });
      return run({ items: itemsFromInput(input, opts.officeExt), x: input.x ?? pos?.x ?? 0, y: input.y ?? pos?.y ?? 0, source: "api" });
    },
    accept: () => [...accept],
    setAccept(list) { if (!Array.isArray(list) || !list.every(k => DROP_KINDS.includes(k))) return false; accept = [...list]; return true; },
    destroy() {
      el.removeEventListener("dragenter", onEnter); el.removeEventListener("dragover", onOver);
      el.removeEventListener("dragleave", onLeave); el.removeEventListener("drop", onDropEv);
    },
  };
}
