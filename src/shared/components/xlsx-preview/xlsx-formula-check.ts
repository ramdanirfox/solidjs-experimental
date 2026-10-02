/**
 * Pemeriksaan formula sebelum disimpan: sintaks, fungsi salah ketik, referensi rusak/melingkar, ketidakcocokan tipe data
 * (teks di operasi angka, angka tersimpan sebagai teks, rentang kosong) dan hasil error — masing-masing dengan saran perbaikan.
 */
import type { Worksheet } from "@office-kit/xlsx/worksheet";
import type { XlsxBook } from "./xlsx-model";
import {
  SUPPORTED_FUNCTIONS, isErr, nodeToString, parseFormula, toNumber, extractRefs,
  type Node as FNode, type Scalar, type Val,
} from "./xlsx-formula";

export interface FormulaIssue {
  level: "error" | "warn";
  /** true = formula tidak dapat disimpan (sintaks rusak). */
  blocking?: boolean;
  title: string;
  detail: string;
  hint: string;
}

const ERROR_HELP: Record<string, { why: string; fix: string }> = {
  "#DIV/0!": { why: "Ada pembagian dengan nol atau dengan sel kosong.", fix: "Periksa penyebut. Bungkus dengan IF(B2=0,0,A2/B2) atau IFERROR(A2/B2,0)." },
  "#VALUE!": { why: "Tipe data tidak sesuai — biasanya teks dipakai pada operasi angka.", fix: "Pastikan semua operand angka (cek sel yang berisi teks/spasi) atau konversi dengan VALUE()." },
  "#REF!": { why: "Referensi sel/sheet tidak valid (sheet tidak ada atau sel terhapus).", fix: "Perbaiki alamat atau nama sheet pada formula." },
  "#NAME?": { why: "Nama fungsi atau nama terdefinisi tidak dikenal (mungkin salah ketik atau belum didukung preview).", fix: "Periksa ejaan fungsi; daftar fungsi yang didukung ada di panel Info." },
  "#N/A": { why: "Nilai yang dicari tidak ditemukan (VLOOKUP/MATCH/XLOOKUP).", fix: "Periksa nilai kunci & rentang pencarian; gunakan IFNA(...,\"-\") bila ketiadaan data wajar." },
  "#NUM!": { why: "Angka tidak valid untuk fungsi tersebut (mis. akar bilangan negatif, hasil terlalu besar).", fix: "Periksa argumen angka." },
  "#CIRC!": { why: "Formula merujuk dirinya sendiri, langsung maupun lewat sel lain (referensi melingkar).", fix: "Ubah rentang agar tidak menyertakan sel ini atau memutus rantai referensi." },
};

function distance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0]![j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m]![n]!;
}

function balance(text: string): { open: number; close: number } {
  let open = 0, close = 0, inStr = false;
  for (const ch of text) { if (ch === '"') inStr = !inStr; else if (!inStr) { if (ch === "(") open++; else if (ch === ")") close++; } }
  return { open, close };
}

function* walk(n: FNode): Generator<FNode> {
  yield n;
  switch (n.t) {
    case "call": for (const a of n.args) yield* walk(a); break;
    case "un": case "pct": yield* walk(n.e); break;
    case "bin": yield* walk(n.l); yield* walk(n.r); break;
    case "arr": for (const r of n.rows) for (const c of r) yield* walk(c); break;
  }
}

const NUMERIC_AGG = new Set(["SUM", "AVERAGE", "MIN", "MAX", "PRODUCT", "MEDIAN", "STDEV", "VAR", "LARGE", "SMALL"]);
const ARITH = new Set(["+", "-", "*", "/", "^"]);

const show = (s: Scalar) => (s === null ? "(kosong)" : typeof s === "string" ? `"${s.length > 24 ? s.slice(0, 24) + "…" : s}"` : isErr(s) ? s.code : String(s));

export function analyzeFormula(book: XlsxBook, ws: Worksheet, row: number, col: number, text: string): FormulaIssue[] {
  const issues: FormulaIssue[] = [];
  if (!text.startsWith("=") || text.length < 2) return issues;
  try {
    // 1. sintaks
    try { parseFormula(text); } catch (e: any) {
      const b = balance(text);
      const msg = String(e?.message ?? e);
      let hint = "Periksa penulisan formula: operator, tanda kutip, dan pemisah argumen (koma).";
      if (b.open !== b.close) hint = `Tanda kurung tidak seimbang: ${b.open} “(” vs ${b.close} “)”. ${b.open > b.close ? "Tambahkan “)” di akhir." : "Hapus “)” yang berlebih."}`;
      else if (/Teks tidak ditutup/.test(msg)) hint = 'Tutup teks dengan tanda kutip ganda ("). Teks di dalam formula harus diapit "…".';
      else if (/Karakter tidak dikenal/.test(msg)) hint = "Hapus karakter yang tidak valid. Pakai koma (,) sebagai pemisah argumen dan titik (.) sebagai desimal.";
      else if (/Ekspresi tidak lengkap|tak terduga/.test(msg)) hint = "Ekspresi belum lengkap — pastikan setiap operator (+, -, *, /) memiliki operand di kedua sisinya.";
      issues.push({ level: "error", blocking: true, title: "Sintaks formula tidak valid", detail: msg, hint });
      return issues;
    }

    // 2. evaluasi dengan trace
    const ev = book.ev;
    const prev = ev.live;
    ev.live = true; ev.invalidate();
    const seen: { node: FNode; value: Val }[] = [];
    let result: Val = null;
    try {
      result = ev.evalTextRaw(text, { ws, row, col }, (node, value) => { seen.push({ node, value }); });
    } finally { ev.live = prev; ev.invalidate(); }
    const valOf = new Map<FNode, Val>(seen.map(s => [s.node, s.value]));
    const root = seen[seen.length - 1]?.node;

    if (root) for (const n of walk(root)) {
      // fungsi tak dikenal / salah ketik
      if (n.t === "call" && !SUPPORTED_FUNCTIONS.includes(n.fn)) {
        const near = SUPPORTED_FUNCTIONS.map(f => ({ f, d: distance(f, n.fn) })).sort((a, b) => a.d - b.d)[0];
        if (near && near.d <= 2 && n.fn.length >= 3) issues.push({ level: "warn", title: `Fungsi ${n.fn}() tidak dikenal`, detail: `“${n.fn}” tidak ada dalam daftar fungsi yang dihitung preview.`, hint: `Mungkin maksud Anda ${near.f}()? Jika fungsi ini valid di Excel, formula tetap disimpan tetapi hasilnya akan #NAME? di preview.` });
      }
      // sheet tidak ada
      if (n.t === "ref" && n.sheet && !ev.getSheet(n.sheet)) issues.push({ level: "warn", title: `Sheet “${n.sheet}” tidak ditemukan`, detail: `Referensi ${n.text} menunjuk ke sheet yang tidak ada.`, hint: `Sheet yang tersedia: ${book.sheets.map(s => s.sheet.title).join(", ")}.` });
      // referensi ke diri sendiri
      if (n.t === "ref" && (!n.sheet || n.sheet.toLowerCase() === ws.title.toLowerCase()) && row >= n.r1 && row <= n.r2 && col >= n.c1 && col <= n.c2)
        issues.push({ level: "warn", title: "Referensi melingkar", detail: `Formula di sel ini menyertakan dirinya sendiri (${n.text}).`, hint: ERROR_HELP["#CIRC!"]!.fix });
      // operasi aritmatika pada teks
      if (n.t === "bin" && ARITH.has(n.op)) {
        for (const side of [n.l, n.r]) {
          const v = valOf.get(side);
          if (v === undefined || (typeof v === "object" && v !== null && (v as any).kind !== "range")) continue;
          const sc = ev.scalar(v as Val);
          if (typeof sc === "string" && isErr(toNumber(sc))) {
            const hintNum = sc.trim() !== "" && !isNaN(Number(sc.replace(/[.,\s]/g, ""))) ;
            issues.push({
              level: "warn", title: "Teks dipakai pada operasi angka",
              detail: `${nodeToString(side)} bernilai ${show(sc)} (tipe teks) tetapi operator “${n.op}” membutuhkan angka → hasil #VALUE!.`,
              hint: hintNum ? "Isi sel tampak seperti angka namun tersimpan sebagai teks (mungkin ada pemisah ribuan/spasi). Ketik ulang sebagai angka murni atau pakai VALUE()." : "Ganti dengan sel yang berisi angka, atau bersihkan teks/spasi pada sel tersebut.",
            });
          }
        }
      }
      // agregat numerik pada rentang
      if (n.t === "call" && NUMERIC_AGG.has(n.fn)) {
        for (const a of n.args) {
          if (a.t !== "ref") continue;
          const v = valOf.get(a) as any;
          if (!v || v.kind !== "range") continue;
          if ((Math.min(v.r2, 1048576) - v.r1 + 1) * (Math.min(v.c2, 16384) - v.c1 + 1) > 600000) continue;
          const flat = ev.rangeRows(v).flat();
          let nums = 0, texts = 0, textNum = 0, blanks = 0, errs = 0;
          for (const s of flat) {
            if (typeof s === "number") nums++;
            else if (typeof s === "string") { texts++; if (s.trim() !== "" && Number.isFinite(Number(s.replace(/,/g, "")))) textNum++; }
            else if (s === null) blanks++;
            else if (isErr(s)) errs++;
          }
          if (errs) issues.push({ level: "warn", title: "Rentang berisi error", detail: `${a.text} memuat ${errs} sel error — ${n.fn}() akan menghasilkan error.`, hint: "Perbaiki sel error terlebih dahulu atau gunakan AGGREGATE/IFERROR pada sel sumber." });
          else if (nums === 0 && texts > 0) issues.push({
            level: "warn", title: `${n.fn}() pada rentang tanpa angka`,
            detail: `${a.text} berisi ${texts} teks dan 0 angka, sehingga ${n.fn}() mengabaikan semuanya (hasil ${n.fn === "SUM" ? "0" : "tidak bermakna"}).`,
            hint: textNum > 0 ? `${textNum} sel tampak seperti angka tetapi bertipe teks. Ketik ulang sebagai angka, atau gunakan SUMPRODUCT(--(${a.text})) / VALUE().` : "Rentang yang dipilih tampaknya kolom teks. Pilih kolom yang berisi angka.",
          });
          else if (nums === 0 && texts === 0) issues.push({ level: "warn", title: "Rentang kosong", detail: `${a.text} tidak berisi data (${blanks} sel kosong).`, hint: "Pastikan rentang menunjuk ke data yang benar; baris/kolom mungkin bergeser." });
          else if (textNum > 0) issues.push({ level: "warn", title: "Sebagian angka tersimpan sebagai teks", detail: `${textNum} sel pada ${a.text} berisi angka bertipe teks sehingga tidak ikut dihitung oleh ${n.fn}().`, hint: "Ketik ulang sel tersebut sebagai angka murni (hapus apostrof/spasi) agar ikut terhitung." });
        }
      }
    }

    // 3. hasil error
    const sc = ev.scalar(result);
    if (isErr(sc)) {
      const help = ERROR_HELP[sc.code];
      issues.push({ level: "warn", title: `Formula menghasilkan ${sc.code}`, detail: help?.why ?? "Formula menghasilkan nilai error.", hint: help?.fix ?? "Periksa argumen dan referensi formula." });
    }
  } catch { /* pemeriksaan tidak boleh menggagalkan penyimpanan */ }
  // deduplikasi berdasarkan judul+detail
  const uniq = new Map<string, FormulaIssue>();
  for (const i of issues) uniq.set(i.title + "|" + i.detail, i);
  return [...uniq.values()];
}

/** Deskripsi tipe data sel untuk status bar. */
export function describeCellType(book: XlsxBook, ws: Worksheet, row: number, col: number): { label: string; detail?: string; warn?: boolean } {
  const cell = ws.rows.get(row)?.get(col);
  const v: any = cell?.value;
  if (!cell || v === null || v === undefined) return { label: "Kosong" };
  const st = book.styleOf(ws, cell);
  const fmt = st.numFmt && st.numFmt !== "General" ? st.numFmt : undefined;
  const isDate = !!fmt && /[ymdhs]/i.test(fmt.replace(/"[^"]*"|\[[^\]]*\]|\\./g, ""));
  const kindOf = (s: Scalar): { label: string; warn?: boolean; detail?: string } => {
    if (isErr(s)) return { label: "Error", detail: s.code };
    if (typeof s === "number") return isDate ? { label: "Tanggal/Waktu", detail: `serial ${s}` } : { label: "Angka", detail: fmt };
    if (typeof s === "boolean") return { label: "Boolean" };
    if (typeof s === "string") {
      const looks = s.trim() !== "" && Number.isFinite(Number(s.replace(/,/g, "")));
      return looks ? { label: "Teks", warn: true, detail: "tampak seperti angka tetapi bertipe teks" } : { label: "Teks", detail: `${s.length} karakter` };
    }
    return { label: "Kosong" };
  };
  if (typeof v === "object" && v.kind === "formula") {
    const k = kindOf(book.ev.cellValue(ws, row, col));
    return { label: `Formula → ${k.label}`, detail: [k.detail, `${v.t}`].filter(Boolean).join(" · "), warn: k.warn || k.label === "Error" };
  }
  if (v instanceof Date) return { label: "Tanggal/Waktu", detail: fmt ?? "Date" };
  if (typeof v === "object" && v.kind === "duration") return { label: "Durasi" };
  if (typeof v === "object" && v.kind === "rich-text") return { label: "Teks (rich text)" };
  if (typeof v === "object" && v.kind === "error") return { label: "Error", detail: v.code, warn: true };
  return kindOf(v);
}

export { extractRefs };
