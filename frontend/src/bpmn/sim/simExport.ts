// ── Exportación de resultados de simulación a Excel ──────────────────────────
// Genera un libro multi-hoja en formato SpreadsheetML 2003 (XML de Excel), que
// Excel/LibreOffice abren de forma nativa, sin dependencias externas.

export type XlsCell = { v: string | number; style?: "hdr" | "title" | "sub" };
export type XlsSheet = { name: string; rows: XlsCell[][] };

export const cell = (v: string | number): XlsCell => ({ v });
export const hdr = (v: string | number): XlsCell => ({ v, style: "hdr" });
export const title = (v: string | number): XlsCell => ({ v, style: "title" });
export const sub = (v: string | number): XlsCell => ({ v, style: "sub" });

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function sheetName(name: string): string {
  // Excel: máx 31 chars y sin : \ / ? * [ ]
  return name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Hoja";
}

function cellXml(c: XlsCell): string {
  const isNum = typeof c.v === "number" && Number.isFinite(c.v);
  const type = isNum ? "Number" : "String";
  const data = isNum ? String(c.v) : esc(String(c.v));
  const style = c.style ? ` ss:StyleID="${c.style}"` : "";
  return `<Cell${style}><Data ss:Type="${type}">${data}</Data></Cell>`;
}

function worksheetXml(sheet: XlsSheet): string {
  const rows = sheet.rows
    .map((r) => `   <Row>${r.map(cellXml).join("")}</Row>`)
    .join("\n");
  return (
    ` <Worksheet ss:Name="${esc(sheetName(sheet.name))}">\n` +
    `  <Table>\n${rows}\n  </Table>\n` +
    ` </Worksheet>`
  );
}

function workbookXml(sheets: XlsSheet[]): string {
  return (
    `<?xml version="1.0"?>\n` +
    `<?mso-application progid="Excel.Sheet"?>\n` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n` +
    ` xmlns:o="urn:schemas-microsoft-com:office:office"\n` +
    ` xmlns:x="urn:schemas-microsoft-com:office:excel"\n` +
    ` xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n` +
    ` <Styles>\n` +
    `  <Style ss:ID="hdr"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#0E7490" ss:Pattern="Solid"/></Style>\n` +
    `  <Style ss:ID="title"><Font ss:Bold="1" ss:Size="13" ss:Color="#0F172A"/></Style>\n` +
    `  <Style ss:ID="sub"><Font ss:Bold="1" ss:Color="#0E7490"/></Style>\n` +
    ` </Styles>\n` +
    sheets.map(worksheetXml).join("\n") +
    `\n</Workbook>`
  );
}

/** Construye el libro y dispara la descarga (.xls que abre Excel). */
export function downloadXls(filename: string, sheets: XlsSheet[]): void {
  const xml = workbookXml(sheets);
  const blob = new Blob(["﻿" + xml], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xls") ? filename : `${filename}.xls`;
  a.click();
  URL.revokeObjectURL(url);
}
