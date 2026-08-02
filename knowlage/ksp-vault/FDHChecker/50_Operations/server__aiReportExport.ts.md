---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "operations"
source: "server/aiReportExport.ts"
source_hash: "2b42601cb6d269f0657ff042a1656b5fa25c05d273aa0ab2ff731496873cc72b"
managed_by: "sync-ksp-vault"
---
# aiReportExport.ts

> Source: `server/aiReportExport.ts`
> SHA-256: `2b42601cb6d269f0657ff042a1656b5fa25c05d273aa0ab2ff731496873cc72b`

````typescript
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import AdmZip from 'adm-zip';
import * as XLSX from 'xlsx';

export type ReportColumn = {
  key: string;
  label: string;
  width?: number;
};

export type ExportableReport = {
  title: string;
  subtitle?: string;
  metadata?: Array<{ label: string; value: string }>;
  columns: ReportColumn[];
  rows: Array<Record<string, unknown>>;
  wordColumnKeys?: string[];
};

export type ReportFormat = 'docx' | 'xlsx' | 'csv' | 'json';

export type ReportAttachment = {
  filename: string;
  mimeType: string;
  base64: string;
  size: number;
};

const printableValue = (value: unknown) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
};

const WORD_FONT_NAME = 'Tahoma';
const THAI_FONT = { name: WORD_FONT_NAME, hint: 'eastAsia' as const };

// docx sets the Latin font attributes but some Word-compatible readers ignore
// Thai glyphs unless the eastAsia/complex-script attributes are also present.
// Normalizing the generated OOXML keeps Thai readable on Word and LibreOffice.
const normalizeWordFonts = (buffer: Buffer) => {
  const archive = new AdmZip(buffer);
  for (const path of ['word/document.xml', 'word/styles.xml']) {
    const entry = archive.getEntry(path);
    if (!entry) continue;
    const xml = entry.getData().toString('utf8').replace(/<w:rFonts\b[^>]*\/>/g, (tag) => {
      const withoutFontAttributes = tag.replace(/\s+w:(?:ascii|hAnsi|eastAsia|cs)="[^"]*"/g, '');
      return withoutFontAttributes.replace(
        '/>',
        ` w:ascii="${WORD_FONT_NAME}" w:hAnsi="${WORD_FONT_NAME}" w:eastAsia="${WORD_FONT_NAME}" w:cs="${WORD_FONT_NAME}"/>`,
      );
    });
    archive.updateFile(path, Buffer.from(xml, 'utf8'));
  }
  return archive.toBuffer();
};

const safeFilename = (value: string) => (
  value.toLowerCase().replace(/[^a-z0-9ก-๙_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'fdh-report'
);

const attachment = (
  filename: string,
  mimeType: string,
  buffer: Buffer,
): ReportAttachment => ({
  filename,
  mimeType,
  base64: buffer.toString('base64'),
  size: buffer.length,
});

const buildExcel = (report: ExportableReport) => {
  const header = report.columns.map((column) => column.label);
  const data = report.rows.map((row) => report.columns.map((column) => {
    const value = row[column.key];
    return value instanceof Date ? value : printableValue(value);
  }));
  const sheet = XLSX.utils.aoa_to_sheet([
    [report.title],
    [report.subtitle || ''],
    [],
    header,
    ...data,
  ]);
  const lastColumn = XLSX.utils.encode_col(Math.max(0, report.columns.length - 1));
  sheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, report.columns.length - 1) } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: Math.max(0, report.columns.length - 1) } },
  ];
  sheet['!cols'] = report.columns.map((column) => ({
    wch: Math.min(45, Math.max(10, column.width || column.label.length + 4)),
  }));
  sheet['!autofilter'] = { ref: `A4:${lastColumn}${Math.max(4, report.rows.length + 4)}` };
  sheet['!freeze'] = { xSplit: 0, ySplit: 4 };

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'รายงาน');
  const info = XLSX.utils.aoa_to_sheet([
    ['รายการ', 'ค่า'],
    ...(report.metadata || []).map((item) => [item.label, item.value]),
    ['จำนวนแถว', report.rows.length],
    ['สร้างเมื่อ', new Date().toISOString()],
    ['แหล่งข้อมูล', 'HOSxP ผ่าน FDHChecker'],
  ]);
  info['!cols'] = [{ wch: 22 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(workbook, info, 'ข้อมูลรายงาน');
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
};

const tableWidths = (columns: ReportColumn[]) => {
  const weights = columns.map((column) => Math.max(1, column.width || 12));
  const total = weights.reduce((sum, value) => sum + value, 0);
  const widths = weights.map((weight) => Math.floor((weight / total) * 9360));
  widths[widths.length - 1] += 9360 - widths.reduce((sum, value) => sum + value, 0);
  return widths;
};

const buildWord = async (report: ExportableReport) => {
  const preferredKeys = report.wordColumnKeys || ['serviceDate', 'hn', 'vn', 'patientName', 'fund', 'clinic', 'mainDiag'];
  const preferredColumns = preferredKeys
    .map((key) => report.columns.find((column) => column.key === key))
    .filter((column): column is ReportColumn => Boolean(column));
  const columns = (preferredColumns.length >= 3 ? preferredColumns : report.columns).slice(0, 7);
  const widths = tableWidths(columns);
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'D9DEE7' };
  const tableRows = [
    new TableRow({
      tableHeader: true,
      cantSplit: true,
      children: columns.map((column, index) => new TableCell({
        width: { size: widths[index], type: WidthType.DXA },
        shading: { fill: 'F2F4F7', type: ShadingType.CLEAR },
        borders: { top: border, bottom: border, left: border, right: border },
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: column.label, bold: true, size: 18, font: THAI_FONT })],
        })],
      })),
    }),
    ...report.rows.map((row) => new TableRow({
      cantSplit: true,
      children: columns.map((column, index) => new TableCell({
        width: { size: widths[index], type: WidthType.DXA },
        borders: { top: border, bottom: border, left: border, right: border },
        children: [new Paragraph({
          children: [new TextRun({ text: printableValue(row[column.key]), size: 16, font: THAI_FONT })],
        })],
      })),
    })),
  ];

  const document = new Document({
    styles: {
      default: {
        document: {
          run: { font: THAI_FONT, size: 22, color: '1F2937' },
          paragraph: { spacing: { after: 120, line: 264 } },
        },
      },
      paragraphStyles: [
        {
          id: 'FDHHeading1',
          name: 'FDH Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: THAI_FONT, size: 32, bold: true, color: '2E74B5' },
          paragraph: { spacing: { before: 320, after: 160 } },
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708 },
        },
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: 'FDHChecker | หน้า ', color: '667085', size: 18, font: THAI_FONT }),
              new TextRun({ children: [PageNumber.CURRENT], color: '667085', size: 18, font: THAI_FONT }),
            ],
          })],
        }),
      },
      children: [
        new Paragraph({
          spacing: { after: 80 },
          children: [new TextRun({ text: report.title, bold: true, size: 46, font: THAI_FONT, color: '111827' })],
        }),
        new Paragraph({
          spacing: { after: 240 },
          children: [new TextRun({
            text: report.subtitle || 'รายงานจาก HOSxP ผ่าน FDHChecker',
            size: 24,
            font: THAI_FONT,
            color: '475467',
          })],
        }),
        ...(report.metadata || []).map((item) => new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({ text: `${item.label}: `, bold: true, size: 20, font: THAI_FONT }),
            new TextRun({ text: item.value, size: 20, font: THAI_FONT }),
          ],
        })),
        new Paragraph({
          style: 'FDHHeading1',
          children: [new TextRun('รายละเอียด')],
        }),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          indent: { size: 120, type: WidthType.DXA },
          columnWidths: widths,
          rows: tableRows,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
        }),
        new Paragraph({
          spacing: { before: 120, after: 80 },
          children: [new TextRun({
            text: `แสดง ${report.rows.length.toLocaleString('th-TH')} รายการ | สร้างเมื่อ ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`,
            size: 18,
            color: '667085',
            font: THAI_FONT,
          })],
        }),
      ],
    }],
  });
  return normalizeWordFonts(await Packer.toBuffer(document));
};

const buildCsv = (report: ExportableReport) => {
  const escape = (value: unknown) => {
    const text = printableValue(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [
    report.columns.map((column) => escape(column.label)).join(','),
    ...report.rows.map((row) => report.columns.map((column) => escape(row[column.key])).join(',')),
  ];
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
};

export const buildReportAttachment = async (
  format: ReportFormat,
  report: ExportableReport,
  filenameBase: string,
) => {
  const base = safeFilename(filenameBase);
  if (format === 'xlsx') {
    return attachment(`${base}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buildExcel(report));
  }
  if (format === 'docx') {
    return attachment(`${base}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', await buildWord(report));
  }
  if (format === 'csv') {
    return attachment(`${base}.csv`, 'text/csv;charset=utf-8', buildCsv(report));
  }
  return attachment(`${base}.json`, 'application/json;charset=utf-8', Buffer.from(JSON.stringify({
    title: report.title,
    metadata: report.metadata || [],
    rows: report.rows,
  }, null, 2), 'utf8'));
};

````
