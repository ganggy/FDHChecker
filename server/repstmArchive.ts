import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import iconv from 'iconv-lite';

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

type DbfRow = Record<string, string>;

type ChiHdBilRow = {
  status: string;
  station: string;
  lineNo: number;
  hreg: string;
  hn: string;
  sessionNo: string;
  serviceDate: string;
  serviceDateRaw: string;
  hdMode: string;
  claimAccount: string;
  payer: string;
  ep: string;
  dialysisNew: string;
  epoTradeName: string;
  epoUnit: number | null;
  hct: number | null;
  paymentRequested: string;
  additionalAmount: number;
  hdRate: number | null;
  hdCharge: number | null;
  paymentRate: number | null;
  netTotal: number | null;
  benefitFlag: string;
  checkCode: string;
  rawLine: string;
  payerGroup: 'CSMBS' | 'SSS';
};

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

const cleanChiText = (value: unknown) => String(value ?? '').replace(/_+$/g, '').trim();

const parseChiNumber = (value: unknown): number | null => {
  const text = String(value ?? '').replace(/,/g, '').trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseThaiDateTime = (value: string) => {
  const matched = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?/);
  if (!matched) return value.trim();
  let year = Number(matched[3]);
  if (year > 2400) year -= 543;
  const date = `${String(year).padStart(4, '0')}-${matched[2].padStart(2, '0')}-${matched[1].padStart(2, '0')}`;
  return matched[4]
    ? `${date} ${matched[4].padStart(2, '0')}:${matched[5]}:${matched[6]}`
    : date;
};

const readDbfRows = (buffer: Buffer): DbfRow[] => {
  if (buffer.length < 33) throw new Error('DBF สั้นเกินไปหรือโครงสร้างไม่ถูกต้อง');
  const recordCount = buffer.readUInt32LE(4);
  const headerLength = buffer.readUInt16LE(8);
  const recordLength = buffer.readUInt16LE(10);
  if (headerLength < 33 || recordLength < 2 || headerLength + (recordCount * recordLength) > buffer.length + 1) {
    throw new Error('ขนาด header/record ใน DBF ไม่ถูกต้อง');
  }

  const fields: Array<{ name: string; length: number }> = [];
  for (let offset = 32; offset + 31 < headerLength && buffer[offset] !== 0x0d; offset += 32) {
    const zero = buffer.indexOf(0, offset);
    const nameEnd = zero >= offset && zero < offset + 11 ? zero : offset + 11;
    const name = buffer.subarray(offset, nameEnd).toString('ascii').trim().toUpperCase();
    const length = buffer[offset + 16];
    if (name && length > 0) fields.push({ name, length });
  }
  if (fields.length === 0) throw new Error('ไม่พบคอลัมน์ใน DBF');

  const rows: DbfRow[] = [];
  for (let index = 0; index < recordCount; index += 1) {
    const recordOffset = headerLength + (index * recordLength);
    if (recordOffset + recordLength > buffer.length || buffer[recordOffset] === 0x2a) continue;
    let cursor = recordOffset + 1;
    const row: DbfRow = {};
    for (const field of fields) {
      row[field.name] = iconv.decode(buffer.subarray(cursor, cursor + field.length), 'tis620').trim();
      cursor += field.length;
    }
    rows.push(row);
  }
  return rows;
};

const parseChiHdBil = (buffer: Buffer) => {
  const text = iconv.decode(buffer, 'tis620').replace(/\r\n/g, '\n');
  const hcode = cleanChiText(text.match(/^รหัส\s*รพ\.[ \t]*=[ \t]*(\d+)/m)?.[1]);
  const responseNo = cleanChiText(text.match(/^เลขที่ตอบรับ[ \t]*=[ \t]*(\d+)/m)?.[1]);
  const issuedRaw = cleanChiText(text.match(/^วันที่ออกเลขที่ตอบรับ[ \t]*=[ \t]*([^\n]+)/m)?.[1]);
  const issueDate = parseThaiDateTime(issuedRaw);
  const submissionPeriods = [...text.matchAll(/งวดส่งของ\s*ร\.พ\.\s*=\s*([^\n]+)/g)]
    .flatMap((match) => String(match[1] || '').split(','))
    .map(cleanChiText)
    .filter(Boolean);
  const errorDescriptions = new Map<string, string>();
  for (const matched of text.matchAll(/^\s*(\d+)\s*:\s*([^\n]+)$/gm)) {
    errorDescriptions.set(matched[1], cleanChiText(matched[2]));
  }

  const rows: ChiHdBilRow[] = [];
  for (const matched of text.matchAll(/^\*\|[ \t]*(.*?)\|[ \t]*([^\r\n]*)$/gm)) {
    const rawLine = matched[0].trim();
    const cells = matched[1].split(',').map((cell) => cell.trim());
    const statusStation = cells[0]?.match(/^([AC])\s*(\d{2})$/i);
    if (!statusStation || cells.length < 15) continue;
    const payerGroup: 'CSMBS' | 'SSS' = cells.length >= 18 ? 'SSS' : 'CSMBS';
    const checkCode = cleanChiText(String(matched[2] || '').split(',')[0]);
    const serviceDateRaw = cleanChiText(cells[5]);
    rows.push({
      status: statusStation[1].toUpperCase(),
      station: statusStation[2],
      lineNo: Number(cells[1] || rows.length + 1),
      hreg: cleanChiText(cells[2]),
      hn: cleanChiText(cells[3]),
      sessionNo: cleanChiText(cells[4]),
      serviceDate: parseThaiDateTime(serviceDateRaw),
      serviceDateRaw,
      hdMode: cleanChiText(cells[6]),
      claimAccount: cleanChiText(cells[7]),
      payer: cleanChiText(cells[8]),
      ep: payerGroup === 'CSMBS' ? cleanChiText(cells[9]) : '',
      dialysisNew: cleanChiText(cells[payerGroup === 'CSMBS' ? 10 : 9]),
      epoTradeName: payerGroup === 'SSS' ? cleanChiText(cells[10]) : '',
      epoUnit: payerGroup === 'SSS' ? parseChiNumber(cells[11]) : null,
      hct: payerGroup === 'SSS' ? parseChiNumber(cells[12]) : null,
      paymentRequested: payerGroup === 'SSS' ? cleanChiText(cells[13]) : '',
      additionalAmount: parseChiNumber(cells[payerGroup === 'SSS' ? 14 : 11]) || 0,
      hdRate: payerGroup === 'CSMBS' ? parseChiNumber(cells[12]) : null,
      hdCharge: payerGroup === 'SSS' ? parseChiNumber(cells[15]) : null,
      paymentRate: payerGroup === 'SSS' ? parseChiNumber(cells[16]) : null,
      netTotal: payerGroup === 'CSMBS' ? parseChiNumber(cells[13]) : null,
      benefitFlag: cleanChiText(cells[payerGroup === 'SSS' ? 17 : 14]),
      checkCode,
      rawLine,
      payerGroup,
    });
  }

  return { hcode, responseNo, issuedRaw, issueDate, submissionPeriods: [...new Set(submissionPeriods)], errorDescriptions, rows };
};

const parseChiHdRep = (bilEntry: AdmZip.IZipEntry, dbfEntry: AdmZip.IZipEntry): RepstmArchiveDataset => {
  const bil = parseChiHdBil(bilEntry.getData());
  const dbfRows = readDbfRows(dbfEntry.getData());
  if (!bil.responseNo || !bil.hcode || bil.rows.length === 0) throw new Error('BIL ของ CHI HD ไม่มีเลขตอบรับ รหัสโรงพยาบาล หรือรายการบริการ');
  if (dbfRows.length !== bil.rows.length) throw new Error(`จำนวนแถว BIL (${bil.rows.length}) ไม่ตรงกับ DBF (${dbfRows.length})`);

  const dbfBySession = new Map(dbfRows.map((row) => [cleanChiText(row.SESSNO), row]));
  const rows = bil.rows.map((bilRow, index) => {
    const dbf = dbfBySession.get(bilRow.sessionNo);
    if (!dbf) throw new Error(`ไม่พบ SESSNO ${bilRow.sessionNo} ใน DBF`);
    const resultStatus = cleanChiText(dbf.CHKCODE || bilRow.status).toUpperCase();
    const paidAmount = bilRow.payerGroup === 'SSS'
      ? bilRow.additionalAmount + (bilRow.hdCharge || 0)
      : (bilRow.netTotal || 0);
    return {
      'ลำดับ': index + 1,
      'REP No.': bil.responseNo,
      'transaction_uid': `CHIHD:${bilRow.sessionNo}`,
      'HOSPCODE': cleanChiText(dbf.HCODE || bil.hcode),
      'HN': cleanChiText(dbf.HN || bilRow.hn),
      'HCEXT': cleanChiText(dbf.HCEXT || bilRow.station),
      'HREG': cleanChiText(dbf.HREG || bilRow.hreg),
      'SESSNO': bilRow.sessionNo,
      'SID': cleanChiText(dbf.SID),
      'STMID': cleanChiText(dbf.STMID),
      'ประเภทผู้ป่วย': 'ผู้ป่วยนอก',
      'วันที่รับบริการ': bilRow.serviceDate,
      'วันเข้ารักษา': bilRow.serviceDate,
      'วันที่รับบริการเดิม': bilRow.serviceDateRaw,
      'กลุ่มผู้จ่าย': bilRow.payerGroup === 'SSS' ? 'ประกันสังคม' : 'กรมบัญชีกลาง',
      'fund_code': bilRow.payerGroup,
      'สถานะ': resultStatus,
      'ผลตรวจ': resultStatus === 'A' ? 'ผ่าน' : 'ไม่ผ่าน',
      'errorcode': bilRow.checkCode,
      'รายละเอียดข้อผิดพลาด': bil.errorDescriptions.get(bilRow.checkCode) || '',
      'สถานี': bilRow.station,
      'HD Mode': bilRow.hdMode,
      'Claim Account': bilRow.claimAccount,
      'Payers': bilRow.payer,
      'EP': bilRow.ep,
      'DlzNew': bilRow.dialysisNew,
      'EPO': bilRow.epoTradeName,
      'EPO Unit': bilRow.epoUnit ?? '',
      'HCT': bilRow.hct ?? '',
      'Pay Check': bilRow.paymentRequested,
      'Amount': bilRow.additionalAmount,
      'HD Rate': bilRow.hdRate ?? '',
      'HD Charge': bilRow.hdCharge ?? '',
      'Pay Rate': bilRow.paymentRate ?? '',
      'ชดเชยสุทธิ': paidAmount,
      'Net Total': bilRow.netTotal ?? '',
      'BF': bilRow.benefitFlag,
      'เลขรอบนำส่ง': cleanChiText(dbf.REPID || bil.responseNo),
      'บรรทัดต้นฉบับ': bilRow.rawLine,
    };
  });

  const acceptedCount = rows.filter((row) => row['สถานะ'] === 'A').length;
  const totalAmount = rows.reduce((sum, row) => sum + Number(row['ชดเชยสุทธิ'] || 0), 0);
  const summary = {
    documentKind: 'chi-hd-rep', entryName: sanitizeEntryName(bilEntry.entryName),
    hcode: bil.hcode, responseNo: bil.responseNo,
    dateIssue: bil.issueDate, dateIssueOriginal: bil.issuedRaw,
    submissionPeriods: bil.submissionPeriods.join(', '), rowCount: rows.length,
    acceptedCount, rejectedCount: rows.length - acceptedCount,
    csmbsCount: rows.filter((row) => row['fund_code'] === 'CSMBS').length,
    sssCount: rows.filter((row) => row['fund_code'] === 'SSS').length,
    totalAmount: Number(totalAmount.toFixed(2)),
    bilEntry: sanitizeEntryName(bilEntry.entryName), dbfEntry: sanitizeEntryName(dbfEntry.entryName),
  };
  return {
    id: `${sanitizeEntryName(bilEntry.entryName)}:chi-hd-rep`,
    entryName: sanitizeEntryName(bilEntry.entryName), importerId: 'chi-hd-rep',
    importerLabel: 'REP ไต CHI (BIL + DBF)', detectedType: 'REP',
    sheetName: `CHI HD REP ${bil.responseNo}`, headers: Object.keys(rows[0] || {}), rows, summary,
  };
};

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
    const sessionNo = xmlValue(bill.invno);
    const extP = bill.ExtP;
    return {
      'ลำดับ': index + 1,
      'STM No.': statementNo,
      'transaction_uid': sessionNo ? `CHIHD:${sessionNo}` : '',
      'HOSPCODE': hcode,
      'กองทุน': xmlValue(bill.sys) || containerFundCode,
      'สถานี': xmlValue(bill.station),
      'HREG': xmlValue(bill.hreg),
      'HN': xmlValue(bill.hn),
      'ชื่อ - สกุล': xmlValue(bill.namepat),
      'เลขที่ใบแจ้งหนี้': sessionNo,
      'SESSNO': sessionNo,
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

const parseSocdStatement = (root: Record<string, unknown>, entryName: string): RepstmArchiveDataset | null => {
  const patientBills = asArray(asRecord(root.HDBills).HDBill).map(asRecord).filter((row) => Object.keys(row).length > 0);
  if (patientBills.length === 0) return null;

  const statementNo = xmlValue(root.STMdoc);
  const hcode = xmlValue(root.hcode);
  const stmDat = asRecord(root.STMdat);
  const rows: Record<string, unknown>[] = [];
  patientBills.forEach((patientBill) => {
    const benefit = asRecord(patientBill.benefit);
    const patientEpo = asRecord(patientBill.EPO);
    const bills = asArray(patientBill.TBill).map(asRecord).filter((row) => Object.keys(row).length > 0);
    bills.forEach((bill) => {
      const epo = asRecord(bill.EPOs);
      const epoDetail = asRecord(epo.EPO);
      const epoPayment = xmlValue(epo.EPOpay);
      const epoAdmin = xmlValue(epo.EPOadm);
      const sessionNo = xmlValue(bill.invno);
      const hdAmount = Number(xmlValue(bill.amount) || 0);
      const paidAmount = hdAmount + Number(epoPayment || 0) + Number(epoAdmin || 0);
      rows.push({
        'ลำดับ': rows.length + 1,
        'STM No.': statementNo,
        'transaction_uid': sessionNo ? `CHIHD:${sessionNo}` : '',
        'HOSPCODE': xmlValue(bill.hcode) || hcode,
        'กองทุน': 'SSS-HD',
        'สถานี': xmlValue(bill.station),
        'HREG': xmlValue(bill.hreg) || xmlValue(patientBill.hreg),
        'HN': xmlValue(bill.hn) || xmlValue(patientBill.hn),
        'PID': xmlValue(patientBill.pid),
        'ชื่อ - สกุล': xmlValue(patientBill.name),
        'สิทธิหลัก': xmlAttribute(patientBill.benefit, 'main'),
        'สิทธิย่อย': xmlAttribute(patientBill.benefit, 'sub'),
        'Benefit Marker': xmlAttribute(patientBill.benefit, 'marker'),
        'WK No.': xmlValue(bill.wkno) || xmlValue(patientBill.wkno),
        'เลขที่ใบแจ้งหนี้': sessionNo,
        'SESSNO': sessionNo,
        'วันที่รับบริการ': xmlValue(bill.dttran),
        'เลขรอบ': xmlValue(bill.rid),
        'สถานะ': xmlValue(bill.cstat || bill.pstat),
        'HD Flag': xmlValue(bill.HDflag),
        'HD Rate': xmlValue(bill.hdrate),
        'HD Charge': xmlValue(bill.hdcharge),
        'Pay Check': xmlValue(bill.paychk),
        'EPO Status': xmlValue(bill.EPOstat),
        'EPO Code': xmlAttribute(epo.EPO, 'code'),
        'EPO Name': xmlAttribute(epo.EPO, 'eponame'),
        'EPO IU': xmlValue(epo.EPOiu),
        'HCT': xmlValue(epo.HCT),
        'EPO Payment': epoPayment,
        'EPO Administration': epoAdmin,
        'amount': paidAmount.toFixed(2),
        'paid_amount': paidAmount.toFixed(2),
        'invoice_amount': paidAmount.toFixed(2),
        'source_hd_amount': xmlValue(bill.amount),
        'source_paid': xmlValue(bill.paid),
        'Patient HD Sessions': xmlValue(patientBill.hds),
        'Patient HD Payable': xmlValue(patientBill.payable),
        'Patient EPO Payment': xmlValue(patientEpo.epoPay),
        'Benefit Main': xmlAttribute(benefit, 'main'),
        'EPO Item': xmlValue(epoDetail.item),
      });
    });
  });
  if (rows.length === 0) return null;

  const totalAmount = rows.reduce((sum, row) => sum + Number(row.paid_amount || 0), 0);
  const summary = {
    documentKind: 'statement', entryName,
    accountId: xmlValue(root.stmAccountID), hcode,
    hcodeReference: xmlAttribute(root.hcode, 'id'), hospitalName: xmlValue(root.hname),
    accountingPeriod: xmlValue(root.AccPeriod), statementNo,
    dateStart: xmlValue(root.dateStart), dateEnd: xmlValue(root.dateEnd),
    dateDue: xmlValue(root.dateData), dateIssue: xmlValue(root.dateIssue),
    fundCode: xmlAttribute(root.STMdat, 'code'), fundName: xmlAttribute(root.STMdat, 'name'),
    description: xmlAttribute(root.STMdat, 'desc'), patientCount: patientBills.length,
    rowCount: rows.length, totalAmount: Number(totalAmount.toFixed(2)),
    sourceTotalAmount: Number(xmlValue(root.amount) || 0),
    sourceDetailTotal: Number(xmlValue(stmDat.amount) || 0),
  };
  return {
    id: `${entryName}:socd-statement`, entryName,
    importerId: 'socd-statement', importerLabel: 'STM ไตประกันสังคม CHI (SOCD)',
    detectedType: 'STM', sheetName: [statementNo, 'SSS-HD'].filter(Boolean).join(' · ') || entryName,
    headers: Object.keys(rows[0] || {}), rows, summary,
  };
};

const parseSummaryDocument = (root: Record<string, unknown>, entryName: string) => {
  const stmDat = asRecord(asArray(root.STMdat)[0]);
  const dat = asRecord(asArray(stmDat.Dat || stmDat.dat)[0]);
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
    dateDue: xmlValue(root.dateDue || root.dateData),
    dateIssue: xmlValue(root.dateIssue),
    fundCode: xmlAttribute(stmDat, 'code'),
    fundName: xmlAttribute(stmDat, 'name'),
    description: xmlAttribute(stmDat, 'desc'),
    rowCount: Number(xmlValue(root.acount || dat.Tcount || dat.count) || 0),
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

  const bilEntries = zipEntries.filter((entry) => /\.bil$/i.test(entry.entryName));
  const dbfEntries = zipEntries.filter((entry) => /\.dbf$/i.test(entry.entryName));
  if (bilEntries.length > 0 || dbfEntries.length > 0) {
    if (bilEntries.length !== 1 || dbfEntries.length !== 1) {
      throw new Error('ZIP ของ CHI HD ต้องมีไฟล์ .BIL และ .DBF อย่างละ 1 ไฟล์');
    }
    try {
      const dataset = parseChiHdRep(bilEntries[0], dbfEntries[0]);
      datasets.push(dataset);
      summaries.push(dataset.summary);
    } catch (error) {
      throw new Error(`อ่าน REP ไต CHI ไม่สำเร็จ: ${(error as Error).message}`);
    }
  }

  for (const entry of zipEntries) {
    const entryName = sanitizeEntryName(entry.entryName);
    if (!/\.xml$/i.test(entryName)) continue;
    if (Number(entry.header.size || 0) > MAX_XML_BYTES) throw new Error(`XML ${entryName} มีขนาดเกิน 20 MB`);

    try {
      const parsed = asRecord(parser.parse(entry.getData().toString('utf8')));
      if (parsed.STMSTM) {
        const root = asRecord(parsed.STMSTM);
        const dataset = root.HDBills
          ? parseSocdStatement(root, entryName)
          : parseCocdStatement(root, entryName);
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

  if (datasets.length === 0) throw new Error('ไม่พบ REP ไต CHI หรือ XML รายละเอียด STM ที่ระบบรองรับใน ZIP นี้');
  return { archiveName, entries, datasets, summaries, ignoredEntries };
};
