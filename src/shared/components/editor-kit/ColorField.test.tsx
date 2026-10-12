// @vitest-environment jsdom
import { render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColorField } from "./ColorField";
import { LinkPanel } from "./LinkPanel";

afterEach(() => { document.body.innerHTML = ""; });

describe("ColorField", () => {
  it("swatch, alfa, hex, dan 'tanpa warna' memanggil onChange", () => {
    const onChange = vi.fn();
    const { container } = render(() => <ColorField title="c" value="#112233" onChange={onChange}>A</ColorField>);
    (container.querySelector(".ck-btn") as HTMLElement).click();
    const pop = document.querySelector(".ck-pop") as HTMLElement;
    expect(pop).toBeTruthy();
    (pop.querySelector(".ck-grid button") as HTMLElement).click();
    expect(onChange).toHaveBeenLastCalledWith({ hex: "#000000", alpha: 1 });
    const num = pop.querySelector<HTMLInputElement>('input[type="number"]')!;
    num.value = "40"; num.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onChange.mock.lastCall![0].alpha).toBeCloseTo(0.4);
    const hex = pop.querySelector<HTMLInputElement>(".ck-hex")!;
    hex.value = "#ABCDEF"; hex.dispatchEvent(new Event("input", { bubbles: true }));
    hex.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onChange.mock.lastCall![0].hex).toBe("#ABCDEF");
    (pop.querySelector(".ck-actions .danger") as HTMLElement).click();
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(document.querySelector(".ck-pop")).toBeNull();
  });
  it("allowAlpha=false menyembunyikan slider dan memaksa alfa 1", () => {
    const onChange = vi.fn();
    const { container } = render(() => <ColorField allowAlpha={false} allowNone={false} onChange={onChange} />);
    (container.querySelector(".ck-btn") as HTMLElement).click();
    expect(document.querySelector('.ck-pop input[type="range"]')).toBeNull();
    expect(document.querySelector(".ck-actions")).toBeNull();
    (document.querySelector(".ck-grid button") as HTMLElement).click();
    expect(onChange.mock.lastCall![0].alpha).toBe(1);
  });
});

describe("LinkPanel", () => {
  const items = [{ id: "1", url: "https://a.test/x", text: "A", kind: "web" as const, location: "S1", target: { kind: "x" } }];
  it("daftar, ubah (URL dinormalisasi/ditolak), hapus, ganti massal", () => {
    const onUpdate = vi.fn(), onRemove = vi.fn(), onReplace = vi.fn(() => 3), onNotify = vi.fn();
    const { container } = render(() => <LinkPanel items={items} onGoto={() => {}} onUpdate={onUpdate} onRemove={onRemove} onReplace={onReplace} onNotify={onNotify} />);
    expect(container.textContent).toContain("https://a.test/x");
    const btn = (t: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === t)!;
    btn("Remove").click();
    expect(onRemove).toHaveBeenCalled();
    btn("Edit").click();
    const input = container.querySelector<HTMLInputElement>(".lk-edit input")!;
    input.value = "javascript:x"; input.dispatchEvent(new Event("input", { bubbles: true }));
    btn("Save").click();
    expect(onUpdate).not.toHaveBeenCalled();
    input.value = "b.test"; input.dispatchEvent(new Event("input", { bubbles: true }));
    btn("Save").click();
    expect(onUpdate).toHaveBeenCalledWith(items[0], { url: "https://b.test" });
    const [from, to] = container.querySelectorAll<HTMLInputElement>(".lk-bulk input");
    from.value = "a.test"; from.dispatchEvent(new Event("input", { bubbles: true }));
    to.value = "c.test"; to.dispatchEvent(new Event("input", { bubbles: true }));
    (container.querySelector(".lk-bulk button") as HTMLElement).click();
    expect(onReplace).toHaveBeenCalledWith("a.test", "c.test");
    expect(onNotify).toHaveBeenLastCalledWith("3 link(s) updated");
  });
});
