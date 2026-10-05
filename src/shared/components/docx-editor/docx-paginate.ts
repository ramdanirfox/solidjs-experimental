/**
 * Paginasi berbasis pengukuran DOM: blok tingkat atas (paragraf/tabel) dialirkan ke halaman kertas sesuai geometri section
 * (ukuran, margin, header/footer). Tabel dibelah per baris (baris header diulang). Paragraf yang lebih tinggi dari halaman
 * tidak dibelah — halaman memanjang agar isi tidak terpotong.
 */
import { attr, first, isEl, num, type XEl } from "./docx-xml";
import type { DocxBook, Section } from "./docx-model";
import { Registry, fillBlocks, type RenderCtx } from "./docx-render";
import { readDrawing, type ImgInfo } from "./docx-image";
import { buildGrid, type Grid } from "./docx-table";
import { emuPx, twipPx } from "./docx-style";

export interface Geom { pageW: number; pageH: number; ml: number; mr: number; mt: number; mb: number; contentW: number; hdrDist: number; ftrDist: number }
export function geomOf(s: Section): Geom {
  const ml = twipPx(s.ml + s.gutter), mr = twipPx(s.mr), mt = twipPx(s.mt), mb = twipPx(s.mb);
  const pageW = twipPx(s.w), pageH = twipPx(s.h);
  return { pageW, pageH, ml, mr, mt, mb, contentW: Math.max(50, pageW - ml - mr), hdrDist: twipPx(s.hdr), ftrDist: twipPx(s.ftr) };
}

interface PagePlan { sec: number; items: Item[]; used: number; avail: number; first: boolean }
interface Item { el: HTMLElement; rows?: [number, number]; rowEls?: HTMLElement[]; frag?: number; hdrCount?: number; orig?: number[]; grid?: Grid }

const cs = (el: Element) => getComputedStyle(el);
function outerH(el: HTMLElement): number {
  if (el.dataset.fl) return 0; // tabel mengambang: di luar aliran
  const s = cs(el);
  return el.offsetHeight + (parseFloat(s.marginTop) || 0) + (parseFloat(s.marginBottom) || 0);
}

export interface PaginatorHost {
  book: DocxBook;
  reg: Registry;
  pagesEl: HTMLElement;
  doc: Document;
  makeCtx(contentW: number, source: string): RenderCtx;
}

export class Paginator {
  pages: HTMLElement[] = [];
  private frags = new Map<HTMLElement, HTMLTableElement[]>();
  private hfH = new Map<string, number>();
  /** Baris tabel yang dibelah (lebih tinggi dari halaman) beserta fragmennya; dikembalikan sebelum paginasi berikutnya. */
  private splitRows: { tr: HTMLElement; frags: HTMLElement[] }[] = [];
  /** Sel pengganti (rowspan yang terpotong antar-halaman) — dibuang sebelum paginasi berikutnya. */
  private covers: HTMLElement[] = [];
  count = 0;

  constructor(private h: PaginatorHost) {}

  reset() { this.pages = []; this.frags.clear(); this.hfH.clear(); this.splitRows = []; this.covers = []; this.count = 0; this.h.pagesEl.textContent = ""; }
  invalidateHF() { this.hfH.clear(); }

  // ───────── header/footer ─────────

  private hfKey(s: Section, kind: "hdr" | "ftr", pageInSec: number, pageNo: number): string | undefined {
    const refs = kind === "hdr" ? s.hdrRefs : s.ftrRefs;
    let t = "default";
    if (s.titlePg && pageInSec === 1) t = "first";
    else if (this.h.book.evenAndOdd() && pageNo % 2 === 0) t = "even";
    return refs[t] ?? (t === "first" ? undefined : refs.default);
  }

  private renderHF(relId: string | undefined, contentW: number): HTMLElement | undefined {
    if (!relId) return undefined;
    const root = this.h.book.hf(relId);
    if (!root) return undefined;
    const ctx = this.h.makeCtx(contentW, this.h.book.hfPart(relId) ?? this.h.book.doc.partName);
    ctx.editable = false;
    const box = this.h.doc.createElement("div");
    box.className = "dx-hfc";
    box.dataset.hf = relId; // dipakai view untuk mengenali gambar di header/footer
    box.style.display = "flex"; box.style.flexDirection = "column";
    fillBlocks(ctx, box, root, true);
    return box;
  }

  private measureHF(relId: string | undefined, contentW: number): number {
    if (!relId) return 0;
    const key = `${relId}|${Math.round(contentW)}|${this.h.book.hfRev}`;
    const hit = this.hfH.get(key);
    if (hit !== undefined) return hit;
    const box = this.renderHF(relId, contentW);
    if (!box) return 0;
    const m = this.h.doc.createElement("div");
    m.className = "dx-measure";
    m.style.cssText = `position:absolute;visibility:hidden;left:-99999px;top:0;width:${contentW}px;`;
    m.appendChild(box);
    this.h.pagesEl.appendChild(m);
    const hh = box.offsetHeight;
    m.remove();
    this.hfH.set(key, hh);
    return hh;
  }

  // ───────── alur ─────────

  /** `blocks` = elemen blok tingkat atas berurutan (dengan data-sec, data-pbb, data-pba, data-kn). */
  run(blocks: HTMLElement[]): number {
    const { book, doc, pagesEl } = this.h;
    this.unsplitRows();
    this.unfragmentTables();
    const sections = book.sections();
    const geoms = sections.map(geomOf);
    const hdrH = sections.map((s, i) => Math.max(0, ...Object.values(s.hdrRefs).map(r => this.measureHF(r, geoms[i].contentW))));
    const ftrH = sections.map((s, i) => Math.max(0, ...Object.values(s.ftrRefs).map(r => this.measureHF(r, geoms[i].contentW))));
    const availOf = (si: number) => {
      const g = geoms[si];
      const top = Math.max(g.mt, hdrH[si] ? g.hdrDist + hdrH[si] : 0);
      const bot = Math.max(g.mb, ftrH[si] ? g.ftrDist + ftrH[si] : 0);
      return { top, bot, avail: Math.max(60, g.pageH - top - bot) };
    };

    // blok yang belum terpasang di DOM tidak punya tinggi (offsetHeight = 0): pasang dulu di kotak ukur tersembunyi per section
    const secOf0 = (el: HTMLElement) => Math.min(sections.length - 1, Number(el.dataset.sec ?? 0));
    const boxes = new Map<number, HTMLElement>();
    for (const el of blocks) {
      if (el.isConnected) continue;
      const si = secOf0(el);
      let box = boxes.get(si);
      if (!box) {
        box = doc.createElement("div");
        box.className = "dx-body dx-measure";
        box.style.cssText = `position:absolute;visibility:hidden;left:-99999px;top:0;width:${geoms[si].contentW}px;`;
        pagesEl.appendChild(box);
        boxes.set(si, box);
      }
      box.appendChild(el);
    }

    // 1. rencana
    const plans: PagePlan[] = [];
    let cur: PagePlan | undefined;
    let forceNew = false;
    const newPage = (si: number, first: boolean) => { cur = { sec: si, items: [], used: 0, avail: availOf(si).avail, first }; plans.push(cur); };
    const secOf = (el: HTMLElement) => Math.min(sections.length - 1, Number(el.dataset.sec ?? 0));
    let prevSec = -1;

    for (let i = 0; i < blocks.length; i++) {
      const el = blocks[i];
      const si = secOf(el);
      if (si !== prevSec) {
        const type = sections[si].type;
        if (!cur || (type !== "continuous" && prevSec !== -1)) {
          newPage(si, true);
          // halaman genap/ganjil
          if (type === "oddPage" && plans.length % 2 === 0) newPage(si, false);
          else if (type === "evenPage" && plans.length % 2 === 1) newPage(si, false);
        } else if (cur) cur.sec = si;
        prevSec = si;
      }
      if (!cur) newPage(si, true);
      const c = () => cur!;
      if ((el.dataset.pbb === "1" || forceNew) && c().items.length > 0) newPage(si, false);
      forceNew = false;

      if (el.tagName === "TABLE") this.planTable(el, c, () => newPage(si, false));
      else {
        const hgt = outerH(el);
        // keepNext: jaga blok bersama pengikutnya
        if (el.dataset.kn === "1" && c().items.length > 0) {
          let chain = hgt;
          for (let j = i + 1; j < blocks.length && j < i + 6; j++) { const nb = blocks[j]; if (nb.tagName === "TABLE") break; chain += outerH(nb); if (nb.dataset.kn !== "1") break; }
          if (c().used + chain > c().avail && chain <= c().avail) newPage(si, false);
        }
        if (c().used + hgt > c().avail && c().items.length > 0) newPage(si, false);
        c().items.push({ el }); c().used += hgt;
      }
      if (el.dataset.pba === "1") forceNew = true;
    }
    if (!plans.length) newPage(0, true);

    // 2. terapkan ke DOM
    const total = plans.length;
    while (this.pages.length > total) { const p = this.pages.pop()!; p.remove(); }
    let pageInSec = 0, lastSec = -1;
    plans.forEach((plan, idx) => {
      const g = geoms[plan.sec], sect = sections[plan.sec];
      pageInSec = plan.sec === lastSec && !plan.first ? pageInSec + 1 : 1;
      lastSec = plan.sec;
      let page = this.pages[idx];
      if (!page) {
        page = doc.createElement("div");
        page.className = "dx-page";
        const body = doc.createElement("div"); body.className = "dx-body";
        const hdr = doc.createElement("div"); hdr.className = "dx-hdr"; hdr.contentEditable = "false";
        const ftr = doc.createElement("div"); ftr.className = "dx-ftr"; ftr.contentEditable = "false";
        const no = doc.createElement("div"); no.className = "dx-pgno"; no.contentEditable = "false";
        page.append(hdr, body, ftr, no);
        pagesEl.appendChild(page);
        this.pages[idx] = page;
      } else if (page.parentNode !== pagesEl || pagesEl.children[idx] !== page) pagesEl.insertBefore(page, pagesEl.children[idx] ?? null);
      const { top, bot } = availOf(plan.sec);
      page.dataset.sec = String(plan.sec);
      page.dataset.no = String(idx + 1);
      page.style.width = `${g.pageW}px`;
      page.style.minHeight = `${g.pageH}px`;
      const body = page.querySelector(":scope > .dx-body") as HTMLElement;
      body.style.left = `${g.ml}px`; body.style.top = `${top}px`; body.style.width = `${g.contentW}px`; body.style.minHeight = `${plan.avail}px`;
      body.style.paddingBottom = "0";
      const hdr = page.querySelector(":scope > .dx-hdr") as HTMLElement;
      const ftr = page.querySelector(":scope > .dx-ftr") as HTMLElement;
      hdr.style.left = `${g.ml}px`; hdr.style.top = `${g.hdrDist}px`; hdr.style.width = `${g.contentW}px`;
      ftr.style.left = `${g.ml}px`; ftr.style.bottom = `${g.ftrDist}px`; ftr.style.width = `${g.contentW}px`;
      void bot;
      const hk = this.hfKey(sect, "hdr", pageInSec, idx + 1), fk = this.hfKey(sect, "ftr", pageInSec, idx + 1);
      const sig = `${hk}|${fk}|${idx + 1}|${total}|${g.contentW}|${this.h.book.hfRev}`;
      if (page.dataset.hfsig !== sig) {
        page.dataset.hfsig = sig;
        hdr.textContent = ""; ftr.textContent = "";
        const hb = this.renderHF(hk, g.contentW); if (hb) hdr.appendChild(hb);
        const fb = this.renderHF(fk, g.contentW); if (fb) ftr.appendChild(fb);
        this.fillFields(page, idx + 1, total, pageInSec);
      }
      (page.querySelector(":scope > .dx-pgno") as HTMLElement).textContent = `${idx + 1} / ${total}`;
      // isi body
      const desired: HTMLElement[] = [];
      for (const it of plan.items) {
        desired.push(it.rows && it.rowEls ? this.tableFragmentFor(it) : it.el);
      }
      for (let k = 0; k < desired.length; k++) if (body.children[k] !== desired[k]) body.insertBefore(desired[k], body.children[k] ?? null);
      while (body.children.length > desired.length) body.lastElementChild!.remove();
    });
    for (const b of boxes.values()) b.remove();
    // buang fragmen tabel yatim
    for (const [canon, list] of this.frags) {
      if (!canon.isConnected) { this.frags.delete(canon); continue; }
      for (const f of list) if (!f.isConnected) f.remove();
    }
    this.count = total;
    this.layoutAnchors();
    this.layoutTabs();
    return total;
  }

  // ───────── tabel ─────────

  private planTable(tbl: HTMLElement, c: () => PagePlan, newPage: () => void) {
    if (tbl.dataset.fl) { c().items.push({ el: tbl }); return; }
    const xml = this.h.reg.elOf.get(tbl);
    const rowEls: HTMLElement[] = xml ? xml.children.filter(isEl).filter(x => x.name.local === "tr").map(tr => this.h.reg.domOf.get(tr)).filter((x): x is HTMLElement => !!x) : [];
    if (!rowEls.length) {
      const hgt = outerH(tbl);
      if (c().used + hgt > c().avail && c().items.length) newPage();
      c().items.push({ el: tbl }); c().used += hgt;
      return;
    }
    const grid = xml ? buildGrid(xml) : undefined;
    const orig = rowEls.map((_, i) => i);
    const hs = rowEls.map(r => r.offsetHeight);
    const total = hs.reduce((a, b) => a + b, 0);
    let hdrCount = 0;
    while (hdrCount < rowEls.length - 1 && rowEls[hdrCount].dataset.hdr === "1") hdrCount++;
    const hdrH = hs.slice(0, hdrCount).reduce((a, b) => a + b, 0);
    if (c().used + total <= c().avail) {
      c().items.push({ el: tbl, rows: [0, rowEls.length], rowEls, frag: 0, hdrCount, orig, grid }); c().used += total;
      return;
    }
    let from = 0, frag = 0;
    while (from < rowEls.length) {
      const rep = frag > 0 && from >= hdrCount ? hdrH : 0;
      // baris lebih tinggi dari satu halaman penuh → belah isi selnya per blok
      // (juga baris tinggi (> 160px) yang tidak muat di sisa halaman dibelah agar halaman terisi penuh, seperti Word)
      const remaining = c().avail - c().used - rep;
      const tooTall = hs[from] > c().avail - rep;
      if (rowEls[from].dataset.part === undefined && !rowEls[from].dataset.cs && hs[from] > remaining && (tooTall || (hs[from] > 160 && remaining >= 60))) {
        let cap0 = remaining;
        if (cap0 < 48 && c().items.length > 0) { newPage(); frag++; cap0 = c().avail - hdrH; }
        if (this.splitRow(rowEls, hs, orig, from, Math.max(40, cap0), Math.max(80, c().avail - hdrH), grid)) continue;
      }
      let to = from;
      let used = c().used + rep;
      while (to < rowEls.length && used + hs[to] <= c().avail) { used += hs[to]; to++; }
      if (to === from) {
        if (c().items.length > 0) { newPage(); continue; }
        used += hs[to]; to++; // satu baris lebih tinggi dari halaman: tempatkan sendirian
      }
      c().items.push({ el: tbl, rows: [from, to], rowEls, frag, hdrCount, orig, grid }); c().used = used;
      frag++; from = to;
      if (from < rowEls.length) newPage();
    }
  }

  private cellc(td: HTMLElement): HTMLElement | undefined {
    for (let c = td.firstElementChild; c; c = c.nextElementSibling) if (c.classList.contains("dx-cellc")) return c as HTMLElement;
    return undefined;
  }

  /** Belah satu baris menjadi beberapa bagian dengan memindahkan blok isi sel; bagian pertama tetap di baris asli. */
  private splitRow(rows: HTMLElement[], hs: number[], orig: number[], idx: number, cap0: number, capN: number, grid: Grid | undefined): boolean {
    const tr = rows[idx];
    const tds = [...tr.children].filter((e): e is HTMLElement => e.tagName === "TD");
    if (!tds.length || tds.some(td => (td as HTMLTableCellElement).rowSpan > 1)) return false;
    const cells = tds.map(td => this.cellc(td));
    if (cells.some(c => !c)) return false;
    const blocks = cells.map(c => [...c!.children] as HTMLElement[]);
    const bh = blocks.map(a => a.map(outerH));
    const oh = tds.map(td => { const st = cs(td); return (parseFloat(st.paddingTop) || 0) + (parseFloat(st.paddingBottom) || 0) + (parseFloat(st.borderTopWidth) || 0) + (parseFloat(st.borderBottomWidth) || 0); });
    const cur = tds.map(() => 0);
    const parts: { take: number[][]; h: number }[] = [];
    let guard = 0;
    while (cur.some((k, i) => k < blocks[i].length) && guard++ < 400) {
      const cap = parts.length === 0 ? cap0 : capN;
      const take: number[][] = tds.map(() => []);
      let partH = 0, any = false;
      tds.forEach((_, i) => {
        let h = oh[i];
        while (cur[i] < blocks[i].length && h + bh[i][cur[i]] <= cap) { h += bh[i][cur[i]]; take[i].push(cur[i]); cur[i]++; any = true; }
        partH = Math.max(partH, h);
      });
      if (!any) { // jamin kemajuan: paksa satu blok (lebih tinggi dari kapasitas)
        const i = cur.findIndex((k, j) => k < blocks[j].length);
        take[i].push(cur[i]); partH = Math.max(partH, oh[i] + bh[i][cur[i]]); cur[i]++;
      }
      parts.push({ take, h: partH });
    }
    if (parts.length < 2) return false;
    const frags: HTMLElement[] = [];
    for (let k = 1; k < parts.length; k++) {
      const ftr = tr.cloneNode(false) as HTMLElement;
      delete ftr.dataset.hdr;
      ftr.dataset.part = String(k);
      tds.forEach((td, i) => {
        const ftd = td.cloneNode(false) as HTMLElement;
        const inner = cells[i]!.cloneNode(false) as HTMLElement;
        for (const bi of parts[k].take[i]) inner.appendChild(blocks[i][bi]);
        ftd.appendChild(inner);
        const tc = this.h.reg.elOf.get(td);
        if (tc) this.h.reg.elOf.set(ftd, tc);
        ftr.appendChild(ftd);
      });
      // kolom yang ditutupi sel rowspan dari baris di atasnya: pertahankan posisinya dengan sel pengganti
      if (grid) for (const cl of grid.cells) if (cl.row === orig[idx] && cl.vm === "continue") this.addCover(ftr, grid, orig[idx], cl.col, cl.colspan, 1, this.h.reg.domOf.get(cl.origin.el));
      frags.push(ftr);
    }
    tr.dataset.part = "0";
    this.splitRows.push({ tr, frags });
    rows.splice(idx + 1, 0, ...frags);
    orig.splice(idx + 1, 0, ...frags.map(() => orig[idx]));
    hs.splice(idx, 1, ...parts.map(p => p.h));
    return true;
  }

  /** Sisipkan `td` pengganti pada baris DOM `tr` di posisi kolom grid `col` (menjaga penyejajaran sel lain). */
  private addCover(tr: HTMLElement, grid: Grid, origRow: number, col: number, colspan: number, rowspan: number, originEl?: HTMLElement) {
    const td = this.h.doc.createElement("td");
    td.className = "dx-cover";
    td.dataset.cover = "1";
    td.colSpan = colspan;
    if (rowspan > 1) td.rowSpan = rowspan;
    td.contentEditable = "false";
    if (originEl) {
      const st = originEl.style;
      td.style.borderLeft = st.borderLeft; td.style.borderRight = st.borderRight; td.style.backgroundColor = st.backgroundColor; td.style.padding = "0";
    }
    const before = grid.cells.filter(c => c.row === origRow && c.vm !== "continue" && c.col < col).length;
    const tds = [...tr.children].filter(e => e.tagName === "TD" && !(e as HTMLElement).dataset.cover);
    const ref = tds[before] ?? null;
    tr.insertBefore(td, ref);
    this.covers.push(td);
  }

  /** Kembalikan seluruh baris ke tabel kanonik agar tinggi baris diukur pada tabel utuh (bukan pada fragmen). */
  private unfragmentTables() {
    for (const [canon, list] of this.frags) {
      const xml = this.h.reg.elOf.get(canon);
      let tbody: HTMLElement | undefined;
      for (let c = canon.firstElementChild; c; c = c.nextElementSibling) if (c.tagName === "TBODY") { tbody = c as HTMLElement; break; }
      if (xml && tbody) {
        for (const r of xml.children) {
          if (!isEl(r) || r.name.local !== "tr") continue;
          const row = this.h.reg.domOf.get(r);
          if (row && row.parentNode !== tbody) tbody.appendChild(row);
        }
        // pertahankan urutan sesuai model
        for (const r of xml.children) { if (isEl(r) && r.name.local === "tr") { const row = this.h.reg.domOf.get(r); if (row) tbody.appendChild(row); } }
      }
      for (const f of list) f.remove();
    }
    this.frags.clear();
  }

  private unsplitRows() {
    for (const c of this.covers) c.remove();
    this.covers = [];
    for (const { tr, frags } of this.splitRows) {
      const tds = [...tr.children].filter((e): e is HTMLElement => e.tagName === "TD");
      for (const f of frags) {
        [...f.children].forEach((ftd, i) => {
          const dst = tds[i] ? this.cellc(tds[i]) : undefined;
          const src = this.cellc(ftd as HTMLElement);
          if (dst && src) while (src.firstChild) dst.appendChild(src.firstChild);
        });
        f.remove();
      }
      delete tr.dataset.part;
    }
    this.splitRows = [];
  }

  private tableFragmentFor(it: Item): HTMLElement {
    const canon = it.el as HTMLTableElement;
    const rows = it.rowEls!;
    const [from, to] = it.rows!;
    const idx = it.frag ?? 0;
    const frags = this.frags.get(canon) ?? [];
    this.frags.set(canon, frags);
    let table: HTMLTableElement;
    if (idx === 0) table = canon;
    else {
      table = frags[idx - 1];
      if (!table) {
        table = canon.cloneNode(false) as HTMLTableElement;
        table.classList.add("dx-frag");
        const cg = canon.querySelector(":scope > colgroup");
        if (cg) table.appendChild(cg.cloneNode(true));
        table.appendChild(this.h.doc.createElement("tbody"));
        frags[idx - 1] = table;
      }
    }
    const tbody = table.querySelector(":scope > tbody") as HTMLElement;
    const desired: HTMLElement[] = [];
    const hc = it.hdrCount ?? 0;
    if (idx > 0 && from >= hc) {
      for (let k = 0; k < hc; k++) {
        const clone = rows[k].cloneNode(true) as HTMLElement;
        clone.dataset.clone = "1"; clone.contentEditable = "false";
        desired.push(clone);
      }
    }
    for (let k = from; k < to; k++) desired.push(rows[k]);
    // sel rowspan yang dimulai di halaman sebelumnya tetap menempati kolomnya di awal fragmen ini
    if (it.grid && it.orig && from > 0) {
      const g = it.grid;
      const row0 = it.orig[from];
      const seen = new Set<unknown>();
      for (let cc = 0; cc < g.ncols; cc++) {
        const cell = g.map[row0]?.[cc];
        if (!cell || cell.vm !== "continue" || seen.has(cell.origin) || it.orig[from - 1] === row0) continue;
        seen.add(cell.origin);
        // jumlah baris DOM pada fragmen ini yang masih tercakup sel asal
        const last = cell.origin.row + cell.origin.rowspan - 1;
        let span = 0;
        for (let k = from; k < to && it.orig[k] <= last; k++) span++;
        this.addCover(rows[from], g, row0, cell.col, cell.colspan, Math.max(1, span), this.h.reg.domOf.get(cell.origin.el));
      }
    }
    [...tbody.children].forEach(ch => { if ((ch as HTMLElement).dataset.clone) ch.remove(); });
    for (let k = 0; k < desired.length; k++) if (tbody.children[k] !== desired[k]) tbody.insertBefore(desired[k], tbody.children[k] ?? null);
    while (tbody.children.length > desired.length) tbody.lastElementChild!.remove();
    return table;
  }

  // ───────── field halaman ─────────

  private fillFields(page: HTMLElement, no: number, total: number, inSec: number) {
    const set = (s: string, v: string) => page.querySelectorAll(`:is(.dx-hdr,.dx-ftr) [data-f="${s}"]`).forEach(e => { e.textContent = v; });
    set("PAGE", String(no)); set("NUMPAGES", String(total)); set("SECTIONPAGES", String(inSec)); set("SECTION", String(Number(page.dataset.sec ?? 0) + 1));
    const now = new Date();
    for (const k of ["DATE", "TIME", "SAVEDATE", "CREATEDATE"]) set(k, k === "TIME" ? now.toLocaleTimeString() : now.toLocaleDateString());
  }

  // ───────── gambar mengambang (wrapNone) ─────────

  /** Kerangka koordinat gambar mengambang: origin paragraf + dasar relatif (halaman/margin/…) dalam px halaman. */
  anchorBase(img: HTMLElement, info: ImgInfo) {
    const page = img.closest<HTMLElement>(".dx-page");
    const para = img.closest<HTMLElement>(".dx-p");
    if (!page || !para) return undefined;
    const sections = this.h.book.sections();
    const g = geomOf(sections[Math.min(sections.length - 1, Number(page.dataset.sec ?? 0))]);
    const pr = page.getBoundingClientRect();
    const z = pr.width / (g.pageW || 1) || 1;
    const rr = para.getBoundingClientRect();
    const px0 = (rr.left - pr.left) / z, py0 = (rr.top - pr.top) / z;
    const w = emuPx(info.cx), h = emuPx(info.cy);
    const body = page.querySelector(":scope > .dx-body") as HTMLElement;
    const bodyTop = body.offsetTop;
    const baseX = (rel?: string): [number, number] => rel === "page" ? [0, g.pageW] : rel === "leftMargin" ? [0, g.ml] : rel === "rightMargin" ? [g.pageW - g.mr, g.mr] : rel === "character" ? [px0, w] : [g.ml, g.contentW];
    const baseY = (rel?: string): [number, number] => rel === "page" ? [0, g.pageH] : rel === "topMargin" ? [0, bodyTop] : rel === "bottomMargin" ? [g.pageH - g.mb, g.mb] : rel === "paragraph" || rel === "line" ? [py0, h] : [bodyTop, body.offsetHeight];
    return { g, px0, py0, w, h, baseX, baseY };
  }

  layoutAnchors() {
    const { reg } = this.h;
    for (const page of this.pages) {
      const sections = this.h.book.sections();
      const pg = geomOf(sections[Math.min(sections.length - 1, Number(page.dataset.sec ?? 0))]);
      // gambar bungkus-none (abs) dan bungkus-persegi (float); termasuk yang ada di header/footer
      page.querySelectorAll<HTMLElement>('.dx-img[data-wrap="abs"], .dx-img[data-wrap="float"]').forEach(img => {
        const dr = reg.elOf.get(img);
        if (!dr) return;
        const isFloat = img.dataset.wrap === "float";
        if (isFloat) { img.style.position = "relative"; img.style.left = "0px"; img.style.top = "0px"; }
        const info = readDrawing(dr);
        const fr = info ? this.anchorBase(img, info) : undefined;
        if (!info || !fr) return;
        const { px0, py0, w, h, baseX, baseY } = fr;
        if (isFloat && !info.posH && !info.posV) return;
        let x = px0, y = py0;
        const hs = info.posH, vs = info.posV;
        if (hs) {
          const [b0, bw] = baseX(hs.rel);
          x = hs.align ? (hs.align === "center" ? b0 + (bw - w) / 2 : hs.align === "right" || hs.align === "outside" ? b0 + bw - w : b0) : b0 + emuPx(hs.off ?? 0);
        }
        if (vs) {
          const [b0, bh] = baseY(vs.rel);
          y = vs.align ? (vs.align === "center" ? b0 + (bh - h) / 2 : vs.align === "bottom" || vs.align === "outside" ? b0 + bh - h : b0) : b0 + emuPx(vs.off ?? 0);
        }
        if (isFloat) {
          // float CSS menentukan lilitan teks; geser (relative) ke posisi yang diminta dokumen — Word mengizinkan melewati margin
          const pr = page.getBoundingClientRect(), rr = img.getBoundingClientRect();
          const z = pr.width / (pg.pageW || 1) || 1;
          img.style.left = `${Math.round((x - (rr.left - pr.left) / z) * 100) / 100}px`;
          img.style.top = `${Math.round((y - (rr.top - pr.top) / z) * 100) / 100}px`;
          return;
        }
        img.style.left = `${Math.round((x - px0) * 100) / 100}px`;
        img.style.top = `${Math.round((y - py0) * 100) / 100}px`;
      });
      // tabel mengambang yang ditambatkan ke halaman / margin
      const body = page.querySelector<HTMLElement>(":scope > .dx-body");
      body?.querySelectorAll<HTMLElement>(":scope > table[data-fl]").forEach(t => {
        let f: { ha: string; va: string; x?: number; y?: number; xs?: string; ys?: string };
        try { f = JSON.parse(t.dataset.fl ?? "{}"); } catch { return; }
        const w = t.offsetWidth, h = t.offsetHeight, bodyTop = body.offsetTop;
        const [bx, bw] = f.ha === "page" ? [0, pg.pageW] : [pg.ml, pg.contentW];
        const [by, bh] = f.va === "page" ? [0, pg.pageH] : [bodyTop, pg.pageH - pg.mb - bodyTop];
        const x = f.xs === "center" ? bx + (bw - w) / 2 : f.xs === "right" || f.xs === "outside" ? bx + bw - w : f.xs ? bx : bx + twipPx(f.x ?? 0);
        const y = f.ys === "center" ? by + (bh - h) / 2 : f.ys === "bottom" || f.ys === "outside" ? by + bh - h : f.ys ? by : by + twipPx(f.y ?? 0);
        t.style.position = "absolute";
        t.style.left = `${Math.round((x - pg.ml) * 100) / 100}px`;
        t.style.top = `${Math.round((y - bodyTop) * 100) / 100}px`;
      });
    }
  }

  // ───────── tab stop kustom ─────────

  layoutTabs() {
    const defTab = twipPx(this.h.book.defaultTab());
    this.h.pagesEl.querySelectorAll<HTMLElement>(".dx-p[data-tabs]").forEach(p => layoutParagraphTabs(p, defTab));
  }
}

/** Hitung lebar `span.dx-tab` agar sejajar dengan tab stop kustom (left/center/right/decimal + leader). */
export function layoutParagraphTabs(p: HTMLElement, defTab: number) {
  let stops: { x: number; v: string; l?: string }[];
  try { stops = JSON.parse(p.dataset.tabs ?? "[]"); } catch { return; }
  if (!stops.length) return;
  const tabs = [...p.querySelectorAll<HTMLElement>(".dx-tab")];
  if (!tabs.length) return;
  const cssTabs = (e: HTMLElement) => { e.style.display = ""; e.style.width = ""; e.style.minWidth = ""; };
  tabs.forEach(cssTabs);
  const pr = p.getBoundingClientRect();
  const z = pr.width && p.offsetWidth ? pr.width / p.offsetWidth : 1;
  const padL = parseFloat(getComputedStyle(p).paddingLeft) || 0;
  const originX = pr.left + padL * z;
  const indent = parseFloat(getComputedStyle(p).marginLeft) || 0; // stop diukur dari margin kiri halaman, bukan indent
  for (const t of tabs) {
    const r = t.getBoundingClientRect();
    const x = (r.left - originX) / z + indent;
    const next = stops.find(s => s.x > x + 1) ?? { x: Math.ceil((x + 1) / defTab) * defTab, v: "left" };
    // lebar teks setelah tab sampai tab berikutnya / akhir baris
    let w = 0;
    if (next.v !== "left") {
      const range = document.createRange();
      range.setStartAfter(t);
      let end: Node | null = null;
      const nextTab = tabs[tabs.indexOf(t) + 1];
      if (nextTab) range.setEndBefore(nextTab); else range.setEnd(p, p.childNodes.length);
      void end;
      w = range.getBoundingClientRect().width / z;
    }
    let target = next.x - x;
    if (next.v === "right") target -= w;
    else if (next.v === "center") target -= w / 2;
    else if (next.v === "decimal") target -= w / 2;
    t.style.display = "inline-block";
    t.style.width = `${Math.max(0, target)}px`;
    t.style.tabSize = "0";
    t.style.whiteSpace = "pre";
    t.style.overflow = "hidden";
    t.style.verticalAlign = "bottom";
    if (next.l && next.l !== "none") t.dataset.leader = next.l; else delete t.dataset.leader;
  }
}

export { attr, first, num };
export type { XEl };
