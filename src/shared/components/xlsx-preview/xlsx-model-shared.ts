/** Tipe, konstanta, dan util kecil bersama untuk xlsx-model.ts dan modul pecahannya. */
import type { XmlNode } from "@office-kit/xlsx/xml";

/** Salin node anchor mentah lalu tulis posisi/ukuran baru (from/to/ext/pos) ke dalamnya. */
export function patchRawAnchor(raw: XmlNode, a: any): XmlNode {
  const n: XmlNode = structuredClone(raw);
  const kid = (parent: XmlNode, name: string) => parent.children.find(c => c.name.replace(/^\{[^}]*\}/, "") === name);
  const setPoint = (el: XmlNode | undefined, v: any) => {
    if (!el || !v) return;
    for (const [k, val] of [["col", v.col], ["colOff", v.colOff], ["row", v.row], ["rowOff", v.rowOff]] as const) { const c = kid(el, k); if (c) c.text = String(Math.round(val)); }
  };
  setPoint(kid(n, "from"), a.from);
  setPoint(kid(n, "to"), a.to);
  const ext = kid(n, "ext"); if (ext && a.ext) { ext.attrs.cx = String(Math.round(a.ext.cx)); ext.attrs.cy = String(Math.round(a.ext.cy)); }
  const pos = kid(n, "pos"); if (pos && a.pos) { pos.attrs.x = String(Math.round(a.pos.x)); pos.attrs.y = String(Math.round(a.pos.y)); }
  return n;
}

export function collectText(n: any, out: string[] = []): string[] {
  if (!n) return out;
  if (typeof n.name === "string" && n.name.replace(/^\{[^}]*\}/, "") === "t" && n.text) out.push(n.text);
  for (const c of n.children ?? []) collectText(c, out);
  return out;
}

export const IMG_MIME: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", svg: "image/svg+xml" };
