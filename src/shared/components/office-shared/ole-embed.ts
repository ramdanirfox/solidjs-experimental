/**
 * Menyiapkan objek OLE untuk disisipkan / diperbarui di DOCX, PPTX, dan XLSX.
 *
 * `prepareOle(namaBerkas, bytes)` memutuskan bentuk penyimpanannya, sama seperti Office:
 *  - **office**  : .xlsx/.xlsm/.docx/.docm/.pptx/.pptm → disimpan apa adanya sebagai paket OOXML tertanam (relasi `package`), ProgID mis. `Excel.Sheet.12`.
 *  - **cfb**     : berkas OLE biner (Compound File, mis. .bin/.xls/.doc) → disimpan apa adanya (relasi `oleObject`).
 *  - **package** : berkas lain → dibungkus sebagai objek `Package` (`\x01Ole10Native` di dalam CFB), seperti "Insert → Object → From file".
 * Hasilnya juga memuat gambar pratinjau PNG (ikon + nama berkas) karena OLE selalu ditampilkan lewat gambar.
 */
import { encodePng } from "./png";
import { isCfb, isZip, readCfb } from "./ole-core";

export type OleKind = "office" | "cfb" | "package";

export const OLE_BIN_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.oleObject";
export const REL_OLE_OBJECT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject";
export const REL_PACKAGE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/package";
export const REL_IMAGE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

const OFFICE_TYPES: Record<string, { progId: string; contentType: string; app: "xlsx" | "docx" | "pptx" }> = {
  xlsx: { progId: "Excel.Sheet.12", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", app: "xlsx" },
  xlsm: { progId: "Excel.SheetMacroEnabled.12", contentType: "application/vnd.ms-excel.sheet.macroEnabled.12", app: "xlsx" },
  docx: { progId: "Word.Document.12", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", app: "docx" },
  docm: { progId: "Word.DocumentMacroEnabled.12", contentType: "application/vnd.ms-word.document.macroEnabled.12", app: "docx" },
  pptx: { progId: "PowerPoint.Show.12", contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", app: "pptx" },
  pptm: { progId: "PowerPoint.ShowMacroEnabled.12", contentType: "application/vnd.ms-powerpoint.presentation.macroEnabled.12", app: "pptx" },
};

export interface PreparedOle {
  kind: OleKind;
  /** Isi part embedding. */
  bytes: Uint8Array;
  /** Ekstensi part (tanpa titik): "bin", "xlsx", … */
  ext: string;
  contentType: string;
  progId: string;
  /** Jenis relasi dari dokumen ke part embedding. */
  relType: typeof REL_OLE_OBJECT | typeof REL_PACKAGE;
  fileName: string;
  /** Teks yang tampil di pratinjau. */
  label: string;
  description: string;
  preview: Uint8Array;
  previewWidth: number;
  previewHeight: number;
}

export interface PrepareOptions {
  /** Paksa ProgID tertentu (mis. "Package"). */
  progId?: string;
  /** Pratinjau PNG milik pemanggil; bila kosong dibuat otomatis. */
  preview?: { png: Uint8Array; width: number; height: number };
  label?: string;
  /** Paksa dibungkus sebagai Package walau berkas OOXML/CFB. */
  forcePackage?: boolean;
}

const extOf = (name: string) => (/\.([A-Za-z0-9]+)$/.exec(name)?.[1] ?? "").toLowerCase();
const baseOf = (n: string) => n.replace(/^.*[\\/]/, "");

/** Bungkus berkas apa pun sebagai objek `Package` (CFB berisi `\x01Ole10Native` + `CompObj`). */
export async function buildPackageOle(fileName: string, data: Uint8Array): Promise<Uint8Array> {
  const CFB = await import("cfb");
  const cfb = CFB.utils.cfb_new();
  const name = baseOf(fileName);
  const enc = (s: string) => new TextEncoder().encode(s + "\0");
  const path = `C:\\Temp\\${name}`;
  const label = enc(name), src = enc(path), tmp = enc(path);
  const body = new Uint8Array(4 + 2 + label.length + src.length + 4 + 4 + tmp.length + 4 + data.length);
  const dv = new DataView(body.buffer);
  let o = 0;
  dv.setUint32(o, body.length - 4, true); o += 4;
  dv.setUint16(o, 2, true); o += 2;
  body.set(label, o); o += label.length;
  body.set(src, o); o += src.length;
  dv.setUint32(o, 0, true); o += 4;
  dv.setUint32(o, tmp.length, true); o += 4;
  body.set(tmp, o); o += tmp.length;
  dv.setUint32(o, data.length, true); o += 4;
  body.set(data, o);
  CFB.utils.cfb_add(cfb, "\u0001Ole10Native", body as unknown as number[]);
  const ut = new TextEncoder().encode("OLE Package ");
  const pid = new TextEncoder().encode("Package ");
  const comp = new Uint8Array(28 + 4 + ut.length + 4 + 4 + pid.length);
  const cdv = new DataView(comp.buffer);
  let q = 28;
  cdv.setUint32(q, ut.length, true); q += 4; comp.set(ut, q); q += ut.length;
  cdv.setUint32(q, 0, true); q += 4;
  cdv.setUint32(q, pid.length, true); q += 4; comp.set(pid, q);
  CFB.utils.cfb_add(cfb, "CompObj", comp as unknown as number[]);
  const out = CFB.write(cfb, { type: "array" }) as number[] | Uint8Array;
  return out instanceof Uint8Array ? out : Uint8Array.from(out);
}

const ACCENT: Record<string, [number, number, number]> = { xlsx: [33, 115, 70], docx: [43, 87, 154], pptx: [210, 71, 38], other: [100, 116, 139] };

/** Pratinjau: kanvas bila tersedia (ikon + nama), jika tidak PNG polos (pita warna jenis dokumen). */
export async function renderOlePreview(label: string, ext: string, app?: "xlsx" | "docx" | "pptx"): Promise<{ png: Uint8Array; width: number; height: number }> {
  const W = 96, H = 72;
  const rgb = ACCENT[app ?? "other"];
  const isJsdom = typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent);
  if (typeof document !== "undefined" && !isJsdom) {
    try {
      const S = 2;
      const cv = document.createElement("canvas");
      cv.width = W * S; cv.height = H * S;
      const ctx = cv.getContext("2d");
      if (ctx) {
        ctx.scale(S, S);
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = `rgb(${rgb.join(",")})`; ctx.fillRect(0, 0, W, 6);
        ctx.fillRect(W / 2 - 15, 14, 30, 34);
        ctx.fillStyle = "#ffffff"; ctx.font = "bold 11px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText((ext || "ole").slice(0, 4).toUpperCase(), W / 2, 31);
        ctx.fillStyle = "#334155"; ctx.font = "10px system-ui, sans-serif";
        let t = label;
        while (t.length > 3 && ctx.measureText(t).width > W - 8) t = t.slice(0, -2);
        ctx.fillText(t === label ? t : t + "…", W / 2, 60);
        const blob: Blob | null = await new Promise(r => cv.toBlob(r, "image/png"));
        if (blob) return { png: new Uint8Array(await blob.arrayBuffer()), width: W, height: H };
      }
    } catch { /* jatuh ke PNG polos */ }
  }
  const png = encodePng(W, H, (x, y) => {
    if (y < 6) return rgb;
    if (x > W / 2 - 15 && x < W / 2 + 15 && y > 14 && y < 48) return rgb;
    if (y > 56 && y < 62 && x > 12 && x < W - 12) return [148, 163, 184];
    return [255, 255, 255];
  });
  return { png, width: W, height: H };
}

export async function prepareOle(fileName: string, data: Uint8Array, opts: PrepareOptions = {}): Promise<PreparedOle> {
  if (!data || data.length === 0) throw new Error("Berkas kosong — tidak ada yang dapat disisipkan sebagai objek OLE.");
  const name = baseOf(fileName) || "object.bin";
  const ext = extOf(name);
  const office = OFFICE_TYPES[ext];
  let kind: OleKind, bytes = data, outExt: string, contentType: string, progId: string, relType: PreparedOle["relType"], description: string;
  if (office && isZip(data) && !opts.forcePackage) {
    kind = "office"; outExt = ext; contentType = office.contentType; progId = opts.progId ?? office.progId; relType = REL_PACKAGE;
    description = `Dokumen Office tertanam (${office.progId})`;
  } else if (isCfb(data) && !opts.forcePackage) {
    kind = "cfb"; outExt = "bin"; contentType = OLE_BIN_CONTENT_TYPE; relType = REL_OLE_OBJECT;
    let pid: string | undefined;
    try { pid = readCfb(data).progId; } catch { /* abaikan */ }
    progId = opts.progId ?? pid ?? "Package";
    description = `Objek OLE biner${pid ? ` (${pid})` : ""}`;
  } else {
    kind = "package"; outExt = "bin"; contentType = OLE_BIN_CONTENT_TYPE; relType = REL_OLE_OBJECT; progId = opts.progId ?? "Package";
    bytes = await buildPackageOle(name, data);
    description = `Berkas "${name}" dibungkus sebagai objek Package`;
  }
  const label = opts.label ?? name;
  const prev = opts.preview ?? (await renderOlePreview(label, ext, office?.app));
  return { kind, bytes, ext: outExt, contentType, progId, relType, fileName: name, label, description, preview: prev.png, previewWidth: prev.width, previewHeight: prev.height };
}

/** Ekstensi yang dikenali sebagai dokumen Office tertanam. */
export const isOfficeOleExt = (name: string) => !!OFFICE_TYPES[extOf(name)];
