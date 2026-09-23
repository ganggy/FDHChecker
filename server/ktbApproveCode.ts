import AdmZip from 'adm-zip';
import iconv from 'iconv-lite';
import type { HospitalConnection } from './hospitalDatabase.js';

export type KtbParsedRow = {
  rowNo: number;
  hospitalCode: string;
  hospitalName: string;
  merchantId: string;
  terminalId: string;
  transactionDate: string; // YYYY-MM-DD
  transactionTime: string; // HH:mm:ss
  transactionDateTime: string; // YYYY-MM-DD HH:mm:ss
  cid: string;
  patientName: string;
  amount: number;
  approveCode: string;
  transactionType: string;
  invoiceNo: string;
  channel: string;
  rawLine: string;
};

export type KtbMatchedVisit = {
  vn: string;
  hn: string;
  vstdate: string;
  vsttime: string;
  an?: string | null;
  pttype: string;
  pttypeName?: string;
  patientName: string;
  hosxpPrice: number;
  existingAuthCode?: string;
  existingAuthDateTime?: string;
};

export type KtbMatchStatus =
  | 'READY_TO_IMPORT'
  | 'ALREADY_SET'
  | 'CONFLICT'
  | 'VISIT_NOT_FOUND'
  | 'PATIENT_NOT_FOUND'
  | 'NO_APPROVE_CODE';

export type KtbMatchItem = {
  rowNo: number;
  ktb: KtbParsedRow;
  status: KtbMatchStatus;
  statusMessage: string;
  matchedVisit?: KtbMatchedVisit;
  candidateVisits?: KtbMatchedVisit[];
  selectedVn?: string;
};

export type KtbMatchSummary = {
  totalRows: number;
  matchedCount: number;
  readyToImportCount: number;
  alreadySetCount: number;
  conflictCount: number;
  notFoundCount: number;
  noApproveCodeCount: number;
  totalAmount: number;
  items: KtbMatchItem[];
};

export type KtbApplyEntry = {
  vn: string;
  cid: string;
  approveCode: string;
  transactionDateTime: string;
  terminalId?: string;
  overwrite?: boolean;
};

export type KtbApplySummary = {
  totalRequested: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  updatedVns: string[];
  errors: Array<{ vn: string; message: string }>;
};

function decodeThaiBuffer(buf: Buffer): string {
  try {
    const utf8Str = buf.toString('utf8');
    if (!utf8Str.includes('\uFFFD')) {
      return utf8Str;
    }
  } catch {
    // fallback to tis620
  }
  return iconv.decode(buf, 'tis620');
}

/**
 * แปลงไฟล์ ZIP หรือ TXT ของ KTB ออกมาเป็น KtbParsedRow[]
 */
export function parseKtbFile(buffer: Buffer, originalFilename = ''): KtbParsedRow[] {
  let text = '';

  // ตรวจสอบว่าเป็นไฟล์ ZIP หรือไม่ (magic number PK\x03\x04)
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    // หาไฟล์ TXT ภายใน ZIP
    const txtEntry = entries.find((e) => e.entryName.toLowerCase().endsWith('.txt')) || entries[0];
    if (!txtEntry) {
      throw new Error('ไม่พบไฟล์ TXT ภายในไฟล์ ZIP ของ KTB');
    }
    text = decodeThaiBuffer(txtEntry.getData());
  } else {
    // เป็นไฟล์ข้อความตรงๆ
    text = decodeThaiBuffer(buffer);
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows: KtbParsedRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cols = line.split('|');
    if (cols.length < 25) {
      // ไม่ใช่แถวข้อมูลมาตรฐานของ KTB EDC
      continue;
    }

    const hospitalCode = (cols[1] || '').trim();
    const hospitalName = (cols[2] || '').trim();
    const merchantId = (cols[3] || '').trim();
    const terminalId = (cols[6] || '').trim();

    // แปลงวันที่ DD/MM/YYYY เป็น YYYY-MM-DD
    const dateRaw = (cols[7] || '').trim();
    const timeRaw = (cols[8] || '').trim();
    let transactionDate = '';
    const dateParts = dateRaw.split('/');
    if (dateParts.length === 3) {
      transactionDate = `${dateParts[2].padStart(4, '20')}-${dateParts[1].padStart(2, '0')}-${dateParts[0].padStart(2, '0')}`;
    }

    const transactionTime = timeRaw || '00:00:00';
    const transactionDateTime = transactionDate ? `${transactionDate} ${transactionTime}` : '';

    const cid = (cols[11] || '').trim();
    const firstName = (cols[12] || '').trim();
    const lastName = (cols[13] || '').trim();
    const patientName = `${firstName} ${lastName}`.trim();

    const amount = parseFloat((cols[22] || '0').replace(/,/g, '')) || 0;
    const approveCode = (cols[24] || '').trim();
    const transactionType = (cols[25] || '').trim();
    const invoiceNo = (cols[26] || '').trim();
    const channel = (cols[28] || '').trim();

    rows.push({
      rowNo: rows.length + 1,
      hospitalCode,
      hospitalName,
      merchantId,
      terminalId,
      transactionDate,
      transactionTime,
      transactionDateTime,
      cid,
      patientName,
      amount,
      approveCode,
      transactionType,
      invoiceNo,
      channel,
      rawLine: line,
    });
  }

  return rows;
}

/**
 * ทำการ Matching ข้อมูล KTB กับ HOSxP Database
 */
export async function matchKtbRowsWithHosxp(
  rows: KtbParsedRow[],
  connection: HospitalConnection
): Promise<KtbMatchSummary> {
  const items: KtbMatchItem[] = [];

  let matchedCount = 0;
  let readyToImportCount = 0;
  let alreadySetCount = 0;
  let conflictCount = 0;
  let notFoundCount = 0;
  let noApproveCodeCount = 0;
  let totalAmount = 0;

  for (const row of rows) {
    totalAmount += row.amount;

    // ถ้าไม่มี Approve Code หรือเป็นรายการ Void
    if (!row.approveCode) {
      items.push({
        rowNo: row.rowNo,
        ktb: row,
        status: 'NO_APPROVE_CODE',
        statusMessage: 'ไม่มีรหัส Approve Code ในไฟล์ KTB (อาจเป็นรายการล้มเหลวหรือยกเลิก)',
      });
      noApproveCodeCount++;
      continue;
    }

    if (!row.cid || !row.transactionDate) {
      items.push({
        rowNo: row.rowNo,
        ktb: row,
        status: 'VISIT_NOT_FOUND',
        statusMessage: 'ข้อมูลวันที่หรือเลข CID ไม่สมบูรณ์',
      });
      notFoundCount++;
      continue;
    }

    // ค้นหาวิสิตใน HOSxP
    const [visitRows] = (await connection.query(
      `SELECT o.vn, o.hn, DATE_FORMAT(o.vstdate, '%Y-%m-%d') as vstdate, o.vsttime, o.an, o.pttype,
              pttype.name as pttype_name,
              CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) as patient_name,
              vp.auth_code,
              DATE_FORMAT(vp.Auth_DateTime, '%Y-%m-%d %H:%i:%s') as auth_datetime,
              COALESCE((SELECT SUM(sum_price) FROM opitemrece WHERE vn = o.vn), 0) as total_price
       FROM ovst o
       JOIN patient pt ON o.hn = pt.hn
       LEFT JOIN pttype ON o.pttype = pttype.pttype
       LEFT JOIN visit_pttype vp ON o.vn = vp.vn
       WHERE pt.cid = ? AND o.vstdate = ?
       ORDER BY o.vsttime DESC`,
      [row.cid, row.transactionDate]
    )) as any;

    const visits: KtbMatchedVisit[] = Array.isArray(visitRows)
      ? visitRows.map((v) => ({
          vn: String(v.vn),
          hn: String(v.hn),
          vstdate: String(v.vstdate),
          vsttime: String(v.vsttime),
          an: v.an ? String(v.an) : null,
          pttype: String(v.pttype || ''),
          pttypeName: v.pttype_name ? String(v.pttype_name) : '',
          patientName: String(v.patient_name || ''),
          hosxpPrice: parseFloat(v.total_price) || 0,
          existingAuthCode: v.auth_code ? String(v.auth_code).trim() : undefined,
          existingAuthDateTime: v.auth_datetime ? String(v.auth_datetime) : undefined,
        }))
      : [];

    if (visits.length === 0) {
      // ตรวจสอบว่ามีผู้ป่วยรายนี้ใน HOSxP หรือไม่
      const [ptRows] = (await connection.query('SELECT hn FROM patient WHERE cid = ? LIMIT 1', [row.cid])) as any;
      const patientExists = Array.isArray(ptRows) && ptRows.length > 0;

      items.push({
        rowNo: row.rowNo,
        ktb: row,
        status: patientExists ? 'VISIT_NOT_FOUND' : 'PATIENT_NOT_FOUND',
        statusMessage: patientExists
          ? `พบข้อมูลผู้ป่วยในระบบ (HN: ${ptRows[0].hn}) แต่ไม่พบวิสิตในวันที่ ${row.transactionDate}`
          : `ไม่พบเลขประจำตัวประชาชนนี้ในฐานข้อมูล HOSxP`,
      });
      notFoundCount++;
      continue;
    }

    // กรณีพบ 1 วิสิต หรือมีหลายวิสิต ให้เลือกวิสิตที่เหมาะสมที่สุด
    let chosenVisit = visits[0];
    if (visits.length > 1) {
      // หาตัวที่ยอดเงินตรงกันที่สุด หรือเป็นสิทธิข้าราชการ
      const exactPriceMatch = visits.find((v) => Math.abs(v.hosxpPrice - row.amount) < 0.01);
      if (exactPriceMatch) {
        chosenVisit = exactPriceMatch;
      }
    }

    matchedCount++;
    const currentCode = (chosenVisit.existingAuthCode || '').trim();

    if (!currentCode) {
      items.push({
        rowNo: row.rowNo,
        ktb: row,
        status: 'READY_TO_IMPORT',
        statusMessage: 'จับคู่วิสิตสำเร็จ — พร้อมบันทึก Approve Code',
        matchedVisit: chosenVisit,
        candidateVisits: visits,
        selectedVn: chosenVisit.vn,
      });
      readyToImportCount++;
    } else if (currentCode === row.approveCode) {
      items.push({
        rowNo: row.rowNo,
        ktb: row,
        status: 'ALREADY_SET',
        statusMessage: `ใน HOSxP มีรหัส ${currentCode} ตรงกับ KTB อยู่แล้ว`,
        matchedVisit: chosenVisit,
        candidateVisits: visits,
        selectedVn: chosenVisit.vn,
      });
      alreadySetCount++;
    } else {
      items.push({
        rowNo: row.rowNo,
        ktb: row,
        status: 'CONFLICT',
        statusMessage: `ใน HOSxP มีรหัสเดิมอยู่แล้ว (${currentCode}) แต่ไฟล์ KTB คือ ${row.approveCode}`,
        matchedVisit: chosenVisit,
        candidateVisits: visits,
        selectedVn: chosenVisit.vn,
      });
      conflictCount++;
    }
  }

  return {
    totalRows: rows.length,
    matchedCount,
    readyToImportCount,
    alreadySetCount,
    conflictCount,
    notFoundCount,
    noApproveCodeCount,
    totalAmount,
    items,
  };
}

/**
 * บันทึก Approve Code ลง visit_pttype และ authenhos ใน HOSxP
 */
export async function applyKtbApproveCodes(
  entries: KtbApplyEntry[],
  connection: HospitalConnection
): Promise<KtbApplySummary> {
  const summary: KtbApplySummary = {
    totalRequested: entries.length,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    updatedVns: [],
    errors: [],
  };

  if (entries.length === 0) {
    return summary;
  }

  await connection.beginTransaction();
  try {
    for (const entry of entries) {
      const vn = (entry.vn || '').trim();
      const approveCode = (entry.approveCode || '').trim();
      const cid = (entry.cid || '').trim();
      const authDateTime = entry.transactionDateTime || new Date().toISOString().slice(0, 19).replace('T', ' ');
      const terminalId = (entry.terminalId || '').trim();

      if (!vn || !approveCode) {
        summary.skippedCount++;
        continue;
      }

      // ตรวจสอบรหัสเดิมก่อน ถ้าไม่ต้องการ overwrite
      if (!entry.overwrite) {
        const [existing] = (await connection.query(
          'SELECT auth_code FROM visit_pttype WHERE vn = ? LIMIT 1',
          [vn]
        )) as any;
        if (Array.isArray(existing) && existing.length > 0 && existing[0].auth_code && existing[0].auth_code.trim()) {
          const currentCode = existing[0].auth_code.trim();
          if (currentCode !== approveCode) {
            summary.skippedCount++;
            continue;
          }
        }
      }

      const noteText = terminalId ? `KTB_EDC:${terminalId}` : 'KTB_EDC';

      // 1. อัปเดต visit_pttype
      await connection.query(
        `UPDATE visit_pttype
         SET auth_code = ?,
             Auth_DateTime = ?,
             pttype_note = IF(IFNULL(pttype_note, '') = '', ?, CONCAT(pttype_note, ' [', ?, ']'))
         WHERE vn = ?`,
        [approveCode, authDateTime, noteText, noteText, vn]
      );

      // 2. ซิงค์ลง authenhos เพื่อให้ E-Claim และ FDH export 16 files ดึงไปลง PERMITNO ใน INS.txt ได้ 100%
      const dateOnly = authDateTime.slice(0, 10);
      const timeOnly = authDateTime.slice(11, 19) || '00:00:00';

      await connection.query('DELETE FROM authenhos WHERE vn = ?', [vn]);
      await connection.query(
        `INSERT INTO authenhos
         (pid, claim_type, claim_type_name, created_date, created_time, claim_code, vn)
         VALUES (?, 'KTB_EDC', 'KTB Approve Code (EDC)', ?, ?, ?, ?)`,
        [cid, dateOnly, timeOnly, approveCode, vn]
      );

      summary.updatedCount++;
      summary.updatedVns.push(vn);
    }

    await connection.commit();
  } catch (err) {
    await connection.rollback();
    const errorMsg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกข้อมูล';
    summary.failedCount = entries.length - summary.updatedCount;
    summary.errors.push({ vn: 'ALL', message: errorMsg });
    throw new Error(`บันทึก Approve Code ล้มเหลว: ${errorMsg}`);
  }

  return summary;
}
