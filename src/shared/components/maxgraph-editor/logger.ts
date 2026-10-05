/**
 * Logger penelusuran untuk editor maxgraph: *apa yang berhasil, apa yang gagal, dan kenapa*.
 *
 *  - `debug/info/warn/error`  : catatan biasa bertingkat, dengan cakupan (scope) seperti "import", "export", "shapes".
 *  - `trace(scope, name, fn)` : jalankan `fn`, catat hasil ✓/✗, durasi, dan alasan (`why`) — sinkron maupun async.
 *  - `step(...)`              : catatan langkah dalam sebuah proses (mis. tiap tahap impor draw.io) dengan `ok` + `why`.
 *  - ring buffer `capacity`, langganan (`subscribe`), saringan, dan ekspor teks/JSON untuk laporan bug.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];
const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface LogEntry {
  id: number;
  time: number;
  level: LogLevel;
  scope: string;
  message: string;
  /** Hasil langkah/trace: berhasil atau tidak. Tidak ada untuk catatan biasa. */
  ok?: boolean;
  /** Alasan: kenapa berhasil / gagal / dilewati. */
  why?: string;
  durationMs?: number;
  detail?: unknown;
}

export interface LogFilter { level?: LogLevel; scope?: string; text?: string; onlyFailed?: boolean }
export interface LoggerOptions {
  capacity?: number;
  /** Tingkat minimum yang disimpan. Default "info" (debug hanya bila diaktifkan). */
  level?: LogLevel;
  /** Cetak juga ke console. Default false. */
  console?: boolean;
  now?: () => number;
}

export type LogListener = (entry: LogEntry) => void;

const safeDetail = (d: unknown): unknown => {
  if (d instanceof Error) return { name: d.name, message: d.message, stack: d.stack };
  return d;
};
const reasonOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class MaxgraphLogger {
  private buf: LogEntry[] = [];
  private seq = 0;
  private listeners = new Set<LogListener>();
  private capacity: number;
  private level: LogLevel;
  private toConsole: boolean;
  private now: () => number;

  constructor(opts: LoggerOptions = {}) {
    this.capacity = Math.max(10, opts.capacity ?? 500);
    this.level = opts.level ?? "info";
    this.toConsole = !!opts.console;
    this.now = opts.now ?? Date.now;
  }

  getLevel() { return this.level; }
  setLevel(l: LogLevel) { this.level = l; }
  setConsole(on: boolean) { this.toConsole = on; }
  isEnabled(l: LogLevel) { return RANK[l] >= RANK[this.level]; }

  log(level: LogLevel, scope: string, message: string, extra: Partial<Pick<LogEntry, "ok" | "why" | "durationMs" | "detail">> = {}): LogEntry | undefined {
    if (!this.isEnabled(level)) return undefined;
    const entry: LogEntry = { id: ++this.seq, time: this.now(), level, scope, message, ...extra };
    if (entry.detail !== undefined) entry.detail = safeDetail(entry.detail);
    this.buf.push(entry);
    if (this.buf.length > this.capacity) this.buf.splice(0, this.buf.length - this.capacity);
    if (this.toConsole) {
      const fn = level === "error" ? console.error : level === "warn" ? console.warn : level === "debug" ? console.debug : console.info;
      fn(`[maxgraph:${scope}] ${message}${entry.why ? ` — ${entry.why}` : ""}`, entry.detail ?? "");
    }
    for (const l of [...this.listeners]) { try { l(entry); } catch { /* pendengar tidak boleh merusak editor */ } }
    return entry;
  }
  debug(scope: string, message: string, detail?: unknown) { return this.log("debug", scope, message, { detail }); }
  info(scope: string, message: string, detail?: unknown) { return this.log("info", scope, message, { detail }); }
  warn(scope: string, message: string, detail?: unknown) { return this.log("warn", scope, message, { detail }); }
  error(scope: string, message: string, detail?: unknown) { return this.log("error", scope, message, { detail }); }

  /** Langkah dalam sebuah proses: `ok` + alasan. Langkah yang gagal dicatat sebagai warn. */
  step(scope: string, message: string, ok: boolean, why?: string, detail?: unknown) {
    return this.log(ok ? "info" : "warn", scope, message, { ok, why, detail });
  }

  /**
   * Jalankan `fn` dan catat hasilnya. `why` boleh fungsi yang menerima hasil untuk menjelaskan mengapa berhasil
   * (mis. "3 halaman, terkompresi → dideflate"). Galat dilempar ulang setelah dicatat.
   */
  trace<T>(scope: string, name: string, fn: () => T, opts: { why?: string | ((result: Awaited<T>) => string | undefined); level?: LogLevel } = {}): T {
    const t0 = this.now();
    this.debug(scope, `▶ ${name}`);
    const done = (ok: boolean, result?: Awaited<T>, error?: unknown) => {
      const durationMs = this.now() - t0;
      if (ok) {
        const why = typeof opts.why === "function" ? opts.why(result as Awaited<T>) : opts.why;
        this.log(opts.level ?? "info", scope, `✓ ${name}`, { ok: true, why, durationMs });
      } else this.log("error", scope, `✗ ${name}`, { ok: false, why: reasonOf(error), durationMs, detail: error });
    };
    let out: T;
    try { out = fn(); } catch (e) { done(false, undefined, e); throw e; }
    if (out && typeof (out as { then?: unknown }).then === "function") {
      return (out as unknown as Promise<Awaited<T>>).then(
        r => { done(true, r); return r; },
        e => { done(false, undefined, e); throw e; },
      ) as T;
    }
    done(true, out as Awaited<T>);
    return out;
  }

  subscribe(fn: LogListener): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  entries(f: LogFilter = {}): LogEntry[] {
    const text = f.text?.toLowerCase();
    return this.buf.filter(e =>
      (!f.level || RANK[e.level] >= RANK[f.level]) &&
      (!f.scope || e.scope === f.scope) &&
      (!f.onlyFailed || e.ok === false || e.level === "error" || e.level === "warn") &&
      (!text || `${e.scope} ${e.message} ${e.why ?? ""}`.toLowerCase().includes(text)));
  }
  scopes(): string[] { return [...new Set(this.buf.map(e => e.scope))].sort(); }
  stats() {
    const s = { total: this.buf.length, debug: 0, info: 0, warn: 0, error: 0, failed: 0 };
    for (const e of this.buf) { s[e.level]++; if (e.ok === false) s.failed++; }
    return s;
  }
  clear() { this.buf = []; }

  toText(f?: LogFilter): string {
    return this.entries(f).map(e => {
      const t = new Date(e.time).toISOString().slice(11, 23);
      const mark = e.ok === undefined ? "" : e.ok ? " ✓" : " ✗";
      const dur = e.durationMs !== undefined ? ` (${e.durationMs}ms)` : "";
      return `${t} ${e.level.toUpperCase().padEnd(5)} [${e.scope}]${mark} ${e.message}${dur}${e.why ? `\n        ↳ ${e.why}` : ""}`;
    }).join("\n");
  }
  toJSON(f?: LogFilter) { return JSON.stringify(this.entries(f), null, 2); }
}
