import { Show, createMemo, createSignal } from "solid-js";
import { htmlToPlain, plainToHtml, sanitizeHtmlLabel } from "./drawio";

export interface HtmlLabelDialogProps {
    /** Isi label saat ini (HTML bila `html`, selain itu teks polos). */
    value: string;
    html: boolean;
    /** Nama sel untuk judul. */
    title?: string;
    onApply: (value: string, html: boolean) => void;
    onCancel: () => void;
}

const WRAPS: [string, string, string, string][] = [
    ["B", "Tebal", "<b>", "</b>"],
    ["I", "Miring", "<i>", "</i>"],
    ["U", "Garis bawah", "<u>", "</u>"],
    ["S", "Coret", "<s>", "</s>"],
    ["x²", "Superskrip", "<sup>", "</sup>"],
    ["x₂", "Subskrip", "<sub>", "</sub>"],
];

/** Dialog untuk mengelola label: ganti mode teks polos ⇄ HTML, sunting sumber HTML, dan pratinjau yang sudah disanitasi. */
export const MaxgraphHtmlLabelDialog = (p: HtmlLabelDialogProps) => {
    const [html, setHtml] = createSignal(p.html);
    const [src, setSrc] = createSignal(p.value);
    let area!: HTMLTextAreaElement;

    const preview = createMemo(() => {
        if (!html()) return { out: "", removed: 0 };
        const st = { removed: 0 };
        return { out: sanitizeHtmlLabel(src(), st), removed: st.removed };
    });

    const switchMode = (toHtml: boolean) => {
        if (toHtml === html()) return;
        setSrc(toHtml ? plainToHtml(src()) : htmlToPlain(src()));
        setHtml(toHtml);
    };
    const wrapSel = (open: string, close: string) => {
        const a = area.selectionStart, b = area.selectionEnd, v = src();
        setSrc(v.slice(0, a) + open + v.slice(a, b) + close + v.slice(b));
        queueMicrotask(() => { area.focus(); area.setSelectionRange(a + open.length, b + open.length); });
    };
    const insert = (text: string) => {
        const a = area.selectionStart, b = area.selectionEnd, v = src();
        setSrc(v.slice(0, a) + text + v.slice(b));
        queueMicrotask(() => { area.focus(); area.setSelectionRange(a + text.length, a + text.length); });
    };
    const link = () => {
        const url = window.prompt("URL tautan (http/https/mailto):", "https://");
        if (url) wrapSel(`<a href="${url.replace(/"/g, "&quot;")}">`, "</a>");
    };
    const apply = () => p.onApply(html() ? sanitizeHtmlLabel(src()) : src(), html());

    return (
        <div class="mgx-modal" role="dialog" aria-modal="true" aria-label="Kelola label" onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); p.onCancel(); } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) apply(); }}>
            <div class="mgx-modal-card">
                <header class="mgx-modal-head">
                    <b>Kelola label{p.title ? ` — ${p.title}` : ""}</b>
                    <button type="button" class="mgx-btn" aria-label="Tutup" onClick={p.onCancel}>✕</button>
                </header>
                <div class="mgx-modal-body">
                    <div class="mgx-seg" role="radiogroup" aria-label="Mode label">
                        <button type="button" role="radio" aria-checked={!html()} classList={{ "mgx-on": !html() }} onClick={() => switchMode(false)}>Teks polos</button>
                        <button type="button" role="radio" aria-checked={html()} classList={{ "mgx-on": html() }} onClick={() => switchMode(true)}>HTML</button>
                    </div>
                    <Show when={html()}>
                        <div class="mgx-fmt">
                            {WRAPS.map(([t, title, o, c]) => <button type="button" class="mgx-btn mgx-txt" title={title} onClick={() => wrapSel(o, c)}>{t}</button>)}
                            <button type="button" class="mgx-btn mgx-txt" title="Baris baru" onClick={() => insert("<br>")}>↵</button>
                            <button type="button" class="mgx-btn mgx-txt" title="Tautan" onClick={link}>🔗</button>
                            <label class="mgx-fmt-color" title="Warna teks"><input type="color" value="#b91c1c" onChange={e => wrapSel(`<font color="${e.currentTarget.value}">`, "</font>")} />A</label>
                            <select class="mgx-select" title="Ukuran teks" value="" onChange={e => { const v = e.currentTarget.value; e.currentTarget.value = ""; if (v) wrapSel(`<span style="font-size:${v}px">`, "</span>"); }}>
                                <option value="">Ukuran…</option>
                                {[10, 12, 14, 18, 24, 32].map(s => <option value={String(s)}>{s}px</option>)}
                            </select>
                        </div>
                    </Show>
                    <textarea ref={area} class="mgx-src" spellcheck={false} rows={7} aria-label={html() ? "Sumber HTML" : "Teks label"} value={src()} onInput={e => setSrc(e.currentTarget.value)} />
                    <Show when={html()}>
                        <div class="mgx-prev-h">Pratinjau (disanitasi)</div>
                        <div class="mgx-prev" innerHTML={preview().out} />
                        <Show when={preview().removed}>
                            <div class="mgx-warn">{preview().removed} elemen/atribut tidak aman akan dibuang (script, handler on*, javascript:, CSS berbahaya).</div>
                        </Show>
                    </Show>
                    <div class="mgx-muted">Ctrl+Enter = terapkan · Esc = batal. Mode HTML menyetel style <code>html=1</code> seperti draw.io.</div>
                </div>
                <footer class="mgx-modal-foot">
                    <button type="button" class="mgx-btn mgx-txt" onClick={p.onCancel}>Batal</button>
                    <button type="button" class="mgx-btn mgx-txt mgx-primary" onClick={apply}>Terapkan</button>
                </footer>
            </div>
        </div>
    );
};
