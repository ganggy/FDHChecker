import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { getUTFConnection } from './db.js';

export const KNEE_OPPP_CODES = ['8727811', '8737811', '8747811', '8737835'] as const;

type KneeCode = typeof KNEE_OPPP_CODES[number];

export type KneeCompletionSnapshot = {
  vn: string;
  hn: string;
  serviceDate: string;
  ageY: number;
  hipdataCode: string;
  hasM17: boolean;
  hasU5753: boolean;
  existingCodes: KneeCode[];
  healthMedServiceId: number | null;
  healthMedProviderId: number | null;
  healthMedDoctorId: number | null;
  poulticeSameDayCount: number;
  poulticeMax14DayCount: number;
};

export type KneeCompletionAssessment = KneeCompletionSnapshot & {
  ready: boolean;
  canComplete: boolean;
  clinicalEvidence: boolean;
  missingDiagnoses: string[];
  missingOperations: KneeCode[];
  blockers: string[];
  confirmationRequired: boolean;
};

type KneeCompletionActor = {
  id?: number | string | null;
  name?: string | null;
};

const normalizeCode = (value: unknown) => String(value || '').trim().toUpperCase().replace(/[.\-\s]/g, '');
const sqlDate = (value: unknown) => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
};

export const assessKneeCompletion = (snapshot: KneeCompletionSnapshot): KneeCompletionAssessment => {
  const existing = new Set(snapshot.existingCodes.map((code) => normalizeCode(code) as KneeCode));
  const missingDiagnoses = [
    snapshot.hasM17 ? '' : 'M17',
    snapshot.hasU5753 ? '' : 'U57.53',
  ].filter(Boolean);
  const missingOperations = KNEE_OPPP_CODES.filter((code) => !existing.has(code));
  const clinicalEvidence = existing.has('8737835') || ['8727811', '8737811', '8747811'].every((code) => existing.has(code as KneeCode));
  const blockers: string[] = [];

  if (snapshot.ageY < 40) blockers.push('อายุไม่ถึง 40 ปี');
  if (!snapshot.hasM17) blockers.push('ไม่พบรหัส M17 ที่ระบุชนิดโรค ต้องให้ผู้วินิจฉัยบันทึกใน HOSxP ก่อน');
  if (!snapshot.healthMedServiceId) blockers.push('ไม่พบรายการบริการในโมดูลแพทย์แผนไทยของ HOSxP');
  if (!clinicalEvidence) blockers.push('ยังไม่มีหลักฐานรหัสพอกเข่า หรือรหัสนวดครบ 3 ตำแหน่งใน visit นี้');
  if (!snapshot.healthMedProviderId) blockers.push('ไม่พบผู้ให้บริการแพทย์แผนไทยสำหรับใช้กับหัตถการ');
  if (missingOperations.includes('8737835') && snapshot.poulticeSameDayCount >= 1) {
    blockers.push('มีบริการพอกเข่าของผู้ป่วยในวันเดียวกันแล้ว');
  }
  if (existing.has('8737835') && snapshot.poulticeSameDayCount > 1) blockers.push('พบพอกเข่ามากกว่า 1 visit ในวันเดียวกัน');
  if (snapshot.poulticeMax14DayCount > 5) blockers.push('บริการพอกเข่าเกิน 5 ครั้งภายในช่วง 14 วัน');

  const ready = missingDiagnoses.length === 0 && missingOperations.length === 0
    && snapshot.ageY >= 40 && snapshot.poulticeMax14DayCount <= 5 && blockers.length === 0;

  return {
    ...snapshot,
    ready,
    canComplete: !ready && blockers.length === 0,
    clinicalEvidence,
    missingDiagnoses,
    missingOperations,
    blockers,
    confirmationRequired: !ready && blockers.length === 0,
  };
};

const loadSnapshot = async (connection: PoolConnection, vn: string, lock = false): Promise<KneeCompletionSnapshot> => {
  const [visitRows] = await connection.query<RowDataPacket[]>(`
    SELECT
      o.vn,
      o.hn,
      o.vstdate,
      TIMESTAMPDIFF(YEAR, pt.birthday, o.vstdate) AS age_y,
      COALESCE(ptt.hipdata_code, '') AS hipdata_code,
      MAX(CASE WHEN REPLACE(UPPER(d.icd10), '.', '') LIKE 'M17%' THEN 1 ELSE 0 END) AS has_m17,
      MAX(CASE WHEN REPLACE(UPPER(d.icd10), '.', '') = 'U5753' THEN 1 ELSE 0 END) AS has_u5753
    FROM ovst o
    JOIN patient pt ON pt.hn = o.hn
    LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
    LEFT JOIN ovstdiag d ON d.vn = o.vn
    WHERE o.vn = ?
    GROUP BY o.vn, o.hn, o.vstdate, pt.birthday, ptt.hipdata_code
    ${lock ? 'FOR UPDATE' : ''}
  `, [vn]);
  const visit = visitRows[0];
  if (!visit) throw new Error('ไม่พบ visit ที่ระบุใน HOSxP');

  const [serviceRows] = await connection.query<RowDataPacket[]>(`
    SELECT
      s.health_med_service_id,
      s.health_med_doctor_id,
      COUNT(DISTINCT CASE WHEN REPLACE(i.icd10tm, '-', '') IN ('8727811','8737811','8747811','8737835') THEN REPLACE(i.icd10tm, '-', '') END) AS target_count,
      MAX(CASE WHEN REPLACE(i.icd10tm, '-', '') IN ('8727811','8737811','8747811','8737835') THEN so.health_med_provider_id END) AS health_med_provider_id
    FROM health_med_service s
    LEFT JOIN health_med_service_operation so ON so.health_med_service_id = s.health_med_service_id
    LEFT JOIN health_med_operation_item i ON i.health_med_operation_item_id = so.health_med_operation_item_id
    WHERE s.vn = ?
    GROUP BY s.health_med_service_id, s.health_med_doctor_id
    ORDER BY target_count DESC, s.health_med_service_id DESC
    LIMIT 1
    ${lock ? 'FOR UPDATE' : ''}
  `, [vn]);
  const service = serviceRows[0];

  const [operationRows] = await connection.query<RowDataPacket[]>(`
    SELECT DISTINCT REPLACE(i.icd10tm, '-', '') AS code
    FROM health_med_service s
    JOIN health_med_service_operation so ON so.health_med_service_id = s.health_med_service_id
    JOIN health_med_operation_item i ON i.health_med_operation_item_id = so.health_med_operation_item_id
    WHERE s.vn = ?
      AND REPLACE(i.icd10tm, '-', '') IN ('8727811','8737811','8747811','8737835')
  `, [vn]);
  const existingCodes = operationRows
    .map((row) => normalizeCode(row.code))
    .filter((code): code is KneeCode => KNEE_OPPP_CODES.includes(code as KneeCode));

  const serviceDate = sqlDate(visit.vstdate);
  const [poulticeRows] = await connection.query<RowDataPacket[]>(`
    SELECT DISTINCT s.vn, DATE_FORMAT(s.service_date, '%Y-%m-%d') AS service_date
    FROM health_med_service s
    JOIN health_med_service_operation so ON so.health_med_service_id = s.health_med_service_id
    JOIN health_med_operation_item i ON i.health_med_operation_item_id = so.health_med_operation_item_id
    WHERE s.hn = ?
      AND s.service_date BETWEEN DATE_SUB(?, INTERVAL 13 DAY) AND DATE_ADD(?, INTERVAL 13 DAY)
      AND REPLACE(i.icd10tm, '-', '') = '8737835'
    ORDER BY s.service_date
  `, [visit.hn, serviceDate, serviceDate]);
  const dates = poulticeRows.map((row) => sqlDate(row.service_date)).filter(Boolean);
  const dayCount = dates.filter((date) => date === serviceDate).length;
  const candidateDates = existingCodes.includes('8737835') ? dates : [...dates, serviceDate].sort();
  let max14DayCount = 0;
  for (let start = 0; start < candidateDates.length; start += 1) {
    const startTime = new Date(`${candidateDates[start]}T00:00:00Z`).getTime();
    let count = 0;
    for (let end = start; end < candidateDates.length; end += 1) {
      const endTime = new Date(`${candidateDates[end]}T00:00:00Z`).getTime();
      if ((endTime - startTime) / 86_400_000 > 13) break;
      count += 1;
    }
    max14DayCount = Math.max(max14DayCount, count);
  }

  return {
    vn: String(visit.vn),
    hn: String(visit.hn),
    serviceDate,
    ageY: Number(visit.age_y || 0),
    hipdataCode: String(visit.hipdata_code || ''),
    hasM17: Boolean(Number(visit.has_m17 || 0)),
    hasU5753: Boolean(Number(visit.has_u5753 || 0)),
    existingCodes,
    healthMedServiceId: service?.health_med_service_id ? Number(service.health_med_service_id) : null,
    healthMedProviderId: service?.health_med_provider_id ? Number(service.health_med_provider_id) : null,
    healthMedDoctorId: service?.health_med_doctor_id ? Number(service.health_med_doctor_id) : null,
    poulticeSameDayCount: dayCount,
    poulticeMax14DayCount: max14DayCount,
  };
};

export const previewKneeOpppCompletion = async (vn: string) => {
  const connection = await getUTFConnection();
  try {
    return assessKneeCompletion(await loadSnapshot(connection, vn));
  } finally {
    connection.release();
  }
};

const ensureAuditTable = async (connection: PoolConnection) => {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS z_fdh_knee_completion_audit (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      vn VARCHAR(13) NOT NULL,
      actor_user_id VARCHAR(64) NULL,
      actor_name VARCHAR(191) NULL,
      before_json LONGTEXT NOT NULL,
      action_json LONGTEXT NOT NULL,
      after_json LONGTEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_knee_audit_vn (vn),
      KEY idx_knee_audit_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
};

export const completeKneeOpppVisit = async (
  vn: string,
  actor: KneeCompletionActor,
  confirmedClinicalEvidence: boolean,
) => {
  if (!confirmedClinicalEvidence) throw new Error('ต้องยืนยันว่าเวชระเบียนรองรับ Diagnosis และกิจกรรมที่กำลังเพิ่ม');
  const connection = await getUTFConnection();
  let lockAcquired = false;
  try {
    const [lockRows] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?, 10) AS acquired', [`fdh-knee:${vn}`]);
    lockAcquired = Number(lockRows[0]?.acquired || 0) === 1;
    if (!lockAcquired) throw new Error('visit นี้กำลังถูกแก้ไขโดยผู้ใช้อื่น กรุณาลองใหม่');

    // DDL may implicitly commit in MySQL, so ensure the audit table before the clinical-data transaction starts.
    await ensureAuditTable(connection);
    await connection.beginTransaction();
    const before = assessKneeCompletion(await loadSnapshot(connection, vn, true));
    if (before.ready) {
      await connection.rollback();
      return { changed: false, insertedDiagnoses: [], insertedOperations: [], assessment: before };
    }
    if (!before.canComplete) throw new Error(before.blockers.join(' | '));

    const insertedDiagnoses: string[] = [];
    for (const diagnosis of before.missingDiagnoses) {
      const code = normalizeCode(diagnosis);
      const serialName = 'ovst_diag_id';
      const [result] = await connection.query(`
        INSERT IGNORE INTO ovstdiag
          (ovst_diag_id, vn, icd10, hn, vstdate, vsttime, diagtype, icd103, hcode, doctor, hos_guid, dx_guid, update_datetime)
        SELECT
          Get_SerialNumber(?), o.vn, ?, o.hn, o.vstdate, o.vsttime, '2', LEFT(?, 3),
          COALESCE((SELECT NULLIF(hcode, '') FROM ovstdiag WHERE vn = o.vn LIMIT 1), (SELECT hospitalcode FROM opdconfig LIMIT 1)),
          COALESCE((SELECT NULLIF(doctor, '') FROM ovstdiag WHERE vn = o.vn LIMIT 1), NULLIF(o.doctor, '')),
          UPPER(CONCAT('{', UUID(), '}')), UPPER(CONCAT('{', UUID(), '}')), NOW()
        FROM ovst o
        WHERE o.vn = ?
          AND NOT EXISTS (SELECT 1 FROM ovstdiag d WHERE d.vn = o.vn AND REPLACE(UPPER(d.icd10), '.', '') = ?)
      `, [serialName, code, code, vn, code]);
      if (Number((result as { affectedRows?: number }).affectedRows || 0) > 0) insertedDiagnoses.push(diagnosis);
    }

    const organByCode: Record<KneeCode, number> = {
      '8727811': 39,
      '8737811': 40,
      '8747811': 41,
      '8737835': 40,
    };
    const insertedOperations: KneeCode[] = [];
    for (const code of before.missingOperations) {
      const [itemRows] = await connection.query<RowDataPacket[]>(`
        SELECT health_med_operation_item_id, health_med_operation_type_id, icode, price, operation_time_default
        FROM health_med_operation_item
        WHERE REPLACE(icd10tm, '-', '') = ?
        ORDER BY health_med_operation_item_id
        LIMIT 1
      `, [code]);
      const item = itemRows[0];
      if (!item) throw new Error(`ไม่พบรหัสหัตถการ ${code} ในตารางมาตรฐาน HOSxP`);
      const [duplicateRows] = await connection.query<RowDataPacket[]>(`
        SELECT 1
        FROM health_med_service s
        JOIN health_med_service_operation so ON so.health_med_service_id = s.health_med_service_id
        JOIN health_med_operation_item i ON i.health_med_operation_item_id = so.health_med_operation_item_id
        WHERE s.vn = ? AND REPLACE(i.icd10tm, '-', '') = ?
        LIMIT 1
      `, [vn, code]);
      if (duplicateRows.length > 0) continue;

      await connection.query(`
        INSERT INTO health_med_service_operation
          (health_med_service_operation_id, health_med_service_id, health_med_operation_type_id,
           health_med_operation_item_id, health_med_organ_id, health_med_service_operation_time_minute,
           service_price, service_icode, service_qty, opi_guid, health_med_provider_id, hos_guid)
        VALUES
          (Get_SerialNumber('health_med_service_operation_id'), ?, ?, ?, ?, ?, ?, ?, 1,
           UPPER(CONCAT('{', UUID(), '}')), ?, UPPER(CONCAT('{', UUID(), '}')))
      `, [
        before.healthMedServiceId,
        Number(item.health_med_operation_type_id || 2),
        Number(item.health_med_operation_item_id),
        organByCode[code],
        Number(item.operation_time_default || (code === '8737835' ? 30 : 20)),
        Number(item.price || 0),
        String(item.icode || ''),
        before.healthMedProviderId,
      ]);
      insertedOperations.push(code);
    }

    const after = assessKneeCompletion(await loadSnapshot(connection, vn, true));
    await connection.query(`
      INSERT INTO z_fdh_knee_completion_audit
        (vn, actor_user_id, actor_name, before_json, action_json, after_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      vn,
      actor.id == null ? null : String(actor.id),
      String(actor.name || '').slice(0, 191) || null,
      JSON.stringify(before),
      JSON.stringify({ insertedDiagnoses, insertedOperations, confirmedClinicalEvidence: true }),
      JSON.stringify(after),
    ]);
    await connection.commit();
    return {
      changed: insertedDiagnoses.length > 0 || insertedOperations.length > 0,
      insertedDiagnoses,
      insertedOperations,
      assessment: after,
    };
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    if (lockAcquired) await connection.query('SELECT RELEASE_LOCK(?)', [`fdh-knee:${vn}`]).catch(() => undefined);
    connection.release();
  }
};
