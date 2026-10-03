/** Encoder PNG tanpa dependensi (deflate "stored") untuk gambar contoh. */

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const u32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

export function encodePng(w: number, h: number, rgb: (x: number, y: number) => [number, number, number]): Uint8Array {
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const [r, g, b] = rgb(x, y); const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  // zlib stored blocks
  const blocks: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  for (let i = 0; i < raw.length; i += 65535) {
    const chunk = raw.subarray(i, Math.min(raw.length, i + 65535));
    const last = i + 65535 >= raw.length ? 1 : 0;
    blocks.push(new Uint8Array([last, chunk.length & 255, chunk.length >> 8, ~chunk.length & 255, (~chunk.length >> 8) & 255]), chunk);
  }
  let a = 1, b2 = 0;
  for (let i = 0; i < raw.length; i++) { a = (a + raw[i]) % 65521; b2 = (b2 + a) % 65521; }
  blocks.push(u32(((b2 << 16) | a) >>> 0));
  const data = concat(blocks);
  const chunk = (type: string, d: Uint8Array) => {
    const t = new TextEncoder().encode(type);
    const body = concat([t, d]);
    return concat([u32(d.length), body, u32(crc32(body))]);
  };
  const ihdr = concat([u32(w), u32(h), new Uint8Array([8, 2, 0, 0, 0])]);
  return concat([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", data), chunk("IEND", new Uint8Array())]);
}
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Gambar gradasi dengan bidang geometri sederhana sebagai logo contoh. */
export function samplePng(w = 320, h = 160): Uint8Array {
  return encodePng(w, h, (x, y) => {
    const t = x / w, s = y / h;
    let r = Math.round(30 + 60 * t), g = Math.round(90 + 110 * s), b = Math.round(200 - 60 * t);
    const cx = w * 0.28, cy = h * 0.5, d = Math.hypot(x - cx, y - cy);
    if (d < h * 0.32) { r = 255; g = 255; b = 255; }
    if (d < h * 0.2) { r = 245; g = 158; b = 11; }
    if (x > w * 0.5 && x < w * 0.92 && Math.abs(y - h * 0.5) < 5) { r = 255; g = 255; b = 255; }
    if (x > w * 0.5 && x < w * 0.8 && Math.abs(y - h * 0.34) < 5) { r = 255; g = 255; b = 255; }
    if (x > w * 0.5 && x < w * 0.7 && Math.abs(y - h * 0.66) < 5) { r = 255; g = 255; b = 255; }
    return [r, g, b];
  });
}

