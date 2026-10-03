import SharedMaxgraphNodeEditor, { type SharedMaxgraphNodeEditorProps } from "~/shared/components/maxgraph-editor";

export type ISJXMaxgraphEditor = SharedMaxgraphNodeEditorProps;

/**
 * Editor diagram node berbasis @maxgraph/core.
 * Hanya boleh dirender di client (gunakan `clientOnly` pada route): memakai DOM, SVG, dan Drag & Drop API.
 */
export default function SJXMaxgraphEditor(props: ISJXMaxgraphEditor) {
    return <SharedMaxgraphNodeEditor {...props} />;
}
