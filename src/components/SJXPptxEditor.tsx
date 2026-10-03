import PptxEditor, { type PptxEditorProps } from "~/shared/components/pptx-editor/PptxEditor";

export type ISJXPptxEditor = PptxEditorProps;

/**
 * Editor PPTX berbasis @office-kit/pptx.
 * Komponen ini hanya boleh dirender di client (gunakan `clientOnly` pada route): memakai Blob, Selection API,
 * contenteditable, ResizeObserver, Fullscreen API, dan File API.
 */
export default function SJXPptxEditor(props: ISJXPptxEditor) {
    return <PptxEditor {...props} />;
}
