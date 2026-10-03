/**
 * Geometri bentuk: preset OOXML (±60 token umum) dan custom geometry → path SVG pada ruang koordinat bentuk (w × h, px).
 * Preset yang tidak dikenal jatuh ke persegi panjang dan dilaporkan lewat `known === false`.
 */
import type { CustomGeometry } from "@office-kit/pptx";

export interface GeomResult { d: string; known: boolean; /** true bila bentuk hanya garis (tanpa isi) */ open?: boolean }

const f = (n: number) => Math.round(n * 100) / 100;
const adj = (a: Record<string, number>, k: string, def: number) => (a[k] !== undefined ? a[k] : def) / 100000;

function polygon(pts: [number, number][]): string { return pts.map((p, i) => `${i ? "L" : "M"}${f(p[0])} ${f(p[1])}`).join(" ") + " Z"; }
function regular(n: number, w: number, h: number, rot = -Math.PI / 2): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) { const a = rot + (i * 2 * Math.PI) / n; pts.push([w / 2 + (w / 2) * Math.cos(a), h / 2 + (h / 2) * Math.sin(a)]); }
  return polygon(pts);
}
function star(n: number, w: number, h: number, inner: number): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 === 0 ? 1 : inner;
    pts.push([w / 2 + (w / 2) * r * Math.cos(a), h / 2 + (h / 2) * r * Math.sin(a)]);
  }
  return polygon(pts);
}
const ellipse = (w: number, h: number) => `M0 ${f(h / 2)} A${f(w / 2)} ${f(h / 2)} 0 1 0 ${f(w)} ${f(h / 2)} A${f(w / 2)} ${f(h / 2)} 0 1 0 0 ${f(h / 2)} Z`;

export function presetPath(prst: string | null, w: number, h: number, a: Record<string, number> = {}): GeomResult {
  const ok = (d: string, open = false): GeomResult => ({ d, known: true, open });
  switch (prst) {
    case null: case "rect": case "flowChartProcess": case "snipRoundRect": return ok(`M0 0H${f(w)}V${f(h)}H0Z`);
    case "roundRect": { const r = Math.min(w, h) * adj(a, "adj", 16667); return ok(`M${f(r)} 0H${f(w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)}V${f(h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(h)}H${f(r)}A${f(r)} ${f(r)} 0 0 1 0 ${f(h - r)}V${f(r)}A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0Z`); }
    case "ellipse": case "flowChartConnector": return ok(ellipse(w, h));
    case "triangle": { const x = w * adj(a, "adj", 50000); return ok(polygon([[x, 0], [w, h], [0, h]])); }
    case "rtTriangle": return ok(polygon([[0, 0], [w, h], [0, h]]));
    case "diamond": case "flowChartDecision": return ok(polygon([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]));
    case "parallelogram": { const o = Math.min(w, h) * adj(a, "adj", 25000) * (w / Math.min(w, h)); return ok(polygon([[o, 0], [w, 0], [w - o, h], [0, h]])); }
    case "trapezoid": { const o = Math.min(w, h) * adj(a, "adj", 25000); return ok(polygon([[o, 0], [w - o, 0], [w, h], [0, h]])); }
    case "pentagon": return ok(regular(5, w, h));
    case "hexagon": { const o = Math.min(w, h) * adj(a, "adj", 25000); return ok(polygon([[o, 0], [w - o, 0], [w, h / 2], [w - o, h], [o, h], [0, h / 2]])); }
    case "heptagon": return ok(regular(7, w, h));
    case "octagon": { const o = Math.min(w, h) * adj(a, "adj", 29289); return ok(polygon([[o, 0], [w - o, 0], [w, o], [w, h - o], [w - o, h], [o, h], [0, h - o], [0, o]])); }
    case "decagon": return ok(regular(10, w, h));
    case "dodecagon": return ok(regular(12, w, h));
    case "star4": return ok(star(4, w, h, 0.38));
    case "star5": return ok(star(5, w, h, 0.382));
    case "star6": return ok(star(6, w, h, 0.58));
    case "star7": return ok(star(7, w, h, 0.5));
    case "star8": return ok(star(8, w, h, 0.62));
    case "star10": return ok(star(10, w, h, 0.7));
    case "star12": return ok(star(12, w, h, 0.77));
    case "star16": return ok(star(16, w, h, 0.85));
    case "star24": return ok(star(24, w, h, 0.9));
    case "star32": return ok(star(32, w, h, 0.93));
    case "rightArrow": case "leftArrow": {
      const sh = adj(a, "adj1", 50000), hd = Math.min(w, h) * adj(a, "adj2", 50000);
      const y1 = (h * (1 - sh)) / 2, y2 = h - y1;
      const pts: [number, number][] = [[0, y1], [w - hd, y1], [w - hd, 0], [w, h / 2], [w - hd, h], [w - hd, y2], [0, y2]];
      return ok(polygon(prst === "leftArrow" ? pts.map(([x, y]) => [w - x, y] as [number, number]) : pts));
    }
    case "upArrow": case "downArrow": {
      const sh = adj(a, "adj1", 50000), hd = Math.min(w, h) * adj(a, "adj2", 50000);
      const x1 = (w * (1 - sh)) / 2, x2 = w - x1;
      const pts: [number, number][] = [[x1, h], [x1, hd], [0, hd], [w / 2, 0], [w, hd], [x2, hd], [x2, h]];
      return ok(polygon(prst === "downArrow" ? pts.map(([x, y]) => [x, h - y] as [number, number]) : pts));
    }
    case "leftRightArrow": { const hd = Math.min(w, h) * 0.5, y1 = h * 0.25, y2 = h * 0.75; return ok(polygon([[0, h / 2], [hd, 0], [hd, y1], [w - hd, y1], [w - hd, 0], [w, h / 2], [w - hd, h], [w - hd, y2], [hd, y2], [hd, h]])); }
    case "upDownArrow": { const hd = Math.min(w, h) * 0.5, x1 = w * 0.25, x2 = w * 0.75; return ok(polygon([[w / 2, 0], [w, hd], [x2, hd], [x2, h - hd], [w, h - hd], [w / 2, h], [0, h - hd], [x1, h - hd], [x1, hd], [0, hd]])); }
    case "homePlate": { const o = Math.min(w, h) * adj(a, "adj", 50000); return ok(polygon([[0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h]])); }
    case "chevron": { const o = Math.min(w, h) * adj(a, "adj", 50000); return ok(polygon([[0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h], [o, h / 2]])); }
    case "plus": case "cross": case "mathPlus": { const t = Math.min(w, h) * (prst === "mathPlus" ? 0.22 : adj(a, "adj", 25000)); const x1 = (w - (prst === "plus" || prst === "cross" ? w - 2 * t : t * 2)) / 2; void x1; const a1 = prst === "mathPlus" ? (w - t * 2) / 2 : t, a2 = prst === "mathPlus" ? (h - t * 2) / 2 : t; return ok(polygon([[a1, 0], [w - a1, 0], [w - a1, a2], [w, a2], [w, h - a2], [w - a1, h - a2], [w - a1, h], [a1, h], [a1, h - a2], [0, h - a2], [0, a2], [a1, a2]])); }
    case "mathMinus": { const t = h * 0.22; return ok(`M0 ${f(h / 2 - t)}H${f(w)}V${f(h / 2 + t)}H0Z`); }
    case "mathEqual": { const t = h * 0.14, g = h * 0.12; return ok(`M0 ${f(h / 2 - g - t)}H${f(w)}V${f(h / 2 - g)}H0Z M0 ${f(h / 2 + g)}H${f(w)}V${f(h / 2 + g + t)}H0Z`); }
    case "mathMultiply": { const o = Math.min(w, h) * 0.13; return ok(polygon([[o, 0], [w / 2, h / 2 - o], [w - o, 0], [w, o], [w / 2 + o, h / 2], [w, h - o], [w - o, h], [w / 2, h / 2 + o], [o, h], [0, h - o], [w / 2 - o, h / 2], [0, o]])); }
    case "mathDivide": { const t = h * 0.1, r = Math.min(w, h) * 0.1; return ok(`M0 ${f(h / 2 - t)}H${f(w)}V${f(h / 2 + t)}H0Z M${f(w / 2 + r)} ${f(h * 0.2)}A${f(r)} ${f(r)} 0 1 0 ${f(w / 2 - r)} ${f(h * 0.2)}A${f(r)} ${f(r)} 0 1 0 ${f(w / 2 + r)} ${f(h * 0.2)}Z M${f(w / 2 + r)} ${f(h * 0.8)}A${f(r)} ${f(r)} 0 1 0 ${f(w / 2 - r)} ${f(h * 0.8)}A${f(r)} ${f(r)} 0 1 0 ${f(w / 2 + r)} ${f(h * 0.8)}Z`); }
    case "heart": return ok(`M${f(w / 2)} ${f(h)}C${f(-w * 0.2)} ${f(h * 0.45)} ${f(w * 0.15)} ${f(-h * 0.1)} ${f(w / 2)} ${f(h * 0.28)}C${f(w * 0.85)} ${f(-h * 0.1)} ${f(w * 1.2)} ${f(h * 0.45)} ${f(w / 2)} ${f(h)}Z`);
    case "lightningBolt": return ok(polygon([[w * 0.38, 0], [w * 0.1, h * 0.5], [w * 0.4, h * 0.5], [w * 0.22, h], [w * 0.88, h * 0.38], [w * 0.55, h * 0.38], [w * 0.8, 0]]));
    case "moon": return ok(`M${f(w * 0.75)} 0A${f(w * 0.75)} ${f(h / 2)} 0 0 0 ${f(w * 0.75)} ${f(h)}A${f(w * 0.45)} ${f(h * 0.5)} 0 0 1 ${f(w * 0.75)} 0Z`);
    case "sun": return ok(star(12, w, h, 0.7));
    case "cloud": return ok(`M${f(w * 0.25)} ${f(h * 0.8)}A${f(w * 0.2)} ${f(h * 0.25)} 0 1 1 ${f(w * 0.32)} ${f(h * 0.38)}A${f(w * 0.2)} ${f(h * 0.22)} 0 0 1 ${f(w * 0.62)} ${f(h * 0.25)}A${f(w * 0.18)} ${f(h * 0.2)} 0 0 1 ${f(w * 0.85)} ${f(h * 0.45)}A${f(w * 0.17)} ${f(h * 0.25)} 0 0 1 ${f(w * 0.78)} ${f(h * 0.8)}Z`);
    case "donut": { const r = Math.min(w, h) * adj(a, "adj", 25000); return ok(ellipse(w, h) + ` M${f(r)} ${f(h / 2)} A${f(w / 2 - r)} ${f(h / 2 - r)} 0 1 1 ${f(w - r)} ${f(h / 2)} A${f(w / 2 - r)} ${f(h / 2 - r)} 0 1 1 ${f(r)} ${f(h / 2)} Z`); }
    case "can": { const e = h * adj(a, "adj", 25000) / 2; return ok(`M0 ${f(e)}A${f(w / 2)} ${f(e)} 0 0 1 ${f(w)} ${f(e)}V${f(h - e)}A${f(w / 2)} ${f(e)} 0 0 1 0 ${f(h - e)}Z M0 ${f(e)}A${f(w / 2)} ${f(e)} 0 0 0 ${f(w)} ${f(e)}`); }
    case "cube": { const d = Math.min(w, h) * adj(a, "adj", 25000); return ok(polygon([[0, d], [d, 0], [w, 0], [w, h - d], [w - d, h], [0, h]]) + ` M0 ${f(d)}H${f(w - d)}V${f(h)} M${f(w - d)} ${f(d)}L${f(w)} 0`); }
    case "leftBracket": return ok(`M${f(w)} 0H${f(w * 0.2)}V${f(h)}H${f(w)}`, true);
    case "rightBracket": return ok(`M0 0H${f(w * 0.8)}V${f(h)}H0`, true);
    case "leftBrace": return ok(`M${f(w)} 0Q${f(w * 0.4)} 0 ${f(w * 0.4)} ${f(h * 0.2)}V${f(h * 0.4)}Q${f(w * 0.4)} ${f(h / 2)} 0 ${f(h / 2)}Q${f(w * 0.4)} ${f(h / 2)} ${f(w * 0.4)} ${f(h * 0.6)}V${f(h * 0.8)}Q${f(w * 0.4)} ${f(h)} ${f(w)} ${f(h)}`, true);
    case "rightBrace": return ok(`M0 0Q${f(w * 0.6)} 0 ${f(w * 0.6)} ${f(h * 0.2)}V${f(h * 0.4)}Q${f(w * 0.6)} ${f(h / 2)} ${f(w)} ${f(h / 2)}Q${f(w * 0.6)} ${f(h / 2)} ${f(w * 0.6)} ${f(h * 0.6)}V${f(h * 0.8)}Q${f(w * 0.6)} ${f(h)} 0 ${f(h)}`, true);
    case "noSmoking": return ok(ellipse(w, h) + ` M${f(w * 0.15)} ${f(h * 0.15)}L${f(w * 0.85)} ${f(h * 0.85)}`);
    case "line": case "straightConnector1": case "bentConnector3": case "curvedConnector3": return ok(`M0 0L${f(w)} ${f(h)}`, true);
    default: return { d: `M0 0H${f(w)}V${f(h)}H0Z`, known: false };
  }
}

/** Custom geometry (`a:custGeom`) → path SVG, diskalakan dari ruang path ke ukuran bentuk. */
export function customPath(g: CustomGeometry, w: number, h: number): GeomResult {
  const parts: string[] = [];
  let open = true;
  for (const p of g.paths) {
    const sx = p.w ? w / p.w : 1, sy = p.h ? h / p.h : 1;
    let cur = { x: 0, y: 0 };
    let d = "";
    for (const c of p.commands) {
      switch (c.kind) {
        case "moveTo": cur = { x: c.pt.x * sx, y: c.pt.y * sy }; d += `M${f(cur.x)} ${f(cur.y)}`; break;
        case "lnTo": cur = { x: c.pt.x * sx, y: c.pt.y * sy }; d += `L${f(cur.x)} ${f(cur.y)}`; break;
        case "quadBezTo": d += `Q${f(c.pts[0].x * sx)} ${f(c.pts[0].y * sy)} ${f(c.pts[1].x * sx)} ${f(c.pts[1].y * sy)}`; cur = { x: c.pts[1].x * sx, y: c.pts[1].y * sy }; break;
        case "cubicBezTo": d += `C${f(c.pts[0].x * sx)} ${f(c.pts[0].y * sy)} ${f(c.pts[1].x * sx)} ${f(c.pts[1].y * sy)} ${f(c.pts[2].x * sx)} ${f(c.pts[2].y * sy)}`; cur = { x: c.pts[2].x * sx, y: c.pts[2].y * sy }; break;
        case "arcTo": {
          const st = (c.stAng / 60000) * (Math.PI / 180), sw = (c.swAng / 60000) * (Math.PI / 180);
          const wr = c.wR * sx, hr = c.hR * sy;
          const cx = cur.x - wr * Math.cos(st), cy = cur.y - hr * Math.sin(st);
          const ex = cx + wr * Math.cos(st + sw), ey = cy + hr * Math.sin(st + sw);
          d += `A${f(wr)} ${f(hr)} 0 ${Math.abs(sw) > Math.PI ? 1 : 0} ${sw > 0 ? 1 : 0} ${f(ex)} ${f(ey)}`;
          cur = { x: ex, y: ey };
          break;
        }
        case "close": d += "Z"; break;
      }
    }
    if (p.fill !== "none") open = false;
    parts.push(d);
  }
  return { d: parts.join(" "), known: true, open };
}
