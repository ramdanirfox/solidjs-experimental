import { clientOnly } from "@solidjs/start";
import { Title } from "@solidjs/meta";
import { createSignal } from "solid-js";

// Render hanya di sisi client: pembacaan berkas lokal, Blob, canvas, dan ResizeObserver tidak tersedia saat SSR/prerender.
const SJXClientXlsxPreview = clientOnly(() => import("./../components/SJXXlsxPreview"));

export default function PageXlsxPreview() {
  const [readonly, setReadonly] = createSignal(false);
  return (
    <div class="sjx-page sjx-page-fill">
      <Title>XLSX / XLSM Preview</Title>
      <div class="sjx-page-head">
        <div>
          <div class="sjx-page-title">XLSX / XLSM Preview</div>
          <div class="sjx-page-sub">
            Dirender penuh di browser dengan <code>@office-kit/xlsx</code> — buka berkas lokal, atau coba workbook contoh.
          </div>
        </div>
        <label class="sjx-switch" title="Contoh penggunaan prop readonly">
          <input type="checkbox" checked={readonly()} onChange={e => setReadonly(e.currentTarget.checked)} />
          <span>Mode baca-saja <code>readonly</code></span>
        </label>
      </div>
      <SJXClientXlsxPreview height="auto" readonly={readonly()} fallback={<div class="sjx-loading">Memuat komponen XLSX…</div>} />
    </div>
  );
}
