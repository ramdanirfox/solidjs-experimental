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
