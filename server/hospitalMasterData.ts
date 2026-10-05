import type { HospitalConnection } from './hospitalDatabase.js';
import { activeHospitalDatabaseConfig } from './hospitalDatabase.js';
import { readHospitalSchema } from './hospitalSchema.js';

export const MASTER_DATA_OVERRIDES_KEY = 'hospital_master_data_overrides';

export type MasterCatalogType = 'drugs' | 'nondrugs' | 'pttypes';

export interface MasterDataItem {
  code: string;
  name: string;
  detail?: string;
  currentValues: Record<string, string>;
  overrideValues: Record<string, string>;
  effectiveValues: Record<string, string>;
  isComplete: boolean;
  missingFields: string[];
  usageCount?: number;
}

export interface MasterDataCatalogSummary {
  catalog: MasterCatalogType;
  catalogName: string;
  total: number;
  incomplete: number;
  completed: number;
  percent: number;
}

export interface MasterDataQueryResult {
  summary: MasterDataCatalogSummary;
  items: MasterDataItem[];
  totalMatches: number;
}

export interface MasterDataOverrideStore {
  drugs?: Record<string, { tmt_code?: string; updatedAt?: string; updatedBy?: string }>;
  nondrugs?: Record<string, { nhso_adp_code?: string; billcode?: string; updatedAt?: string; updatedBy?: string }>;
  pttypes?: Record<string, { hipdata_code?: string; pcode?: string; updatedAt?: string; updatedBy?: string }>;
}

export async function getMasterDataOverrides(): Promise<MasterDataOverrideStore> {
  try {
    const { getAppSetting } = await import('./repositories/system.repository.js');
    const data = await getAppSetting<MasterDataOverrideStore>(MASTER_DATA_OVERRIDES_KEY);
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

export async function saveMasterDataOverrides(
  catalog: MasterCatalogType,
  updates: Array<{ code: string; [key: string]: unknown }>,
  username = 'system'
): Promise<MasterDataOverrideStore> {
  const store = await getMasterDataOverrides();
  const targetCatalog = store[catalog] || {};
  const timestamp = new Date().toISOString();

  for (const item of updates) {
    const code = String(item.code || '').trim();
    if (!code) continue;

    if (catalog === 'drugs') {
      const tmt_code = String(item.tmt_code ?? item.didstd ?? '').trim();
      if (tmt_code) {
        targetCatalog[code] = { tmt_code, updatedAt: timestamp, updatedBy: username };
      } else {
        delete targetCatalog[code];
      }
    } else if (catalog === 'nondrugs') {
      const nhso_adp_code = String(item.nhso_adp_code ?? '').trim();
      const billcode = String(item.billcode ?? '').trim();
      if (nhso_adp_code || billcode) {
        targetCatalog[code] = { nhso_adp_code, billcode, updatedAt: timestamp, updatedBy: username };
      } else {
        delete targetCatalog[code];
      }
    } else if (catalog === 'pttypes') {
      const hipdata_code = String(item.hipdata_code ?? '').trim().toUpperCase();
      const pcode = String(item.pcode ?? '').trim().toUpperCase();
      if (hipdata_code || pcode) {
        targetCatalog[code] = { hipdata_code, pcode, updatedAt: timestamp, updatedBy: username };
      } else {
        delete targetCatalog[code];
      }
    }
  }

  store[catalog] = targetCatalog;
  const { setAppSetting } = await import('./repositories/system.repository.js');
  await setAppSetting(MASTER_DATA_OVERRIDES_KEY, store);
  return store;
}

/**
 * Queries master data items, merges FDH Checker overrides, and identifies incomplete entries
 */
export async function queryHospitalMasterData(
  connection: HospitalConnection,
  options: {
    catalog: MasterCatalogType;
    filter?: 'incomplete' | 'completed' | 'all';
    search?: string;
    limit?: number;
    offset?: number;
    overrides?: MasterDataOverrideStore;
  }
): Promise<MasterDataQueryResult> {
  const { catalog, filter = 'incomplete', search = '', limit = 100, offset = 0 } = options;
  const store = options.overrides || await getMasterDataOverrides();
  const catalogOverrides = store[catalog] || {};

  const tablesToCheck = ['drugitems', 'nondrugitems', 'pttype', 'opitemrece'];
  const hasSchema = await readHospitalSchema(connection, tablesToCheck);

  if (catalog === 'drugs') {
    return queryDrugItems(connection, hasSchema, catalogOverrides as Record<string, { tmt_code?: string }>, { filter, search, limit, offset });
  } else if (catalog === 'nondrugs') {
    return queryNonDrugItems(connection, hasSchema, catalogOverrides as Record<string, { nhso_adp_code?: string; billcode?: string }>, { filter, search, limit, offset });
  } else {
    return queryPttypeItems(connection, hasSchema, catalogOverrides as Record<string, { hipdata_code?: string; pcode?: string }>, { filter, search, limit, offset });
  }
}

async function queryDrugItems(
  connection: HospitalConnection,
  hasSchema: (table: string, ...cols: string[]) => boolean,
  overrides: Record<string, { tmt_code?: string }>,
  options: { filter: string; search: string; limit: number; offset: number }
): Promise<MasterDataQueryResult> {
  if (!hasSchema('drugitems')) {
    return {
      summary: { catalog: 'drugs', catalogName: 'รายการยา (drugitems)', total: 0, incomplete: 0, completed: 0, percent: 0 },
      items: [],
      totalMatches: 0,
    };
  }

  const hasDidStd = hasSchema('drugitems', 'didstd');
  const hasDid = hasSchema('drugitems', 'did');
  const hasStrength = hasSchema('drugitems', 'strength');
  const hasUnits = hasSchema('drugitems', 'units');
  const hasIstatus = hasSchema('drugitems', 'istatus');

  const statusClause = hasIstatus ? "WHERE (istatus = 'Y' OR istatus IS NULL OR istatus = '')" : '';

  const sql = `
    SELECT 
      icode, 
      name
      ${hasStrength ? ', strength' : ''}
      ${hasUnits ? ', units' : ''}
      ${hasDidStd ? ', didstd' : ''}
      ${hasDid ? ', did' : ''}
    FROM drugitems
    ${statusClause}
    ORDER BY name ASC
  `;

  const [rows] = await connection.query(sql);
  const rawList = (rows as Record<string, unknown>[]) || [];

  let total = 0;
  let incomplete = 0;
  let completed = 0;

  const allItems: MasterDataItem[] = [];

  for (const row of rawList) {
    total += 1;
    const code = String(row.icode || '').trim();
    const name = String(row.name || '').trim();
    const strength = hasStrength ? String(row.strength || '').trim() : '';
    const units = hasUnits ? String(row.units || '').trim() : '';
    const didstd = hasDidStd ? String(row.didstd || '').trim() : '';
    const did = hasDid ? String(row.did || '').trim() : '';

    const override = overrides[code];
    const overrideTmt = override?.tmt_code ? String(override.tmt_code).trim() : '';

    const effectiveTmt = overrideTmt || (didstd.length === 24 ? didstd : did.length === 24 ? did : didstd || did);
    const isComplete = effectiveTmt.length === 24;

    if (isComplete) completed += 1;
    else incomplete += 1;

    const missingFields: string[] = [];
    if (!isComplete) {
      if (!effectiveTmt) {
        missingFields.push('ยังไม่มีรหัส TMT 24 หลัก');
      } else {
        missingFields.push(`รหัส TMT ไม่ครบ 24 หลัก (ปัจจุบัน ${effectiveTmt.length} หลัก)`);
      }
    }

    const detail = [strength, units].filter(Boolean).join(' ');

    allItems.push({
      code,
      name,
      detail: detail || undefined,
      currentValues: { didstd, did },
      overrideValues: overrideTmt ? { tmt_code: overrideTmt } : {},
      effectiveValues: { tmt_code: effectiveTmt },
      isComplete,
      missingFields,
    });
  }

  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const summary: MasterDataCatalogSummary = {
    catalog: 'drugs',
    catalogName: 'รายการยา (drugitems)',
    total,
    incomplete,
    completed,
    percent,
  };

  const searchKeyword = options.search.toLowerCase().trim();
  const filtered = allItems.filter(item => {
    if (options.filter === 'incomplete' && item.isComplete) return false;
    if (options.filter === 'completed' && !item.isComplete) return false;
    if (searchKeyword) {
      const matchName = item.name.toLowerCase().includes(searchKeyword);
      const matchCode = item.code.toLowerCase().includes(searchKeyword);
      const matchTmt = (item.effectiveValues.tmt_code || '').toLowerCase().includes(searchKeyword);
      if (!matchName && !matchCode && !matchTmt) return false;
    }
    return true;
  });

  const paged = filtered.slice(options.offset, options.offset + options.limit);

  return {
    summary,
    items: paged,
    totalMatches: filtered.length,
  };
}

async function queryNonDrugItems(
  connection: HospitalConnection,
  hasSchema: (table: string, ...cols: string[]) => boolean,
  overrides: Record<string, { nhso_adp_code?: string; billcode?: string }>,
  options: { filter: string; search: string; limit: number; offset: number }
): Promise<MasterDataQueryResult> {
  if (!hasSchema('nondrugitems')) {
    return {
      summary: { catalog: 'nondrugs', catalogName: 'ค่าบริการ/หัตถการ/แล็บ (nondrugitems)', total: 0, incomplete: 0, completed: 0, percent: 0 },
      items: [],
      totalMatches: 0,
    };
  }

  const hasNhsoAdp = hasSchema('nondrugitems', 'nhso_adp_code');
  const hasBillcode = hasSchema('nondrugitems', 'billcode');
  const hasPrice = hasSchema('nondrugitems', 'price');
  const hasIstatus = hasSchema('nondrugitems', 'istatus');

  const statusClause = hasIstatus ? "WHERE (istatus = 'Y' OR istatus IS NULL OR istatus = '')" : '';

  const sql = `
    SELECT 
      icode, 
      name
      ${hasPrice ? ', price' : ''}
      ${hasNhsoAdp ? ', nhso_adp_code' : ''}
      ${hasBillcode ? ', billcode' : ''}
    FROM nondrugitems
    ${statusClause}
    ORDER BY name ASC
  `;

  const [rows] = await connection.query(sql);
  const rawList = (rows as Record<string, unknown>[]) || [];

  let total = 0;
  let incomplete = 0;
  let completed = 0;

  const allItems: MasterDataItem[] = [];

  for (const row of rawList) {
    total += 1;
    const code = String(row.icode || '').trim();
    const name = String(row.name || '').trim();
    const price = hasPrice ? Number(row.price || 0) : 0;
    const currentAdp = hasNhsoAdp ? String(row.nhso_adp_code || '').trim() : '';
    const currentBillcode = hasBillcode ? String(row.billcode || '').trim() : '';

    const override = overrides[code];
    const overrideAdp = override?.nhso_adp_code ? String(override.nhso_adp_code).trim() : '';
    const overrideBillcode = override?.billcode ? String(override.billcode).trim() : '';

    const effectiveAdp = overrideAdp || currentAdp;
    const effectiveBillcode = overrideBillcode || currentBillcode;

    const isComplete = Boolean(effectiveAdp || effectiveBillcode);

    if (isComplete) completed += 1;
    else incomplete += 1;

    const missingFields: string[] = [];
    if (!isComplete) {
      missingFields.push('ยังไม่มีรหัส ADP สปสช. หรือ Billcode');
    }

    allItems.push({
      code,
      name,
      detail: price > 0 ? `ราคา ${price.toLocaleString()} บาท` : undefined,
      currentValues: { nhso_adp_code: currentAdp, billcode: currentBillcode },
      overrideValues: { ...(overrideAdp ? { nhso_adp_code: overrideAdp } : {}), ...(overrideBillcode ? { billcode: overrideBillcode } : {}) },
      effectiveValues: { nhso_adp_code: effectiveAdp, billcode: effectiveBillcode },
      isComplete,
      missingFields,
    });
  }

  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const summary: MasterDataCatalogSummary = {
    catalog: 'nondrugs',
    catalogName: 'ค่าบริการ/หัตถการ/แล็บ (nondrugitems)',
    total,
    incomplete,
    completed,
    percent,
  };

  const searchKeyword = options.search.toLowerCase().trim();
  const filtered = allItems.filter(item => {
    if (options.filter === 'incomplete' && item.isComplete) return false;
    if (options.filter === 'completed' && !item.isComplete) return false;
    if (searchKeyword) {
      const matchName = item.name.toLowerCase().includes(searchKeyword);
      const matchCode = item.code.toLowerCase().includes(searchKeyword);
      const matchAdp = (item.effectiveValues.nhso_adp_code || '').toLowerCase().includes(searchKeyword);
      const matchBillcode = (item.effectiveValues.billcode || '').toLowerCase().includes(searchKeyword);
      if (!matchName && !matchCode && !matchAdp && !matchBillcode) return false;
    }
    return true;
  });

  const paged = filtered.slice(options.offset, options.offset + options.limit);

  return {
    summary,
    items: paged,
    totalMatches: filtered.length,
  };
}

async function queryPttypeItems(
  connection: HospitalConnection,
  hasSchema: (table: string, ...cols: string[]) => boolean,
  overrides: Record<string, { hipdata_code?: string; pcode?: string }>,
  options: { filter: string; search: string; limit: number; offset: number }
): Promise<MasterDataQueryResult> {
  if (!hasSchema('pttype')) {
    return {
      summary: { catalog: 'pttypes', catalogName: 'สิทธิการรักษา (pttype)', total: 0, incomplete: 0, completed: 0, percent: 0 },
      items: [],
      totalMatches: 0,
    };
  }

  const hasHipdata = hasSchema('pttype', 'hipdata_code');
  const hasPcode = hasSchema('pttype', 'pcode');
  const hasPaidst = hasSchema('pttype', 'paidst');

  const sql = `
    SELECT 
      pttype, 
      name
      ${hasPaidst ? ', paidst' : ''}
      ${hasHipdata ? ', hipdata_code' : ''}
      ${hasPcode ? ', pcode' : ''}
    FROM pttype
    ORDER BY pttype ASC
  `;

  const [rows] = await connection.query(sql);
  const rawList = (rows as Record<string, unknown>[]) || [];

  let total = 0;
  let incomplete = 0;
  let completed = 0;

  const allItems: MasterDataItem[] = [];

  for (const row of rawList) {
    total += 1;
    const code = String(row.pttype || '').trim();
    const name = String(row.name || '').trim();
    const paidst = hasPaidst ? String(row.paidst || '').trim() : '';
    const currentHipdata = hasHipdata ? String(row.hipdata_code || '').trim() : '';
    const currentPcode = hasPcode ? String(row.pcode || '').trim() : '';

    const override = overrides[code];
    const overrideHipdata = override?.hipdata_code ? String(override.hipdata_code).trim() : '';
    const overridePcode = override?.pcode ? String(override.pcode).trim() : '';

    const effectiveHipdata = overrideHipdata || currentHipdata;
    const effectivePcode = overridePcode || currentPcode;

    const isComplete = Boolean(effectiveHipdata || effectivePcode);

    if (isComplete) completed += 1;
    else incomplete += 1;

    const missingFields: string[] = [];
    if (!isComplete) {
      missingFields.push('ยังไม่ได้ผูกรหัสกองทุน HIPDATA หรือ Pcode');
    }

    allItems.push({
      code,
      name,
      detail: paidst ? `สถานะการชำระ (paidst): ${paidst}` : undefined,
      currentValues: { hipdata_code: currentHipdata, pcode: currentPcode },
      overrideValues: { ...(overrideHipdata ? { hipdata_code: overrideHipdata } : {}), ...(overridePcode ? { pcode: overridePcode } : {}) },
      effectiveValues: { hipdata_code: effectiveHipdata, pcode: effectivePcode },
      isComplete,
      missingFields,
    });
  }

  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const summary: MasterDataCatalogSummary = {
    catalog: 'pttypes',
    catalogName: 'สิทธิการรักษา (pttype)',
    total,
    incomplete,
    completed,
    percent,
  };

  const searchKeyword = options.search.toLowerCase().trim();
  const filtered = allItems.filter(item => {
    if (options.filter === 'incomplete' && item.isComplete) return false;
    if (options.filter === 'completed' && !item.isComplete) return false;
    if (searchKeyword) {
      const matchName = item.name.toLowerCase().includes(searchKeyword);
      const matchCode = item.code.toLowerCase().includes(searchKeyword);
      const matchHipdata = (item.effectiveValues.hipdata_code || '').toLowerCase().includes(searchKeyword);
      if (!matchName && !matchCode && !matchHipdata) return false;
    }
    return true;
  });

  const paged = filtered.slice(options.offset, options.offset + options.limit);

  return {
    summary,
    items: paged,
    totalMatches: filtered.length,
  };
}

/**
 * Generates SQL statements that DBA can run directly in HOSxP
 */
export function generateHosxpUpdateSql(
  catalog: MasterCatalogType,
  updates: Array<{ code: string; [key: string]: unknown }>
): string {
  const statements: string[] = [];
  const sanitize = (val: unknown) => String(val ?? '').replace(/'/g, "''").trim();

  for (const item of updates) {
    const code = sanitize(item.code);
    if (!code) continue;

    if (catalog === 'drugs') {
      const tmt = sanitize(item.tmt_code ?? item.didstd);
      if (tmt) {
        statements.push(`UPDATE drugitems SET didstd = '${tmt}' WHERE icode = '${code}';`);
      }
    } else if (catalog === 'nondrugs') {
      const setClauses: string[] = [];
      const adp = sanitize(item.nhso_adp_code);
      const billcode = sanitize(item.billcode);
      if (adp) setClauses.push(`nhso_adp_code = '${adp}'`);
      if (billcode) setClauses.push(`billcode = '${billcode}'`);
      if (setClauses.length > 0) {
        statements.push(`UPDATE nondrugitems SET ${setClauses.join(', ')} WHERE icode = '${code}';`);
      }
    } else if (catalog === 'pttypes') {
      const setClauses: string[] = [];
      const hipdata = sanitize(item.hipdata_code);
      const pcode = sanitize(item.pcode);
      if (hipdata) setClauses.push(`hipdata_code = '${hipdata}'`);
      if (pcode) setClauses.push(`pcode = '${pcode}'`);
      if (setClauses.length > 0) {
        statements.push(`UPDATE pttype SET ${setClauses.join(', ')} WHERE pttype = '${code}';`);
      }
    }
  }

  return statements.join('\n');
}

/**
 * Safely updates HOSxP database if connection has write access
 */
export async function syncMasterDataToHosxp(
  connection: HospitalConnection,
  catalog: MasterCatalogType,
  updates: Array<{ code: string; [key: string]: unknown }>
): Promise<{ updatedCount: number; errors: string[] }> {
  let updatedCount = 0;
  const errors: string[] = [];

  for (const item of updates) {
    const code = String(item.code || '').trim();
    if (!code) continue;

    try {
      if (catalog === 'drugs') {
        const tmt = String(item.tmt_code ?? item.didstd ?? '').trim();
        if (tmt) {
          await connection.query('UPDATE drugitems SET didstd = ? WHERE icode = ?', [tmt, code]);
          updatedCount += 1;
        }
      } else if (catalog === 'nondrugs') {
        const adp = String(item.nhso_adp_code ?? '').trim();
        const billcode = String(item.billcode ?? '').trim();
        if (adp && billcode) {
          await connection.query('UPDATE nondrugitems SET nhso_adp_code = ?, billcode = ? WHERE icode = ?', [adp, billcode, code]);
          updatedCount += 1;
        } else if (adp) {
          await connection.query('UPDATE nondrugitems SET nhso_adp_code = ? WHERE icode = ?', [adp, code]);
          updatedCount += 1;
        } else if (billcode) {
          await connection.query('UPDATE nondrugitems SET billcode = ? WHERE icode = ?', [billcode, code]);
          updatedCount += 1;
        }
      } else if (catalog === 'pttypes') {
        const hipdata = String(item.hipdata_code ?? '').trim().toUpperCase();
        const pcode = String(item.pcode ?? '').trim().toUpperCase();
        if (hipdata && pcode) {
          await connection.query('UPDATE pttype SET hipdata_code = ?, pcode = ? WHERE pttype = ?', [hipdata, pcode, code]);
          updatedCount += 1;
        } else if (hipdata) {
          await connection.query('UPDATE pttype SET hipdata_code = ? WHERE pttype = ?', [hipdata, code]);
          updatedCount += 1;
        } else if (pcode) {
          await connection.query('UPDATE pttype SET pcode = ? WHERE pttype = ?', [pcode, code]);
          updatedCount += 1;
        }
      }
    } catch (err) {
      errors.push(`รายการ ${code}: ${(err as Error).message}`);
    }
  }

  return { updatedCount, errors };
}
