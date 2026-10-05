/**
 * Event bus kecil untuk keperluan *programmability* editor (maxgraph, docx, pptx, xlsx).
 *
 *  - `on / once / off / onAny` : dengarkan event bertipe dari editor.
 *  - `emit`                    : kirim event (dipakai editor; boleh juga dipakai aplikasi untuk event kustom).
 *  - `registerCommand / run`   : aplikasi memerintah editor (mis. "undo", "ole.insert") tanpa menyentuh internalnya.
 *  - `attach(el)`              : jembatan DOM — setiap event juga dikirim sebagai `CustomEvent` ber-prefix yang naik (bubbles)
 *                                ke induknya, dan elemen mendengarkan `<prefix>:command` untuk menjalankan perintah.
 *  - `history()`               : ring buffer event terakhir (untuk panel debug/log).
 *
 * Galat dalam handler tidak pernah merusak editor: ditangkap, dilaporkan ke `onError`, dan handler lain tetap jalan.
 */

export interface EventMeta {
  type: string;
  /** Penanda waktu (ms epoch). */
  time: number;
  /** Nomor urut event pada bus ini. */
  seq: number;
  /** Nama editor penghasil event. */
  source: string;
}
export type EventHandler<P> = (payload: P, meta: EventMeta) => void;
export type AnyEventHandler = (type: string, payload: unknown, meta: EventMeta) => void;
export type CommandFn = (...args: any[]) => unknown;
export interface EventRecord { type: string; payload: unknown; meta: EventMeta }

/** Detail `CustomEvent` untuk perintah lewat DOM: isi `result` dengan hasil (bisa Promise). */
export interface CommandEventDetail { name: string; args?: unknown[]; result?: unknown; error?: unknown }

export interface EventBusOptions {
  /** Nama editor, mis. "docx-editor". Juga dipakai sebagai prefix event DOM. */
  source: string;
  /** Prefix event DOM. Default = `source`. */
  domPrefix?: string;
  /** Jumlah event yang disimpan untuk `history()`. Default 200; 0 = nonaktif. */
  historySize?: number;
  /** Tipe event yang tidak dicatat di `history()` (mis. "log" yang sudah punya buffer sendiri). */
  historyIgnore?: readonly string[];
  onError?: (error: unknown, type: string) => void;
}

export interface EditorEventBus<M extends object = Record<string, unknown>> {
  readonly source: string;
  on<K extends keyof M & string>(type: K, handler: EventHandler<M[K]>): () => void;
  once<K extends keyof M & string>(type: K, handler: EventHandler<M[K]>): () => void;
  off<K extends keyof M & string>(type: K, handler?: EventHandler<M[K]>): void;
  onAny(handler: AnyEventHandler): () => void;
  emit<K extends keyof M & string>(type: K, payload: M[K]): void;
  /** Tunggu event berikutnya bertipe `type` (opsional dengan batas waktu ms). */
  wait<K extends keyof M & string>(type: K, timeoutMs?: number): Promise<M[K]>;

  registerCommand(name: string, fn: CommandFn): () => void;
  commands(): string[];
  hasCommand(name: string): boolean;
  /** Jalankan perintah. Perintah yang tidak dikenal melempar galat. */
  run<T = unknown>(name: string, ...args: unknown[]): Promise<T>;

  attach(el: HTMLElement): () => void;
  history(): readonly EventRecord[];
  listenerCount(type?: string): number;
  /** Lepas semua handler, perintah, dan jembatan DOM. */
  clear(): void;
}

export function createEventBus<M extends object = Record<string, unknown>>(opts: EventBusOptions): EditorEventBus<M> {
  const handlers = new Map<string, Set<EventHandler<any>>>();
  const anyHandlers = new Set<AnyEventHandler>();
  const commands = new Map<string, CommandFn>();
  const targets = new Set<HTMLElement>();
  const hist: EventRecord[] = [];
  const prefix = opts.domPrefix ?? opts.source;
  const histMax = opts.historySize ?? 200;
  const histSkip = new Set(opts.historyIgnore ?? []);
  let seq = 0;

  const report = (e: unknown, type: string) => {
    if (opts.onError) { try { opts.onError(e, type); } catch { /* abaikan */ } } else console.error(`[${opts.source}] handler "${type}"`, e);
  };

  const runCommand = async (name: string, args: unknown[]) => {
    const fn = commands.get(name);
    if (!fn) throw new Error(`[${opts.source}] perintah tidak dikenal: "${name}" (tersedia: ${[...commands.keys()].join(", ") || "-"})`);
    return fn(...args);
  };

  const bus: EditorEventBus<M> = {
    source: opts.source,
    on(type, handler) {
      let set = handlers.get(type);
      if (!set) handlers.set(type, (set = new Set()));
      set.add(handler);
      return () => bus.off(type, handler);
    },
    once(type, handler) {
      const off = bus.on(type, (p, m) => { off(); handler(p, m); });
      return off;
    },
    off(type, handler) {
      if (!handler) { handlers.delete(type); return; }
      const set = handlers.get(type);
      if (!set) return;
      set.delete(handler);
      if (!set.size) handlers.delete(type);
    },
    onAny(handler) { anyHandlers.add(handler); return () => { anyHandlers.delete(handler); }; },
    emit(type, payload) {
      const meta: EventMeta = { type, time: Date.now(), seq: ++seq, source: opts.source };
      if (histMax > 0 && !histSkip.has(type)) { hist.push({ type, payload, meta }); if (hist.length > histMax) hist.splice(0, hist.length - histMax); }
      const set = handlers.get(type);
      if (set) for (const h of [...set]) { try { h(payload, meta); } catch (e) { report(e, type); } }
      for (const h of [...anyHandlers]) { try { h(type, payload, meta); } catch (e) { report(e, type); } }
      for (const el of targets) {
        try { el.dispatchEvent(new CustomEvent(`${prefix}:${type}`, { detail: payload, bubbles: true, composed: true })); } catch (e) { report(e, type); }
      }
    },
    wait(type, timeoutMs) {
      return new Promise((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const off = bus.on(type, p => { if (timer) clearTimeout(timer); off(); resolve(p); });
        if (timeoutMs) timer = setTimeout(() => { off(); reject(new Error(`[${opts.source}] timeout menunggu "${type}"`)); }, timeoutMs);
      });
    },
    registerCommand(name, fn) { commands.set(name, fn); return () => { if (commands.get(name) === fn) commands.delete(name); }; },
    commands: () => [...commands.keys()].sort(),
    hasCommand: name => commands.has(name),
    run: (name, ...args) => runCommand(name, args) as Promise<any>,
    attach(el) {
      targets.add(el);
      const onCmd = (e: Event) => {
        const d = (e as CustomEvent<CommandEventDetail>).detail;
        if (!d || typeof d.name !== "string") return;
        e.stopPropagation();
        d.result = runCommand(d.name, d.args ?? []).catch(err => { d.error = err; throw err; });
        (d.result as Promise<unknown>).catch(err => report(err, `command:${d.name}`));
      };
      el.addEventListener(`${prefix}:command`, onCmd);
      return () => { targets.delete(el); el.removeEventListener(`${prefix}:command`, onCmd); };
    },
    history: () => hist,
    listenerCount: type => (type ? handlers.get(type)?.size ?? 0 : [...handlers.values()].reduce((a, s) => a + s.size, 0) + anyHandlers.size),
    clear() { handlers.clear(); anyHandlers.clear(); commands.clear(); targets.clear(); },
  };
  return bus;
}

/** Kirim perintah ke editor lewat DOM (tanpa referensi ke bus). Mengembalikan hasil perintah. */
export function dispatchCommand<T = unknown>(target: Element, prefix: string, name: string, ...args: unknown[]): Promise<T> {
  const detail: CommandEventDetail = { name, args };
  target.dispatchEvent(new CustomEvent(`${prefix}:command`, { detail, bubbles: false }));
  if (!detail.result) return Promise.reject(new Error(`Tidak ada editor "${prefix}" pada elemen ini`));
  return Promise.resolve(detail.result as T);
}
