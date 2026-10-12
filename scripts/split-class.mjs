/**
 * Pindahkan seksi (dibatasi komentar spanduk `// ───── nama ─────`) dari sebuah kelas besar ke modul terpisah.
 * Tiap metode seksi menjadi fungsi `export function nama(this: Kelas, ...)` di modul baru; kelas hanya menyimpan
 * `nama = modul.nama;` di tempatnya, sehingga API publik (view.nama(...)) tidak berubah. Parsing memakai AST TypeScript,
 * jadi batas metode & komentarnya akurat.
 *
 *   node scripts/split-class.mjs <berkas.ts> <NamaKelas> "<spanduk>=<modul-baru.ts>" ["<spanduk2>=<modul2.ts>" ...]
 *
 * Setelah dijalankan: jalankan type-check; anggota `private` yang dipakai modul akan dilaporkan TS2341 → lepas `private`
 * (skrip `--relax` melakukannya otomatis dari keluaran tsc yang dibaca dari stdin).
 *
 *   node scripts/split-class.mjs --relax <berkas.ts> < tsc-output.txt
 */
import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

if (args[0] === "--relax") {
  const file = path.resolve(args[1]);
  const out = readFileSync(0, "utf8");
  const names = new Set([...out.matchAll(/Property '([\w$]+)' is (?:private|protected)/g)].map(m => m[1]));
  let src = readFileSync(file, "utf8");
  let n = 0;
  for (const name of names) {
    const re = new RegExp(`^(  )(?:private|protected) (?=(?:readonly |async )?${name.replace(/\$/g, "\\$")}\\b)`, "m");
    if (re.test(src)) { src = src.replace(re, "$1"); n++; }
  }
  writeFileSync(file, src);
  console.log(`dilepas: ${n}/${names.size}`);
  process.exit(0);
}

const [file0, className, ...specs] = args;
const file = path.resolve(file0);
const dir = path.dirname(file);
let text = readFileSync(file, "utf8").split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)); // normalisasi ke LF (berkas CRLF ditulis ulang sebagai LF)
const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
const cls = sf.statements.find(s => ts.isClassDeclaration(s) && s.name?.text === className);
if (!cls) throw new Error(`kelas ${className} tidak ditemukan`);

const banners = [...text.matchAll(/^ {2}\/\/ ─{3,}[^\n]*$/gm)].map(m => ({ pos: m.index, label: m[0] }));
const sectionOf = pos => { let b; for (const x of banners) if (x.pos <= pos) b = x; return b; };

const targets = specs.map(s => { const i = s.lastIndexOf("="); return { match: s.slice(0, i), out: s.slice(i + 1) }; });
const importBlock = sf.statements.filter(s => ts.isImportDeclaration(s)).map(s => s.getText(sf));
const edits = []; // {start, end, replacement}
const moved = {}; // out -> funcs[]

for (const m of cls.members) {
  if (!ts.isMethodDeclaration(m) || !m.body || !ts.isIdentifier(m.name)) continue;
  if (m.modifiers?.some(x => x.kind === ts.SyntaxKind.StaticKeyword)) continue;
  const b = sectionOf(m.getFullStart());
  const t = b && targets.find(x => b.label.includes(x.match));
  if (!t) continue;
  // komentar pendahulu (tanpa spanduk)
  const lead = ts.getLeadingCommentRanges(text, m.getFullStart()) ?? [];
  const keep = lead.filter(r => !text.slice(r.pos, r.end).includes("─────"));
  const cStart = keep.length ? keep[0].pos : m.getStart(sf);
  const comment = keep.length ? text.slice(keep[0].pos, m.getStart(sf)).replace(/^ {2}/gm, "") : "";
  const mods = (m.modifiers ?? []).map(x => x.getText(sf));
  const isAsync = mods.includes("async");
  const isPrivate = mods.includes("private");
  const name = m.name.text;
  const tp = m.typeParameters ? `<${m.typeParameters.map(p => p.getText(sf)).join(", ")}>` : "";
  const ps = m.parameters.map(p => p.getText(sf));
  const ret = m.type ? `: ${m.type.getText(sf)}` : "";
  const body = m.body.getText(sf).replace(/^ {2}/gm, "");
  const fn = `${comment.trimEnd() ? comment.trimEnd() + "\n" : ""}export ${isAsync ? "async " : ""}function${m.asteriskToken ? "*" : ""} ${name}${tp}(this: ${className}${ps.length ? ", " : ""}${ps.join(", ")})${ret} ${body}\n`;
  (moved[t.out] ??= []).push({ name, fn });
  edits.push({ start: cStart, end: m.getEnd(), name, out: t.out, isPrivate });
}

// ganti dari belakang agar posisi tetap valid
edits.sort((a, b) => b.start - a.start);
for (const e of edits) {
  const alias = path.basename(e.out, ".ts").replace(/^docx-view-/, "").replace(/[^a-zA-Z0-9]/g, "_") + "Mod";
  text = text.slice(0, e.start) + `${e.isPrivate ? "private " : ""}${e.name} = ${alias}.${e.name};` + text.slice(e.end);
}

const aliasOf = out => path.basename(out, ".ts").replace(/^docx-view-/, "").replace(/[^a-zA-Z0-9]/g, "_") + "Mod";
const importsFor = (outPath) => importBlock.map(i => i.replace(/from "\.\//g, 'from "./').replace(/from "\.\.\//g, 'from "../'));

const prune = src => {
  // buang spesifier impor yang tak terpakai
  return src.replace(/^import ([^;]+?) from "([^"]+)";\n?/gms, (full, spec, from) => {
    const body = src.replace(full, "");
    const keepIf = n => new RegExp(`(?<![\\w$.])${n.replace(/\$/g, "\\$")}(?![\\w$])`).test(body);
    const def = /^([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(spec)?.[1];
    const ns = /\*\s+as\s+([\w$]+)/.exec(spec)?.[1];
    const named = /\{([^}]*)\}/s.exec(spec)?.[1].split(",").map(s => s.trim()).filter(Boolean) ?? [];
    const keepNamed = named.filter(n => { const local = n.replace(/^type\s+/, "").split(/\s+as\s+/).pop().trim(); return keepIf(local); });
    const keepDef = def && keepIf(def) ? def : undefined;
    const keepNs = ns && keepIf(ns) ? ns : undefined;
    if (!keepNamed.length && !keepDef && !keepNs) return "";
    const parts = [keepDef, keepNs ? `* as ${keepNs}` : undefined, keepNamed.length ? `{ ${keepNamed.join(", ")} }` : undefined].filter(Boolean);
    const isType = /^type\s/.test(spec) && !keepDef;
    return `import ${isType ? "type " : ""}${parts.join(", ")} from "${from}";\n`;
  });
};

const rel = out => "./" + path.basename(out, ".ts");
for (const [out, fns] of Object.entries(moved)) {
  const outPath = path.resolve(dir, out);
  const head = `/** ${className}: ${path.basename(out)} — fungsi bagian dari kelas (\`this: ${className}\`), dipasang di kelas sebagai properti agar API publik tidak berubah. */\n`;
  const self = `import type { ${className} } from "./${path.basename(file, ".ts")}";\n`;
  const content = head + self + importsFor(outPath).join("\n") + "\n\n" + fns.map(f => f.fn).join("\n");
  writeFileSync(outPath, prune(content));
  console.log(`${out}: ${fns.length} fungsi (${fns.map(f => f.name).join(", ").slice(0, 120)})`);
}
// impor modul baru di berkas kelas (setelah impor terakhir)
const lastImport = [...text.matchAll(/^import [^;]+;\n/gms)].pop();
const mods = Object.keys(moved).map(out => `import * as ${aliasOf(out)} from "${rel(out)}";\n`).join("");
text = text.slice(0, lastImport.index + lastImport[0].length) + mods + text.slice(lastImport.index + lastImport[0].length);
writeFileSync(file, prune(text));
console.log(`${path.basename(file)} → ${text.split("\n").length} baris`);
