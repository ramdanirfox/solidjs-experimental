// @vitest-environment node
import { describe, it, expect } from "vitest";
import { describeProgId, hexDump, ovbaDecompress, parseOle10Native } from "./docx-ole";

describe("docx-ole", () => {
  it("dekompresi MS-OVBA: literal + token salin (vektor rakitan)", () => {
    const dec = (hex: string) => new TextDecoder().decode(ovbaDecompress(Uint8Array.from(hex.split(" ").map(h => parseInt(h, 16)))));
    // 'a' lalu salin offset=1 panjang=9
    expect(dec("01 03 b0 02 61 06 00")).toBe("aaaaaaaaaa");
    // "abcdefgh" lalu salin offset=8 panjang=8
    expect(dec("01 0b b0 00 61 62 63 64 65 66 67 68 01 05 70")).toBe("abcdefghabcdefgh");
    // chunk tidak terkompresi (flag 0 pada header) tidak boleh merusak
    expect(ovbaDecompress(Uint8Array.from([1, 0x00, 0x30, 0x41, 0x42])).length).toBeGreaterThan(0);
  });

  it("dekompresi menolak sinyal yang salah", () => { expect(ovbaDecompress(Uint8Array.from([0, 1, 2]))).toHaveLength(0); });

  it("Ole10Native: label, path, data", () => {
    const enc = (s: string) => new TextEncoder().encode(s + "\0");
    const label = enc("a.txt"), src = enc("C:/x/a.txt"), tmp = enc("C:/t/a.txt"), data = new TextEncoder().encode("halo");
    const b = new Uint8Array(4 + 2 + label.length + src.length + 4 + 4 + tmp.length + 4 + data.length);
    const dv = new DataView(b.buffer);
    let o = 0;
    dv.setUint32(o, b.length - 4, true); o += 4; dv.setUint16(o, 2, true); o += 2;
    b.set(label, o); o += label.length; b.set(src, o); o += src.length;
    dv.setUint32(o, 0, true); o += 4; dv.setUint32(o, tmp.length, true); o += 4; b.set(tmp, o); o += tmp.length;
    dv.setUint32(o, data.length, true); o += 4; b.set(data, o);
    const n = parseOle10Native(b)!;
    expect(n.fileName).toBe("a.txt");
    expect(n.srcPath).toBe("C:/x/a.txt");
    expect(new TextDecoder().decode(n.data)).toBe("halo");
    expect(parseOle10Native(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });

  it("deskripsi ProgID & hexdump", () => {
    expect(describeProgId("Excel.Sheet.12")).toMatch(/Excel/);
    expect(describeProgId(undefined, "0003000C-0000-0000-C000-000000000046")).toMatch(/Package/);
    expect(hexDump(Uint8Array.from([65, 66, 0, 255]))).toContain("41 42 00 ff");
  });
});
