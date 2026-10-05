# Maxgraph Node Editor

Editor diagram node berbasis [`@maxgraph/core`](https://github.com/maxGraph/maxGraph) (Solid, client-only): palet node, sambung antar node, undo/redo, tata letak otomatis, minimap,
impor/ekspor, plus **event & perintah untuk pemrograman**, **impor/ekspor draw.io**, **alat penelusuran (log/info/peristiwa)**, dan **impor bentuk tambahan**.

```tsx
<SharedMaxgraphNodeEditor
  height={560}
  onReady={api => { /* api.events, api.importDrawio, api.logger, … */ }}
  onEvent={(type, payload, api) => console.log(type, payload)}   // SEMUA event editor
  shapeLibraries={[{ name: "AWS", content: stencilXml }]}          // pustaka bentuk awal
/>
```

## 1. Event & perintah (pemrograman)

Setiap kejadian penting dipancarkan lewat **tiga jalur** yang sama isinya:

| Jalur | Cara |
| --- | --- |
| Bus | `api.on("node-added", (e, meta) => …)`, `api.once`, `api.off`, `api.events.onAny(fn)`, `api.events.wait("change", 3000)` |
| Prop | `onEvent(type, payload, api)` (semua event); prop lama (`onChange`, `onSelectionChange`, `onNodeAdded`, `onCellDoubleClick`) tetap bekerja |
| DOM | `CustomEvent` `maxgraph-editor:<tipe>` pada elemen akar (bubbles) — mis. `el.addEventListener("maxgraph-editor:change", e => e.detail.xml)` |

Prop `bus` memungkinkan aplikasi membuat bus sendiri lebih dulu (`createEventBus<MaxgraphEventMap>({ source: "maxgraph-editor" })`); bus milik aplikasi **tidak** dibersihkan saat editor dilepas.

Tipe event (`MaxgraphEventMap`): `ready`, `model-change`, `change` (didebounce, `xml`), `selection`, `node-added`, `cells-added`, `cells-removed`, `cells-moved`, `cells-resized`,
`label-changed`, `edge-connected`, `click`, `double-click`, `zoom`, `history`, `import`, `export`, `layout`, `shapes`, `page`, `readonly`, `log`, `error`, `destroy`.
Galat di dalam handler tidak merusak editor: ditangkap, dicatat di log, dan handler lain tetap jalan.

**Perintah** (aplikasi memerintah editor): `await api.run("addNode", "process", 40, 40, "Satu")`, atau dari luar tanpa referensi ke API:

```ts
import { dispatchCommand } from "~/shared/components/editor-kit/events";
await dispatchCommand(el, "maxgraph-editor", "importDrawio", xmlText);
```

Daftar perintah: `api.events.commands()` — antara lain `undo redo zoomIn zoomOut fit layout addNode addEdge select getXml setXml importDrawio exportDrawio importShapes removeShapeLibrary setPage download toSvg getInfo inspect getLogs clearLogs setLogLevel showPanel registerNodeType`.

## 2. Serialisasi / deserialisasi draw.io

| API | Fungsi |
| --- | --- |
| `await api.importDrawio(text, { mode, page, fit })` | Impor `.drawio` (`<mxfile>`, **terkompresi atau tidak**, banyak halaman), `<mxGraphModel>` polos, atau XML asli maxGraph. `mode: "merge"` menambahkan ke diagram yang ada. Mengembalikan `DrawioImportReport`. |
| `await api.exportDrawio({ compress, pages, pretty })` | Ekspor `<mxfile>`. **Style diratakan** (named style + style bawaan digabung ke string style) sehingga tampil sama di draw.io. |
| `api.getPages()`, `await api.setPage(i \| id \| nama)` | Halaman diagram. Halaman yang ditinggalkan disimpan (salinan asli maxGraph), jadi tipe node tetap terjaga. |
| `api.getXml()` / `api.setXml(xml)` | Format asli maxGraph (`GraphDataModel`); `setXml` juga menerima draw.io. |
| `api.download("drawio" \| "drawio-compressed" \| "xml" \| "svg" \| "png")` | Unduh. |

Toolbar: tombol **Impor** (draw.io / XML maxGraph; berkas apa pun juga bisa dijatuhkan ke kanvas), menu **Ekspor…** (draw.io, draw.io terkompresi, XML, SVG, PNG), dan pemilih halaman bila file punya >1 halaman.

Perilaku penting:

- **Impor atomik.** Seluruh dokumen diurai & divalidasi lebih dulu; diagram yang terbuka baru diganti setelah semuanya berhasil. XML rusak / bukan draw.io / struktur salah → galat yang jelas (`DrawioError` dengan `code`), diagram lama tetap utuh. (maxGraph sendiri *tidak* melempar galat untuk XML rusak — hasilnya model kosong — jadi editor memvalidasi XML dan model uji coba sendiri.)
- **Label HTML** (`html=1`) ditampilkan seperti draw.io tetapi **disanitasi** (tag/atribut aktif, `javascript:`, handler `on*`, CSS berbahaya dibuang) di impor *dan* saat digambar.
- Atribut kustom `<object label=… owner=…>` dipertahankan (ekspor menulisnya kembali).
- `shape=` yang tidak tersedia ditampilkan sebagai persegi dan **dilaporkan** (`report.unknownShapes`) — impor pustaka stensil untuk menampilkannya dengan benar (lihat §4).
- `image=data:image/png,…` (gaya draw.io, tanpa `;base64`) dikonversi dua arah.
- Ruang lingkup: bentuk bawaan draw.io yang tidak ada di maxGraph (mis. `cube3d`, sebagian besar bentuk "advanced"), efek sketsa, dan gaya khusus draw.io lain **tidak** ditiru.

## 3. Log, Info, dan Peristiwa (penelusuran: apa yang berhasil dan kenapa)

Tombol **bug** (Log) dan **info** pada toolbar membuka panel bawah; atau `api.showPanel("log" | "info" | "events")`, prop `panel`, `debugTools={false}` untuk menyembunyikan tombol.

- **Log** — `api.logger` (`MaxgraphLogger`): tingkat `debug/info/warn/error`, cakupan (`import`, `export`, `shapes`, `layout`, `api`, `graph`, `palette`, `ui`, `events`), ring buffer 500 entri.
  Proses penting dicatat sebagai **langkah** dengan hasil ✓/✗ dan **alasannya** (`why`) — mis. *"Halaman “Satu”: terkompresi → base64 → deflate-raw → URL-decode (812 → 3.4k karakter, 6 ms)"* atau
  *"Bentuk tidak tersedia: cube3d ↳ tidak ada di ShapeRegistry/StencilShapeRegistry → tampil sebagai persegi"*. `logger.trace(scope, nama, fn, { why })` membungkus fungsi sinkron/async dan mencatat durasi serta galatnya.
  Filter (tingkat, cakupan, teks, "hanya masalah"), salin, unduh `.txt`/`.json`, dan "jejak debug" (menyertakan catatan `debug`). `logLevel`, `consoleLog` (ke console), dan `logger` (instance sendiri) dapat diatur lewat prop.
- **Info** — jumlah node/garis/layer, zoom, halaman, undo/redo, jumlah jenis node/stensil/pendengar event, daftar perintah, **laporan impor terakhir** (format, halaman, bentuk tak tersedia, garis terputus, peringatan), serta **inspeksi sel terpilih**: style gabungan vs style milik sel, named style, geometri, dan apakah bentuknya `builtin | stencil | missing`.
  Programatik: `api.getInfo()`, `api.inspect(cell?)`.
- **Peristiwa** — aliran event bus secara langsung (disaring, dapat dijeda).

## 4. Bentuk tambahan (impor pustaka)

`await api.importShapes(text, { name, fileName })` atau tombol **Bentuk** di toolbar (berkas boleh banyak), prop `shapeLibraries`:

| Sumber | Hasil |
| --- | --- |
| Stensil `<shapes name="mxgraph.xxx"><shape name="Foo" w h>…` | Terdaftar di `StencilShapeRegistry` sebagai `mxgraph.xxx.foo` → diagram draw.io yang memakai `shape=mxgraph.xxx.foo` ikut tampil benar (sel yang sudah ada digambar ulang); muncul di palet dengan thumbnail. Entri tidak valid (w/h salah, elemen asing) dilewati beserta alasannya. |
| SVG | Node bergambar (`shape=image`) berukuran dari `viewBox`; `<script>`, `foreignObject`, `on*` dibuang. |
| Pustaka draw.io `<mxlibrary>[…]</mxlibrary>` | Tiap entri menjadi **fragmen**: seret ke kanvas untuk menyisipkan kumpulan sel sebagai satu langkah undo. |

`api.listShapeLibraries()`, `api.removeShapeLibrary(id)` (menghapus dari palet), `api.registerNodeType(type)` (tambah jenis node saat runtime).
Catatan: registry stensil maxGraph bersifat **global** (dipakai bersama semua instance di halaman) dan tidak mendukung penghapusan per-kunci; menghapus pustaka hanya menghapusnya dari palet, bentuknya tetap terdaftar agar diagram yang memakainya tetap tampil.

## 5. Layar penuh, label HTML, kelompok, zoom

- **Layar penuh**: tombol toolbar / `Shift+F2` / `api.setFullscreen(bool)`, `toggleFullscreen()`, `isFullscreen()`; memakai Fullscreen API dengan fallback CSS; `Esc` keluar; event `fullscreen`.
- **Label HTML**: dialog *Kelola label* (`api.openLabelEditor(cell?)`) dengan mode Teks/HTML, pratinjau tersanitasi; `api.getLabel(cell)`, `api.setLabel(cell, value, { html })`; event `label-changed`.
- **Kelompok**: `Ctrl+G` / `Ctrl+Shift+G`, `api.group(cells?)`, `api.ungroup(cells?)`; event `cells-grouped`, `cells-ungrouped`; kelompok ikut diekspor ke draw.io (`parent`).
- **Zoom**: prop `wheelZoomSpeed`, `minZoom`, `maxZoom`, `zoomFactor`, `zoomAnimation`; roda mouse kontinu & lembut (≈×1,17 per notch), tombol bertahap beranimasi.

## Berkas

| File | Peran |
| --- | --- |
| `SharedMaxgraphNodeEditor.tsx` | Komponen: graph, toolbar, palet, event, perintah, impor/ekspor, bentuk, panel |
| `drawio.ts` | Deteksi format, (de)kompresi, parser/penulis `<mxfile>`/`<mxGraphModel>`, konversi style, sanitasi HTML, impor atomik, ekspor |
| `shapes.ts` | Pembaca stensil / SVG / mxlibrary, pendaftaran stensil, thumbnail, konversi ke jenis node |
| `logger.ts` | `MaxgraphLogger` (level, cakupan, `trace`, `step`, ekspor teks/JSON) |
| `MaxgraphDebugPanel.tsx` | Panel Log / Info / Peristiwa |
| `svg.ts` | Ekspor graph ke SVG (dipakai ekspor & thumbnail) |
| `types.ts`, `defaults.ts`, `index.ts` | Tipe publik, jenis node bawaan, ekspor modul |

## Uji

`pnpm test src/shared/components/maxgraph-editor` — draw.io (format, kompresi, impor/ekspor round-trip, sanitasi, atomik), event, perintah, bentuk, log/info/panel (jsdom, komponen dirender sungguhan).
Tidak diuji terhadap aplikasi draw.io yang sebenarnya; kompatibilitas ekspor diverifikasi dengan membaca kembali hasilnya lewat importer yang sama.
