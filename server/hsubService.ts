import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';
import { getRepstmConnection, getUTFConnection } from './db/connection.js';
import { ensureRepstmTables } from './db/schema.js';

export interface HsubPaymentItem {
  id?: number;
  batch_id?: number;
  filename: string;
  rep: string;
  item_no?: number | null;
  tran_id: string;
  hn?: string | null;
  an?: string | null;
  pid?: string | null;
  patient_name?: string | null;
  service_date?: string | null;
  discharge_date?: string | null;
  maininscl?: string | null;
  projcode?: string | null;
  hcode: string;
  hcode_paid?: string | null;
  claim_amt: number;
  ip_net: number;
  op_amt: number;
  ip_calc: number;
  ip_paid: number;
  hc_amt: number;
  hc_drug: number;
  ae_amt: number;
  ae_drug: number;
  inst_amt: number;
  dmis_calc: number;
  dmis_paid: number;
  dmis_drug: number;
  palliative_amt: number;
  dmishd_amt: number;
  pp_amt: number;
  fs_amt: number;
  total_paid: number;
  section_type: 'normal' | 'appeal';
}

export interface HsubBatchSummary {
  id: number;
  filename: string;
  file_path: string;
  report_date: string | null;
  total_records: number;
  total_claim: number;
  total_paid: number;
  hcodes: string;
  reps: string;
  created_at: string;
}

export interface HsubHospitalSummary {
  hcode: string;
  hospital_name: string;
  record_count: number;
  claim_total: number;
  hc_drug_total: number;
  ae_total: number;
  ae_drug_total: number;
  inst_total: number;
  pp_total: number;
  fs_total: number;
  op_total: number;
  ip_total: number;
  dmis_total: number;
  palliative_total: number;
  total_paid: number;
}

export interface HsubFundCategorySummary {
  category_key: string;
  category_name: string;
  description: string;
  moph_account_suggested: string;
  moph_desc_suggested: string;
  record_count: number;
  total_amount: number;
  percentage: number;
}

export interface HsubEbudgetMatchRow {
  rep: string;
  hsub_record_count: number;
  hsub_total_paid: number;
  hsub_hcodes: string[];
  hsub_fund_tags: string[];
  ebudget_matched: boolean;
  match_type: 'exact_rep' | 'fiscal_group' | 'unmatched';
  ebudget_batch_no?: string;
  ebudget_ref_doc_no?: string;
  ebudget_fund_name?: string;
  ebudget_moph_id?: string;
  ebudget_moph_desc?: string;
  ebudget_net_total?: number;
  ebudget_posting_date?: string;
  explanation: string;
}

export interface HsubDashboardSummary {
  total_files: number;
  total_records: number;
  total_claim: number;
  total_paid: number;
  hospital_count: number;
  hospitals: HsubHospitalSummary[];
  fund_categories: HsubFundCategorySummary[];
  ebudget_matches: HsubEbudgetMatchRow[];
  latest_import_date?: string;
}

const DEFAULT_HOSPITAL_NAMES: Record<string, string> = {
  '05569': 'รพ.สต.บ้านห้วยหีบรุ่งอรุณ',
  '05570': 'รพ.สต.บ้านโพนค้อ',
  '05571': 'รพ.สต.บ้านม่วงไข่น้อย',
  '05572': 'รพ.สต.บ้านโคกนาดี',
  '05573': 'รพ.สต.บ้านโพนทองวัฒนา',
  '11101': 'โรงพยาบาลโคกศรีสุพรรณ (แม่ข่าย CUP)',
};

/**
 * Helper to fetch hospital names for health centers
 */
async function getHospitalNamesMap(): Promise<Record<string, string>> {
  const result = { ...DEFAULT_HOSPITAL_NAMES };
  try {
    const conn = await getUTFConnection();
    try {
      const [rows]: any = await conn.query(
        "SELECT hospcode, name FROM hospcode WHERE hospcode IN ('05569', '05570', '05571', '05572', '05573', '11101')"
      );
      if (Array.isArray(rows)) {
        for (const r of rows) {
          if (r.hospcode && r.name) {
            result[String(r.hospcode).trim()] = String(r.name).trim();
          }
        }
      }
    } finally {
      conn.release();
    }
  } catch (err) {
    console.warn('[HsubService] Unable to query hospcode table, using default names:', err);
  }
  return result;
}

/**
 * Parse a datetime string from report header (e.g. 11/10/2026 11:21:36 or 2025-07-15 14:31:00)
 */
function parseReportDate(val: any): string | null {
  if (!val) return null;
  const str = String(val).trim();
  // Match DD/MM/YYYY HH:MM:SS
  const dmyMatch = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{1,2}):(\d{1,2}):?(\d{1,2})?/);
  if (dmyMatch) {
    const [, d, m, y, h, min, s] = dmyMatch;
    let year = Number(y);
    // If Buddhist year (> 2400), convert to CE for MySQL DATETIME
    if (year > 2400) year -= 543;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')} ${h.padStart(2, '0')}:${min.padStart(2, '0')}:${(s || '00').padStart(2, '0')}`;
  }
  // Match standard YYYY-MM-DD
  if (str.length >= 10 && str.includes('-')) {
    return str.substring(0, 19);
  }
  return null;
}

/**
 * Import a single H-Sub file's parsed raw rows into database
 */
export async function importHsubRawData(
  filename: string,
  data: any[][],
  filePath?: string,
  externalConn?: any
): Promise<{
  success: boolean;
  filename: string;
  records: number;
  claim: number;
  paid: number;
}> {
  await ensureRepstmTables();
  const conn = externalConn || (await getRepstmConnection());
  const releaseConn = !externalConn;

  try {
    if (!data || data.length < 8) {
      return { success: false, filename, records: 0, claim: 0, paid: 0 };
    }

    let reportDate: string | null = null;
    if (data[0] && data[0][0]) {
      reportDate = parseReportDate(data[0][0]);
    }

    let sectionType: 'normal' | 'appeal' = 'normal';
    const fileItems: HsubPaymentItem[] = [];
    const fileHcodes = new Set<string>();
    const fileReps = new Set<string>();
    let fileClaim = 0;
    let filePaid = 0;

    for (let r = 0; r < data.length; r++) {
      const row = data[r];
      if (!row || row.length === 0 || !row[0]) continue;

      const col0 = String(row[0]).trim();
      if (col0.includes('อุทธรณ์')) {
        sectionType = 'appeal';
        continue;
      }
      if (col0.includes('ปกติ')) {
        sectionType = 'normal';
        continue;
      }
      if (col0 === 'REP' || col0.includes('รายงาน') || col0.includes('ลำดับ')) {
        continue;
      }
      if (!/^\d+$/.test(col0)) continue;

      const rep = col0;
      const tranId = String(row[2] || '').trim();
      if (!tranId) continue;

      const hcode = String(row[13] || '').trim();
      if (hcode) fileHcodes.add(hcode);
      fileReps.add(rep);

      const claimAmt = Number(row[17]) || 0;
      const ipNet = Number(row[26]) || 0;
      const opAmt = Number(row[27]) || 0;
      const ipCalc = Number(row[28]) || 0;
      const ipPaid = Number(row[29]) || 0;
      const hcAmt = Number(row[30]) || 0;
      const hcDrug = Number(row[31]) || 0;
      const aeAmt = Number(row[32]) || 0;
      const aeDrug = Number(row[33]) || 0;
      const instAmt = Number(row[34]) || 0;
      const dmisCalc = Number(row[35]) || 0;
      const dmisPaid = Number(row[36]) || 0;
      const dmisDrug = Number(row[37]) || 0;
      const palliativeAmt = Number(row[38]) || 0;
      const dmishdAmt = Number(row[39]) || 0;
      const ppAmt = Number(row[40]) || 0;
      const fsAmt = Number(row[41]) || 0;
      const paidTotal = Number(row[42]) || 0;

      fileClaim += claimAmt;
      filePaid += paidTotal;

      fileItems.push({
        filename,
        rep,
        item_no: Number(row[1]) || null,
        tran_id: tranId,
        hn: row[3] ? String(row[3]).trim() : null,
        an: row[4] ? String(row[4]).trim() : null,
        pid: row[5] ? String(row[5]).trim() : null,
        patient_name: row[6] ? String(row[6]).trim() : null,
        service_date: parseReportDate(row[7]),
        discharge_date: parseReportDate(row[8]),
        maininscl: row[9] ? String(row[9]).trim() : null,
        projcode: row[10] ? String(row[10]).trim() : null,
        hcode: hcode || '11101',
        hcode_paid: row[16] ? String(row[16]).trim() : '11101',
        claim_amt: claimAmt,
        ip_net: ipNet,
        op_amt: opAmt,
        ip_calc: ipCalc,
        ip_paid: ipPaid,
        hc_amt: hcAmt,
        hc_drug: hcDrug,
        ae_amt: aeAmt,
        ae_drug: aeDrug,
        inst_amt: instAmt,
        dmis_calc: dmisCalc,
        dmis_paid: dmisPaid,
        dmis_drug: dmisDrug,
        palliative_amt: palliativeAmt,
        dmishd_amt: dmishdAmt,
        pp_amt: ppAmt,
        fs_amt: fsAmt,
        total_paid: paidTotal,
        section_type: sectionType,
      });
    }

    if (fileItems.length === 0) {
      return { success: true, filename, records: 0, claim: 0, paid: 0 };
    }

    // Upsert into hsub_import_batch
    const hcodesStr = Array.from(fileHcodes).join(',');
    const repsStr = Array.from(fileReps).join(',');
    const [batchResult]: any = await conn.query(
      `INSERT INTO hsub_import_batch (
        filename, file_path, report_date, total_records, total_claim, total_paid, hcodes, reps
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        file_path = VALUES(file_path),
        report_date = VALUES(report_date),
        total_records = VALUES(total_records),
        total_claim = VALUES(total_claim),
        total_paid = VALUES(total_paid),
        hcodes = VALUES(hcodes),
        reps = VALUES(reps),
        updated_at = CURRENT_TIMESTAMP`,
      [filename, filePath || null, reportDate, fileItems.length, fileClaim, filePaid, hcodesStr, repsStr]
    );

    const [batchRows]: any = await conn.query(
      'SELECT id FROM hsub_import_batch WHERE filename = ? LIMIT 1',
      [filename]
    );
    const batchId = batchRows[0]?.id || batchResult.insertId;

    // Insert items in chunks of 500 rows using bulk nested array
    const chunkSize = 500;
    for (let i = 0; i < fileItems.length; i += chunkSize) {
      const chunk = fileItems.slice(i, i + chunkSize);
      const chunkRows = chunk.map((item) => [
        batchId,
        item.filename,
        item.rep,
        item.item_no,
        item.tran_id,
        item.hn,
        item.an,
        item.pid,
        item.patient_name,
        item.service_date,
        item.discharge_date,
        item.maininscl,
        item.projcode,
        item.hcode,
        item.hcode_paid,
        item.claim_amt,
        item.ip_net,
        item.op_amt,
        item.ip_calc,
        item.ip_paid,
        item.hc_amt,
        item.hc_drug,
        item.ae_amt,
        item.ae_drug,
        item.inst_amt,
        item.dmis_calc,
        item.dmis_paid,
        item.dmis_drug,
        item.palliative_amt,
        item.dmishd_amt,
        item.pp_amt,
        item.fs_amt,
        item.total_paid,
        item.section_type,
      ]);

      const sql = `
        INSERT INTO hsub_payment_item (
          batch_id, filename, rep, item_no, tran_id, hn, an, pid, patient_name,
          service_date, discharge_date, maininscl, projcode, hcode, hcode_paid,
          claim_amt, ip_net, op_amt, ip_calc, ip_paid, hc_amt, hc_drug,
          ae_amt, ae_drug, inst_amt, dmis_calc, dmis_paid, dmis_drug,
          palliative_amt, dmishd_amt, pp_amt, fs_amt, total_paid, section_type
        ) VALUES ?
        ON DUPLICATE KEY UPDATE
          batch_id = VALUES(batch_id),
          filename = VALUES(filename),
          item_no = VALUES(item_no),
          hn = VALUES(hn),
          an = VALUES(an),
          pid = VALUES(pid),
          patient_name = VALUES(patient_name),
          service_date = VALUES(service_date),
          discharge_date = VALUES(discharge_date),
          maininscl = VALUES(maininscl),
          projcode = VALUES(projcode),
          hcode_paid = VALUES(hcode_paid),
          claim_amt = VALUES(claim_amt),
          ip_net = VALUES(ip_net),
          op_amt = VALUES(op_amt),
          ip_calc = VALUES(ip_calc),
          ip_paid = VALUES(ip_paid),
          hc_amt = VALUES(hc_amt),
          hc_drug = VALUES(hc_drug),
          ae_amt = VALUES(ae_amt),
          ae_drug = VALUES(ae_drug),
          inst_amt = VALUES(inst_amt),
          dmis_calc = VALUES(dmis_calc),
          dmis_paid = VALUES(dmis_paid),
          dmis_drug = VALUES(dmis_drug),
          palliative_amt = VALUES(palliative_amt),
          dmishd_amt = VALUES(dmishd_amt),
          pp_amt = VALUES(pp_amt),
          fs_amt = VALUES(fs_amt),
          total_paid = VALUES(total_paid),
          section_type = VALUES(section_type),
          updated_at = CURRENT_TIMESTAMP
      `;

      await conn.query(sql, [chunkRows]);
    }

    return {
      success: true,
      filename,
      records: fileItems.length,
      claim: fileClaim,
      paid: filePaid,
    };
  } finally {
    if (releaseConn) {
      conn.release();
    }
  }
}

/**
 * Import all H-Sub payment files from directory (default D:\hsub)
 */
export async function importHsubDirectory(customDir?: string): Promise<{
  success: boolean;
  total_files: number;
  imported_files: number;
  total_records: number;
  total_claim: number;
  total_paid: number;
  errors: string[];
}> {
  await ensureRepstmTables();
  const targetDir = customDir || process.env.HSUB_DIR || 'D:\\hsub';

  if (!fs.existsSync(targetDir)) {
    throw new Error(`ไม่พบโฟลเดอร์สำหรับนำเข้าข้อมูล: ${targetDir}`);
  }

  const files = fs.readdirSync(targetDir).filter((f) => f.toLowerCase().endsWith('.xls') || f.toLowerCase().endsWith('.xlsx'));
  if (files.length === 0) {
    return {
      success: true,
      total_files: 0,
      imported_files: 0,
      total_records: 0,
      total_claim: 0,
      total_paid: 0,
      errors: ['ไม่พบไฟล์ .xls ในโฟลเดอร์'],
    };
  }

  const conn = await getRepstmConnection();
  let totalRecords = 0;
  let totalClaim = 0;
  let totalPaid = 0;
  let importedFiles = 0;
  const errors: string[] = [];

  try {
    for (const file of files) {
      const fullPath = path.join(targetDir, file);
      try {
        const wb = xlsx.readFile(fullPath);
        const sheetName = wb.SheetNames.find((s) => s.includes('รายงานพึงจ่าย') || s.includes('รายละเอียด(ข้อมูลปกติ)') || s.includes('รายละเอียด') || s.includes('Sheet1')) || wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        if (!ws) continue;

        const data: any[][] = xlsx.utils.sheet_to_json(ws, { header: 1 });
        const res = await importHsubRawData(file, data, fullPath, conn);
        importedFiles++;
        totalRecords += res.records;
        totalClaim += res.claim;
        totalPaid += res.paid;
      } catch (err: any) {
        console.error(`[HsubService] Error importing ${file}:`, err);
        errors.push(`เกิดข้อผิดพลาดในการนำเข้าไฟล์ ${file}: ${err.message}`);
      }
    }
  } finally {
    conn.release();
  }

  return {
    success: errors.length === 0 || importedFiles > 0,
    total_files: files.length,
    imported_files: importedFiles,
    total_records: totalRecords,
    total_claim: totalClaim,
    total_paid: totalPaid,
    errors,
  };
}

/**
 * Get comprehensive H-Sub Dashboard summary including hospital allocations,
 * fund category breakdowns, and eBudget reconciliation.
 */
export async function getHsubDashboardSummary(filters?: {
  hcode?: string;
  rep?: string;
  budgetYear?: string;
}): Promise<HsubDashboardSummary> {
  await ensureRepstmTables();
  const conn = await getRepstmConnection();
  const hospNames = await getHospitalNamesMap();

  try {
    // 1. Overall stats
    let whereClause = '1=1';
    const params: any[] = [];
    if (filters?.hcode) {
      whereClause += ' AND hcode = ?';
      params.push(filters.hcode);
    }
    if (filters?.rep) {
      whereClause += ' AND rep = ?';
      params.push(filters.rep);
    }

    const [overallRows]: any = await conn.query(
      `SELECT
        COUNT(*) as total_records,
        COALESCE(SUM(claim_amt), 0) as total_claim,
        COALESCE(SUM(total_paid), 0) as total_paid,
        COUNT(DISTINCT filename) as total_files,
        COUNT(DISTINCT hcode) as hospital_count,
        MAX(created_at) as latest_import_date
       FROM hsub_payment_item
       WHERE ${whereClause}`,
      params
    );
    const overall = overallRows[0] || {};

    // 2. Summary per hospital (รพ.สต.)
    const [hospRows]: any = await conn.query(
      `SELECT
        hcode,
        COUNT(*) as record_count,
        COALESCE(SUM(claim_amt), 0) as claim_total,
        COALESCE(SUM(hc_drug), 0) as hc_drug_total,
        COALESCE(SUM(ae_amt), 0) as ae_total,
        COALESCE(SUM(ae_drug), 0) as ae_drug_total,
        COALESCE(SUM(inst_amt), 0) as inst_total,
        COALESCE(SUM(pp_amt), 0) as pp_total,
        COALESCE(SUM(fs_amt), 0) as fs_total,
        COALESCE(SUM(op_amt), 0) as op_total,
        COALESCE(SUM(ip_paid), 0) as ip_total,
        COALESCE(SUM(dmis_paid + dmis_drug), 0) as dmis_total,
        COALESCE(SUM(palliative_amt), 0) as palliative_total,
        COALESCE(SUM(total_paid), 0) as total_paid
       FROM hsub_payment_item
       WHERE ${whereClause}
       GROUP BY hcode
       ORDER BY total_paid DESC, hcode ASC`,
      params
    );

    const hospitals: HsubHospitalSummary[] = hospRows.map((r: any) => ({
      hcode: r.hcode,
      hospital_name: hospNames[r.hcode] || `รพ.สต. (${r.hcode})`,
      record_count: Number(r.record_count),
      claim_total: Number(r.claim_total),
      hc_drug_total: Number(r.hc_drug_total),
      ae_total: Number(r.ae_total),
      ae_drug_total: Number(r.ae_drug_total),
      inst_total: Number(r.inst_total),
      pp_total: Number(r.pp_total),
      fs_total: Number(r.fs_total),
      op_total: Number(r.op_total),
      ip_total: Number(r.ip_total),
      dmis_total: Number(r.dmis_total),
      palliative_total: Number(r.palliative_total),
      total_paid: Number(r.total_paid),
    }));

    // 3. Fund categories breakdown
    const [fundTotals]: any = await conn.query(
      `SELECT
        COALESCE(SUM(hc_drug), 0) as sum_hc_drug,
        COUNT(CASE WHEN hc_drug > 0 THEN 1 END) as count_hc_drug,
        COALESCE(SUM(ae_amt), 0) as sum_ae,
        COUNT(CASE WHEN ae_amt > 0 THEN 1 END) as count_ae,
        COALESCE(SUM(ae_drug), 0) as sum_ae_drug,
        COUNT(CASE WHEN ae_drug > 0 THEN 1 END) as count_ae_drug,
        COALESCE(SUM(inst_amt), 0) as sum_inst,
        COUNT(CASE WHEN inst_amt > 0 THEN 1 END) as count_inst,
        COALESCE(SUM(pp_amt), 0) as sum_pp,
        COUNT(CASE WHEN pp_amt > 0 THEN 1 END) as count_pp,
        COALESCE(SUM(fs_amt), 0) as sum_fs,
        COUNT(CASE WHEN fs_amt > 0 THEN 1 END) as count_fs,
        COALESCE(SUM(op_amt), 0) as sum_op,
        COUNT(CASE WHEN op_amt > 0 THEN 1 END) as count_op,
        COALESCE(SUM(ip_paid), 0) as sum_ip,
        COUNT(CASE WHEN ip_paid > 0 THEN 1 END) as count_ip,
        COALESCE(SUM(dmis_paid + dmis_drug), 0) as sum_dmis,
        COUNT(CASE WHEN dmis_paid > 0 OR dmis_drug > 0 THEN 1 END) as count_dmis,
        COALESCE(SUM(palliative_amt), 0) as sum_palliative,
        COUNT(CASE WHEN palliative_amt > 0 THEN 1 END) as count_palliative,
        COALESCE(SUM(total_paid), 0) as sum_total
       FROM hsub_payment_item
       WHERE ${whereClause}`,
      params
    );

    const f = fundTotals[0] || {};
    const sumTotalPaid = Number(f.sum_total) || 1; // avoid divide by zero

    const fundCategories: HsubFundCategorySummary[] = [
      {
        category_key: 'hc_drug',
        category_name: 'ค่ายาผู้ป่วยที่บ้าน (Home Care Drug)',
        description: 'ชดเชยค่าจัดส่งและค่ายารักษาผู้ป่วยที่บ้านโดย รพ.สต./ทีมปฐมภูมิ',
        moph_account_suggested: '4301020105.228 / 4301020105.214',
        moph_desc_suggested: 'รายได้กองทุน UC - บริการระดับปฐมภูมิ / OP เหมาจ่าย',
        record_count: Number(f.count_hc_drug || 0),
        total_amount: Number(f.sum_hc_drug || 0),
        percentage: Number(((Number(f.sum_hc_drug || 0) / sumTotalPaid) * 100).toFixed(2)),
      },
      {
        category_key: 'pp_amt',
        category_name: 'สร้างเสริมสุขภาพและป้องกันโรค (PP)',
        description: 'ค่าบริการสร้างเสริมสุขภาพและป้องกันโรคเฉพาะรายการ (P&P Service)',
        moph_account_suggested: '4301020105.223',
        moph_desc_suggested: 'รายได้กองทุน UC - P&P อื่น',
        record_count: Number(f.count_pp || 0),
        total_amount: Number(f.sum_pp || 0),
        percentage: Number(((Number(f.sum_pp || 0) / sumTotalPaid) * 100).toFixed(2)),
      },
      {
        category_key: 'ae_amt',
        category_name: 'อุบัติเหตุฉุกเฉิน (AE)',
        description: 'ชดเชยค่าบริการตรวจรักษาผู้ป่วยอุบัติเหตุฉุกเฉินระดับหน่วยปฐมภูมิ',
        moph_account_suggested: '4301020105.228',
        moph_desc_suggested: 'รายได้กองทุน UC - อื่น (บริการระดับปฐมภูมิ)',
        record_count: Number(f.count_ae || 0),
        total_amount: Number(f.sum_ae || 0),
        percentage: Number(((Number(f.sum_ae || 0) / sumTotalPaid) * 100).toFixed(2)),
      },
      {
        category_key: 'ae_drug',
        category_name: 'ยาอุบัติเหตุฉุกเฉิน (AE Drug)',
        description: 'ชดเชยค่ายาสำหรับผู้ป่วยอุบัติเหตุฉุกเฉิน',
        moph_account_suggested: '4301020105.228',
        moph_desc_suggested: 'รายได้กองทุน UC - อื่น (ยาฉุกเฉิน)',
        record_count: Number(f.count_ae_drug || 0),
        total_amount: Number(f.sum_ae_drug || 0),
        percentage: Number(((Number(f.sum_ae_drug || 0) / sumTotalPaid) * 100).toFixed(2)),
      },
      {
        category_key: 'inst_amt',
        category_name: 'ค่าอุปกรณ์และอวัยวะเทียม (INST)',
        description: 'ชดเชยค่าอุปกรณ์ทางการแพทย์และอวัยวะเทียม (Central Reimburse)',
        moph_account_suggested: '4301020105.228',
        moph_desc_suggested: 'รายได้กองทุน CENTRAL REIMBURSE (ค่าอุปกรณ์)',
        record_count: Number(f.count_inst || 0),
        total_amount: Number(f.sum_inst || 0),
        percentage: Number(((Number(f.sum_inst || 0) / sumTotalPaid) * 100).toFixed(2)),
      },
    ].filter((cat) => cat.total_amount > 0);

    // 4. eBudget Reconciliation matching
    const [hsubReps]: any = await conn.query(
      `SELECT
        rep,
        COUNT(*) as record_count,
        COALESCE(SUM(total_paid), 0) as total_paid,
        GROUP_CONCAT(DISTINCT hcode ORDER BY hcode SEPARATOR ',') as hcodes_list,
        GROUP_CONCAT(DISTINCT maininscl SEPARATOR ',') as inscls_list,
        SUM(hc_drug) as sum_hc_drug,
        SUM(ae_amt + ae_drug) as sum_ae,
        SUM(inst_amt) as sum_inst,
        SUM(pp_amt) as sum_pp,
        SUM(fs_amt) as sum_fs
       FROM hsub_payment_item
       WHERE ${whereClause}
       GROUP BY rep
       ORDER BY total_paid DESC, rep DESC`,
      params
    );

    // Fetch eBudget transfers from repstminv
    const [transfers]: any = await conn.query(
      `SELECT id, budget_year, run_date, posting_date, batch_no, ref_doc_no, fund_name, moph_id, moph_desc, net_total
       FROM smt_budget_transfers`
    );

    const ebudgetMatches: HsubEbudgetMatchRow[] = [];

    for (const hr of hsubReps) {
      const rep = String(hr.rep);
      const repPaid = Number(hr.total_paid);
      const hcodes = String(hr.hcodes_list || '').split(',').filter(Boolean);
      const fundTags: string[] = [];

      if (Number(hr.sum_hc_drug) > 0) fundTags.push('ยา Home Care');
      if (Number(hr.sum_ae) > 0) fundTags.push('AE ฉุกเฉิน');
      if (Number(hr.sum_inst) > 0) fundTags.push('อุปกรณ์ INST');
      if (Number(hr.sum_pp) > 0) fundTags.push('ส่งเสริม PP');
      if (Number(hr.sum_fs) > 0) fundTags.push('Fee Schedule');

      // Check 1: Exact REP match
      const exactMatch = transfers.find((t: any) => String(t.ref_doc_no).trim() === rep);

      if (exactMatch) {
        ebudgetMatches.push({
          rep,
          hsub_record_count: Number(hr.record_count),
          hsub_total_paid: repPaid,
          hsub_hcodes: hcodes,
          hsub_fund_tags: fundTags,
          ebudget_matched: true,
          match_type: 'exact_rep',
          ebudget_batch_no: exactMatch.batch_no,
          ebudget_ref_doc_no: exactMatch.ref_doc_no,
          ebudget_fund_name: exactMatch.fund_name,
          ebudget_moph_id: exactMatch.moph_id,
          ebudget_moph_desc: exactMatch.moph_desc,
          ebudget_net_total: Number(exactMatch.net_total),
          ebudget_posting_date: exactMatch.posting_date || exactMatch.run_date,
          explanation: `ตรงกับหนังสือ REP ใน e-Budget โดยตรง (Batch ${exactMatch.batch_no}: ${exactMatch.fund_name} / ${exactMatch.moph_desc})`,
        });
      } else {
        // Check 2: Fiscal month prefix matching (e.g. 6908 matches transfers with ref_doc_no starting with 6908)
        const fiscalPrefix = rep.length >= 4 ? rep.substring(0, 4) : '';
        const groupMatch = transfers.find(
          (t: any) =>
            fiscalPrefix &&
            String(t.ref_doc_no).startsWith(fiscalPrefix) &&
            (String(t.fund_name).includes('ปฐมภูมิ') ||
              String(t.fund_name).includes('สร้างเสริม') ||
              String(t.fund_name).includes('CENTRAL') ||
              String(t.fund_name).includes('ผู้ป่วยนอก'))
        );

        if (groupMatch) {
          ebudgetMatches.push({
            rep,
            hsub_record_count: Number(hr.record_count),
            hsub_total_paid: repPaid,
            hsub_hcodes: hcodes,
            hsub_fund_tags: fundTags,
            ebudget_matched: true,
            match_type: 'fiscal_group',
            ebudget_batch_no: groupMatch.batch_no,
            ebudget_ref_doc_no: groupMatch.ref_doc_no,
            ebudget_fund_name: groupMatch.fund_name,
            ebudget_moph_id: groupMatch.moph_id,
            ebudget_moph_desc: groupMatch.moph_desc,
            ebudget_net_total: Number(groupMatch.net_total),
            ebudget_posting_date: groupMatch.posting_date || groupMatch.run_date,
            explanation: `รวมอยู่ในงวดโอนงบเหมาจ่าย/ปฐมภูมิ ${groupMatch.ref_doc_no} (Batch ${groupMatch.batch_no}: ${groupMatch.fund_name})`,
          });
        } else {
          // Check 3: Categorized without direct eBudget batch match
          let autoDesc = 'งบชดเชยบริการระดับปฐมภูมิ รพ.สต. (UC-OP/PP)';
          if (fundTags.includes('ส่งเสริม PP')) autoDesc = 'กองทุนสร้างเสริมสุขภาพและป้องกันโรค (MOPH 4301020105.223)';
          else if (fundTags.includes('ยา Home Care')) autoDesc = 'งบยา Home Care / บริการปฐมภูมิ (MOPH 4301020105.228)';

          ebudgetMatches.push({
            rep,
            hsub_record_count: Number(hr.record_count),
            hsub_total_paid: repPaid,
            hsub_hcodes: hcodes,
            hsub_fund_tags: fundTags,
            ebudget_matched: false,
            match_type: 'unmatched',
            explanation: `${autoDesc} - ยังไม่พบเลขที่เอกสารตรงตัวใน e-Budget (รอโอนหรือโอนรวมในงบเหมาจ่าย)`,
          });
        }
      }
    }

    return {
      total_files: Number(overall.total_files || 0),
      total_records: Number(overall.total_records || 0),
      total_claim: Number(overall.total_claim || 0),
      total_paid: Number(overall.total_paid || 0),
      hospital_count: Number(overall.hospital_count || 0),
      hospitals,
      fund_categories: fundCategories,
      ebudget_matches: ebudgetMatches,
      latest_import_date: overall.latest_import_date,
    };
  } finally {
    conn.release();
  }
}

/**
 * Get paginated list of patient-level transaction records
 */
export async function getHsubTransactions(filters?: {
  hcode?: string;
  rep?: string;
  search?: string;
  page?: number;
  limit?: number;
}): Promise<{
  rows: HsubPaymentItem[];
  total: number;
  page: number;
  limit: number;
}> {
  await ensureRepstmTables();
  const conn = await getRepstmConnection();
  const page = Math.max(1, Number(filters?.page || 1));
  const limit = Math.max(1, Math.min(200, Number(filters?.limit || 50)));
  const offset = (page - 1) * limit;

  try {
    let whereClause = '1=1';
    const params: any[] = [];

    if (filters?.hcode) {
      whereClause += ' AND hcode = ?';
      params.push(filters.hcode);
    }
    if (filters?.rep) {
      whereClause += ' AND rep = ?';
      params.push(filters.rep);
    }
    if (filters?.search) {
      const q = `%${filters.search.trim()}%`;
      whereClause += ' AND (hn LIKE ? OR pid LIKE ? OR patient_name LIKE ? OR tran_id LIKE ? OR rep LIKE ?)';
      params.push(q, q, q, q, q);
    }

    const [cntRows]: any = await conn.query(
      `SELECT COUNT(*) as cnt FROM hsub_payment_item WHERE ${whereClause}`,
      params
    );
    const total = Number(cntRows[0]?.cnt || 0);

    const [rows]: any = await conn.query(
      `SELECT * FROM hsub_payment_item
       WHERE ${whereClause}
       ORDER BY service_date DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return {
      rows: rows as HsubPaymentItem[],
      total,
      page,
      limit,
    };
  } finally {
    conn.release();
  }
}

/**
 * Get list of imported batches
 */
export async function getHsubBatches(): Promise<HsubBatchSummary[]> {
  await ensureRepstmTables();
  const conn = await getRepstmConnection();
  try {
    const [rows]: any = await conn.query(
      `SELECT * FROM hsub_import_batch ORDER BY report_date DESC, id DESC`
    );
    return rows as HsubBatchSummary[];
  } finally {
    conn.release();
  }
}
