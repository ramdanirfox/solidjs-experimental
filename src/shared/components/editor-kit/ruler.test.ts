// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { buildTicks, chooseStep, formatMeasure, pxToUnit, snapSpan, snapValue, unitToPx } from "./ruler-core";
import { RulerKit, type RulerEventMap } from "./ruler-kit";

describe("ruler-core", () => {
  it("konversi satuan", () => {
    expect(pxToUnit(96, "in")).toBeCloseTo(1);
    expect(unitToPx(2.54, "cm")).toBeCloseTo(96);
    expect(formatMeasure(96, "cm")).toBe("2.54 cm");
    expect(formatMeasure(96, "px")).toBe("96 px");
  });

  it("langkah mayor menyesuaikan zoom dan jaraknya ≥ minimum", () => {
    for (const scale of [0.25, 0.5, 1, 2, 4]) for (const unit of ["cm", "mm", "in", "pt", "px"] as const) {
      const { major } = chooseStep(unit, scale, 50);
      expect(major * unitToPx(1, unit) * scale).toBeGreaterThanOrEqual(50 - 1e-6);
    }
    expect(chooseStep("cm", 1).major).toBe(2); // 1 cm = 37.8px < 50 → 2 cm
    expect(chooseStep("cm", 2).major).toBe(1);
  });

  it("tick: posisi, label mayor, titik nol bergeser", () => {
    const t = buildTicks({ unit: "cm", scale: 1, origin: 100, zero: 0, length: 400 });
    const zero = t.find(x => x.value === 0)!;
    expect(zero.kind).toBe("major");
    expect(zero.pos).toBeCloseTo(100);
    expect(zero.label).toBe("0");
    const two = t.find(x => x.value === 2)!;
    expect(two.pos).toBeCloseTo(100 + 2 * (96 / 2.54));
    // titik nol digeser ke 96px dokumen → angka 0 ada di posisi layar 100+96
    const t2 = buildTicks({ unit: "cm", scale: 1, origin: 100, zero: 96, length: 400 });
    expect(t2.find(x => x.value === 0)!.pos).toBeCloseTo(196);
    // nilai negatif muncul di kiri titik nol
    expect(t2.some(x => x.value < 0)).toBe(true);
  });

  it("tick kosong untuk input tak valid", () => {
    expect(buildTicks({ unit: "cm", scale: 0, origin: 0, zero: 0, length: 100 })).toEqual([]);
    expect(buildTicks({ unit: "cm", scale: 1, origin: 0, zero: 0, length: 0 })).toEqual([]);
  });

  it("snap nilai dan rentang", () => {
    expect(snapValue(103, [100, 200], 5)).toEqual({ value: 100, hit: 100 });
    expect(snapValue(110, [100, 200], 5)).toEqual({ value: 110, hit: null });
    // sisi kanan rentang (95+103=198) menempel ke 200
    const r = snapSpan(95, 103, [200], 5);
    expect(r.edge).toBe("end");
    expect(r.value).toBeCloseTo(97);
  });
});

function frame() {
  const f = document.createElement("div");
  const body = document.createElement("div");
  body.className = "rk-body";
  f.appendChild(body);
  document.body.appendChild(f);
  return f;
}

describe("RulerKit", () => {
  const geom = () => ({ originX: 0, originY: 0, scale: 1, zeroX: 0, zeroY: 0 });

  it("tampil/sembunyi, ganti satuan, memancarkan event", () => {
    const emit = vi.fn();
    const kit = new RulerKit({ frame: frame(), getGeometry: geom, emit: emit as never });
    expect(kit.isVisible()).toBe(false);
    kit.setVisible(true);
    expect(kit.frame.classList.contains("rk-on")).toBe(true);
    kit.setUnit("in");
    expect(emit).toHaveBeenCalledWith("ruler:visible", { visible: true });
    expect(emit).toHaveBeenCalledWith("ruler:unit", { unit: "in" });
    kit.cycleUnit();
    expect(kit.getUnit()).not.toBe("in");
    kit.destroy();
  });

  it("guide: tambah, pindah, hapus, snap", () => {
    const events: [string, unknown][] = [];
    const kit = new RulerKit({ frame: frame(), visible: true, getGeometry: geom, emit: ((t: keyof RulerEventMap, p: unknown) => events.push([t, p])) as never });
    const g = kit.addGuide("x", 200);
    kit.addGuide("y", 50);
    expect(kit.getGuides()).toHaveLength(2);
    expect(kit.snap({ x: 203 }).x).toBe(200);
    expect(kit.snap({ x: 230 }).hitX).toBeNull();
    expect(kit.snap({ x: 100, w: 98 }).x).toBe(102); // sisi kanan (198) menempel ke 200
    kit.moveGuide(g.id, 300);
    expect(kit.guidePositions("x")).toEqual([300]);
    kit.removeGuide(g.id);
    expect(kit.guidePositions("x")).toEqual([]);
    expect(events.map(e => e[0])).toEqual(["ruler:guide-add", "ruler:guide-add", "ruler:guide-move", "ruler:guide-remove"]);
    kit.setGuides([{ axis: "x", pos: 10 }]);
    expect(kit.getGuides()).toHaveLength(1);
    kit.clearGuides();
    expect(kit.getGuides()).toHaveLength(0);
  });

  it("snap nonaktif saat penggaris disembunyikan", () => {
    const kit = new RulerKit({ frame: frame(), getGeometry: geom });
    kit.addGuide("x", 200);
    expect(kit.snap({ x: 201 }).x).toBe(201);
  });

  it("ukur: jarak, Δ, sudut, dan teks", () => {
    const emit = vi.fn();
    const kit = new RulerKit({ frame: frame(), visible: true, unit: "px", getGeometry: geom, emit: emit as never });
    const m = kit.measure(0, 0, 30, 40);
    expect(m.distance).toBe(50);
    expect(m.text).toContain("50 px");
    expect(emit).toHaveBeenCalledWith("ruler:measure", expect.objectContaining({ distance: 50 }));
    kit.clearMeasure();
    expect(kit.getLastMeasure()).toBeNull();
  });

  it("konversi koordinat memakai geometri", () => {
    const kit = new RulerKit({ frame: frame(), visible: true, getGeometry: () => ({ originX: 10, originY: 20, scale: 2, zeroX: 5, zeroY: 5 }) });
    expect(kit.toScreen(10, 10)).toEqual({ x: 30, y: 40 });
    expect(kit.fromZero("x", 5 + 96)).toBeCloseTo(2.54);
  });
});
