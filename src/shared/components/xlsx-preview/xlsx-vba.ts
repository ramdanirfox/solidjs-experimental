/**
 * Pembaca read-only vbaProject.bin (MS-OVBA): CFB → stream VBA/dir → modul → kode sumber.
 * Tidak mengeksekusi apa pun. Menyertakan pemindai kata kunci mencurigakan ala olevba.
 */
import * as CFB from "cfb";

export type VbaModuleKind = "standard" | "class" | "document" | "form";

export interface VbaModule {
  name: string;
  kind: VbaModuleKind;
  /** Kode tanpa baris "Attribute ..." di awal. */
  code: string;
  /** Baris "Attribute ..." di awal modul. */
  attributes: string[];
  lines: number;
  procedures: { name: string; type: "Sub" | "Function" | "Property"; line: number }[];
}

export interface VbaFinding { level: "warn" | "info"; keyword: string; description: string; module: string; line: number }

export interface VbaProject {
  name: string;
  codepage: number;
  modules: VbaModule[];
  references: string[];
  findings: VbaFinding[];
  /** Pesan bila sebagian gagal dibaca (modul tetap ditampilkan seperlunya). */
  errors: string[];
}

/** Dekompresi MS-OVBA 2.4.1. */
export function decompressVba(data: Uint8Array, start = 0): Uint8Array {
  if (data[start] !== 1) throw new Error("Signature kompresi VBA tidak valid");
  const out: number[] = [];
  let p = start + 1;
  while (p + 1 < data.length) {
    const header = data[p]! | (data[p + 1]! << 8);
    const size = (header & 0x0fff) + 3;
    const compressed = (header & 0x8000) !== 0;
    const end = Math.min(p + size, data.length);
    p += 2;
    const chunkStart = out.length;
    if (!compressed) {
      for (let i = 0; i < 4096 && p < end; i++) out.push(data[p++]!);
      continue;
    }
    while (p < end) {
      const flags = data[p++]!;
      for (let bit = 0; bit < 8 && p < end; bit++) {
        if (!(flags & (1 << bit))) { out.push(data[p++]!); continue; }
        if (p + 1 >= data.length) { p = end; break; }
        const token = data[p]! | (data[p + 1]! << 8);
        p += 2;
        const diff = out.length - chunkStart;
        let bits = 4;
        while ((1 << bits) < diff) bits++;
        const lengthMask = 0xffff >> bits;
        const length = (token & lengthMask) + 3;
        const offset = (token >> (16 - bits)) + 1;
        if (offset > out.length) throw new Error("Token salin VBA di luar jangkauan");
        for (let i = 0; i < length; i++) out.push(out[out.length - offset]!);
      }
    }
  }
  return Uint8Array.from(out);
}

function decoderFor(codepage: number): TextDecoder {
  for (const label of [codepage === 65001 ? "utf-8" : codepage === 1200 ? "utf-16le" : `windows-${codepage}`, `cp${codepage}`, "windows-1252"]) {
    try { return new TextDecoder(label); } catch { /* coba berikutnya */ }
  }
  return new TextDecoder();
}

interface RawModule { name: string; stream: string; offset: number; type: number }

function parseDir(dir: Uint8Array) {
  const dv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  let p = 0, codepage = 1252, projectName = "";
  const refs: string[] = [];
  const mods: RawModule[] = [];
  let cur: RawModule | null = null;
  const raw = (a: number, n: number) => dir.subarray(a, a + n);
  while (p + 6 <= dir.length) {
    const id = dv.getUint16(p, true);
    const size = dv.getUint32(p + 2, true);
    p += 6;
    if (p + size > dir.length) break;
    const data = raw(p, size);
    const text = () => decoderFor(codepage).decode(data);
    switch (id) {
      case 0x0003: codepage = dv.getUint16(p, true); break;
      case 0x0004: projectName = text(); break;
      case 0x0016: refs.push(text()); break;
      case 0x0019: cur = { name: text(), stream: "", offset: 0, type: 0x21 }; mods.push(cur); break;
      case 0x001a: if (cur) cur.stream = text(); break;
      case 0x0031: if (cur) cur.offset = dv.getUint32(p, true); break;
      case 0x0021: case 0x0022: if (cur) cur.type = id; break;
      default: break;
    }
    p += size;
    if (id === 0x0009) p += 2; // PROJECTVERSION: field minor 2 byte di luar size
  }
  return { codepage, projectName, refs, mods };
}

const KEYWORDS: [RegExp, string, "warn" | "info"][] = [
  [/\b(Auto_?Open|Auto_?Close|Auto_?Exec|Workbook_Open|Document_Open|Workbook_BeforeClose)\b/i, "Dijalankan otomatis saat berkas dibuka/ditutup", "warn"],
  [/\bShell\s*\(|\bShell\s+["\w]|\bWScript\.Shell\b|\bShellExecute/i, "Menjalankan perintah / program eksternal", "warn"],
  [/\bCreateObject\s*\(|\bGetObject\s*\(/i, "Membuat objek COM (mis. FileSystemObject, XMLHTTP)", "warn"],
  [/\bURLDownloadToFile|\bXMLHTTP|\bWinHttp|\bMSXML2|\bInternetOpen/i, "Akses jaringan / unduh berkas", "warn"],
  [/\bpowershell\b|\bcmd(\.exe)?\s*\/c\b|\bmshta\b|\bregsvr32\b/i, "Memanggil PowerShell / cmd / LOLBin", "warn"],
  [/\bKill\s+|\bRmDir\b|\bDeleteFile\b|\.DeleteFile\b/i, "Menghapus berkas", "warn"],
  [/\bOpen\s+.+\s+For\s+(Output|Append|Binary)\b|\bPut\s+#|\bSaveToFile\b/i, "Menulis berkas", "info"],
  [/\bDeclare\s+(PtrSafe\s+)?(Sub|Function)\b/i, "Memanggil API DLL (Declare)", "info"],
  [/\bEnviron\s*\$?\s*\(/i, "Membaca variabel lingkungan", "info"],
  [/\bApplication\.(OnTime|Run|SendKeys)\b|\bSendKeys\b/i, "Penjadwalan / otomasi (OnTime, Run, SendKeys)", "info"],
  [/\bChr\s*\$?\s*\(.*\)\s*&\s*Chr|\bStrReverse\b|\bCallByName\b/i, "Kemungkinan obfuscation string", "info"],
  [/\bVBProject\b|\bVBComponents\b|\bAddFromString\b/i, "Memodifikasi kode VBA lewat kode", "warn"],
];

function procedures(code: string) {
  const out: VbaModule["procedures"] = [];
  const re = /^\s*(?:(?:Public|Private|Friend|Static)\s+)*(Sub|Function|Property\s+(?:Get|Let|Set))\s+([A-Za-z_][\w]*)/i;
  code.split(/\r?\n/).forEach((ln, i) => {
    const m = re.exec(ln);
    if (m) out.push({ name: m[2]!, type: /^property/i.test(m[1]!) ? "Property" : (m[1]!.toLowerCase() === "sub" ? "Sub" : "Function"), line: i + 1 });
  });
  return out;
}

function scan(mod: VbaModule): VbaFinding[] {
  const out: VbaFinding[] = [];
  mod.code.split(/\r?\n/).forEach((ln, i) => {
    const t = ln.trim();
    if (!t || t.startsWith("'") || /^rem\b/i.test(t)) return;
    for (const [re, description, level] of KEYWORDS) {
      const m = re.exec(ln);
      if (m) out.push({ level, keyword: m[0].trim(), description, module: mod.name, line: i + 1 });
    }
  });
  return out;
}

/** Parse vbaProject.bin. Melempar Error hanya bila bukan paket VBA sama sekali. */
export function parseVbaProject(bytes: Uint8Array): VbaProject {
  const magic = [...bytes.subarray(0, 4)].map(b => b.toString(16).padStart(2, "0")).join("");
  if (magic !== "d0cf11e0") throw new Error(`Bukan kontainer OLE/CFB (${bytes.length} byte, awal ${magic || "kosong"}) — kemungkinan stub/placeholder tanpa kode VBA`);
  const cfb = CFB.read(bytes, { type: "array" });
  // Pencarian tidak sensitif huruf besar/kecil & tidak bergantung pada nama root entry.
  const find = (path: string) => {
    const want = path.toLowerCase();
    const i = cfb.FullPaths.findIndex(fp => ("/" + fp.split("/").slice(1).join("/")).toLowerCase() === want);
    return i >= 0 ? (cfb.FileIndex[i]!.content as Uint8Array | undefined) : undefined;
  };
  const dirRaw = find("/VBA/dir");
  if (!dirRaw) {
    const names = cfb.FullPaths.map(fp => fp.split("/").slice(1).join("/")).filter(Boolean);
    throw new Error(`Stream VBA/dir tidak ditemukan. Isi kontainer: ${names.join(", ") || "(kosong)"}`);
  }
  const dir = decompressVba(Uint8Array.from(dirRaw));
  const { codepage, projectName, refs, mods } = parseDir(dir);
  const errors: string[] = [];

  // Stream PROJECT (teks) membedakan Document / Class / Form.
  const kindHint = new Map<string, VbaModuleKind>();
  const proj = find("/PROJECT");
  if (proj) {
    for (const line of decoderFor(codepage).decode(Uint8Array.from(proj)).split(/\r?\n/)) {
      const m = /^(Module|Class|Document|BaseClass)=([^/\r\n]+)/i.exec(line.trim());
      if (!m) continue;
      const k = m[1]!.toLowerCase();
      kindHint.set(m[2]!, k === "module" ? "standard" : k === "class" ? "class" : k === "document" ? "document" : "form");
    }
  }

  const dec = decoderFor(codepage);
  const modules: VbaModule[] = [];
  for (const m of mods) {
    let source = "";
    try {
      const s = find(`/VBA/${m.stream || m.name}`);
      if (!s) throw new Error("stream tidak ditemukan");
      const u8 = Uint8Array.from(s);
      source = u8.length > m.offset ? dec.decode(decompressVba(u8, m.offset)) : "";
    } catch (e) {
      errors.push(`Modul «${m.name}»: ${(e as Error).message}`);
    }
    const all = source.split(/\r?\n/);
    let i = 0;
    while (i < all.length && /^Attribute\s/i.test(all[i]!)) i++;
    const kind = kindHint.get(m.name) ?? (m.type === 0x21 ? "standard" : "class");
    const mod: VbaModule = { name: m.name, kind, code: all.slice(i).join("\n"), attributes: all.slice(0, i), lines: Math.max(0, all.length - i), procedures: [], };
    mod.procedures = procedures(mod.code);
    modules.push(mod);
  }
  return { name: projectName, codepage, modules, references: refs, findings: modules.flatMap(scan), errors };
}
