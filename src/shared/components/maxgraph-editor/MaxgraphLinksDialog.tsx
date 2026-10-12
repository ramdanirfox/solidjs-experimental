/** Dialog pengelola hyperlink sel: pasang/hapus tautan pada seleksi dan kelola semua tautan diagram (lihat `editor-kit/LinkPanel`). */
import { Show, createSignal } from "solid-js";
import { LinkPanel, LINK_LABELS_ID } from "../editor-kit/LinkPanel";
import type { LinkItem } from "../editor-kit/hyperlink";

interface Props {
    items: LinkItem[];
    readonly: boolean;
    /** Jumlah sel terpilih dan tautan sel pertama (jika ada). */
    selectionCount: number;
    selectionUrl: string;
    selectionTooltip: string;
    onSet: (url: string, tooltip: string) => boolean;
    onRemoveSelection: () => void;
    onGoto: (item: LinkItem) => void;
    onUpdate: (item: LinkItem, patch: { url?: string; tooltip?: string }) => void;
    onRemove: (item: LinkItem) => void;
    onReplace: (from: string, to: string) => number;
    onOpen: (item: LinkItem) => void;
    onClose: () => void;
}

export const MaxgraphLinksDialog = (p: Props) => {
    const [url, setUrl] = createSignal(p.selectionUrl || "https://");
    const [tip, setTip] = createSignal(p.selectionTooltip);
    const [msg, setMsg] = createSignal("");
    const apply = () => { if (p.onSet(url(), tip())) setMsg(""); else setMsg("URL tidak valid atau tidak aman"); };
    return (
        <div class="mgx-modal" role="dialog" aria-modal="true" aria-label="Kelola tautan" onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); p.onClose(); } }}>
            <div class="mgx-modal-card" style={{ width: "520px", "max-width": "96vw" }}>
                <header class="mgx-modal-head">
                    <b>Kelola tautan</b>
                    <button type="button" class="mgx-btn" aria-label="Tutup" onClick={p.onClose}>✕</button>
                </header>
                <div class="mgx-modal-body">
                    <Show when={!p.readonly}>
                        <div class="mgx-muted">Tautan untuk {p.selectionCount ? `${p.selectionCount} sel terpilih` : "sel terpilih (pilih sel dulu)"}</div>
                        <input class="mgx-input" placeholder="https://…, mailto:…, atau #id-sel" value={url()} disabled={!p.selectionCount} onInput={e => setUrl(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); apply(); } }} />
                        <input class="mgx-input" placeholder="Tooltip (opsional)" value={tip()} disabled={!p.selectionCount} onInput={e => setTip(e.currentTarget.value)} />
                        <div style={{ display: "flex", gap: "6px" }}>
                            <button type="button" class="mgx-btn mgx-txt mgx-primary" disabled={!p.selectionCount} onClick={apply}>Terapkan</button>
                            <button type="button" class="mgx-btn mgx-txt" disabled={!p.selectionCount} onClick={p.onRemoveSelection}>Hapus tautan</button>
                            <span class="mgx-muted">{msg()}</span>
                        </div>
                    </Show>
                    <LinkPanel items={p.items} readonly={p.readonly} tooltips labels={LINK_LABELS_ID} onGoto={p.onGoto} onUpdate={p.onUpdate} onRemove={p.onRemove} onReplace={p.onReplace} onOpen={p.onOpen} onNotify={setMsg} />
                </div>
            </div>
        </div>
    );
};
