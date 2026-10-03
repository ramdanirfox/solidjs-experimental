import { clientOnly } from "@solidjs/start";
import { Title } from "@solidjs/meta";
import { createSignal } from "solid-js";

// Render hanya di sisi client: contenteditable, Selection API, Blob, ResizeObserver, dan File API tidak tersedia saat SSR/prerender.
const SJXClientPptxEditor = clientOnly(() => import("./../components/SJXPptxEditor"));

export default function PagePptxEditor() {
  const [readonly, setReadonly] = createSignal(false);
  const [locale, setLocale] = createSignal<"id" | "en">("id");
  const [maxHistory, setMaxHistory] = createSignal(100);
  return (
    <div class="sjx-page sjx-page-fill">
      <Title>PPTX Editor</Title>
      <div class="sjx-page-head">
        <div>
          <div class="sjx-page-title">PPTX Editor</div>
          <div class="sjx-page-sub">
            Dirender penuh di browser dengan <code>@office-kit/pptx</code> — buka berkas .pptx lokal, atau coba presentasi contoh.
          </div>
        </div>
        <div style={{ display: "flex", gap: "14px", "align-items": "center", "flex-wrap": "wrap" }}>
          <label class="sjx-switch" title="Contoh penggunaan prop readonly">
            <input type="checkbox" checked={readonly()} onChange={e => setReadonly(e.currentTarget.checked)} />
            <span>Mode baca-saja <code>readonly</code></span>
          </label>
          <label class="sjx-switch" title="Contoh penggunaan prop maxHistory">
            <span>Maks. undo <code>maxHistory</code></span>
            <input type="number" min="1" max="1000" value={maxHistory()} style={{ width: "64px", padding: "2px 6px", border: "1px solid #cbd5e1", "border-radius": "6px" }} onChange={e => setMaxHistory(Math.max(1, +e.currentTarget.value || 1))} />
          </label>
          <label class="sjx-switch" title="Contoh penggunaan prop locale">
            <span>Bahasa <code>locale</code></span>
            <select value={locale()} onChange={e => setLocale(e.currentTarget.value as "id" | "en")} style={{ padding: "2px 6px", border: "1px solid #cbd5e1", "border-radius": "6px" }}>
              <option value="id">Indonesia</option>
              <option value="en">English</option>
            </select>
          </label>
        </div>
      </div>
      <SJXClientPptxEditor height="auto" readonly={readonly()} locale={locale()} onLocaleChange={setLocale} maxHistory={maxHistory()} fallback={<div class="sjx-loading">Memuat komponen PPTX…</div>} />
    </div>
  );
}
