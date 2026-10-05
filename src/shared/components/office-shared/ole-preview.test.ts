import { describe, expect, it } from "vitest";
import { canPreviewOle, oleSource, prepareOlePreview } from "./ole-preview";

const enc = (s: string) => new TextEncoder().encode(s);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("pratinjau objek OLE", () => {
  it("teks: dikenali dari ekstensi maupun isi, didekode, dipotong bila besar", () => {
    const d = prepareOlePreview(enc("halo dunia\nbaris 2"), "catatan.txt")!;
    expect(d.kind).toBe("text");
    expect(d.text).toBe("halo dunia\nbaris 2");
    expect(prepareOlePreview(enc("tanpa ekstensi"), "oleObject1.bin")!.kind).toBe("text");
    const big = prepareOlePreview(new Uint8Array(600 * 1024).fill(65), "x.log")!;
    expect(big.truncated).toBe(true);
    expect(big.text!.length).toBe(512 * 1024);
  });
  it("HTML/SVG-skrip tidak dieksekusi: HTML hanya sebagai teks", () => {
    const d = prepareOlePreview(enc("<script>alert(1)</script>"), "a.html")!;
    expect(d.kind).toBe("text");
    expect(d.mime).toBe("text/plain");
  });
  it("media: magic bytes menimpa ekstensi", () => {
    expect(prepareOlePreview(PNG, "salah.dat")).toMatchObject({ kind: "image", mime: "image/png" });
    expect(prepareOlePreview(enc("%PDF-1.7 ..."), "a.bin")).toMatchObject({ kind: "pdf" });
    expect(prepareOlePreview(new Uint8Array(20).fill(1), "klip.mp3")).toMatchObject({ kind: "audio" });
    expect(prepareOlePreview(new Uint8Array(20).fill(1), "klip.mp4")).toMatchObject({ kind: "video" });
  });
  it("biner/zip tidak dapat dipratinjau", () => {
    const bin = new Uint8Array(100); bin[10] = 0; bin.fill(1, 20);
    expect(canPreviewOle(bin, "x.exe")).toBe(false);
    expect(canPreviewOle(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), "x.xlsx")).toBe(false);
    expect(oleSource(new Uint8Array([0x50, 0x4b, 3, 4]), "x.docx")).toBeUndefined();
    expect(canPreviewOle(undefined, "x")).toBe(false);
  });
});
