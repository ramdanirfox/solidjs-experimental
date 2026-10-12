/**
 * Panel pengelola hyperlink bersama editor: daftar semua tautan, filter, buka, lompat ke lokasi, ubah URL/tooltip,
 * hapus, dan ganti URL massal (mis. ganti domain). Editor memasok data & aksi; komponen ini hanya UI.
 */
import { For, Show, createMemo, createSignal } from "solid-js";
import { classifyLink, normalizeLink, openExternal, type LinkItem } from "./hyperlink";
import "./link-panel.css";

export interface LinkPanelLabels {
  title: string; empty: string; filter: string; open: string; goto: string; edit: string; remove: string; save: string; cancel: string;
  url: string; tooltip: string; replaceAll: string; from: string; to: string; replaced: string; invalid: string; count: string;
}
export const LINK_LABELS_EN: LinkPanelLabels = {
  title: "Hyperlinks", empty: "No hyperlinks in this document.", filter: "Filter…", open: "Open", goto: "Go to", edit: "Edit", remove: "Remove", save: "Save", cancel: "Cancel",
  url: "URL", tooltip: "Tooltip", replaceAll: "Replace in all links", from: "Find in URL", to: "Replace with", replaced: "{n} link(s) updated", invalid: "Invalid or unsafe URL", count: "links",
};
export const LINK_LABELS_ID: LinkPanelLabels = {
  title: "Hyperlink", empty: "Tidak ada hyperlink di dokumen ini.", filter: "Saring…", open: "Buka", goto: "Lompat", edit: "Ubah", remove: "Hapus", save: "Simpan", cancel: "Batal",
  url: "URL", tooltip: "Tooltip", replaceAll: "Ganti di semua tautan", from: "Cari di URL", to: "Ganti dengan", replaced: "{n} tautan diperbarui", invalid: "URL tidak valid atau tidak aman", count: "tautan",
};

export interface LinkPanelProps {
  items: LinkItem[];
  readonly?: boolean;
  labels?: Partial<LinkPanelLabels>;
  /** Boleh mengubah tooltip (tidak semua editor mendukung). */
  tooltips?: boolean;
  onGoto: (item: LinkItem) => void;
  onUpdate: (item: LinkItem, patch: { url?: string; tooltip?: string }) => void;
  onRemove: (item: LinkItem) => void;
  /** Mengembalikan jumlah tautan yang berubah. */
  onReplace: (from: string, to: string) => number;
  /** Dipanggil untuk membuka tautan; default: tab baru untuk URL eksternal. */
  onOpen?: (item: LinkItem) => void;
  onNotify?: (msg: string) => void;
}

export function LinkPanel(p: LinkPanelProps) {
  const L = () => ({ ...LINK_LABELS_EN, ...p.labels });
  const [q, setQ] = createSignal("");
  const [editId, setEditId] = createSignal<string | null>(null);
  const [eUrl, setEUrl] = createSignal("");
  const [eTip, setETip] = createSignal("");
  const [from, setFrom] = createSignal("");
  const [to, setTo] = createSignal("");
  const rows = createMemo(() => {
    const f = q().trim().toLowerCase();
    return f ? p.items.filter(i => (i.url + " " + i.text + " " + i.location).toLowerCase().includes(f)) : p.items;
  });
  const startEdit = (i: LinkItem) => { setEditId(i.id); setEUrl(i.url); setETip(i.tooltip ?? ""); };
  const save = (i: LinkItem) => {
    const n = normalizeLink(eUrl());
    if (!n) { p.onNotify?.(L().invalid); return; }
    p.onUpdate(i, { url: n, ...(p.tooltips ? { tooltip: eTip() } : {}) });
    setEditId(null);
  };
  const open = (i: LinkItem) => { if (p.onOpen) p.onOpen(i); else openExternal(i.url); };
  const doReplace = () => {
    if (!from()) return;
    const n = p.onReplace(from(), to());
    p.onNotify?.(L().replaced.replace("{n}", String(n)));
  };

  return (
    <div class="lk-panel">
      <div class="lk-head"><b>{L().title}</b><span class="lk-count">{p.items.length} {L().count}</span></div>
      <input class="lk-in" placeholder={L().filter} value={q()} onInput={e => setQ(e.currentTarget.value)} />
      <Show when={!p.readonly}>
        <details class="lk-bulk">
          <summary>{L().replaceAll}</summary>
          <input class="lk-in" placeholder={L().from} value={from()} onInput={e => setFrom(e.currentTarget.value)} />
          <input class="lk-in" placeholder={L().to} value={to()} onInput={e => setTo(e.currentTarget.value)} />
          <button type="button" class="lk-btn" disabled={!from() || !p.items.length} onClick={doReplace}>{L().replaceAll}</button>
        </details>
      </Show>
      <Show when={rows().length} fallback={<div class="lk-empty">{L().empty}</div>}>
        <ul class="lk-list">
          <For each={rows()}>{it => (
            <li class="lk-item" data-kind={it.kind || classifyLink(it.url)}>
              <Show when={editId() !== it.id} fallback={
                <div class="lk-edit">
                  <label>{L().url}<input class="lk-in" value={eUrl()} onInput={e => setEUrl(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") save(it); else if (e.key === "Escape") setEditId(null); }} /></label>
                  <Show when={p.tooltips}><label>{L().tooltip}<input class="lk-in" value={eTip()} onInput={e => setETip(e.currentTarget.value)} /></label></Show>
                  <div class="lk-actions"><button type="button" class="lk-btn primary" onClick={() => save(it)}>{L().save}</button><button type="button" class="lk-btn" onClick={() => setEditId(null)}>{L().cancel}</button></div>
                </div>
              }>
                <div class="lk-main" onClick={() => p.onGoto(it)} title={L().goto}>
                  <span class="lk-text">{it.text || "—"}</span>
                  <span class="lk-url">{it.url}</span>
                  <span class="lk-loc">{it.location}</span>
                </div>
                <div class="lk-actions">
                  <button type="button" class="lk-btn" onClick={() => open(it)}>{L().open}</button>
                  <Show when={!p.readonly}>
                    <button type="button" class="lk-btn" onClick={() => startEdit(it)}>{L().edit}</button>
                    <button type="button" class="lk-btn danger" onClick={() => p.onRemove(it)}>{L().remove}</button>
                  </Show>
                </div>
              </Show>
            </li>
          )}</For>
        </ul>
      </Show>
    </div>
  );
}
