/** Ekspor teks (TXT) dan HTML mandiri (gambar sebagai data URI). */
import { first, isEl, val, type XEl } from "./docx-xml";
import { plainText } from "./docx-text";
import { tableMatrix } from "./docx-table";
import { fillBlocks, Registry, refreshNumbering, type RenderCtx } from "./docx-render";
import { readP } from "./docx-style";
import type { DocxBook } from "./docx-model";

/** Teks polos: paragraf dipisah baris baru, sel tabel dipisah TAB, daftar diberi label. */
export function exportText(book: DocxBook): string {
  const out: string[] = [];
  book.numbering.reset();
  const para = (p: XEl): string => {
    const base = book.styles.paraBase(val(first(p, "pPr"), "pStyle"));
    const direct = readP(first(p, "pPr"), book.styles.theme);
    const numId = direct.numId ?? base.p.numId;
    let prefix = "";
    if (numId && book.numbering.has(numId)) {
      const il = direct.ilvl ?? base.p.ilvl ?? 0;
      const lab = book.numbering.next(numId, il);
      if (lab) prefix = "  ".repeat(il) + lab.text + " ";
    }
    return prefix + plainText(p);
  };
  const walk = (container: XEl) => {
    for (const c of container.children) {
      if (!isEl(c)) continue;
      if (c.name.local === "p") out.push(para(c));
      else if (c.name.local === "tbl") {
        const m = tableMatrix(c, tc => {
          const parts: string[] = [];
          for (const k of tc.children) if (isEl(k) && k.name.local === "p") parts.push(para(k));
          return parts.join(" ").replace(/\s+/g, " ").trim();
        });
        for (const row of m) out.push(row.join("\t"));
      } else if (c.name.local === "sdt") { const sc = first(c, "sdtContent"); if (sc) walk(sc); }
    }
  };
  walk(book.body);
  return out.join("\n");
}

const EXPORT_CSS = `
body{margin:0;background:#f3f4f6;font-family:Calibri,Carlito,Arial,sans-serif}
.dx-export{box-sizing:border-box;background:#fff;margin:24px auto;box-shadow:0 1px 8px rgba(0,0,0,.15);display:flex;flex-direction:column}
.dx-p{white-space:pre-wrap;overflow-wrap:anywhere;position:relative;min-height:1em}
.dx-num{white-space:pre}
.dx-tbl{border-collapse:collapse;table-layout:fixed}
.dx-tbl td{vertical-align:top;overflow-wrap:anywhere}
.dx-cellc{display:flex;flex-direction:column}
.dx-img{display:inline-block;position:relative}
.dx-img img{display:block;width:100%;height:100%}
.dx-img-ph{background:#f1f5f9;border:1px dashed #94a3b8;color:#64748b;font:12px sans-serif;display:inline-flex;align-items:center;justify-content:center}
.dx-link{color:#0563c1;text-decoration:underline}
.dx-hidden{display:none}
.dx-pb{display:inline-block;width:0}
.dx-pbonly{height:0;min-height:0;overflow:visible}
.dx-fnref{font-size:.7em;vertical-align:super}
.dx-ins{text-decoration:underline;color:#047857}.dx-del{text-decoration:line-through;color:#b91c1c}
.dx-ole-badge{position:absolute;right:2px;bottom:2px;font:9px sans-serif;background:#0f172a;color:#fff;padding:0 3px;border-radius:2px}
.dx-shape{position:relative;box-sizing:border-box}.dx-txbx{padding:4px;display:flex;flex-direction:column}
.dx-notes{border-top:1px solid #999;margin-top:18px;padding-top:6px;font-size:.85em}
`;

const esc = (s: string) => s.replace(/[<&>]/g, c => (c === "<" ? "&lt;" : c === "&" ? "&amp;" : "&gt;"));

/** HTML mandiri. Memakai renderer yang sama dengan editor (tanpa pagination); gambar di-inline sebagai data URI. */
export function exportHtml(book: DocxBook, doc: Document = document): string {
  const reg = new Registry();
  const sect = book.sections()[0];
  const contentW = Math.max(200, ((sect.w - sect.ml - sect.mr) * 96) / 1440);
  const ctx: RenderCtx = { book, reg, opts: { readonly: true, showMarks: false, showRevisions: false, forExport: true }, doc, contentW, editable: false, fnRefs: [], source: book.doc.partName, badImages: new Set() };
  const root = doc.createElement("div");
  root.className = "dx-export";
  const px = (v: number) => `${Math.round((v * 96) / 1440)}px`;
  root.style.padding = `${px(sect.mt)} ${px(sect.mr)} ${px(sect.mb)} ${px(sect.ml)}`;
  root.style.width = px(sect.w);
  book.numbering.reset();
  fillBlocks(ctx, root, book.body, true);
  refreshNumbering(ctx);
  if (ctx.fnRefs.length) {
    const box = doc.createElement("div");
    box.className = "dx-notes";
    for (const f of ctx.fnRefs) {
      const n = book.notes(f.kind).get(f.id);
      if (!n) continue;
      ctx.noteNum = f.num;
      const wrap = doc.createElement("div");
      wrap.style.display = "flex"; wrap.style.flexDirection = "column";
      fillBlocks(ctx, wrap, n, true);
      box.appendChild(wrap);
    }
    root.appendChild(box);
  }
  root.querySelectorAll("[contenteditable]").forEach(e => e.removeAttribute("contenteditable"));
  root.querySelectorAll(".dx-pad").forEach(e => e.remove());
  return `<!doctype html>\n<html lang="${book.styles.docRonly.lang ?? "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(book.coreProps().title || book.fileName)}</title><style>${EXPORT_CSS}</style></head><body>${root.outerHTML}</body></html>`;
}
