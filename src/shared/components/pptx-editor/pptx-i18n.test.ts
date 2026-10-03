// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DICTS, translate } from "./pptx-i18n";

const dir = __dirname;
const sources = readdirSync(dir).filter(f => /\.(tsx?)$/.test(f) && !/\.test\./.test(f) && f !== "pptx-i18n.ts").map(f => readFileSync(join(dir, f), "utf8"));

describe("i18n (pptx)", () => {
  it("en dan id memiliki kunci yang sama", () => {
    const a = Object.keys(DICTS.en).sort(), b = Object.keys(DICTS.id).sort();
    expect(b.filter(k => !a.includes(k)), "kunci id tanpa en").toEqual([]);
    expect(a.filter(k => !b.includes(k)), "kunci en tanpa id").toEqual([]);
  });

  it("semua kunci literal yang dipakai kode tersedia", () => {
    const used = new Set<string>();
    for (const s of sources) {
      for (const m of s.matchAll(/\bt\("([a-zA-Z][\w.-]*[\w])"/g)) used.add(m[1]);
      for (const m of s.matchAll(/"((?:hist|log|toast|busy|prompt)\.[A-Za-z-]+)"/g)) used.add(m[1]);
    }
    const missing = [...used].filter(k => !DICTS.en[k]);
    expect(missing).toEqual([]);
  });

  it("keluarga kunci dinamis lengkap", () => {
    const fam: Record<string, string[]> = {
      tab: ["home", "insert", "format", "table", "chart", "picture", "slide", "view"],
      panel: ["find", "info", "log", "ole", "history"],
      prop: ["title", "creator", "subject", "keywords", "description", "category"],
      pk: ["fill", "stroke", "font", "size", "bold", "italic", "color", "align"],
      err: ["empty", "legacy-ppt", "encrypted", "not-zip", "parse", "fetch"],
      c: ["column", "bar", "line", "area", "pie", "doughnut", "scatter", "radar"],
      al: ["left", "center", "right", "top", "middle", "bottom", "hdist", "vdist"],
      "p.crop": ["left", "top", "right", "bottom"],
      busy: ["loading", "opening", "sample"],
    };
    for (const [p, ks] of Object.entries(fam)) for (const k of ks) expect(DICTS.id[`${p}.${k}`], `${p}.${k}`).toBeTruthy();
  });

  it("log: setiap kunci log yang dipakai model/view/render ada", () => {
    const src = sources.join("\n");
    const keys = new Set([...src.matchAll(/["'](log\.[A-Za-z-]+)["']/g)].map(m => m[1]));
    for (const k of keys) expect(DICTS.en[k], k).toBeTruthy();
  });

  it("label riwayat yang dipakai view tersedia", () => {
    const src = readFileSync(join(dir, "pptx-view.ts"), "utf8");
    const labels = new Set([...src.matchAll(/["'](hist\.[A-Za-z]+)["']/g)].map(m => m[1]));
    for (const k of labels) expect(DICTS.en[k], k).toBeTruthy();
  });

  it("interpolasi parameter", () => {
    expect(translate("id", "s.slide", { i: 2, n: 5 })).toBe("Slide 2 dari 5");
    expect(translate("en", "s.slide", { i: 2, n: 5 })).toBe("Slide 2 of 5");
    expect(translate("en", "tidak.ada")).toBe("tidak.ada");
  });
});
