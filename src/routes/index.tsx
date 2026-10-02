import { A, useSearchParams } from "@solidjs/router";
import { Title } from "@solidjs/meta";
import { For, Show } from "solid-js";
import { EXAMPLES, searchExamples, type IExample } from "../shared/constants/examples";

export default function Home() {
  const [params, setParams] = useSearchParams();
  const q = () => (typeof params.q === "string" ? params.q : "");
  const found = () => searchExamples(q()).map(h => h.example);
  const featured = () => found().filter(e => e.featured);
  const others = () => found().filter(e => !e.featured);

  const Card = (p: { e: IExample }) => (
    <A href={`/${p.e.route}`} class="sjx-card" classList={{ featured: !!p.e.featured }} style={{ "--g": p.e.gradient }}>
      <span class="sjx-card-ico">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d={p.e.icon} /></svg>
      </span>
      <div style={{ flex: "1" }}>
        <div class="sjx-card-title">
          {p.e.title}
          <Show when={p.e.badge}><span class="sjx-badge">{p.e.badge}</span></Show>
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
          Kumpulan contoh komponen kompleks — peta, grafik, gantt, tata letak panel, hingga editor dokumen Word dan preview Excel —
          yang dirender di sisi client dan siap dipakai ulang.
        </p>
        <div class="sjx-hero-actions">
          <A href="/docx-editor" class="sjx-cta">Coba DOCX Editor →</A>
          <A href="/xlsx-preview" class="sjx-cta ghost">XLSX Preview</A>
        </div>
      </section>

      <Show when={q()}>
        <div class="sjx-section-title" style={{ display: "flex", "align-items": "center", gap: "10px", "flex-wrap": "wrap" }}>
          <span>{found().length} hasil untuk “{q()}”</span>
          <button class="sjx-clear" onClick={() => setParams({ q: undefined })}>Hapus pencarian</button>
        </div>
        <Show when={!found().length}><div class="sjx-card-desc">Tidak ada contoh yang cocok. Coba kata kunci lain, misalnya “peta”, “tabel”, atau “word”.</div></Show>
      </Show>

      <div class="sjx-grid">
        <For each={featured()}>{e => <Card e={e} />}</For>
      </div>

      <Show when={others().length}>
        <div class="sjx-section-title">{q() ? "Contoh lainnya yang cocok" : "Contoh lainnya"}</div>
        <div class="sjx-grid">
          <For each={others()}>{e => <Card e={e} />}</For>
        </div>
      </Show>
    </div>
  );
}
