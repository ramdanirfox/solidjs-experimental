/**
 * Pelengkap `split-class.mjs`: dari keluaran tsc (stdin) tambahkan impor untuk "Cannot find name 'X'" pada modul pecahan,
 * dengan mencari X pada (1) impor berkas kelas asli (cadangan), (2) ekspor modul shared, (3) tipe yang diekspor kelas.
 *
 *   node scripts/fix-split-imports.mjs <kelas.ts> <cadangan-kelas-asli.ts> <shared.ts> < tsc.txt
 */
import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [classFile, backupFile, sharedFile] = process.argv.slice(2).map(p => path.resolve(p));
const out = readFileSync(0, "utf8");
const wanted = new Map(); // file -> Set(names)
for (const m of out.matchAll(/^(\S+?)\((\d+),(\d+)\): error TS2304: Cannot find name '([\w$]+)'/gm)) {
  const f = path.resolve(m[1]);
  if (f === classFile) continue;
  (wanted.get(f) ?? wanted.set(f, new Set()).get(f)).add(m[4]);
}
const parseImports = file => {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ESNext, true);
  const map = new Map(); // name -> {from, isType}
  for (const s of sf.statements) if (ts.isImportDeclaration(s) && s.importClause?.namedBindings && ts.isNamedImports(s.importClause.namedBindings)) {
    const from = s.moduleSpecifier.text;
    for (const el of s.importClause.namedBindings.elements) map.set(el.name.text, { from, isType: s.importClause.isTypeOnly || el.isTypeOnly });
  }
  return map;
};
const exportsOf = file => {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ESNext, true);
  const m = new Map();
  for (const s of sf.statements) {
    if (!s.modifiers?.some(x => x.kind === ts.SyntaxKind.ExportKeyword)) continue;
    const isType = ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s);
    const names = s.name ? [s.name.text] : s.declarationList ? s.declarationList.declarations.map(d => d.name.text) : [];
    for (const n of names) m.set(n, { isType });
  }
  return m;
};
const orig = parseImports(backupFile);
const shared = exportsOf(sharedFile);
const klass = exportsOf(classFile);
const base = f => "./" + path.basename(f, ".ts");
for (const [file, names] of wanted) {
  const add = new Map(); // from -> [{name,isType}]
  for (const n of names) {
    let src;
    if (shared.has(n)) src = { from: base(sharedFile), isType: shared.get(n).isType };
    else if (orig.has(n)) src = orig.get(n);
    else if (klass.has(n)) src = { from: base(classFile), isType: klass.get(n).isType };
    else { console.log(`  ? ${path.basename(file)}: ${n} tidak ditemukan`); continue; }
    (add.get(src.from) ?? add.set(src.from, []).get(src.from)).push({ n, t: src.isType });
  }
  let text = readFileSync(file, "utf8");
  const lines = [...add].map(([from, list]) => `import { ${list.map(x => (x.t ? "type " : "") + x.n).join(", ")} } from "${from}";`);
  const first = text.indexOf("\nimport ");
  text = text.slice(0, first + 1) + lines.join("\n") + "\n" + text.slice(first + 1);
  writeFileSync(file, text);
  console.log(`${path.basename(file)}: +${names.size} (${[...names].join(", ")})`);
}
