import type { RowDataPacket } from 'mysql2/promise';
import { activeHospitalDatabaseConfig, type HospitalConnection } from './hospitalDatabase.js';
import { getUTFConnection } from './db.js';
import { evaluateHerbalMedicationMatch } from '../src/utils/herbalMedicationRules.js';

export type HerbalCompletionSnapshot = {
  vn: string;
  hn: string;
  serviceDate: string;
  diagnosisCodes: string[];
  herbItems: string;
};

export type HerbalDiagnosisCandidate = {
  code: string;
  symptoms: string[];
  medicines: string[];
  alreadyPresent: boolean;
};

const normalizeCode = (value: unknown) => String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

export const assessHerbalDiagnosisCompletion = (snapshot: HerbalCompletionSnapshot) => {
  const assessment = evaluateHerbalMedicationMatch(snapshot.diagnosisCodes, snapshot.herbItems);
  const existing = new Set(snapshot.diagnosisCodes.map(normalizeCode));
  const candidates = new Map<string, HerbalDiagnosisCandidate>();

  for (const recommendation of assessment.medicineRecommendations) {
    for (const indication of recommendation.indications) {
      for (const rawCode of indication.diagnosisCodes) {
        const code = normalizeCode(rawCode);
        // U57 is a diagnosis family used for matching, not a sufficiently specific code to write back to HOSxP.
        if (!code || code === 'U57') continue;
        const current = candidates.get(code) || {
          code,
          symptoms: [],
          medicines: [],
          alreadyPresent: Array.from(existing).some((existingCode) => existingCode.startsWith(code)),
        };
        if (!current.symptoms.includes(indication.symptom)) current.symptoms.push(indication.symptom);
        if (!current.medicines.includes(recommendation.medicine)) current.medicines.push(recommendation.medicine);
        candidates.set(code, current);
      }
    }
  }

  const diagnosisCandidates = Array.from(candidates.values());
  const blockers: string[] = [];
  if (assessment.matchedMedicines.length === 0) blockers.push('ชื่อยาไม่อยู่ในตารางจับคู่ จึงไม่สามารถเสนอ Diagnosis ได้');
  if (diagnosisCandidates.length === 0) blockers.push('ไม่พบ Diagnosis ที่สัมพันธ์กับยาสมุนไพรใน visit นี้');

  return {
    ...snapshot,
    assessment,
    diagnosisCandidates,
    ready: assessment.status === 'valid',
    canComplete: assessment.status !== 'valid' && blockers.length === 0
      && diagnosisCandidates.some((candidate) => !candidate.alreadyPresent),
    blockers,
  };
};

const loadSnapshot = async (connection: HospitalConnection, vn: string, lock = false): Promise<HerbalCompletionSnapshot> => {
  const [visitRows] = await connection.query<RowDataPacket[]>(`
    SELECT o.vn, o.hn, DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
      GROUP_CONCAT(DISTINCT REPLACE(UPPER(dx.icd10), '.', '') ORDER BY dx.diagtype, dx.icd10 SEPARATOR ',') AS diagnosis_codes
    FROM ovst o
    LEFT JOIN ovstdiag dx ON dx.vn = o.vn
    WHERE o.vn = ?
    GROUP BY o.vn, o.hn, o.vstdate
    ${lock ? 'FOR UPDATE' : ''}
  `, [vn]);
  const visit = visitRows[0];
  if (!visit) throw new Error('ไม่พบ visit ที่ระบุใน HOSxP');

  const [medicineRows] = await connection.query<RowDataPacket[]>(`
    SELECT DISTINCT di.name
    FROM opitemrece oo
    JOIN drugitems di ON di.icode = oo.icode
    WHERE oo.vn = ?
      AND COALESCE(oo.qty, 0) > 0
      AND di.ttmt_code IS NOT NULL
      AND di.sks_product_category_id IN (3, 4)
    ORDER BY di.name
  `, [vn]);

  return {
    vn: String(visit.vn),
    hn: String(visit.hn),
    serviceDate: String(visit.service_date || '').slice(0, 10),
    diagnosisCodes: String(visit.diagnosis_codes || '').split(',').map(normalizeCode).filter(Boolean),
    herbItems: medicineRows.map((row) => String(row.name || '').trim()).filter(Boolean).join(', '),
  };
};

const ensureAuditTable = async (connection: HospitalConnection) => {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS z_fdh_herbal_diagnosis_audit (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      vn VARCHAR(13) NOT NULL,
      actor_user_id VARCHAR(64) NULL,
      actor_name VARCHAR(191) NULL,
      before_json LONGTEXT NOT NULL,
      action_json LONGTEXT NOT NULL,
      after_json LONGTEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_herbal_diag_audit_vn (vn),
      KEY idx_herbal_diag_audit_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
};

export const previewHerbalDiagnosisCompletion = async (vn: string) => {
  if (activeHospitalDatabaseConfig.type !== 'mysql') throw new Error('ฐาน HIS PostgreSQL เปิดใช้งานแบบอ่านอย่างเดียว จึงไม่สามารถเติม Diagnosis อัตโนมัติได้');
  const connection = await getUTFConnection();
  try {
    return assessHerbalDiagnosisCompletion(await loadSnapshot(connection, vn));
  } finally {
    connection.release();
  }
};

export const completeHerbalDiagnoses = async (
  vn: string,
  diagnosisCodes: string[],
  actor: { id?: number | string | null; name?: string | null },
  confirmedClinicalEvidence: boolean,
) => {
  if (activeHospitalDatabaseConfig.type !== 'mysql') throw new Error('ฐาน HIS PostgreSQL เปิดใช้งานแบบอ่านอย่างเดียว จึงไม่สามารถเติม Diagnosis อัตโนมัติได้');
  if (!confirmedClinicalEvidence) throw new Error('ต้องยืนยันว่าได้ตรวจเวชระเบียนและ Diagnosis ที่เลือกตรงกับอาการของผู้ป่วยจริง');
  const selectedCodes = Array.from(new Set(diagnosisCodes.map(normalizeCode).filter(Boolean)));
  if (selectedCodes.length === 0) throw new Error('กรุณาเลือก Diagnosis ที่ต้องการเพิ่ม');

  const connection = await getUTFConnection();
  let lockAcquired = false;
  try {
    const [lockRows] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?, 10) AS acquired', [`fdh-herbal-diagnosis:${vn}`]);
    lockAcquired = Number(lockRows[0]?.acquired || 0) === 1;
    if (!lockAcquired) throw new Error('visit นี้กำลังถูกแก้ไขโดยผู้ใช้อื่น กรุณาลองใหม่');
    await ensureAuditTable(connection);
    await connection.beginTransaction();

    const before = assessHerbalDiagnosisCompletion(await loadSnapshot(connection, vn, true));
    const allowedCodes = new Set(before.diagnosisCandidates.map((candidate) => candidate.code));
    const invalidCodes = selectedCodes.filter((code) => !allowedCodes.has(code));
    if (invalidCodes.length > 0) throw new Error(`Diagnosis ไม่สัมพันธ์กับยาที่พบ: ${invalidCodes.join(', ')}`);

    const insertedDiagnoses: string[] = [];
    for (const code of selectedCodes) {
      const [result] = await connection.query(`
        INSERT IGNORE INTO ovstdiag
          (ovst_diag_id, vn, icd10, hn, vstdate, vsttime, diagtype, icd103, hcode, doctor, hos_guid, dx_guid, update_datetime)
        SELECT Get_SerialNumber('ovst_diag_id'), o.vn, ?, o.hn, o.vstdate, o.vsttime, '2', LEFT(?, 3),
          COALESCE((SELECT NULLIF(hcode, '') FROM ovstdiag WHERE vn = o.vn LIMIT 1), (SELECT hospitalcode FROM opdconfig LIMIT 1)),
          COALESCE((SELECT NULLIF(doctor, '') FROM ovstdiag WHERE vn = o.vn LIMIT 1), NULLIF(o.doctor, '')),
          UPPER(CONCAT('{', UUID(), '}')), UPPER(CONCAT('{', UUID(), '}')), NOW()
        FROM ovst o
        WHERE o.vn = ?
          AND NOT EXISTS (SELECT 1 FROM ovstdiag dx WHERE dx.vn = o.vn AND REPLACE(UPPER(dx.icd10), '.', '') = ?)
      `, [code, code, vn, code]);
      if (Number((result as { affectedRows?: number }).affectedRows || 0) > 0) insertedDiagnoses.push(code);
    }

    const after = assessHerbalDiagnosisCompletion(await loadSnapshot(connection, vn, true));
    await connection.query(`
      INSERT INTO z_fdh_herbal_diagnosis_audit
        (vn, actor_user_id, actor_name, before_json, action_json, after_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      vn,
      actor.id == null ? null : String(actor.id),
      String(actor.name || '').slice(0, 191) || null,
      JSON.stringify(before),
      JSON.stringify({ selectedCodes, insertedDiagnoses, confirmedClinicalEvidence: true }),
      JSON.stringify(after),
    ]);
    await connection.commit();
    return { changed: insertedDiagnoses.length > 0, insertedDiagnoses, assessment: after };
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    if (lockAcquired) await connection.query('SELECT RELEASE_LOCK(?)', [`fdh-herbal-diagnosis:${vn}`]).catch(() => undefined);
    connection.release();
  }
};
