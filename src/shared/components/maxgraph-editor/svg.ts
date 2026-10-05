import { ImageExport, SvgCanvas2D, constants, xmlUtils, type Graph } from "@maxgraph/core";

/** Ekspor isi graph sebagai string SVG mandiri (ukuran mengikuti batas graph + `border`). */
export function exportGraphSvg(g: Graph, border = 24): string {
    const view = g.getView();
    const scale = view.scale;
    const bounds = g.getGraphBounds();
    const w = Math.max(1, Math.ceil(bounds.width / scale)) + border * 2;
    const h = Math.max(1, Math.ceil(bounds.height / scale)) + border * 2;
    const doc = xmlUtils.createXmlDocument();
    const root = doc.createElementNS(constants.NS_SVG, "svg");
    root.setAttribute("xmlns", constants.NS_SVG);
    root.setAttribute("width", `${w}px`);
    root.setAttribute("height", `${h}px`);
    root.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const canvas = new SvgCanvas2D(root, false);
    canvas.scale(1 / scale);
    canvas.translate(-bounds.x + border * scale, -bounds.y + border * scale);
    const state = view.getState(g.getDataModel().getRoot()!);
    if (state) new ImageExport().drawState(state, canvas);
    return new XMLSerializer().serializeToString(root);
}

/** UTF-8 aman → data URI base64 (maxGraph menolak bentuk `;utf8,` / koma). */
export function svgToDataUri(svg: string): string {
    const bytes = new TextEncoder().encode(svg);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:image/svg+xml;base64,${btoa(s)}`;
}
