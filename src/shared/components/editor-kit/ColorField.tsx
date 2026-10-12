/**
 * Pemilih warna bersama editor: swatch + popover berisi palet, pemilih bawaan browser, input hex, slider alfa (opasitas),
 * dan tombol "tanpa warna" (hapus). Menggantikan `<input type="color">` polos.
 *
 * `onChange(null)` = hapus warna. `onChange({ hex, alpha })` = `hex` "#RRGGBB", `alpha` 0–1.
 * Editor yang formatnya tidak punya kanal alfa memakai `allowAlpha={false}` atau mengomposit sendiri (lihat `compositeOver`).
 * Seleksi dokumen/contenteditable disimpan saat popover dibuka dan dipulihkan sebelum `onChange`, sehingga perintah format
 * tetap bekerja pada teks yang dipilih.
 */
import { For, Show, createEffect, createSignal, onCleanup, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { alphaPct, cssRgba, normalizeHex } from "./color-util";
import "./color-field.css";

export interface ColorValue { hex: string; alpha: number }

export interface ColorFieldLabels { opacity: string; none: string; hex: string; custom: string }
const LABELS: ColorFieldLabels = { opacity: "Opacity", none: "No color", hex: "Hex", custom: "Custom" };

export const DEFAULT_SWATCHES = [
  "#000000", "#434343", "#666666", "#999999", "#CCCCCC", "#EFEFEF", "#F3F3F3", "#FFFFFF", "#7F7F7F", "#BFBFBF",
  "#980000", "#FF0000", "#FF9900", "#FFFF00", "#00FF00", "#00FFFF", "#4A86E8", "#0000FF", "#9900FF", "#FF00FF",
  "#E6B8AF", "#F4CCCC", "#FCE5CD", "#FFF2CC", "#D9EAD3", "#D0E0E3", "#C9DAF8", "#CFE2F3", "#D9D2E9", "#EAD1DC",
  "#CC4125", "#E06666", "#F6B26B", "#FFD966", "#93C47D", "#76A5AF", "#6D9EEB", "#6FA8DC", "#8E7CC3", "#C27BA0",
];

export interface ColorFieldProps {
  /** Warna saat ini ("#RRGGBB" / "RRGGBB"); kosong/null = tanpa warna. */
  value?: string | null;
  /** Opasitas saat ini 0–1 (default 1). */
  alpha?: number;
  /** Warna awal pemilih bila `value` kosong. */
  fallback?: string;
  allowAlpha?: boolean;
  allowNone?: boolean;
  disabled?: boolean;
  title?: string;
  class?: string;
  /** Glyph/ikon di samping swatch. */
  children?: JSX.Element;
  /** Sembunyikan swatch kecil pada tombol (hanya glyph + garis warna). */
  hideSwatch?: boolean;
  labels?: Partial<ColorFieldLabels>;
  swatches?: string[];
  /** Catatan kecil di bawah slider opasitas (mis. format tidak mendukung alfa asli). */
  note?: string;
  onChange: (v: ColorValue | null) => void;
}

export function ColorField(p: ColorFieldProps) {
  const L = () => ({ ...LABELS, ...p.labels });
  const [open, setOpen] = createSignal(false);
  const [pos, setPos] = createSignal({ x: 0, y: 0 });
  const curHex = () => normalizeHex(p.value) ?? "";
  const [draftHex, setDraftHex] = createSignal("#000000");
  const [draftAlpha, setDraftAlpha] = createSignal(1);
  const [hexText, setHexText] = createSignal("");
  let btn: HTMLButtonElement | undefined;
  let pop: HTMLDivElement | undefined;
  let savedRange: Range | null = null;
  let savedFocus: HTMLElement | null = null;

  const restore = () => {
    try {
      if (savedFocus && savedFocus.isConnected && savedFocus !== document.activeElement) savedFocus.focus({ preventScroll: true });
      if (savedRange) { const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(savedRange); }
    } catch { /* abaikan */ }
  };
  const openPop = () => {
    if (p.disabled) return;
    const s = window.getSelection();
    savedRange = s && s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
    savedFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDraftHex(curHex() || normalizeHex(p.fallback) || "#000000");
    setDraftAlpha(p.alpha ?? 1);
    setHexText(curHex() || normalizeHex(p.fallback) || "#000000");
    const r = btn!.getBoundingClientRect();
    const w = 232, h = 300;
    setPos({ x: Math.max(4, Math.min(r.left, window.innerWidth - w - 6)), y: r.bottom + h + 8 > window.innerHeight ? Math.max(4, r.top - h - 4) : r.bottom + 4 });
    setOpen(true);
  };
  const close = () => { setOpen(false); };
  const commit = (hex: string, alpha: number) => {
    restore();
    p.onChange({ hex, alpha: p.allowAlpha === false ? 1 : alpha });
  };
  const pick = (hex: string) => { const n = normalizeHex(hex); if (!n) return; setDraftHex(n); setHexText(n); commit(n, draftAlpha()); };

  createEffect(() => {
    if (!open()) return;
    const onDown = (e: MouseEvent) => { const t = e.target as Node; if (pop?.contains(t) || btn?.contains(t)) return; close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); restore(); } };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    onCleanup(() => { document.removeEventListener("mousedown", onDown, true); document.removeEventListener("keydown", onKey, true); });
  });

  const swatchStyle = () => (curHex() ? { background: cssRgba(curHex(), p.alpha ?? 1) } : {});

  return (
    <span class={`ck-wrap ${p.class ?? ""}`}>
      <button ref={btn} type="button" class="ck-btn" title={p.title} disabled={p.disabled} aria-haspopup="dialog" aria-expanded={open()}
        onMouseDown={e => e.preventDefault()} onClick={() => (open() ? close() : openPop())}>
        {p.children}
        <Show when={!p.hideSwatch}><span class="ck-sw" classList={{ none: !curHex() }}><i style={swatchStyle()} /></span></Show>
      </button>
      <Show when={open()}>
        <Portal>
          <div ref={pop} class="ck-pop" role="dialog" aria-label={p.title} style={{ left: `${pos().x}px`, top: `${pos().y}px` }}
            onMouseDown={e => { if (!(e.target as HTMLElement).closest("input")) e.preventDefault(); }}>
            <div class="ck-grid"><For each={p.swatches ?? DEFAULT_SWATCHES}>{c => <button type="button" title={c} style={{ background: c }} onClick={() => pick(c)} />}</For></div>
            <div class="ck-row">
              <label>{L().custom}</label>
              <input class="ck-native" type="color" value={draftHex()} onInput={e => { setDraftHex(e.currentTarget.value.toUpperCase()); setHexText(e.currentTarget.value.toUpperCase()); }} onChange={e => pick(e.currentTarget.value)} />
              <input class="ck-hex" type="text" spellcheck={false} maxLength={9} aria-label={L().hex} value={hexText()}
                onInput={e => setHexText(e.currentTarget.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); const n = normalizeHex(hexText()); if (n) pick(n); } }}
                onBlur={() => { const n = normalizeHex(hexText()); if (n && n !== draftHex()) pick(n); else setHexText(draftHex()); }} />
            </div>
            <Show when={p.allowAlpha !== false}>
              <div class="ck-row">
                <label>{L().opacity}</label>
                <input type="range" min="0" max="100" step="1" aria-label={L().opacity} value={alphaPct(draftAlpha())}
                  onInput={e => setDraftAlpha(+e.currentTarget.value / 100)} onChange={e => { const a = +e.currentTarget.value / 100; setDraftAlpha(a); commit(draftHex(), a); }} />
                <input type="number" min="0" max="100" aria-label={L().opacity} value={alphaPct(draftAlpha())}
                  onChange={e => { const a = Math.min(100, Math.max(0, +e.currentTarget.value || 0)) / 100; setDraftAlpha(a); commit(draftHex(), a); }} />
              </div>
              <div class="ck-prev"><i style={{ background: cssRgba(draftHex(), draftAlpha()) }} /></div>
              <Show when={p.note}><div class="ck-note">{p.note}</div></Show>
            </Show>
            <Show when={p.allowNone !== false}>
              <div class="ck-actions"><button type="button" class="danger" onClick={() => { restore(); p.onChange(null); close(); }}>{L().none}</button></div>
            </Show>
          </div>
        </Portal>
      </Show>
    </span>
  );
}
