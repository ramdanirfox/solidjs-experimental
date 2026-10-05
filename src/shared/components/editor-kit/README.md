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
