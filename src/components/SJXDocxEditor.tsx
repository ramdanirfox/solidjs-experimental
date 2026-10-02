import DocxEditor, { type DocxEditorProps } from "~/shared/components/docx-editor/DocxEditor";

export type ISJXDocxEditor = DocxEditorProps;

/**
 * Editor DOCX berbasis @office-kit/docx.
 * Komponen ini hanya boleh dirender di client (gunakan `clientOnly` pada route): memakai Blob, Selection API,
 * contenteditable, ResizeObserver, dan File API.
 */
export default function SJXDocxEditor(props: ISJXDocxEditor) {
    return <DocxEditor {...props} />;
}
