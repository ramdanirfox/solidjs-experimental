import { useNavigate } from "@solidjs/router";
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { searchExamples, type IExample } from "~/shared/constants/examples";

/** Kotak pencarian halaman contoh di header. Pintasan: Ctrl/⌘+K atau "/" untuk fokus, ↑↓ memilih, Enter membuka, Esc menutup. */
export default function SJXSearchBox() {
  const navigate = useNavigate();
  let input!: HTMLInputElement;
  let box!: HTMLDivElement;
  const [q, setQ] = createSignal("");
  const [open, setOpen] = createSignal(false);
  const [cur, setCur] = createSignal(0);
  const hits = createMemo(() => searchExamples(q()).slice(0, 8));

  const close = () => { setOpen(false); input?.blur(); };
  const go = (ex: IExample) => { setQ(""); setOpen(false); input?.blur(); navigate(`/${ex.route}`); };
  const submit = () => {
    const h = hits()[cur()];
    if (h && q().trim()) return go(h.example);
    navigate(q().trim() ? `/?q=${encodeURIComponent(q().trim())}` : "/");
    close();
  };

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable;
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing)) { e.preventDefault(); input.focus(); input.select(); setOpen(true); }
    };
    const onDown = (e: MouseEvent) => { if (!box.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    onCleanup(() => { window.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); });
  });

  // tebalkan potongan yang cocok pada judul
  const Hl = (p: { text: string }) => {
    const term = q().trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    const i = term ? p.text.toLowerCase().indexOf(term) : -1;
    return i < 0 ? <>{p.text}</> : <>{p.text.slice(0, i)}<mark>{p.text.slice(i, i + term.length)}</mark>{p.text.slice(i + term.length)}</>;
  };

  return (
    <div class="sjx-search" ref={box} role="search">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3" /></svg>
      <input
        ref={input}
        type="search"
        placeholder="Cari contoh…"
        aria-label="Cari contoh komponen"
        autocomplete="off"
        value={q()}
        onFocus={() => setOpen(true)}
        onInput={e => { setQ(e.currentTarget.value); setCur(0); setOpen(true); }}
        onKeyDown={e => {
          if (e.key === "ArrowDown") { e.preventDefault(); setCur(c => Math.min(hits().length - 1, c + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setCur(c => Math.max(0, c - 1)); }
          else if (e.key === "Enter") { e.preventDefault(); submit(); }
          else if (e.key === "Escape") { e.preventDefault(); close(); }
        }}
      />
      <kbd class="sjx-kbd" aria-hidden="true">Ctrl K</kbd>
      <Show when={open()}>
        <div class="sjx-search-pop" role="listbox">
          <Show when={hits().length} fallback={<div class="sjx-search-empty">Tidak ada contoh yang cocok dengan “{q()}”.</div>}>
            <For each={hits()}>
              {(h, i) => (
                <button class="sjx-search-item" classList={{ on: cur() === i() }} role="option" aria-selected={cur() === i()} onMouseEnter={() => setCur(i())} onMouseDown={e => e.preventDefault()} onClick={() => go(h.example)}>
                  <span class="ico" style={{ background: h.example.gradient }}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d={h.example.icon} /></svg>
                  </span>
                  <span class="txt">
                    <b><Hl text={h.example.title} /></b>
                    <small>{h.example.desc}</small>
                  </span>
                  <Show when={h.example.badge}><span class="sjx-badge">{h.example.badge}</span></Show>
                </button>
              )}
            </For>
          </Show>
          <div class="sjx-search-foot">↑↓ pilih · Enter buka · Esc tutup</div>
        </div>
      </Show>
    </div>
  );
}
