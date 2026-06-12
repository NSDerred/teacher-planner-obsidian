import writeXlsxFile, { type Sheet } from "write-excel-file/browser";

export type SheetRows = (string | number | null | undefined)[][];

/**
 * Builds an .xlsx workbook from plain arrays-of-arrays using write-excel-file
 * (write-only library — replaced `xlsx`, which carried a parsing advisory).
 */
export async function buildXlsx(sheets: { name: string; rows: SheetRows }[]): Promise<ArrayBuffer> {
  const data: Sheet<never>[] = sheets.map(s => ({
    sheet: s.name,
    data: s.rows.map(row => row.map(v => {
      if (v === null || v === undefined || v === "") return null;
      if (typeof v === "number") return { type: Number, value: v };
      return { type: String, value: String(v) };
    })),
  }));
  const blob = await writeXlsxFile(data).toBlob();
  return blob.arrayBuffer();
}
