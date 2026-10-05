/** OLE untuk DOCX: daftar objek tertanam pada dokumen + akses proyek VBA. Inti CFB/OLE ada di office-shared/ole-core.ts. */
import { attr, descendAll, type XEl } from "./docx-xml";
import { REL, type DocxBook } from "./docx-model";
import { plainText, flatText } from "./docx-text";
import { describeProgId, isCfb, isZip, readCfb, type OleObject } from "../office-shared/ole-core";

export * from "../office-shared/ole-core";
export * from "./docx-ole-edit";

// ───────── daftar objek OLE pada dokumen ─────────

export function listOle(book: DocxBook): OleObject[] {
  const out: OleObject[] = [];
  const names = book.partNames();
  const used = new Set<string>();
  let idx = 0;
  let pIndex = 0;
  for (const { p } of book.paragraphs()) {
    pIndex++;
    for (const o of descendAll(p, "OLEObject")) {
      const relId = attr(o, "id");
      const r = relId ? book.rel(relId) : undefined;
      const part = r && r.targetMode !== "External" ? book.resolve(book.doc.partName, r.target) : r?.target ?? "";
      const e = part ? book.part(part) : undefined;
      if (part) used.add(part);
      const progId = attr(o, "ProgID");
      const data = e?.data;
      const format: OleObject["format"] = !data ? "missing" : isCfb(data) ? "cfb" : isZip(data) ? "zip" : "other";
      let clsid: string | undefined;
      if (data && format === "cfb") { try { clsid = readCfb(data).rootClsid; } catch { /* abaikan */ } }
      out.push({
        index: ++idx, part, relId, progId,
        relType: r?.type === REL.package ? "package" : r?.type === REL.oleObject ? "oleObject" : "other",
        linked: attr(o, "Type") === "Link" || r?.targetMode === "External",
        aspect: attr(o, "DrawAspect"),
        size: data?.length ?? 0, format, paragraph: pIndex, snippet: plainText(p).slice(0, 80), description: describeProgId(progId, clsid),
        fileName: part.split("/").pop() ?? "",
      });
    }
  }
  // embedding yang tidak ditemukan referensinya di body (mis. header/footer) tetap dicantumkan
  for (const n of names) {
    if (!n.startsWith("/word/embeddings/") || used.has(n) || [...book.oleTracked.values()].includes(n)) continue;
    const data = book.part(n)?.data;
    const format: OleObject["format"] = !data ? "missing" : isCfb(data) ? "cfb" : isZip(data) ? "zip" : "other";
    out.push({ index: ++idx, part: n, relType: "other", linked: false, size: data?.length ?? 0, format, paragraph: 0, snippet: "", description: "OLE", fileName: n.split("/").pop() ?? "" });
  }
  return out;
}

/** Berkas biner makro (vbaProject.bin) bila ada. */
export function vbaPart(book: DocxBook) {
  const n = book.partNames().find(x => /vbaProject\.bin$/i.test(x));
  return n ? book.part(n) : undefined;
}

