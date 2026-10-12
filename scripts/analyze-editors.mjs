/**
 * Analisis bundel tiap entri editor (tanpa menulis berkas): ukuran minified/gzip, bagian awal vs dimuat-malas, dan rincian per paket/direktori.
 *
 *   node scripts/analyze-editors.mjs            # semua entri
 *   node scripts/analyze-editors.mjs docx kit   # sebagian
 *   node scripts/analyze-editors.mjs docx --modules   # rincian per berkas sumber (bukan per direktori)
 *   node scripts/analyze-editors.mjs --json     # keluaran JSON (untuk dibandingkan)
 *   node scripts/analyze-editors.mjs --file=path/ke/probe.ts   # entri ad hoc (mis. konsumen yang hanya mengimpor satu fungsi)
 *
 * Entri didefinisikan di ENTRIES; ubah bila titik masuk publik berubah.
 */
import { build } from "vite";
import solid from "vite-plugin-solid";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { existsSync } from "node:fs";

const root = path.resolve(import.meta.dirname, "..");
const C = "src/shared/components";
const pick = (...c) => c.find(f => existsSync(path.join(root, f))) ?? c[0];
const ENTRIES = {
  docx: pick(`${C}/docx-editor/index.ts`, `${C}/docx-editor/DocxEditor.tsx`),
  pptx: pick(`${C}/pptx-editor/index.ts`, `${C}/pptx-editor/PptxEditor.tsx`),
  xlsx: pick(`${C}/xlsx-preview/index.ts`, `${C}/xlsx-preview/XlsxPreview.tsx`),
  maxgraph: pick(`${C}/maxgraph-editor/index.ts`),
  kit: pick(`${C}/editor-kit/index.ts`, `${C}/editor-kit/events.ts`),
};

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const byModule = args.includes("--modules");
const names = args.filter(a => !a.startsWith("--"));
const extra = args.filter(a => a.startsWith("--file=")).map(a => [path.basename(a.slice(7)), a.slice(7)]);
const todo = extra.length ? extra : Object.entries(ENTRIES).filter(([n]) => !names.length || names.includes(n));

const group = id => {
  if (byModule) { const rel = path.relative(root, id.split("?")[0]).split(path.sep).join("/"); if (rel.startsWith("src/")) return rel.replace("src/shared/components/", ""); }
  const m = /node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(id);
  if (m) return m[1].replace(/\\/g, "/");
  const rel = path.relative(root, id.split("?")[0]).replace(/\\/g, "/");
  const sm = /^src\/shared\/components\/([^/]+)/.exec(rel);
  return sm ? `src:${sm[1]}` : rel.startsWith("src/") ? "src:other" : "other";
};

const kb = n => `${(n / 1024).toFixed(1)} kB`;
const results = {};
for (const [name, entry] of todo) {
  const out = await build({
    root, configFile: false, logLevel: "silent",
    plugins: [solid()],
    resolve: { conditions: ["browser", "production"] },
    build: {
      write: false, minify: "esbuild", cssCodeSplit: false, target: "es2022", sourcemap: false,
      lib: { entry: path.join(root, entry), formats: ["es"], fileName: "x" },
      rollupOptions: { output: { inlineDynamicImports: false } },
    },
  });
  const outputs = (Array.isArray(out) ? out : [out]).flatMap(o => o.output);
  const chunks = outputs.filter(o => o.type === "chunk");
  const css = outputs.filter(o => o.type === "asset" && /\.css$/.test(o.fileName));
  const entryChunk = chunks.find(c => c.isEntry);
  // chunk yang dimuat statis dari entri
  const byName = new Map(chunks.map(c => [c.fileName, c]));
  const initial = new Set();
  const walk = c => { if (!c || initial.has(c.fileName)) return; initial.add(c.fileName); c.imports.forEach(i => walk(byName.get(i))); };
  walk(entryChunk);
  const size = c => Buffer.byteLength(c.code);
  const gz = c => gzipSync(c.code).length;
  const init = chunks.filter(c => initial.has(c.fileName)), lazy = chunks.filter(c => !initial.has(c.fileName));
  const groups = {};
  for (const c of init) for (const [id, m] of Object.entries(c.modules)) groups[group(id)] = (groups[group(id)] ?? 0) + m.renderedLength;
  const cssSize = css.reduce((a, c) => a + Buffer.byteLength(String(c.source)), 0);
  results[name] = {
    entry, initialKB: +(init.reduce((a, c) => a + size(c), 0) / 1024).toFixed(1), initialGzipKB: +(init.reduce((a, c) => a + gz(c), 0) / 1024).toFixed(1),
    lazyKB: +(lazy.reduce((a, c) => a + size(c), 0) / 1024).toFixed(1), lazyChunks: lazy.length, cssKB: +(cssSize / 1024).toFixed(1),
    top: Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, byModule ? 22 : 8).map(([g, n]) => [g, +(n / 1024).toFixed(1)]),
  };
}
if (asJson) console.log(JSON.stringify(results, null, 2));
else for (const [n, r] of Object.entries(results)) {
  console.log(`\n== ${n}  (${r.entry})\n   initial ${kb(r.initialKB * 1024)} (gzip ${kb(r.initialGzipKB * 1024)}) · lazy ${kb(r.lazyKB * 1024)} in ${r.lazyChunks} chunk(s) · css ${kb(r.cssKB * 1024)}`);
  for (const [g, k] of r.top) console.log(`   ${String(k).padStart(8)} kB  ${g}`);
}
