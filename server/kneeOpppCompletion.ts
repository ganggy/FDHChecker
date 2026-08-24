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
  operationCounts: Partial<Record<KneeCode, number>>;
  legacyOperationCounts: Partial<Record<KneeCode, number>>;
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
  duplicateOperations: Array<{ code: KneeCode; count: number }>;
  legacyOperations: Array<{ code: KneeCode; count: number }>;
  requiresOperationRebuild: boolean;
  blockers: string[];
  confirmationRequired: boolean;
  canCreateService: boolean;
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
  const duplicateOperations = KNEE_OPPP_CODES
    .map((code) => ({ code, count: Number(snapshot.operationCounts?.[code] || 0) }))
    .filter((item) => item.count > 1);
  const legacyOperations = KNEE_OPPP_CODES
    .map((code) => ({ code, count: Number(snapshot.legacyOperationCounts?.[code] || 0) }))
    .filter((item) => item.count > 0);
  const requiresOperationRebuild = duplicateOperations.length > 0 || legacyOperations.length > 0;
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

  const ready = missingDiagnoses.length === 0 && missingOperations.length === 0 && !requiresOperationRebuild
    && snapshot.ageY >= 40 && snapshot.poulticeMax14DayCount <= 5 && blockers.length === 0;
  const canCreateService = snapshot.ageY >= 40
    && snapshot.hasM17
    && snapshot.hasU5753
    && missingOperations.length > 0
    && snapshot.poulticeSameDayCount === 0
    && snapshot.poulticeMax14DayCount <= 5
    && (!clinicalEvidence || !snapshot.healthMedProviderId);

  return {
    ...snapshot,
    ready,
    canComplete: !ready && blockers.length === 0,
    clinicalEvidence,
    missingDiagnoses,
    missingOperations,
    duplicateOperations,
    legacyOperations,
    requiresOperationRebuild,
    blockers,
    confirmationRequired: !ready && blockers.length === 0,
    canCreateService,
  };
};

export const getKneeOpppProviders = async () => {
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query<RowDataPacket[]>(`
      SELECT
        hp.health_med_provider_id AS providerId,
        MIN(hd.health_med_doctor_id) AS doctorId,
        CONCAT(COALESCE(hp.health_med_provider_pname, ''), COALESCE(hp.health_med_provider_fname, ''), ' ', COALESCE(hp.health_med_provider_lname, '')) AS providerName,
        COALESCE(hp.health_med_provider_license_no, '') AS licenseNo
      FROM health_med_provider hp
      JOIN health_med_doctor hd ON hd.cid = hp.cid AND COALESCE(hd.active_status, 'Y') = 'Y'
      WHERE hp.cid IS NOT NULL
        AND CHAR_LENGTH(TRIM(hp.cid)) = 13
        AND COALESCE(hp.active_status, 'Y') = 'Y'
      GROUP BY hp.health_med_provider_id, hp.health_med_provider_pname,
        hp.health_med_provider_fname, hp.health_med_provider_lname,
        hp.health_med_provider_license_no
      ORDER BY providerName, hp.health_med_provider_id
    `);
    return rows.map((row) => ({
      providerId: Number(row.providerId),
      doctorId: Number(row.doctorId),
      providerName: String(row.providerName || '').trim(),
      licenseNo: String(row.licenseNo || '').trim(),
    }));
  } finally {
    connection.release();
  }
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
      COUNT(DISTINCT CASE
        WHEN REPLACE(i.icd10tm, '-', '') IN ('8727811','8737811','8747811','8737835') THEN REPLACE(i.icd10tm, '-', '')
        WHEN REPLACE(i.icd10tm, '-', '') = '9007811' AND so.health_med_organ_id = 39 THEN '8727811'
        WHEN REPLACE(i.icd10tm, '-', '') = '9007811' AND so.health_med_organ_id = 40 THEN '8737811'
        WHEN REPLACE(i.icd10tm, '-', '') = '9007811' AND so.health_med_organ_id = 41 THEN '8747811'
      END) AS target_count,
      MAX(CASE WHEN
        REPLACE(i.icd10tm, '-', '') IN ('8727811','8737811','8747811','8737835')
        OR (REPLACE(i.icd10tm, '-', '') = '9007811' AND so.health_med_organ_id IN (39,40,41))
        THEN so.health_med_provider_id END) AS health_med_provider_id
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
    SELECT REPLACE(i.icd10tm, '-', '') AS raw_code, so.health_med_organ_id AS organ_id, COUNT(*) AS operation_count
    FROM health_med_service s
    JOIN health_med_service_operation so ON so.health_med_service_id = s.health_med_service_id
    JOIN health_med_operation_item i ON i.health_med_operation_item_id = so.health_med_operation_item_id
    WHERE s.vn = ?
      AND (
        REPLACE(i.icd10tm, '-', '') IN ('8727811','8737811','8747811','8737835')
        OR (REPLACE(i.icd10tm, '-', '') = '9007811' AND so.health_med_organ_id IN (39,40,41))
      )
    GROUP BY REPLACE(i.icd10tm, '-', ''), so.health_med_organ_id
  `, [vn]);
  const legacyCodeByOrgan: Record<number, KneeCode> = { 39: '8727811', 40: '8737811', 41: '8747811' };
  const operationCounts: Partial<Record<KneeCode, number>> = {};
  const legacyOperationCounts: Partial<Record<KneeCode, number>> = {};
  for (const row of operationRows) {
    const rawCode = normalizeCode(row.raw_code);
    const mappedCode = rawCode === '9007811'
      ? legacyCodeByOrgan[Number(row.organ_id)]
      : rawCode as KneeCode;
    if (!mappedCode || !KNEE_OPPP_CODES.includes(mappedCode)) continue;
    const count = Number(row.operation_count || 0);
    operationCounts[mappedCode] = Number(operationCounts[mappedCode] || 0) + count;
    if (rawCode === '9007811') {
      legacyOperationCounts[mappedCode] = Number(legacyOperationCounts[mappedCode] || 0) + count;
    }
  }
  const existingCodes = KNEE_OPPP_CODES.filter((code) => Number(operationCounts[code] || 0) > 0);

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
    operationCounts,
    legacyOperationCounts,
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
  options: { createMissingService?: boolean; providerId?: number | null } = {},
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
    const manualServiceCreation = Boolean(options.createMissingService && before.canCreateService);
    if (!before.canComplete && !manualServiceCreation) throw new Error(before.blockers.join(' | '));

    let createdHealthMedService = false;
    let linkedSelectedProvider = false;
    let deletedOperations = 0;
    const rebuiltOperations = before.requiresOperationRebuild;
    let working = before;
    if (manualServiceCreation) {
      const providerId = Number(options.providerId || 0);
      if (!Number.isInteger(providerId) || providerId <= 0) throw new Error('กรุณาเลือกผู้ให้บริการแพทย์แผนไทย');
      const [providerRows] = await connection.query<RowDataPacket[]>(`
        SELECT hp.health_med_provider_id, MIN(hd.health_med_doctor_id) AS health_med_doctor_id
        FROM health_med_provider hp
        JOIN health_med_doctor hd ON hd.cid = hp.cid AND COALESCE(hd.active_status, 'Y') = 'Y'
        WHERE hp.health_med_provider_id = ? AND COALESCE(hp.active_status, 'Y') = 'Y'
        GROUP BY hp.health_med_provider_id
      `, [providerId]);
      const provider = providerRows[0];
      if (!provider) throw new Error('ผู้ให้บริการที่เลือกไม่ได้เชื่อมกับทะเบียนแพทย์แผนไทยใน HOSxP');
      const [serviceInsertResult] = await connection.query(`
        INSERT INTO health_med_service
          (health_med_service_id, hn, vn, an, health_med_service_type_id, service_date, service_time,
           health_med_doctor_id, health_med_treatment_type_id, health_med_service_result_id,
           hos_guid, in_hospcode_service)
        SELECT
          Get_SerialNumber('health_med_service_id'), o.hn, o.vn, NULL, 1, o.vstdate, o.vsttime,
          ?, 1, 1, UPPER(CONCAT('{', UUID(), '}')), 'Y'
        FROM ovst o
        WHERE o.vn = ?
          AND NOT EXISTS (SELECT 1 FROM health_med_service s WHERE s.vn = o.vn)
      `, [Number(provider.health_med_doctor_id), vn]);
      createdHealthMedService = Number((serviceInsertResult as { affectedRows?: number }).affectedRows || 0) > 0;
      const [serviceUpdateResult] = await connection.query(`
        UPDATE health_med_service
        SET health_med_doctor_id = COALESCE(health_med_doctor_id, ?)
        WHERE vn = ?
      `, [Number(provider.health_med_doctor_id), vn]);
      const [operationUpdateResult] = await connection.query(`
        UPDATE health_med_service_operation so
        JOIN health_med_service s ON s.health_med_service_id = so.health_med_service_id
        JOIN health_med_operation_item i ON i.health_med_operation_item_id = so.health_med_operation_item_id
        SET so.health_med_provider_id = COALESCE(so.health_med_provider_id, ?)
        WHERE s.vn = ?
          AND (
            REPLACE(i.icd10tm, '-', '') IN ('8727811','8737811','8747811','8737835')
            OR (REPLACE(i.icd10tm, '-', '') = '9007811' AND so.health_med_organ_id IN (39,40,41))
          )
      `, [providerId, vn]);
      linkedSelectedProvider = Number((serviceUpdateResult as { affectedRows?: number }).affectedRows || 0) > 0
        || Number((operationUpdateResult as { affectedRows?: number }).affectedRows || 0) > 0;
      working = assessKneeCompletion(await loadSnapshot(connection, vn, true));
      working.healthMedProviderId = providerId;
      working.healthMedDoctorId = Number(provider.health_med_doctor_id);
    }

    const insertedDiagnoses: string[] = [];
    for (const diagnosis of working.missingDiagnoses) {
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
    if (rebuiltOperations) {
      // A duplicate means the exported PROCEDURE rows are ambiguous. Rebuild only the
      // canonical knee codes and their legacy generic-massage equivalents for this VN;
      // diagnoses, drugs and unrelated services
      // are deliberately outside this DELETE scope.
      const [deleteResult] = await connection.query(`
        DELETE so
        FROM health_med_service_operation so
        JOIN health_med_service s ON s.health_med_service_id = so.health_med_service_id
        JOIN health_med_operation_item i ON i.health_med_operation_item_id = so.health_med_operation_item_id
        WHERE s.vn = ?
          AND (
            REPLACE(i.icd10tm, '-', '') IN ('8727811','8737811','8747811','8737835')
            OR (REPLACE(i.icd10tm, '-', '') = '9007811' AND so.health_med_organ_id IN (39,40,41))
          )
      `, [vn]);
      deletedOperations = Number((deleteResult as { affectedRows?: number }).affectedRows || 0);
    }
    const insertedOperations: KneeCode[] = [];
    const operationsToInsert = rebuiltOperations ? [...KNEE_OPPP_CODES] : working.missingOperations;
    for (const code of operationsToInsert) {
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
        working.healthMedServiceId,
        Number(item.health_med_operation_type_id || 2),
        Number(item.health_med_operation_item_id),
        organByCode[code],
        Number(item.operation_time_default || (code === '8737835' ? 30 : 20)),
        Number(item.price || 0),
        String(item.icode || ''),
        working.healthMedProviderId,
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
      JSON.stringify({ insertedDiagnoses, insertedOperations, deletedOperations, rebuiltOperations, createdHealthMedService, linkedSelectedProvider, confirmedClinicalEvidence: true }),
      JSON.stringify(after),
    ]);
    await connection.commit();
    return {
      changed: createdHealthMedService || linkedSelectedProvider || deletedOperations > 0 || insertedDiagnoses.length > 0 || insertedOperations.length > 0,
      createdHealthMedService,
      linkedSelectedProvider,
      deletedOperations,
      rebuiltOperations,
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
