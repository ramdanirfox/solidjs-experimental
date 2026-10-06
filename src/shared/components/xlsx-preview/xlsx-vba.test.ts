// @vitest-environment node
import { describe, it, expect } from "vitest";
import * as CFB from "cfb";
import { decompressVba, parseVbaProject } from "./xlsx-vba";

/** Kompresor MS-OVBA minimal: hanya literal (valid menurut spesifikasi). */
function compressLiteral(data: Uint8Array): Uint8Array {
  const out: number[] = [1];
  for (let p = 0; p < data.length; p += 3600) {
    const chunk = data.subarray(p, p + 3600);
    const body: number[] = [];
    for (let i = 0; i < chunk.length; i += 8) { body.push(0); for (const b of chunk.subarray(i, i + 8)) body.push(b); }
    const header = 0xb000 | (body.length + 2 - 3);
    out.push(header & 255, header >> 8, ...body);
  }
  return Uint8Array.from(out);
}

const u16 = (n: number) => [n & 255, n >> 8];
const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const rec = (id: number, data: number[]) => [...u16(id), ...u32(data.length), ...data];
const str = (s: string) => Array.from(new TextEncoder().encode(s));

function buildProject(modules: { name: string; code: string; type?: number }[]): Uint8Array {
  const dir: number[] = [
    ...rec(0x0003, u16(1252)), ...rec(0x0004, str("VBAProject")),
    ...rec(0x0009, [...u32(0)]), ...u16(5), // PROJECTVERSION: 4 byte reserved + 2 byte minor di luar size
    ...rec(0x0016, str("stdole")), ...rec(0x003e, str("stdole")),
    ...rec(0x000f, u16(modules.length)),
  ];
  const streams: Record<string, Uint8Array> = {};
  for (const m of modules) {
    const header = "Attribute VB_Name = \"" + m.name + "\"\r\n";
    const src = Uint8Array.from(str(header + m.code));
    const performance = Uint8Array.from(Array(10).fill(7)); // PerformanceCache dilewati lewat MODULEOFFSET
    const comp = compressLiteral(src);
    streams[m.name] = Uint8Array.from([...performance, ...comp]);
    dir.push(...rec(0x0019, str(m.name)), ...rec(0x001a, str(m.name)), ...rec(0x0032, str(m.name)), ...rec(0x0031, u32(performance.length)), ...rec(m.type ?? 0x21, []), ...rec(0x002b, []));
  }
  dir.push(...rec(0x0010, []));
  const cfb = CFB.utils.cfb_new();
  CFB.utils.cfb_add(cfb, "/VBA/dir", compressLiteral(Uint8Array.from(dir)));
  CFB.utils.cfb_add(cfb, "/PROJECT", Uint8Array.from(str("ID=\"{X}\"\r\nDocument=ThisWorkbook/&H00000000\r\nModule=Module1\r\n")));
  for (const [n, d] of Object.entries(streams)) CFB.utils.cfb_add(cfb, `/VBA/${n}`, d);
  return Uint8Array.from(CFB.write(cfb, { type: "array" }) as number[]);
}

describe("dekompresi MS-OVBA", () => {
  it("token salin (offset 1, panjang 7)", () => {
    expect(new TextDecoder().decode(decompressVba(Uint8Array.from([0x01, 0x03, 0xb0, 0x02, 0x61, 0x04, 0x00])))).toBe("aaaaaaaa");
  });
  it("roundtrip literal & signature salah", () => {
    const src = Uint8Array.from(Array.from({ length: 9000 }, (_, i) => 65 + (i % 26)));
    expect(decompressVba(compressLiteral(src))).toEqual(src);
    expect(() => decompressVba(Uint8Array.from([2, 0, 0]))).toThrow();
  });
});

describe("parseVbaProject", () => {
  it("membaca modul, jenis, prosedur, dan memindai kata kunci", () => {
    const bin = buildProject([
      { name: "ThisWorkbook", code: "Private Sub Workbook_Open()\r\n  MsgBox \"hi\"\r\nEnd Sub\r\n", type: 0x22 },
      { name: "Module1", code: "Public Function Tambah(a, b)\r\n  Tambah = a + b\r\nEnd Function\r\nSub Run()\r\n  ' Shell(\"x\")\r\n  Shell(\"calc.exe\")\r\nEnd Sub\r\n" },
    ]);
    const p = parseVbaProject(bin);
    expect(p.name).toBe("VBAProject");
    expect(p.references).toContain("stdole");
    expect(p.modules.map(m => [m.name, m.kind])).toEqual([["ThisWorkbook", "document"], ["Module1", "standard"]]);
    const m1 = p.modules[1]!;
    expect(m1.attributes[0]).toContain("VB_Name");
    expect(m1.code).toContain("Tambah = a + b");
    expect(m1.procedures.map(x => x.name)).toEqual(["Tambah", "Run"]);
    const kw = p.findings.map(f => `${f.module}:${f.line}:${f.level}`);
    expect(kw).toContain("ThisWorkbook:1:warn"); // Workbook_Open
    expect(p.findings.filter(f => f.module === "Module1" && /Shell/i.test(f.keyword)).length).toBe(1); // komentar diabaikan
  });
  it("bukan CFB → error", () => {
    expect(() => parseVbaProject(Uint8Array.from([1, 2, 3, 4]))).toThrow();
  });
});
