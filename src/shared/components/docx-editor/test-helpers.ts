import { listOle, readCfb, type Ole10Native } from "./docx-ole";
import type { DocxBook } from "./docx-model";

export async function readOle(book: DocxBook): Promise<{ progId?: string; native?: Ole10Native }[]> {
  return listOle(book).map(o => {
    const data = book.part(o.part)?.data;
    const info = data ? readCfb(data) : undefined;
    return { progId: o.progId, native: info?.native };
  });
}
