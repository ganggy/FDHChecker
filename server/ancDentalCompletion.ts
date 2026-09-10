import type { RowDataPacket } from 'mysql2/promise';
import { activeHospitalDatabaseConfig, type HospitalConnection } from './hospitalDatabase.js';
import { getUTFConnection } from './db.js';

export type AncDentalServiceKind = 'exam' | 'clean';

type CompletionRule = {
  label: string;
  adpCode: string;
  procedureCodes: readonly string[];
  icd9: string;
};

const RULES: Record<AncDentalServiceKind, CompletionRule> = {
  exam: { label: 'ANC ตรวจฟัน', adpCode: '30008', procedureCodes: ['2330011', '2330010'], icd9: '8931' },
  clean: { label: 'ANC ขัดทำความสะอาดฟัน', adpCode: '30009', procedureCodes: ['2387010'], icd9: '9654' },
};

export type AncDentalProcedureRow = {
  tmNo: string;
  tmCode: string;
  procedureCode: string;
  icd9: string;
};

export type AncDentalCatalogItem = {
  icode: string;
  name: string;
  unitprice: number;
  income: string;
  usageCount: number;
};

export type AncDentalCompletionSnapshot = {
  kind: AncDentalServiceKind;
  vn: string;
  hn: string;
  serviceDate: string;
  sex: string;
  hasAncDiagnosis: boolean;
  hasAdp: boolean;
  hasDentalCareRecord: boolean;
  procedures: AncDentalProcedureRow[];
  catalogItems: AncDentalCatalogItem[];
};

export type AncDentalCompletionAssessment = AncDentalCompletionSnapshot & {
  label: string;
  adpCode: string;
  procedureCodes: readonly string[];
  requiredIcd9: string;
  hasProcedureCode: boolean;
  hasProcedurePair: boolean;
  ready: boolean;
  canComplete: boolean;
  missing: string[];
  blockers: string[];
  selectedCatalogItem: AncDentalCatalogItem | null;
  selectedProcedure: AncDentalProcedureRow | null;
};

const normalizeCode = (value: unknown) => String(value ?? '').trim().toUpperCase().replace(/[.\-\s]/g, '');
const sqlDate = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '').slice(0, 10);

export const isAncDentalServiceKind = (value: unknown): value is AncDentalServiceKind => value === 'exam' || value === 'clean';

export const assessAncDentalCompletion = (snapshot: AncDentalCompletionSnapshot): AncDentalCompletionAssessment => {
  const rule = RULES[snapshot.kind];
  const allowed = new Set(rule.procedureCodes.map(normalizeCode));
  const matchingProcedures = snapshot.procedures.filter((row) => allowed.has(normalizeCode(row.procedureCode)));
  const exactProcedures = matchingProcedures.filter((row) => normalizeCode(row.icd9) === normalizeCode(rule.icd9));
  const selectedProcedure = exactProcedures[0] || matchingProcedures[0] || null;
  const selectedCatalogItem = snapshot.catalogItems[0] || null;
  const hasProcedureCode = matchingProcedures.length > 0;
  const hasProcedurePair = exactProcedures.length > 0;
  const missing = [
    snapshot.hasAdp ? '' : `ADP ${rule.adpCode}`,
    hasProcedurePair ? '' : `ICD10TM ${rule.procedureCodes.join('/')} + ICD-9 ${rule.icd9}`,
  ].filter(Boolean);
  const blockers: string[] = [];

  if (snapshot.sex !== '2') blockers.push('visit นี้ไม่ใช่ผู้ป่วยหญิง');
  if (!snapshot.hasAncDiagnosis) blockers.push('ไม่พบ Diagnosis ฝากครรภ์ Z34/Z35');
  if (!snapshot.hasAdp && !hasProcedureCode) blockers.push('ไม่พบหลักฐานบริการจาก ADP หรือหัตถการทันตกรรมใน visit นี้');
  if (!snapshot.hasAdp && !selectedCatalogItem) blockers.push(`ไม่พบรายการค่าบริการที่ผูก ADP ${rule.adpCode} ในบัญชีของโรงพยาบาล`);
  if (!hasProcedurePair && !selectedProcedure) blockers.push(`ไม่พบหัตถการ ${rule.procedureCodes.join('/')} ใน dtmain จึงไม่เพิ่มเวชระเบียนทันตกรรมแทนผู้ให้บริการ`);

  const ready = snapshot.sex === '2' && snapshot.hasAncDiagnosis && snapshot.hasAdp && hasProcedurePair;
  return {
    ...snapshot,
    label: rule.label,
    adpCode: rule.adpCode,
    procedureCodes: rule.procedureCodes,
    requiredIcd9: rule.icd9,
    hasProcedureCode,
    hasProcedurePair,
    ready,
    canComplete: !ready && blockers.length === 0,
    missing,
    blockers,
    selectedCatalogItem,
    selectedProcedure,
  };
};

const placeholders = (length: number) => new Array(length).fill('?').join(', ');

const loadSnapshot = async (
  connection: HospitalConnection,
  kind: AncDentalServiceKind,
  vn: string,
  lock = false,
): Promise<AncDentalCompletionSnapshot> => {
  const rule = RULES[kind];
  const [visitRows] = await connection.query<RowDataPacket[]>(`
    SELECT o.vn, o.hn, o.vstdate, COALESCE(v.sex, pt.sex) AS sex,
      MAX(CASE WHEN REPLACE(UPPER(dx.icd10), '.', '') REGEXP '^Z3(4|5)' THEN 1 ELSE 0 END) AS has_anc_diag,
      CASE WHEN EXISTS (
        SELECT 1 FROM opitemrece oo JOIN s_drugitems sd ON sd.icode = oo.icode
        WHERE oo.vn = o.vn AND TRIM(sd.nhso_adp_code) = ? LIMIT 1
      ) THEN 1 ELSE 0 END AS has_adp,
      CASE WHEN EXISTS (SELECT 1 FROM dental_care dc WHERE dc.vn = o.vn LIMIT 1) THEN 1 ELSE 0 END AS has_dental_care_record
    FROM ovst o
    JOIN patient pt ON pt.hn = o.hn
    LEFT JOIN vn_stat v ON v.vn = o.vn
    LEFT JOIN ovstdiag dx ON dx.vn = o.vn
    WHERE o.vn = ?
    GROUP BY o.vn, o.hn, o.vstdate, v.sex, pt.sex
    ${lock ? 'FOR UPDATE' : ''}
  `, [rule.adpCode, vn]);
  const visit = visitRows[0];
  if (!visit) throw new Error('ไม่พบ visit ที่ระบุใน HOSxP');

  const [procedureRows] = await connection.query<RowDataPacket[]>(`
    SELECT COALESCE(dm.tm_no, '') AS tm_no, COALESCE(dm.tmcode, '') AS tmcode,
      COALESCE(NULLIF(TRIM(tm.icd10tm_operation_code), ''), NULLIF(TRIM(tm.icd9cm), ''), NULLIF(TRIM(dm.icd9), '')) AS procedure_code,
      REPLACE(COALESCE(NULLIF(TRIM(dm.icd9), ''), NULLIF(TRIM(tm.icd9cm), ''), ''), '.', '') AS icd9
    FROM dtmain dm
    LEFT JOIN dttm tm ON tm.code = dm.tmcode
    WHERE dm.vn = ?
      AND COALESCE(NULLIF(TRIM(tm.icd10tm_operation_code), ''), NULLIF(TRIM(tm.icd9cm), ''), NULLIF(TRIM(dm.icd9), ''))
        IN (${placeholders(rule.procedureCodes.length)})
    ORDER BY dm.tm_no, dm.tmcode
    ${lock ? 'FOR UPDATE' : ''}
  `, [vn, ...rule.procedureCodes]);

  const [catalogRows] = await connection.query<RowDataPacket[]>(`
    SELECT sd.icode, COALESCE(NULLIF(TRIM(sd.name), ''), sd.icode) AS item_name,
      COALESCE(ndi.unitprice, 0) AS unitprice, COALESCE(NULLIF(ndi.income, ''), '00') AS income,
      COUNT(DISTINCT recent.hos_guid) AS usage_count
    FROM s_drugitems sd
    LEFT JOIN nondrugitems ndi ON ndi.icode = sd.icode
    LEFT JOIN opitemrece recent ON recent.icode = sd.icode AND recent.vstdate >= DATE_SUB(CURDATE(), INTERVAL 365 DAY)
    WHERE TRIM(sd.nhso_adp_code) = ?
    GROUP BY sd.icode, sd.name, ndi.unitprice, ndi.income
    ORDER BY usage_count DESC, sd.icode
    LIMIT 10
  `, [rule.adpCode]);

  return {
    kind,
    vn: String(visit.vn),
    hn: String(visit.hn),
    serviceDate: sqlDate(visit.vstdate),
    sex: String(visit.sex || ''),
    hasAncDiagnosis: Boolean(Number(visit.has_anc_diag || 0)),
    hasAdp: Boolean(Number(visit.has_adp || 0)),
    hasDentalCareRecord: Boolean(Number(visit.has_dental_care_record || 0)),
    procedures: procedureRows.map((row) => ({
      tmNo: String(row.tm_no || ''), tmCode: String(row.tmcode || ''),
      procedureCode: String(row.procedure_code || ''), icd9: normalizeCode(row.icd9),
    })),
    catalogItems: catalogRows.map((row) => ({
      icode: String(row.icode || ''), name: String(row.item_name || ''), unitprice: Number(row.unitprice || 0),
      income: String(row.income || '00'), usageCount: Number(row.usage_count || 0),
    })),
  };
};

const ensureAuditTable = async (connection: HospitalConnection) => {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS z_fdh_anc_dental_completion_audit (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      vn VARCHAR(13) NOT NULL,
      service_kind VARCHAR(16) NOT NULL,
      actor_user_id VARCHAR(64) NULL,
      actor_name VARCHAR(191) NULL,
      before_json LONGTEXT NOT NULL,
      action_json LONGTEXT NOT NULL,
      after_json LONGTEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_anc_dental_audit_vn (vn),
      KEY idx_anc_dental_audit_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
};

export const previewAncDentalCompletion = async (kind: AncDentalServiceKind, vn: string) => {
  if (activeHospitalDatabaseConfig.type !== 'mysql') throw new Error('ฐาน HIS PostgreSQL เปิดใช้งานแบบอ่านอย่างเดียว จึงไม่สามารถเติมข้อมูลอัตโนมัติได้');
  const connection = await getUTFConnection();
  try { return assessAncDentalCompletion(await loadSnapshot(connection, kind, vn)); }
  finally { connection.release(); }
};

export const completeAncDentalVisit = async (
  kind: AncDentalServiceKind,
  vn: string,
  actor: { id?: number | string | null; name?: string | null },
  confirmedClinicalEvidence: boolean,
) => {
  if (activeHospitalDatabaseConfig.type !== 'mysql') throw new Error('ฐาน HIS PostgreSQL เปิดใช้งานแบบอ่านอย่างเดียว จึงไม่สามารถเติมข้อมูลอัตโนมัติได้');
  if (!confirmedClinicalEvidence) throw new Error('ต้องยืนยันว่าได้ตรวจเวชระเบียนและผู้ป่วยได้รับบริการนี้จริง');
  const rule = RULES[kind];
  const connection = await getUTFConnection();
  let lockAcquired = false;
  try {
    const [lockRows] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?, 10) AS acquired', [`fdh-anc-dental:${vn}`]);
    lockAcquired = Number(lockRows[0]?.acquired || 0) === 1;
    if (!lockAcquired) throw new Error('visit นี้กำลังถูกแก้ไขโดยผู้ใช้อื่น กรุณาลองใหม่');
    await ensureAuditTable(connection);
    await connection.beginTransaction();
    const before = assessAncDentalCompletion(await loadSnapshot(connection, kind, vn, true));
    if (before.ready) {
      await connection.rollback();
      return { changed: false, insertedAdp: null, updatedProcedure: null, assessment: before };
    }
    if (!before.canComplete) throw new Error(before.blockers.join(' | '));

    let insertedAdp: { icode: string; adpCode: string; name: string } | null = null;
    if (!before.hasAdp && before.selectedCatalogItem) {
      const item = before.selectedCatalogItem;
      const [configRows] = await connection.query<RowDataPacket[]>('SELECT hospitalcode FROM opdconfig LIMIT 1');
      const hospitalCode = String(configRows[0]?.hospitalcode || '') || '00000';
      const [insertResult] = await connection.query(`
        INSERT INTO opitemrece (
          hos_guid, vn, hn, an, icode, qty, drugusage, idr, iperday, iperdose, unitprice,
          vstdate, vsttime, doctor, rxdate, rxtime, sp_use, hcode, print, dep_code,
          finance_number, discount, use_right, node_id, order_no, sub_type, pttype, income,
          item_type, staff, paidst, item_no, last_modified, sum_price, cost,
          stock_department_id, command_doctor, opi_doctor_finance_type_id
        )
        SELECT UPPER(CONCAT('{', UUID(), '}')), o.vn, o.hn, NULL, ?, 1, '', 'N/A', 0, 0, ?,
          o.vstdate, o.vsttime, COALESCE(NULLIF(base.doctor, ''), o.doctor, ''), o.vstdate, o.vsttime,
          '', ?, 'N', COALESCE(NULLIF(base.dep_code, ''), NULLIF(o.main_dep, ''), '000'),
          base.finance_number, 0, base.use_right, '', NULL, '3', o.pttype, ?, '',
          COALESCE(NULLIF(base.staff, ''), o.staff, ''), COALESCE(NULLIF(base.paidst, ''), '02'),
          COALESCE((SELECT MAX(COALESCE(i.item_no, 0)) + 1 FROM opitemrece i WHERE i.vn = o.vn), 1),
          NOW(), ?, 0, NULL, NULL, NULL
        FROM ovst o
        LEFT JOIN opitemrece base ON base.hos_guid = (SELECT MIN(b.hos_guid) FROM opitemrece b WHERE b.vn = o.vn)
        WHERE o.vn = ?
          AND NOT EXISTS (
            SELECT 1 FROM opitemrece existing JOIN s_drugitems sd ON sd.icode = existing.icode
            WHERE existing.vn = o.vn AND TRIM(sd.nhso_adp_code) = ?
          )
      `, [item.icode, item.unitprice, hospitalCode, item.income, item.unitprice, vn, rule.adpCode]);
      if (Number((insertResult as { affectedRows?: number }).affectedRows || 0) !== 1) throw new Error(`เพิ่ม ADP ${rule.adpCode} ไม่สำเร็จหรือมีรายการถูกเพิ่มพร้อมกัน`);
      insertedAdp = { icode: item.icode, adpCode: rule.adpCode, name: item.name };
    }

    let updatedProcedure: { tmCode: string; procedureCode: string; icd9: string } | null = null;
    if (!before.hasProcedurePair && before.selectedProcedure) {
      const procedure = before.selectedProcedure;
      const [updateResult] = await connection.query(`
        UPDATE dtmain
        SET icd9 = ?
        WHERE vn = ? AND tmcode = ?
          AND COALESCE(tm_no, '') = ?
        LIMIT 1
      `, [rule.icd9, vn, procedure.tmCode, procedure.tmNo]);
      if (Number((updateResult as { affectedRows?: number }).affectedRows || 0) !== 1) throw new Error('ปรับรหัส ICD-9 ของหัตถการไม่สำเร็จหรือข้อมูลถูกเปลี่ยนพร้อมกัน');
      updatedProcedure = { tmCode: procedure.tmCode, procedureCode: procedure.procedureCode, icd9: rule.icd9 };
    }

    const after = assessAncDentalCompletion(await loadSnapshot(connection, kind, vn, true));
    if (!after.ready) throw new Error('ตรวจซ้ำหลังเติมข้อมูลแล้วยังไม่ครบ ระบบยกเลิกการบันทึกทั้งหมด');
    await connection.query(`
      INSERT INTO z_fdh_anc_dental_completion_audit
        (vn, service_kind, actor_user_id, actor_name, before_json, action_json, after_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      vn, kind, actor.id == null ? null : String(actor.id), String(actor.name || '').slice(0, 191) || null,
      JSON.stringify(before), JSON.stringify({ insertedAdp, updatedProcedure, confirmedClinicalEvidence: true }), JSON.stringify(after),
    ]);
    await connection.commit();
    return { changed: Boolean(insertedAdp || updatedProcedure), insertedAdp, updatedProcedure, assessment: after };
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    if (lockAcquired) await connection.query('SELECT RELEASE_LOCK(?)', [`fdh-anc-dental:${vn}`]).catch(() => undefined);
    connection.release();
  }
};
