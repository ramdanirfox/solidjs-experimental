// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const FEATURES = ["docx-editor", "pptx-editor", "xlsx-preview", "maxgraph-editor"];
const files = (dir: string): string[] => readdirSync(dir).flatMap(f => { const p = path.join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [p] : []; });
const importsOf = (file: string) => [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)].map(m => m[1]);

/** Batas modul: editor-kit & office-shared tidak bergantung pada editor; editor tidak saling mengimpor. */
describe("batas modul", () => {
  it("editor-kit dan office-shared tidak mengimpor editor mana pun", () => {
    for (const lib of ["editor-kit", "office-shared"]) for (const f of files(path.join(root, lib))) for (const i of importsOf(f)) {
      const target = path.resolve(path.dirname(f), i);
      expect(FEATURES.some(x => target.startsWith(path.join(root, x))), `${path.relative(root, f)} → ${i}`).toBe(false);
    }
  });
  it("satu editor tidak mengimpor editor lain", () => {
    for (const feat of FEATURES) for (const f of files(path.join(root, feat))) for (const i of importsOf(f)) {
      const target = path.resolve(path.dirname(f), i);
      for (const other of FEATURES.filter(x => x !== feat)) expect(target.startsWith(path.join(root, other)), `${path.relative(root, f)} → ${i}`).toBe(false);
    }
  });
  it("editor-kit tidak mengimpor office-shared (arah: editor → office-shared → ... ; kit berdiri sendiri kecuali OLE)", () => {
    const bad = files(path.join(root, "editor-kit")).flatMap(f => importsOf(f).filter(i => path.resolve(path.dirname(f), i).startsWith(path.join(root, "office-shared"))).map(i => `${path.relative(root, f)} → ${i}`));
    // office-events.ts memakai tipe OLE bersama — satu-satunya pengecualian yang diizinkan
    expect(bad.filter(b => !/^editor-kit[\\/]office-events\.ts/.test(b))).toEqual([]);
  });
});
