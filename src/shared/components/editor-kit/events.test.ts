// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createEventBus, dispatchCommand } from "./events";

type M = { change: { n: number }; ready: undefined };

describe("event bus", () => {
  it("on/once/off/onAny dan urutan", () => {
    const bus = createEventBus<M>({ source: "t" });
    const a = vi.fn(), once = vi.fn(), any = vi.fn();
    const off = bus.on("change", a);
    bus.once("change", once);
    bus.onAny(any);
    bus.emit("change", { n: 1 });
    bus.emit("change", { n: 2 });
    off();
    bus.emit("change", { n: 3 });
    expect(a).toHaveBeenCalledTimes(2);
    expect(once).toHaveBeenCalledTimes(1);
    expect(any).toHaveBeenCalledTimes(3);
    expect(any.mock.calls[0][2].seq).toBe(1);
    expect(bus.listenerCount("change")).toBe(0);
  });

  it("galat handler tidak menghentikan handler lain", () => {
    const onError = vi.fn();
    const bus = createEventBus<M>({ source: "t", onError });
    const ok = vi.fn();
    bus.on("change", () => { throw new Error("boom"); });
    bus.on("change", ok);
    bus.emit("change", { n: 1 });
    expect(ok).toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("history dibatasi", () => {
    const bus = createEventBus<M>({ source: "t", historySize: 3 });
    for (let i = 0; i < 5; i++) bus.emit("change", { n: i });
    expect(bus.history().map(h => (h.payload as { n: number }).n)).toEqual([2, 3, 4]);
  });

  it("wait menunggu event berikutnya dan timeout", async () => {
    const bus = createEventBus<M>({ source: "t" });
    const p = bus.wait("change");
    bus.emit("change", { n: 7 });
    expect(await p).toEqual({ n: 7 });
    await expect(bus.wait("ready", 5)).rejects.toThrow(/timeout/);
  });

  it("perintah: daftar, jalankan, tidak dikenal", async () => {
    const bus = createEventBus<M>({ source: "t" });
    const off = bus.registerCommand("add", (a: number, b: number) => a + b);
    expect(bus.commands()).toEqual(["add"]);
    expect(await bus.run("add", 1, 2)).toBe(3);
    await expect(bus.run("nope")).rejects.toThrow(/tidak dikenal/);
    off();
    expect(bus.hasCommand("add")).toBe(false);
  });

  it("jembatan DOM: event keluar naik ke induk, perintah masuk lewat CustomEvent", async () => {
    const bus = createEventBus<M>({ source: "t", domPrefix: "t-editor" });
    const parent = document.createElement("div"), child = document.createElement("div");
    parent.appendChild(child);
    const heard = vi.fn();
    parent.addEventListener("t-editor:change", e => heard((e as CustomEvent).detail));
    const detach = bus.attach(child);
    bus.registerCommand("echo", (x: string) => `echo:${x}`);
    bus.emit("change", { n: 9 });
    expect(heard).toHaveBeenCalledWith({ n: 9 });
    expect(await dispatchCommand(child, "t-editor", "echo", "hi")).toBe("echo:hi");
    detach();
    bus.emit("change", { n: 10 });
    expect(heard).toHaveBeenCalledTimes(1);
    await expect(dispatchCommand(child, "t-editor", "echo")).rejects.toThrow();
  });
});
