/**
 * Permukaan publik `editor-kit`: kontrak bus, ganti/cari, format, drop, tata letak, tautan, warna, dan penggaris yang dipakai semua editor.
 * Modul lain di folder ini bersifat internal. Semua ekspor bernama (tanpa efek samping modul) agar dapat di-tree-shake; CSS hanya ikut
 * bila modul pemiliknya terpakai (`ruler-kit`, `layout`, `ColorField`, `LinkPanel`).
 */
export { createEventBus, dispatchCommand } from "./events";
export type { CommandEventDetail, EditorEventBus, EventBusOptions, EventHandler, EventMeta } from "./events";

export type { FindMatch, FindResult, FindSpec, NavEvent, OfficeNavEvents, ReplaceKind, ReplaceReport, ReplaceSpec } from "./find-replace";
export { VALUE_KINDS, isValueKind } from "./find-replace";

export type { LinkItem, LinkKind, OfficeLinkEvents } from "./hyperlink";
export { classifyLink, isUnsafeUrl, normalizeLink } from "./hyperlink";

export type { FormatProps, FormatReport, FormatSpec, FormatStroke, OfficeFormatEvents, OfficeStructureEvents } from "./format";
export { COMMON_FORMAT_KEYS, splitFormatKeys } from "./format";

export type { DropConfig, DropInfo, DropItem, DropKind, DropReport, DropRejection, OfficeDropEvents } from "./drop";
export { DEFAULT_DROP_ACCEPT, DEFAULT_DROP_MAX_SIZE, DROP_KINDS, classifyDataTransfer, createDropController, itemsFromInput } from "./drop";

export type { LayoutInfo, LayoutMode, LayoutSetting, OfficeLayoutEvents } from "./layout";
export { LAYOUT_MODES, NARROW_MAX, createLayoutController, resolveLayout } from "./layout";

export type { FileInput, OfficeCommonEvents, OfficeOleEvents, OleEventInfo, OleInsertOptions } from "./office-events";

export { compositeOver, cssRgba, normalizeHex, parseCssColor, parseHex, toHex } from "./color-util";
export type { RulerUnit } from "./ruler-core";
export { RULER_UNITS } from "./ruler-core";
export { RulerKit } from "./ruler-kit";
export type { RulerEventMap } from "./ruler-kit";
