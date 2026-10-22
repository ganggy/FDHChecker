import { getUTFConnection } from './db/connection.js';
import type { HospitalConnection } from './hospitalDatabase.js';
import { getAppSetting } from './repositories/system.repository.js';

export interface DeleteIpdWalkinOptions {
  ans?: string[];
  vns?: string[];
  startDate?: string;
  endDate?: string;
  actor?: string;
}

export interface DeleteIpdWalkinResult {
  deletedCount: number;
  affectedAns: string[];
  affectedVns: string[];
  deletedItems: Array<{
    hos_guid?: string;
    an?: string;
    vn?: string;
    hn?: string;
    icode?: string;
    item_name?: string;
  }>;
}

/**
 * Check if a given code / icode corresponds to a WALKIN service item
 */
export const isWalkinAdpItem = (code?: unknown, icode?: unknown, walkinIcode?: unknown): boolean => {
  const c = String(code ?? '').trim().toUpperCase();
  const ic = String(icode ?? '').trim().toUpperCase();
  const targetWalkinIcode = String(walkinIcode ?? '').trim().toUpperCase();
  return c === 'WALKIN'
    || c.includes('WALKIN')
    || (Boolean(targetWalkinIcode) && (ic === targetWalkinIcode || c === targetWalkinIcode));
};

/**
 * Filters out WALKIN records from ADP rows for IPD admissions
 */
export const filterIpdWalkinFromAdp = <T extends Record<string, unknown>>(
  rows: T[],
  options?: { isIpdExport?: boolean; walkinIcode?: string }
): T[] => {
  return rows.filter((row) => {
    const an = String(row.AN ?? '').trim();
    const code = String(row.CODE ?? '');
    const icode = String(row._ICODE ?? row.ICODE ?? '');
    const isIpd = Boolean(options?.isIpdExport || an);
    if (isIpd && isWalkinAdpItem(code, icode, options?.walkinIcode)) {
      return false;
    }
    return true;
  });
};

/**
 * Automatically detects and deletes any WALKIN fee items from opitemrece
 * for Inpatient (IPD) admissions immediately.
 * Archived to z_fdh_ipd_walkin_delete_audit before removal.
 */
export const deleteIpdWalkinFees = async (
  connection: HospitalConnection,
  options?: DeleteIpdWalkinOptions
): Promise<DeleteIpdWalkinResult> => {
  const emptyResult: DeleteIpdWalkinResult = {
    deletedCount: 0,
    affectedAns: [],
    affectedVns: [],
    deletedItems: [],
  };

  try {
    const siteSettings = await getAppSetting<Record<string, unknown>>('site_settings').catch(() => null);
    const walkinIcode = String(siteSettings?.uc_walkin_icode || '').trim();

    // 1. Gather all walkin icodes from s_drugitems, nondrugitems, and siteSettings
    const [matchingIcodesRows] = await connection.query(`
      SELECT DISTINCT icode FROM (
        SELECT icode FROM s_drugitems WHERE nhso_adp_code = 'WALKIN' OR UPPER(name) LIKE '%WALKIN%'
        UNION
        SELECT icode FROM nondrugitems WHERE nhso_adp_code = 'WALKIN' OR UPPER(name) LIKE '%WALKIN%'
        ${walkinIcode ? `UNION SELECT '${walkinIcode.replace(/'/g, "''")}' AS icode` : ''}
      ) t WHERE icode IS NOT NULL AND TRIM(icode) <> ''
    `);
    const icodes = (matchingIcodesRows as Array<{ icode: string }>).map(r => String(r.icode || '').trim()).filter(Boolean);
    if (icodes.length === 0 && !walkinIcode) {
      return emptyResult;
    }
    const icodeList = Array.from(new Set(icodes));
    const icodePlaceholders = icodeList.map(() => '?').join(',');

    // 2. Build target IPD condition
    let targetCondition = '';
    const queryParams: any[] = [];

    const cleanAns = (options?.ans || []).map(a => String(a || '').trim()).filter(Boolean);
    const cleanVns = (options?.vns || []).map(v => String(v || '').trim()).filter(Boolean);

    if (cleanAns.length > 0) {
      const anPlaceholders = cleanAns.map(() => '?').join(',');
      targetCondition = `(
        (opi.an IS NOT NULL AND TRIM(opi.an) <> '' AND opi.an IN (${anPlaceholders}))
        OR (opi.vn IN (SELECT vn FROM ipt WHERE an IN (${anPlaceholders})))
      )`;
      queryParams.push(...cleanAns, ...cleanAns);
    } else if (cleanVns.length > 0) {
      const vnPlaceholders = cleanVns.map(() => '?').join(',');
      targetCondition = `(
        (opi.an IN (SELECT an FROM ipt WHERE vn IN (${vnPlaceholders})))
        OR (opi.vn IN (${vnPlaceholders}) AND EXISTS (SELECT 1 FROM ipt WHERE ipt.vn = opi.vn))
      )`;
      queryParams.push(...cleanVns, ...cleanVns);
    } else if (options?.startDate && options?.endDate) {
      targetCondition = `(
        (opi.an IN (SELECT an FROM ipt WHERE regdate BETWEEN ? AND ? OR dchdate BETWEEN ? AND ?))
        OR (opi.vn IN (SELECT vn FROM ipt WHERE regdate BETWEEN ? AND ? OR dchdate BETWEEN ? AND ?))
      )`;
      queryParams.push(options.startDate, options.endDate, options.startDate, options.endDate, options.startDate, options.endDate, options.startDate, options.endDate);
    } else {
      targetCondition = `(
        (opi.an IS NOT NULL AND TRIM(opi.an) <> '')
        OR EXISTS (SELECT 1 FROM ipt WHERE ipt.vn = opi.vn)
        OR EXISTS (SELECT 1 FROM ovst WHERE ovst.vn = opi.vn AND ovst.an IS NOT NULL AND TRIM(ovst.an) <> '')
      )`;
    }

    // 3. Find candidate items before deleting
    const selectSql = `
      SELECT opi.hos_guid, opi.an, opi.vn, opi.hn, opi.icode, opi.unitprice, opi.sum_price, opi.qty,
             COALESCE(sd.name, nd.name, opi.icode) AS item_name
      FROM opitemrece opi
      LEFT JOIN s_drugitems sd ON sd.icode = opi.icode
      LEFT JOIN nondrugitems nd ON nd.icode = opi.icode
      WHERE ${targetCondition}
        AND opi.icode IN (${icodePlaceholders})
    `;
    const [candidates] = await connection.query(selectSql, [...queryParams, ...icodeList]);
    const candidateRows = (candidates as Array<Record<string, unknown>>) || [];
    if (candidateRows.length === 0) {
      return emptyResult;
    }

    // 4. Archive into audit table
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS z_fdh_ipd_walkin_delete_audit (
          id INT AUTO_INCREMENT PRIMARY KEY,
          hos_guid VARCHAR(50) NULL,
          an VARCHAR(15) NULL,
          vn VARCHAR(15) NULL,
          hn VARCHAR(15) NULL,
          icode VARCHAR(10) NULL,
          item_name VARCHAR(250) NULL,
          unitprice DECIMAL(10,2) NULL,
          sum_price DECIMAL(10,2) NULL,
          qty INT NULL,
          deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          deleted_by VARCHAR(100) DEFAULT 'system_auto_ipd_clean',
          INDEX idx_an (an),
          INDEX idx_vn (vn)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      const actor = String(options?.actor || 'system_auto_ipd_clean').slice(0, 100);
      for (const row of candidateRows) {
        await connection.query(`
          INSERT INTO z_fdh_ipd_walkin_delete_audit (hos_guid, an, vn, hn, icode, item_name, unitprice, sum_price, qty, deleted_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          row.hos_guid || null,
          row.an || null,
          row.vn || null,
          row.hn || null,
          row.icode || null,
          row.item_name || null,
          Number(row.unitprice || 0),
          Number(row.sum_price || 0),
          Number(row.qty || 1),
          actor,
        ]);
      }
    } catch (auditErr) {
      console.warn('⚠️ Could not write to z_fdh_ipd_walkin_delete_audit:', auditErr);
    }

    // 5. Delete items from opitemrece
    const guids = candidateRows.map(r => String(r.hos_guid || '')).filter(Boolean);
    let deletedCount = 0;
    if (guids.length > 0) {
      const guidPlaceholders = guids.map(() => '?').join(',');
      const [delResult] = await connection.query(
        `DELETE FROM opitemrece WHERE hos_guid IN (${guidPlaceholders})`,
        guids
      );
      deletedCount = Number((delResult as { affectedRows?: number })?.affectedRows || 0);
    } else {
      const [delResult] = await connection.query(
        `DELETE opi FROM opitemrece opi WHERE ${targetCondition} AND opi.icode IN (${icodePlaceholders})`,
        [...queryParams, ...icodeList]
      );
      deletedCount = Number((delResult as { affectedRows?: number })?.affectedRows || 0);
    }

    const affectedAns = Array.from(new Set(candidateRows.map(r => String(r.an || '')).filter(Boolean)));
    const affectedVns = Array.from(new Set(candidateRows.map(r => String(r.vn || '')).filter(Boolean)));
    console.log(`🧹 [IPD Clean] Deleted ${deletedCount} walkin service item(s) from opitemrece for IPD cases (affected ANs: ${affectedAns.join(', ') || 'N/A'})`);

    return {
      deletedCount,
      affectedAns,
      affectedVns,
      deletedItems: candidateRows.map(r => ({
        hos_guid: String(r.hos_guid || ''),
        an: String(r.an || ''),
        vn: String(r.vn || ''),
        hn: String(r.hn || ''),
        icode: String(r.icode || ''),
        item_name: String(r.item_name || ''),
      })),
    };
  } catch (error) {
    console.error('❌ Error in deleteIpdWalkinFees:', error);
    return emptyResult;
  }
};
