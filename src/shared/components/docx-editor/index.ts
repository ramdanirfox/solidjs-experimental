/**
 * Permukaan publik DOCX editor. Modul lain di folder ini internal (boleh berubah tanpa pemberitahuan).
 * Contoh data (`docx-sample`) sengaja tidak diekspor di sini.
 */
export { default, default as DocxEditor } from "./DocxEditor";
export type { DocxEditorApi, DocxEditorEventMap, DocxEditorProps, DocxHfOptions, DocxTabStop, DocxTocInfo, HfKind, ListInfo } from "./DocxEditor";
export type { DocxFormatTarget, DocxNavTarget, SelInfo } from "./docx-view";
export { DOCX_FORMAT_KEYS, DOCX_TABLE_OPS } from "./docx-view";
export type { TocOptions } from "./docx-toc";
export type { Lang as DocxLang } from "./docx-i18n";
