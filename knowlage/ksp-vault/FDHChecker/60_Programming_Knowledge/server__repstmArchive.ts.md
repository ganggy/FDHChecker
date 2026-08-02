---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/repstmArchive.ts"
source_hash: "d83a50c980826cc77d084567d9f3ff598bea50aad9302a85122971ae85ce7479"
managed_by: "sync-ksp-vault"
---
# repstmArchive.ts

> Source: `server/repstmArchive.ts`
> SHA-256: `d83a50c980826cc77d084567d9f3ff598bea50aad9302a85122971ae85ce7479`

````typescript
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';

export type RepstmArchiveImportType = 'REP' | 'STM' | 'INV';

export interface RepstmArchiveDataset {
  id: string;
  entryName: string;
  importerId: string;
  importerLabel: string;
  detectedType: RepstmArchiveImportType;
  sheetName: string;
  headers: string[];
  rows: Record<string, unknown>[];
  summary: Record<string, unknown>;
}

export interface RepstmArchiveAnalysis {
  archiveName: string;
  entries: Array<{ name: string; size: number; kind: string }>;
  datasets: RepstmArchiveDataset[];
  summaries: Record<string, unknown>[];
  ignoredEntries: string[];
}

const MAX_ARCHIVE_ENTRIES = 200;
const MAX_XML_BYTES = 20 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: false,
});

const asRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
);

const asArray = (value: unknown): unknown[] => (
  Array.isArray(value) ? value : value == null ? [] : [value]
);

const xmlValue = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'object' && !Array.isArray(value)) {
    return String((value as Record<string, unknown>)['#text'] ?? '').trim();
  }
  return String(value).trim();
};

const xmlAttribute = (value: unknown, name: string): string => (
  String(asRecord(value)[`@_${name}`] ?? '').trim()
);

const entryKind = (name: string) => {
  const extension = name.split('.').pop()?.toLowerCase() || '';
  if (extension === 'xml') return 'ข้อมูล XML';
  if (extension === 'htm' || extension === 'html') return 'เอกสารแสดงผล';
  if (extension === 'xsl') return 'แม่แบบเอกสาร';
  if (['jpg', 'jpeg', 'png', 'gif'].includes(extension)) return 'รูปภาพประกอบ';
  return extension ? extension.toUpperCase() : 'ไฟล์';
};

const sanitizeEntryName = (name: string) => name.replace(/\\/g, '/').split('/').filter(Boolean).join('/');

const buildStatementSummary = (root: Record<string, unknown>, entryName: string) => {
  const stmDat = asRecord(asArray(root.STMdat)[0]);
  const dat = asRecord(asArray(stmDat.Dat)[0]);
  return {
    documentKind: 'statement',
    entryName,
    accountId: xmlValue(root.stmAccountID),
    hcode: xmlValue(root.hcode),
    hcodeReference: xmlAttribute(root.hcode, 'id'),
    hospitalName: xmlValue(root.hname),
    accountingPeriod: xmlValue(root.AccPeriod),
    statementNo: xmlValue(root.STMdoc),
    dateStart: xmlValue(root.dateStart),
    dateEnd: xmlValue(root.dateEnd),
    dateDue: xmlValue(root.datedue || root.dateDue),
    dateIssue: xmlValue(root.dateIssue),
    fundCode: xmlAttribute(stmDat, 'code'),
    fundName: xmlAttribute(stmDat, 'name'),
    description: xmlAttribute(stmDat, 'desc'),
    rowCount: Number(xmlValue(dat.Tcount) || 0),
    totalAmount: Number(xmlValue(root.amount || stmDat.Gtotal || dat.Tamount) || 0),
  };
};

const parseCocdStatement = (root: Record<string, unknown>, entryName: string): RepstmArchiveDataset | null => {
  const billsContainer = asRecord(root.TBills);
  const bills = asArray(billsContainer.TBill).map(asRecord).filter((row) => Object.keys(row).length > 0);
  if (bills.length === 0) return null;

  const summary = buildStatementSummary(root, entryName);
  const statementNo = String(summary.statementNo || '').trim();
  const hcode = String(summary.hcode || '').trim();
  const containerFundCode = xmlAttribute(root.TBills, 'code');

  const rows = bills.map((bill, index) => {
    const sourceAmount = xmlValue(bill.amount);
    const extP = bill.ExtP;
    return {
      'ลำดับ': index + 1,
      'STM No.': statementNo,
      'HOSPCODE': hcode,
      'กองทุน': xmlValue(bill.sys) || containerFundCode,
      'สถานี': xmlValue(bill.station),
      'HREG': xmlValue(bill.hreg),
      'HN': xmlValue(bill.hn),
      'ชื่อ - สกุล': xmlValue(bill.namepat),
      'เลขที่ใบแจ้งหนี้': xmlValue(bill.invno),
      'วันที่รับบริการ': xmlValue(bill.dttran),
      'เลขรอบ': xmlValue(bill.rid),
      'สถานะ': xmlValue(bill.cstat),
      'HD Flag': xmlValue(bill.HDflag || bill.KTflag),
      'amount': sourceAmount,
      // COCD STM calls `amount` the payable medical-service amount. The source
      // `paid` element is retained separately because it is not the net STM payment.
      'paid_amount': sourceAmount,
      'invoice_amount': sourceAmount,
      'source_paid': xmlValue(bill.paid),
      'ส่วนเพิ่ม': xmlValue(extP),
      'รหัสส่วนเพิ่ม': xmlAttribute(extP, 'code'),
    };
  });

  const headers = Object.keys(rows[0] || {});
  const fundCode = String(summary.fundCode || containerFundCode || rows[0]?.['กองทุน'] || '').trim();
  return {
    id: `${entryName}:cocd-statement`,
    entryName,
    importerId: 'cocd-statement',
    importerLabel: fundCode === 'HD' ? 'STM ไตเทียม/ฟอกไต (COCD)' : 'STM รักษาต่อเนื่อง (COCD)',
    detectedType: 'STM',
    sheetName: [statementNo, fundCode].filter(Boolean).join(' · ') || entryName,
    headers,
    rows,
    summary: { ...summary, rowCount: rows.length },
  };
};

const parseSummaryDocument = (root: Record<string, unknown>, entryName: string) => {
  const stmDat = asRecord(asArray(root.STMdat)[0]);
  const dat = asRecord(asArray(stmDat.Dat)[0]);
  return {
    documentKind: 'summary',
    entryName,
    accountId: xmlValue(root.stmAccountID),
    hcode: xmlValue(root.hcode),
    hcodeReference: xmlAttribute(root.hcode, 'id'),
    hospitalName: xmlValue(root.hname),
    accountingPeriod: xmlValue(root.AccPeriod),
    statementNo: xmlValue(root.stmno),
    detailDocument: xmlValue(asRecord(root.atth).doc),
    dateStart: xmlValue(root.dateStart),
    dateEnd: xmlValue(root.dateEnd),
    dateDue: xmlValue(root.dateDue),
    dateIssue: xmlValue(root.dateIssue),
    fundCode: xmlAttribute(stmDat, 'code'),
    fundName: xmlAttribute(stmDat, 'name'),
    description: xmlAttribute(stmDat, 'desc'),
    rowCount: Number(xmlValue(root.acount || dat.Tcount) || 0),
    totalAmount: Number(xmlValue(root.amount || dat.Tamount) || 0),
  };
};

export const analyzeRepstmArchive = (archiveBuffer: Buffer, archiveName: string): RepstmArchiveAnalysis => {
  if (!Buffer.isBuffer(archiveBuffer) || archiveBuffer.length === 0) throw new Error('ไฟล์ ZIP ว่างหรืออ่านไม่ได้');
  const zip = new AdmZip(archiveBuffer);
  const zipEntries = zip.getEntries().filter((entry) => !entry.isDirectory);
  if (zipEntries.length === 0) throw new Error('ไม่พบไฟล์ภายใน ZIP');
  if (zipEntries.length > MAX_ARCHIVE_ENTRIES) throw new Error(`ZIP มีไฟล์เกิน ${MAX_ARCHIVE_ENTRIES.toLocaleString()} รายการ`);

  const totalUncompressed = zipEntries.reduce((sum, entry) => sum + Number(entry.header.size || 0), 0);
  if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) throw new Error('ข้อมูลภายใน ZIP มีขนาดรวมเกิน 100 MB');

  const entries = zipEntries.map((entry) => ({
    name: sanitizeEntryName(entry.entryName),
    size: Number(entry.header.size || 0),
    kind: entryKind(entry.entryName),
  }));
  const datasets: RepstmArchiveDataset[] = [];
  const summaries: Record<string, unknown>[] = [];
  const ignoredEntries: string[] = [];

  for (const entry of zipEntries) {
    const entryName = sanitizeEntryName(entry.entryName);
    if (!/\.xml$/i.test(entryName)) continue;
    if (Number(entry.header.size || 0) > MAX_XML_BYTES) throw new Error(`XML ${entryName} มีขนาดเกิน 20 MB`);

    try {
      const parsed = asRecord(parser.parse(entry.getData().toString('utf8')));
      if (parsed.STMSTM) {
        const dataset = parseCocdStatement(asRecord(parsed.STMSTM), entryName);
        if (dataset) {
          datasets.push(dataset);
          summaries.push(dataset.summary);
        } else {
          ignoredEntries.push(entryName);
        }
      } else if (parsed.STMSUMM) {
        summaries.push(parseSummaryDocument(asRecord(parsed.STMSUMM), entryName));
      } else {
        ignoredEntries.push(entryName);
      }
    } catch (error) {
      throw new Error(`อ่าน XML ${entryName} ไม่สำเร็จ: ${(error as Error).message}`);
    }
  }

  if (datasets.length === 0) throw new Error('ไม่พบ XML รายละเอียด STM ที่ระบบรองรับใน ZIP นี้');
  return { archiveName, entries, datasets, summaries, ignoredEntries };
};

````
