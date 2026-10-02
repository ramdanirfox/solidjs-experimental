/**
 * Pemetaan posisi DOM ⇄ offset teks datar paragraf (lihat konvensi di docx-render.ts).
 * Aturan: node teks = panjang string; `[data-skip]` = 0; `[data-u=n]` = n; `<br>` tanpa data-u = 0.
 */

const isEl = (n: Node): n is HTMLElement => n.nodeType === 1;

function atomLen(e: HTMLElement): number | undefined {
  if (e.dataset.skip !== undefined) return 0;
  if (e.dataset.u !== undefined) return Number(e.dataset.u) || 1;
  if (e.tagName === "BR") return 0;
  return undefined;
}

export function domFlatLength(root: Node): number {
  let n = 0;
  const walk = (x: Node) => {
    if (x.nodeType === 3) { n += (x.nodeValue ?? "").length; return; }
    if (isEl(x)) { const a = atomLen(x); if (a !== undefined) { n += a; return; } }
    for (let c = x.firstChild; c; c = c.nextSibling) walk(c);
  };
  walk(root);
  return n;
}

/** Teks datar DOM; atom `data-u` menjadi U+FFFC (tab/br diambil dari node teks / "\n"). */
export function domFlatText(root: Node): string {
  let s = "";
  const walk = (x: Node) => {
    if (x.nodeType === 3) { s += x.nodeValue ?? ""; return; }
    if (isEl(x)) {
      const a = atomLen(x);
      if (a !== undefined) {
        if (a > 0) s += x.tagName === "BR" ? "\n" : x.classList.contains("dx-pb") ? "\f" : "￼".repeat(a);
        return;
      }
    }
    for (let c = x.firstChild; c; c = c.nextSibling) walk(c);
  };
  walk(root);
  return s;
}

/** Titik batas DOM (node, offset) → offset datar. Titik di dalam atom dipetakan ke tepi atom. */
export function domOffsetToFlat(root: HTMLElement, node: Node, offset: number): number {
  let acc = 0;
  const posIn = (x: Node): number | undefined => {
    if (x === node) {
      if (x.nodeType === 3) return acc + Math.min(offset, (x.nodeValue ?? "").length);
      const atom = isEl(x) ? atomLen(x) : undefined;
      if (atom !== undefined) return acc + (offset > 0 ? atom : 0);
      let k = 0;
      for (let c = x.firstChild; c; c = c.nextSibling, k++) { if (k === offset) return acc; acc += domFlatLength(c); }
      return acc;
    }
    if (x.contains(node)) {
      const atom = isEl(x) ? atomLen(x) : undefined;
      if (atom !== undefined) return acc + atom;
      for (let c = x.firstChild; c; c = c.nextSibling) { const r = posIn(c); if (r !== undefined) return r; }
      return acc;
    }
    acc += domFlatLength(x);
    return undefined;
  };
  return posIn(root) ?? acc;
}

export interface DomPos { node: Node; offset: number }

const idxOf = (n: Node) => { let i = 0; for (let c = n.parentNode?.firstChild; c; c = c.nextSibling, i++) if (c === n) return i; return 0; };

/** Offset datar → posisi DOM. Pada batas dua node teks memilih akhir node sebelumnya (ketik melanjutkan format sebelumnya). */
export function flatToDomPos(root: HTMLElement, flat: number): DomPos {
  let acc = 0;
  let prev: DomPos | undefined; // akhir node teks tepat sebelum posisi `acc`
  let found: DomPos | undefined;
  const walk = (x: Node) => {
    if (found) return;
    if (x.nodeType === 3) {
      const len = (x.nodeValue ?? "").length;
      if (len === 0) return;
      if (flat <= acc + len) {
        found = flat === acc && prev ? prev : { node: x, offset: flat - acc };
        return;
      }
      acc += len;
      prev = { node: x, offset: len };
      return;
    }
    if (isEl(x)) {
      const a = atomLen(x);
      if (a !== undefined) {
        if (a > 0) {
          if (flat === acc) { found = prev ?? { node: x.parentNode!, offset: idxOf(x) }; return; }
          acc += a;
          prev = undefined;
          if (flat < acc) { found = { node: x.parentNode!, offset: idxOf(x) + 1 }; }
        } else if (x.classList.contains("dx-pad") && flat === acc && !prev) found = { node: x.parentNode!, offset: idxOf(x) };
        return;
      }
    }
    for (let c = x.firstChild; c && !found; c = c.nextSibling) walk(c);
  };
  walk(root);
  if (found) return found;
  if (prev) return prev;
  for (let c = root.firstChild; c; c = c.nextSibling) if (isEl(c) && c.classList.contains("dx-pad")) return { node: root, offset: idxOf(c) };
  return { node: root, offset: root.childNodes.length };
}

export function rangeFromFlat(root: HTMLElement, a: number, b: number): Range {
  const r = root.ownerDocument.createRange();
  const s = flatToDomPos(root, a);
  const e = a === b ? s : flatToDomPos(root, b);
  r.setStart(s.node, s.offset);
  r.setEnd(e.node, e.offset);
  return r;
}
