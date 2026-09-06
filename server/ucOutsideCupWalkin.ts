import { getRepstmConnection, getUTFConnection } from './db.js';

export const UC_WALKIN_ICODE = '3010982';
export const UC_WALKIN_NAME = 'WALKIN:ผู้ป่วยนอกเหตุสมควร ทั่วประเทศ';
export const UC_WALKIN_START_DATE = '2024-10-01';
export const UC_WALKIN_PT_TYPES = ['40', '41'] as const;

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
  const page = Math.max(1, Math.trunc(Number(input.page || 1)));
  const pageSize = Math.max(10, Math.min(500, Math.trunc(Number(input.pageSize || 100))));
  const offset = (page - 1) * pageSize;
  const connection = await getUTFConnection();
  try {
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
         WHERE o.vstdate BETWEEN ? AND ? AND o.pttype IN (?, ?) AND IFNULL(o.an, '') = ''
       ) audit`,
      [UC_WALKIN_ICODE, startDate, endDate, ...UC_WALKIN_PT_TYPES]
    );
    const summaryRaw = (Array.isArray(summaryRows) ? summaryRows[0] : {}) as Record<string, unknown>;
    const missingOnlyClause = input.missingOnly === false ? '' : 'AND NOT EXISTS (SELECT 1 FROM opitemrece w WHERE w.vn = o.vn AND w.icode = ?)';
    const params: unknown[] = [UC_WALKIN_ICODE, startDate, endDate, ...UC_WALKIN_PT_TYPES];
    if (missingOnlyClause) params.push(UC_WALKIN_ICODE);
    const [rows] = await connection.query(
      `SELECT o.vn, o.hn, DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
              TIME_FORMAT(o.vsttime, '%H:%i:%s') AS service_time, o.pttype,
              COALESCE(o.hospmain, '') AS hospmain,
              (SELECT COUNT(*) FROM opitemrece w WHERE w.vn = o.vn AND w.icode = ?) AS walkin_rows,
              EXISTS(SELECT 1 FROM opitemrece p WHERE p.vn = o.vn) AS has_prescription_template
       FROM ovst o
       WHERE o.vstdate BETWEEN ? AND ? AND o.pttype IN (?, ?) AND IFNULL(o.an, '') = ''
         ${missingOnlyClause}
       ORDER BY o.vstdate DESC, o.vsttime DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const total = input.missingOnly === false ? Number(summaryRaw.total_visits || 0) : Number(summaryRaw.missing_walkin || 0);
    return {
      item: { icode: UC_WALKIN_ICODE, name: UC_WALKIN_NAME },
      period: { startDate, endDate },
      pttypes: [...UC_WALKIN_PT_TYPES],
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
  expectedCount: number;
  confirmation: string;
  actorUserId?: number | null;
  actorName: string;
}) => {
  const { startDate, endDate } = validateUcWalkinRange(input.startDate, input.endDate);
  const expectedCount = Math.max(0, Math.trunc(Number(input.expectedCount || 0)));
  if (input.confirmation.trim() !== getWalkinConfirmationText(expectedCount)) throw new Error('ข้อความยืนยันไม่ถูกต้อง');
  if (expectedCount <= 0) throw new Error('ไม่พบรายการที่ต้องเพิ่ม');

  const connection = await getUTFConnection();
  let targets: Array<{ vn: string; hos_guid: string }> = [];
  try {
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
       WHERE o.vstdate BETWEEN ? AND ? AND o.pttype IN (?, ?) AND IFNULL(o.an, '') = ''
         AND NOT EXISTS (SELECT 1 FROM opitemrece w WHERE w.vn = o.vn AND w.icode = ?)`,
      [startDate, endDate, ...UC_WALKIN_PT_TYPES, UC_WALKIN_ICODE]
    );
    const [targetRows] = await connection.query('SELECT vn, hos_guid FROM tmp_uc_walkin_missing ORDER BY vn');
    targets = (Array.isArray(targetRows) ? targetRows : []).map((row) => ({
      vn: String((row as Record<string, unknown>).vn || ''),
      hos_guid: String((row as Record<string, unknown>).hos_guid || ''),
    }));
    if (targets.length !== expectedCount) {
      throw new Error(`จำนวนรายการเปลี่ยนจาก ${expectedCount.toLocaleString('th-TH')} เป็น ${targets.length.toLocaleString('th-TH')} กรุณาตรวจสอบและยืนยันใหม่`);
    }
    const [configRows] = await connection.query('SELECT hospitalcode FROM opdconfig LIMIT 1');
    const hospitalCode = String(Array.isArray(configRows) ? (configRows[0] as Record<string, unknown> | undefined)?.hospitalcode || '' : '') || '11101';
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
      [UC_WALKIN_ICODE, hospitalCode, UC_WALKIN_ICODE]
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
    return { insertedCount, startDate, endDate, item: { icode: UC_WALKIN_ICODE, name: UC_WALKIN_NAME } };
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
};
