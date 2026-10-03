/** Daftar halaman contoh — satu sumber untuk beranda, navigasi atas, dan pencarian (src/app.tsx). */
export interface IExample {
  route: string;
  title: string;
  /** Label pendek untuk navigasi. */
  short: string;
  desc: string;
  tags: string[];
  gradient: string;
  icon: string;
  featured?: boolean;
  badge?: string;
  /** Kata kunci tambahan untuk pencarian. */
  keywords?: string[];
}

export const EXAMPLES: IExample[] = [
  {
    route: "docx-editor",
    title: "DOCX Editor",
    short: "DOCX Editor",
    desc: "Editor Word di browser: kertas halaman dengan style OOXML, tabel (gabung/pisah sel, resize), gambar (resize bebas / kunci rasio, wrap), format painter, cari regex, OLE (cfb), undo history, ekspor DOCX/TXT/HTML, dan i18n id/en.",
    tags: ["@office-kit/docx", "client-only", "OOXML", "cfb", "i18n"],
    gradient: "linear-gradient(135deg, #2b579a, #4f8fe0)",
    icon: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 13h6 M9 17h4",
    featured: true,
    badge: "Baru",
    keywords: ["word", "docx", "dokumen", "document", "editor", "ole", "makro", "macro", "tabel", "gambar", "regex", "cari", "search", "format painter"],
  },
  {
    route: "pptx-editor",
    title: "PPTX Editor",
    short: "PPTX Editor",
    desc: "Editor PowerPoint di browser: slide dirender dari model OOXML (bentuk preset & kustom, teks kaya, tabel, grafik, gambar, grup), seret/ubah ukuran/putar dengan garis pandu, edit teks langsung, miniatur + urut ulang, catatan, transisi, slideshow, cari & ganti, undo history, ekspor PPTX, dan i18n id/en.",
    tags: ["@office-kit/pptx", "client-only", "OOXML", "slides", "i18n"],
    gradient: "linear-gradient(135deg, #c43e1c, #f08a6c)",
    icon: "M3 4h18v12H3z M8 21h8 M12 16v5 M7 9h6 M7 12h10",
    featured: true,
    badge: "Baru",
    keywords: ["powerpoint", "pptx", "presentasi", "presentation", "slide", "slideshow", "editor", "shape", "bentuk", "catatan", "notes", "transisi", "transition", "makro", "macro"],
  },
  {
    route: "maxgraph-editor",
    title: "Maxgraph Node Editor",
    short: "Node Editor",
    desc: "Editor diagram node berbasis @maxgraph/core: palet node seret-lepas, sambungan dengan validasi, undo/redo, salin/tempel, zoom & pan, minimap, tata letak otomatis, menu klik kanan, serta impor/ekspor XML, SVG, dan PNG. API props lengkap + handle imperatif.",
    tags: ["@maxgraph/core", "client-only", "diagram", "SVG"],
    gradient: "linear-gradient(135deg, #7c3aed, #2563eb)",
    icon: "M4 5h6v5H4z M14 14h6v5h-6z M10 7.5h4a3 3 0 0 1 3 3V14",
    badge: "Baru",
    keywords: ["diagram", "node", "flowchart", "flow", "graph", "maxgraph", "mxgraph", "drawio", "workflow", "editor"],
  },
  {
    route: "xlsx-preview",
    title: "XLSX / XLSM Preview",
    short: "XLSX Preview",
    desc: "Grid Excel lengkap yang dirender di browser dari OOXML: style asli, freeze panes, hidden row/kolom, merge, gambar mengambang, autofilter, evaluasi formula, pencarian lintas sheet, edit, dan ekspor XLSX/CSV.",
    tags: ["@office-kit/xlsx", "client-only", "OOXML", "formula", "XLSM"],
    gradient: "linear-gradient(135deg, #059669, #10b981)",
    icon: "M3 3h18v18H3z M3 9h18 M3 15h18 M9 3v18 M15 3v18",
    featured: true,
    keywords: ["excel", "spreadsheet", "lembar kerja", "formula", "csv"],
  },
  { route: "golden-layout", title: "Golden Layout", short: "Golden Layout", desc: "Tata letak panel multi-window yang dapat diseret, dengan komponen Solid di dalam tiap panel.", tags: ["golden-layout", "dockview"], gradient: "linear-gradient(135deg, #6366f1, #8b5cf6)", icon: "M3 3h8v8H3z M13 3h8v5h-8z M13 10h8v11h-8z M3 13h8v8H3z", keywords: ["panel", "dock", "layout"] },
  { route: "svar", title: "Svar Gantt", short: "Svar Gantt", desc: "Mounting komponen React (wx-react-gantt) di dalam aplikasi SolidJS lewat jembatan.", tags: ["react-solid-bridge", "gantt"], gradient: "linear-gradient(135deg, #0ea5e9, #6366f1)", icon: "M4 6h10 M8 12h12 M6 18h9", keywords: ["gantt", "jadwal", "react"] },
  { route: "aggrid", title: "Legacy AG Grid", short: "AG Grid", desc: "Tabel data AG Grid 28 dengan solid-ag-grid: sorting, filter, dan pengeditan.", tags: ["ag-grid", "table"], gradient: "linear-gradient(135deg, #f59e0b, #ef4444)", icon: "M3 4h18v16H3z M3 10h18 M9 4v16", keywords: ["tabel", "grid", "data"] },
  { route: "solid-google-maps", title: "Solid Google Maps", short: "Google Maps", desc: "Google Maps dengan overlay DeckGL dan Terra Draw untuk menggambar fitur.", tags: ["google-maps", "deck.gl"], gradient: "linear-gradient(135deg, #14b8a6, #3b82f6)", icon: "M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z", keywords: ["peta", "map", "gis"] },
  { route: "chart-3d", title: "Sample 3D Chart", short: "3D Chart", desc: "Grafik tiga dimensi interaktif (dibuat bersama vibes).", tags: ["3d", "chart"], gradient: "linear-gradient(135deg, #ec4899, #8b5cf6)", icon: "M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z M12 12l8-4.5 M12 12v9 M12 12L4 7.5", keywords: ["grafik", "three", "visualisasi"] },
  { route: "globe-maplibre", title: "Globe MapLibre", short: "Globe", desc: "Peta globe 3D dengan MapLibre GL, label negara lokal, dan interaksi hover.", tags: ["maplibre", "globe"], gradient: "linear-gradient(135deg, #2563eb, #06b6d4)", icon: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3 12h18 M12 3c2.5 2.7 3.8 5.7 3.8 9S14.5 18.3 12 21c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z", keywords: ["peta", "bumi", "map"] },
];

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export interface ExampleHit { example: IExample; score: number }

/** Cari contoh: semua kata kueri harus cocok (judul > tag/kata kunci > deskripsi). */
export function searchExamples(query: string, list: IExample[] = EXAMPLES): ExampleHit[] {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return list.map(example => ({ example, score: 0 }));
  const out: ExampleHit[] = [];
  for (const ex of list) {
    const title = norm(ex.title + " " + ex.short), tags = norm(ex.tags.join(" ") + " " + (ex.keywords ?? []).join(" ")), desc = norm(ex.desc), route = norm(ex.route);
    let score = 0, ok = true;
    for (const t of terms) {
      if (title.includes(t)) score += title.startsWith(t) ? 12 : 8;
      else if (route.includes(t)) score += 6;
      else if (tags.includes(t)) score += 5;
      else if (desc.includes(t)) score += 2;
      else { ok = false; break; }
    }
    if (ok) out.push({ example: ex, score });
  }
  return out.sort((a, b) => b.score - a.score);
}
