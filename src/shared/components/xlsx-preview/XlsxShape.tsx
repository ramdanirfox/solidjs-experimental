/** Render shape DrawingML (SVG untuk geometri, HTML untuk teks) di dalam rect anchor yang sudah ter-zoom. */
import { For, Show, createMemo, type JSX } from "solid-js";
import { presetPaths, type ShapeArrow, type ShapeColor, type ShapeGroup, type ShapeSpec } from "./xlsx-shapes";

const PT_PX = 96 / 72;
const sid = (s: string) => s.replace(/[^\w-]/g, "_");

function ArrowMarker(p: { id: string; a: ShapeArrow; color: string }) {
  const big = p.a.w === "lg" || p.a.len === "lg" ? 1.4 : p.a.w === "sm" || p.a.len === "sm" ? 0.7 : 1;
  const oval = p.a.type === "oval", diamond = p.a.type === "diamond";
  return (
    <marker id={p.id} viewBox="0 0 10 10" refX={oval || diamond ? 5 : 9} refY="5" markerWidth={4 * big} markerHeight={4 * big} orient="auto-start-reverse">
      {oval ? <circle cx="5" cy="5" r="4.5" fill={p.color} /> : diamond ? <path d="M5,0.5L9.5,5L5,9.5L0.5,5Z" fill={p.color} /> : p.a.type === "arrow" || p.a.type === "stealth"
        ? <path d="M0,0L10,5L0,10L3,5Z" fill={p.color} />
        : <path d="M0,0L10,5L0,10Z" fill={p.color} />}
    </marker>
  );
}

function ShapeItem(p: { s: ShapeSpec; w: number; h: number; z: number; id: string }) {
  const s = p.s;
  const bx = () => p.s.rel.x * p.w, by = () => p.s.rel.y * p.h;
  const bw = () => Math.max(0.5, p.s.rel.w * p.w), bh = () => Math.max(0.5, p.s.rel.h * p.h);
  const paths = createMemo(() => presetPaths(s.geom, bw(), bh(), s.adj));
  const col = (c: ShapeColor) => c.hex;
  const gid = `${p.id}-g`, hid = `${p.id}-h`, tid = `${p.id}-t`;
  const fillAttr = () => (!s.fill ? "none" : s.fill.kind === "solid" ? col(s.fill.color) : `url(#${gid})`);
  const fillOp = () => (s.fill?.kind === "solid" ? s.fill.color.a : 1);
  const strokeW = () => (s.stroke ? Math.max(0.5, s.strokeW * p.z) : 0);
  const dash = () => (s.dash ? s.dash.split(" ").map(n => Number(n) * Math.max(1, strokeW())).join(" ") : undefined);

  const text = () => {
    const t = s.text;
    if (!t) return null;
    const [l, tp, r, b] = t.inset.map(v => v * p.z);
    const style: JSX.CSSProperties = {
      position: "absolute", inset: "0", display: "flex", "flex-direction": "column", "box-sizing": "border-box",
      "justify-content": t.anchor === "middle" ? "center" : t.anchor === "bottom" ? "flex-end" : "flex-start",
      padding: `${tp}px ${r}px ${b}px ${l}px`, overflow: t.wrap ? "hidden" : "visible", "line-height": "1.2", "pointer-events": "none",
      "writing-mode": t.vert === "horz" ? undefined : "vertical-rl", transform: t.vert === "vert270" ? "rotate(180deg)" : undefined,
    };
    return (
      <div class="xl-shape-text" style={style}>
        <For each={t.paras}>{para => (
          <div style={{ "text-align": para.align, "white-space": t.wrap ? "pre-wrap" : "pre", "word-break": "break-word", "min-height": `${(para.emptySz ?? 11) * PT_PX * 1.2 * p.z}px` }}>
            <For each={para.runs}>{run => run.br ? <br /> : (
              <span style={{
                "font-size": `${(run.sz ?? 11) * PT_PX * p.z}px`, "font-weight": run.b ? "700" : undefined, "font-style": run.i ? "italic" : undefined,
                "text-decoration": [run.u ? "underline" : "", run.strike ? "line-through" : ""].filter(Boolean).join(" ") || undefined,
                color: run.color ?? "#000", "font-family": run.font && !run.font.startsWith("+") ? `"${run.font}", sans-serif` : undefined,
              }}>{run.t}</span>
            )}</For>
          </div>
        )}</For>
      </div>
    );
  };

  return (
    <div class="xl-shape" style={{ position: "absolute", left: `${bx()}px`, top: `${by()}px`, width: `${bw()}px`, height: `${bh()}px`, transform: s.rot ? `rotate(${s.rot}deg)` : undefined, display: s.hidden ? "none" : undefined }} data-geom={s.geom}>
      <svg width={bw()} height={bh()} viewBox={`0 0 ${bw()} ${bh()}`} style={{ position: "absolute", left: "0", top: "0", overflow: "visible", transform: s.flipH || s.flipV ? `scale(${s.flipH ? -1 : 1}, ${s.flipV ? -1 : 1})` : undefined }}>
        <defs>
          <Show when={s.fill?.kind === "grad" && s.fill}>{f => {
            const g = f() as Extract<NonNullable<ShapeSpec["fill"]>, { kind: "grad" }>;
            return (
              <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0" gradientTransform={`rotate(${g.angle} 0.5 0.5)`}>
                <For each={g.stops}>{st => <stop offset={st.pos} stop-color={col(st.color)} stop-opacity={st.color.a} />}</For>
              </linearGradient>
            );
          }}</Show>
          <Show when={s.stroke && s.head}>{() => <ArrowMarker id={hid} a={s.head!} color={col(s.stroke!)} />}</Show>
          <Show when={s.stroke && s.tail}>{() => <ArrowMarker id={tid} a={s.tail!} color={col(s.stroke!)} />}</Show>
        </defs>
        <For each={paths()}>{part => (
          <path
            d={part.d}
            fill={part.noFill ? "none" : fillAttr()} fill-opacity={fillOp()} fill-rule="evenodd"
            stroke={s.stroke ? col(s.stroke) : "none"} stroke-opacity={s.stroke?.a ?? 1} stroke-width={strokeW()} stroke-dasharray={dash()} stroke-linejoin="round"
            marker-start={s.head && part.noFill ? `url(#${hid})` : undefined}
            marker-end={s.tail && part.noFill ? `url(#${tid})` : undefined}
          />
        )}</For>
      </svg>
      {text()}
    </div>
  );
}

export function XlsxShapeView(p: { group: ShapeGroup; w: number; h: number; zoom: number; uid: string }) {
  return (
    <div class="xl-shape-root" style={{ position: "absolute", inset: "0" }}>
      <For each={p.group.shapes}>{(s, i) => <ShapeItem s={s} w={p.w} h={p.h} z={p.zoom} id={`xs-${sid(p.uid)}-${i()}`} />}</For>
    </div>
  );
}
