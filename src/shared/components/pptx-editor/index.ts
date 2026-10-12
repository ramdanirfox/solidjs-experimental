/**
 * Permukaan publik PPTX editor. Modul lain di folder ini internal (boleh berubah tanpa pemberitahuan).
 * Contoh data (`pptx-sample`) sengaja tidak diekspor di sini.
 */
export { default, default as PptxEditor } from "./PptxEditor";
export type { PptxEditorApi, PptxEditorEventMap, PptxEditorProps } from "./PptxEditor";
export type { PptxFormatTarget, PptxNavTarget, PxSelInfo, Tool as PptxTool } from "./pptx-view";
export { PPTX_FORMAT_KEYS } from "./pptx-view";
export type { DomImportOptions, DomImportResult } from "./pptx-dom-import";
export type { Lang as PptxLang } from "./pptx-i18n";
