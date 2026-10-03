/**
 * Inti OLE/CFB (dipakai editor DOCX & PPTX): Objek OLE: daftar objek tertanam (/word/embeddings), isi Compound File Binary (paket `cfb`),
 * ekstraksi payload `\x01Ole10Native`, dan pembacaan proyek VBA (hanya daftar & kode sumber — tidak dieksekusi).
 */
import * as CFB from "cfb";

export interface CfbEntry { path: string; name: string; type: "storage" | "stream" | "root"; size: number; clsid?: string }
export interface CfbInfo {
  entries: CfbEntry[];
  streams: string[];
  storages: string[];
  rootClsid?: string;
  /** Deskripsi jenis dokumen yang dikenali. */
  kind?: string;
  userType?: string;
  progId?: string;
  native?: Ole10Native;
}
export interface Ole10Native { label: string; fileName: string; srcPath: string; tempPath: string; size: number; data: Uint8Array }

export interface OleObject {
  index: number;
  part: string;
  relId?: string;
  progId?: string;
  relType: "oleObject" | "package" | "other";
  linked: boolean;
  aspect?: string;
  size: number;
  format: "cfb" | "zip" | "other" | "missing";
  /** Lokasi: paragraf ke-N di body (1-based), 0 bila tidak ditemukan. */
  paragraph: number;
  snippet: string;
  /** Deskripsi ramah dari ProgID/CLSID. */
  description: string;
  fileName: string;
}

const CLSIDS: Record<string, string> = {
  "00020906-0000-0000-C000-000000000046": "Microsoft Word 97–2003 Document",
  "00020900-0000-0000-C000-000000000046": "Microsoft Word 6.0 Document",
  "00020820-0000-0000-C000-000000000046": "Microsoft Excel 97–2003 Worksheet",
  "00020810-0000-0000-C000-000000000046": "Microsoft Excel Worksheet",
  "00020821-0000-0000-C000-000000000046": "Microsoft Excel Chart",
  "64818D10-4F9B-11CF-86EA-00AA00B929E8": "Microsoft PowerPoint Presentation",
  "0003000C-0000-0000-C000-000000000046": "OLE Package",
  "0002CE02-0000-0000-C000-000000000046": "Microsoft Equation 3.0",
  "D5CDD502-2E9C-101B-9397-08002B2CF9AE": "Microsoft Office Binder / OLE Compound",
  "00021290-0000-0000-C000-000000000046": "Microsoft Office Visio Drawing",
  "0003000A-0000-0000-C000-000000000046": "Paintbrush Picture",
  "B801CA65-A1FC-11D0-85AD-444553540000": "Adobe Acrobat Document",
};
const PROGIDS: [RegExp, string][] = [
  [/^Excel\.Sheet\.12$/i, "Microsoft Excel Worksheet (.xlsx)"], [/^Excel\.SheetMacroEnabled\.12$/i, "Microsoft Excel Macro-Enabled Worksheet (.xlsm)"],
  [/^Excel\.Sheet\.8$/i, "Microsoft Excel 97–2003 Worksheet"], [/^Excel\.Chart/i, "Microsoft Excel Chart"],
  [/^Word\.Document\.12$/i, "Microsoft Word Document (.docx)"], [/^Word\.Document\.8$/i, "Microsoft Word 97–2003 Document"], [/^Word\.DocumentMacroEnabled/i, "Microsoft Word Macro-Enabled Document"],
  [/^PowerPoint\.Show\.12$/i, "Microsoft PowerPoint Presentation (.pptx)"], [/^PowerPoint\.Show\.8$/i, "Microsoft PowerPoint 97–2003 Presentation"], [/^PowerPoint\.Slide/i, "Microsoft PowerPoint Slide"],
  [/^Package$/i, "OLE Package (file tertanam)"], [/^AcroExch\.Document/i, "Adobe Acrobat Document"], [/^Equation\.(3|DSMT)/i, "Equation Editor / MathType"],
  [/^Visio\./i, "Microsoft Visio Drawing"], [/^Paint\.Picture$/i, "Bitmap Image (Paint)"], [/^MSGraph\.Chart/i, "Microsoft Graph Chart"], [/^Forms\./i, "ActiveX Form Control"],
  [/^OpenDocument/i, "OpenDocument"], [/^Visio/i, "Microsoft Visio"],
];
export function describeProgId(progId?: string, clsid?: string): string {
  if (progId) for (const [re, d] of PROGIDS) if (re.test(progId)) return d;
  if (clsid) { const d = CLSIDS[clsid.toUpperCase()]; if (d) return d; }
  return progId ?? clsid ?? "OLE";
}

const toU8 = (c: unknown): Uint8Array => (c instanceof Uint8Array ? c : Uint8Array.from(c as ArrayLike<number>));

export function isCfb(b: Uint8Array) { return b.length > 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0; }
export function isZip(b: Uint8Array) { return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b; }

export function cfbSummary(bytes: Uint8Array): { streams: string[]; storages: string[] } {
  const c = CFB.read(bytes, { type: "array" });
  const streams: string[] = [], storages: string[] = [];
  c.FileIndex.forEach((e, i) => { const p = c.FullPaths[i]; if (e.type === 2) streams.push(p); else if (e.type === 1) storages.push(p); });
  return { streams, storages };
}

const cleanName = (n: string) => n.replace(/[\u0000-\u001f]/g, ch => `\\x${ch.charCodeAt(0).toString(16).padStart(2, "0")}`);

function readCString(b: Uint8Array, pos: number): { s: string; next: number } {
  let e = pos;
  while (e < b.length && b[e] !== 0) e++;
  return { s: new TextDecoder("windows-1252").decode(b.subarray(pos, e)), next: e + 1 };
}
export function parseOle10Native(raw: Uint8Array): Ole10Native | undefined {
  try {
    if (raw.length < 8) return undefined;
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    let pos = 4; // total size
    pos += 2; // flags / tipe
    const label = readCString(raw, pos); pos = label.next;
    const srcPath = readCString(raw, pos); pos = srcPath.next;
    pos += 4; // unknown
    const tlen = dv.getUint32(pos, true); pos += 4;
    if (tlen > raw.length) return undefined;
    const tmp = new TextDecoder("windows-1252").decode(raw.subarray(pos, pos + Math.max(0, tlen - 1))); pos += tlen;
    const size = dv.getUint32(pos, true); pos += 4;
    if (size > raw.length - pos) return undefined;
    return { label: label.s, fileName: label.s || srcPath.s.split(/[\/]/).pop() || "object.bin", srcPath: srcPath.s, tempPath: tmp, size, data: raw.subarray(pos, pos + size) };
  } catch { return undefined; }
}

function parseCompObj(raw: Uint8Array): { userType?: string; progId?: string } {
  try {
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    let pos = 28;
    const rd = () => { const n = dv.getUint32(pos, true); pos += 4; if (n === 0 || n > raw.length) return undefined; const s = new TextDecoder("windows-1252").decode(raw.subarray(pos, pos + n - 1)); pos += n; return s; };
    const userType = rd();
    const clip = dv.getUint32(pos, true); pos += 4;
    if (clip === 0xffffffff) pos += 4; else if (clip > 0 && clip < 1000) pos += clip;
    const progId = rd();
    return { userType, progId };
  } catch { return {}; }
}

export function readCfb(bytes: Uint8Array): CfbInfo {
  const c = CFB.read(bytes, { type: "array" });
  const entries: CfbEntry[] = [];
  const streams: string[] = [], storages: string[] = [];
  let rootClsid: string | undefined;
  let compObj: { userType?: string; progId?: string } = {};
  let native: Ole10Native | undefined;
  c.FileIndex.forEach((e, i) => {
    const path = c.FullPaths[i].replace(/\/$/, "") || "/";
    const type = e.type === 5 ? "root" : e.type === 1 ? "storage" : "stream";
    const size = (e as { size?: number }).size ?? (e.content ? (e.content as ArrayLike<number>).length : 0);
    const clsid = e.clsid && /[1-9a-f]/i.test(e.clsid.replace(/-/g, "")) ? e.clsid : undefined;
    entries.push({ path: cleanName(path), name: cleanName(e.name), type, size: type === "stream" ? size : 0, clsid });
    if (type === "root") rootClsid = e.clsid || undefined;
    if (type === "stream") streams.push(path);
    if (type === "storage") storages.push(path);
    if (e.name === "\u0001CompObj" && e.content) compObj = parseCompObj(toU8(e.content));
    if (e.name === "\u0001Ole10Native" && e.content) native = parseOle10Native(toU8(e.content));
  });
  const has = (re: RegExp) => streams.some(s => re.test(s));
  let kind: string | undefined;
  if (has(/\/WordDocument$/)) kind = "Microsoft Word 97–2003 (.doc)";
  else if (has(/\/(Workbook|Book)$/)) kind = "Microsoft Excel 97–2003 (.xls)";
  else if (has(/\/PowerPoint Document$/)) kind = "Microsoft PowerPoint 97–2003 (.ppt)";
  else if (has(/\/EncryptedPackage$/)) kind = "Dokumen OOXML terenkripsi";
  else if (has(/\/VBA\/dir$/i) || storages.some(s => /\/VBA$/i.test(s))) kind = "Proyek VBA (makro)";
  else if (native) kind = "Package (file tertanam)";
  else kind = describeProgId(compObj.progId, rootClsid);
  return { entries, streams, storages, rootClsid, kind, userType: compObj.userType, progId: compObj.progId, native };
}

export function streamBytes(bytes: Uint8Array, path: string): Uint8Array | undefined {
  const c = CFB.read(bytes, { type: "array" });
  const e = CFB.find(c, path);
  return e?.content ? toU8(e.content) : undefined;
}

/** Cuplikan heksadesimal + ASCII dari sebuah stream. */
export function hexDump(b: Uint8Array, max = 256): string {
  const lines: string[] = [];
  const n = Math.min(b.length, max);
  for (let i = 0; i < n; i += 16) {
    const row = b.subarray(i, Math.min(n, i + 16));
    const hex = [...row].map(x => x.toString(16).padStart(2, "0")).join(" ").padEnd(47);
    const asc = [...row].map(x => (x >= 32 && x < 127 ? String.fromCharCode(x) : ".")).join("");
    lines.push(`${i.toString(16).padStart(6, "0")}  ${hex}  ${asc}`);
  }
  if (b.length > n) lines.push(`… +${b.length - n} bytes`);
  return lines.join("\n");
}

// ───────── VBA (MS-OVBA) — hanya baca ─────────

export function ovbaDecompress(buf: Uint8Array, start = 0): Uint8Array {
  if (buf[start] !== 1) return new Uint8Array();
  const out: number[] = [];
  let pos = start + 1;
  while (pos < buf.length) {
    const header = buf[pos] | (buf[pos + 1] << 8);
    const chunkStart = pos;
    pos += 2;
    const size = (header & 0x0fff) + 3;
    const compressed = (header & 0x8000) !== 0;
    const end = Math.min(chunkStart + size, buf.length);
    const outStart = out.length;
    if (!compressed) { for (let i = 0; i < 4096 && pos < buf.length; i++) out.push(buf[pos++]); continue; }
    while (pos < end) {
      const flags = buf[pos++];
      for (let bit = 0; bit < 8 && pos < end; bit++) {
        if (((flags >> bit) & 1) === 0) out.push(buf[pos++]);
        else {
          const token = buf[pos] | (buf[pos + 1] << 8);
          pos += 2;
          const diff = out.length - outStart;
          let bitCount = 4;
          while ((1 << bitCount) < diff) bitCount++;
          const lenMask = 0xffff >> bitCount;
          const length = (token & lenMask) + 3;
          const offset = ((token & ~lenMask & 0xffff) >> (16 - bitCount)) + 1;
          for (let k = 0; k < length; k++) out.push(out[out.length - offset]);
        }
      }
    }
  }
  return Uint8Array.from(out);
}

export interface VbaModule { name: string; streamName: string; type: "standard" | "class" | "document" | "form"; size: number; source?: string }
export interface VbaInfo { modules: VbaModule[]; projectText?: string; streams: string[]; codepage?: number; error?: string }

export function readVba(bytes: Uint8Array): VbaInfo {
  const info: VbaInfo = { modules: [], streams: [] };
  try {
    const c = CFB.read(bytes, { type: "array" });
    const dec = (u: Uint8Array) => new TextDecoder("windows-1252").decode(u);
    c.FileIndex.forEach((e, i) => { if (e.type === 2) info.streams.push(c.FullPaths[i].replace(/^.*?\//, "")); });
    const proj = CFB.find(c, "/PROJECT") ?? CFB.find(c, "PROJECT");
    if (proj?.content) info.projectText = dec(toU8(proj.content));
    const dirEntry = CFB.find(c, "/VBA/dir") ?? CFB.find(c, "VBA/dir");
    if (!dirEntry?.content) { info.error = "VBA/dir tidak ditemukan"; return info; }
    const dir = ovbaDecompress(toU8(dirEntry.content));
    const dv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
    let p = 0;
    let cur: Partial<VbaModule> & { offset?: number } | undefined;
    const mods: (Partial<VbaModule> & { offset?: number })[] = [];
    while (p + 6 <= dir.length) {
      const id = dv.getUint16(p, true);
      let size = dv.getUint32(p + 2, true);
      p += 6;
      if (id === 0x0009) size = 4 + 2; // PROJECTVERSION: field Size bernilai 4 tetapi data 6 byte
      if (p + size > dir.length) break;
      const data = dir.subarray(p, p + size);
      p += size;
      if (id === 0x0003 && size === 2) info.codepage = dv.getUint16(p - size, true);
      if (id === 0x0019) { cur = { name: dec(data) }; mods.push(cur); }
      else if (cur) {
        if (id === 0x001a) cur.streamName = dec(data);
        else if (id === 0x0031) cur.offset = new DataView(data.buffer, data.byteOffset, 4).getUint32(0, true);
        else if (id === 0x0021) cur.type = "standard";
        else if (id === 0x0022) cur.type = "class";
        else if (id === 0x002b) cur = undefined;
      }
    }
    for (const m of mods) {
      const sn = m.streamName ?? m.name ?? "";
      const e = CFB.find(c, `/VBA/${sn}`) ?? CFB.find(c, `VBA/${sn}`);
      const raw = e?.content ? toU8(e.content) : undefined;
      let source: string | undefined;
      if (raw) { try { source = dec(ovbaDecompress(raw, m.offset ?? 0)); } catch { /* abaikan */ } }
      info.modules.push({ name: m.name ?? sn, streamName: sn, type: m.type ?? "standard", size: raw?.length ?? 0, source });
    }
  } catch (e) { info.error = e instanceof Error ? e.message : String(e); }
  return info;
}

