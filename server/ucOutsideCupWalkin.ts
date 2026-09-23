import { parseSiteWalkinSettings, readHospitalIdentity } from './siteProfile.js';
import { getRepstmConnection, getUTFConnection, getAppSetting } from './db.js';
import type { HospitalConnection } from './hospitalDatabase.js';

export const UC_WALKIN_NAME = 'WALKIN:ผู้ป่วยนอกเหตุสมควร ทั่วประเทศ';
export const UC_WALKIN_START_DATE = '2024-10-01';

const LOG_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS uc_walkin_insert_log (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    expected_count INT NOT NULL,
    inserted_count INT NOT NULL,
    actor_user_id BIGINT NULL,
    actor_name VARCHAR(160) NOT NULL,
    target_vns LONGTEXT NOT NULL,
    inserted_guids LONGTEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_uc_walkin_log_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const isoDate = (value: unknown) => {
  const text = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw new Error('วันที่ไม่ถูกต้อง');
  return text;
};

export const getWalkinConfirmationText = (count: number) => `เพิ่ม WALKIN ${Math.max(0, Math.trunc(count))} รายการ`;

export const validateUcWalkinRange = (startValue: unknown, endValue: unknown) => {
  const startDate = isoDate(startValue || UC_WALKIN_START_DATE);
  const endDate = isoDate(endValue || new Date().toISOString().slice(0, 10));
  const today = new Date().toISOString().slice(0, 10);
  if (startDate < UC_WALKIN_START_DATE) throw new Error('รองรับข้อมูลตั้งแต่ปีงบประมาณ 2568 (1 ต.ค. 2567) เป็นต้นไป');
  if (endDate > today) throw new Error('วันที่สิ้นสุดต้องไม่เกินวันนี้');
  if (startDate > endDate) throw new Error('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด');
  return { startDate, endDate };
};

export type UcWalkinAuditRow = {
  vn: string;
  hn: string;
  service_date: string;
  service_time: string;
  pttype: string;
  hospmain: string;
  has_walkin: boolean;
  walkin_rows: number;
  has_prescription_template: boolean;
};

export const getUcOutsideCupWalkinAudit = async (input: {
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
  missingOnly?: boolean;
}) => {
  const { startDate, endDate } = validateUcWalkinRange(input.startDate, input.endDate);
  const { pttypes, icode } = parseSiteWalkinSettings(await getAppSetting('site_settings'));
  const page = Math.max(1, Math.trunc(Number(input.page || 1)));
  const pageSize = Math.max(10, Math.min(500, Math.trunc(Number(input.pageSize || 100))));
  const offset = (page - 1) * pageSize;
  const connection = await getUTFConnection();
  try {
    const [itemRows] = await connection.query('SELECT icode FROM s_drugitems WHERE icode = ? LIMIT 1', [icode]);
    if (!(itemRows as unknown[]).length) throw new Error('ไม่พบรหัส WALKIN ที่ตั้งค่าใน HIS');
    const [summaryRows] = await connection.query(
      `SELECT COUNT(*) AS total_visits,
              SUM(CASE WHEN walkin_rows > 0 THEN 1 ELSE 0 END) AS has_walkin,
              SUM(CASE WHEN walkin_rows = 0 THEN 1 ELSE 0 END) AS missing_walkin,
              SUM(CASE WHEN walkin_rows > 1 THEN 1 ELSE 0 END) AS duplicate_visits,
              SUM(CASE WHEN walkin_rows = 0 AND prescription_rows = 0 THEN 1 ELSE 0 END) AS missing_without_template
       FROM (
         SELECT o.vn,
                (SELECT COUNT(*) FROM opitemrece w WHERE w.vn = o.vn AND w.icode = ?) AS walkin_rows,
                (SELECT COUNT(*) FROM opitemrece p WHERE p.vn = o.vn) AS prescription_rows
         FROM ovst o
         WHERE o.vstdate BETWEEN ? AND ? AND o.pttype IN (${pttypes.map(() => '?').join(',')}) AND IFNULL(o.an, '') = ''
       ) audit`,
      [icode, startDate, endDate, ...pttypes]
    );
    const summaryRaw = (Array.isArray(summaryRows) ? summaryRows[0] : {}) as Record<string, unknown>;
    const missingOnlyClause = input.missingOnly === false ? '' : 'AND NOT EXISTS (SELECT 1 FROM opitemrece w WHERE w.vn = o.vn AND w.icode = ?)';
    const params: unknown[] = [icode, startDate, endDate, ...pttypes];
    if (missingOnlyClause) params.push(icode);
    const [rows] = await connection.query(
      `SELECT o.vn, o.hn, DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
              TIME_FORMAT(o.vsttime, '%H:%i:%s') AS service_time, o.pttype,
              COALESCE(o.hospmain, '') AS hospmain,
              (SELECT COUNT(*) FROM opitemrece w WHERE w.vn = o.vn AND w.icode = ?) AS walkin_rows,
              EXISTS(SELECT 1 FROM opitemrece p WHERE p.vn = o.vn) AS has_prescription_template
       FROM ovst o
       WHERE o.vstdate BETWEEN ? AND ? AND o.pttype IN (${pttypes.map(() => '?').join(',')}) AND IFNULL(o.an, '') = ''
         ${missingOnlyClause}
       ORDER BY o.vstdate DESC, o.vsttime DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const total = input.missingOnly === false ? Number(summaryRaw.total_visits || 0) : Number(summaryRaw.missing_walkin || 0);
    return {
      item: { icode: icode, name: UC_WALKIN_NAME },
      period: { startDate, endDate },
      pttypes: [...pttypes],
      configurationKey: JSON.stringify({ pttypes: [...pttypes].sort(), icode }),
      summary: {
        total_visits: Number(summaryRaw.total_visits || 0),
        has_walkin: Number(summaryRaw.has_walkin || 0),
        missing_walkin: Number(summaryRaw.missing_walkin || 0),
        duplicate_visits: Number(summaryRaw.duplicate_visits || 0),
        missing_without_template: Number(summaryRaw.missing_without_template || 0),
      },
      data: (Array.isArray(rows) ? rows : []).map((raw) => {
        const row = raw as Record<string, unknown>;
        const walkinRows = Number(row.walkin_rows || 0);
        return {
          vn: String(row.vn || ''), hn: String(row.hn || ''), service_date: String(row.service_date || ''),
          service_time: String(row.service_time || ''), pttype: String(row.pttype || ''), hospmain: String(row.hospmain || ''),
          has_walkin: walkinRows > 0, walkin_rows: walkinRows,
          has_prescription_template: Boolean(Number(row.has_prescription_template || 0)),
        } satisfies UcWalkinAuditRow;
      }),
      total, page, pageSize,
    };
  } finally {
    connection.release();
  }
};

export const insertMissingUcOutsideCupWalkin = async (input: {
  startDate?: string;
  endDate?: string;
  configurationKey?: string;
  expectedCount: number;
  confirmation: string;
  actorUserId?: number | null;
  actorName: string;
}) => {
  const { startDate, endDate } = validateUcWalkinRange(input.startDate, input.endDate);
  const { pttypes, icode } = parseSiteWalkinSettings(await getAppSetting('site_settings'));
  if (input.configurationKey !== JSON.stringify({ pttypes: [...pttypes].sort(), icode })) throw new Error('การตั้งค่า WALKIN เปลี่ยน กรุณาตรวจสอบและยืนยันใหม่');
  const expectedCount = Math.max(0, Math.trunc(Number(input.expectedCount || 0)));
  if (input.confirmation.trim() !== getWalkinConfirmationText(expectedCount)) throw new Error('ข้อความยืนยันไม่ถูกต้อง');
  if (expectedCount <= 0) throw new Error('ไม่พบรายการที่ต้องเพิ่ม');

  const connection = await getUTFConnection();
  let targets: Array<{ vn: string; hos_guid: string }> = [];
  try {
    const [itemRows] = await connection.query('SELECT icode FROM s_drugitems WHERE icode = ? LIMIT 1', [icode]);
    if (!(itemRows as unknown[]).length) throw new Error('ไม่พบรหัส WALKIN ที่ตั้งค่าใน HIS');
    await connection.beginTransaction();
    await connection.query('DROP TEMPORARY TABLE IF EXISTS tmp_uc_walkin_missing');
    await connection.query(
      `CREATE TEMPORARY TABLE tmp_uc_walkin_missing (
         vn VARCHAR(25) NOT NULL PRIMARY KEY,
         hos_guid VARCHAR(38) NOT NULL UNIQUE
       ) ENGINE=InnoDB`
    );
    await connection.query(
      `INSERT INTO tmp_uc_walkin_missing (vn, hos_guid)
       SELECT o.vn, UPPER(CONCAT('{', UUID(), '}'))
       FROM ovst o
       WHERE o.vstdate BETWEEN ? AND ? AND o.pttype IN (${pttypes.map(() => '?').join(',')}) AND IFNULL(o.an, '') = ''
         AND NOT EXISTS (SELECT 1 FROM opitemrece w WHERE w.vn = o.vn AND w.icode = ?)`,
      [startDate, endDate, ...pttypes, icode]
    );
    const [targetRows] = await connection.query('SELECT vn, hos_guid FROM tmp_uc_walkin_missing ORDER BY vn');
    targets = (Array.isArray(targetRows) ? targetRows : []).map((row) => ({
      vn: String((row as Record<string, unknown>).vn || ''),
      hos_guid: String((row as Record<string, unknown>).hos_guid || ''),
    }));
    if (targets.length !== expectedCount) {
      throw new Error(`จำนวนรายการเปลี่ยนจาก ${expectedCount.toLocaleString('th-TH')} เป็น ${targets.length.toLocaleString('th-TH')} กรุณาตรวจสอบและยืนยันใหม่`);
    }
    const hospitalCode = (await readHospitalIdentity(connection)).hospital_code;
    if (!/^\d{5}$/.test(hospitalCode)) throw new Error('ไม่พบรหัสโรงพยาบาลใน opdconfig');
    const [insertResult] = await connection.query(
      `INSERT INTO opitemrece (
         hos_guid, vn, hn, an, icode, qty, drugusage, idr, iperday, iperdose, unitprice,
         vstdate, vsttime, doctor, rxdate, rxtime, sp_use, hcode, print, dep_code,
         finance_number, discount, use_right, node_id, order_no, sub_type, pttype, income,
         item_type, staff, paidst, item_no, last_modified, sum_price, cost,
         stock_department_id, command_doctor, opi_doctor_finance_type_id
       )
       SELECT t.hos_guid, o.vn, o.hn, NULL, ?, 1, '', 'N/A', 0, 0, 0,
              o.vstdate, o.vsttime, COALESCE(NULLIF(base.doctor, ''), o.doctor, ''),
              o.vstdate, o.vsttime, '', ?, 'N',
              COALESCE(NULLIF(base.dep_code, ''), NULLIF(o.main_dep, ''), '000'),
              base.finance_number, 0, base.use_right, '', NULL, '3', o.pttype, '00',
              '', COALESCE(NULLIF(base.staff, ''), o.staff, ''), COALESCE(NULLIF(base.paidst, ''), '02'),
              COALESCE((SELECT MAX(COALESCE(i.item_no, 0)) + 1 FROM opitemrece i WHERE i.vn = o.vn), 1),
              NOW(), 0, 0, NULL, NULL, NULL
       FROM tmp_uc_walkin_missing t
       INNER JOIN ovst o ON o.vn = t.vn
       LEFT JOIN opitemrece base ON base.hos_guid = (SELECT MIN(b.hos_guid) FROM opitemrece b WHERE b.vn = o.vn)
       WHERE NOT EXISTS (SELECT 1 FROM opitemrece existing WHERE existing.vn = o.vn AND existing.icode = ?)`,
      [icode, hospitalCode, icode]
    );
    const insertedCount = Number((insertResult as { affectedRows?: number }).affectedRows || 0);
    if (insertedCount !== expectedCount) throw new Error(`เพิ่มได้ ${insertedCount.toLocaleString('th-TH')} จากที่ยืนยัน ${expectedCount.toLocaleString('th-TH')} รายการ ระบบยกเลิกการบันทึกแล้ว`);
    await connection.commit();

    try {
      const logConnection = await getRepstmConnection();
      try {
        await logConnection.query(LOG_TABLE_SQL);
        await logConnection.query(
          `INSERT INTO uc_walkin_insert_log
             (start_date, end_date, expected_count, inserted_count, actor_user_id, actor_name, target_vns, inserted_guids)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [startDate, endDate, expectedCount, insertedCount, input.actorUserId || null, input.actorName.slice(0, 160),
            JSON.stringify(targets.map((item) => item.vn)), JSON.stringify(targets.map((item) => item.hos_guid))]
        );
      } finally {
        logConnection.release();
      }
    } catch (error) {
      console.error('Unable to write UC WALKIN audit log:', error);
    }
    return { insertedCount, startDate, endDate, item: { icode: icode, name: UC_WALKIN_NAME } };
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
};

export type WalkinAuditIssueLevel = 'critical' | 'warning' | 'info';

export type WalkinAutoFixAction =
  | 'ADD_K051'
  | 'ADD_K021'
  | 'ADD_K011'
  | 'ADD_K083'
  | 'SWAP_Z012'
  | 'REMOVE_DUP_DX'
  | 'INSERT_WALKIN'
  | 'REMOVE_ANC_PROC'
  | 'SYNC_DENTAL_PROC'
  | 'REMOVE_NUMERIC_DX'
  | 'ADD_DENTAL_EXAM';

export type WalkinAuditIssue = {
  code: string;
  level: WalkinAuditIssueLevel;
  title: string;
  detail: string;
  recommendation: string;
  category: 'dental' | 'clinical' | 'billing';
  autoFixable?: boolean;
  fixAction?: WalkinAutoFixAction;
};

export type UcWalkinClinicalAuditRow = {
  vn: string;
  hn: string;
  patient_name: string;
  sex: string;
  age_y: number;
  service_date: string;
  service_time: string;
  pttype: string;
  hospmain: string;
  department: string;
  is_dental: boolean;
  diagnoses: Array<{
    code: string;
    name?: string;
    diagtype: string;
  }>;
  procedures: Array<{
    code: string;
    name?: string;
    type?: string;
    tooth?: string;
    tmcode?: string;
    icd10tm?: string;
  }>;
  has_walkin: boolean;
  walkin_rows: number;
  total_charge: number;
  issues: WalkinAuditIssue[];
  audit_status: 'critical' | 'warning' | 'valid';
  can_auto_fix: boolean;
  auto_fix_actions: string[];
};

export type UcWalkinClinicalAuditSummary = {
  total_visits: number;
  valid_count: number;
  critical_count: number;
  warning_count: number;
  dental_total: number;
  dental_issue_count: number;
  missing_walkin_count: number;
  auto_fixable_count: number;
};

export const evaluateWalkinVisitAudit = (visit: {
  vn: string;
  hn: string;
  patient_name?: string;
  sex?: string;
  age_y?: number;
  service_date: string;
  service_time?: string;
  pttype?: string;
  hospmain?: string;
  department?: string;
  diagnoses: Array<{ code: string; name?: string; diagtype: string }>;
  procedures: Array<{ code: string; name?: string; type?: string; tooth?: string; tmcode?: string; icd10tm?: string }>;
  chargeItems?: Array<{ icode: string; name?: string; qty?: number; unitprice?: number; sum_price?: number; income?: string }>;
  has_walkin: boolean;
  walkin_rows?: number;
  total_charge?: number;
}): {
  is_dental: boolean;
  issues: WalkinAuditIssue[];
  audit_status: 'critical' | 'warning' | 'valid';
  total_charge: number;
  can_auto_fix: boolean;
  auto_fix_actions: string[];
} => {
  const issues: WalkinAuditIssue[] = [];
  const clean = (val: unknown) => String(val || '').trim().toUpperCase().replace(/[.\s-]/g, '');

  const diagnoses = visit.diagnoses || [];
  const procedures = visit.procedures || [];
  const chargeItems = visit.chargeItems || [];

  const pdxList = diagnoses.filter((d) => String(d.diagtype).trim() === '1');
  const pdx = pdxList[0]?.code ? clean(pdxList[0].code) : '';
  const secondaryDx = diagnoses.filter((d) => String(d.diagtype).trim() !== '1').map((d) => clean(d.code)).filter(Boolean);
  const allDxCodes = diagnoses.map((d) => clean(d.code)).filter(Boolean);
  const allProcCodes = procedures.map((p) => clean(p.code)).filter(Boolean);

  let totalCharge = Number(visit.total_charge || 0);
  if (!totalCharge && chargeItems.length > 0) {
    totalCharge = chargeItems.reduce((sum, item) => sum + Number(item.sum_price ?? (Number(item.qty || 0) * Number(item.unitprice || 0))), 0);
  }

  // Dental classification
  const dept = String(visit.department || '');
  const hasDentalDept = dept.includes('ทันต');
  const hasDentalProc = procedures.some((p) => {
    const c = clean(p.code);
    return (
      p.type === 'Dental' ||
      c.startsWith('23') ||
      c === '8931' ||
      c === '9654' ||
      c === '9651' ||
      ['2387010', '2277310', '2287310', '2330011', '2330010'].includes(c) ||
      String(p.name || '').includes('ฟัน') ||
      String(p.name || '').includes('ทันต') ||
      String(p.name || '').includes('ขูดหินปูน') ||
      String(p.name || '').includes('อุดฟัน') ||
      String(p.name || '').includes('ถอนฟัน')
    );
  });
  const hasDentalDx = allDxCodes.some((c) =>
    (c.startsWith('K0') && c >= 'K00' && c <= 'K089') ||
    c.startsWith('K1') ||
    c.startsWith('Z012')
  );
  const hasDentalCharge = chargeItems.some((i) =>
    i.income === '08' || i.income === '13' ||
    String(i.name || '').includes('ทันต') ||
    String(i.name || '').includes('ฟัน')
  );
  const is_dental = hasDentalDept || hasDentalProc || hasDentalDx || hasDentalCharge;

  // --- DENTAL CLINICAL RULES ---
  if (is_dental) {
    // Rule D1: ขูดหินปูน (Scaling / Prophylaxis: 9654, 9651, 2387010, 2277310, 2287310)
    const hasScalingProc = procedures.some((p) => {
      const c = clean(p.code);
      return c === '9654' || c === '9651' || c === '2387010' || c === '2277310' || c === '2287310' || String(p.name || '').includes('ขูดหินปูน');
    });
    if (hasScalingProc) {
      const hasGingivalDx = allDxCodes.some((c) => c.startsWith('K05'));
      if (!hasGingivalDx) {
        issues.push({
          code: 'C-804-SCALING',
          level: 'critical',
          title: 'ขูดหินปูน (96.54) รหัสโรคไม่สัมพันธ์กับหัตถการ',
          detail: 'พบหัตถการขูดหินปูน/ทำความสะอาดฟัน แต่ไม่มีรหัสวินิจฉัยกลุ่มโรคเหงือกอักเสบหรือปริทันต์อักเสบ (K05.0-K05.6) ทำให้เสี่ยงติด C Error 804 / 800',
          recommendation: 'เพิ่มหรือแก้ไขรหัสวินิจฉัยในระบบทันตกรรม HOSxP เป็น K05.1 (Chronic gingivitis) หรือ K05.3 (Chronic periodontitis)',
          category: 'dental',
          autoFixable: true,
          fixAction: 'ADD_K051',
        });
      }
    }

    // Rule D2: อุดฟัน (Filling / Restoration: 232x, 234x, 237x)
    const hasFillingProc = procedures.some((p) => {
      const c = clean(p.code);
      return c.startsWith('232') || c.startsWith('234') || String(p.name || '').includes('อุดฟัน');
    });
    if (hasFillingProc) {
      const hasCariesOrWearDx = allDxCodes.some((c) => c.startsWith('K02') || c.startsWith('K030') || c.startsWith('K031') || c.startsWith('K032'));
      if (!hasCariesOrWearDx) {
        issues.push({
          code: 'C-804-FILLING',
          level: 'critical',
          title: 'อุดฟัน (23.2/23.4) รหัสโรคไม่สัมพันธ์กับหัตถการ',
          detail: 'พบหัตถการอุดฟัน แต่ไม่พบรหัสวินิจฉัยโรคฟันผุ (K02) หรือฟันสึกกร่อน (K03) เสี่ยงติด C Error 804',
          recommendation: 'เพิ่มหรือแก้ไขรหัสวินิจฉัยในระบบทันตกรรม HOSxP เป็นกลุ่มฟันผุ (K02.0-K02.9) หรือฟันสึก (K03.0-K03.2)',
          category: 'dental',
          autoFixable: true,
          fixAction: 'ADD_K021',
        });
      }
    }

    // Rule D3: ผ่าฟันคุด (Impacted tooth: 2319)
    const hasImpactedProc = procedures.some((p) => clean(p.code) === '2319' || String(p.name || '').includes('ผ่าฟันคุด'));
    if (hasImpactedProc) {
      const hasImpactedDx = allDxCodes.some((c) => c.startsWith('K010') || c.startsWith('K011') || c === 'K01');
      if (!hasImpactedDx) {
        issues.push({
          code: 'C-804-IMPACTED',
          level: 'critical',
          title: 'ผ่าฟันคุด (23.19) ต้องคู่กับรหัสฟันคุด K01.1/K01.0',
          detail: 'พบหัตถการผ่าฟันคุด 23.19 แต่ไม่พบรหัสวินิจฉัย K01.0 หรือ K01.1 เสี่ยงติด C Error 804',
          recommendation: 'เพิ่มรหัสวินิจฉัย K01.1 (Impacted teeth) หรือ K01.0 ในระบบทันตกรรม HOSxP',
          category: 'dental',
          autoFixable: true,
          fixAction: 'ADD_K011',
        });
      }
    }

    // Rule D4: ถอนรากฟัน (Removal of residual root: 2311)
    const hasRootProc = procedures.some((p) => clean(p.code) === '2311' || String(p.name || '').includes('ถอนรากฟัน'));
    if (hasRootProc) {
      const hasRootDx = allDxCodes.some((c) => c.startsWith('K083') || c.startsWith('K04'));
      if (!hasRootDx) {
        issues.push({
          code: 'C-804-ROOT',
          level: 'critical',
          title: 'ถอนรากฟัน (23.11) ต้องมีรหัสรากฟันตกค้าง K08.3',
          detail: 'พบหัตถการถอนรากฟัน 23.11 แต่ไม่มีรหัสวินิจฉัย K08.3 (Retained dental root) เสี่ยงติด C Error 804',
          recommendation: 'เพิ่มรหัสวินิจฉัย K08.3 ในระบบทันตกรรม HOSxP',
          category: 'dental',
          autoFixable: true,
          fixAction: 'ADD_K083',
        });
      }
    }

    // Rule D5: ถอนฟันทั่วไป (Extraction: 2301, 2309)
    const hasExtractionProc = procedures.some((p) => {
      const c = clean(p.code);
      return c === '2301' || c === '2309' || String(p.name || '').includes('ถอนฟัน');
    });
    if (hasExtractionProc && !hasDentalDx) {
      issues.push({
        code: 'C-804-EXTRACTION',
        level: 'critical',
        title: 'ถอนฟัน แต่ไม่มีรหัสวินิจฉัยโรคช่องปากและฟัน (K00-K08)',
        detail: 'พบหัตถการถอนฟัน แต่ไม่มีรหัสวินิจฉัยฟันผุ (K02), โรคโพรงประสาทฟัน (K04) หรือโรคปริทันต์ (K05)',
        recommendation: 'บันทึกรหัสวินิจฉัยโรคฟันที่เกี่ยวข้อง เช่น K02.1 หรือ K04.0 ในระบบทันตกรรม HOSxP',
        category: 'dental',
      });
    }

    // Rule D6: ตรวจฟันแต่ทำหัตถการรักษาอื่น (Z01.2 as PDX with therapeutic procedures)
    const hasTherapeuticDentalProc = procedures.some((p) => {
      const c = clean(p.code);
      if (c === '2330010' || c === '2330011' || c === '8931') return false;
      return c.startsWith('23') || c === '9654' || c === '9651';
    });
    if (pdx.startsWith('Z012') && hasTherapeuticDentalProc) {
      issues.push({
        code: 'C-800-Z012-PDX',
        level: 'critical',
        title: 'มีการรักษาแต่ใช้รหัสตรวจฟัน Z01.2 เป็นโรคหลัก (PDX)',
        detail: 'ตามหลักเกณฑ์ e-Claim หากมีการรักษาทางทันตกรรม (เช่น อุดฟัน, ถอนฟัน, ขูดหินปูน) ห้ามใช้ Z01.2 เป็นโรคหลัก ทำให้ติด C Error 800 / A14',
        recommendation: 'เปลี่ยนโรคหลัก (PDX) เป็นรหัสโรคที่ให้การรักษา (เช่น K02.1, K05.1) และเปลี่ยน Z01.2 เป็นโรครองหรือลบออก',
        category: 'dental',
        autoFixable: true,
        fixAction: 'SWAP_Z012',
      });
    }

    // Rule D7: มีบริการทันตกรรมแต่ไม่มีรหัสหัตถการ (ICD-9) หรือมีรหัสหัตถการตัวเลขตกค้างใน ovstdiag
    const numericDxList = diagnoses.filter((d) => /^\d+$/.test(clean(d.code)));
    if ((hasDentalCharge || hasDentalDept) && allProcCodes.length === 0) {
      if (numericDxList.length > 0) {
        const numCodesStr = numericDxList.map((d) => d.code).join(', ');
        issues.push({
          code: 'C-804-MISSING-PROC',
          level: 'critical',
          title: 'มีบริการทันตกรรมแต่ไม่พบหัตถการ (พบรหัสตกค้างในช่องวินิจฉัย)',
          detail: `มีการคิดค่าบริการทันตกรรม แต่ไม่พบหัตถการใน dtmain โดยพบรหัสหัตถการ (${numCodesStr}) ตกค้างอยู่ในช่องวินิจฉัยโรค (ovstdiag) เสี่ยงติด C Error 804`,
          recommendation: `ย้ายรหัสหัตถการ (${numCodesStr}) จากช่องวินิจฉัยเข้าสู่ระบบทันตกรรม (dtmain) และลบรหัสตกค้างออกจาก ovstdiag`,
          category: 'dental',
          autoFixable: true,
          fixAction: 'SYNC_DENTAL_PROC',
        });
      } else {
        issues.push({
          code: 'C-804-MISSING-PROC',
          level: 'critical',
          title: 'มีบริการทันตกรรมแต่ไม่พบรหัสหัตถการ (ICD-9)',
          detail: 'มีการคิดค่าบริการทันตกรรม แต่ไม่มีการลงรหัสหัตถการ ICD-9 ใน dtmain หรือ doctor_operation ทำให้แฟ้มหัตถการว่าง เสี่ยงติด C Error 804',
          recommendation: 'บันทึกหัตถการตรวจสุขภาพช่องปาก (Oral examination: 2330010 / 89.31) ลงใน dtmain ให้อัตโนมัติ',
          category: 'dental',
          autoFixable: true,
          fixAction: 'ADD_DENTAL_EXAM',
        });
      }
    } else if (numericDxList.length > 0) {
      const numCodesStr = numericDxList.map((d) => d.code).join(', ');
      issues.push({
        code: 'C-804-NUMERIC-DX',
        level: 'critical',
        title: 'พบรหัสหัตถการตกค้างในช่องวินิจฉัยโรค (ovstdiag)',
        detail: `พบรหัส (${numCodesStr}) ในช่องวินิจฉัยโรค ซึ่งเป็นรหัสหัตถการไม่ใช่รหัสโรค ICD-10 ทำให้ติด C Error รูปแบบรหัสโรคไม่ถูกต้อง`,
        recommendation: `ลบรหัสหัตถการ (${numCodesStr}) ออกจาก ovstdiag เนื่องจากมีหัตถการในระบบทันตกรรมอยู่แล้ว`,
        category: 'dental',
        autoFixable: true,
        fixAction: 'REMOVE_NUMERIC_DX',
      });
    }

    // Rule D8: มีหัตถการทันตกรรมแต่ไม่มีรหัสการวินิจฉัยหมวดฟันเลย
    if (hasDentalProc && !hasDentalDx) {
      issues.push({
        code: 'C-800-NO-DENTAL-DX',
        level: 'critical',
        title: 'มีหัตถการทันตกรรมแต่ไม่พบรหัสวินิจฉัยหมวดฟัน (K00-K14)',
        detail: 'มีการทำหัตถการทันตกรรม แต่รหัสโรคในเวชระเบียนไม่มีหมวดช่องปากและฟันเลย เสี่ยงติด C Error 800',
        recommendation: 'เพิ่มรหัสการวินิจฉัยโรคฟัน (K00-K14) ในระบบทันตกรรม HOSxP',
        category: 'dental',
      });
    }

    // Rule D9: หัตถการส่งเสริมป้องกัน ANC ปะปนในบริการทันตกรรมปกติ (C-808-ANC-PROC-MIXED)
    const ancProcCodes = new Set(['2330011', '2330010', '2387010', '2277310', '2287310']);
    const hasAncProc = procedures.some((p) => {
      const c = clean(p.code);
      const tm = clean(p.tmcode);
      const icd10tm = clean(p.icd10tm);
      const name = String(p.name || '');
      return (
        ancProcCodes.has(c) ||
        ancProcCodes.has(tm) ||
        ancProcCodes.has(icd10tm) ||
        name.includes('หญิงมีครรภ์') ||
        name.includes('หญิงตั้งครรภ์') ||
        name.includes('ตรวจฟัน ANC') ||
        name.includes('ขัดฟัน ANC')
      );
    });

    const sex = String(visit.sex || '').trim().toUpperCase();
    const isMale = sex === '1' || sex === 'M' || sex === 'ชาย';
    const hasCurativeDentalProc = procedures.some((p) => {
      const c = clean(p.code);
      const name = String(p.name || '');
      if (ancProcCodes.has(c) || name.includes('หญิงมีครรภ์') || name.includes('หญิงตั้งครรภ์') || name.includes('ตรวจฟัน ANC') || name.includes('ขัดฟัน ANC')) {
        return false;
      }
      return (
        c.startsWith('230') ||
        c.startsWith('231') ||
        c.startsWith('232') ||
        c.startsWith('234') ||
        c.startsWith('237') ||
        c === '9654' ||
        c === '9651' ||
        name.includes('อุดฟัน') ||
        name.includes('ถอนฟัน') ||
        name.includes('ผ่าฟันคุด') ||
        name.includes('ขูดหินปูน') ||
        name.includes('รักษาราก')
      );
    });
    const hasPregnancyDx = allDxCodes.some((c) => c.startsWith('Z34') || c.startsWith('Z35') || c.startsWith('Z39'));

    if (hasAncProc && (isMale || hasCurativeDentalProc || !hasPregnancyDx)) {
      issues.push({
        code: 'C-808-ANC-PROC-MIXED',
        level: 'critical',
        title: 'พบหัตถการส่งเสริมป้องกัน ANC ปะปนในบริการทันตกรรมปกติ',
        detail: 'ตรวจพบหัตถการตรวจสุขภาพช่องปาก/ขัดฟันหญิงตั้งครรภ์ (ANC) ปะปนใน Visit การรักษาทันตกรรมปกติ หรือผู้ป่วยไม่ใช่กลุ่มเป้าหมาย ANC ทำให้เสี่ยงติด C Error หรือถูกปฏิเสธชดเชย',
        recommendation: 'ลบหัตถการส่งเสริมป้องกัน ANC ออกจาก dtmain ให้เหลือเฉพาะหัตถการรักษาจริง',
        category: 'dental',
        autoFixable: true,
        fixAction: 'REMOVE_ANC_PROC',
      });
    }
  }

  // --- GENERAL CLINICAL & WALKIN RULES ---

  // Rule G1: ขาดรหัสการวินิจฉัยโรคหลัก (PDX)
  if (!pdx) {
    issues.push({
      code: 'C-MISSING-PDX',
      level: 'critical',
      title: 'ขาดรหัสการวินิจฉัยโรคหลัก (PDX)',
      detail: 'ไม่พบรหัสโรคหลัก (diagtype=1) ในเวชระเบียน ทำให้ไม่สามารถส่งเบิก e-Claim ได้',
      recommendation: 'กำหนดรหัสโรคหลัก (diagtype=1) ในหน้าเวชระเบียน OPD HOSxP',
      category: 'clinical',
    });
  }

  // Rule G2: ใช้รหัสสาเหตุภายนอก (V-Y) เป็นโรคหลัก (PDX)
  if (pdx && /^[VWXY]/.test(pdx)) {
    issues.push({
      code: 'C-801-EXTERNAL-PDX',
      level: 'critical',
      title: 'ห้ามใช้รหัสสาเหตุภายนอก (V-Y) เป็นโรคหลัก (PDX)',
      detail: 'รหัสสาเหตุภายนอก (V01-Y98) ใช้เป็นโรคหลักไม่ได้ ต้องใช้รหัสการบาดเจ็บ (หมวด S หรือ T) เป็น PDX เสี่ยงติด C Error 800/801',
      recommendation: 'เปลี่ยนโรคหลัก (PDX) เป็นรหัสการบาดเจ็บ (หมวด S หรือ T) และใส่รหัสสาเหตุภายนอกเป็น diagtype=5',
      category: 'clinical',
    });
  }

  // Rule G3: รหัสโรครองซ้ำกับโรคหลัก (C-803)
  if (pdx && secondaryDx.includes(pdx)) {
    issues.push({
      code: 'C-803-DUPLICATE-DX',
      level: 'critical',
      title: 'รหัสการวินิจฉัยอื่นซ้ำกับโรคหลัก (C-803)',
      detail: `พบรหัสโรครองซ้ำกับโรคหลัก (${pdx}) ระบบ e-Claim จะปฏิเสธการจ่ายด้วย C-803`,
      recommendation: 'ลบรหัสโรคที่ซ้ำกับโรคหลักออกจาก ovstdiag ใน HOSxP',
      category: 'clinical',
      autoFixable: true,
      fixAction: 'REMOVE_DUP_DX',
    });
  }

  // Rule G4: หัตถการไม่สัมพันธ์กับเพศ (C-806)
  const sex = String(visit.sex || '').trim().toUpperCase();
  const isMale = sex === '1' || sex === 'M' || sex === 'ชาย';
  const isFemale = sex === '2' || sex === 'F' || sex === 'หญิง';
  if (isMale) {
    const hasGynProc = procedures.some((p) => {
      const c = clean(p.code);
      const prefix = parseInt(c.slice(0, 2), 10);
      return prefix >= 65 && prefix <= 75;
    });
    if (hasGynProc) {
      issues.push({
        code: 'C-806-SEX-MISMATCH',
        level: 'critical',
        title: 'รหัสหัตถการไม่สอดคล้องกับเพศผู้ป่วย (C-806)',
        detail: 'ผู้ป่วยเพศชายแต่มีรหัสหัตถการทางสูตินรีเวช เสี่ยงติด C Error 806',
        recommendation: 'ตรวจสอบเพศและรหัสหัตถการใน HOSxP ให้ถูกต้อง',
        category: 'clinical',
      });
    }
  } else if (isFemale) {
    const hasMaleProc = procedures.some((p) => {
      const c = clean(p.code);
      const prefix = parseInt(c.slice(0, 2), 10);
      return prefix >= 60 && prefix <= 64;
    });
    if (hasMaleProc) {
      issues.push({
        code: 'C-806-SEX-MISMATCH',
        level: 'critical',
        title: 'รหัสหัตถการไม่สอดคล้องกับเพศผู้ป่วย (C-806)',
        detail: 'ผู้ป่วยเพศหญิงแต่มีรหัสหัตถการของอวัยวะสืบพันธุ์ชาย เสี่ยงติด C Error 806',
        recommendation: 'ตรวจสอบเพศและรหัสหัตถการใน HOSxP ให้ถูกต้อง',
        category: 'clinical',
      });
    }
  }

  // Rule G5: ขาดรหัสบริการ WALKIN (icode)
  if (!visit.has_walkin) {
    issues.push({
      code: 'WRN-MISSING-WALKIN',
      level: 'warning',
      title: 'ยังไม่มีรายการค่าบริการ WALKIN ในใบสั่งยา',
      detail: 'วิสิตนี้เป็นสิทธิ UC นอก CUP แต่ยังไม่มีรหัสค่าบริการ WALKIN ทำให้ไม่สามารถส่งออกเป็นกองทุนผู้ป่วยนอกเหตุสมควร ทั่วประเทศ ได้',
      recommendation: 'กดปุ่มเพิ่ม WALKIN ในแท็บกระทบยอด หรือเพิ่มรายการในใบสั่งยา HOSxP',
      category: 'billing',
      autoFixable: true,
      fixAction: 'INSERT_WALKIN',
    });
  }

  // Rule G6: ไม่มีรายการค่าใช้จ่ายหรือยอดรวมเป็น 0
  if (totalCharge <= 0 && (!chargeItems.length || chargeItems.every((i) => Number(i.sum_price || 0) <= 0))) {
    issues.push({
      code: 'WRN-NO-CHARGES',
      level: 'warning',
      title: 'ไม่พบรายการค่าบริการหรือยอดเงินรวมเป็น 0',
      detail: 'ไม่พบรายการยาหรือค่าบริการในใบสั่งยา หรือยอดรวมเป็น 0 บาท',
      recommendation: 'ตรวจสอบการลงรายการยาและค่าบริการใน HOSxP',
      category: 'billing',
    });
  }

  // Deduplicate issues by code
  const uniqueIssues: WalkinAuditIssue[] = [];
  const seenCodes = new Set<string>();
  for (const issue of issues) {
    if (!seenCodes.has(issue.code)) {
      seenCodes.add(issue.code);
      uniqueIssues.push(issue);
    }
  }

  const hasCritical = uniqueIssues.some((i) => i.level === 'critical');
  const hasWarning = uniqueIssues.some((i) => i.level === 'warning');
  const audit_status: 'critical' | 'warning' | 'valid' = hasCritical ? 'critical' : hasWarning ? 'warning' : 'valid';

  const autoFixableIssues = uniqueIssues.filter((i) => i.autoFixable);
  const can_auto_fix = autoFixableIssues.length > 0;
  const auto_fix_actions = autoFixableIssues.map((i) => i.fixAction as string).filter(Boolean);

  return {
    is_dental,
    issues: uniqueIssues,
    audit_status,
    total_charge: totalCharge,
    can_auto_fix,
    auto_fix_actions,
  };
};

export const getUcOutsideCupClinicalAudit = async (input: {
  startDate?: string;
  endDate?: string;
  serviceCategory?: 'ALL' | 'DENTAL' | 'GENERAL';
  auditStatus?: 'ALL' | 'CRITICAL' | 'WARNING' | 'VALID';
  search?: string;
  page?: number;
  pageSize?: number;
}) => {
  const { startDate, endDate } = validateUcWalkinRange(input.startDate, input.endDate);
  const { pttypes, icode } = parseSiteWalkinSettings(await getAppSetting('site_settings'));
  const page = Math.max(1, Math.trunc(Number(input.page || 1)));
  const pageSize = Math.max(10, Math.min(200, Math.trunc(Number(input.pageSize || 50))));
  const offset = (page - 1) * pageSize;
  const connection = await getUTFConnection();

  try {
    const whereConditions: string[] = [
      'o.vstdate BETWEEN ? AND ?',
      `o.pttype IN (${pttypes.map(() => '?').join(',')})`,
      "IFNULL(o.an, '') = ''",
    ];
    const whereParams: unknown[] = [startDate, endDate, ...pttypes];

    if (input.search && input.search.trim()) {
      const q = `%${input.search.trim()}%`;
      whereConditions.push('(o.vn LIKE ? OR o.hn LIKE ? OR p.fname LIKE ? OR p.lname LIKE ?)');
      whereParams.push(q, q, q, q);
    }

    if (input.serviceCategory === 'DENTAL') {
      whereConditions.push(`(
        o.main_dep IN (SELECT depcode FROM kskdepartment WHERE department LIKE '%ทันต%')
        OR EXISTS (SELECT 1 FROM dtmain dm WHERE dm.vn = o.vn)
        OR EXISTS (SELECT 1 FROM ovstdiag dx WHERE dx.vn = o.vn AND (dx.icd10 LIKE 'K0%' OR dx.icd10 LIKE 'K1%' OR dx.icd10 = 'Z012'))
        OR EXISTS (SELECT 1 FROM opitemrece oi WHERE oi.vn = o.vn AND oi.income IN ('08', '13'))
      )`);
    } else if (input.serviceCategory === 'GENERAL') {
      whereConditions.push(`NOT (
        o.main_dep IN (SELECT depcode FROM kskdepartment WHERE department LIKE '%ทันต%')
        OR EXISTS (SELECT 1 FROM dtmain dm WHERE dm.vn = o.vn)
        OR EXISTS (SELECT 1 FROM ovstdiag dx WHERE dx.vn = o.vn AND (dx.icd10 LIKE 'K0%' OR dx.icd10 LIKE 'K1%' OR dx.icd10 = 'Z012'))
        OR EXISTS (SELECT 1 FROM opitemrece oi WHERE oi.vn = o.vn AND oi.income IN ('08', '13'))
      )`);
    }

    const whereClause = whereConditions.join(' AND ');

    const [countRows] = await connection.query(
      `SELECT COUNT(*) AS total_count
       FROM ovst o
       LEFT JOIN patient p ON p.hn = o.hn
       LEFT JOIN kskdepartment k ON k.depcode = o.main_dep
       WHERE ${whereClause}`,
      whereParams
    );
    const dbTotalVisits = Number((Array.isArray(countRows) ? countRows[0] : null) && ((countRows as Array<{ total_count?: unknown }>)[0]?.total_count || 0));

    const [allVisitRows] = await connection.query(
      `SELECT o.vn, o.hn, DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
              TIME_FORMAT(o.vsttime, '%H:%i:%s') AS service_time, o.pttype,
              COALESCE(o.hospmain, '') AS hospmain,
              COALESCE(CONCAT(p.pname, p.fname, ' ', p.lname), '') AS patient_name,
              COALESCE(p.sex, '') AS sex,
              COALESCE(TIMESTAMPDIFF(YEAR, p.birthday, o.vstdate), 0) AS age_y,
              COALESCE(k.department, o.main_dep, '') AS department
       FROM ovst o
       LEFT JOIN patient p ON p.hn = o.hn
       LEFT JOIN kskdepartment k ON k.depcode = o.main_dep
       WHERE ${whereClause}
       ORDER BY o.vstdate DESC, o.vsttime DESC
       LIMIT 10000`,
      whereParams
    );

    const visits = (Array.isArray(allVisitRows) ? allVisitRows : []) as Array<Record<string, unknown>>;
    if (visits.length === 0) {
      return {
        summary: {
          total_visits: dbTotalVisits,
          valid_count: 0,
          critical_count: 0,
          warning_count: 0,
          dental_total: 0,
          dental_issue_count: 0,
          missing_walkin_count: 0,
          auto_fixable_count: 0,
        },
        data: [],
        total: 0,
        page,
        pageSize,
      };
    }

    const vns = visits.map((v) => String(v.vn || ''));

    const [diagRows] = await connection.query(
      `SELECT d.vn, d.icd10, COALESCE(d.diagtype, '4') AS diagtype, COALESCE(i.name, '') AS name
       FROM ovstdiag d
       LEFT JOIN icd101 i ON i.code = d.icd10
       WHERE d.vn IN (${vns.map(() => '?').join(',')})
       ORDER BY d.vn, d.diagtype`,
      vns
    );

    const [doctorOperRows] = await connection.query(
      `SELECT dop.vn, dop.icd9 AS code, COALESCE(i.name, '') AS name, 'Doctor' AS type
       FROM doctor_operation dop
       LEFT JOIN icd9cm1 i ON REPLACE(i.code, '.', '') = REPLACE(dop.icd9, '.', '')
       WHERE dop.vn IN (${vns.map(() => '?').join(',')})`,
      vns
    );

    const [dentalOperRows] = await connection.query(
      `SELECT dm.vn,
              COALESCE(NULLIF(dm.icd9, ''), NULLIF(tm.icd10tm_operation_code, ''), NULLIF(tm.icd9cm, ''), dm.tmcode, '') AS code,
              COALESCE(tm.name, 'หัตถการทันตกรรม') AS name,
              'Dental' AS type,
              COALESCE(dm.tmcode, '') AS tmcode,
              COALESCE(tm.icd10tm_operation_code, '') AS icd10tm
       FROM dtmain dm
       LEFT JOIN dttm tm ON tm.code = dm.tmcode
       WHERE dm.vn IN (${vns.map(() => '?').join(',')})`,
      vns
    );

    const [chargeRows] = await connection.query(
      `SELECT opi.vn, opi.icode, opi.qty, opi.unitprice, opi.sum_price, opi.income,
              COALESCE(sd.name, '') AS name
       FROM opitemrece opi
       LEFT JOIN s_drugitems sd ON sd.icode = opi.icode
       WHERE opi.vn IN (${vns.map(() => '?').join(',')})`,
      vns
    );

    const diagsByVn = new Map<string, Array<{ code: string; name?: string; diagtype: string }>>();
    for (const raw of (Array.isArray(diagRows) ? diagRows : []) as Array<Record<string, unknown>>) {
      const vn = String(raw.vn || '');
      const list = diagsByVn.get(vn) || [];
      list.push({ code: String(raw.icd10 || ''), name: String(raw.name || ''), diagtype: String(raw.diagtype || '4') });
      diagsByVn.set(vn, list);
    }

    const procsByVn = new Map<string, Array<{ code: string; name?: string; type?: string; tmcode?: string; icd10tm?: string }>>();
    for (const raw of (Array.isArray(doctorOperRows) ? doctorOperRows : []) as Array<Record<string, unknown>>) {
      const vn = String(raw.vn || '');
      const list = procsByVn.get(vn) || [];
      list.push({ code: String(raw.code || ''), name: String(raw.name || ''), type: 'Doctor' });
      procsByVn.set(vn, list);
    }
    for (const raw of (Array.isArray(dentalOperRows) ? dentalOperRows : []) as Array<Record<string, unknown>>) {
      const vn = String(raw.vn || '');
      const list = procsByVn.get(vn) || [];
      list.push({
        code: String(raw.code || ''),
        name: String(raw.name || ''),
        type: 'Dental',
        tmcode: String(raw.tmcode || ''),
        icd10tm: String(raw.icd10tm || ''),
      });
      procsByVn.set(vn, list);
    }

    const chargesByVn = new Map<string, Array<{ icode: string; name?: string; qty: number; unitprice: number; sum_price: number; income?: string }>>();
    const walkinCountByVn = new Map<string, number>();
    for (const raw of (Array.isArray(chargeRows) ? chargeRows : []) as Array<Record<string, unknown>>) {
      const vn = String(raw.vn || '');
      const itemIcode = String(raw.icode || '');
      if (itemIcode === icode) {
        walkinCountByVn.set(vn, (walkinCountByVn.get(vn) || 0) + 1);
      }
      const list = chargesByVn.get(vn) || [];
      list.push({
        icode: itemIcode,
        name: String(raw.name || ''),
        qty: Number(raw.qty || 0),
        unitprice: Number(raw.unitprice || 0),
        sum_price: Number(raw.sum_price || 0),
        income: String(raw.income || ''),
      });
      chargesByVn.set(vn, list);
    }

    const evaluatedRows: UcWalkinClinicalAuditRow[] = [];
    let validCount = 0;
    let criticalCount = 0;
    let warningCount = 0;
    let dentalTotal = 0;
    let dentalIssueCount = 0;
    let missingWalkinCount = 0;
    let autoFixableCount = 0;

    for (const v of visits) {
      const vn = String(v.vn || '');
      const walkinRows = walkinCountByVn.get(vn) || 0;
      const charges = chargesByVn.get(vn) || [];
      const evaluation = evaluateWalkinVisitAudit({
        vn,
        hn: String(v.hn || ''),
        patient_name: String(v.patient_name || ''),
        sex: String(v.sex || ''),
        age_y: Number(v.age_y || 0),
        service_date: String(v.service_date || ''),
        service_time: String(v.service_time || ''),
        pttype: String(v.pttype || ''),
        hospmain: String(v.hospmain || ''),
        department: String(v.department || ''),
        diagnoses: diagsByVn.get(vn) || [],
        procedures: procsByVn.get(vn) || [],
        chargeItems: charges,
        has_walkin: walkinRows > 0,
        walkin_rows: walkinRows,
      });

      if (evaluation.audit_status === 'critical') criticalCount++;
      else if (evaluation.audit_status === 'warning') warningCount++;
      else validCount++;

      if (evaluation.is_dental) {
        dentalTotal++;
        if (evaluation.audit_status !== 'valid') dentalIssueCount++;
      }

      if (walkinRows === 0) missingWalkinCount++;
      if (evaluation.can_auto_fix) autoFixableCount++;

      if (input.auditStatus === 'CRITICAL' && evaluation.audit_status !== 'critical') continue;
      if (input.auditStatus === 'WARNING' && evaluation.audit_status !== 'warning') continue;
      if (input.auditStatus === 'VALID' && evaluation.audit_status !== 'valid') continue;

      evaluatedRows.push({
        vn,
        hn: String(v.hn || ''),
        patient_name: String(v.patient_name || ''),
        sex: String(v.sex || ''),
        age_y: Number(v.age_y || 0),
        service_date: String(v.service_date || ''),
        service_time: String(v.service_time || ''),
        pttype: String(v.pttype || ''),
        hospmain: String(v.hospmain || ''),
        department: String(v.department || ''),
        is_dental: evaluation.is_dental,
        diagnoses: diagsByVn.get(vn) || [],
        procedures: procsByVn.get(vn) || [],
        has_walkin: walkinRows > 0,
        walkin_rows: walkinRows,
        total_charge: evaluation.total_charge,
        issues: evaluation.issues,
        audit_status: evaluation.audit_status,
        can_auto_fix: evaluation.can_auto_fix,
        auto_fix_actions: evaluation.auto_fix_actions,
      });
    }

    const total = evaluatedRows.length;
    const paginatedData = evaluatedRows.slice(offset, offset + pageSize);

    return {
      summary: {
        total_visits: dbTotalVisits || visits.length,
        valid_count: validCount,
        critical_count: criticalCount,
        warning_count: warningCount,
        dental_total: dentalTotal,
        dental_issue_count: dentalIssueCount,
        missing_walkin_count: missingWalkinCount,
        auto_fixable_count: autoFixableCount,
      } satisfies UcWalkinClinicalAuditSummary,
      data: paginatedData,
      total,
      page,
      pageSize,
    };
  } finally {
    connection.release();
  }
};

export const CLINICAL_FIX_LOG_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS uc_walkin_clinical_fix_log (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    vn VARCHAR(25) NOT NULL,
    hn VARCHAR(15) NOT NULL,
    actor_user_id BIGINT NULL,
    actor_name VARCHAR(160) NOT NULL,
    actions_json LONGTEXT NOT NULL,
    result_status VARCHAR(20) NOT NULL,
    error_message TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_uc_walkin_fix_vn (vn),
    INDEX idx_uc_walkin_fix_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

export const logWalkinClinicalFix = async (data: {
  vn: string;
  hn: string;
  actorUserId: number | null;
  actorName: string;
  actions: string[];
  resultStatus: 'SUCCESS' | 'FAILED';
  errorMessage: string | null;
}) => {
  try {
    const logConnection = await getRepstmConnection();
    try {
      await logConnection.query(CLINICAL_FIX_LOG_TABLE_SQL);
      await logConnection.query(
        `INSERT INTO uc_walkin_clinical_fix_log
           (vn, hn, actor_user_id, actor_name, actions_json, result_status, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          data.vn,
          data.hn,
          data.actorUserId,
          data.actorName.slice(0, 160),
          JSON.stringify(data.actions),
          data.resultStatus,
          data.errorMessage,
        ]
      );
    } finally {
      logConnection.release();
    }
  } catch (error) {
    console.error('Unable to write UC WALKIN clinical fix log:', error);
  }
};

export const getNextOvstDiagId = async (connection: HospitalConnection): Promise<number | null> => {
  try {
    const [rows] = await connection.query('SELECT Get_SerialNumber(?) AS id', ['ovst_diag_id']);
    const id = Number((rows as Array<{ id?: unknown }>)[0]?.id);
    if (Number.isFinite(id) && id > 0) return id;
  } catch {
    // fallback to MAX + 1
  }
  try {
    const [rows] = await connection.query('SELECT COALESCE(MAX(ovst_diag_id), 0) + 1 AS id FROM ovstdiag');
    const id = Number((rows as Array<{ id?: unknown }>)[0]?.id);
    if (Number.isFinite(id) && id > 0) return id;
  } catch {
    // fallback
  }
  return null;
};

export const fixWalkinClinicalVisit = async (
  connection: HospitalConnection,
  vn: string,
  _actor?: { id?: number | string | null; name?: string }
): Promise<{ success: boolean; vn: string; hn: string; actions: string[]; message: string }> => {
  const [visitRows] = await connection.query(
    `SELECT o.vn, o.hn, DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
            TIME_FORMAT(o.vsttime, '%H:%i:%s') AS service_time, o.pttype,
            COALESCE(o.hospmain, '') AS hospmain,
            COALESCE(CONCAT(p.pname, p.fname, ' ', p.lname), '') AS patient_name,
            COALESCE(p.sex, '') AS sex,
            COALESCE(TIMESTAMPDIFF(YEAR, p.birthday, o.vstdate), 0) AS age_y,
            COALESCE(k.department, o.main_dep, '') AS department
     FROM ovst o
     LEFT JOIN patient p ON p.hn = o.hn
     LEFT JOIN kskdepartment k ON k.depcode = o.main_dep
     WHERE o.vn = ?
     LIMIT 1`,
    [vn]
  );
  const visits = (Array.isArray(visitRows) ? visitRows : []) as Array<Record<string, unknown>>;
  if (!visits.length) {
    return { success: false, vn, hn: '', actions: [], message: `ไม่พบข้อมูล Visit ${vn}` };
  }
  const visit = visits[0];
  const hn = String(visit.hn || '');

  const [diagRows] = await connection.query(
    `SELECT d.vn, d.icd10, COALESCE(d.diagtype, '4') AS diagtype, COALESCE(i.name, '') AS name
     FROM ovstdiag d
     LEFT JOIN icd101 i ON i.code = d.icd10
     WHERE d.vn = ?
     ORDER BY d.diagtype`,
    [vn]
  );

  const [doctorOperRows] = await connection.query(
    `SELECT dop.vn, dop.icd9 AS code, COALESCE(i.name, '') AS name, 'Doctor' AS type
     FROM doctor_operation dop
     LEFT JOIN icd9cm1 i ON REPLACE(i.code, '.', '') = REPLACE(dop.icd9, '.', '')
     WHERE dop.vn = ?`,
    [vn]
  );

  const [dentalOperRows] = await connection.query(
    `SELECT dm.vn,
            COALESCE(NULLIF(dm.icd9, ''), NULLIF(tm.icd10tm_operation_code, ''), NULLIF(tm.icd9cm, ''), dm.tmcode, '') AS code,
            COALESCE(tm.name, 'หัตถการทันตกรรม') AS name,
            'Dental' AS type,
            COALESCE(dm.tmcode, '') AS tmcode,
            COALESCE(tm.icd10tm_operation_code, '') AS icd10tm
     FROM dtmain dm
     LEFT JOIN dttm tm ON tm.code = dm.tmcode
     WHERE dm.vn = ?`,
    [vn]
  );

  const { icode } = parseSiteWalkinSettings(await getAppSetting('site_settings'));

  const [chargeRows] = await connection.query(
    `SELECT opi.vn, opi.icode, opi.qty, opi.unitprice, opi.sum_price, opi.income,
            COALESCE(sd.name, '') AS name
     FROM opitemrece opi
     LEFT JOIN s_drugitems sd ON sd.icode = opi.icode
     WHERE opi.vn = ?`,
    [vn]
  );

  const diags = ((Array.isArray(diagRows) ? diagRows : []) as Array<Record<string, unknown>>).map((d) => ({
    code: String(d.icd10 || ''),
    name: String(d.name || ''),
    diagtype: String(d.diagtype || '4'),
  }));

  const procs = [
    ...((Array.isArray(doctorOperRows) ? doctorOperRows : []) as Array<Record<string, unknown>>).map((p) => ({
      code: String(p.code || ''),
      name: String(p.name || ''),
      type: 'Doctor',
    })),
    ...((Array.isArray(dentalOperRows) ? dentalOperRows : []) as Array<Record<string, unknown>>).map((p) => ({
      code: String(p.code || ''),
      name: String(p.name || ''),
      type: 'Dental',
      tmcode: String(p.tmcode || ''),
      icd10tm: String(p.icd10tm || ''),
    })),
  ];

  const charges = ((Array.isArray(chargeRows) ? chargeRows : []) as Array<Record<string, unknown>>).map((c) => ({
    icode: String(c.icode || ''),
    name: String(c.name || ''),
    qty: Number(c.qty || 0),
    unitprice: Number(c.unitprice || 0),
    sum_price: Number(c.sum_price || 0),
    income: String(c.income || ''),
  }));

  const walkinRows = charges.filter((c) => c.icode === icode).length;

  const evaluation = evaluateWalkinVisitAudit({
    vn,
    hn,
    patient_name: String(visit.patient_name || ''),
    sex: String(visit.sex || ''),
    age_y: Number(visit.age_y || 0),
    service_date: String(visit.service_date || ''),
    service_time: String(visit.service_time || ''),
    pttype: String(visit.pttype || ''),
    hospmain: String(visit.hospmain || ''),
    department: String(visit.department || ''),
    diagnoses: diags,
    procedures: procs,
    chargeItems: charges,
    has_walkin: walkinRows > 0,
    walkin_rows: walkinRows,
  });

  if (!evaluation.can_auto_fix || evaluation.auto_fix_actions.length === 0) {
    return { success: false, vn, hn, actions: [], message: 'ไม่มีรายการที่สามารถแก้ไขอัตโนมัติได้สำหรับ Visit นี้' };
  }

  const executedActions: string[] = [];
  const hospitalCode = (await readHospitalIdentity(connection)).hospital_code || '00000';

  const getCanonicalIcd10 = async (targetCode: string): Promise<string> => {
    try {
      const cleanTarget = targetCode.replace(/[.\s-]/g, '').toUpperCase();
      const [rows] = await connection.query('SELECT code FROM icd101 WHERE REPLACE(code, \'.\', \'\') = ? LIMIT 1', [cleanTarget]);
      const matched = (rows as Array<{ code?: string }>)[0]?.code;
      if (matched) return matched;
    } catch {
      // fallback
    }
    return targetCode;
  };

  const insertOvstDiag = async (targetCode: string, diagtype: '1' | '2'): Promise<boolean> => {
    const canonical = await getCanonicalIcd10(targetCode);
    const cleanTarget = canonical.replace(/[.\s-]/g, '').toUpperCase();
    const nextId = await getNextOvstDiagId(connection);

    if (nextId != null) {
      const [insertRes] = await connection.query(
        `INSERT IGNORE INTO ovstdiag
           (ovst_diag_id, vn, icd10, hn, vstdate, vsttime, diagtype, icd103, hcode, doctor, hos_guid, dx_guid, update_datetime)
         SELECT
           ?, o.vn, ?, o.hn, o.vstdate, o.vsttime, ?, LEFT(?, 3),
           COALESCE((SELECT NULLIF(hcode, '') FROM ovstdiag WHERE vn = o.vn LIMIT 1), ?),
           COALESCE((SELECT NULLIF(doctor, '') FROM ovstdiag WHERE vn = o.vn LIMIT 1), NULLIF(o.doctor, '')),
           UPPER(CONCAT('{', UUID(), '}')), UPPER(CONCAT('{', UUID(), '}')), NOW()
         FROM ovst o
         WHERE o.vn = ?
           AND NOT EXISTS (SELECT 1 FROM ovstdiag d WHERE d.vn = o.vn AND REPLACE(UPPER(d.icd10), '.', '') = ?)`,
        [nextId, canonical, diagtype, cleanTarget, hospitalCode, vn, cleanTarget]
      );
      return Number((insertRes as { affectedRows?: number }).affectedRows || 0) > 0;
    } else {
      const [insertRes] = await connection.query(
        `INSERT IGNORE INTO ovstdiag
           (ovst_diag_id, vn, icd10, hn, vstdate, vsttime, diagtype, icd103, hcode, doctor, hos_guid, dx_guid, update_datetime)
         SELECT
           Get_SerialNumber('ovst_diag_id'), o.vn, ?, o.hn, o.vstdate, o.vsttime, ?, LEFT(?, 3),
           COALESCE((SELECT NULLIF(hcode, '') FROM ovstdiag WHERE vn = o.vn LIMIT 1), ?),
           COALESCE((SELECT NULLIF(doctor, '') FROM ovstdiag WHERE vn = o.vn LIMIT 1), NULLIF(o.doctor, '')),
           UPPER(CONCAT('{', UUID(), '}')), UPPER(CONCAT('{', UUID(), '}')), NOW()
         FROM ovst o
         WHERE o.vn = ?
           AND NOT EXISTS (SELECT 1 FROM ovstdiag d WHERE d.vn = o.vn AND REPLACE(UPPER(d.icd10), '.', '') = ?)`,
        [canonical, diagtype, cleanTarget, hospitalCode, vn, cleanTarget]
      );
      return Number((insertRes as { affectedRows?: number }).affectedRows || 0) > 0;
    }
  };

  for (const action of evaluation.auto_fix_actions) {
    if (action === 'ADD_K051') {
      const ok = await insertOvstDiag('K05.1', '2');
      if (ok) executedActions.push('เพิ่มรหัสโรค K05.1 (เหงือกอักเสบ)');
    } else if (action === 'ADD_K021') {
      const ok = await insertOvstDiag('K02.1', '2');
      if (ok) executedActions.push('เพิ่มรหัสโรค K02.1 (ฟันผุลึกถึงเนื้อฟัน)');
    } else if (action === 'ADD_K011') {
      const ok = await insertOvstDiag('K01.1', '2');
      if (ok) executedActions.push('เพิ่มรหัสโรค K01.1 (ฟันคุด)');
    } else if (action === 'ADD_K083') {
      const ok = await insertOvstDiag('K08.3', '2');
      if (ok) executedActions.push('เพิ่มรหัสโรค K08.3 (รากฟันตกค้าง)');
    } else if (action === 'SWAP_Z012') {
      await connection.query(
        `UPDATE ovstdiag
         SET diagtype = '2', update_datetime = NOW()
         WHERE vn = ? AND REPLACE(UPPER(icd10), '.', '') = 'Z012' AND diagtype = '1'`,
        [vn]
      );

      const [existingDentalDx] = await connection.query(
        `SELECT icd10 FROM ovstdiag
         WHERE vn = ? AND (icd10 LIKE 'K0%' OR icd10 LIKE 'K1%') AND diagtype <> '1'
         ORDER BY (icd10 LIKE 'K05%') DESC, (icd10 LIKE 'K02%') DESC
         LIMIT 1`,
        [vn]
      );

      const targetDentalDxRow = (Array.isArray(existingDentalDx) ? existingDentalDx[0] : null) as { icd10?: string } | null;
      let promotedCode = '';

      if (targetDentalDxRow?.icd10) {
        promotedCode = String(targetDentalDxRow.icd10);
        await connection.query(
          `UPDATE ovstdiag
           SET diagtype = '1', update_datetime = NOW()
           WHERE vn = ? AND icd10 = ?
           LIMIT 1`,
          [vn, promotedCode]
        );
      } else {
        const cleanProcs = procs.map((p) => p.code.replace(/[.\s-]/g, '').toUpperCase());
        if (cleanProcs.some((c) => c.startsWith('232') || c.startsWith('234'))) {
          promotedCode = await getCanonicalIcd10('K02.1');
        } else {
          promotedCode = await getCanonicalIcd10('K05.1');
        }
        await insertOvstDiag(promotedCode, '1');
      }

      await connection.query('UPDATE vn_stat SET pdx = ? WHERE vn = ?', [promotedCode, vn]).catch(() => {});
      executedActions.push(`สลับ Z01.2 เป็นโรครอง และเปลี่ยนโรคหลักเป็น ${promotedCode}`);
    } else if (action === 'REMOVE_DUP_DX') {
      const pdxList = diags.filter((d) => String(d.diagtype).trim() === '1');
      const pdxClean = pdxList[0]?.code ? pdxList[0].code.replace(/[.\s-]/g, '').toUpperCase() : '';
      if (pdxClean) {
        const [delRes] = await connection.query(
          `DELETE FROM ovstdiag
           WHERE vn = ? AND diagtype <> '1' AND REPLACE(UPPER(icd10), '.', '') = ?`,
          [vn, pdxClean]
        );
        const delCount = Number((delRes as { affectedRows?: number }).affectedRows || 0);
        if (delCount > 0) executedActions.push(`ลบรหัสโรครองซ้ำกับโรคหลัก (${pdxList[0].code}) จำนวน ${delCount} แถว`);
      }
    } else if (action === 'INSERT_WALKIN') {
      const [insertRes] = await connection.query(
        `INSERT INTO opitemrece (
           hos_guid, vn, hn, an, icode, qty, drugusage, idr, iperday, iperdose, unitprice,
           vstdate, vsttime, doctor, rxdate, rxtime, sp_use, hcode, print, dep_code,
           finance_number, discount, use_right, node_id, order_no, sub_type, pttype, income,
           item_type, staff, paidst, item_no, last_modified, sum_price, cost,
           stock_department_id, command_doctor, opi_doctor_finance_type_id
         )
         SELECT UPPER(CONCAT('{', UUID(), '}')), o.vn, o.hn, NULL, ?, 1, '', 'N/A', 0, 0, 0,
                o.vstdate, o.vsttime, COALESCE(NULLIF(base.doctor, ''), o.doctor, ''),
                o.vstdate, o.vsttime, '', ?, 'N',
                COALESCE(NULLIF(base.dep_code, ''), NULLIF(o.main_dep, ''), '000'),
                base.finance_number, 0, base.use_right, '', NULL, '3', o.pttype, '00',
                '', COALESCE(NULLIF(base.staff, ''), o.staff, ''), COALESCE(NULLIF(base.paidst, ''), '02'),
                COALESCE((SELECT MAX(COALESCE(i.item_no, 0)) + 1 FROM opitemrece i WHERE i.vn = o.vn), 1),
                NOW(), 0, 0, NULL, NULL, NULL
         FROM ovst o
         LEFT JOIN opitemrece base ON base.hos_guid = (SELECT MIN(b.hos_guid) FROM opitemrece b WHERE b.vn = o.vn)
         WHERE o.vn = ?
           AND NOT EXISTS (SELECT 1 FROM opitemrece existing WHERE existing.vn = o.vn AND existing.icode = ?)`,
        [icode, hospitalCode, vn, icode]
      );
      const inserted = Number((insertRes as { affectedRows?: number }).affectedRows || 0);
      if (inserted > 0) executedActions.push(`เพิ่มรายการค่าบริการ WALKIN (${icode}) ราคา 0 บาท`);
    } else if (action === 'REMOVE_ANC_PROC') {
      const [ancRows] = await connection.query(
        `SELECT dm.tmcode, COALESCE(tm.name, '') AS name
         FROM dtmain dm
         LEFT JOIN dttm tm ON tm.code = dm.tmcode
         WHERE dm.vn = ?
           AND (
             COALESCE(tm.icd10tm_operation_code, '') IN ('2330011', '2330010', '2387010', '2277310', '2287310')
             OR dm.tmcode IN ('2330011', '2330010', '2387010', '2277310', '2287310')
             OR COALESCE(dm.icd9, '') IN ('2330011', '2330010', '2387010', '2277310', '2287310')
             OR COALESCE(tm.name, '') LIKE '%หญิงมีครรภ์%'
             OR COALESCE(tm.name, '') LIKE '%หญิงตั้งครรภ์%'
             OR COALESCE(tm.name, '') LIKE '%ANC%'
           )`,
        [vn]
      );
      const rows = (Array.isArray(ancRows) ? ancRows : []) as Array<Record<string, unknown>>;
      const names = rows.map((r) => String(r.name || r.tmcode || '')).filter(Boolean);

      const [delDmRes] = await connection.query(
        `DELETE dm FROM dtmain dm
         LEFT JOIN dttm tm ON tm.code = dm.tmcode
         WHERE dm.vn = ?
           AND (
             COALESCE(tm.icd10tm_operation_code, '') IN ('2330011', '2330010', '2387010', '2277310', '2287310')
             OR dm.tmcode IN ('2330011', '2330010', '2387010', '2277310', '2287310')
             OR COALESCE(dm.icd9, '') IN ('2330011', '2330010', '2387010', '2277310', '2287310')
             OR COALESCE(tm.name, '') LIKE '%หญิงมีครรภ์%'
             OR COALESCE(tm.name, '') LIKE '%หญิงตั้งครรภ์%'
             OR COALESCE(tm.name, '') LIKE '%ANC%'
           )`,
        [vn]
      );
      const deletedDm = Number((delDmRes as { affectedRows?: number }).affectedRows || 0);

      const [delDopRes] = await connection.query(
        `DELETE FROM doctor_operation
         WHERE vn = ?
           AND icd9 IN ('2330011', '2330010', '2387010', '2277310', '2287310')`,
        [vn]
      );
      const deletedDop = Number((delDopRes as { affectedRows?: number }).affectedRows || 0);

      await connection.query(
        `DELETE opi FROM opitemrece opi
         JOIN s_drugitems sd ON sd.icode = opi.icode
         WHERE opi.vn = ?
           AND (
             sd.nhso_adp_code IN ('30008', '30009')
             OR sd.name LIKE '%หญิงมีครรภ์%'
             OR sd.name LIKE '%หญิงตั้งครรภ์%'
           )`,
        [vn]
      ).catch(() => {});

      const totalDeleted = deletedDm + deletedDop;
      if (totalDeleted > 0) {
        executedActions.push(`ลบหัตถการส่งเสริมป้องกัน ANC (${names.length ? names.join(', ') : 'ตรวจฟัน/ขัดฟัน ANC'}) จำนวน ${totalDeleted} รายการ ออกจาก dtmain`);
      }
    } else if (action === 'SYNC_DENTAL_PROC') {
      const [numDxRows] = await connection.query(
        `SELECT ovst_diag_id, icd10, diagtype, doctor
         FROM ovstdiag
         WHERE vn = ? AND icd10 REGEXP '^[0-9]'`,
        [vn]
      );
      const numericItems = (Array.isArray(numDxRows) ? numDxRows : []) as Array<Record<string, unknown>>;
      if (numericItems.length > 0) {
        const [ovstData] = await connection.query(
          `SELECT hn, vstdate, vsttime, doctor FROM ovst WHERE vn = ? LIMIT 1`,
          [vn]
        );
        const ovst = (Array.isArray(ovstData) ? ovstData[0] : null) as Record<string, unknown> | null;
        const vstdate = ovst?.vstdate;
        const vsttime = ovst?.vsttime;
        const ovstDoctor = String(ovst?.doctor || '900');
        const ovstHn = String(ovst?.hn || hn);

        const [maxTmRows] = await connection.query(
          `SELECT COALESCE(MAX(tm_no), 0) AS max_no FROM dtmain WHERE vn = ?`,
          [vn]
        );
        let nextTmNo = Number((maxTmRows as Array<{ max_no: number }>)[0]?.max_no || 0);

        const [maxIdRows] = await connection.query(
          `SELECT COALESCE(MAX(dtmain_id), 0) AS max_id FROM dtmain`
        );
        let nextDtmainId = Number((maxIdRows as Array<{ max_id: number }>)[0]?.max_id || 0);

        const primaryIcd = diags.find((d) => d.diagtype === '1')?.code || 'Z012';
        const syncedDesc: string[] = [];

        for (const item of numericItems) {
          const rawCode = String(item.icd10 || '').trim();
          const cleanCode = rawCode.replace(/[.\s-]/g, '');
          const ovstDiagId = Number(item.ovst_diag_id);

          const [dttmMatches] = await connection.query(
            `SELECT code, name, icd9cm, icd10tm_operation_code
             FROM dttm
             WHERE icd9cm = ? OR REPLACE(icd9cm, '.', '') = ? OR code = ?
             ORDER BY code ASC
             LIMIT 1`,
            [rawCode, cleanCode, cleanCode]
          );
          const dttmMatch = (Array.isArray(dttmMatches) ? dttmMatches[0] : null) as Record<string, unknown> | null;

          let tmcode = dttmMatch ? String(dttmMatch.code) : '';
          let icd9 = dttmMatch ? String(dttmMatch.icd10tm_operation_code || dttmMatch.icd9cm || rawCode) : rawCode;

          if (!tmcode) {
            if (cleanCode === '8931') {
              tmcode = '3002';
              icd9 = '2330010';
            } else if (cleanCode === '9997') {
              tmcode = '1062';
              icd9 = '9997';
            } else {
              tmcode = cleanCode;
            }
          }

          nextTmNo++;
          nextDtmainId++;

          await connection.query(
            `INSERT INTO dtmain (
              dtmain_id, vn, hn, vstdate, vsttime, doctor, tmcode, icd9, icd, tm_no, fee
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
            [
              nextDtmainId,
              vn,
              ovstHn,
              vstdate,
              vsttime,
              String(item.doctor || ovstDoctor),
              tmcode,
              icd9,
              primaryIcd,
              nextTmNo,
            ]
          );

          await connection.query(
            `DELETE FROM ovstdiag WHERE vn = ? AND ovst_diag_id = ?`,
            [vn, ovstDiagId]
          );

          syncedDesc.push(`${rawCode} (เข้า dtmain รหัส ${tmcode})`);
        }

        if (syncedDesc.length > 0) {
          executedActions.push(`ย้ายรหัสหัตถการ ${syncedDesc.join(', ')} จาก ovstdiag เข้าสู่ dtmain เรียบร้อย`);
        }
      }
    } else if (action === 'REMOVE_NUMERIC_DX') {
      const [delRes] = await connection.query(
        `DELETE FROM ovstdiag WHERE vn = ? AND icd10 REGEXP '^[0-9]'`,
        [vn]
      );
      const delCount = Number((delRes as { affectedRows?: number }).affectedRows || 0);
      if (delCount > 0) {
        executedActions.push(`ลบรหัสหัตถการตัวเลขตกค้าง (${delCount} รายการ) ออกจาก ovstdiag เรียบร้อย`);
      }
    } else if (action === 'ADD_DENTAL_EXAM') {
      const [existingDm] = await connection.query(
        `SELECT COUNT(*) AS cnt FROM dtmain WHERE vn = ?`,
        [vn]
      );
      const dmCount = Number((existingDm as Array<{ cnt: number }>)[0]?.cnt || 0);

      if (dmCount === 0) {
        const [ovstData] = await connection.query(
          `SELECT hn, vstdate, vsttime, doctor FROM ovst WHERE vn = ? LIMIT 1`,
          [vn]
        );
        const ovst = (Array.isArray(ovstData) ? ovstData[0] : null) as Record<string, unknown> | null;
        const vstdate = ovst?.vstdate;
        const vsttime = ovst?.vsttime;
        const ovstDoctor = String(ovst?.doctor || '900');
        const ovstHn = String(ovst?.hn || hn);

        const [maxTmRows] = await connection.query(
          `SELECT COALESCE(MAX(tm_no), 0) AS max_no FROM dtmain WHERE vn = ?`,
          [vn]
        );
        const nextTmNo = Number((maxTmRows as Array<{ max_no: number }>)[0]?.max_no || 0) + 1;

        const [maxIdRows] = await connection.query(
          `SELECT COALESCE(MAX(dtmain_id), 0) AS max_id FROM dtmain`
        );
        const nextDtmainId = Number((maxIdRows as Array<{ max_id: number }>)[0]?.max_id || 0) + 1;

        const [dttmMatches] = await connection.query(
          `SELECT code, icd9cm, icd10tm_operation_code FROM dttm WHERE code = '3002' LIMIT 1`
        );
        const dttmRow = (Array.isArray(dttmMatches) ? dttmMatches[0] : null) as Record<string, unknown> | null;
        const tmcode = dttmRow ? String(dttmRow.code) : '3002';
        const icd9 = dttmRow ? String(dttmRow.icd10tm_operation_code || dttmRow.icd9cm || '2330010') : '2330010';

        const clean = (val: unknown) => String(val || '').trim().toUpperCase().replace(/[.\s-]/g, '');
        const hasZ012 = diags.some((d) => clean(d.code).startsWith('Z012'));
        const primaryIcd = hasZ012 ? 'Z012' : (diags.find((d) => d.diagtype === '1')?.code || 'Z012');

        await connection.query(
          `INSERT INTO dtmain (
            dtmain_id, vn, hn, vstdate, vsttime, doctor, tmcode, icd9, icd, tm_no, fee, scount, tcount
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`,
          [
            nextDtmainId,
            vn,
            ovstHn,
            vstdate,
            vsttime,
            ovstDoctor,
            tmcode,
            icd9,
            primaryIcd,
            nextTmNo,
          ]
        );

        executedActions.push(`บันทึกหัตถการตรวจสุขภาพช่องปาก (Oral examination: รหัส ${tmcode} / ${icd9}) ลงใน dtmain เรียบร้อย`);
      }
    }
  }

  const success = executedActions.length > 0;
  return {
    success,
    vn,
    hn,
    actions: executedActions,
    message: success ? `แก้ไขข้อมูลสำเร็จ: ${executedActions.join(', ')}` : 'ไม่มีการเปลี่ยนแปลงข้อมูล',
  };
};

export const fixWalkinClinicalIssueSingle = async (input: {
  vn: string;
  actorUserId?: number | null;
  actorName: string;
}): Promise<{ success: boolean; vn: string; hn: string; actions: string[]; message: string }> => {
  const connection = await getUTFConnection();
  try {
    await connection.beginTransaction();
    const result = await fixWalkinClinicalVisit(connection, input.vn, {
      id: input.actorUserId,
      name: input.actorName,
    });

    if (result.success) {
      await connection.commit();
    } else {
      await connection.rollback();
    }

    await logWalkinClinicalFix({
      vn: input.vn,
      hn: result.hn || '',
      actorUserId: input.actorUserId || null,
      actorName: input.actorName,
      actions: result.actions,
      resultStatus: result.success ? 'SUCCESS' : 'FAILED',
      errorMessage: result.success ? null : result.message,
    });

    return result;
  } catch (error) {
    await connection.rollback().catch(() => {});
    const errorMsg = error instanceof Error ? error.message : String(error);
    await logWalkinClinicalFix({
      vn: input.vn,
      hn: '',
      actorUserId: input.actorUserId || null,
      actorName: input.actorName,
      actions: [],
      resultStatus: 'FAILED',
      errorMessage: errorMsg,
    }).catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
};

export const batchFixWalkinClinicalIssues = async (input: {
  vns: string[];
  actorUserId?: number | null;
  actorName: string;
}): Promise<{
  total: number;
  success_count: number;
  failed_count: number;
  details: Array<{ vn: string; success: boolean; actions: string[]; message: string }>;
}> => {
  const vns = [...new Set((input.vns || []).map((v) => String(v).trim()).filter(Boolean))];
  if (vns.length === 0) throw new Error('ไม่พบรายการ VN ที่ต้องการแก้ไข');
  if (vns.length > 500) throw new Error('สามารถแก้ไขได้สูงสุดครั้งละ 500 รายการ');

  const details: Array<{ vn: string; success: boolean; actions: string[]; message: string }> = [];
  let successCount = 0;
  let failedCount = 0;

  for (const vn of vns) {
    try {
      const res = await fixWalkinClinicalIssueSingle({
        vn,
        actorUserId: input.actorUserId,
        actorName: input.actorName,
      });
      if (res.success) {
        successCount++;
      } else {
        failedCount++;
      }
      details.push(res);
    } catch (err) {
      failedCount++;
      details.push({
        vn,
        success: false,
        actions: [],
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    total: vns.length,
    success_count: successCount,
    failed_count: failedCount,
    details,
  };
};


