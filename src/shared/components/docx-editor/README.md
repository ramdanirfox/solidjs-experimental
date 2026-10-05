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

- **Tata letak Word**: tabel mengambang (`w:tblpPr`) diposisikan absolut terhadap halaman/margin; kotak teks (`wps:bodyPr`) memakai inset dan perataan vertikal aslinya; gambar `wrapSquare`/anchor di header ditempatkan tepat pada posisi OOXML-nya (kiri/kanan header tidak lagi bertumpuk).

- **Pratinjau OLE**: tombol *Pratinjau* di panel OLE (atau klik ganda objek yang dapat dipratinjau) membuka dialog untuk berkas tertanam berupa teks, gambar, audio, video, atau PDF (dideteksi dari ekstensi dan magic bytes; teks dibatasi 512 KB). HTML/SVG tidak dieksekusi. API: `api.ole.preview(relId)`, `closePreview()`, `canPreview(relId)`; event `ole:preview`; perintah `ole.preview`.

## Batasan yang disengaja

- Teks header/footer dan catatan kaki hanya tampil (belum dapat disunting); gambar/kotak teks di header/footer dapat dipilih, digeser, diubah ukuran, dan dihapus (masuk undo/redo dan tersimpan). Catatan kaki ditampilkan di akhir isi, bukan di dasar tiap halaman.
- Paragraf tidak dibelah antar-halaman (paragraf sangat panjang menjadikan halaman memanjang); baris tabel *dapat* dibelah. Section multi-kolom ditata satu kolom, tabel mengambang inline,
  grafik/SmartArt/EMF/WMF berupa placeholder, persamaan OMML sebagai teks. Semua dicatat di **Log**.
- Pagination mendekati Word/LibreOffice tetapi tidak identik (metrik font, kerning, widow/orphan).
- Makro tidak dieksekusi dan dipertahankan utuh saat menyimpan; tanda tangan digital menjadi tidak valid setelah diedit.
- Format `.doc` biner dan dokumen ber-password tidak dapat dibuka (struktur kontainer ditampilkan lewat `cfb`).

## Uji

`pnpm test src/shared/components/docx-editor` — teks/tabel/OLE/i18n murni (Node) serta render, pemetaan offset DOM, dan controller (jsdom).
Invarian utama: untuk setiap paragraf `teks datar DOM == teks datar model` dan `offset → posisi DOM → offset` identik.
Di browser, `document.querySelector(".dxe-root").__dx` mengekspos `{ view, book() }` untuk debugging/E2E.

## Event, API, dan perintah (pemrograman)

Editor memancarkan event bertipe lewat **bus**, prop `onEvent`, dan **CustomEvent DOM** `docx-editor:<tipe>` (bubbles) pada elemen akar; semuanya membawa payload yang sama.

```tsx
<DocxEditor onReady={api => {
  api.on("change", ({ label, modified }) => …);
  api.on("ole:inserted", info => …);
  api.ruler.setVisible(true);
}} />
// dari luar tanpa referensi ke API:
el.addEventListener("docx-editor:change", e => (e as CustomEvent).detail);
await dispatchCommand(el, "docx-editor", "getBytes");
```

- Event umum: `ready` (editor siap — dokumen mungkin belum selesai dimuat), `load` (`fileName`, `size`, `source`), `load-error`, `change`, `save`, `export`, `zoom`, `panel`, `readonly`, `error`, `destroy`, `locale`, `history`, `selection`, `pages`, `find`.
- Event OLE: `ole:inserted`, `ole:updated`, `ole:open` (klik ganda objek), `ole:error` (`action`: insert | update | resize). Event penggaris: `ruler:visible|unit|guide-add|guide-move|guide-remove|measure|measure-mode`.
- `api.events` = bus (`on/once/off/onAny/emit/wait/registerCommand/run/history`); prop `bus` memakai bus milik aplikasi (tidak dibersihkan saat editor dilepas); `api.run("<perintah>", …)` menjalankan perintah bernama (`api.events.commands()` untuk daftar).
- Galat di handler tidak merusak editor.

## Objek OLE: sisip & perbarui

`api.ole.insert(file, opts?)` menyisipkan **berkas apa pun** sebagai objek OLE; `api.ole.update(id, file)` mengganti isinya; `api.ole.list()`, `api.ole.getBytes(id)`, `api.ole.resize(id, w, h)`.
`file` = `File`/`Blob` atau `{ name, data }`. Cara penyimpanan mengikuti Office (`prepareOle`, `office-shared/ole-embed.ts`):

| Berkas | Disimpan sebagai | ProgID |
| --- | --- | --- |
| `.xlsx/.xlsm/.docx/.docm/.pptx/.pptm` (ZIP asli) | paket OOXML tertanam (relasi `package`) | `Excel.Sheet.12`, `Word.Document.12`, `PowerPoint.Show.12`, … |
| Compound File biner (`.bin`, `.xls`, `.doc`) | apa adanya (relasi `oleObject`) | dari `\x01CompObj`, bila ada |
| Lainnya | objek `Package` (`\x01Ole10Native` dalam CFB, seperti *Insert → Object → From file*) | `Package` |

Pratinjau (ikon + nama berkas, PNG) dibuat otomatis (`opts.preview` untuk milik sendiri). Galat (berkas kosong, id tidak ada, mode `readonly`, dst.) memancarkan `ole:error` dan masuk Log; API mengembalikan `undefined`/`false`, tidak melempar.
UI: tombol **Objek…** dan panel **OLE** (daftar objek, *Ganti isi…*). Isi tertanam tidak pernah dieksekusi.
Catatan verifikasi: struktur paket diperiksa dengan buka-ulang lewat library + uji well-formed XML + validasi library; **belum dibuka di aplikasi Office sungguhan** pada pengembangan ini.

## Penggaris, garis bantu, dan alat ukur

Prop `ruler` / `rulerUnit` (default tersembunyi, `cm`) atau `api.ruler`. Penggaris menampilkan `cm / mm / in / pt / px` (klik sudut untuk berganti), **garis bantu** dibuat dengan menyeret dari penggaris
(untuk perataan; gambar mengambang yang diseret menempel ke guide; tahan Alt untuk menonaktifkan), dan **alat ukur** (tombol *Ukur*, seret di area kerja untuk jarak/Δx/Δy/sudut; Shift = kunci sumbu, Esc = hapus). Lihat `editor-kit/README.md` untuk API lengkap.
Angka nol = margin kiri/atas halaman terdekat (margin diberi warna); posisi guide disimpan sebagai koordinat dokumen.

### Detail OLE di DOCX

Objek ditulis sebagai `<w:object>` + VML (`v:shape`/`o:OLEObject`) dengan part `/word/embeddings/*` dan gambar pratinjau. **Perbarui** selalu membuat part + relasi baru lalu mengarahkan objek ke sana (riwayat undo hanya menyimpan XML body, jadi undo tetap mengembalikan isi lama);
saat menyimpan, part sisa yang tidak dirujuk body dilepas sementara dari berkas (dan dikembalikan ke sesi sehingga undo setelah simpan tetap benar). File baru: `docx-ole-edit.ts`.
