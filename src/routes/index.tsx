import { A } from "@solidjs/router";
import { Title } from "@solidjs/meta";
import { For, Show } from "solid-js";

interface IExample {
  route: string;
  title: string;
  desc: string;
  tags: string[];
  gradient: string;
  icon: string;
  featured?: boolean;
}

const EXAMPLES: IExample[] = [
  {
    route: "xlsx-preview",
    title: "XLSX / XLSM Preview",
    desc: "Grid Excel lengkap yang dirender di browser dari OOXML: style asli, freeze panes, hidden row/kolom, merge, gambar mengambang, autofilter, evaluasi formula, pencarian lintas sheet, edit, dan ekspor XLSX/CSV.",
    tags: ["@office-kit/xlsx", "client-only", "OOXML", "formula", "XLSM"],
    gradient: "linear-gradient(135deg, #059669, #10b981)",
    icon: "M3 3h18v18H3z M3 9h18 M3 15h18 M9 3v18 M15 3v18",
    featured: true,
  },
  { route: "golden-layout", title: "Golden Layout", desc: "Tata letak panel multi-window yang dapat diseret, dengan komponen Solid di dalam tiap panel.", tags: ["golden-layout", "dockview"], gradient: "linear-gradient(135deg, #6366f1, #8b5cf6)", icon: "M3 3h8v8H3z M13 3h8v5h-8z M13 10h8v11h-8z M3 13h8v8H3z" },
  { route: "svar", title: "Svar Gantt", desc: "Mounting komponen React (wx-react-gantt) di dalam aplikasi SolidJS lewat jembatan.", tags: ["react-solid-bridge", "gantt"], gradient: "linear-gradient(135deg, #0ea5e9, #6366f1)", icon: "M4 6h10 M8 12h12 M6 18h9" },
  { route: "aggrid", title: "Legacy AG Grid", desc: "Tabel data AG Grid 28 dengan solid-ag-grid: sorting, filter, dan pengeditan.", tags: ["ag-grid", "table"], gradient: "linear-gradient(135deg, #f59e0b, #ef4444)", icon: "M3 4h18v16H3z M3 10h18 M9 4v16" },
  { route: "solid-google-maps", title: "Solid Google Maps", desc: "Google Maps dengan overlay DeckGL dan Terra Draw untuk menggambar fitur.", tags: ["google-maps", "deck.gl"], gradient: "linear-gradient(135deg, #14b8a6, #3b82f6)", icon: "M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" },
  { route: "chart-3d", title: "Sample 3D Chart", desc: "Grafik tiga dimensi interaktif (dibuat bersama vibes).", tags: ["3d", "chart"], gradient: "linear-gradient(135deg, #ec4899, #8b5cf6)", icon: "M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z M12 12l8-4.5 M12 12v9 M12 12L4 7.5" },
  { route: "globe-maplibre", title: "Globe MapLibre", desc: "Peta globe 3D dengan MapLibre GL, label negara lokal, dan interaksi hover.", tags: ["maplibre", "globe"], gradient: "linear-gradient(135deg, #2563eb, #06b6d4)", icon: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3 12h18 M12 3c2.5 2.7 3.8 5.7 3.8 9S14.5 18.3 12 21c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" },
];

export default function Home() {
  const featured = () => EXAMPLES.filter(e => e.featured);
  const others = () => EXAMPLES.filter(e => !e.featured);

  const Card = (p: { e: IExample }) => (
    <A href={`/${p.e.route}`} class="sjx-card" classList={{ featured: !!p.e.featured }} style={{ "--g": p.e.gradient }}>
      <span class="sjx-card-ico">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d={p.e.icon} /></svg>
      </span>
      <div style={{ flex: "1" }}>
        <div class="sjx-card-title">
          {p.e.title}
          <Show when={p.e.featured}><span class="sjx-badge">Baru</span></Show>
        </div>
        <div class="sjx-card-desc" style={{ "margin-top": "6px" }}>{p.e.desc}</div>
        <div class="sjx-tags" style={{ "margin-top": "10px" }}>
          <For each={p.e.tags}>{t => <span class="sjx-tag">{t}</span>}</For>
        </div>
      </div>
    </A>
  );

  return (
    <div class="sjx-home">
      <Title>SolidStart — Experimental</Title>
      <section class="sjx-hero">
        <span class="sjx-eyebrow">SolidStart · Playground</span>
        <h1 class="sjx-hero-title">Eksperimen komponen untuk SolidJS</h1>
        <p class="sjx-hero-sub">
          Kumpulan contoh komponen kompleks — peta, grafik, gantt, tata letak panel, hingga preview dokumen Excel —
          yang dirender di sisi client dan siap dipakai ulang.
        </p>
        <div class="sjx-hero-actions">
          <A href="/xlsx-preview" class="sjx-cta">Coba XLSX Preview →</A>
          <A href="/golden-layout" class="sjx-cta ghost">Golden Layout</A>
        </div>
      </section>

      <div class="sjx-grid">
        <For each={featured()}>{e => <Card e={e} />}</For>
      </div>

      <div class="sjx-section-title">Contoh lainnya</div>
      <div class="sjx-grid">
        <For each={others()}>{e => <Card e={e} />}</For>
      </div>
    </div>
  );
}
