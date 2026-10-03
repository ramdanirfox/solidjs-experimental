import type { MaxgraphNodeType } from "./types";

// base64 (bukan `;utf8,`): maxGraph memproses URL gambar dan menolak bentuk data-URI dengan koma/titik-koma.
const toDataUri = (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`;

const svgIcon = (body: string) =>
    toDataUri(
        `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`,
    );

export const ICONS = {
    start: svgIcon('<path d="M8 5v14l11-7z" fill="#fff"/>'),
    process: svgIcon('<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M8 11h8M8 14h5"/>'),
    condition: svgIcon('<path d="M12 3l9 9-9 9-9-9z"/>'),
    sql: svgIcon('<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>'),
    trigger: svgIcon('<path d="M13 2L5 14h6l-1 8 8-12h-6z" fill="#fff"/>'),
    end: svgIcon('<rect x="6" y="6" width="12" height="12" rx="2" fill="#fff"/>'),
    connector: toDataUri(
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="#2563eb" stroke="#fff" stroke-width="1.5"/><path d="M5 8h6M8.5 5.5L11 8l-2.5 2.5" stroke="#fff" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    ),
};

export const DEFAULT_NODE_TYPES: MaxgraphNodeType[] = [
    { id: "start", label: "Start", icon: ICONS.start, color: "#7c3aed" },
    { id: "process", label: "Process", icon: ICONS.process, color: "#475569" },
    { id: "condition", label: "Condition", icon: ICONS.condition, color: "#d97706" },
    { id: "sql", label: "SQL Query", icon: ICONS.sql, color: "#0284c7" },
    { id: "trigger", label: "Trigger Event", icon: ICONS.trigger, color: "#059669" },
    { id: "end", label: "End", icon: ICONS.end, color: "#dc2626" },
];

export const DEFAULT_NODE_SIZE = { width: 140, height: 44 };

export const EDGE_STYLE_VALUES = {
    orthogonal: { edgeStyle: "orthogonalEdgeStyle", curved: false, rounded: true },
    straight: { edgeStyle: undefined, curved: false, rounded: false },
    curved: { edgeStyle: "orthogonalEdgeStyle", curved: true, rounded: false },
    elbow: { edgeStyle: "elbowEdgeStyle", curved: false, rounded: false },
    entity: { edgeStyle: "entityRelationEdgeStyle", curved: false, rounded: false },
} as const;

export const EDGE_STYLE_LABELS: Record<keyof typeof EDGE_STYLE_VALUES, string> = {
    orthogonal: "Orthogonal",
    straight: "Lurus",
    curved: "Lengkung",
    elbow: "Siku",
    entity: "Entity relation",
};

export const NODE_MIME = "application/x-maxgraph-node";

export const EMPTY_MODEL_XML = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>`;
