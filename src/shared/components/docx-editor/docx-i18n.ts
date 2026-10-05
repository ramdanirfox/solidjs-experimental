/** Internasionalisasi antarmuka editor DOCX (en & id). Placeholder: `{nama}`. Kunci tak ditemukan → en → kunci itu sendiri. */
import type { Accessor } from "solid-js";

export type Lang = "en" | "id";
export type Dict = Record<string, string>;

const en: Dict = {
  // busy / confirm / drop
  "busy.loading": "Loading…", "busy.opening": "Opening document…", "busy.sample": "Building sample document…",
  "confirm.discard": "Discard unsaved changes and open another document?",
  "drop.hint": "Drop a .docx file or picture here",
  // buttons
  "b.open": "Open", "b.openTip": "Open a local Word file (.docx / .docm)", "b.sample": "Load sample document", "b.save": "Save", "b.saveTip": "Download the document with your changes",
  "b.export": "Download", "b.undo": "Undo", "b.redo": "Redo", "b.history": "Undo history", "b.find": "Find", "b.info": "Document information", "b.log": "Read log", "b.ole": "OLE objects & macros", "b.debug": "Debug information",
  "b.language": "Language", "b.close": "Close", "b.cancel": "Cancel", "b.apply": "Apply", "b.copy": "Copy", "b.download": "Download", "b.refresh": "Refresh", "b.source": "Original file",
  "b.painter": "Format painter", "b.painterTip": "Copy the formatting at the cursor, then select text to apply it (Esc cancels)", "b.painterSticky": "Format painter — stays active for many selections",
  "b.font": "Font", "b.size": "Font size", "b.sizeUp": "Increase font size", "b.sizeDown": "Decrease font size", "b.bold": "Bold", "b.italic": "Italic", "b.underline": "Underline", "b.strike": "Strikethrough",
  "b.sub": "Subscript", "b.sup": "Superscript", "b.case": "Change case", "b.color": "Text color", "b.highlight": "Highlight", "b.clearFmt": "Clear formatting",
  "b.bullets": "Bulleted list", "b.numbers": "Numbered list", "b.outdent": "Decrease indent", "b.indent": "Increase indent", "b.alignL": "Align left", "b.alignC": "Center", "b.alignR": "Align right", "b.alignJ": "Justify",
  "b.lineSpacing": "Line spacing", "b.spaceBefore": "Toggle 12 pt space before", "b.spaceAfter": "Toggle 8 pt space after", "b.shading": "Paragraph shading", "b.style": "Paragraph style",
  "b.picture": "Picture", "b.table": "Table", "b.link": "Link", "b.unlink": "Remove link", "b.pageBreak": "Page break", "b.symbol": "Symbol", "b.acceptAll": "Accept all changes", "b.rejectAll": "Reject all changes",
  // tabs & groups
  "tab.home": "Home", "tab.insert": "Insert", "tab.table": "Table", "tab.picture": "Picture", "tab.layout": "Layout", "tab.view": "View",
  "g.clipboard": "Clipboard", "g.font": "Font", "g.paragraph": "Paragraph", "g.styles": "Styles", "g.insert": "Insert", "g.review": "Revisions", "g.rowsCols": "Rows & columns", "g.merge": "Merge & select", "g.cell": "Cell",
  "g.table": "Table", "g.size": "Size", "g.wrap": "Text wrapping", "g.transform": "Transform & crop", "g.picture": "Picture", "g.pageSetup": "Page", "g.margins": "Margins", "g.zoom": "Zoom", "g.show": "Show", "g.window": "Window",
  "g.ruler": "Ruler", "ruler.show": "Ruler", "ruler.showTip": "Show rulers. Drag from a ruler to create alignment guides.", "ruler.unit": "Ruler unit", "ruler.measure": "Measure", "ruler.measureTip": "Measure distance: drag on the page (Shift locks the axis, Esc clears)", "ruler.clearGuides": "Clear guides", "ruler.guides": "{n} guide(s)", "ruler.corner": "Ruler unit (click to change)", "ruler.removeGuide": "Drag to move. Drag onto the ruler or double-click to remove.",
  "ole.insert": "Object…", "ole.insertTip": "Embed a file (xlsx, docx, pptx or any file) as an OLE object at the cursor", "ole.update": "Replace content…", "ole.updateTip": "Replace the embedded file of the selected object (undo restores the previous one)", "ole.size": "Display size", "ole.width": "Width (cm)", "ole.height": "Height (cm)",
  "toast.oleInserted": "OLE object inserted: {name}", "toast.oleUpdated": "OLE object updated: {name}", "toast.oleFail": "OLE failed: {msg}",
  "log.oleInserted": "Inserted OLE object {name} ({kind}, {progId}, {size} bytes)", "log.oleUpdated": "Updated OLE object with {name} ({kind}, {progId}, {size} bytes)", "log.oleActionFail": "OLE {action} failed {name}: {msg}",
  // table tab
  "t.rowAbove": "Row above", "t.rowBelow": "Row below", "t.colLeft": "Column left", "t.colRight": "Column right", "t.delRow": "Delete row", "t.delCol": "Delete column", "t.delTable": "Delete table",
  "t.merge": "Merge cells", "t.split": "Split cell", "t.selTable": "Select table", "t.selRow": "Select row", "t.selCol": "Select column", "t.shade": "Cell shading", "t.noShade": "No shading",
  "t.vTop": "Align top", "t.vMid": "Align middle", "t.vBot": "Align bottom", "t.borders": "Borders", "t.borderStyle": "Border style", "t.borderWidth": "Border width", "t.borderColor": "Border color",
  "t.style": "Table style", "t.styleNone": "(table style)", "t.headerRow": "Header row", "t.banded": "Banded rows", "t.firstCol": "First column", "t.alignL": "Table left", "t.alignC": "Table center", "t.alignR": "Table right",
  "t.distCols": "Distribute columns", "t.fixed": "Fixed", "t.fixedTip": "Fixed column widths", "t.auto": "AutoFit", "t.autoTip": "Let the content size the columns", "t.rowH": "Row height (cm)",
  "bd.all": "All borders", "bd.outer": "Outside borders", "bd.inner": "Inside borders", "bd.top": "Top border", "bd.bottom": "Bottom border", "bd.left": "Left border", "bd.right": "Right border", "bd.insideH": "Inside horizontal", "bd.insideV": "Inside vertical", "bd.none": "No borders",
  // picture tab
  "p.width": "W", "p.height": "H", "p.lock": "Lock aspect ratio (Shift temporarily inverts while dragging)", "p.locked": "Locked", "p.free": "Free", "p.reset": "Original size", "p.resetTip": "Reset to the original picture size",
  "p.floatL": "Float left", "p.floatC": "Float center", "p.floatR": "Float right", "p.rotateCCW": "Rotate left", "p.rotateCW": "Rotate right", "p.flipH": "Flip horizontally", "p.flipV": "Flip vertically",
  "p.crop": "Crop", "p.cropTip": "Crop {side} (%)", "p.alt": "Alt text", "p.replace": "Replace", "p.duplicate": "Duplicate", "p.delete": "Delete",
  "wrap.inline": "In line with text", "wrap.square": "Square (text wraps)", "wrap.topBottom": "Top and bottom", "wrap.behind": "Behind text", "wrap.front": "In front of text",
  // layout
  "l.size": "Paper size", "l.custom": "Custom", "l.portrait": "Portrait", "l.landscape": "Landscape", "l.margins": "Margins", "l.marginPreset": "Margin presets", "l.m.normal": "Normal", "l.m.narrow": "Narrow", "l.m.moderate": "Moderate", "l.m.wide": "Wide",
  "l.top": "Top", "l.bottom": "Bottom", "l.left": "Left", "l.right": "Right",
  // view
  "v.zoomIn": "Zoom in", "v.zoomOut": "Zoom out", "v.fitWidth": "Fit width", "v.fitPage": "Fit page", "v.marks": "Formatting marks (¶)", "v.revisions": "Show revisions", "v.dark": "Dark mode", "v.outline": "Outline",
  "v.hideToolbar": "Hide toolbar", "v.showToolbar": "Show toolbar", "v.fullscreen": "Full screen", "v.exitFs": "Exit full screen",
  // menus
  "m.docx": "Word document (.docx) with changes", "m.txt": "Plain text (.txt)", "m.html": "Web page (.html)", "m.source": "Original file (unchanged)", "m.new": "New blank document", "m.pickTable": "Pick table size",
  "case.upper": "UPPERCASE", "case.lower": "lowercase", "case.title": "Title Case",
  // painter chip
  "painter.copied": "Format copied:", "painter.once": "applies once", "painter.sticky": "stays active — press Esc to stop",
  "pk.font": "font", "pk.size": "size", "pk.bold": "bold", "pk.italic": "italic", "pk.underline": "underline", "pk.strike": "strike", "pk.color": "color", "pk.highlight": "highlight", "pk.vert": "script", "pk.caps": "caps", "pk.smallCaps": "small caps",
  "pk.style": "style", "pk.align": "align", "pk.indLeft": "indent", "pk.spacing": "spacing", "pk.line": "line", "pk.list": "list", "pk.shading": "shading",
  // panels
  "panel.find": "Find", "panel.info": "Document information", "panel.log": "Read log", "panel.ole": "OLE objects & macros", "panel.history": "Undo history", "panel.outline": "Outline",
  "find.placeholder": "Find in document…", "find.prev": "Previous", "find.next": "Next", "find.case": "Match case", "find.word": "Whole word", "find.regex": "Regular expression", "find.advanced": "Advanced",
  "find.flags": "Flags", "find.flagS": "dotAll — “.” also matches line breaks inside a paragraph", "find.flagM": "multiline — ^ and $ match at line breaks", "find.regexHelp": "JavaScript regular expressions (Unicode). Matches stay within one paragraph. Capture groups are listed under each hit.",
  "find.replaceWith": "Replace with…", "find.replaceOne": "Replace the current match", "find.replaceAll": "Replace all", "find.badRegex": "Invalid expression", "find.count": "matches", "find.truncated": "limited to the first 5,000",
  "find.more": "Show {n} more", "find.whereBody": "Paragraph {p}", "find.whereTable": "Table {t} · row {r}, column {c} · paragraph {p}", "find.page": "page {n}", "find.offset": "char {n}",
  "outline.empty": "No headings in this document.",
  "hist.max": "Max records", "hist.count": "{n} recorded changes · position {i}",
  "log.all": "All", "log.ok": "Read", "log.warn": "Limited", "log.error": "Errors",
  // info
  "info.file": "File", "info.name": "Name", "info.size": "Size", "info.parts": "Package parts", "info.modified": "Unsaved changes", "info.yes": "Yes", "info.no": "No", "info.compat": "Compatibility mode",
  "info.stats": "Statistics", "info.pages": "Pages (rendered)", "info.words": "Words", "info.chars": "Characters", "info.noSpaces": "no spaces", "info.paragraphs": "Paragraphs", "info.tables": "Tables", "info.images": "Pictures", "info.headings": "Headings",
  "info.styles": "Styles", "info.comments": "Comments", "info.appStats": "Written by", "info.props": "Properties", "info.applyProps": "Apply properties", "info.sections": "Sections", "info.pageSize": "Page", "info.margins": "Margins (cm)", "info.type": "Type",
  "info.validation": "Package validation", "info.partsList": "Package contents",
  "prop.title": "Title", "prop.creator": "Author", "prop.subject": "Subject", "prop.keywords": "Keywords", "prop.description": "Description", "prop.category": "Category", "prop.lastModifiedBy": "Last modified by", "prop.created": "Created", "prop.modified": "Modified", "prop.revision": "Revision",
  // OLE
  "ole.help": "Embedded objects found in the document. Double-click an object on the page to jump here. Objects are never executed.", "ole.none": "No OLE objects found.", "ole.linked": "linked", "ole.detail": "Details", "ole.part": "Part", "ole.relType": "Relationship", "ole.aspect": "Display",
  "ole.kind": "Detected as", "ole.userType": "User type", "ole.embedded": "Embedded file", "ole.srcPath": "Original path", "ole.dlRaw": "Download object", "ole.dlNative": "Extract embedded file", "ole.zipNote": "This object is an Office Open XML package (zip). Download it and open it with the matching application.",
  "ole.structure": "Compound file structure (click a stream to preview)", "ole.entry": "Entry", "ole.type": "Type", "ole.noStream": "Stream could not be read.", "ole.macros": "VBA macro project", "ole.macroNote": "Macros are listed for inspection only. They are never run and are preserved untouched when saving.",
  "ole.preview": "Preview", "ole.previewTip": "Show the embedded file in a dialog (text, image, audio, video, PDF)", "ole.previewTitle": "Object preview", "ole.previewNone": "This object cannot be previewed in the browser (not text or a common media type).", "ole.truncated": "Showing only the first part of the file.", "ole.previewFail": "Could not preview the object: {msg}",
  "ole.readVba": "Read macro modules", "ole.noSource": "(source could not be decoded)",
  // status
  "s.page": "Page {p} of {n}", "s.words": "{n} words", "s.para": "¶ {i}/{n}", "s.col": "col {n}", "s.selected": "Selected: {c} chars · {w} words · {p} ¶", "s.list": "list", "s.table": "Table {n} · R{r}C{c} ({rows}×{cols})", "s.merged": "merged cell",
  "s.cellsel": "{r}×{c} cells selected", "s.image": "Picture {w} × {h} cm", "s.history": "undo {i}/{n} (max {max})", "s.historyTip": "Position in the undo history",
  // tags
  "tag.readonly": "Read-only", "tag.readonlyTip": "Read-only mode: editing is disabled", "tag.macro": "macro", "tag.macroTip": "Document contains a VBA project (never executed, kept intact)", "tag.modifiedTip": "Unsaved changes",
  // dialogs
  "dlg.debug": "Debug information", "dlg.debugHelp": "Snapshot of the document, layout, history and the paragraph at the cursor (resolved styles + raw XML).", "dlg.link": "Hyperlink", "dlg.linkTip": "Tooltip (optional)", "dlg.linkSelect": "Select some text first to turn it into a link.",
  // errors
  "err.empty": "The file is empty", "err.legacy-doc": "Binary .doc (Word 97–2003) is not supported", "err.encrypted": "This document is password-protected (encrypted)", "err.not-zip": "This is not a .docx (OPC/ZIP) file", "err.no-main": "No main document part found",
  "err.parse": "The document could not be read", "err.fetch": "The document could not be downloaded", "err.hint": "Save it as .docx from Word (File → Save As) or remove the password, then open it again.", "err.cfb": "Container contents ({kind})",
  // toast
  "toast.saved": "Downloaded “{name}”", "toast.saveFail": "Could not build the file — see the log", "toast.copied": "Copied", "toast.replaced": "{n} replaced", "toast.propsSaved": "Properties updated", "toast.revisions": "{n} revisions resolved",
  "toast.linkBlocked": "Link not opened: {href}", "toast.noBookmark": "Bookmark “{name}” not found", "toast.imgUnsupported": "“{name}” is not a supported picture", "toast.imgFail": "Could not insert “{name}”",
  // history labels
  "hist.open": "Opened", "hist.undo": "Undo", "hist.redo": "Redo", "hist.jump": "Jump", "hist.typing": "Typing", "hist.enter": "New paragraph", "hist.delete": "Delete", "hist.break": "Line break", "hist.pageBreak": "Page break", "hist.merge": "Join paragraphs",
  "hist.list": "List", "hist.format": "Character format", "hist.color": "Color", "hist.font": "Font", "hist.clear": "Clear formatting", "hist.align": "Alignment", "hist.style": "Style", "hist.spacing": "Spacing", "hist.border": "Border", "hist.indent": "Indent",
  "hist.link": "Hyperlink", "hist.paste": "Paste", "hist.painter": "Format painter", "hist.replace": "Replace", "hist.props": "Properties", "hist.revisions": "Revisions", "hist.page": "Page setup",
  "hist.tbl": "Table", "hist.tblInsert": "Insert table", "hist.tblRow": "Insert row", "hist.tblCol": "Insert column", "hist.tblDelRow": "Delete row", "hist.tblDelCol": "Delete column", "hist.tblDelete": "Delete table", "hist.tblMerge": "Merge cells",
  "hist.tblSplit": "Split cell", "hist.tblShade": "Cell shading", "hist.tblAlign": "Cell/table alignment", "hist.tblBorder": "Borders", "hist.tblStyle": "Table style", "hist.tblResize": "Resize table",
  "hist.imgInsert": "Insert picture",
  "hist.oleInsert": "Insert OLE object", "hist.oleUpdate": "Update OLE object", "hist.oleSize": "Resize OLE object", "hist.imgResize": "Resize picture", "hist.imgWrap": "Picture wrapping", "hist.imgAlt": "Alt text", "hist.imgRotate": "Rotate / flip picture", "hist.imgCrop": "Crop picture", "hist.imgMove": "Move picture", "hist.imgDelete": "Delete picture", "hist.imgReplace": "Replace picture",
  // log
  "log.loaded": "Opened “{name}” ({size} bytes).", "log.parts": "Package contains {n} parts.", "log.mainPart": "Main document part: {part}.", "log.styles": "Read {n} styles (paragraph, character, table).", "log.theme": "Theme colors and fonts read ({n} colors).",
  "log.noStyles": "No styles part — default formatting is used.", "log.numbering": "Numbering read: {abstract} list definitions, {nums} lists.", "log.sections": "{n} section(s) read (page size, margins, headers/footers).",
  "log.content": "Content read: {paragraphs} paragraphs, {tables} tables, {words} words.", "log.images": "Pictures: {inline} inline, {floating} floating (layout applied).", "log.imageFormat": "{n} picture(s) in a format browsers cannot show ({list}); a placeholder is drawn instead.",
  "log.headerFooter": "Headers: {h}, footers: {f} (read-only on the page).", "log.notes": "Footnotes: {fn}, endnotes: {en} (shown after the content).", "log.comments": "{n} comment(s) read (listed in Document information).",
  "log.revisions": "Tracked changes found: {ins} insertions, {del} deletions (shown as markup; use Accept/Reject).", "log.fields": "{n} field instruction(s); cached results are shown, PAGE/NUMPAGES in headers/footers are computed.",
  "log.links": "{n} hyperlink(s).", "log.sdt": "{n} content control(s) (content shown).", "log.bookmarks": "{n} bookmark(s).",
  "log.math": "{n} equation(s) (OMML) shown as plain text only.", "log.charts": "{n} chart(s) are not rendered (placeholder).", "log.diagrams": "SmartArt diagrams are not rendered (placeholder).", "log.shapes": "{n} drawing shape(s): only text and simple boxes are rendered.",
  "log.vml": "{n} legacy VML shape(s): pictures are shown, other shapes are placeholders.", "log.frames": "{n} text frame(s) are laid out as normal paragraphs.", "log.floatingTables": "Floating tables are laid out inline.", "log.columns": "Multi-column sections are laid out in a single column.",
  "log.ruby": "Ruby (phonetic guide) text is shown without annotations.", "log.textDir": "Vertical text direction is only partly supported.", "log.fieldCache": "TOC / reference fields show their cached result (not recalculated).",
  "log.macro": "VBA macro project found ({part}). Macros are NOT executed or edited; they are listed in the OLE panel and preserved when saving.", "log.ole": "{n} embedded object part(s) found — see the OLE panel.", "log.activeX": "ActiveX controls are present but not rendered or executed.",
  "log.signature": "Digital signature present — it is not verified and will be invalid after any edit.", "log.customXml": "Custom XML parts are preserved but ignored.", "log.compat": "Compatibility mode {mode}: layout may differ slightly from Word.",
  "log.validation": "Package check [{code}]: {msg}", "log.validateFail": "Package validation failed: {msg}", "log.imgFormat": "Picture format {fmt} cannot be shown ({part}).", "log.imgDecode": "Picture could not be decoded ({fmt}, {part}).",
  "log.placeholder": "A {kind} object is shown as a placeholder.", "log.imgInsertFail": "Could not insert the picture: {msg}", "log.saveFail": "Could not build the .docx: {msg}", "log.oleFail": "Could not read OLE object {part}: {msg}",
};

const id: Dict = {
  "busy.loading": "Memuat…", "busy.opening": "Membuka dokumen…", "busy.sample": "Membuat dokumen contoh…",
  "confirm.discard": "Buang perubahan yang belum disimpan dan buka dokumen lain?",
  "drop.hint": "Lepas berkas .docx atau gambar di sini",
  "b.open": "Buka", "b.openTip": "Buka berkas Word lokal (.docx / .docm)", "b.sample": "Muat dokumen contoh", "b.save": "Simpan", "b.saveTip": "Unduh dokumen beserta perubahan",
  "b.export": "Unduh", "b.undo": "Urungkan", "b.redo": "Ulangi", "b.history": "Riwayat undo", "b.find": "Cari", "b.info": "Informasi dokumen", "b.log": "Log pembacaan", "b.ole": "Objek OLE & makro", "b.debug": "Informasi debug",
  "b.language": "Bahasa", "b.close": "Tutup", "b.cancel": "Batal", "b.apply": "Terapkan", "b.copy": "Salin", "b.download": "Unduh", "b.refresh": "Segarkan", "b.source": "Berkas asli",
  "b.painter": "Format painter", "b.painterTip": "Salin format di kursor, lalu blok teks tujuan untuk menerapkannya (Esc membatalkan)", "b.painterSticky": "Format painter — tetap aktif untuk banyak blok",
  "b.font": "Font", "b.size": "Ukuran font", "b.sizeUp": "Perbesar font", "b.sizeDown": "Perkecil font", "b.bold": "Tebal", "b.italic": "Miring", "b.underline": "Garis bawah", "b.strike": "Coret",
  "b.sub": "Subskrip", "b.sup": "Superskrip", "b.case": "Ubah huruf besar/kecil", "b.color": "Warna teks", "b.highlight": "Sorot", "b.clearFmt": "Hapus format",
  "b.bullets": "Daftar berbutir", "b.numbers": "Daftar bernomor", "b.outdent": "Kurangi indentasi", "b.indent": "Tambah indentasi", "b.alignL": "Rata kiri", "b.alignC": "Tengah", "b.alignR": "Rata kanan", "b.alignJ": "Rata kiri-kanan",
  "b.lineSpacing": "Spasi baris", "b.spaceBefore": "Alihkan spasi sebelum 12 pt", "b.spaceAfter": "Alihkan spasi sesudah 8 pt", "b.shading": "Latar paragraf", "b.style": "Gaya paragraf",
  "b.picture": "Gambar", "b.table": "Tabel", "b.link": "Tautan", "b.unlink": "Hapus tautan", "b.pageBreak": "Jeda halaman", "b.symbol": "Simbol", "b.acceptAll": "Terima semua perubahan", "b.rejectAll": "Tolak semua perubahan",
  "tab.home": "Beranda", "tab.insert": "Sisip", "tab.table": "Tabel", "tab.picture": "Gambar", "tab.layout": "Tata letak", "tab.view": "Tampilan",
  "g.clipboard": "Papan klip", "g.font": "Font", "g.paragraph": "Paragraf", "g.styles": "Gaya", "g.insert": "Sisipkan", "g.review": "Revisi", "g.rowsCols": "Baris & kolom", "g.merge": "Gabung & pilih", "g.cell": "Sel",
  "g.table": "Tabel", "g.size": "Ukuran", "g.wrap": "Pembungkusan teks", "g.transform": "Transformasi & potong", "g.picture": "Gambar", "g.pageSetup": "Halaman", "g.margins": "Margin", "g.zoom": "Zoom", "g.show": "Tampilkan", "g.window": "Jendela",
  "g.ruler": "Penggaris", "ruler.show": "Penggaris", "ruler.showTip": "Tampilkan penggaris. Seret dari penggaris untuk membuat garis bantu perataan.", "ruler.unit": "Satuan penggaris", "ruler.measure": "Ukur", "ruler.measureTip": "Ukur jarak: seret di halaman (Shift mengunci sumbu, Esc menghapus)", "ruler.clearGuides": "Hapus garis bantu", "ruler.guides": "{n} garis bantu", "ruler.corner": "Satuan penggaris (klik untuk mengganti)", "ruler.removeGuide": "Seret untuk memindah. Seret ke penggaris atau klik ganda untuk menghapus.",
  "ole.insert": "Objek…", "ole.insertTip": "Tanamkan berkas (xlsx, docx, pptx, atau berkas apa pun) sebagai objek OLE di kursor", "ole.update": "Ganti isi…", "ole.updateTip": "Ganti berkas tertanam pada objek terpilih (undo mengembalikan yang lama)", "ole.size": "Ukuran tampilan", "ole.width": "Lebar (cm)", "ole.height": "Tinggi (cm)",
  "toast.oleInserted": "Objek OLE disisipkan: {name}", "toast.oleUpdated": "Objek OLE diperbarui: {name}", "toast.oleFail": "OLE gagal: {msg}",
  "log.oleInserted": "Objek OLE {name} disisipkan ({kind}, {progId}, {size} byte)", "log.oleUpdated": "Objek OLE diperbarui dengan {name} ({kind}, {progId}, {size} byte)", "log.oleActionFail": "OLE {action} gagal {name}: {msg}",
  "t.rowAbove": "Baris di atas", "t.rowBelow": "Baris di bawah", "t.colLeft": "Kolom di kiri", "t.colRight": "Kolom di kanan", "t.delRow": "Hapus baris", "t.delCol": "Hapus kolom", "t.delTable": "Hapus tabel",
  "t.merge": "Gabung sel", "t.split": "Pisah sel", "t.selTable": "Pilih tabel", "t.selRow": "Pilih baris", "t.selCol": "Pilih kolom", "t.shade": "Warna isi sel", "t.noShade": "Tanpa isi",
  "t.vTop": "Rata atas", "t.vMid": "Rata tengah", "t.vBot": "Rata bawah", "t.borders": "Border", "t.borderStyle": "Gaya garis", "t.borderWidth": "Tebal garis", "t.borderColor": "Warna garis",
  "t.style": "Gaya tabel", "t.styleNone": "(gaya tabel)", "t.headerRow": "Baris header", "t.banded": "Baris berselang-seling", "t.firstCol": "Kolom pertama", "t.alignL": "Tabel rata kiri", "t.alignC": "Tabel di tengah", "t.alignR": "Tabel rata kanan",
  "t.distCols": "Ratakan kolom", "t.fixed": "Tetap", "t.fixedTip": "Lebar kolom tetap", "t.auto": "AutoFit", "t.autoTip": "Ukuran kolom mengikuti isi", "t.rowH": "Tinggi baris (cm)",
  "bd.all": "Semua border", "bd.outer": "Border luar", "bd.inner": "Border dalam", "bd.top": "Border atas", "bd.bottom": "Border bawah", "bd.left": "Border kiri", "bd.right": "Border kanan", "bd.insideH": "Dalam horizontal", "bd.insideV": "Dalam vertikal", "bd.none": "Tanpa border",
  "p.width": "L", "p.height": "T", "p.lock": "Kunci rasio aspek (Shift membalik sementara saat menyeret)", "p.locked": "Terkunci", "p.free": "Bebas", "p.reset": "Ukuran asli", "p.resetTip": "Kembalikan ke ukuran asli gambar",
  "p.floatL": "Mengambang kiri", "p.floatC": "Mengambang tengah", "p.floatR": "Mengambang kanan", "p.rotateCCW": "Putar kiri", "p.rotateCW": "Putar kanan", "p.flipH": "Balik horizontal", "p.flipV": "Balik vertikal",
  "p.crop": "Potong", "p.cropTip": "Potong sisi {side} (%)", "p.alt": "Teks alternatif", "p.replace": "Ganti", "p.duplicate": "Duplikat", "p.delete": "Hapus",
  "wrap.inline": "Sebaris dengan teks", "wrap.square": "Persegi (teks membungkus)", "wrap.topBottom": "Atas dan bawah", "wrap.behind": "Di belakang teks", "wrap.front": "Di depan teks",
  "l.size": "Ukuran kertas", "l.custom": "Kustom", "l.portrait": "Potret", "l.landscape": "Lanskap", "l.margins": "Margin", "l.marginPreset": "Preset margin", "l.m.normal": "Normal", "l.m.narrow": "Sempit", "l.m.moderate": "Sedang", "l.m.wide": "Lebar",
  "l.top": "Atas", "l.bottom": "Bawah", "l.left": "Kiri", "l.right": "Kanan",
  "v.zoomIn": "Perbesar", "v.zoomOut": "Perkecil", "v.fitWidth": "Pas lebar", "v.fitPage": "Pas halaman", "v.marks": "Tanda format (¶)", "v.revisions": "Tampilkan revisi", "v.dark": "Mode gelap", "v.outline": "Kerangka",
  "v.hideToolbar": "Sembunyikan toolbar", "v.showToolbar": "Tampilkan toolbar", "v.fullscreen": "Layar penuh", "v.exitFs": "Keluar layar penuh",
  "m.docx": "Dokumen Word (.docx) dengan perubahan", "m.txt": "Teks polos (.txt)", "m.html": "Halaman web (.html)", "m.source": "Berkas asli (tanpa perubahan)", "m.new": "Dokumen kosong baru", "m.pickTable": "Pilih ukuran tabel",
  "case.upper": "HURUF BESAR", "case.lower": "huruf kecil", "case.title": "Huruf Awal Kapital",
  "painter.copied": "Format tersalin:", "painter.once": "berlaku sekali", "painter.sticky": "tetap aktif — tekan Esc untuk berhenti",
  "pk.font": "font", "pk.size": "ukuran", "pk.bold": "tebal", "pk.italic": "miring", "pk.underline": "garis bawah", "pk.strike": "coret", "pk.color": "warna", "pk.highlight": "sorot", "pk.vert": "skrip", "pk.caps": "kapital", "pk.smallCaps": "kapital kecil",
  "pk.style": "gaya", "pk.align": "rata", "pk.indLeft": "indentasi", "pk.spacing": "spasi", "pk.line": "baris", "pk.list": "daftar", "pk.shading": "latar",
  "panel.find": "Cari", "panel.info": "Informasi dokumen", "panel.log": "Log pembacaan", "panel.ole": "Objek OLE & makro", "panel.history": "Riwayat undo", "panel.outline": "Kerangka",
  "find.placeholder": "Cari di dokumen…", "find.prev": "Sebelumnya", "find.next": "Berikutnya", "find.case": "Cocokkan huruf besar/kecil", "find.word": "Kata utuh", "find.regex": "Ekspresi reguler", "find.advanced": "Lanjutan",
  "find.flags": "Flag", "find.flagS": "dotAll — “.” juga cocok dengan pindah baris di dalam paragraf", "find.flagM": "multiline — ^ dan $ cocok di pindah baris", "find.regexHelp": "Ekspresi reguler JavaScript (Unicode). Kecocokan terbatas dalam satu paragraf. Grup tangkapan ditampilkan di bawah tiap hasil.",
  "find.replaceWith": "Ganti dengan…", "find.replaceOne": "Ganti kecocokan saat ini", "find.replaceAll": "Ganti semua", "find.badRegex": "Ekspresi tidak valid", "find.count": "kecocokan", "find.truncated": "dibatasi 5.000 pertama",
  "find.more": "Tampilkan {n} lagi", "find.whereBody": "Paragraf {p}", "find.whereTable": "Tabel {t} · baris {r}, kolom {c} · paragraf {p}", "find.page": "hal. {n}", "find.offset": "karakter {n}",
  "outline.empty": "Tidak ada judul pada dokumen ini.",
  "hist.max": "Maks. catatan", "hist.count": "{n} perubahan tercatat · posisi {i}",
  "log.all": "Semua", "log.ok": "Terbaca", "log.warn": "Terbatas", "log.error": "Kesalahan",
  "info.file": "Berkas", "info.name": "Nama", "info.size": "Ukuran", "info.parts": "Bagian paket", "info.modified": "Perubahan belum disimpan", "info.yes": "Ya", "info.no": "Tidak", "info.compat": "Mode kompatibilitas",
  "info.stats": "Statistik", "info.pages": "Halaman (hasil render)", "info.words": "Kata", "info.chars": "Karakter", "info.noSpaces": "tanpa spasi", "info.paragraphs": "Paragraf", "info.tables": "Tabel", "info.images": "Gambar", "info.headings": "Judul",
  "info.styles": "Gaya", "info.comments": "Komentar", "info.appStats": "Dibuat oleh", "info.props": "Properti", "info.applyProps": "Terapkan properti", "info.sections": "Section", "info.pageSize": "Halaman", "info.margins": "Margin (cm)", "info.type": "Tipe",
  "info.validation": "Validasi paket", "info.partsList": "Isi paket",
  "prop.title": "Judul", "prop.creator": "Penulis", "prop.subject": "Subjek", "prop.keywords": "Kata kunci", "prop.description": "Deskripsi", "prop.category": "Kategori", "prop.lastModifiedBy": "Terakhir diubah oleh", "prop.created": "Dibuat", "prop.modified": "Diubah", "prop.revision": "Revisi",
  "ole.help": "Objek tertanam yang ditemukan di dokumen. Klik ganda objek pada halaman untuk melompat ke sini. Objek tidak pernah dieksekusi.", "ole.none": "Tidak ada objek OLE.", "ole.linked": "tertaut", "ole.detail": "Detail", "ole.part": "Part", "ole.relType": "Relasi", "ole.aspect": "Tampilan",
  "ole.kind": "Dikenali sebagai", "ole.userType": "Tipe pengguna", "ole.embedded": "Berkas tertanam", "ole.srcPath": "Path asal", "ole.dlRaw": "Unduh objek", "ole.dlNative": "Ekstrak berkas tertanam", "ole.zipNote": "Objek ini adalah paket Office Open XML (zip). Unduh dan buka dengan aplikasi yang sesuai.",
  "ole.structure": "Struktur compound file (klik stream untuk pratinjau)", "ole.entry": "Entri", "ole.type": "Tipe", "ole.noStream": "Stream tidak dapat dibaca.", "ole.macros": "Proyek makro VBA", "ole.macroNote": "Makro hanya ditampilkan untuk diperiksa. Tidak pernah dijalankan dan dipertahankan utuh saat disimpan.",
  "ole.preview": "Pratinjau", "ole.previewTip": "Tampilkan berkas tertanam di dialog (teks, gambar, audio, video, PDF)", "ole.previewTitle": "Pratinjau objek", "ole.previewNone": "Objek ini tidak dapat dipratinjau di browser (bukan teks atau media umum).", "ole.truncated": "Hanya bagian awal berkas yang ditampilkan.", "ole.previewFail": "Objek tidak dapat dipratinjau: {msg}",
  "ole.readVba": "Baca modul makro", "ole.noSource": "(kode sumber tidak dapat didekode)",
  "s.page": "Halaman {p} dari {n}", "s.words": "{n} kata", "s.para": "¶ {i}/{n}", "s.col": "kol {n}", "s.selected": "Terpilih: {c} karakter · {w} kata · {p} ¶", "s.list": "daftar", "s.table": "Tabel {n} · B{r}K{c} ({rows}×{cols})", "s.merged": "sel gabungan",
  "s.cellsel": "{r}×{c} sel terpilih", "s.image": "Gambar {w} × {h} cm", "s.history": "undo {i}/{n} (maks {max})", "s.historyTip": "Posisi dalam riwayat undo",
  "tag.readonly": "Baca-saja", "tag.readonlyTip": "Mode baca-saja: penyuntingan dinonaktifkan", "tag.macro": "makro", "tag.macroTip": "Dokumen memuat proyek VBA (tidak dieksekusi, dipertahankan utuh)", "tag.modifiedTip": "Perubahan belum disimpan",
  "dlg.debug": "Informasi debug", "dlg.debugHelp": "Cuplikan dokumen, tata letak, riwayat, dan paragraf pada kursor (style terselesaikan + XML mentah).", "dlg.link": "Hyperlink", "dlg.linkTip": "Tooltip (opsional)", "dlg.linkSelect": "Blok teks terlebih dahulu untuk dijadikan tautan.",
  "err.empty": "Berkas kosong", "err.legacy-doc": "Format .doc biner (Word 97–2003) tidak didukung", "err.encrypted": "Dokumen ini diproteksi password (terenkripsi)", "err.not-zip": "Ini bukan berkas .docx (OPC/ZIP)", "err.no-main": "Bagian dokumen utama tidak ditemukan",
  "err.parse": "Dokumen tidak dapat dibaca", "err.fetch": "Dokumen tidak dapat diunduh", "err.hint": "Simpan sebagai .docx dari Word (File → Save As) atau hapus password, lalu buka kembali.", "err.cfb": "Isi kontainer ({kind})",
  "toast.saved": "“{name}” diunduh", "toast.saveFail": "Berkas tidak dapat dibuat — lihat log", "toast.copied": "Tersalin", "toast.replaced": "{n} diganti", "toast.propsSaved": "Properti diperbarui", "toast.revisions": "{n} revisi diselesaikan",
  "toast.linkBlocked": "Tautan tidak dibuka: {href}", "toast.noBookmark": "Bookmark “{name}” tidak ditemukan", "toast.imgUnsupported": "“{name}” bukan gambar yang didukung", "toast.imgFail": "Gagal menyisipkan “{name}”",
  "hist.open": "Dibuka", "hist.undo": "Urungkan", "hist.redo": "Ulangi", "hist.jump": "Lompat", "hist.typing": "Mengetik", "hist.enter": "Paragraf baru", "hist.delete": "Hapus", "hist.break": "Pindah baris", "hist.pageBreak": "Jeda halaman", "hist.merge": "Gabung paragraf",
  "hist.list": "Daftar", "hist.format": "Format karakter", "hist.color": "Warna", "hist.font": "Font", "hist.clear": "Hapus format", "hist.align": "Perataan", "hist.style": "Gaya", "hist.spacing": "Spasi", "hist.border": "Border", "hist.indent": "Indentasi",
  "hist.link": "Hyperlink", "hist.paste": "Tempel", "hist.painter": "Format painter", "hist.replace": "Ganti", "hist.props": "Properti", "hist.revisions": "Revisi", "hist.page": "Pengaturan halaman",
  "hist.tbl": "Tabel", "hist.tblInsert": "Sisip tabel", "hist.tblRow": "Sisip baris", "hist.tblCol": "Sisip kolom", "hist.tblDelRow": "Hapus baris", "hist.tblDelCol": "Hapus kolom", "hist.tblDelete": "Hapus tabel", "hist.tblMerge": "Gabung sel",
  "hist.tblSplit": "Pisah sel", "hist.tblShade": "Isi sel", "hist.tblAlign": "Perataan sel/tabel", "hist.tblBorder": "Border", "hist.tblStyle": "Gaya tabel", "hist.tblResize": "Ubah ukuran tabel",
  "hist.imgInsert": "Sisip gambar",
  "hist.oleInsert": "Sisip objek OLE", "hist.oleUpdate": "Perbarui objek OLE", "hist.oleSize": "Ubah ukuran objek OLE", "hist.imgResize": "Ubah ukuran gambar", "hist.imgWrap": "Pembungkusan gambar", "hist.imgAlt": "Teks alternatif", "hist.imgRotate": "Putar / balik gambar", "hist.imgCrop": "Potong gambar", "hist.imgMove": "Pindah gambar", "hist.imgDelete": "Hapus gambar", "hist.imgReplace": "Ganti gambar",
  "log.loaded": "Membuka “{name}” ({size} byte).", "log.parts": "Paket berisi {n} bagian.", "log.mainPart": "Bagian dokumen utama: {part}.", "log.styles": "Membaca {n} style (paragraf, karakter, tabel).", "log.theme": "Warna dan font tema terbaca ({n} warna).",
  "log.noStyles": "Tidak ada bagian styles — memakai format bawaan.", "log.numbering": "Penomoran terbaca: {abstract} definisi daftar, {nums} daftar.", "log.sections": "{n} section terbaca (ukuran halaman, margin, header/footer).",
  "log.content": "Isi terbaca: {paragraphs} paragraf, {tables} tabel, {words} kata.", "log.images": "Gambar: {inline} sebaris, {floating} mengambang (tata letak diterapkan).", "log.imageFormat": "{n} gambar berformat yang tidak dapat ditampilkan browser ({list}); diganti placeholder.",
  "log.headerFooter": "Header: {h}, footer: {f} (baca-saja pada halaman).", "log.notes": "Catatan kaki: {fn}, catatan akhir: {en} (ditampilkan setelah isi).", "log.comments": "{n} komentar terbaca (daftar di Informasi dokumen).",
  "log.revisions": "Ditemukan perubahan terlacak: {ins} sisipan, {del} hapusan (ditampilkan sebagai markup; gunakan Terima/Tolak).", "log.fields": "{n} instruksi field; hasil cache ditampilkan, PAGE/NUMPAGES pada header/footer dihitung.",
  "log.links": "{n} hyperlink.", "log.sdt": "{n} kontrol konten (isi ditampilkan).", "log.bookmarks": "{n} bookmark.",
  "log.math": "{n} persamaan (OMML) hanya ditampilkan sebagai teks biasa.", "log.charts": "{n} grafik tidak dirender (placeholder).", "log.diagrams": "Diagram SmartArt tidak dirender (placeholder).", "log.shapes": "{n} bentuk gambar: hanya teks dan kotak sederhana yang dirender.",
  "log.vml": "{n} bentuk VML lama: gambar ditampilkan, bentuk lain berupa placeholder.", "log.frames": "{n} bingkai teks ditata sebagai paragraf biasa.", "log.floatingTables": "Tabel mengambang ditata sebaris.", "log.columns": "Section multi-kolom ditata satu kolom.",
  "log.ruby": "Teks ruby (panduan fonetik) ditampilkan tanpa anotasi.", "log.textDir": "Arah teks vertikal hanya didukung sebagian.", "log.fieldCache": "Field TOC / referensi menampilkan hasil cache (tidak dihitung ulang).",
  "log.macro": "Proyek makro VBA ditemukan ({part}). Makro TIDAK dieksekusi atau diubah; ditampilkan di panel OLE dan dipertahankan saat menyimpan.", "log.ole": "{n} bagian objek tertanam ditemukan — lihat panel OLE.", "log.activeX": "Kontrol ActiveX ada tetapi tidak dirender atau dieksekusi.",
  "log.signature": "Tanda tangan digital ada — tidak diverifikasi dan menjadi tidak valid setelah diedit.", "log.customXml": "Bagian custom XML dipertahankan tetapi diabaikan.", "log.compat": "Mode kompatibilitas {mode}: tata letak dapat sedikit berbeda dari Word.",
  "log.validation": "Pemeriksaan paket [{code}]: {msg}", "log.validateFail": "Validasi paket gagal: {msg}", "log.imgFormat": "Format gambar {fmt} tidak dapat ditampilkan ({part}).", "log.imgDecode": "Gambar tidak dapat didekode ({fmt}, {part}).",
  "log.placeholder": "Objek {kind} ditampilkan sebagai placeholder.", "log.imgInsertFail": "Gagal menyisipkan gambar: {msg}", "log.saveFail": "Gagal membuat .docx: {msg}", "log.oleFail": "Gagal membaca objek OLE {part}: {msg}",
};

export const DICTS: Record<Lang, Dict> = { en, id };

export function translate(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const raw = DICTS[lang][key] ?? DICTS.en[key] ?? key;
  return params ? raw.replace(/\{(\w+)\}/g, (_m, k: string) => (params[k] !== undefined ? String(params[k]) : `{${k}}`)) : raw;
}

export function createI18n(lang: Accessor<Lang>) {
  return { t: (key: string, params?: Record<string, string | number>) => translate(lang(), key, params) };
}
