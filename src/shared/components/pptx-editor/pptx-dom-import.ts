/**
 * Impor elemen DOM ke PPTX.
 *
 *  - `mode: "image"`  : elemen dirender ke PNG (SVG `<foreignObject>` + gaya terhitung yang disalin sebaris; gambar/kanvas dijadikan data-URL)
 *                       dan disisipkan sebagai satu gambar. Cocok untuk grafik/kanvas/SVG/CSS kompleks. Font web yang belum dimuat
 *                       dan sumber lintas-origin tanpa CORS tidak ikut (diganti font bawaan / dikosongkan).
 *  - `mode: "shapes"` : struktur DOM diterjemahkan ke bentuk PPTX asli yang dapat diedit — latar/border → persegi, blok teks → kotak teks,
 *                       `<img>` → gambar, `<table>` → tabel. Tata letak mengikuti posisi di layar (bukan CSS flow).
 *  - `mode: "auto"`   : `shapes` bila elemen sederhana, `image` bila memuat canvas/svg/video/iframe/transform/filter/gradien.
 * Fungsi di sini bebas dari model PPTX (hanya DOM → rencana/bytes); penyisipan dilakukan `PptxView.importDom`.
 */

export type DomImportMode = "auto" | "image" | "shapes";

export interface DomImportOptions {
  /** Indeks slide tujuan (0-based). Default: slide aktif. */
  slide?: number;
  mode?: DomImportMode;
  /** Kotak tujuan pada slide (px slide 1280×720). Default: muat ke slide dengan margin 5% dan di tengah. */
  x?: number; y?: number; w?: number; h?: number;
  /** Jaga rasio saat memuat ke kotak tujuan (default true). */
  fit?: boolean;
  name?: string;
  /** Skala piksel untuk mode `image` (default 2). */
  pixelRatio?: number;
  /** Batas jumlah bentuk pada mode `shapes` (default 250); melebihi → jatuh ke `image` bila `mode: "auto"`. */
  maxShapes?: number;
  /** Warna latar mode `image` (default: transparan). */
  background?: string | null;
  /** Kelompokkan bentuk hasil mode `shapes` (default true). */
  group?: boolean;
}

export interface DomImportResult { mode: "image" | "shapes"; added: number; slide: number; selector?: string; ids: number[] }

export type PlanItem =
  | { type: "rect"; x: number; y: number; w: number; h: number; fill: string | null; fillAlpha: number; stroke: string | null; strokeW: number; round: boolean }
  | { type: "text"; x: number; y: number; w: number; h: number; text: string; sizePt: number; bold: boolean; italic: boolean; underline: boolean; color: string; font: string; align: "left" | "center" | "right" | "justify" }
  | { type: "image"; x: number; y: number; w: number; h: number; src: string; svg?: boolean }
  | { type: "table"; x: number; y: number; w: number; h: number; rows: string[][]; sizePt: number };

/** Hasil perencanaan: item dalam koordinat px relatif elemen akar, ukuran akar (px DOM). */
export interface DomPlan { items: PlanItem[]; width: number; height: number; complex: boolean }

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, "0").toUpperCase();
function parseCss(c: string): { hex: string; a: number } | null {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(c);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return { hex: `#${hex2(+m[1])}${hex2(+m[2])}${hex2(+m[3])}`, a };
}

const fontPt = (cs: CSSStyleDeclaration) => (parseFloat(cs.fontSize) || 16) * 0.75;
const INLINE_TAGS = new Set(["SPAN", "A", "B", "I", "EM", "STRONG", "U", "S", "SMALL", "SUB", "SUP", "CODE", "MARK", "LABEL", "FONT", "BR", "ABBR", "CITE", "Q", "KBD", "TIME"]);
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "LINK", "META", "HEAD", "TITLE"]);
const COMPLEX_TAGS = new Set(["CANVAS", "SVG", "VIDEO", "IFRAME", "OBJECT", "EMBED"]);

function isHidden(cs: CSSStyleDeclaration): boolean {
  return cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse" || parseFloat(cs.opacity) === 0;
}
function textAlign(cs: CSSStyleDeclaration): "left" | "center" | "right" | "justify" {
  const a = cs.textAlign;
  return a === "center" ? "center" : a === "right" || a === "end" ? "right" : a === "justify" ? "justify" : "left";
}

/** Apakah seluruh anak elemen bersifat inline (sehingga elemen = satu blok teks). */
function isTextLeaf(el: Element): boolean {
  for (const c of el.children) {
    if (SKIP_TAGS.has(c.tagName)) continue;
    const cs = getComputedStyle(c);
    if (!INLINE_TAGS.has(c.tagName) && !cs.display.startsWith("inline")) return false;
    if (c.tagName !== "BR" && !isTextLeaf(c)) return false;
    if (COMPLEX_TAGS.has(c.tagName.toUpperCase())) return false;
  }
  return true;
}

function visibleText(el: HTMLElement): string {
  const t = (el as HTMLElement).innerText ?? el.textContent ?? "";
  return t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Terjemahkan subtree DOM menjadi daftar item (persegi, teks, gambar, tabel) dalam koordinat relatif `root`. */
export function planDom(root: Element, maxItems = 250): DomPlan {
  const rr = root.getBoundingClientRect();
  const items: PlanItem[] = [];
  let complex = false;
  const rel = (r: DOMRect) => ({ x: r.left - rr.left, y: r.top - rr.top, w: r.width, h: r.height });

  const walk = (el: Element, depth: number) => {
    if (items.length > maxItems || SKIP_TAGS.has(el.tagName)) return;
    const cs = getComputedStyle(el);
    if (isHidden(cs)) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const tag = el.tagName.toUpperCase();
    if (COMPLEX_TAGS.has(tag)) {
      complex = true;
      if (tag === "CANVAS") { try { items.push({ type: "image", ...rel(r), src: (el as HTMLCanvasElement).toDataURL("image/png") }); } catch { /* tainted */ } }
      else if (tag === "SVG") { items.push({ type: "image", ...rel(r), src: svgDataUrl(el as SVGElement, r), svg: true }); }
      return;
    }
    if (cs.transform !== "none" || cs.filter !== "none" || (cs.backgroundImage !== "none" && !/^url\(/.test(cs.backgroundImage))) complex = true;
    if (tag === "IMG") { const src = (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src; if (src) items.push({ type: "image", ...rel(r), src }); return; }
    if (tag === "TABLE") {
      const rows = [...(el as HTMLTableElement).rows].map(tr => [...tr.cells].map(td => visibleText(td as HTMLElement)));
      if (rows.length) items.push({ type: "table", ...rel(r), rows, sizePt: fontPt(cs) });
      return;
    }
    // latar / border → persegi
    const bg = parseCss(cs.backgroundColor);
    const bw = parseFloat(cs.borderTopWidth) || 0;
    const bc = cs.borderTopStyle !== "none" && bw > 0 ? parseCss(cs.borderTopColor) : null;
    if ((bg && bg.a > 0) || bc) {
      items.push({ type: "rect", ...rel(r), fill: bg && bg.a > 0 ? bg.hex : null, fillAlpha: bg ? bg.a : 1, stroke: bc ? bc.hex : null, strokeW: bw, round: (parseFloat(cs.borderTopLeftRadius) || 0) > Math.min(r.width, r.height) / 6 });
    }
    if (cs.backgroundImage.startsWith("url(") && depth > 0) {
      const m = /url\(["']?(.*?)["']?\)/.exec(cs.backgroundImage);
      if (m?.[1]) items.push({ type: "image", ...rel(r), src: m[1] });
    }
    // teks
    if (isTextLeaf(el)) {
      const text = visibleText(el as HTMLElement);
      if (text) {
        const col = parseCss(cs.color);
        const pad = { l: parseFloat(cs.paddingLeft) || 0, t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0 };
        const rc = rel(r);
        items.push({
          type: "text", x: rc.x + pad.l, y: rc.y + pad.t, w: Math.max(4, rc.w - pad.l - pad.r), h: Math.max(4, rc.h - pad.t - pad.b), text, sizePt: fontPt(cs),
          bold: parseInt(cs.fontWeight) >= 600, italic: cs.fontStyle === "italic", underline: /underline/.test(cs.textDecorationLine), color: col?.hex ?? "#000000",
          font: (cs.fontFamily.split(",")[0] ?? "").trim().replace(/^['"]|['"]$/g, ""), align: textAlign(cs),
        });
      }
      return;
    }
    // campuran: simpul teks langsung → satu kotak teks per simpul, anak blok → rekursi
    for (const n of el.childNodes) {
      if (n.nodeType === 3) {
        const t = (n.nodeValue ?? "").replace(/\s+/g, " ").trim();
        if (!t) continue;
        const range = document.createRange(); range.selectNodeContents(n);
        const tr = range.getBoundingClientRect();
        if (tr.width < 1 || tr.height < 1) continue;
        const col = parseCss(cs.color);
        items.push({ type: "text", ...rel(tr), text: t, sizePt: fontPt(cs), bold: parseInt(cs.fontWeight) >= 600, italic: cs.fontStyle === "italic", underline: /underline/.test(cs.textDecorationLine), color: col?.hex ?? "#000000", font: (cs.fontFamily.split(",")[0] ?? "").trim().replace(/^['"]|['"]$/g, ""), align: "left" });
      } else if (n.nodeType === 1) walk(n as Element, depth + 1);
    }
  };
  walk(root, 0);
  return { items, width: rr.width, height: rr.height, complex };
}

// ───────── rasterisasi ─────────

function svgDataUrl(svg: SVGElement, r: DOMRect): string {
  const c = svg.cloneNode(true) as SVGElement;
  if (!c.getAttribute("xmlns")) c.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  c.setAttribute("width", String(Math.ceil(r.width))); c.setAttribute("height", String(Math.ceil(r.height)));
  inlineStyles(svg, c);
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(c));
}

const STYLE_SKIP = /^(-webkit-(?!text|font)|animation|transition|cursor|pointer-events|resize|will-change|caret|scroll|overscroll|view-transition|container)/;
/** Salin gaya terhitung `src` ke atribut style `dst` (pohon paralel). */
function inlineStyles(src: Element, dst: Element) {
  const cs = getComputedStyle(src);
  let css = "";
  for (let i = 0; i < cs.length; i++) {
    const p = cs.item(i);
    if (STYLE_SKIP.test(p)) continue;
    css += `${p}:${cs.getPropertyValue(p)};`;
  }
  dst.setAttribute("style", css);
  const sk = [...src.children], dk = [...dst.children];
  for (let i = 0; i < sk.length && i < dk.length; i++) inlineStyles(sk[i], dk[i]);
}

async function toDataUrl(url: string): Promise<string | null> {
  if (url.startsWith("data:")) return url;
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>(resolve => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = () => resolve(null); fr.readAsDataURL(blob); });
  } catch { return null; }
}

/** Ganti sumber gambar/kanvas pada klon dengan data-URL (kanvas → <img>); sumber tak terbaca dikosongkan. */
async function inlineMedia(src: Element, dst: Element) {
  const tag = src.tagName.toUpperCase();
  if (tag === "CANVAS") {
    try {
      const img = document.createElement("img");
      img.src = (src as HTMLCanvasElement).toDataURL("image/png");
      img.setAttribute("style", dst.getAttribute("style") ?? "");
      dst.replaceWith(img);
    } catch { dst.setAttribute("style", (dst.getAttribute("style") ?? "") + ";visibility:hidden"); }
    return;
  }
  if (tag === "IMG") {
    const u = (src as HTMLImageElement).currentSrc || (src as HTMLImageElement).src;
    const d = u ? await toDataUrl(u) : null;
    if (d) { (dst as HTMLImageElement).src = d; dst.removeAttribute("srcset"); } else dst.removeAttribute("src");
    return;
  }
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    if (tag === "TEXTAREA") dst.textContent = (src as HTMLTextAreaElement).value;
    else if (tag === "INPUT") dst.setAttribute("value", (src as HTMLInputElement).value);
  }
  const bg = getComputedStyle(src).backgroundImage;
  const m = /url\(["']?(.*?)["']?\)/.exec(bg);
  if (m?.[1] && !m[1].startsWith("data:")) {
    const d = await toDataUrl(m[1]);
    const st = dst.getAttribute("style") ?? "";
    dst.setAttribute("style", d ? st.replace(/background-image:[^;]+;/, `background-image:url("${d}");`) : st.replace(/background-image:[^;]+;/, "background-image:none;"));
  }
  const sk = [...src.children], dk = [...dst.children];
  for (let i = 0; i < sk.length && i < dk.length; i++) await inlineMedia(sk[i], dk[i]);
}

export interface RasterResult { bytes: Uint8Array; width: number; height: number }

/** Render elemen DOM menjadi PNG (SVG foreignObject). */
export async function elementToPng(el: Element, opts: { pixelRatio?: number; background?: string | null } = {}): Promise<RasterResult> {
  const r = el.getBoundingClientRect();
  const w = Math.max(1, Math.ceil(r.width)), h = Math.max(1, Math.ceil(r.height));
  const ratio = Math.max(0.5, Math.min(4, opts.pixelRatio ?? 2));
  const clone = el.cloneNode(true) as HTMLElement;
  inlineStyles(el, clone);
  // akar harus berada di (0,0) kotak render: buang posisi/offset/transform dari tata letak halaman
  clone.style.margin = "0"; clone.style.position = "static"; clone.style.inset = "auto"; clone.style.transform = "none"; clone.style.translate = "none"; clone.style.float = "none";
  clone.style.width = `${w}px`; clone.style.height = `${h}px`; clone.style.boxSizing = "border-box";
  clone.querySelectorAll("script,style,link,iframe,video,audio,object,embed").forEach(n => n.remove());
  await inlineMedia(el, clone);
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  const xhtml = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject></svg>`;
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("Elemen tidak dapat dirender ke gambar")); i.src = url; });
  const cv = document.createElement("canvas");
  cv.width = Math.round(w * ratio); cv.height = Math.round(h * ratio);
  const ctx = cv.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D tidak tersedia");
  if (opts.background) { ctx.fillStyle = opts.background; ctx.fillRect(0, 0, cv.width, cv.height); }
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  const blob = await new Promise<Blob | null>(res => cv.toBlob(res, "image/png"));
  if (!blob) throw new Error("Gagal membuat PNG (kanvas tercemar sumber lintas-origin?)");
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: w, height: h };
}

/** Bytes gambar dari URL (data:, blob:, atau sama-origin); SVG dirasterkan ke PNG. */
export async function loadImageBytes(src: string, svg: boolean | undefined, w: number, h: number): Promise<Uint8Array | null> {
  try {
    if (svg || /^data:image\/svg|\.svg(\?|$)/i.test(src)) {
      const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
      const cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(w * 2)); cv.height = Math.max(1, Math.round(h * 2));
      cv.getContext("2d")!.drawImage(img, 0, 0, cv.width, cv.height);
      const b = await new Promise<Blob | null>(res => cv.toBlob(res, "image/png"));
      return b ? new Uint8Array(await b.arrayBuffer()) : null;
    }
    const d = await fetch(src);
    if (!d.ok) return null;
    return new Uint8Array(await d.arrayBuffer());
  } catch { return null; }
}
