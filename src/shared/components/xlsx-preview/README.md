# XLSX / XLSM Preview

Preview workbook Excel yang dirender **sepenuhnya di browser** dengan [`@office-kit/xlsx`](https://office-kit.github.io/xlsx/).
Komponen ini client-only (memakai Blob, canvas, ResizeObserver, File API) — daftarkan lewat `clientOnly` pada route:

```tsx
const SJXClientXlsxPreview = clientOnly(() => import("~/components/SJXXlsxPreview"));
<SJXClientXlsxPreview height="auto" />          // workbook contoh
<SJXClientXlsxPreview src="/files/laporan.xlsm" /> // atau muat dari URL
```

Props: `src?: string`, `sample?: boolean` (default `true`), `height?: string`, `class?: string`.

## Struktur

| File | Peran |
| --- | --- |
| `XlsxPreview.tsx` | Komponen utama: toolbar, formula bar, tab sheet, status bar, panel Cari/Info/Log, dialog Evaluasi & Debug |
| `XlsxGrid.tsx` | Grid tervirtualisasi (4 pane untuk freeze panes, header, seleksi, editor, gambar, tombol filter) |
| `xlsx-model.ts` | `XlsxBook`: fasad atas workbook (teks tampilan, edit + undo, filter, merge, gambar, CSV, simpan, pencarian, laporan log) |
| `xlsx-style.ts` | Resolusi style OOXML (font/fill/border/alignment, warna tema + tint) |
| `xlsx-layout.ts` | Lebar kolom / tinggi baris / hidden / freeze / posisi gambar (px) |
| `xlsx-formula.ts` | Parser + evaluator formula (±130 fungsi), deteksi siklus, mode trace |
| `xlsx-cf.ts` | Conditional formatting (cellIs, expression, teks, top-N, color scale, data bar, …) |
| `xlsx-sample.ts` | Workbook contoh yang dibangun dengan library |

## Catatan perilaku

- **Style** dibaca dari `styles.xml` + `theme1.xml`; baris tanpa tinggi eksplisit menyesuaikan ukuran font.
- **Formula**: default menampilkan nilai cache dari berkas (mode *Cache*). Setelah ada edit, atau lewat tombol status *Live*, formula
  dihitung ulang oleh mesin evaluasi di `xlsx-formula.ts`. Fungsi yang belum didukung dilaporkan di **Log** dan jatuh balik ke cache.
- **Simpan** menulis ulang cache formula, mengaktifkan `fullCalcOnLoad`, dan mempertahankan VBA (`.xlsm`), pivot, customXml, dll. secara byte-per-byte.
  Makro **tidak** dieksekusi/ditampilkan.
- **Tidak dirender** (dicatat di Log): grafik, shape (hanya teks + kotak), pivot, OLE/form control, icon set CF, dropdown data validation.
- Tes: `pnpm test src/shared/components/xlsx-preview`.
