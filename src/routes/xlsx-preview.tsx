import { clientOnly } from "@solidjs/start";
import { Title } from "@solidjs/meta";

// Render hanya di sisi client: pembacaan berkas lokal, Blob, canvas, dan ResizeObserver tidak tersedia saat SSR/prerender.
const SJXClientXlsxPreview = clientOnly(() => import("./../components/SJXXlsxPreview"));

export default function PageXlsxPreview() {
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
      </div>
      <SJXClientXlsxPreview height="auto" fallback={<div class="sjx-loading">Memuat komponen XLSX…</div>} />
    </div>
  );
}
