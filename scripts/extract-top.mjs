/**
 * Pindahkan deklarasi tingkat-atas (tipe/konstanta/fungsi kecil) dari satu berkas ke modul "shared" agar modul pecahan
 * (lihat split-class.mjs) tidak saling bergantung. Deklarasi yang sebelumnya diekspor diekspor ulang dari berkas asal.
 *
 *   node scripts/extract-top.mjs <berkas.ts> <shared.ts> "<nama1,nama2,...>" ["import ... from ...;" ...]
 *
 * Argumen ke-4 dst. = baris impor yang dibutuhkan modul shared.
 */
import ts from "typescript";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const [file0, shared0, namesArg, ...imports] = process.argv.slice(2);
const file = path.resolve(file0), shared = path.resolve(shared0);
const want = new Set(namesArg.split(",").map(s => s.trim()));
let t = readFileSync(file, "utf8").split(String.fromCharCode(13, 10)).join("\n");
const sf = ts.createSourceFile(file, t, ts.ScriptTarget.ESNext, true);
const cut = [], out = [], re = [];
for (const s of sf.statements) {
  if (ts.isImportDeclaration(s) || ts.isClassDeclaration(s)) continue;
  const n = s.name?.text ?? (s.declarationList ? s.declarationList.declarations[0].name.text : "");
  if (!want.has(n)) continue;
  const lead = ts.getLeadingCommentRanges(t, s.getFullStart()) ?? [];
  const start = lead.length ? lead[0].pos : s.getStart(sf);
  const exported = !!s.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
  let txt = t.slice(start, s.getEnd());
  if (!exported) txt = txt.replace(/(^|\n)(interface|const|let|type|function|async function) /, "$1export $2 ");
  out.push(txt); cut.push([start, s.getEnd()]);
  re.push({ n, exported, isType: ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) });
}
cut.sort((a, b) => b[0] - a[0]);
for (const [a, b] of cut) t = t.slice(0, a) + t.slice(b);
const rel = "./" + path.basename(shared, ".ts");
const lines = [];
const reVals = re.filter(r => r.exported && !r.isType).map(r => r.n), reTypes = re.filter(r => r.exported && r.isType).map(r => r.n);
if (reVals.length) lines.push(`export { ${reVals.join(", ")} } from "${rel}";`);
if (reTypes.length) lines.push(`export type { ${reTypes.join(", ")} } from "${rel}";`);
const useVals = re.filter(r => !r.isType).map(r => r.n), useTypes = re.filter(r => r.isType).map(r => r.n);
if (useVals.length) lines.push(`import { ${useVals.join(", ")} } from "${rel}";`);
if (useTypes.length) lines.push(`import type { ${useTypes.join(", ")} } from "${rel}";`);
const last = [...t.matchAll(/^import [^;]+;\n/gms)].pop();
t = t.slice(0, last.index + last[0].length) + lines.join("\n") + "\n" + t.slice(last.index + last[0].length);
writeFileSync(file, t);
const head = `/** Tipe, konstanta, dan util kecil bersama untuk ${path.basename(file)} dan modul pecahannya. */\n${imports.join("\n")}${imports.length ? "\n\n" : ""}`;
writeFileSync(shared, (existsSync(shared) ? readFileSync(shared, "utf8") + "\n" : head) + out.join("\n\n") + "\n");
console.log(`dipindah ${cut.length} deklarasi ke ${path.basename(shared)}`);
