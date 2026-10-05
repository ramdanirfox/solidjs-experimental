# PPTX Editor

Editor presentasi PowerPoint yang dirender **sepenuhnya di browser** dengan [`@office-kit/pptx`](https://office-kit.github.io/pptx/) (MIT, tanpa dependensi pratinjau tambahan).
Komponen ini client-only (contenteditable, Blob, ResizeObserver, Fullscreen API, File API) — daftarkan lewat `clientOnly` pada route:

```tsx
const SJXClientPptxEditor = clientOnly(() => import("~/components/SJXPptxEditor"));
<SJXClientPptxEditor height="auto" />                       // presentasi contoh
<SJXClientPptxEditor src="/files/deck.pptx" readonly />     // muat dari URL, baca-saja
```

Props (`PptxEditorProps`): `src?: string`, `data?: Uint8Array | ArrayBuffer`, `fileName?`, `sample?: boolean` (default `true`), `height?: string`, `class?`,
`readonly?: boolean`, `locale?: "id" | "en"`, `onLocaleChange?`, `maxHistory?: number` (default 100), `toolbarHidden?: boolean`, `onChange?({ label, modified })`.

## Struktur

| File | Peran |
| --- | --- |
| `PptxEditor.tsx` | UI (Solid): bar atas, ribbon kontekstual (Tabel/Grafik/Gambar muncul saat bentuk dipilih), miniatur, kanvas, catatan, panel Cari/Info/Log/Objek/Riwayat, slideshow |
| `pptx-view.ts` | Controller imperatif: render slide aktif, seleksi (klik/Shift/marquee), seret–ubah ukuran–putar + garis pandu, edit teks di tempat, alat gambar, clipboard, susunan, tabel, painter, cari/ganti |
| `pptx-render.ts` | Model `@office-kit/pptx` → DOM: bentuk (SVG), teks kaya, bullet/nomor, tabel, grafik, gambar (crop/filter), grup, latar, master/layout |
| `pptx-geom.ts` | Jalur SVG untuk ±100 bentuk preset + geometri kustom (`a:custGeom`) |
| `pptx-chart.ts` | Grafik SVG dari `ReadChartSpec` (kolom/batang/garis/area/pai/donat/sebar/radar) |
| `pptx-model.ts` | `PptxDeck`: paket, riwayat undo (snapshot bytes), laporan baca (log) |
| `pptx-sample.ts` | Presentasi contoh yang dibangun hanya dengan API library |
| `pptx-i18n.ts` | Kamus antarmuka en/id |
| `../office-shared/` | Inti OLE/CFB (`cfb`) dan encoder PNG yang dipakai bersama editor DOCX |

## Cara kerja

- **Satu sumber kebenaran: model library.** Setiap perubahan (geser, ukuran, teks, format, tabel, …) memanggil fungsi `@office-kit/pptx` (`setShapeBounds`, `setShapeParagraphs`,
  `mergeTableCells`, `groupShapes`, …), lalu slide dirender ulang dari model. Nilai efektif (placeholder → layout → master → tema) dibaca lewat getter `*Effective`.
- **Koordinat**: 1 px = 9525 EMU; slide 16:9 = 1280 × 720 px, lalu diskalakan CSS (`zoom`). Handle seleksi memakai ukuran tetap di layar (dibagi `--z`).
- **Bentuk tingkat-atas**: `getSlideShapes` meratakan anak grup, jadi renderer & controller memakai `topShapes()` agar anak grup tidak tergambar dua kali.
- **Edit teks**: kerangka teks menjadi `contenteditable`; saat selesai (Esc / klik di luar) DOM dibaca per paragraf/run (selisih terhadap format dasar saja) dan ditulis balik dengan
  `setShapeParagraphs`; properti paragraf (bullet, level, spasi, perataan) dipulihkan karena fungsi itu mereset propertinya.
- **Undo**: snapshot bytes (`savePresentation`) per perubahan melalui antrean serial; undo/redo memuat ulang paket (`loadPresentation`) lalu seleksi dipulihkan berdasar id bentuk.
  Batas catatan dapat disetel (prop `maxHistory` / panel Riwayat); suntingan beruntun pada catatan yang sama digabung.

## Fitur

- Slide 16:9/4:3 dengan latar (warna/gradien/gambar), master & layout, ±100 bentuk preset, geometri kustom, gradien/pola, garis (dash, panah), bayangan, rotasi/flip, hyperlink.
- Seret untuk memindah, **ubah ukuran** (8 handle; gambar mengunci rasio, Shift mengunci bentuk lain), **putar** (Shift = 15°), garis pandu ke tepi/tengah bentuk lain, panah (Shift = 1 px), marquee, Tab berpindah bentuk.
- Edit teks langsung: tebal/miring/garis bawah/coret, warna, ukuran, font, perataan, bullet/nomor, level, spasi baris, jangkar vertikal; sel tabel dapat diedit di tempat.
- Sisip: kotak teks, bentuk (galeri, seret untuk menggambar), garis/panah, gambar (berkas, tempel, seret), tabel (pemilih ukuran), grafik (8 jenis), tautan.
- Tabel: baris/kolom, gabung ke kanan/bawah, isi & border sel, jangkar, header/banded, lebar kolom & tinggi baris. Gambar: crop, kecerahan, kontras, opasitas, ganti.
- Susunan: depan/belakang, rata & sebar, grup/pisah grup, salin/tempel/duplikat, hapus, sembunyikan bentuk, nama & teks alternatif, animasi masuk.
- **Format painter**: menyalin isi, garis tepi, dan format teks; chip menampilkan apa yang disalin; Esc membatalkan.
- Slide: miniatur (seret untuk mengurutkan), tambah/duplikat/hapus/sembunyikan, ganti layout, latar, **catatan pembicara**, transisi (+ terapkan ke semua), **slideshow** (F5).
- Cari & ganti (biasa/kata utuh/huruf besar-kecil/regex) lintas slide, tabel, grup, dan catatan; sorotan di slide.
- Unduh PPTX (dengan perubahan), kerangka teks (.txt), berkas asli; buka berkas lokal / seret ke jendela. Informasi presentasi (properti dapat disunting, statistik, komentar, validasi, isi paket),
  **Log** pembacaan, **objek tertanam & makro VBA** (via `cfb`, tidak pernah dieksekusi), **Debug** (ringkasan paket, riwayat, XML bentuk terpilih).
- Toolbar dapat disembunyikan, layar penuh, mode gelap, kisi, zoom, `readonly`, antarmuka en/id.

## Batasan yang diketahui

- SmartArt, objek 3D/WordArt, video/audio, dan animasi (selain efek masuk sederhana) tidak dirender/diputar; ditampilkan sebagai placeholder dan dicatat di Log.
- Gaya tabel dan grafik digambar sebagai perkiraan (bukan salinan piksel-sempurna dari PowerPoint). Transisi hanya berupa fade pada slideshow.
- Format `.ppt` biner dan berkas terenkripsi tidak didukung (daftar isi kontainer ditampilkan). Data grafik belum dapat disunting di antarmuka.
- Library memberi fill/stroke `inherit` pada bentuk baru; editor mengisinya secara eksplisit saat menyisipkan bentuk.

## Event, API, dan perintah (pemrograman)

Editor memancarkan event bertipe lewat **bus**, prop `onEvent`, dan **CustomEvent DOM** `pptx-editor:<tipe>` (bubbles) pada elemen akar; semuanya membawa payload yang sama.

```tsx
<PptxEditor onReady={api => {
  api.on("change", ({ label, modified }) => …);
  api.on("ole:inserted", info => …);
  api.ruler.setVisible(true);
}} />
// dari luar tanpa referensi ke API:
el.addEventListener("pptx-editor:change", e => (e as CustomEvent).detail);
await dispatchCommand(el, "pptx-editor", "getBytes");
```

- Event umum: `ready` (editor siap — dokumen mungkin belum selesai dimuat), `load` (`fileName`, `size`, `source`), `load-error`, `change`, `save`, `export`, `zoom`, `panel`, `readonly`, `error`, `destroy`, `locale`, `history`, `selection`, `slide`, `find`, `tool`.
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
(untuk perataan; bentuk yang dipindah / diubah ukurannya menempel ke guide bersama snapping bawaan (tepi/tengah slide dan bentuk lain)), dan **alat ukur** (tombol *Ukur*, seret di area kerja untuk jarak/Δx/Δy/sudut; Shift = kunci sumbu, Esc = hapus). Lihat `editor-kit/README.md` untuk API lengkap.
Satuan dokumen = px slide (1280×720); angka nol = pojok kiri-atas slide.

### Detail OLE di PPTX

`@office-kit/pptx` belum punya API OLE, jadi `pptx-ole.ts` mengubah paket langsung: part `/ppt/embeddings/*`, gambar `/ppt/media/oleprev*.png`, relasi slide, dan `<p:graphicFrame>` + `<p:oleObj>` (bentuk yang sama dengan python-pptx) — lalu `PptxDeck.mutatePackage` memuat ulang model dan mencatat satu langkah riwayat.
Id objek = `"<indeks slide>:<shapeId>"` (mis. `"0:12"`). **Objek buatan PowerPoint** dibungkus `mc:AlternateContent` sehingga library tidak menampilkannya sebagai shape; editor memindai XML slide sendiri: objek itu **terbaca, tampil (kotak statis, ikon pratinjau), dan dapat diganti isinya**
(pembungkus dilepas dan cabang VML dibuang agar pratinjau baru yang dipakai), tetapi belum dapat dipindah/diubah ukurannya lewat kanvas. Bingkai hasil sisip bersifat shape biasa: dapat dipilih, dipindah, diubah ukuran, dan di-undo.
