# DOCX Editor

Editor dokumen Word yang dirender **sepenuhnya di browser** dengan [`@office-kit/docx`](https://office-kit.github.io/docx/) dan [`cfb`](https://www.npmjs.com/package/cfb).
Komponen ini client-only (contenteditable, Selection API, Blob, ResizeObserver, File API) — daftarkan lewat `clientOnly` pada route:

```tsx
const SJXClientDocxEditor = clientOnly(() => import("~/components/SJXDocxEditor"));
<SJXClientDocxEditor height="auto" />                      // dokumen contoh
<SJXClientDocxEditor src="/files/laporan.docx" readonly /> // muat dari URL, baca-saja
```

Props (`DocxEditorProps`): `src?: string`, `data?: Uint8Array | ArrayBuffer`, `fileName?`, `sample?: boolean` (default `true`), `height?: string`, `class?`,
`readonly?: boolean`, `locale?: "id" | "en"`, `onLocaleChange?`, `maxHistory?: number` (default 100), `toolbarHidden?: boolean`, `onChange?({ label, modified })`.

## Struktur

| File | Peran |
| --- | --- |
| `DocxEditor.tsx` | UI (Solid): bar atas, ribbon, panel Cari/Info/Log/OLE/Riwayat/Kerangka, status bar, menu & dialog |
| `docx-view.ts` | Controller imperatif: render, pemetaan seleksi DOM ⇄ model, input/keyboard/clipboard, format, tabel, gambar, painter, pencarian, undo |
| `docx-render.ts` | XML → DOM kertas (paragraf, run, tabel, gambar, shape, field, penomoran) |
| `docx-paginate.ts` | Aliran blok ke halaman (geometri section, header/footer, belah baris tabel, gambar mengambang, tab stop) |
| `docx-dom.ts` | Offset teks datar paragraf ⇄ posisi DOM (kontrak `data-u` / `data-skip`) |
| `docx-model.ts` | `DocxBook`: paket OPC, section, relasi, riwayat undo (snapshot XML), statistik, laporan baca |
| `docx-xml.ts` | Pohon `XEl`, parser/serializer XML ringkas, urutan anak sesuai skema (`setChild`) |
| `docx-style.ts` / `docx-numbering.ts` | docDefaults → style → style tabel (kondisional) → penomoran → langsung; tema, border, shading, CSS |
| `docx-text.ts` | Operasi teks murni: sisip/hapus rentang, pecah run/paragraf, patch properti run/paragraf |
| `docx-table.ts` | Model grid tabel: sisip/hapus baris & kolom, gabung/pisah sel (gridSpan + vMerge), ukuran, border, shading |
| `docx-image.ts` | DrawingML: inline/anchor, wrap, posisi, crop, rotasi, kunci rasio, ukuran asli |
| `docx-ops.ts` | Hyperlink, daftar, indentasi, format painter, revisi, salin/tempel internal |
| `docx-search.ts` / `docx-export.ts` | Cari (biasa/kata utuh/regex + lokasi), ekspor TXT & HTML mandiri |
| `docx-ole.ts` | Objek OLE (`/word/embeddings`), isi Compound File via `cfb`, `Ole10Native`, proyek VBA (baca-saja) |
| `docx-sample.ts` | Dokumen contoh (dibangun dengan library + operasi editor; OLE dibuat dengan `cfb`) |
| `docx-i18n.ts` | Kamus antarmuka en/id |

## Cara kerja

- **Model**: library membuka/menyimpan paket OPC, styles, numbering, properti dokumen, relasi, part gambar, dan validasi. Isi `<w:body>` diubah sekali menjadi pohon `XEl`
  dan ditulis balik sebagai blok `raw` (`DocxBook.flush`), sehingga hyperlink, tabel bersarang, SDT, dsb. dapat diedit seragam. Bagian yang tidak dikenali dipertahankan utuh.
- **Edit**: tiap paragraf `contenteditable`. Setelah ketikan browser, teks DOM dibandingkan dengan teks datar model (diff awalan/akhiran) lalu diterapkan sebagai sisip/hapus
  rentang pada run yang tepat (format tetangga dipertahankan). Enter, Backspace/Delete di batas paragraf, tempel, dan seleksi lintas paragraf ditangani sendiri.
- **Paginasi**: blok diukur di DOM lalu dialirkan ke halaman; tabel dibelah per baris (baris header diulang), baris yang lebih tinggi dari halaman dibelah per blok isi sel,
  dan sel `rowspan` yang terpotong diganti sel penutup agar kolom tetap sejajar.
- **Undo**: snapshot XML body (+ sectPr) per perubahan, batas jumlah catatan dapat disetel (prop `maxHistory` / panel Riwayat). Mengetik beruntun digabung menjadi satu catatan.

## Fitur

- Kertas halaman (A4/Letter/…, orientasi, margin, header/footer termasuk halaman pertama/genap-ganjil, nomor halaman, catatan kaki) dengan style OOXML asli.
- Gambar: inline, mengambang (square/top-bottom/behind/front), crop, rotasi/flip; sisip (berkas, tempel, seret), ganti, duplikat, hapus; ubah ukuran bebas atau **kunci rasio**
  (handle sudut/sisi, Shift membalik sementara; atau isi angka cm); seret untuk memindah gambar mengambang, panah untuk menggeser halus.
- Tabel: sisip/hapus baris, kolom, tabel; gabung/pisah sel; pilih sel (seret / Shift+klik); ubah lebar kolom & tinggi baris dengan seret tepi; shading, border (preset/gaya/tebal/warna),
  rata vertikal, baris header, gaya tabel (kondisional), autofit/tetap, ratakan kolom.
- Status bar: halaman, paragraf, kolom, kata, jumlah karakter/kata/paragraf terpilih, style, font, daftar, tautan, posisi sel tabel & jumlah sel terpilih, info gambar, riwayat.
- Cari: biasa, kata utuh, huruf besar-kecil, **regex** (flag s/m) dengan jumlah, daftar hasil + lokasi (halaman, paragraf/tabel-baris-kolom, offset), grup tangkapan, sorotan di dokumen, ganti.
- **Format painter**: salin format karakter+paragraf, chip menampilkan apa yang disalin, sekali pakai atau tetap aktif, Esc/Batal membatalkan.
- OLE: daftar objek tertanam, struktur Compound File, ekstraksi berkas `Package`, pratinjau stream; makro VBA dibaca (daftar modul + kode sumber) **tanpa dieksekusi**.
- Unduh: DOCX (dengan perubahan), TXT, HTML mandiri (gambar sebagai data URI), berkas asli. Buka berkas lokal / seret ke jendela.
- Informasi dokumen (properti dapat disunting, statistik, section, komentar, validasi paket, isi paket), **Log** apa yang berhasil dibaca / terbatas / galat, **Debug** (JSON dokumen, layout, riwayat,
  paragraf pada kursor beserta XML mentahnya).
- Toolbar dapat disembunyikan, layar penuh, mode gelap, tanda format (¶), kerangka (outline), zoom, `readonly`, antarmuka en/id.

## Batasan yang disengaja

- Header/footer dan catatan kaki hanya tampil (belum dapat disunting); catatan kaki ditampilkan di akhir isi, bukan di dasar tiap halaman.
- Paragraf tidak dibelah antar-halaman (paragraf sangat panjang menjadikan halaman memanjang); baris tabel *dapat* dibelah. Section multi-kolom ditata satu kolom, tabel mengambang inline,
  grafik/SmartArt/EMF/WMF berupa placeholder, persamaan OMML sebagai teks. Semua dicatat di **Log**.
- Pagination mendekati Word/LibreOffice tetapi tidak identik (metrik font, kerning, widow/orphan).
- Makro tidak dieksekusi dan dipertahankan utuh saat menyimpan; tanda tangan digital menjadi tidak valid setelah diedit.
- Format `.doc` biner dan dokumen ber-password tidak dapat dibuka (struktur kontainer ditampilkan lewat `cfb`).

## Uji

`pnpm test src/shared/components/docx-editor` — teks/tabel/OLE/i18n murni (Node) serta render, pemetaan offset DOM, dan controller (jsdom).
Invarian utama: untuk setiap paragraf `teks datar DOM == teks datar model` dan `offset → posisi DOM → offset` identik.
Di browser, `document.querySelector(".dxe-root").__dx` mengekspos `{ view, book() }` untuk debugging/E2E.
