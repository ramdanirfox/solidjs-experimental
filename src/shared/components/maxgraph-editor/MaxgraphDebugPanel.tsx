import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { EditorEventBus } from "../editor-kit/events";
import { LOG_LEVELS, type LogEntry, type LogLevel, type MaxgraphLogger } from "./logger";
import type { DrawioImportReport } from "./drawio";
import type { MaxgraphCellInspection, MaxgraphEventMap, MaxgraphInfo } from "./types";

export type DebugTab = "log" | "info" | "events";

interface Props {
    tab: DebugTab;
    onTab: (t: DebugTab) => void;
    onClose: () => void;
    logger: MaxgraphLogger;
    bus: EditorEventBus<MaxgraphEventMap>;
    getInfo: () => MaxgraphInfo | undefined;
    inspectSelection: () => MaxgraphCellInspection | undefined;
    lastImport: () => DrawioImportReport | undefined;
    /** Naikkan nilai ini agar Info dihitung ulang (mis. saat seleksi/model berubah). */
    version: () => number;
}

const download = (name: string, text: string, type = "text/plain") => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** Ringkas payload event untuk tampilan: sel → `Cell#id`, objek besar dipotong. */
export const brief = (v: unknown, depth = 0): string => {
    if (v === null || v === undefined) return String(v);
    if (typeof v === "string") return v.length > 80 ? `"${v.slice(0, 77)}…"` : `"${v}"`;
    if (typeof v !== "object") return String(v);
    if (typeof (v as { getId?: unknown }).getId === "function") { const c = v as { getId(): string | null; isEdge?(): boolean }; return `${c.isEdge?.() ? "Edge" : "Cell"}#${c.getId()}`; }
    if (v instanceof Event) return `${v.type}`;
    if (Array.isArray(v)) return `[${v.slice(0, 5).map(x => brief(x, depth + 1)).join(", ")}${v.length > 5 ? `, … +${v.length - 5}` : ""}]`;
    if (depth >= 1) return "{…}";
    const parts: string[] = [];
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (k === "api") { parts.push("api"); continue; }
        parts.push(`${k}: ${typeof x === "string" && x.length > 60 ? `"${x.slice(0, 57)}…"` : brief(x, depth + 1)}`);
        if (parts.join(", ").length > 140) { parts.push("…"); break; }
    }
    return `{ ${parts.join(", ")} }`;
};

const hhmmss = (t: number) => new Date(t).toISOString().slice(11, 23);

export const MaxgraphDebugPanel = (p: Props) => {
    const [tick, setTick] = createSignal(0);
    const [level, setLevel] = createSignal<LogLevel>("debug");
    const [scope, setScope] = createSignal("");
    const [text, setText] = createSignal("");
    const [failedOnly, setFailedOnly] = createSignal(false);
    const [evText, setEvText] = createSignal("");
    const [paused, setPaused] = createSignal(false);
    const [open, setOpen] = createSignal<number | null>(null);
    let listEl: HTMLDivElement | undefined;

    const offLog = p.logger.subscribe(() => setTick(t => t + 1));
    const offBus = p.bus.onAny(() => { if (!paused() && p.tab === "events") setTick(t => t + 1); });
    onCleanup(() => { offLog(); offBus(); });

    const entries = createMemo<LogEntry[]>(() => { tick(); return p.logger.entries({ level: level(), scope: scope() || undefined, text: text() || undefined, onlyFailed: failedOnly() }); });
    const events = createMemo(() => {
        tick();
        p.tab; // hitung ulang saat tab dibuka (memo bersifat eager; tanpa ini isinya basi sejak panel dibuat)
        p.version();
        const q = evText().toLowerCase();
        const h = p.bus.history().filter(e => e.type !== "log");
        return (q ? h.filter(e => e.type.includes(q)) : h).slice(-150).reverse();
    });
    const info = createMemo(() => { p.version(); tick(); return p.getInfo(); });
    const sel = createMemo(() => { p.version(); return p.inspectSelection(); });
    const stats = createMemo(() => { tick(); return p.logger.stats(); });

    createEffect(() => { entries(); if (p.tab === "log" && listEl) queueMicrotask(() => { if (listEl) listEl.scrollTop = listEl.scrollHeight; }); });

    const Row = (r: { k: string; v: unknown }) => (
        <tr><th>{r.k}</th><td>{typeof r.v === "object" ? JSON.stringify(r.v) : String(r.v)}</td></tr>
    );

    return (
        <section class="mgx-dock" aria-label="Panel debug">
            <header class="mgx-dock-head">
                <div class="mgx-tabs" role="tablist">
                    <button role="tab" aria-selected={p.tab === "log"} classList={{ "mgx-tab-on": p.tab === "log" }} onClick={() => p.onTab("log")}>
                        Log <span class="mgx-count">{stats().total}</span>
                        <Show when={stats().error + stats().failed}><span class="mgx-count mgx-count-bad">{stats().error + stats().failed}</span></Show>
                    </button>
                    <button role="tab" aria-selected={p.tab === "info"} classList={{ "mgx-tab-on": p.tab === "info" }} onClick={() => p.onTab("info")}>Info</button>
                    <button role="tab" aria-selected={p.tab === "events"} classList={{ "mgx-tab-on": p.tab === "events" }} onClick={() => p.onTab("events")}>Peristiwa</button>
                </div>
                <button type="button" class="mgx-btn" title="Tutup panel" aria-label="Tutup panel" onClick={p.onClose}>✕</button>
            </header>

            <Show when={p.tab === "log"}>
                <div class="mgx-dock-tools">
                    <select class="mgx-select" title="Tingkat minimum" value={level()} onChange={e => setLevel(e.currentTarget.value as LogLevel)}>
                        <For each={LOG_LEVELS}>{l => <option value={l}>{l}</option>}</For>
                    </select>
                    <select class="mgx-select" title="Cakupan" value={scope()} onChange={e => setScope(e.currentTarget.value)}>
                        <option value="">semua cakupan</option>
                        <For each={(tick(), p.logger.scopes())}>{s => <option value={s}>{s}</option>}</For>
                    </select>
                    <input class="mgx-input" placeholder="cari…" value={text()} onInput={e => setText(e.currentTarget.value)} />
                    <label class="mgx-check"><input type="checkbox" checked={failedOnly()} onChange={e => setFailedOnly(e.currentTarget.checked)} /> hanya masalah</label>
                    <label class="mgx-check" title="Simpan juga catatan debug (jejak tiap langkah)"><input type="checkbox" checked={p.logger.getLevel() === "debug"} onChange={e => p.logger.setLevel(e.currentTarget.checked ? "debug" : "info")} /> jejak debug</label>
                    <span class="mgx-grow" />
                    <button type="button" class="mgx-btn mgx-txt" onClick={() => navigator.clipboard?.writeText(p.logger.toText({ level: level() })).catch(() => undefined)}>Salin</button>
                    <button type="button" class="mgx-btn mgx-txt" onClick={() => download("maxgraph-log.txt", p.logger.toText())}>.txt</button>
                    <button type="button" class="mgx-btn mgx-txt" onClick={() => download("maxgraph-log.json", p.logger.toJSON(), "application/json")}>.json</button>
                    <button type="button" class="mgx-btn mgx-txt" onClick={() => { p.logger.clear(); setTick(t => t + 1); }}>Bersihkan</button>
                </div>
                <div class="mgx-dock-body mgx-log" ref={listEl} role="log" aria-live="off">
                    <Show when={entries().length} fallback={<div class="mgx-empty">Belum ada catatan. Impor diagram, impor bentuk, atau jalankan tata letak untuk melihat jejaknya.</div>}>
                        <For each={entries()}>
                            {e => (
                                <div class={`mgx-log-row mgx-lv-${e.level}`} classList={{ "mgx-ok": e.ok === true, "mgx-fail": e.ok === false }} onClick={() => e.detail !== undefined && setOpen(o => (o === e.id ? null : e.id))}>
                                    <span class="mgx-log-t">{hhmmss(e.time)}</span>
                                    <span class="mgx-log-scope">{e.scope}</span>
                                    <span class="mgx-log-msg">{e.message}<Show when={e.durationMs !== undefined}> <em>({e.durationMs} ms)</em></Show></span>
                                    <Show when={e.why}><span class="mgx-log-why">↳ {e.why}</span></Show>
                                    <Show when={open() === e.id && e.detail !== undefined}>
                                        <pre class="mgx-log-detail">{(() => { try { return JSON.stringify(e.detail, null, 2); } catch { return String(e.detail); } })()}</pre>
                                    </Show>
                                </div>
                            )}
                        </For>
                    </Show>
                </div>
            </Show>

            <Show when={p.tab === "info"}>
                <div class="mgx-dock-body mgx-info">
                    <Show when={info()} fallback={<div class="mgx-empty">Editor belum siap.</div>}>
                        {i => (
                            <>
                                <h4>Diagram</h4>
                                <table class="mgx-kv"><tbody>
                                    <Row k="Node" v={i().cells.vertices} /><Row k="Garis" v={i().cells.edges} /><Row k="Layer" v={i().cells.layers} />
                                    <Row k="Zoom" v={`${Math.round(i().zoom * 100)}%`} /><Row k="Baca-saja" v={i().readonly} />
                                    <Row k="Halaman" v={`${i().page.index + 1} / ${i().page.count} (${i().page.name})`} />
                                    <Row k="Undo / Redo" v={`${i().history.canUndo ? "ya" : "tidak"} / ${i().history.canRedo ? "ya" : "tidak"}`} />
                                    <Row k="Jenis node" v={i().nodeTypes} /><Row k="Stensil terdaftar" v={i().stencils} />
                                    <Row k="Pendengar event" v={i().listeners} />
                                    <Row k="Log" v={`${i().log.total} (peringatan ${i().log.warn}, galat ${i().log.error}, gagal ${i().log.failed})`} />
                                </tbody></table>
                                <Show when={i().shapeLibraries.length}>
                                    <h4>Pustaka bentuk</h4>
                                    <table class="mgx-kv"><tbody><For each={i().shapeLibraries}>{l => <Row k={l.name} v={`${l.kind} · ${l.count} bentuk`} />}</For></tbody></table>
                                </Show>
                                <h4>Perintah (bus.run)</h4>
                                <div class="mgx-chips"><For each={i().commands}>{c => <code>{c}</code>}</For></div>
                            </>
                        )}
                    </Show>
                    <Show when={p.lastImport()}>
                        {r => (
                            <>
                                <h4>Impor terakhir</h4>
                                <table class="mgx-kv"><tbody>
                                    <Row k="Format" v={`${r().format}${r().compressed ? " (terkompresi)" : ""}`} />
                                    <Row k="Halaman" v={`${r().page.name} (${r().page.index + 1}/${r().pageCount})`} />
                                    <Row k="Sel" v={`${r().cells.vertices} node, ${r().cells.edges} garis, ${r().cells.groups} grup`} />
                                    <Row k="Label HTML" v={`${r().htmlLabels}${r().sanitized ? `, ${r().sanitized} dibersihkan` : ""}`} />
                                    <Row k="Durasi" v={`${r().durationMs} ms`} />
                                    <Show when={r().unknownShapes.length}><Row k="Bentuk tidak tersedia" v={r().unknownShapes.join(", ")} /></Show>
                                    <Show when={r().unknownStyleNames.length}><Row k="Style bernama diabaikan" v={r().unknownStyleNames.join(", ")} /></Show>
                                    <Show when={r().danglingEdges}><Row k="Garis terputus" v={r().danglingEdges} /></Show>
                                </tbody></table>
                                <Show when={r().warnings.length}><ul class="mgx-warns"><For each={r().warnings.slice(0, 20)}>{w => <li>{w}</li>}</For></ul></Show>
                            </>
                        )}
                    </Show>
                    <h4>Sel terpilih</h4>
                    <Show when={sel()} fallback={<div class="mgx-empty">Pilih satu node atau garis untuk melihat style gabungan dan bentuk yang dipakai.</div>}>
                        {c => (
                            <>
                                <table class="mgx-kv"><tbody>
                                    <Row k="Id / jenis" v={`${c().id} · ${c().kind}`} /><Row k="Label" v={c().label || "(kosong)"} /><Row k="Induk" v={c().parent ?? "-"} />
                                    <Show when={c().kind === "edge"}><Row k="Source → Target" v={`${c().source ?? "—"} → ${c().target ?? "—"}`} /></Show>
                                    <Show when={c().geometry}><Row k="Geometri" v={`x=${c().geometry!.x} y=${c().geometry!.y} ${c().geometry!.width}×${c().geometry!.height}${c().geometry!.points ? ` · ${c().geometry!.points} titik` : ""}`} /></Show>
                                    <Row k="Bentuk" v={`${c().shape.name} → ${c().shape.resolved === "missing" ? "TIDAK TERSEDIA (tampil sebagai persegi)" : c().shape.resolved}`} />
                                    <Show when={c().namedStyles.length}><Row k="Style bernama" v={c().namedStyles.join(", ")} /></Show>
                                </tbody></table>
                                <details><summary>Style milik sel</summary><pre class="mgx-log-detail">{JSON.stringify(c().ownStyle, null, 2)}</pre></details>
                                <details><summary>Style gabungan</summary><pre class="mgx-log-detail">{JSON.stringify(c().style, null, 2)}</pre></details>
                            </>
                        )}
                    </Show>
                </div>
            </Show>

            <Show when={p.tab === "events"}>
                <div class="mgx-dock-tools">
                    <input class="mgx-input" placeholder="saring tipe event…" value={evText()} onInput={e => setEvText(e.currentTarget.value)} />
                    <label class="mgx-check"><input type="checkbox" checked={paused()} onChange={e => setPaused(e.currentTarget.checked)} /> jeda</label>
                    <span class="mgx-grow" />
                    <span class="mgx-muted">{p.bus.listenerCount()} pendengar · {p.bus.history().length} event tersimpan</span>
                </div>
                <div class="mgx-dock-body mgx-log">
                    <Show when={events().length} fallback={<div class="mgx-empty">Belum ada event.</div>}>
                        <For each={events()}>
                            {e => (
                                <div class="mgx-log-row">
                                    <span class="mgx-log-t">{hhmmss(e.meta.time)}</span>
                                    <span class="mgx-log-scope">{e.type}</span>
                                    <span class="mgx-log-msg mgx-mono">{brief(e.payload)}</span>
                                </div>
                            )}
                        </For>
                    </Show>
                </div>
            </Show>
        </section>
    );
};
