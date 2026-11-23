import type { RowDataPacket } from 'mysql2/promise';
import { activeHospitalDatabaseConfig, type HospitalConnection } from './hospitalDatabase.js';
import { getUTFConnection } from './db.js';
import {
  FPG_EXCLUDED_DM_CODES,
  excludedScreeningCode,
  getThaiFiscalYearRange,
  toIsoDate,
} from './fundEligibility.js';
import { readHospitalSchema } from './hospitalSchema.js';
import {
  FPG_DX_CODES,
  buildDiagnosisMatchSql,
  buildFpgLabExistsSql,
  buildNoDmDiagnosisSql,
} from './repositories/clinicalRules.js';

export type FpgDiagCode = 'Z131' | 'Z133' | 'Z136';

export type FpgCatalogItem = {
  icode: string;
  name: string;
  unitprice: number;
  income: string;
  usageCount: number;
};

export type FpgScreeningCompletionSnapshot = {
  vn: string;
  hn: string;
  serviceDate: string;
  age: number | null;
  ageEligible: boolean;
  hasFpgLab: boolean;
  noDmDiag: boolean;
  hasFpgDiag: boolean;
  hasFpgAdp: boolean;
  priorDmCodes?: string[];
  priorFiscalYear12003?: { vn: string; vstdate: string } | null;
  catalogItems: FpgCatalogItem[];
};

export type FpgScreeningCompletionAssessment = FpgScreeningCompletionSnapshot & {
  adpCode: '12003';
  ready: boolean;
  canComplete: boolean;
  missing: string[];
  blockers: string[];
  selectedCatalogItem: FpgCatalogItem | null;
};

const sqlDate = (value: unknown) => toIsoDate(value);

export const normalizeFpgDiagCode = (value: unknown): FpgDiagCode => {
  const code = String(value ?? 'Z131').trim().toUpperCase().replace(/\./g, '');
  if (code === 'Z133' || code === 'Z136') return code;
  return 'Z131';
};

export const assessFpgScreeningCompletion = (
  snapshot: FpgScreeningCompletionSnapshot,
): FpgScreeningCompletionAssessment => {
  const selectedCatalogItem = snapshot.catalogItems[0] || null;
  const missing = [
    snapshot.hasFpgDiag ? '' : 'Diagnosis Z131/Z133/Z136',
    snapshot.hasFpgAdp ? '' : 'ADP 12003',
  ].filter(Boolean);

  const blockers: string[] = [];
  if (!snapshot.ageEligible) blockers.push('ไม่ผ่านเงื่อนไข 1: อายุไม่อยู่ในช่วง 35-59 ปี');
  if (!snapshot.hasFpgLab) blockers.push('ไม่ผ่านเงื่อนไข 2: ไม่พบผลตรวจ Lab FPG/FBS ใน visit นี้');
  if (!snapshot.noDmDiag) blockers.push('ไม่ผ่านเงื่อนไข 3: พบการวินิจฉัยโรคเบาหวาน (E100-E149) ใน visit นี้');
  if (snapshot.priorDmCodes && snapshot.priorDmCodes.length > 0) {
    blockers.push(`ไม่ผ่านเงื่อนไข 3: พบประวัติวินิจฉัยโรคเบาหวานเดิม (${snapshot.priorDmCodes.join(', ')}) ในประวัติผู้ป่วย`);
  }
  if (snapshot.priorFiscalYear12003) {
    blockers.push(
      `ไม่ผ่านเกณฑ์ 1 ครั้ง/ปีงบประมาณ: เคยได้รับ ADP 12003 แล้วในปีงบประมาณนี้ (VN ${snapshot.priorFiscalYear12003.vn} วันที่ ${snapshot.priorFiscalYear12003.vstdate})`,
    );
  }
  if (!snapshot.hasFpgAdp && !selectedCatalogItem) {
    blockers.push('ไม่พบรายการค่าบริการที่ผูก ADP 12003 ใน s_drugitems ของโรงพยาบาล');
  }

  const ready =
    snapshot.ageEligible &&
    snapshot.hasFpgLab &&
    snapshot.noDmDiag &&
    !(snapshot.priorDmCodes && snapshot.priorDmCodes.length > 0) &&
    !snapshot.priorFiscalYear12003 &&
    snapshot.hasFpgDiag &&
    snapshot.hasFpgAdp;
  return {
    ...snapshot,
    adpCode: '12003',
    ready,
    canComplete: !ready && blockers.length === 0,
    missing,
    blockers,
    selectedCatalogItem,
  };
};

const loadCatalogItemsFor12003 = async (connection: HospitalConnection): Promise<FpgCatalogItem[]> => {
  const [catalogRows] = await connection.query<RowDataPacket[]>(`
    SELECT sd.icode, COALESCE(NULLIF(TRIM(sd.name), ''), sd.icode) AS item_name,
      COALESCE(
        (
          SELECT recent.unitprice
          FROM opitemrece recent
          WHERE recent.icode = sd.icode
          ORDER BY recent.vstdate DESC, recent.vsttime DESC, recent.item_no DESC
          LIMIT 1
        ),
        50
      ) AS unitprice,
      COALESCE(
        (
          SELECT NULLIF(recent.income, '')
          FROM opitemrece recent
          WHERE recent.icode = sd.icode
          ORDER BY recent.vstdate DESC, recent.vsttime DESC, recent.item_no DESC
          LIMIT 1
        ),
        '07'
      ) AS income,
      (
        SELECT COUNT(*)
        FROM opitemrece recent
        WHERE recent.icode = sd.icode
          AND recent.vstdate >= DATE_SUB(CURDATE(), INTERVAL 365 DAY)
      ) AS usage_count
    FROM s_drugitems sd
    WHERE TRIM(sd.nhso_adp_code) = '12003'
    ORDER BY usage_count DESC, sd.icode
    LIMIT 10
  `);

  return catalogRows.map((row) => ({
    icode: String(row.icode || ''),
    name: String(row.item_name || ''),
    unitprice: Number(row.unitprice ?? 50),
    income: String(row.income || '07'),
    usageCount: Number(row.usage_count || 0),
  }));
};

const loadSnapshot = async (
  connection: HospitalConnection,
  vn: string,
  catalogItemsCache?: FpgCatalogItem[],
  lock = false,
): Promise<FpgScreeningCompletionSnapshot> => {
  const [visitRows] = await connection.query<RowDataPacket[]>(`
    SELECT
      o.vn,
      o.hn,
      o.vstdate,
      v.age_y AS age,
      CASE WHEN v.age_y BETWEEN 35 AND 59 THEN 1 ELSE 0 END AS age_eligible,
      CASE WHEN ${buildFpgLabExistsSql('o')} THEN 1 ELSE 0 END AS has_fpg_lab,
      CASE WHEN ${buildNoDmDiagnosisSql('o', 'v')} THEN 1 ELSE 0 END AS no_dm_diag,
      CASE WHEN ${buildDiagnosisMatchSql('o', 'v', FPG_DX_CODES)} THEN 1 ELSE 0 END AS has_fpg_diag,
      CASE WHEN EXISTS (
        SELECT 1 FROM opitemrece oo
        JOIN s_drugitems sd ON sd.icode = oo.icode
        WHERE oo.vn = o.vn AND TRIM(sd.nhso_adp_code) = '12003'
        LIMIT 1
      ) THEN 1 ELSE 0 END AS has_fpg_adp
    FROM ovst o
    LEFT JOIN vn_stat v ON v.vn = o.vn
    WHERE o.vn = ?
    LIMIT 1
    ${lock ? 'FOR UPDATE' : ''}
  `, [vn]);

  const visit = visitRows[0];
  if (!visit) throw new Error(`ไม่พบ visit ${vn} ใน HOSxP`);

  const catalogItems = catalogItemsCache ?? (await loadCatalogItemsFor12003(connection));
  const hn = String(visit.hn);
  const serviceDate = sqlDate(visit.vstdate);

  const hasSchema = await readHospitalSchema(connection, ['ovstdiag', 'ovst', 'iptdiag', 'ipt', 'vn_stat', 'an_stat']);
  const codeFilter = FPG_EXCLUDED_DM_CODES.map((code) => `'${code}'`).join(',');
  const historySources: string[] = [];
  for (const [diag, tbl, key] of [['ovstdiag', 'ovst', 'vn'], ['iptdiag', 'ipt', 'an']]) {
    if (hasSchema(diag, key, 'icd10') && hasSchema(tbl, key, 'hn')) {
      historySources.push(
        `SELECT DISTINCT d.icd10 FROM ${diag} d JOIN ${tbl} v ON v.${key} = d.${key} WHERE v.hn = ? AND REPLACE(UPPER(TRIM(d.icd10)), '.', '') IN (${codeFilter})`,
      );
    }
  }
  for (const tbl of ['vn_stat', 'an_stat']) {
    const columns = ['pdx', 'dx0', 'dx1', 'dx2', 'dx3', 'dx4', 'dx5'].filter((col) => hasSchema(tbl, col));
    if (hasSchema(tbl, 'hn') && columns.length) {
      historySources.push(
        `SELECT DISTINCT CONCAT_WS(',', ${columns.map((col) => `s.${col}`).join(',')}) AS icd10 FROM ${tbl} s WHERE s.hn = ? AND (${columns.map((col) => `REPLACE(UPPER(TRIM(s.${col})), '.', '') IN (${codeFilter})`).join(' OR ')})`,
      );
    }
  }
  const priorDmSet = new Set<string>();
  if (historySources.length > 0) {
    const [dmRows] = await connection.query<RowDataPacket[]>(
      historySources.join(' UNION ALL '),
      historySources.map(() => hn),
    );
    for (const r of dmRows) {
      for (const code of String(r.icd10 || '').split(',')) {
        const cleaned = code.trim();
        if (cleaned && excludedScreeningCode('fpg_screening', cleaned)) {
          priorDmSet.add(cleaned);
        }
      }
    }
  }

  let priorFiscalYear12003: { vn: string; vstdate: string } | null = null;
  const fyRange = getThaiFiscalYearRange(serviceDate);
  if (fyRange) {
    const [fyRows] = await connection.query<RowDataPacket[]>(
      `SELECT v.vn, DATE_FORMAT(v.vstdate, '%Y-%m-%d') AS vstdate
       FROM opitemrece oo
       JOIN s_drugitems sd ON sd.icode = oo.icode
       JOIN ovst v ON v.vn = oo.vn
       WHERE v.hn = ?
         AND v.vn <> ?
         AND TRIM(sd.nhso_adp_code) = '12003'
         AND v.vstdate BETWEEN ? AND ?
         AND (v.vstdate < ? OR (v.vstdate = ? AND v.vn < ?))
       ORDER BY v.vstdate ASC, v.vn ASC
       LIMIT 1`,
      [hn, String(visit.vn), fyRange.start, fyRange.end, serviceDate, serviceDate, String(visit.vn)],
    );
    if (fyRows[0]) {
      priorFiscalYear12003 = {
        vn: String(fyRows[0].vn),
        vstdate: sqlDate(fyRows[0].vstdate),
      };
    }
  }

  return {
    vn: String(visit.vn),
    hn,
    serviceDate,
    age: visit.age == null ? null : Number(visit.age),
    ageEligible: Boolean(Number(visit.age_eligible || 0)),
    hasFpgLab: Boolean(Number(visit.has_fpg_lab || 0)),
    noDmDiag: Boolean(Number(visit.no_dm_diag || 0)),
    hasFpgDiag: Boolean(Number(visit.has_fpg_diag || 0)),
    hasFpgAdp: Boolean(Number(visit.has_fpg_adp || 0)),
    priorDmCodes: [...priorDmSet].sort(),
    priorFiscalYear12003,
    catalogItems,
  };
};

const ensureAuditTable = async (connection: HospitalConnection) => {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS z_fdh_fpg_screening_completion_audit (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      vn VARCHAR(13) NOT NULL,
      actor_user_id VARCHAR(64) NULL,
      actor_name VARCHAR(191) NULL,
      before_json LONGTEXT NOT NULL,
      action_json LONGTEXT NOT NULL,
      after_json LONGTEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_fpg_audit_vn (vn),
      KEY idx_fpg_audit_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
};

const syncVnStatDxSlot = async (connection: HospitalConnection, vn: string, diagCode: FpgDiagCode) => {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT pdx, dx0, dx1, dx2, dx3, dx4, dx5 FROM vn_stat WHERE vn = ? LIMIT 1`,
    [vn],
  );
  const v = rows[0];
  if (!v) return;
  const existing = [v.pdx, v.dx0, v.dx1, v.dx2, v.dx3, v.dx4, v.dx5]
    .map((c) => String(c || '').trim().toUpperCase().replace(/\./g, ''));
  if (existing.some((c) => c === 'Z131' || c === 'Z133' || c === 'Z136')) return;

  const slots = ['dx0', 'dx1', 'dx2', 'dx3', 'dx4', 'dx5'] as const;
  const emptySlot = slots.find((slot) => !String(v[slot] || '').trim());
  if (!emptySlot) return;

  await connection.query(`UPDATE vn_stat SET ${emptySlot} = ? WHERE vn = ? LIMIT 1`, [diagCode, vn]);
};

const runCompleteSingleOnConnection = async (
  connection: HospitalConnection,
  vn: string,
  actor: { id?: number | string | null; name?: string | null },
  diagCode: FpgDiagCode,
  catalogItemsCache: FpgCatalogItem[],
  hospitalCode: string,
) => {
  let lockAcquired = false;
  try {
    const [lockRows] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?, 10) AS acquired', [
      `fdh-fpg-screening:${vn}`,
    ]);
    lockAcquired = Number(lockRows[0]?.acquired || 0) === 1;
    if (!lockAcquired) throw new Error('visit นี้กำลังถูกแก้ไขโดยผู้ใช้อื่น กรุณาลองใหม่');

    await connection.beginTransaction();
    const before = assessFpgScreeningCompletion(await loadSnapshot(connection, vn, catalogItemsCache, true));
    if (before.ready) {
      await connection.rollback();
      return {
        vn,
        changed: false,
        insertedDiag: null as string | null,
        insertedAdp: null as { icode: string; adpCode: string; name: string } | null,
        assessment: before,
      };
    }
    if (!before.canComplete) {
      await connection.rollback();
      throw new Error(before.blockers.join(' | '));
    }

    let insertedDiag: string | null = null;
    if (!before.hasFpgDiag) {
      const [diagResult] = await connection.query(`
        INSERT IGNORE INTO ovstdiag
          (ovst_diag_id, vn, icd10, hn, vstdate, vsttime, diagtype, icd103, hcode, doctor, hos_guid, dx_guid, update_datetime)
        SELECT Get_SerialNumber('ovst_diag_id'), o.vn, ?, o.hn, o.vstdate, o.vsttime, '2', LEFT(?, 3),
          COALESCE((SELECT NULLIF(hcode, '') FROM ovstdiag WHERE vn = o.vn LIMIT 1), ?),
          COALESCE((SELECT NULLIF(doctor, '') FROM ovstdiag WHERE vn = o.vn LIMIT 1), NULLIF(o.doctor, '')),
          UPPER(CONCAT('{', UUID(), '}')), UPPER(CONCAT('{', UUID(), '}')), NOW()
        FROM ovst o
        WHERE o.vn = ?
          AND NOT EXISTS (
            SELECT 1 FROM ovstdiag dx
            WHERE dx.vn = o.vn AND REPLACE(UPPER(dx.icd10), '.', '') IN ('Z131', 'Z133', 'Z136')
          )
      `, [diagCode, diagCode, hospitalCode, vn]);
      if (Number((diagResult as { affectedRows?: number }).affectedRows || 0) > 0) {
        insertedDiag = diagCode;
        await syncVnStatDxSlot(connection, vn, diagCode);
      }
    }

    let insertedAdp: { icode: string; adpCode: string; name: string } | null = null;
    if (!before.hasFpgAdp && before.selectedCatalogItem) {
      const item = before.selectedCatalogItem;
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
            WHERE existing.vn = o.vn AND TRIM(sd.nhso_adp_code) = '12003'
          )
      `, [item.icode, item.unitprice, hospitalCode, item.income, item.unitprice, vn]);
      if (Number((insertResult as { affectedRows?: number }).affectedRows || 0) !== 1) {
        throw new Error('เพิ่ม ADP 12003 ไม่สำเร็จหรือมีรายการถูกเพิ่มพร้อมกัน');
      }
      insertedAdp = { icode: item.icode, adpCode: '12003', name: item.name };
    }

    const after = assessFpgScreeningCompletion(await loadSnapshot(connection, vn, catalogItemsCache, true));
    if (!after.ready) {
      throw new Error('ตรวจซ้ำหลังเติมข้อมูลแล้วยังไม่ครบ ระบบยกเลิกการบันทึกทั้งหมด');
    }

    await connection.query(
      `INSERT INTO z_fdh_fpg_screening_completion_audit
         (vn, actor_user_id, actor_name, before_json, action_json, after_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        vn,
        actor.id == null ? null : String(actor.id),
        String(actor.name || '').slice(0, 191) || null,
        JSON.stringify(before),
        JSON.stringify({ insertedDiag, insertedAdp, diagCode }),
        JSON.stringify(after),
      ],
    );
    await connection.commit();
    return {
      vn,
      changed: Boolean(insertedDiag || insertedAdp),
      insertedDiag,
      insertedAdp,
      assessment: after,
    };
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    if (lockAcquired) {
      await connection.query('SELECT RELEASE_LOCK(?)', [`fdh-fpg-screening:${vn}`]).catch(() => undefined);
    }
  }
};

export const completeFpgScreeningVisit = async (
  vn: string,
  actor: { id?: number | string | null; name?: string | null },
  options: { diagCode?: unknown } = {},
) => {
  if (activeHospitalDatabaseConfig.type !== 'mysql') {
    throw new Error('ฐาน HIS PostgreSQL เปิดใช้งานแบบอ่านอย่างเดียว จึงไม่สามารถเติมข้อมูลอัตโนมัติได้');
  }
  const cleanVn = String(vn || '').trim();
  if (!cleanVn) throw new Error('กรุณาระบุ VN');
  const diagCode = normalizeFpgDiagCode(options.diagCode);

  const connection = await getUTFConnection();
  try {
    await ensureAuditTable(connection);
    const [configRows] = await connection.query<RowDataPacket[]>('SELECT hospitalcode FROM opdconfig LIMIT 1');
    const hospitalCode = String(configRows[0]?.hospitalcode || '') || '00000';
    const catalogItems = await loadCatalogItemsFor12003(connection);
    return await runCompleteSingleOnConnection(connection, cleanVn, actor, diagCode, catalogItems, hospitalCode);
  } finally {
    connection.release();
  }
};

export const completeFpgScreeningVisitsBulk = async (
  vns: string[],
  actor: { id?: number | string | null; name?: string | null },
  options: { diagCode?: unknown } = {},
) => {
  if (activeHospitalDatabaseConfig.type !== 'mysql') {
    throw new Error('ฐาน HIS PostgreSQL เปิดใช้งานแบบอ่านอย่างเดียว จึงไม่สามารถเติมข้อมูลอัตโนมัติได้');
  }
  const uniqueVns = [...new Set(vns.map((v) => String(v || '').trim()).filter(Boolean))].slice(0, 500);
  if (uniqueVns.length === 0) throw new Error('ไม่พบรายการ VN ที่ต้องการเติมข้อมูล');
  const diagCode = normalizeFpgDiagCode(options.diagCode);

  const connection = await getUTFConnection();
  try {
    await ensureAuditTable(connection);
    const [configRows] = await connection.query<RowDataPacket[]>('SELECT hospitalcode FROM opdconfig LIMIT 1');
    const hospitalCode = String(configRows[0]?.hospitalcode || '') || '00000';
    const catalogItems = await loadCatalogItemsFor12003(connection);

    let updatedCount = 0;
    let diagAddedCount = 0;
    let adpAddedCount = 0;
    let skippedCount = 0;
    const failed: Array<{ vn: string; error: string }> = [];

    for (const vn of uniqueVns) {
      try {
        const res = await runCompleteSingleOnConnection(connection, vn, actor, diagCode, catalogItems, hospitalCode);
        if (res.changed) {
          updatedCount += 1;
          if (res.insertedDiag) diagAddedCount += 1;
          if (res.insertedAdp) adpAddedCount += 1;
        } else {
          skippedCount += 1;
        }
      } catch (err) {
        failed.push({ vn, error: err instanceof Error ? err.message : 'เติมข้อมูลไม่สำเร็จ' });
      }
    }

    return {
      totalRequested: uniqueVns.length,
      updatedCount,
      diagAddedCount,
      adpAddedCount,
      skippedCount,
      failedCount: failed.length,
      failed: failed.slice(0, 20),
    };
  } finally {
    connection.release();
  }
};
