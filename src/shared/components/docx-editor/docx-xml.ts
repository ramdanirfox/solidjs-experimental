/**
 * Lapisan XML untuk editor DOCX.
 *
 * `@office-kit/docx` menyimpan properti paragraf/run/tabel sebagai XML mentah (`XmlElement`), sedangkan
 * hyperlink, tabel bersarang, SDT, dsb. hanya muncul sebagai node mentah. Agar seluruh isi dokumen bisa
 * diedit dengan satu cara, isi `<w:body>` diubah sekali menjadi pohon `XEl` milik kita (lihat `astBodyToXml`)
 * dan ditulis balik ke library sebagai blok `raw` (lihat `DocxBook.flush`). Library tetap mengurus paket OPC,
 * relasi, styles, numbering, dan serialisasi.
 */
import type { WmlBlock, WmlBody, WmlParagraph } from "@office-kit/docx";

export const NS = {
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  pic: "http://schemas.openxmlformats.org/drawingml/2006/picture",
  c: "http://schemas.openxmlformats.org/drawingml/2006/chart",
  v: "urn:schemas-microsoft-com:vml",
  o: "urn:schemas-microsoft-com:office:office",
  mc: "http://schemas.openxmlformats.org/markup-compatibility/2006",
  wps: "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
  m: "http://schemas.openxmlformats.org/officeDocument/2006/math",
  xml: "http://www.w3.org/XML/1998/namespace",
  xmlns: "http://www.w3.org/2000/xmlns/",
} as const;

export interface XName { uri: string; local: string; prefix: string }
export interface XAttr { name: XName; value: string; isNamespaceDecl: boolean }
export interface XEl {
  kind: "element";
  name: XName;
  attrs: XAttr[];
  children: XNode[];
  xmlSpace: "default" | "preserve";
  selfClosing: boolean;
}
export interface XText { kind: "text"; value: string }
export interface XOther { kind: "cdata" | "comment" | "pi"; value?: string; target?: string; data?: string }
export type XNode = XEl | XText | XOther;

export const isEl = (n: XNode | undefined | null): n is XEl => !!n && n.kind === "element";
export const isText = (n: XNode | undefined | null): n is XText => !!n && n.kind === "text";

/** Elemen dengan nama lokal `local` (namespace opsional). */
export function is(n: XNode | undefined | null, local: string, ns?: string): n is XEl {
  return !!n && n.kind === "element" && n.name.local === local && (ns === undefined || n.name.uri === ns);
}
export const isW = (n: XNode | undefined | null, local: string): n is XEl => is(n, local, NS.w);

export function els(el: XEl, local?: string): XEl[] {
  const out: XEl[] = [];
  for (const c of el.children) if (c.kind === "element" && (local === undefined || c.name.local === local)) out.push(c);
  return out;
}
export function first(el: XEl | undefined | null, local: string): XEl | undefined {
  if (!el) return undefined;
  for (const c of el.children) if (c.kind === "element" && c.name.local === local) return c;
  return undefined;
}
/** Cari turunan pertama (DFS) dengan nama lokal tertentu. */
export function descend(el: XEl | undefined | null, local: string): XEl | undefined {
  if (!el) return undefined;
  for (const c of el.children) {
    if (c.kind !== "element") continue;
    if (c.name.local === local) return c;
    const r = descend(c, local);
    if (r) return r;
  }
  return undefined;
}
export function descendAll(el: XEl | undefined | null, local: string, out: XEl[] = []): XEl[] {
  if (!el) return out;
  for (const c of el.children) {
    if (c.kind !== "element") continue;
    if (c.name.local === local) out.push(c);
    descendAll(c, local, out);
  }
  return out;
}

/** Nilai atribut berdasarkan nama lokal (abaikan prefix/namespace; atribut xmlns dilewati). */
export function attr(el: XEl | undefined | null, local: string): string | undefined {
  if (!el) return undefined;
  for (const a of el.attrs) if (!a.isNamespaceDecl && a.name.local === local) return a.value;
  return undefined;
}
/** Nilai `w:val` dari anak bernama `local` (mis. `<w:jc w:val="center"/>`). */
export function val(parent: XEl | undefined | null, local: string): string | undefined {
  return attr(first(parent, local), "val");
}
/** Boolean toggle OOXML: elemen ada tanpa val / val=1/true/on → true; val=0/false/off → false; tidak ada → undefined. */
export function onOff(parent: XEl | undefined | null, local: string): boolean | undefined {
  const e = first(parent, local);
  if (!e) return undefined;
  const v = attr(e, "val");
  if (v === undefined) return true;
  return !(v === "0" || v === "false" || v === "off");
}
export function num(s: string | undefined): number | undefined {
  if (s === undefined || s === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export function setAttr(el: XEl, local: string, value: string | undefined, ns: string = NS.w, prefix = "w") {
  const i = el.attrs.findIndex(a => !a.isNamespaceDecl && a.name.local === local);
  if (value === undefined) { if (i >= 0) el.attrs.splice(i, 1); return; }
  if (i >= 0) el.attrs[i] = { ...el.attrs[i], value };
  else el.attrs.push({ name: { uri: ns, local, prefix }, value, isNamespaceDecl: false });
}

export function mk(local: string, attrs?: Record<string, string | number | undefined>, children?: XNode[], ns: string = NS.w, prefix = "w"): XEl {
  const a: XAttr[] = [];
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    const idx = k.indexOf(":");
    // atribut tanpa prefix eksplisit: `w:` hanya untuk elemen WordprocessingML; elemen DrawingML (wp/a/pic) memakai atribut tak berprefix
    const p = idx > 0 ? k.slice(0, idx) : ns === NS.w ? "w" : "";
    const l = idx > 0 ? k.slice(idx + 1) : k;
    const uri = idx > 0 ? (NS as Record<string, string>)[p] ?? ns : p ? ns : "";
    a.push({ name: { uri, local: l, prefix: p }, value: String(v), isNamespaceDecl: false });
  }
  const ch = children ?? [];
  return { kind: "element", name: { uri: ns, local, prefix }, attrs: a, children: ch, xmlSpace: "default", selfClosing: ch.length === 0 };
}
export function mkText(local: string, value: string): XEl {
  const e = mk(local, undefined, [{ kind: "text", value }]);
  if (/^\s|\s$|\s\s/.test(value) || value === "") { e.attrs.push({ name: { uri: NS.xml, local: "space", prefix: "xml" }, value: "preserve", isNamespaceDecl: false }); e.xmlSpace = "preserve"; }
  return e;
}
export function textOf(el: XEl): string {
  let s = "";
  for (const c of el.children) if (c.kind === "text") s += c.value; else if (c.kind === "cdata") s += c.value ?? "";
  return s;
}
/** Seluruh teks turunan (DFS). */
export function deepText(el: XEl): string {
  let s = "";
  for (const c of el.children) {
    if (c.kind === "text") s += c.value;
    else if (c.kind === "element") s += deepText(c);
  }
  return s;
}

export function cloneEl<T extends XNode>(n: T): T {
  if (n.kind !== "element") return { ...n } as T;
  return { ...n, name: { ...n.name }, attrs: n.attrs.map(a => ({ ...a, name: { ...a.name } })), children: n.children.map(c => cloneEl(c)) } as T;
}
/** Salin elemen tanpa anak. */
export function shallowClone(el: XEl): XEl {
  return { ...el, name: { ...el.name }, attrs: el.attrs.map(a => ({ ...a, name: { ...a.name } })), children: [], selfClosing: true };
}

export function removeNode(parent: XEl, child: XNode): boolean {
  const i = parent.children.indexOf(child);
  if (i < 0) return false;
  parent.children.splice(i, 1);
  return true;
}
export function removeKids(parent: XEl, local: string) {
  parent.children = parent.children.filter(c => !(c.kind === "element" && c.name.local === local));
}
export function insertAfter(parent: XEl, ref: XNode | null, node: XNode) {
  const i = ref ? parent.children.indexOf(ref) : -1;
  parent.children.splice(i + 1, 0, node);
  parent.selfClosing = false;
}

// ───────── urutan anak sesuai skema (Word menolak/menyusun ulang bila terbalik) ─────────

const ORDER: Record<string, string[]> = {
  pPr: ["pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl", "numPr", "suppressLineNumbers", "pBdr", "shd", "tabs", "suppressAutoHyphens", "kinsoku", "wordWrap", "overflowPunct", "topLinePunct", "autoSpaceDE", "autoSpaceDN", "bidi", "adjustRightInd", "snapToGrid", "spacing", "ind", "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc", "textDirection", "textAlignment", "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange"],
  rPr: ["rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline", "shadow", "emboss", "imprint", "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz", "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath"],
  tcPr: ["cnfStyle", "tcW", "gridSpan", "hMerge", "vMerge", "tcBorders", "shd", "noWrap", "tcMar", "textDirection", "tcFitText", "vAlign", "hideMark"],
  tblPr: ["tblStyle", "tblpPr", "tblOverlap", "bidiVisual", "tblStyleRowBandSize", "tblStyleColBandSize", "tblW", "jc", "tblCellSpacing", "tblInd", "tblBorders", "shd", "tblLayout", "tblCellMar", "tblLook", "tblCaption", "tblDescription"],
  trPr: ["cnfStyle", "divId", "gridBefore", "gridAfter", "wBefore", "wAfter", "cantSplit", "trHeight", "tblHeader", "tblCellSpacing", "jc", "hidden"],
  sectPr: ["headerReference", "footerReference", "footnotePr", "endnotePr", "type", "pgSz", "pgMar", "paperSrc", "pgBorders", "lnNumType", "pgNumType", "cols", "formProt", "vAlign", "noEndnote", "titlePg", "textDirection", "bidi", "rtlGutter", "docGrid"],
  pBdr: ["top", "left", "bottom", "right", "between", "bar"],
  tcBorders: ["top", "start", "left", "bottom", "end", "right", "insideH", "insideV", "tl2br", "tr2bl"],
  tblBorders: ["top", "start", "left", "bottom", "end", "right", "insideH", "insideV"],
  tcMar: ["top", "start", "left", "bottom", "end", "right"],
  tblCellMar: ["top", "start", "left", "bottom", "end", "right"],
};

/** Pasang `child` pada `parent` di posisi sesuai urutan skema; elemen sejenis sebelumnya dibuang. */
export function setChild(parent: XEl, child: XEl | null, local?: string) {
  const l = child?.name.local ?? local!;
  removeKids(parent, l);
  if (!child) { if (parent.children.length === 0) parent.selfClosing = true; return; }
  const order = ORDER[parent.name.local];
  parent.selfClosing = false;
  if (!order) { parent.children.push(child); return; }
  const rank = order.indexOf(l);
  if (rank < 0) { parent.children.push(child); return; }
  let at = parent.children.length;
  for (let i = 0; i < parent.children.length; i++) {
    const c = parent.children[i];
    if (c.kind !== "element") continue;
    const r = order.indexOf(c.name.local);
    if (r > rank) { at = i; break; }
  }
  parent.children.splice(at, 0, child);
}

/** Ambil (atau buat) properti container (`pPr`, `rPr`, `tcPr`, `tblPr`, `trPr`) milik elemen `owner`. */
export function ensureProps(owner: XEl, local: "pPr" | "rPr" | "tcPr" | "tblPr" | "trPr" | "sectPr"): XEl {
  let p = first(owner, local);
  if (p) return p;
  p = mk(local);
  owner.selfClosing = false;
  // pPr/rPr/tcPr/tblPr/trPr selalu anak pertama (setelah tblPr→tblGrid urutan dijaga insertAt)
  if (local === "rPr" && owner.name.local === "r") owner.children.unshift(p);
  else if (owner.name.local === "p") owner.children.unshift(p);
  else if (owner.name.local === "tc") owner.children.unshift(p);
  else if (owner.name.local === "tr") {
    const idx = owner.children.findIndex(c => isEl(c) && c.name.local === "tblPrEx");
    owner.children.splice(idx + 1, 0, p);
  } else if (owner.name.local === "tbl") owner.children.unshift(p);
  else owner.children.unshift(p);
  return p;
}
/** Buang container properti bila sudah tidak punya anak. */
export function pruneProps(owner: XEl, local: string) {
  const p = first(owner, local);
  if (p && p.children.length === 0) removeKids(owner, local);
}

// ───────── serializer & parser XML ringkas (independen dari DOM agar bisa diuji di Node) ─────────

const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const qn = (n: XName) => (n.prefix ? `${n.prefix}:${n.local}` : n.local);

export function serialize(node: XNode): string {
  switch (node.kind) {
    case "text": return escText(node.value);
    case "cdata": return `<![CDATA[${node.value ?? ""}]]>`;
    case "comment": return `<!--${node.value ?? ""}-->`;
    case "pi": return node.data ? `<?${node.target} ${node.data}?>` : `<?${node.target}?>`;
    default: {
      const t = qn(node.name);
      const a = node.attrs.map(x => ` ${qn(x.name)}="${escAttr(x.value)}"`).join("");
      if (node.children.length === 0) return node.selfClosing ? `<${t}${a}/>` : `<${t}${a}></${t}>`;
      return `<${t}${a}>${node.children.map(serialize).join("")}</${t}>`;
    }
  }
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decode(s: string): string {
  if (s.indexOf("&") < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (m, b: string) => {
    if (b[0] === "#") { const c = b[1] === "x" || b[1] === "X" ? parseInt(b.slice(2), 16) : parseInt(b.slice(1), 10); return Number.isFinite(c) ? String.fromCodePoint(c) : m; }
    return ENT[b] ?? m;
  });
}

/** Parser XML sederhana (namespace-aware) → `XEl`. Cukup untuk part OOXML; whitespace antar-elemen dibuang seperti library. */
export function parseXmlString(src: string): XEl {
  let i = 0;
  const n = src.length;
  const nsStack: Record<string, string>[] = [{ xml: NS.xml, xmlns: NS.xmlns }];

  const skipMisc = () => {
    for (;;) {
      while (i < n && /\s/.test(src[i])) i++;
      if (src.startsWith("<?", i)) { i = src.indexOf("?>", i) + 2; continue; }
      if (src.startsWith("<!--", i)) { i = src.indexOf("-->", i) + 3; continue; }
      if (src.startsWith("<!DOCTYPE", i)) { i = src.indexOf(">", i) + 1; continue; }
      break;
    }
  };
  const readName = () => { const s = i; while (i < n && !/[\s=/>]/.test(src[i])) i++; return src.slice(s, i); };
  const resolve = (raw: string, isAttr: boolean): XName => {
    const c = raw.indexOf(":");
    const prefix = c > 0 ? raw.slice(0, c) : "";
    const local = c > 0 ? raw.slice(c + 1) : raw;
    if (isAttr && !prefix) return { uri: "", local, prefix: "" };
    for (let k = nsStack.length - 1; k >= 0; k--) { const u = nsStack[k][prefix]; if (u !== undefined) return { uri: u, local, prefix }; }
    return { uri: "", local, prefix };
  };

  function parseEl(parentSpace: "default" | "preserve"): XEl {
    i++; // <
    const rawName = readName();
    const raws: [string, string][] = [];
    for (;;) {
      while (i < n && /\s/.test(src[i])) i++;
      if (src[i] === "/" || src[i] === ">") break;
      const an = readName();
      while (i < n && /\s/.test(src[i])) i++;
      i++; // =
      while (i < n && /\s/.test(src[i])) i++;
      const q = src[i++];
      const e = src.indexOf(q, i);
      raws.push([an, decode(src.slice(i, e))]);
      i = e + 1;
    }
    const scope: Record<string, string> = {};
    for (const [k, v] of raws) { if (k === "xmlns") scope[""] = v; else if (k.startsWith("xmlns:")) scope[k.slice(6)] = v; }
    nsStack.push(scope);
    const name = resolve(rawName, false);
    const attrs: XAttr[] = raws.map(([k, v]) => {
      const isDecl = k === "xmlns" || k.startsWith("xmlns:");
      return { name: isDecl ? { uri: NS.xmlns, local: k === "xmlns" ? "xmlns" : k.slice(6), prefix: k === "xmlns" ? "" : "xmlns" } : resolve(k, true), value: v, isNamespaceDecl: isDecl };
    });
    let space = parentSpace;
    const sp = attrs.find(a => a.name.uri === NS.xml && a.name.local === "space");
    if (sp) space = sp.value === "preserve" ? "preserve" : "default";
    const el: XEl = { kind: "element", name, attrs, children: [], xmlSpace: space, selfClosing: false };
    if (src[i] === "/") { i += 2; el.selfClosing = true; nsStack.pop(); return el; }
    i++; // >
    while (i < n) {
      if (src.startsWith("</", i)) { i = src.indexOf(">", i) + 1; break; }
      if (src.startsWith("<![CDATA[", i)) { const e = src.indexOf("]]>", i); el.children.push({ kind: "cdata", value: src.slice(i + 9, e) }); i = e + 3; continue; }
      if (src.startsWith("<!--", i)) { const e = src.indexOf("-->", i); el.children.push({ kind: "comment", value: src.slice(i + 4, e) }); i = e + 3; continue; }
      if (src.startsWith("<?", i)) { i = src.indexOf("?>", i) + 2; continue; }
      if (src[i] === "<") { el.children.push(parseEl(space)); continue; }
      const e = src.indexOf("<", i);
      const raw = src.slice(i, e < 0 ? n : e);
      i = e < 0 ? n : e;
      const value = decode(raw);
      if (space === "preserve" || value.trim().length > 0 || el.children.some(c => c.kind === "text" || c.kind === "cdata")) el.children.push({ kind: "text", value });
    }
    nsStack.pop();
    return el;
  }

  skipMisc();
  return parseEl("default");
}

// ───────── AST library → XEl ─────────

const WML = NS.w;
const w = (local: string, ch: XNode[] = [], attrs: XAttr[] = []): XEl => ({ kind: "element", name: { uri: WML, local, prefix: "w" }, attrs, children: ch, xmlSpace: "default", selfClosing: ch.length === 0 });
const wattr = (local: string, value: string): XAttr => ({ name: { uri: WML, local, prefix: "w" }, value, isNamespaceDecl: false });

function splice(recognized: XNode[], extras: { slot: number; node: unknown }[]): XNode[] {
  if (extras.length === 0) return recognized;
  const total = recognized.length + extras.length;
  const result: (XNode | undefined)[] = new Array(total).fill(undefined);
  for (const e of extras) if (e.slot >= 0 && e.slot < total) result[e.slot] = e.node as XNode;
  let r = 0;
  for (let k = 0; k < total; k++) if (result[k] === undefined && r < recognized.length) result[k] = recognized[r++];
  while (r < recognized.length) result.push(recognized[r++]);
  return result.filter((x): x is XNode => x !== undefined);
}

type AnyRun = Extract<WmlParagraph["children"][number], { kind: "run" }>;
type AnyPiece = AnyRun["pieces"][number];

function textEl(local: string, value: string, preserve: boolean): XEl {
  const e = w(local, [{ kind: "text", value }], preserve ? [{ name: { uri: NS.xml, local: "space", prefix: "xml" }, value: "preserve", isNamespaceDecl: false }] : []);
  if (preserve) e.xmlSpace = "preserve";
  return e;
}
function pieceToXml(p: AnyPiece): XEl {
  switch (p.kind) {
    case "text": return textEl("t", p.value, p.preserveSpace);
    case "delText": return textEl("delText", p.value, p.preserveSpace);
    case "instrText": return textEl("instrText", p.value, p.preserveSpace);
    case "delInstrText": return textEl("delInstrText", p.value, p.preserveSpace);
    case "tab": return w("tab");
    case "break": {
      const a: XAttr[] = [];
      if (p.breakType) a.push(wattr("type", p.breakType));
      if (p.clear) a.push(wattr("clear", p.clear));
      return w("br", [], a);
    }
    case "noBreakHyphen": return w("noBreakHyphen");
    case "softHyphen": return w("softHyphen");
    case "lastRenderedPageBreak": return w("lastRenderedPageBreak");
    case "fieldChar": return p.raw as unknown as XEl;
    case "symbol": return w("sym", [], [wattr("font", p.font), wattr("char", p.char)]);
    case "drawing":
    case "pict":
    case "raw": return p.node as unknown as XEl;
  }
}
function runToXml(r: AnyRun): XEl {
  const rec: XNode[] = [];
  if (r.rPr) rec.push(r.rPr as unknown as XEl);
  for (const p of r.pieces) rec.push(pieceToXml(p));
  return w("r", splice(rec, r.extras));
}
export function paragraphToXml(p: WmlParagraph): XEl {
  const rec: XNode[] = [];
  if (p.pPr) rec.push(p.pPr as unknown as XEl);
  for (const c of p.children) rec.push(c.kind === "raw" ? (c.node as unknown as XEl) : runToXml(c));
  return w("p", splice(rec, p.extras));
}
function blockToXml(b: WmlBlock): XEl {
  if (b.kind === "raw") return b.node as unknown as XEl;
  if (b.kind === "paragraph") return paragraphToXml(b);
  const rec: XNode[] = [];
  if (b.tblPr) rec.push(b.tblPr as unknown as XEl);
  if (b.tblGrid) rec.push(b.tblGrid as unknown as XEl);
  for (const row of b.rows) {
    const rr: XNode[] = [];
    if (row.trPr) rr.push(row.trPr as unknown as XEl);
    for (const cell of row.cells) {
      const cc: XNode[] = [];
      if (cell.tcPr) cc.push(cell.tcPr as unknown as XEl);
      for (const p of cell.paragraphs) cc.push(paragraphToXml(p));
      let kids = splice(cc, cell.extras);
      if (kids.length === 0) kids = [w("p")];
      const tc = w("tc", kids);
      tc.selfClosing = false;
      rr.push(tc);
    }
    rec.push(w("tr", splice(rr, row.extras)));
  }
  return w("tbl", splice(rec, b.extras));
}

/** Ubah `WmlBody` library menjadi `<w:body>` (tanpa sectPr akhir) dan `sectPr`-nya. */
export function astBodyToXml(body: WmlBody): { body: XEl; sectPr: XEl | undefined } {
  const rec: XNode[] = body.blocks.map(blockToXml);
  const kids = splice(rec, body.extras);
  return { body: w("body", kids), sectPr: body.sectPr as unknown as XEl | undefined };
}
