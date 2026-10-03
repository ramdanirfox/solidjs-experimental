/**
 * Render grafik (dari `ReadChartSpec`) menjadi markup SVG: column/bar (clustered/stacked), line, area, pie, doughnut, scatter, radar.
 * Jenis lain (stock, surface, bubble, 3-D) digambar sebagai placeholder berlabel.
 */
import type { ReadChartSpec } from "@office-kit/pptx";

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const n2 = (n: number) => Math.round(n * 100) / 100;

function niceScale(min: number, max: number, ticks = 5): { min: number; max: number; step: number } {
  if (!(max > min)) { max = min + 1; }
  const raw = (max - min) / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  return { min: Math.floor(min / step) * step, max: Math.ceil(max / step) * step, step };
}
const fmt = (v: number) => (Math.abs(v) >= 1000 ? `${n2(v / 1000)}k` : String(n2(v)));

export function chartSvg(spec: ReadChartSpec, w: number, h: number, palette: string[]): string {
  const S = spec as ReadChartSpec & { grouping?: string; legend?: unknown };
  const colors = (i: number) => spec.series[i]?.color ?? palette[i % palette.length];
  const text = (x: number, y: number, s: string, o = "") => `<text x="${n2(x)}" y="${n2(y)}" font-size="12" fill="#444" ${o}>${esc(s)}</text>`;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Calibri,Arial,sans-serif">`;
  if (spec.chartAreaFill) svg += `<rect width="${w}" height="${h}" fill="${spec.chartAreaFill}"/>`;
  const title = spec.title;
  const top = title ? 30 : 10;
  if (title) svg += text(w / 2, 20, title, 'text-anchor="middle" font-size="15" font-weight="700"');
  const showLegend = spec.series.length > 1 || spec.kind === "pie" || spec.kind === "doughnut";
  const legendH = showLegend ? 24 : 0;
  const names = spec.kind === "pie" || spec.kind === "doughnut" ? spec.categories : spec.series.map(s => s.name);
  if (showLegend) {
    let x = 12;
    names.slice(0, 12).forEach((nm, i) => {
      const col = spec.kind === "pie" || spec.kind === "doughnut" ? palette[i % palette.length] : colors(i);
      svg += `<rect x="${x}" y="${h - 18}" width="10" height="10" fill="${col}"/>` + text(x + 14, h - 9, nm);
      x += 22 + nm.length * 6.5;
    });
  }
  const area = { l: 44, t: top, r: w - 12, b: h - legendH - 26 };
  const pw = area.r - area.l, ph = area.b - area.t;
  if (pw < 20 || ph < 20) return svg + "</svg>";

  if (spec.kind === "pie" || spec.kind === "doughnut") {
    const vals = (spec.series[0]?.values ?? []).map(v => Math.max(0, v ?? 0));
    const tot = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = w / 2, cy = (area.t + area.b) / 2, r = Math.min(pw, ph) / 2 - 4;
    let a0 = -Math.PI / 2;
    vals.forEach((v, i) => {
      const a1 = a0 + (v / tot) * Math.PI * 2;
      const col = spec.series[0]?.pointColors?.[i] ?? palette[i % palette.length];
      const big = a1 - a0 > Math.PI ? 1 : 0;
      const p = (rr: number, a: number) => `${n2(cx + rr * Math.cos(a))} ${n2(cy + rr * Math.sin(a))}`;
      svg += spec.kind === "pie"
        ? `<path d="M${cx} ${cy}L${p(r, a0)}A${r} ${r} 0 ${big} 1 ${p(r, a1)}Z" fill="${col}" stroke="#fff"/>`
        : `<path d="M${p(r, a0)}A${r} ${r} 0 ${big} 1 ${p(r, a1)}L${p(r * 0.55, a1)}A${r * 0.55} ${r * 0.55} 0 ${big} 0 ${p(r * 0.55, a0)}Z" fill="${col}" stroke="#fff"/>`;
      if (v / tot > 0.04) svg += text(cx + r * (spec.kind === "pie" ? 0.65 : 0.78) * Math.cos((a0 + a1) / 2), cy + r * (spec.kind === "pie" ? 0.65 : 0.78) * Math.sin((a0 + a1) / 2) + 4, `${Math.round((v / tot) * 100)}%`, 'text-anchor="middle" fill="#fff" font-weight="700"');
      a0 = a1;
    });
    return svg + "</svg>";
  }

  if (spec.kind === "radar") {
    const n = spec.categories.length || 1;
    const cx = (area.l + area.r) / 2, cy = (area.t + area.b) / 2, r = Math.min(pw, ph) / 2 - 18;
    const all = spec.series.flatMap(s => s.values.map(v => v ?? 0));
    const max = niceScale(0, Math.max(...all, 1)).max;
    for (let k = 1; k <= 4; k++) svg += `<polygon points="${spec.categories.map((_, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return `${n2(cx + ((r * k) / 4) * Math.cos(a))},${n2(cy + ((r * k) / 4) * Math.sin(a))}`; }).join(" ")}" fill="none" stroke="#ddd"/>`;
    spec.categories.forEach((c, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; svg += text(cx + (r + 10) * Math.cos(a), cy + (r + 10) * Math.sin(a) + 4, c, 'text-anchor="middle"'); });
    spec.series.forEach((s, si) => { svg += `<polygon points="${s.values.map((v, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; const rr = (r * (v ?? 0)) / max; return `${n2(cx + rr * Math.cos(a))},${n2(cy + rr * Math.sin(a))}`; }).join(" ")}" fill="${colors(si)}" fill-opacity=".25" stroke="${colors(si)}" stroke-width="2"/>`; });
    return svg + "</svg>";
  }

  if (spec.kind === "scatter") {
    const xs = spec.series.flatMap(s => (s.xValues ?? s.values.map((_, i) => i + 1)).map(v => v ?? 0));
    const ys = spec.series.flatMap(s => s.values.map(v => v ?? 0));
    const sx = niceScale(Math.min(0, ...xs), Math.max(...xs, 1)), sy = niceScale(Math.min(0, ...ys), Math.max(...ys, 1));
    for (let v = sy.min; v <= sy.max + 1e-9; v += sy.step) { const y = area.b - ((v - sy.min) / (sy.max - sy.min)) * ph; svg += `<line x1="${area.l}" x2="${area.r}" y1="${n2(y)}" y2="${n2(y)}" stroke="#e5e5e5"/>` + text(area.l - 6, y + 4, fmt(v), 'text-anchor="end"'); }
    for (let v = sx.min; v <= sx.max + 1e-9; v += sx.step) { const x = area.l + ((v - sx.min) / (sx.max - sx.min)) * pw; svg += text(x, area.b + 16, fmt(v), 'text-anchor="middle"'); }
    spec.series.forEach((s, si) => (s.xValues ?? s.values.map((_, i) => i + 1)).forEach((xv, i) => { const x = area.l + (((xv ?? 0) - sx.min) / (sx.max - sx.min)) * pw, y = area.b - (((s.values[i] ?? 0) - sy.min) / (sy.max - sy.min)) * ph; svg += `<circle cx="${n2(x)}" cy="${n2(y)}" r="4" fill="${colors(si)}"/>`; }));
    return svg + "</svg>";
  }

  if (!["column", "bar", "line", "area"].includes(spec.kind)) {
    svg += `<rect x="${area.l}" y="${area.t}" width="${pw}" height="${ph}" fill="#f1f5f9" stroke="#cbd5e1" stroke-dasharray="4"/>` + text(w / 2, h / 2, `📊 ${spec.kind}`, 'text-anchor="middle" font-size="14"');
    return svg + "</svg>";
  }

  // sumbu kategori/nilai
  const horizontal = spec.kind === "bar";
  const stacked = !!S.grouping && S.grouping !== "clustered";
  const pct = S.grouping === "percentStacked";
  const nCat = Math.max(1, spec.categories.length);
  const sums = spec.categories.map((_, i) => spec.series.reduce((a, s) => a + Math.max(0, s.values[i] ?? 0), 0));
  const allV = spec.series.flatMap(s => s.values.map(v => v ?? 0));
  const dMax = pct ? 1 : stacked ? Math.max(...sums, 1) : Math.max(...allV, 1);
  const dMin = Math.min(0, ...(stacked ? [0] : allV));
  const va = spec.valueAxis;
  const sc = niceScale(va?.min ?? dMin, va?.max ?? dMax);
  const scale = (v: number) => (v - sc.min) / (sc.max - sc.min);
  const vx = (v: number) => (horizontal ? area.l + scale(v) * pw : area.b - scale(v) * ph);
  for (let v = sc.min; v <= sc.max + 1e-9; v += sc.step) {
    const p = vx(v);
    if (horizontal) svg += `<line x1="${n2(p)}" x2="${n2(p)}" y1="${area.t}" y2="${area.b}" stroke="#e5e5e5"/>` + text(p, area.b + 16, pct ? `${Math.round(v * 100)}%` : fmt(v), 'text-anchor="middle"');
    else svg += `<line x1="${area.l}" x2="${area.r}" y1="${n2(p)}" y2="${n2(p)}" stroke="#e5e5e5"/>` + text(area.l - 6, p + 4, pct ? `${Math.round(v * 100)}%` : fmt(v), 'text-anchor="end"');
  }
  const band = (horizontal ? ph : pw) / nCat;
  spec.categories.forEach((c, i) => { svg += horizontal ? text(area.l - 6, area.t + band * (i + 0.5) + 4, c, 'text-anchor="end"') : text(area.l + band * (i + 0.5), area.b + 16, c, 'text-anchor="middle"'); });
  svg += `<line x1="${area.l}" x2="${area.l}" y1="${area.t}" y2="${area.b}" stroke="#999"/><line x1="${area.l}" x2="${area.r}" y1="${area.b}" y2="${area.b}" stroke="#999"/>`;

  const ns = spec.series.length;
  if (spec.kind === "column" || spec.kind === "bar") {
    const gap = band * 0.2;
    spec.series.forEach((s, si) => s.values.forEach((v, i) => {
      const val = v ?? 0;
      let base = 0;
      if (stacked) for (let k = 0; k < si; k++) base += Math.max(0, spec.series[k].values[i] ?? 0);
      const v0 = base / (pct ? sums[i] || 1 : 1), v1 = (base + Math.max(0, val)) / (pct ? sums[i] || 1 : 1);
      const lo = stacked ? v0 : Math.min(0, val), hi = stacked ? v1 : Math.max(0, val);
      const bw = stacked ? band - gap * 2 : (band - gap * 2) / ns;
      const off = (stacked ? 0 : si * bw) + gap;
      const a = vx(lo), b = vx(hi);
      svg += horizontal
        ? `<rect x="${n2(Math.min(a, b))}" y="${n2(area.t + band * i + off)}" width="${n2(Math.abs(b - a))}" height="${n2(bw)}" fill="${colors(si)}"/>`
        : `<rect x="${n2(area.l + band * i + off)}" y="${n2(Math.min(a, b))}" width="${n2(bw)}" height="${n2(Math.abs(b - a))}" fill="${colors(si)}"/>`;
    }));
  } else {
    spec.series.forEach((s, si) => {
      const pts = s.values.map((v, i) => [area.l + band * (i + 0.5), vx(v ?? 0)] as [number, number]);
      if (spec.kind === "area") svg += `<path d="M${n2(pts[0]?.[0] ?? 0)} ${n2(vx(0))}${pts.map(p => `L${n2(p[0])} ${n2(p[1])}`).join("")}L${n2(pts[pts.length - 1]?.[0] ?? 0)} ${n2(vx(0))}Z" fill="${colors(si)}" fill-opacity=".45" stroke="${colors(si)}"/>`;
      else svg += `<polyline points="${pts.map(p => `${n2(p[0])},${n2(p[1])}`).join(" ")}" fill="none" stroke="${s.lineColor ?? colors(si)}" stroke-width="2.5"/>` + pts.map(p => `<circle cx="${n2(p[0])}" cy="${n2(p[1])}" r="3.5" fill="${colors(si)}"/>`).join("");
    });
  }
  return svg + "</svg>";
}
