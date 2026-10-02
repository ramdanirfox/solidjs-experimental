import XlsxPreview, { type XlsxPreviewProps } from "~/shared/components/xlsx-preview/XlsxPreview";

export type ISJXXlsxPreview = XlsxPreviewProps;

/**
 * Preview XLSX/XLSM berbasis @office-kit/xlsx.
 * Komponen ini hanya boleh dirender di client (gunakan `clientOnly` pada route) karena memakai
 * Blob, canvas, ResizeObserver, dan File API.
 */
export default function SJXXlsxPreview(props: ISJXXlsxPreview) {
    return <XlsxPreview {...props} />;
}
