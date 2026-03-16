import { createSignal, For, createMemo, Show, onMount, onCleanup } from "solid-js";

interface ChartData {
  [key: string]: number | string;
  key: string;
}

interface ChartConfig {
  data: ChartData[];
  ref: Record<string, string>;
  ref_color: Record<string, string>;
  total: Record<string, number>;
}

interface SJX3dchartProps {
  config: ChartConfig;
  title?: string;
  percentChange?: number;
  height?: number;
  showDownloadButton?: boolean;
  onDownload?: () => void;
}

interface TooltipData {
  x: number;
  y: number;
  category: string;
  label: string;
  value: number;
  color: string;
  total: number;
}

export default function SJX3dchart(props: SJX3dchartProps) {
  const [hoveredBar, setHoveredBar] = createSignal<string | null>(null);
  const [hoveredCategory, setHoveredCategory] = createSignal<string | null>(null);
  const [tooltip, setTooltip] = createSignal<TooltipData | null>(null);
  const [zoomLevel, setZoomLevel] = createSignal(1);
  let containerRef: HTMLDivElement | undefined;

  const categories = createMemo(() => {
    return Object.keys(props.config.ref);
  });

  const maxValue = createMemo(() => {
    let max = 0;
    props.config.data.forEach((item) => {
      categories().forEach((cat) => {
        const val = item[cat] as number;
        if (val > max) max = val;
      });
    });
    return max;
  });

  const chartHeight = () => props.height || 320;
  const barWidth = () => 55 * zoomLevel();
  const barDepth = () => 12 * zoomLevel();
  const groupGap = () => 25 * zoomLevel();
  const paddingLeft = 60;
  const paddingBottom = 45;
  const paddingTop = 30;
  const paddingRight = 40;

  const chartWidth = createMemo(() => {
    const baseWidth = paddingLeft + props.config.data.length * (barWidth() + groupGap()) + paddingRight;
    return Math.max(baseWidth, 600);
  });

  const getBarHeight = (value: number) => {
    const availableHeight = chartHeight() - paddingBottom - paddingTop;
    return (value / maxValue()) * availableHeight;
  };

  const formatLabel = (key: string) => {
    if (key.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const date = new Date(key);
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
    return key.length > 12 ? key.substring(0, 10) + ".." : key;
  };

  const darkenColor = (hex: string, percent: number) => {
    const num = parseInt(hex.replace("#", ""), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.max((num >> 16) - amt, 0);
    const G = Math.max(((num >> 8) & 0x00ff) - amt, 0);
    const B = Math.max((num & 0x0000ff) - amt, 0);
    return `#${(0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1)}`;
  };

  const lightenColor = (hex: string, percent: number) => {
    const num = parseInt(hex.replace("#", ""), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.min((num >> 16) + amt, 255);
    const G = Math.min(((num >> 8) & 0x00ff) + amt, 255);
    const B = Math.min((num & 0x0000ff) + amt, 255);
    return `#${(0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1)}`;
  };

  const yAxisTicks = createMemo(() => {
    const max = maxValue();
    const step = Math.ceil(max / 5 / 10) * 10;
    const ticks = [];
    for (let i = 0; i <= max; i += step) {
      ticks.push(i);
    }
    return ticks;
  });

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newZoom = Math.max(0.5, Math.min(3, zoomLevel() + delta));
    setZoomLevel(newZoom);
  };

  onMount(() => {
    if (containerRef) {
      containerRef.addEventListener("wheel", handleWheel, { passive: false });
    }
  });

  onCleanup(() => {
    if (containerRef) {
      containerRef.removeEventListener("wheel", handleWheel);
    }
  });

  const gradientDefs = createMemo(() => {
    return categories().map((cat) => {
      const baseColor = props.config.ref_color[cat];
      return {
        id: `gradient-${cat}`,
        baseColor,
        lightColor: lightenColor(baseColor, 20),
        darkColor: darkenColor(baseColor, 25),
      };
    });
  });

  return (
    <div
      style={{
        background: "linear-gradient(180deg, #1e2744 0%, #141b2d 100%)",
        "border-radius": "12px",
        padding: "20px",
        "font-family": "'Inter', 'Segoe UI', sans-serif",
        color: "#fff",
        width: "100%",
        "box-sizing": "border-box",
        position: "relative",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          "justify-content": "space-between",
          "align-items": "center",
          "margin-bottom": "16px",
        }}
      >
        <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
          <h2
            style={{
              margin: "0",
              "font-size": "18px",
              "font-weight": "600",
              color: "#fff",
            }}
          >
            {props.title || "Distribution Trend"}
          </h2>
          <Show when={props.percentChange !== undefined}>
            <span
              style={{
                background: props.percentChange! >= 0 ? "#0e4a3a" : "#4a1e1e",
                color: props.percentChange! >= 0 ? "#4ade80" : "#f87171",
                padding: "4px 12px",
                "border-radius": "6px",
                "font-size": "13px",
                "font-weight": "500",
                display: "flex",
                "align-items": "center",
                gap: "4px",
              }}
            >
              {props.percentChange}%
              <span style={{ "font-size": "14px", "margin-left": "2px" }}>
                {props.percentChange! >= 0 ? "↗" : "↘"}
              </span>
            </span>
          </Show>
        </div>
        <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
          <div
            style={{
              "font-size": "11px",
              color: "#6b7280",
              background: "#1a2236",
              padding: "4px 8px",
              "border-radius": "4px",
            }}
          >
            Zoom: {Math.round(zoomLevel() * 100)}%
          </div>
          <Show when={props.showDownloadButton}>
            <button
              onClick={props.onDownload}
              style={{
                background: "#2a3552",
                border: "none",
                "border-radius": "8px",
                padding: "10px 12px",
                cursor: "pointer",
                color: "#9ca3af",
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                transition: "background 0.2s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#3a4562")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#2a3552")}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
          </Show>
        </div>
      </div>

      {/* Chart Container */}
      <div
        ref={containerRef}
        style={{
          overflow: "auto",
          cursor: "grab",
          "padding-bottom": "10px",
        }}
      >
        <svg
          width={chartWidth()}
          height={chartHeight()}
          style={{ display: "block" }}
        >
          {/* Gradient Definitions */}
          <defs>
            <For each={gradientDefs()}>
              {(grad) => (
                <>
                  <linearGradient id={grad.id} x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color={grad.darkColor} />
                    <stop offset="25%" stop-color={grad.baseColor} />
                    <stop offset="50%" stop-color={grad.lightColor} />
                    <stop offset="75%" stop-color={grad.baseColor} />
                    <stop offset="100%" stop-color={grad.darkColor} />
                  </linearGradient>
                  <linearGradient id={`${grad.id}-top`} x1="0%" y1="100%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color={grad.lightColor} />
                    <stop offset="100%" stop-color={lightenColor(grad.lightColor, 15)} />
                  </linearGradient>
                  <linearGradient id={`${grad.id}-right`} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color={grad.baseColor} />
                    <stop offset="100%" stop-color={grad.darkColor} />
                  </linearGradient>
                </>
              )}
            </For>
          </defs>

          {/* Y-axis grid lines and labels */}
          <For each={yAxisTicks()}>
            {(tick) => {
              const y = chartHeight() - paddingBottom - getBarHeight(tick);
              return (
                <>
                  <line
                    x1={paddingLeft - 10}
                    y1={y}
                    x2={chartWidth() - 20}
                    y2={y}
                    stroke="#2a3552"
                    stroke-width="1"
                  />
                  <text
                    x={paddingLeft - 15}
                    y={y + 4}
                    fill="#6b7280"
                    font-size="11"
                    text-anchor="end"
                  >
                    {tick}
                  </text>
                </>
              );
            }}
          </For>

          {/* Base line */}
          <line
            x1={paddingLeft - 10}
            y1={chartHeight() - paddingBottom}
            x2={chartWidth() - 20}
            y2={chartHeight() - paddingBottom}
            stroke="#3a4562"
            stroke-width="2"
          />

          {/* Bars */}
          <For each={props.config.data}>
            {(item, dataIndex) => {
              const baseX = paddingLeft + dataIndex() * (barWidth() + groupGap());
              const baseY = chartHeight() - paddingBottom;

              return (
                <g>
                  {/* Stacked 3D bars */}
                  <For each={categories()}>
                    {(cat, catIndex) => {
                      const value = item[cat] as number;
                      const prevValue = catIndex() > 0 ? (item[categories()[catIndex() - 1]] as number) : 0;
                      const segmentValue = value - prevValue;
                      const barHeight = getBarHeight(segmentValue);
                      const startY = baseY - getBarHeight(prevValue);
                      const color = props.config.ref_color[cat];
                      const isHovered = hoveredBar() === `${dataIndex()}-${cat}`;
                      const bw = barWidth();
                      const bd = barDepth();

                      const frontTopY = startY - barHeight;
                      const frontTopRight = { x: baseX + bw, y: frontTopY };
                      const frontBottomRight = { x: baseX + bw, y: startY };
                      const backTopRight = { x: baseX + bw + bd * 0.7, y: frontTopY - bd * 0.7 };
                      const backBottomRight = { x: baseX + bw + bd * 0.7, y: startY - bd * 0.7 };

                      return (
                        <g
                          onMouseEnter={() => {
                            setHoveredBar(`${dataIndex()}-${cat}`);
                            setTooltip({
                              x: baseX + bw / 2,
                              y: frontTopY - 10,
                              category: cat,
                              label: props.config.ref[cat],
                              value: segmentValue,
                              color: color,
                              total: value,
                            });
                          }}
                          onMouseLeave={() => {
                            setHoveredBar(null);
                            setTooltip(null);
                          }}
                          style={{ cursor: "pointer" }}
                        >
                          {/* Front face */}
                          <rect
                            x={baseX}
                            y={frontTopY}
                            width={bw}
                            height={barHeight}
                            fill={`url(#gradient-${cat})`}
                            opacity={isHovered ? 1 : 0.95}
                            rx="2"
                            ry="2"
                          />

                          {/* Top face (ellipse) */}
                          <ellipse
                            cx={baseX + bw / 2 + bd * 0.35}
                            cy={frontTopY - bd * 0.35}
                            rx={bw / 2 + bd * 0.2}
                            ry={bd * 0.5}
                            fill={`url(#gradient-${cat}-top)`}
                            opacity={isHovered ? 1 : 0.95}
                          />

                          {/* Right face */}
                          <polygon
                            points={`
                              ${frontTopRight.x},${frontTopRight.y}
                              ${frontBottomRight.x},${frontBottomRight.y}
                              ${backBottomRight.x},${backBottomRight.y}
                              ${backTopRight.x},${backTopRight.y}
                            `}
                            fill={`url(#gradient-${cat}-right)`}
                            opacity={isHovered ? 0.9 : 0.8}
                          />

                          {/* Hover overlay */}
                          <Show when={isHovered}>
                            <rect
                              x={baseX}
                              y={frontTopY}
                              width={bw}
                              height={barHeight}
                              fill="white"
                              opacity="0.1"
                              rx="2"
                              ry="2"
                            />
                          </Show>
                        </g>
                      );
                    }}
                  </For>

                  {/* X-axis label - horizontal */}
                  <text
                    x={baseX + barWidth() / 2}
                    y={baseY + 18}
                    fill="#9ca3af"
                    font-size="11"
                    text-anchor="middle"
                    font-weight="500"
                  >
                    {formatLabel(item.key)}
                  </text>
                </g>
              );
            }}
          </For>

          {/* Tooltip */}
          <Show when={tooltip()}>
            {(t) => {
              const data = t();
              const tooltipWidth = 140;
              const tooltipHeight = 70;
              let tooltipX = data.x - tooltipWidth / 2;
              const tooltipY = Math.max(10, data.y - tooltipHeight - 15);

              if (tooltipX < 10) tooltipX = 10;
              if (tooltipX + tooltipWidth > chartWidth() - 10) {
                tooltipX = chartWidth() - tooltipWidth - 10;
              }

              return (
                <g>
                  <polygon
                    points={`
                      ${data.x - 6},${tooltipY + tooltipHeight}
                      ${data.x + 6},${tooltipY + tooltipHeight}
                      ${data.x},${tooltipY + tooltipHeight + 8}
                    `}
                    fill="#1e2744"
                    stroke={data.color}
                    stroke-width="1"
                  />
                  <rect
                    x={tooltipX}
                    y={tooltipY}
                    width={tooltipWidth}
                    height={tooltipHeight}
                    rx="8"
                    fill="#1e2744"
                    stroke={data.color}
                    stroke-width="2"
                  />
                  <circle cx={tooltipX + 15} cy={tooltipY + 20} r="6" fill={data.color} />
                  <text x={tooltipX + 28} y={tooltipY + 24} fill="#fff" font-size="12" font-weight="600">
                    {data.label}
                  </text>
                  <text x={tooltipX + 15} y={tooltipY + 45} fill="#9ca3af" font-size="11">
                    Value:
                  </text>
                  <text x={tooltipX + 55} y={tooltipY + 45} fill={data.color} font-size="13" font-weight="bold">
                    {data.value}
                  </text>
                  <text x={tooltipX + 15} y={tooltipY + 60} fill="#9ca3af" font-size="11">
                    Cumulative:
                  </text>
                  <text x={tooltipX + 80} y={tooltipY + 60} fill="#fff" font-size="12" font-weight="500">
                    {data.total}
                  </text>
                </g>
              );
            }}
          </Show>
        </svg>
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          "flex-wrap": "wrap",
          "justify-content": "center",
          gap: "24px",
          "margin-top": "16px",
          "padding-top": "16px",
          "border-top": "1px solid #2a3552",
        }}
      >
        <For each={categories()}>
          {(cat) => (
            <div
              style={{
                display: "flex",
                "align-items": "center",
                gap: "8px",
                cursor: "pointer",
                opacity: hoveredCategory() && hoveredCategory() !== cat ? 0.4 : 1,
                transition: "opacity 0.2s",
              }}
              onMouseEnter={() => setHoveredCategory(cat)}
              onMouseLeave={() => setHoveredCategory(null)}
            >
              <div
                style={{
                  width: "12px",
                  height: "12px",
                  "border-radius": "50%",
                  background: props.config.ref_color[cat],
                  "box-shadow": `0 0 6px ${props.config.ref_color[cat]}50`,
                }}
              />
              <span style={{ color: "#d1d5db", "font-size": "13px" }}>
                {props.config.ref[cat]}
              </span>
            </div>
          )}
        </For>
      </div>

      {/* Scroll hint */}
      <div
        style={{
          "text-align": "center",
          "margin-top": "8px",
          "font-size": "10px",
          color: "#4b5563",
        }}
      >
        Scroll to zoom
      </div>
    </div>
  );
}
