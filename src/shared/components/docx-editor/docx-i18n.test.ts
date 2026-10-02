// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DICTS, translate } from "./docx-i18n";

const dir = __dirname;
const sources = readdirSync(dir).filter(f => /\.(tsx?)$/.test(f) && !/\.test\./.test(f) && f !== "docx-i18n.ts").map(f => readFileSync(join(dir, f), "utf8"));

describe("i18n", () => {
  it("en dan id memiliki kunci yang sama", () => {
    const a = Object.keys(DICTS.en).sort(), b = Object.keys(DICTS.id).sort();
    expect(b.filter(k => !a.includes(k)), "kunci id tanpa en").toEqual([]);
    expect(a.filter(k => !b.includes(k)), "kunci en tanpa id").toEqual([]);
  });

  it("semua kunci literal yang dipakai kode tersedia", () => {
    const used = new Set<string>();
    for (const s of sources) {
      for (const m of s.matchAll(/\bt\("([a-zA-Z][\w.-]*[\w])"/g)) used.add(m[1]);
      for (const m of s.matchAll(/"((?:hist|log|toast|busy)\.[A-Za-z]+)"/g)) used.add(m[1]);
    }
    const missing = [...used].filter(k => !DICTS.en[k]);
    expect(missing).toEqual([]);
  });

  it("keluarga kunci dinamis lengkap", () => {
    const fam: Record<string, string[]> = {
      tab: ["home", "insert", "table", "picture", "layout", "view"],
      wrap: ["inline", "square", "topBottom", "behind", "front"],
      bd: ["all", "outer", "inner", "top", "bottom", "left", "right", "insideH", "insideV", "none"],
      panel: ["find", "info", "log", "ole", "history", "outline"],
      prop: ["title", "creator", "subject", "keywords", "description", "category", "lastModifiedBy", "created", "modified", "revision"],
      pk: ["font", "size", "bold", "italic", "underline", "strike", "color", "highlight", "vert", "caps", "smallCaps", "style", "align", "indLeft", "spacing", "line", "list", "shading"],
      err: ["empty", "legacy-doc", "encrypted", "not-zip", "no-main", "parse", "fetch"],
      l: ["top", "bottom", "left", "right", "m.normal", "m.narrow", "m.moderate", "m.wide"],
      busy: ["loading", "opening", "sample"],
    };
    for (const [p, ks] of Object.entries(fam)) for (const k of ks) expect(DICTS.id[`${p}.${k}`], `${p}.${k}`).toBeTruthy();
  });

  it("log: setiap kunci log yang dipakai model/view ada", () => {
    const src = sources.join("\n");
    const keys = new Set([...src.matchAll(/["'](log\.[A-Za-z]+)["']/g)].map(m => m[1]));
    for (const k of keys) expect(DICTS.en[k], k).toBeTruthy();
  });

  it("interpolasi parameter", () => {
    expect(translate("id", "s.page", { p: 2, n: 5 })).toBe("Halaman 2 dari 5");
    expect(translate("en", "s.page", { p: 2, n: 5 })).toBe("Page 2 of 5");
    expect(translate("en", "tidak.ada")).toBe("tidak.ada");
  });
});
