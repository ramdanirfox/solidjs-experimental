/**
 * Mode tata letak bersama editor (`layout`): `desktop` | `compact` | `touch`, atau `auto` (default).
 *
 * - `desktop`: pita/toolbar penuh, target kursor presisi.
 * - `compact`: bilah satu baris yang dapat digulir, panel samping menjadi lembar bawah, miniatur slide jadi strip — masih input pointer presisi
 *   (mis. panel sempit di desktop).
 * - `touch`: seperti `compact` bila lebar sempit, ditambah target sentuh besar (≥ 40px) dan gagang yang diperbesar.
 * - `auto`: `touch` bila pointer utama kasar (`(pointer: coarse)`), selain itu `compact` bila lebar **editor itu sendiri** < `NARROW_MAX`, selain itu `desktop`.
 *
 * Mode dipasang pada akar editor sebagai `data-layout="<mode>"` (+ `data-narrow="true"` bila lebar sempit); seluruh CSS (`layout.css`) dan JS
 * membaca nilai yang sama. Kontroler tidak bergantung pada framework.
 */
import "./layout.css";

export type LayoutMode = "desktop" | "compact" | "touch";
export type LayoutSetting = "auto" | LayoutMode;
export const LAYOUT_MODES: readonly LayoutMode[] = ["desktop", "compact", "touch"];
/** Lebar editor (px) di bawah ini dianggap sempit. */
export const NARROW_MAX = 720;

export interface LayoutInfo {
  /** Pengaturan dari developer (`auto` atau mode eksplisit). */
  setting: LayoutSetting;
  /** Mode yang berlaku. */
  mode: LayoutMode;
  /** Lebar akar editor (px) saat terakhir diukur. */
  width: number;
  /** Pointer utama kasar (layar sentuh). */
  coarse: boolean;
  narrow: boolean;
}

export interface OfficeLayoutEvents { layout: LayoutInfo }

export const isLayoutSetting = (v: unknown): v is LayoutSetting => v === "auto" || (typeof v === "string" && (LAYOUT_MODES as readonly string[]).includes(v));

/** Murni: mode yang berlaku untuk pengaturan + ukuran + jenis pointer. */
export function resolveLayout(setting: LayoutSetting, width: number, coarse: boolean): LayoutMode {
  if (setting !== "auto") return setting;
  if (coarse) return "touch";
  return width > 0 && width < NARROW_MAX ? "compact" : "desktop";
}

export interface LayoutController {
  info(): LayoutInfo;
  mode(): LayoutMode;
  setting(): LayoutSetting;
  /** Ubah pengaturan (nilai tak valid diabaikan → false). */
  set(setting: LayoutSetting): boolean;
  /** Ukur ulang (mis. setelah akar berubah ukuran di lingkungan tanpa ResizeObserver). */
  refresh(): void;
  destroy(): void;
}

export interface LayoutOptions {
  setting?: LayoutSetting;
  /** Dipanggil bila `mode`/`narrow`/`setting` berubah (juga pada pemasangan awal). */
  onChange?: (info: LayoutInfo) => void;
}

export function createLayoutController(el: HTMLElement, opts: LayoutOptions = {}): LayoutController {
  let setting: LayoutSetting = isLayoutSetting(opts.setting) ? opts.setting : "auto";
  let width = el.clientWidth || el.getBoundingClientRect().width || 0;
  const mq = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(pointer: coarse)") : undefined;
  let coarse = !!mq?.matches;
  let last = "";

  const compute = (): LayoutInfo => ({ setting, mode: resolveLayout(setting, width, coarse), width, coarse, narrow: width > 0 && width < NARROW_MAX });
  const apply = () => {
    const i = compute();
    el.dataset.layout = i.mode;
    if (i.narrow) el.dataset.narrow = "true"; else delete el.dataset.narrow;
    const key = `${i.setting}|${i.mode}|${i.narrow}`;
    if (key !== last) { last = key; opts.onChange?.(i); }
  };
  const measure = () => { width = el.clientWidth || el.getBoundingClientRect().width || width; apply(); };
  const onMq = () => { coarse = !!mq?.matches; apply(); };

  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : undefined;
  ro?.observe(el);
  mq?.addEventListener?.("change", onMq);
  apply();

  return {
    info: compute, mode: () => compute().mode, setting: () => setting,
    set(s) { if (!isLayoutSetting(s)) return false; setting = s; apply(); return true; },
    refresh: measure,
    destroy() { ro?.disconnect(); mq?.removeEventListener?.("change", onMq); },
  };
}
