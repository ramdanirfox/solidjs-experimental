# XLSX / XLSM Preview

Preview workbook Excel yang dirender **sepenuhnya di browser** dengan [`@office-kit/xlsx`](https://office-kit.github.io/xlsx/).
Komponen ini client-only (memakai Blob, canvas, ResizeObserver, File API) — daftarkan lewat `clientOnly` pada route:

```tsx
const SJXClientXlsxPreview = clientOnly(() => import("~/components/SJXXlsxPreview"));
<SJXClientXlsxPreview height="auto" />          // workbook contoh
<SJXClientXlsxPreview src="/files/laporan.xlsm" /> // atau muat dari URL
```

Props: `src?: string`, `sample?: boolean` (default `true`), `height?: string`, `class?: string`, `readonly?: boolean`.

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
- **Editor style** (tombol *Gaya*): font, ukuran, B/I/U/S, warna teks & isi, border, alignment, wrap, indent, number format (preset + kode kustom), format painter, reset.
  Style baru ditulis ke `styles.xml` lewat API library (dengan dedup) dan ikut tersimpan saat unduh; bisa di-undo.
  Rentang >60.000 sel (mis. seluruh kolom) hanya memformat sel yang sudah berisi.
- **Sheet besar**: grid tervirtualisasi. Uji 300.000 baris × 8 kolom (2,4 juta sel): load ±5 dtk, memori ±290 MB, scroll lancar, pencarian bertahap
  (tidak memblokir UI). Di atas ±400 ribu baris posisi scrollbar dipetakan proporsional (batas tinggi elemen browser); sampai 1.048.576 baris diuji.
  Seluruh sheet tetap dimuat ke memori oleh library, jadi berkas jutaan sel membutuhkan RAM besar.
- **Sel gabungan**: seleksi selalu menempel pada merge (diperluas ke seluruh merge, sel aktif = kiri-atas) dan navigasi keyboard melompati area merge.
  Tombol *Gabung / Gabung & tengah / Pisah* ada di bar **Gaya** dan menu klik kanan; hanya nilai sel kiri-atas yang dipertahankan saat menggabung (bisa di-undo).
- **Gambar mengambang**: klik untuk memilih, seret untuk memindah, tarik sudut kanan-bawah untuk mengubah ukuran, panah (Shift = 10 px) untuk geser halus,
  `Del` untuk menghapus, menu **Gambar** / klik kanan untuk menyisipkan dari berkas. Semua bisa di-undo. Hanya gambar yang dapat diedit; grafik dan shape tetap utuh.
- **`readonly`**: menyembunyikan/menonaktifkan edit sel, paste/cut/hapus, style, merge, gambar, resize & hide baris/kolom, undo/redo, dan simpan.
  Cari, filter, freeze, zoom, copy, dan ekspor CSV tetap tersedia.
- **Simpan yang aman untuk Excel** (`xlsx-repair.ts`): `@office-kit/xlsx` 0.23.4 menulis `<customSheetViews>` setelah `<mergeCells>` (melanggar urutan skema, Excel menolak sheet
  itu dan menghilangkannya saat recover) dan mempertahankan `calcChain.xml` usang. Setelah `workbookToBytes`, paket diperiksa: elemen sheet/workbook diurutkan sesuai skema dan
  `calcChain` dibuang (Excel membangunnya ulang). Tombol **File sumber** mengunduh bytes asli tanpa menyentuhnya; **Simpan perubahan** menghasilkan berkas baru.
- **Tata letak**: menu *Tampilan* menyembunyikan toolbar / bar formula / tab sheet / status bar / panel samping, ada *Mode fokus*, dan tombol **Layar penuh** (Fullscreen API,
  fallback ke CSS bila ditolak browser).
- **Mode point**: saat mengetik formula (setelah `=`, `(`, `,`, operator), klik atau drag sel menyisipkan referensi (`A1` / `A1:B9`); referensi pada formula disorot berwarna.
- **Pemeriksa formula** (`xlsx-formula-check.ts`): sebelum formula disimpan dicek sintaks (kurung/kutip), fungsi salah ketik, sheet/referensi rusak, referensi melingkar, teks pada
  operasi angka, angka bertipe teks, rentang kosong/berisi error, dan hasil error — dialog menampilkan penjelasan + saran, bisa *Kembali edit* atau *Simpan apa adanya* (kecuali sintaks rusak).
- **Status bar** menampilkan tipe data sel aktif (Angka, Teks, Tanggal/Waktu, Boolean, Error, Formula → tipe hasil) dan memberi tanda ⚠ untuk teks yang tampak seperti angka.

