import type { RowDataPacket } from 'mysql2/promise';
import { activeHospitalDatabaseConfig, type HospitalConnection } from './hospitalDatabase.js';
import { getUTFConnection, getAppSetting } from './db.js';
import { toIsoDate } from './fundEligibility.js';

export interface ChangeRightCompletionSnapshot {
  vn: string;
  hn: string;
  an: string;
  serviceDate: string;
  pttype: string;
  hipdataCode: string;
  hospmain: string;
  hospitalCode: string;
  beginDate: string;
  daysSinceBegin: number | null;
  ucaeCode: string;
  hadPrevOtherHmain: boolean;
  prevHospmain: string;
  zeroPriceWalkinCount: number;
  zeroPriceWalkinIcodes: string[];
  allowFirstVisitConfirm?: boolean;
}

export interface ChangeRightCompletionAssessment extends ChangeRightCompletionSnapshot {
  isOpd: boolean;
  isUcWel: boolean;
  isOwnHospMain: boolean;
  hasUcaeC: boolean;
  within15Days: boolean;
  ready: boolean;
  canComplete: boolean;
  needsUcaeC: boolean;
  needsWalkinCleanup: boolean;
  missing: string[];
  blockers: string[];
}

const sqlDate = (value: unknown) => toIsoDate(value) || '';

/**
 * Evaluate whether a visit qualifies for immediate right-change (HC16 / UCAE = 'C') auto-completion.
 */
export const assessChangeRightCompletion = (
  snapshot: ChangeRightCompletionSnapshot,
): ChangeRightCompletionAssessment => {
  const an = String(snapshot.an || '').trim();
  const isOpd = !an;
  const hipdataUpper = String(snapshot.hipdataCode || '').trim().toUpperCase();
  const isUcWel = hipdataUpper === 'UCS' || hipdataUpper === 'WEL';
  const hospmain = String(snapshot.hospmain || '').trim();
  const hospitalCode = String(snapshot.hospitalCode || '').trim();
  const isOwnHospMain = Boolean(hospitalCode) && hospmain === hospitalCode;
  const ucaeUpper = String(snapshot.ucaeCode || '').trim().toUpperCase();
  const hasUcaeC = ucaeUpper === 'C';
  const days = snapshot.daysSinceBegin;
  const within15Days = days !== null && Number.isFinite(days) && days >= 0 && days <= 15;
  const zeroWalkinCount = Number(snapshot.zeroPriceWalkinCount || 0);
  const needsUcaeC = !hasUcaeC;
  const needsWalkinCleanup = zeroWalkinCount > 0;

  const missing: string[] = [];
  if (needsUcaeC) missing.push('UCAE = C (ย้ายหน่วยบริการเกิดสิทธิทันที)');
  if (needsWalkinCleanup) missing.push(`ตัดรหัส WALKIN ที่ซ้ำซ้อน (${zeroWalkinCount} รายการ)`);

  const blockers: string[] = [];
  if (!isOpd) blockers.push('ไม่ใช่ผู้ป่วยนอก (OPD)');
  if (!isUcWel) blockers.push('ไม่ใช่สิทธิบัตรทอง (UCS / WEL)');
  if (!isOwnHospMain) {
    blockers.push(`HMAIN (${hospmain || '-'}) ยังไม่ใช่ รพ.ตนเอง (${hospitalCode || '-'})`);
  }
  if (needsUcaeC && !within15Days) {
    blockers.push('วันเริ่มสิทธิเกิน 15 วันหรือไม่พบ begin_date ใน visit_pttype');
  }
  if (needsUcaeC && !snapshot.hadPrevOtherHmain && !snapshot.allowFirstVisitConfirm) {
    blockers.push('ไม่พบประวัติ hospmain รพ.อื่นมาก่อนใน HOSxP (กรุณาตรวจสิทธิ สปสช. และกดยืนยันรายกรณี)');
  }

  const ready = isOpd && isUcWel && isOwnHospMain && hasUcaeC && !needsWalkinCleanup;
  const canComplete = !ready && blockers.length === 0 && (needsUcaeC || needsWalkinCleanup);

  return {
    ...snapshot,
    ucaeCode: ucaeUpper,
    isOpd,
    isUcWel,
    isOwnHospMain,
    hasUcaeC,
    within15Days,
    ready,
    canComplete,
    needsUcaeC,
    needsWalkinCleanup,
    missing,
    blockers,
  };
};

const ensureAuditTable = async (connection: HospitalConnection) => {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS z_fdh_change_right_audit (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      vn VARCHAR(25) NOT NULL,
      hn VARCHAR(25) NULL,
      vstdate VARCHAR(10) NULL,
      previous_ucae_code VARCHAR(16) NULL,
      new_ucae_code VARCHAR(16) NULL,
      removed_walkin_icodes VARCHAR(255) NULL,
      removed_walkin_count INT NOT NULL DEFAULT 0,
      had_prev_other_hmain TINYINT(1) NOT NULL DEFAULT 0,
      days_since_begin INT NULL,
      actor_user_id VARCHAR(64) NULL,
      actor_name VARCHAR(191) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_cr_audit_vn (vn),
      KEY idx_cr_audit_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
};

const loadWalkinIcode = async (): Promise<string> => {
  try {
    const siteSettings = await getAppSetting('site_settings') as Record<string, unknown> | null;
    return String(siteSettings?.uc_walkin_icode || '').trim();
  } catch {
    return '';
  }
};

const loadChangeRightSnapshot = async (
  connection: HospitalConnection,
  vn: string,
  hospitalCode: string,
  walkinIcode: string,
  allowFirstVisitConfirm: boolean,
): Promise<ChangeRightCompletionSnapshot> => {
  const [rows] = await connection.query<RowDataPacket[]>(`
    SELECT
      o.vn,
      o.hn,
      COALESCE(o.an, '') AS an,
      o.vstdate,
      o.pttype,
      UPPER(COALESCE(p.hipdata_code, '')) AS hipdata_code,
      COALESCE(o.hospmain, '') AS hospmain,
      vp.begin_date,
      CASE WHEN vp.begin_date IS NOT NULL THEN DATEDIFF(o.vstdate, vp.begin_date) ELSE NULL END AS days_since_begin,
      UPPER(TRIM(COALESCE(vp.nhso_ucae_type_code, ''))) AS ucae_code,
      (
        SELECT prev.hospmain
        FROM ovst prev
        WHERE prev.hn = o.hn
          AND prev.vstdate < o.vstdate
          AND COALESCE(prev.hospmain, '') <> ''
          AND prev.hospmain <> ?
        ORDER BY prev.vstdate DESC, prev.vsttime DESC
        LIMIT 1
      ) AS prev_hospmain
    FROM ovst o
    LEFT JOIN pttype p ON p.pttype = o.pttype
    LEFT JOIN visit_pttype vp ON vp.vn = o.vn AND vp.pttype = o.pttype
    WHERE o.vn = ?
    LIMIT 1
  `, [hospitalCode, vn]);

  const row = rows[0];
  if (!row) {
    throw new Error(`ไม่พบข้อมูล VN ${vn} ในตาราง ovst`);
  }

  const walkinClause = walkinIcode
    ? `(oi.icode = ? OR UPPER(COALESCE(sd.nhso_adp_code, '')) = 'WALKIN' OR UPPER(COALESCE(nd.nhso_adp_code, '')) = 'WALKIN')`
    : `(UPPER(COALESCE(sd.nhso_adp_code, '')) = 'WALKIN' OR UPPER(COALESCE(nd.nhso_adp_code, '')) = 'WALKIN')`;
  const walkinParams = walkinIcode ? [vn, walkinIcode] : [vn];

  const [walkinRows] = await connection.query<RowDataPacket[]>(`
    SELECT oi.icode
    FROM opitemrece oi
    LEFT JOIN s_drugitems sd ON sd.icode = oi.icode
    LEFT JOIN nondrugitems nd ON nd.icode = oi.icode
    WHERE oi.vn = ?
      AND COALESCE(oi.sum_price, 0) = 0
      AND ${walkinClause}
  `, walkinParams);

  const zeroPriceWalkinIcodes = walkinRows
    .map((w) => String(w.icode || '').trim())
    .filter(Boolean);

  return {
    vn: String(row.vn || vn),
    hn: String(row.hn || ''),
    an: String(row.an || ''),
    serviceDate: sqlDate(row.vstdate),
    pttype: String(row.pttype || ''),
    hipdataCode: String(row.hipdata_code || ''),
    hospmain: String(row.hospmain || ''),
    hospitalCode,
    beginDate: sqlDate(row.begin_date),
    daysSinceBegin: row.days_since_begin == null ? null : Number(row.days_since_begin),
    ucaeCode: String(row.ucae_code || ''),
    prevHospmain: String(row.prev_hospmain || ''),
    hadPrevOtherHmain: Boolean(String(row.prev_hospmain || '').trim()),
    zeroPriceWalkinCount: zeroPriceWalkinIcodes.length,
    zeroPriceWalkinIcodes,
    allowFirstVisitConfirm,
  };
};

const runCompleteSingleOnConnection = async (
  connection: HospitalConnection,
  vn: string,
  actor: { id?: number | string | null; name?: string | null },
  hospitalCode: string,
  walkinIcode: string,
  confirmFirstVisit: boolean,
) => {
  let lockAcquired = false;
  try {
    const [lockRows] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?, 10) AS acquired', [
      `fdh-change-right:${vn}`,
    ]);
    lockAcquired = Number(lockRows[0]?.acquired || 0) === 1;
    if (!lockAcquired) throw new Error('visit นี้กำลังถูกแก้ไขโดยผู้ใช้อื่น กรุณาลองใหม่');

    await connection.beginTransaction();
    const before = assessChangeRightCompletion(
      await loadChangeRightSnapshot(connection, vn, hospitalCode, walkinIcode, confirmFirstVisit),
    );
    if (before.ready) {
      await connection.rollback();
      return {
        vn,
        changed: false,
        ucaeUpdated: false,
        walkinRemovedCount: 0,
        assessment: before,
      };
    }
    if (!before.canComplete) {
      await connection.rollback();
      throw new Error(before.blockers.join(' | '));
    }

    let ucaeUpdated = false;
    if (before.needsUcaeC) {
      const [upd] = await connection.query(
        `UPDATE visit_pttype
         SET nhso_ucae_type_code = 'C', update_datetime = NOW()
         WHERE vn = ? AND pttype = ?`,
        [vn, before.pttype],
      );
      let affected = Number((upd as { affectedRows?: number }).affectedRows || 0);
      if (affected === 0) {
        const [fallbackUpd] = await connection.query(
          `UPDATE visit_pttype
           SET nhso_ucae_type_code = 'C', update_datetime = NOW()
           WHERE vn = ?
           ORDER BY pttype_order ASC
           LIMIT 1`,
          [vn],
        );
        affected = Number((fallbackUpd as { affectedRows?: number }).affectedRows || 0);
      }
      if (affected === 0) {
        throw new Error(`ไม่พบแถวใน visit_pttype สำหรับ VN ${vn}`);
      }
      ucaeUpdated = true;
    }

    let walkinRemovedCount = 0;
    const removedIcodes: string[] = [];
    if (before.needsWalkinCleanup && before.zeroPriceWalkinIcodes.length > 0) {
      removedIcodes.push(...before.zeroPriceWalkinIcodes);
      const uniqueIcodes = [...new Set(before.zeroPriceWalkinIcodes)];
      const [del] = await connection.query(
        `DELETE FROM opitemrece
         WHERE vn = ?
           AND COALESCE(sum_price, 0) = 0
           AND icode IN (${uniqueIcodes.map(() => '?').join(',')})`,
        [vn, ...uniqueIcodes],
      );
      walkinRemovedCount = Number((del as { affectedRows?: number }).affectedRows || 0);
    }

    const after = assessChangeRightCompletion(
      await loadChangeRightSnapshot(connection, vn, hospitalCode, walkinIcode, true),
    );
    if (!after.ready) {
      throw new Error('ตรวจซ้ำหลังแก้ไขแล้วยังไม่ผ่านเกณฑ์ ระบบยกเลิกการเปลี่ยนแปลงทั้งหมด');
    }

    await connection.query(
      `INSERT INTO z_fdh_change_right_audit
         (vn, hn, vstdate, previous_ucae_code, new_ucae_code, removed_walkin_icodes, removed_walkin_count, had_prev_other_hmain, days_since_begin, actor_user_id, actor_name)
       VALUES (?, ?, ?, ?, 'C', ?, ?, ?, ?, ?, ?)`,
      [
        vn,
        before.hn || null,
        before.serviceDate || null,
        before.ucaeCode || null,
        removedIcodes.join(',').slice(0, 255) || null,
        walkinRemovedCount,
        before.hadPrevOtherHmain ? 1 : 0,
        before.daysSinceBegin,
        actor.id == null ? null : String(actor.id),
        String(actor.name || '').slice(0, 191) || null,
      ],
    );

    await connection.commit();
    return {
      vn,
      changed: Boolean(ucaeUpdated || walkinRemovedCount > 0),
      ucaeUpdated,
      walkinRemovedCount,
      assessment: after,
    };
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    if (lockAcquired) {
      await connection.query('SELECT RELEASE_LOCK(?)', [`fdh-change-right:${vn}`]).catch(() => undefined);
    }
  }
};

/**
 * Auto-complete a single CHANGE_RIGHT visit in HOSxP (set nhso_ucae_type_code = 'C' and remove conflicting zero-price WALKIN rows).
 */
export const completeChangeRightVisit = async (
  vn: string,
  actor: { id?: number | string | null; name?: string | null },
  options: { confirmFirstVisit?: boolean } = {},
) => {
  if (activeHospitalDatabaseConfig.type !== 'mysql') {
    throw new Error('ฐาน HIS PostgreSQL เปิดใช้งานแบบอ่านอย่างเดียว จึงไม่สามารถเติมข้อมูลอัตโนมัติได้');
  }
  const cleanVn = String(vn || '').trim();
  if (!cleanVn) throw new Error('กรุณาระบุ VN');

  const walkinIcode = await loadWalkinIcode();
  const connection = await getUTFConnection();
  try {
    await ensureAuditTable(connection);
    const [configRows] = await connection.query<RowDataPacket[]>('SELECT hospitalcode FROM opdconfig LIMIT 1');
    const hospitalCode = String(configRows[0]?.hospitalcode || '').trim();
    return await runCompleteSingleOnConnection(
      connection,
      cleanVn,
      actor,
      hospitalCode,
      walkinIcode,
      Boolean(options.confirmFirstVisit),
    );
  } finally {
    connection.release();
  }
};

/**
 * Bulk auto-complete eligible CHANGE_RIGHT visits in HOSxP.
 */
export const completeChangeRightVisitsBulk = async (
  vns: string[],
  actor: { id?: number | string | null; name?: string | null },
  options: { confirmFirstVisit?: boolean } = {},
) => {
  if (activeHospitalDatabaseConfig.type !== 'mysql') {
    throw new Error('ฐาน HIS PostgreSQL เปิดใช้งานแบบอ่านอย่างเดียว จึงไม่สามารถเติมข้อมูลอัตโนมัติได้');
  }
  const uniqueVns = [...new Set(vns.map((v) => String(v || '').trim()).filter(Boolean))].slice(0, 300);
  if (uniqueVns.length === 0) throw new Error('ไม่พบรายการ VN ที่ต้องการเติมข้อมูล');

  const walkinIcode = await loadWalkinIcode();
  const connection = await getUTFConnection();
  try {
    await ensureAuditTable(connection);
    const [configRows] = await connection.query<RowDataPacket[]>('SELECT hospitalcode FROM opdconfig LIMIT 1');
    const hospitalCode = String(configRows[0]?.hospitalcode || '').trim();

    let updatedCount = 0;
    let ucaeUpdatedCount = 0;
    let walkinRemovedCount = 0;
    let skippedCount = 0;
    const failed: Array<{ vn: string; error: string }> = [];

    for (const vn of uniqueVns) {
      try {
        const res = await runCompleteSingleOnConnection(
          connection,
          vn,
          actor,
          hospitalCode,
          walkinIcode,
          Boolean(options.confirmFirstVisit),
        );
        if (res.changed) {
          updatedCount += 1;
          if (res.ucaeUpdated) ucaeUpdatedCount += 1;
          walkinRemovedCount += res.walkinRemovedCount;
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
      ucaeUpdatedCount,
      walkinRemovedCount,
      skippedCount,
      failedCount: failed.length,
      failed: failed.slice(0, 20),
    };
  } finally {
    connection.release();
  }
};
