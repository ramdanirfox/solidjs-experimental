# editor-kit

Pustaka kecil bersama untuk editor (maxgraph, docx, pptx, xlsx). Tanpa dependensi.

| File | Isi |
| --- | --- |
| `events.ts` | `createEventBus` — `on / once / off / onAny / emit / wait`, perintah bernama (`registerCommand` / `run`), jembatan DOM (`attach`), riwayat event; `dispatchCommand(el, prefix, name, …args)` |
| `office-events.ts` | Tipe event umum editor Office (`load`, `change`, `save`, `zoom`, …), event OLE (`ole:inserted/updated/open/error`), `readFileInput` |
| `ruler-core.ts` | Satuan (px, cm, mm, in, pt), pemilihan langkah tick, `buildTicks`, `snapValue` / `snapSpan` |
| `ruler-kit.ts` / `ruler.css` | `RulerKit`: penggaris horizontal + vertikal, **garis bantu** (seret dari penggaris), **alat ukur jarak**, wilayah berwarna (mis. margin), snapping |

## Event bus

```ts
const bus = createEventBus<MyEvents>({ source: "docx-editor", domPrefix: "docx-editor" });
const off = bus.on("change", (payload, meta) => …);   // meta: { type, time, seq, source }
bus.registerCommand("undo", () => …);
await bus.run("undo");
const detach = bus.attach(rootEl);                    // event → CustomEvent "docx-editor:<tipe>" (bubbles); "docx-editor:command" → perintah
```

Handler yang melempar galat tidak menghentikan handler lain (dilaporkan ke `onError`). `historyIgnore` mengecualikan tipe tertentu dari `history()`.

## RulerKit

Editor menyediakan bingkai `<div class="rk-frame"><div class="rk-body">…stage…</div></div>`; kit menambahkan penggaris dan lapisan guide/ukur. Seluruh koordinat dokumen = px CSS 96 dpi pada zoom 100%.
`getGeometry()` memetakan dokumen → layar (`originX/Y`, `scale`) dan menentukan angka nol penggaris (`zeroX/Y`).

```ts
ruler.setVisible(true); ruler.setUnit("mm");
const g = ruler.addGuide("x", 320);        // event "ruler:guide-add"
ruler.snap({ x: 318, w: 100 });            // → { x: 320, hitX: 320 } — tepi kiri/tengah/kanan rentang menempel ke guide terdekat dalam toleransi (6 px layar)
ruler.setMeasureMode(true);                // seret di area kerja; Shift = kunci sumbu; Esc = hapus
ruler.measure(0, 0, 300, 400);             // → { distance: 500, dx, dy, angle, text }
```

Event: `ruler:visible`, `ruler:unit`, `ruler:guide-add|move|remove`, `ruler:measure`, `ruler:measure-mode`. Seret dari penggaris membuat guide; seret guide untuk memindah; seret kembali ke penggaris atau klik ganda untuk menghapus.
Integrasi per editor: DOCX (angka nol = margin kiri/atas halaman terdekat; margin berwarna; gambar mengambang menempel ke guide), PPTX (px slide; bentuk menempel ke guide saat dipindah/diubah ukuran bersama snapping bawaan), XLSX (angka nol = tepi kolom A / baris 1; gambar yang dipindah menempel ke guide).

## Navigasi, cari/ganti, tautan, warna (perintah bus bersama)

Semua editor mendaftarkan perintah bernama yang sama (via `api.run(...)`, `bus.run`, atau `dispatchCommand(el, prefix, name, ...args)`):

| Perintah | Fungsi |
| --- | --- |
| `goto(target)` | Pindahkan fokus/viewport. `target.kind` berbeda per editor (lihat README masing-masing); semua editor punya `search` (`occurrence`) dan `match` (indeks hasil `find`). Hasil: `{ target, ok, label }`; target tidak ada → `ok:false` (tidak melempar). Event `navigate`. |
| `find(spec)` / `findNext` / `findPrev` / `findClear` | Cari lintas jenis → `{ count, matches[], current, truncated, error }`. `spec`: `query, regex, caseSensitive, wholeWord, kinds, select, limit`. Event `find`. |
| `replace(spec)` / `replaceAll(spec)` | `spec` = `find` + `replacement` + `kinds` (default `["text"]`). `replace` = hasil aktif/pertama; `replaceAll` = semua; satu langkah undo. Hasil `{ total, byKind, skipped, error }`; event `replace`. |
| `replace.kinds` | Jenis yang didukung editor. |
| `link.list/set/remove/update/removeById/replace/open` | Pengelolaan hyperlink (`hyperlink.ts`). URL dinormalisasi (`a@b.co` → `mailto:`, `host.tld` → `https://`); skema `javascript:`/`vbscript:`/`data:` ditolak. Event `link`. |

**Jenis penggantian (`ReplaceKind`)** — beberapa jenis dalam satu permintaan; jenis yang tak didukung dilaporkan di `skipped`:

- Berbasis teks (`query` = teks/regex; `$1` berlaku bila `regex:true`): `text`, `headerFooter`, `notes`, `comment`, `link`, `name`, `formula`, `number`, `data`.
- Berbasis nilai persis (`query` = nama font / warna `#RRGGBB`; `replacement` kosong pada warna = **hapus**): `font`, `color`, `fill`, `stroke`.

| Editor | Jenis |
| --- | --- |
| DOCX | text, headerFooter, notes (catatan kaki & akhir), comment, link, font, color, fill |
| PPTX | text, notes, link, name, font, color, fill, stroke |
| XLSX | text (sel string), number (nilai numerik sebagai teks angka), formula, link, comment, name (nama sheet), font, color, fill |
| maxGraph | text (label, termasuk HTML), link, data, font, color, fill, stroke |

Berkas: `find-replace.ts` (tipe, `compileFind`, `replaceInString`, `createFindCursor`, util warna/font), `hyperlink.ts`, `LinkPanel.tsx` (UI daftar tautan bersama), `ColorField.tsx` + `color-util.ts`. Uji: `kit.test.ts`, `ColorField.test.tsx`.

### ColorField (pemilih warna)

Pengganti `<input type="color">`: palet, pemilih bawaan, hex, **slider opasitas**, dan tombol **Tanpa warna**. `onChange(null)` = hapus; `onChange({ hex, alpha })`. Seleksi/contenteditable disimpan saat dibuka dan dipulihkan sebelum `onChange`.
Alfa: PPTX (isi, garis, teks) dan maxGraph (`fillOpacity`/`strokeOpacity`/`textOpacity`) menyimpan alfa asli. DOCX dan XLSX **tidak punya kanal alfa** untuk warna teks/shading/isi sel, sehingga warna dikomposit di atas putih (`compositeOver`) dan pemilih memberi catatan.

### Tab stop pada RulerKit

`new RulerKit({ tabs: true })` mengaktifkan penanda tab pada penggaris horizontal: klik = tambah (jenis dari tombol di kiri penggaris: left/center/right/decimal/bar), seret = pindah, seret keluar penggaris = hapus, klik ganda = ubah. API: `setTabs(markers)`, `getTabs()`, `setTabType()`; event `ruler:tab-add|move|remove|edit|type`. `pos` = px dokumen relatif ke angka nol penggaris (margin kiri). Dipakai DOCX (`tabs.get/set/add/remove/clear`, dialog **Tab stop…**).

## Format & struktur lewat bus (`format.*` dan perintah struktur)

Selain navigasi/ganti/tautan, tiap editor mengekspos **format** dan **struktur** lewat bus yang sama (`api.run(nama, ...args)`, CustomEvent `<prefix>:command`, atau method `api.format` / `api.slides` / dst).

### `format.*` (`format.ts`)

| Perintah | Fungsi |
| --- | --- |
| `format.keys` | Kunci properti yang dipahami editor. |
| `format.apply({ target?, props })` | Terapkan `props` ke target (default: seleksi saat ini). Hasil `{ applied[], skipped[], targets }`; kunci yang tak didukung/tak berlaku masuk `skipped`, **tidak melempar**. Seluruh perubahan = **satu langkah undo**. Event `format`. |
| `format.get(target?)` | Format sebagai `FormatProps` umum (sel/bentuk/paragraf pertama target). |

`FormatProps` umum: `bold`, `italic`, `underline`, `strike`, `fontFamily`, `fontSize` (pt), `color` (+`colorAlpha`), `fill` (+`fillAlpha`), `stroke {color,width,dash,alpha}`, `align`, `valign`, `wrap`, `opacity`, `link`. `null` pada `color`/`fill`/`stroke` = hapus. Tiap editor menambah kunci khusus (lihat README editor). Bentuk `target` mengikuti editor:

| Editor | `target` | Catatan |
| --- | --- | --- |
| PPTX | `{ slide?, id?, ids?, name?, all? }` | Bentuk pada slide (pindah ke slide target). `bounds` dalam px slide (1280×720). Alfa asli (`<a:alpha>`). |
| XLSX | `{ range?, sheet? }` | `range` boleh `Sheet!A1:B2`; sheet lain dikenai tanpa berpindah. Alfa dikomposit di atas putih. |
| DOCX | `{ kind: "selection" \| "all" \| "paragraph" \| "table" \| <target navigasi> }` | `paragraph {index,to?,start?,end?}`, `table {index,row?,col?,toRow?,toCol?}` (rentang sel), atau `search`/`heading`/`bookmark`/`link`/`match`. Alfa dikomposit di atas putih. |
| maxGraph | `{ id?, ids?, kind?: "vertex" \| "edge" \| "all" }` | Alfa asli (`fillOpacity`/`strokeOpacity`/`textOpacity`). |

### Struktur

Setiap operasi struktur memancarkan event `structure` `{ scope, action, ok, detail }` dan mengembalikan boolean/hasil; operasi yang tidak valid atau pada mode readonly mengembalikan `false`/`undefined`/`0` tanpa melempar.

| Editor | Perintah |
| --- | --- |
| PPTX | `slide.list/layouts/add/duplicate/remove/move/setBackground/setNotes/setHidden/setLayout`, `shape.list/add/remove/duplicate/align/order/group/ungroup` |
| XLSX | `sheet.list/add/rename/remove/move/setVisible` (undo; rename memperbarui rumus `Nama!A1`), `range.merge/unmerge/clear/freeze/colWidth/rowHeight/autofilter` |
| DOCX | `paragraph.count/insert/remove`, `pageBreak.insert`, `table.list/ops/insert/apply` (insert/hapus baris-kolom, gabung/pisah, shading, border, lebar, … pada bagian tabel) |
| maxGraph | `cell.list/update/remove/order/align`, `ruler.*` (selain perintah yang sudah ada: `addNode`, `addEdge`, `group`, `ungroup`, `layout`, `setLabel`, `setPage`, …) |

Catatan batas: penyisipan/penghapusan **baris & kolom XLSX** belum ada (library tidak menyediakan penyesuaian referensi rumus); `ruler.*` di maxGraph adalah referensi visual (garis bantu tidak menempelkan sel).

Berkas: `format.ts` (`FormatProps`, `FormatReport`, `splitFormatKeys`, event `format`/`structure`).

## Mode tata letak (`layout`) — desktop / compact / touch

Prop `layout?: "auto" | "desktop" | "compact" | "touch"` (default `auto`) pada keempat editor; mode yang berlaku dipasang di akar sebagai `data-layout="…"` (+ `data-narrow="true"` bila lebar editor < 720px). Semua CSS (`layout.css`) dan JS membaca nilai yang sama.

| Mode | Perilaku |
| --- | --- |
| `desktop` | Pita/toolbar penuh, target kursor presisi. |
| `compact` | Bilah satu baris yang dapat digulir (tanpa keterangan grup), panel samping → lembar bawah, miniatur PPTX → strip horizontal, palet maxGraph → strip, catatan PPTX disembunyikan, bilah status satu baris. |
| `touch` | Target sentuh ≥ 40px, gagang seleksi diperbesar, menu dibatasi lebar layar, `touch-action: manipulation`; perilaku ringkas di atas berlaku bila lebar sempit. |

`auto`: `touch` bila pointer utama kasar (`(pointer: coarse)`), selain itu `compact` bila lebar **editor itu sendiri** (bukan jendela) < 720px, selain itu `desktop`. Developer dapat memaksa mode lewat prop (bisa diubah saat berjalan), `api.layout.get()/set(setting)` (maxGraph: `api.uiLayout`) atau perintah bus `layout.get` / `layout.set`; event `layout` (maxGraph: `ui-layout`) membawa `{ setting, mode, width, coarse, narrow }`. Nilai tak valid ditolak (`false`).

DOCX: pada mode ringkas/sentuh yang sempit halaman otomatis diskalakan selebar layar (sekali, selama zoom belum diatur manual). Berkas: `layout.ts` (`createLayoutController`, `resolveLayout`), `layout.css`.

Belum (tahap berikutnya): gestur sentuh pada kanvas (pan/pinch-zoom, tekan-lama = klik kanan, gagang jangkauan sel XLSX), penyuntingan header/footer & tab stop tanpa klik ganda.

## Drop eksternal (`drop.ts`)

Satu jalur untuk berkas/teks/tautan yang dijatuhkan ke editor: **klasifikasi → saringan → `before` (dapat membatalkan) → handler per jenis → laporan**. Jalur yang sama dipakai drop DOM dan `api.drop.handle(...)` / perintah `drop.handle`, jadi dapat diuji tanpa `DragEvent`.

| Jenis | Isi | Default |
| --- | --- | --- |
| `image` | berkas `image/*` | diterima |
| `office` | berkas format editor ini (docx / pptx / xlsx / drawio·xml·svg) → dibuka atau diimpor | diterima |
| `text` | teks polos | diterima |
| `url` | satu tautan http(s)/mailto | diterima |
| `file` | berkas lain → objek OLE | **harus diminta** (`accept` memuat `"file"`) |

Prop `drop?: boolean | { accept?, maxSize?, before? }` (`false` = nonaktif; `maxSize` default 25 MB). `before(info)` menerima item yang lolos saringan dan boleh mengembalikan `false` untuk membatalkan seluruh drop. Event `drop` `{ info, report }`; `report = { handled[], rejected[{item, reason}], cancelled }` dengan `reason` ∈ `readonly | not-accepted | too-large | unsupported | cancelled | error`. API: `api.drop.handle({ files?, text?, url?, x?, y? })`, `api.drop.accept()`, `api.drop.setAccept(list)`; bus `drop.handle`, `drop.accept` (tanpa argumen = baca, dengan daftar = ubah). Drag internal (palet node maxGraph, urutan miniatur PPTX) diabaikan kontroler.

| Editor | image | office | text / url | file (opt-in) |
| --- | --- | --- | --- | --- |
| DOCX | di paragraf bawah pointer | buka .docx | sisip di titik (baris baru → paragraf) | objek OLE di titik |
| PPTX | gambar di titik jatuh | buka .pptx | kotak teks di titik | objek OLE di titik |
| XLSX | gambar di sel bawah pointer | buka .xlsx/.xlsm | diisikan seperti tempel mulai sel bawah pointer (TSV → blok sel; **menimpa isi**, satu undo) | objek OLE di sel |
| maxGraph | simpul gambar di titik | impor .drawio / XML / pustaka bentuk / `.svg` (sebagai pustaka bentuk) | simpul berlabel di titik | — |

Koordinat jatuh hanya berlaku untuk drop DOM; lewat API item ditaruh di posisi aktif (caret, sel aktif, tengah slide/kanvas). maxGraph menandai akar dengan `data-dropping` selama drag eksternal berada di atasnya.

## Modularitas & ukuran bundel

- **Permukaan publik** tiap folder = `index.ts` (`editor-kit`, `docx-editor`, `pptx-editor`, `xlsx-preview`, `maxgraph-editor`). Modul lain internal. `public-api.test.ts` menjaga ekspor yang dipakai host; data contoh (`*-sample`) sengaja tidak diekspor dan dimuat malas saat `sample` dipakai.
- **Batas modul** (dijaga `boundaries.test.ts`): `editor-kit` dan `office-shared` tidak mengimpor editor mana pun; satu editor tidak mengimpor editor lain (satu-satunya pengecualian `editor-kit/office-events.ts` → tipe OLE bersama).
- **Tree-shaking**: `src/shared/components/package.json` mendeklarasikan `"sideEffects": ["**/*.css"]` sehingga mengimpor satu fungsi lewat barrel tidak menyeret modul lain maupun CSS-nya (diukur: 0,4 kB tanpa CSS vs 7,4 kB CSS bila deklarasi dihapus). Pustaka `@office-kit/*` sudah ESM `sideEffects:false`.
- **Muat malas**: contoh data (`import()` di `openSample`) dan panel/dialog maxGraph (`lazy()`: panel debug, dialog label HTML, dialog tautan). Belum: `cfb` (~64 kB, dipakai sinkron di ~10 titik OLE).
- **Berkas besar dipecah per fitur**: `docx-view.ts` (2.804 → 1.448 baris + `docx-view-{hf,format,tabs,lists,toc,search,table,image,ole,painter,shared}.ts`), `pptx-view.ts` (1.700 → 1.031 + `pptx-view-*.ts`), `xlsx-model.ts` (1.366 → 852 + `xlsx-model-*.ts`). Setiap pecahan adalah fungsi `this: Kelas` yang dipasang di kelas sebagai properti, jadi `view.nama(...)` tidak berubah. Alat: `scripts/split-class.mjs`, `scripts/extract-top.mjs`, `scripts/fix-split-imports.mjs` (juga `--relax` untuk melepas `private`).
- **Perintah**: `npm run analyze:editors` (ukuran per entri, awal vs malas, rincian per paket; `--modules` per berkas; `--file=...` untuk konsumen yang hanya mengimpor satu fungsi) dan `npm run typecheck` (tsconfig tanpa `scripts/`; masih ada galat lama di `drawio.ts`, `XlsxShape.tsx`, `pptx-ole*.ts`, dan beberapa berkas uji).

