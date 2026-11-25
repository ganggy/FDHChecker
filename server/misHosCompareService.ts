import { getRepstmConnection, getUTFConnection } from './db/connection.js';
import { ensureMisHosCacheSchema, ensureRepstmTables } from './db/schema.js';
import { readHospitalIdentity } from './siteProfile.js';
import {
  decodeStConfig,
  FISCAL_MONTH_ORDER,
  getFiscalDateRange,
  getMisPageByKey,
  MIS_HOS_API_BASE,
  MIS_HOS_MENU_GROUPS,
  MIS_HOS_PAGES,
  normalizeThaiFundName,
  THAI_MONTH_LABELS,
  type FiscalMonthCode,
  type MisPageDefinition,
  type MisSimpleStudioCardConfig,
} from './misHosCatalog.js';

export interface MisHospitalProfile {
  hcode: string;
  hname: string;
  provinceId: string;
  provinceName: string;
  nhsoZone: string;
}

export interface ThreeWayBudgetRow {
  code: string;
  fundName: string;
  misAmount: number;
  misPrevAmount: number;
  smtAmount: number;
  smtNetAmount: number;
  smtRecordCount: number;
  stmAmount: number;
  stmCount: number;
  diffMisSmt: number;
  diffMisStm: number;
  coverageSmtPct: number | null;
  coverageStmPct: number | null;
  note?: string;
}

export interface MonthlyCompareRow {
  mm: FiscalMonthCode;
  label: string;
  ym: string;
  withinCutoff: boolean;
  misAmount: number;
  misOpAmount: number;
  misIpAmount: number;
  misPrevAmount: number;
  smtAmount: number;
  smtNetAmount: number;
  stmAmount: number;
  stmOpAmount: number;
  stmIpAmount: number;
  stmCount: number;
  misCases: number;
  misAdjRw: number;
  stmCases: number;
  stmAdjRw: number;
  diffMisSmt: number;
  diffMisStm: number;
}

export interface SubfundCompareRow {
  code: string;
  fundGroup: string;
  name: string;
  misVisits: number;
  misAmount: number;
  misStmAmount: number;
  misPrevAmount: number;
  stmVisits: number;
  stmAmount: number;
  diffMisStm: number;
  coveragePct: number | null;
  status: string;
}

export interface StmAggBucket {
  mm: string;
  dept: string;
  inscl: string;
  fgroup: string;
  mainFund: string;
  subFund: string;
  subDesc: string;
  cnt: number;
  sumAmount: number;
  sumPaid: number;
  sumAdjRw: number;
  sumOpAmt: number;
  sumIpAmt: number;
  sumHcAmt: number;
  sumAeAmt: number;
  sumInstAmt: number;
  sumDmisAmt: number;
  sumCataractAmt: number;
  sumStemiAmt: number;
  sumPalliativeAmt: number;
  sumDmishdAmt: number;
  sumPpAmt: number;
  sumFsAmt: number;
  sumCovidAmt: number;
}

export interface StmFileSummary {
  filename: string;
  statementNo: string;
  department: string;
  maininscl: string;
  rowsCount: number;
  sumAmount: number;
  sumPaid: number;
  minDate: string;
  maxDate: string;
}

export interface SmtAggRow {
  fundGroup: string;
  fundName: string;
  mm: string;
  cnt: number;
  sumAmount: number;
  sumNet: number;
}

export interface MisCardComparisonRow {
  rowKey: string;
  label: string;
  misAmount: number;
  fdhAmount: number;
  smtAmount?: number;
  diff: number;
  coveragePct: number | null;
  status: string;
  raw: Record<string, unknown>;
}

export interface MisSimpleStudioCardResult {
  ssid: string;
  reportName: string;
  chartType: string;
  reportWidth?: string;
  remark?: string;
  columns: string[];
  rows: Record<string, unknown>[];
  compareMode: 'monthly' | 'subfund' | 'summary' | 'none';
  compareRows: MisCardComparisonRow[];
  misTotal: number;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const profileMemoryCache = new Map<string, { profile: MisHospitalProfile; fetchedAt: number }>();

const roundBaht = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

const roundRw = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0;
};

const computeCoveragePct = (actual: number, target: number): number | null => {
  if (!Number.isFinite(target) || Math.abs(target) < 0.01) return null;
  return Math.round((actual / target) * 1000) / 10;
};

const classifyCompareStatus = (misVal: number, fdhVal: number): string => {
  if (misVal <= 0.01 && fdhVal > 0.01) return 'พบเฉพาะใน STM';
  if (misVal > 0.01 && fdhVal <= 0.01) return 'ยังไม่มี STM';
  const diff = fdhVal - misVal;
  if (Math.abs(diff) <= 1 || (misVal > 0 && Math.abs(diff / misVal) <= 0.005)) return 'ตรงกัน';
  return diff < 0 ? 'STM น้อยกว่า MIS' : 'STM มากกว่า MIS';
};

async function postMisJson<T = unknown>(endpoint: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${MIS_HOS_API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'FDHChecker-MisCompare/1.0',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) {
    throw new Error(`MIS HOS HTTP ${res.status} (${endpoint})`);
  }
  const text = (await res.text()).replace(/^\uFEFF/, '').trim();
  if (!text || text.startsWith('<br') || text.startsWith('<')) {
    return ([] as unknown) as T;
  }
  const parsed = JSON.parse(text) as T & { error?: string };
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.error) {
    throw new Error(`MIS HOS Error: ${parsed.error}`);
  }
  return parsed;
}

export async function resolveHospitalProfile(): Promise<MisHospitalProfile> {
  let hcode = '';
  let hname = '';

  try {
    const hosConn = await getUTFConnection();
    try {
      const identity = await readHospitalIdentity(hosConn);
      hcode = identity.hospital_code || '';
      hname = identity.hospital_name || '';
    } finally {
      hosConn.release();
    }
  } catch {
    // Fallback below if HOSxP DB unavailable during offline/test checks
  }

  if (!hcode) {
    hcode = String(process.env.HOSPITAL_CODE || '').trim();
  }

  if (!hcode) {
    const conn = await getRepstmConnection();
    try {
      await ensureRepstmTables();
      const [smtRows] = await conn.query(
        `SELECT hcode FROM smt_budget_transfers WHERE COALESCE(hcode, '') <> '' ORDER BY id DESC LIMIT 1`
      );
      hcode = String((smtRows as Record<string, unknown>[])[0]?.hcode || '').trim();
      if (!hcode) {
        const [batchRows] = await conn.query(
          `SELECT hcode FROM repstm_import_batch WHERE COALESCE(hcode, '') <> '' ORDER BY id DESC LIMIT 1`
        );
        hcode = String((batchRows as Record<string, unknown>[])[0]?.hcode || '').trim();
      }
    } catch {
      // ignore
    } finally {
      conn.release();
    }
  }

  if (!hcode) hcode = '11101';

  const cached = profileMemoryCache.get(hcode);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.profile;
  }

  let profile: MisHospitalProfile = {
    hcode,
    hname: hname || `หน่วยบริการ ${hcode}`,
    provinceId: '',
    provinceName: '',
    nhsoZone: '',
  };

  try {
    const res = await fetch(`${MIS_HOS_API_BASE}l_hospital_see.php?hcode=${encodeURIComponent(hcode)}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const text = (await res.text()).replace(/^\uFEFF/, '').trim();
      const rows = JSON.parse(text) as Array<Record<string, unknown>>;
      if (Array.isArray(rows) && rows[0]) {
        profile = {
          hcode,
          hname: String(rows[0].HNAME || hname || profile.hname).trim(),
          provinceId: String(rows[0].PROVINCE_ID || '').trim(),
          provinceName: String(rows[0].PROVINCE_NAME || '').trim(),
          nhsoZone: String(rows[0].NHSO_ZONE || '').trim(),
        };
      }
    }
  } catch {
    // keep fallback profile
  }

  profileMemoryCache.set(hcode, { profile, fetchedAt: Date.now() });
  return profile;
}

async function fetchMisWithCache<T>(
  hcode: string,
  budgetYear: string,
  pageKey: string,
  refresh: boolean,
  fetcher: () => Promise<T>
): Promise<{ payload: T; fetchedAt: string; fromCache: boolean; stale: boolean; warning?: string }> {
  const conn = await getRepstmConnection();
  try {
    await ensureRepstmTables();
    await ensureMisHosCacheSchema(conn);

    const [rows] = await conn.query(
      `SELECT payload_json, DATE_FORMAT(fetched_at, '%Y-%m-%d %H:%i:%s') AS fetched_at, UNIX_TIMESTAMP(fetched_at) * 1000 AS fetched_ms
       FROM mis_hos_snapshot_cache
       WHERE hcode = ? AND budget_year = ? AND page_key = ?
       LIMIT 1`,
      [hcode, budgetYear, pageKey]
    );
    const cachedRow = (rows as Array<{ payload_json?: string; fetched_at?: string; fetched_ms?: number }>)[0];

    if (!refresh && cachedRow?.payload_json) {
      const ageMs = Date.now() - Number(cachedRow.fetched_ms || 0);
      if (ageMs >= 0 && ageMs < CACHE_TTL_MS) {
        return {
          payload: JSON.parse(cachedRow.payload_json) as T,
          fetchedAt: String(cachedRow.fetched_at || ''),
          fromCache: true,
          stale: false,
        };
      }
    }

    try {
      const fresh = await fetcher();
      const serialized = JSON.stringify(fresh);
      await conn.query(
        `INSERT INTO mis_hos_snapshot_cache (hcode, budget_year, page_key, payload_json, fetched_at)
         VALUES (?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE payload_json = VALUES(payload_json), fetched_at = NOW()`,
        [hcode, budgetYear, pageKey, serialized]
      );
      return {
        payload: fresh,
        fetchedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        fromCache: false,
        stale: false,
      };
    } catch (liveErr) {
      if (cachedRow?.payload_json) {
        return {
          payload: JSON.parse(cachedRow.payload_json) as T,
          fetchedAt: String(cachedRow.fetched_at || ''),
          fromCache: true,
          stale: true,
          warning: `ไม่สามารถเชื่อมต่อ MIS HOS สดได้ (${(liveErr as Error).message}) — แสดงข้อมูลแคชล่าสุดแทน`,
        };
      }
      throw liveErr;
    }
  } finally {
    conn.release();
  }
}

const numJsonSql = (jsonKey: string) => {
  const escaped = jsonKey.replace(/"/g, '\\"');
  return `CASE
    WHEN REPLACE(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(raw_data, '$."${escaped}"')), '')), ',', '') REGEXP '^-?[0-9]+(\\.[0-9]+)?$'
    THEN CAST(REPLACE(TRIM(JSON_UNQUOTE(JSON_EXTRACT(raw_data, '$."${escaped}"'))), ',', '') AS DECIMAL(15,4))
    ELSE 0
  END`;
};

function getCutoffEndDate(budgetYear: string, cutoffMonthYm?: string): { endDate: string; cutoffYm: string } {
  const range = getFiscalDateRange(budgetYear);
  const ym = String(cutoffMonthYm || '').trim();
  if (/^\d{6}$/.test(ym) && ym >= range.startMonthYm && ym < range.endMonthYm) {
    const y = Number(ym.slice(0, 4));
    const m = Number(ym.slice(4, 6));
    const lastDay = new Date(y, m, 0).getDate();
    return {
      endDate: `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')} 23:59:59`,
      cutoffYm: ym,
    };
  }
  return {
    endDate: `${range.endDate} 23:59:59`,
    cutoffYm: range.endMonthYm,
  };
}

export async function loadLocalSmtAndStmData(
  hcode: string,
  budgetYear: string,
  cutoffMonthYm?: string
): Promise<{
  startDate: string;
  endDate: string;
  cutoffYm: string;
  smtRows: SmtAggRow[];
  stmBuckets: StmAggBucket[];
  stmFiles: StmFileSummary[];
}> {
  const range = getFiscalDateRange(budgetYear);
  const { endDate, cutoffYm } = getCutoffEndDate(budgetYear, cutoffMonthYm);
  const startDate = `${range.startDate} 00:00:00`;

  const conn = await getRepstmConnection();
  try {
    await ensureRepstmTables();

    const [smtRaw] = await conn.query(
      `SELECT
         COALESCE(fund_group, '') AS fund_group,
         COALESCE(fund_name, '') AS fund_name,
         COALESCE(DATE_FORMAT(COALESCE(NULLIF(posting_date, ''), NULLIF(run_date, '')), '%m'), '') AS mm,
         COUNT(*) AS cnt,
         ROUND(SUM(COALESCE(amount, 0)), 2) AS sum_amount,
         ROUND(SUM(COALESCE(net_total, 0)), 2) AS sum_net
       FROM smt_budget_transfers
       WHERE budget_year = ?
         AND (hcode = ? OR COALESCE(hcode, '') = '')
       GROUP BY 1, 2, 3`,
      [range.beYear, hcode]
    );

    const smtRows: SmtAggRow[] = (smtRaw as Record<string, unknown>[]).map((r) => ({
      fundGroup: String(r.fund_group || '').trim(),
      fundName: String(r.fund_name || '').trim(),
      mm: String(r.mm || '').trim(),
      cnt: Number(r.cnt || 0),
      sumAmount: roundBaht(r.sum_amount),
      sumNet: roundBaht(r.sum_net),
    }));

    const [stmRaw] = await conn.query(
      `SELECT
         DATE_FORMAT(COALESCE(service_datetime, senddate, created_at), '%m') AS mm,
         UPPER(COALESCE(department, '')) AS dept,
         UPPER(COALESCE(maininscl, '')) AS inscl,
         CASE
           WHEN filename LIKE 'STM\\_%\\_IPUCS%' THEN 'STM_IPUCS'
           WHEN filename LIKE 'STM\\_%\\_OPUCS%' THEN 'STM_OPUCS'
           WHEN filename LIKE 'STM\\_%\\_IP%' THEN 'STM_IP'
           WHEN filename LIKE 'STM\\_%\\_OP%' THEN 'STM_OP'
           WHEN filename LIKE '%COCDSTM%' THEN 'COCDSTM'
           WHEN filename LIKE '%SIGNSTM%' THEN 'SIGNSTM'
           WHEN filename LIKE 'DCKD%' THEN 'DCKD'
           WHEN filename LIKE 'LGO%' THEN 'LGO_HD'
           WHEN filename LIKE 'eclaim%' THEN 'ECLAIM'
           ELSE 'OTHER'
         END AS fgroup,
         COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(raw_data, '$."กองทุนหลัก"')), ''), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(raw_data, '$."Sys_code"')), ''), '') AS main_fund,
         COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(raw_data, '$."กองทุนย่อย"')), ''), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(raw_data, '$."Item_code( SubFund )"')), ''), '') AS sub_fund,
         COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(raw_data, '$."รายการ/ประเภทที่ขอเบิก ( ความหมาย SubFund )"')), ''), '') AS sub_desc,
         COUNT(*) AS cnt,
         ROUND(SUM(COALESCE(amount, 0)), 2) AS sum_amount,
         ROUND(SUM(COALESCE(paid_amount, 0)), 2) AS sum_paid,
         ROUND(SUM(${numJsonSql('AdjRW')}), 4) AS sum_adjrw,
         ROUND(SUM(${numJsonSql('พึงรับ OP')}), 2) AS sum_op_amt,
         ROUND(SUM(${numJsonSql('IP')} + ${numJsonSql('ผู้ป่วยใน (IP)')}), 2) AS sum_ip_amt,
         ROUND(SUM(${numJsonSql('HC')} + ${numJsonSql('ค่าใช้จ่ายสูง (HC)')}), 2) AS sum_hc_amt,
         ROUND(SUM(${numJsonSql('AE')} + ${numJsonSql('อุบัติเหตุฉุกเฉิน (AE)')}), 2) AS sum_ae_amt,
         ROUND(SUM(${numJsonSql('INST')} + ${numJsonSql('อวัยวะเทียม/อุปกรณ์บำบัดรักษา (INST)')} + ${numJsonSql('ค่าอวัยวะฯ')}), 2) AS sum_inst_amt,
         ROUND(SUM(${numJsonSql('DMIS')}), 2) AS sum_dmis_amt,
         ROUND(SUM(${numJsonSql('โรคเฉพาะ (DMIS) CATARACT')} + ${numJsonSql('CATINST')}), 2) AS sum_cataract_amt,
         ROUND(SUM(${numJsonSql('STROKE-STEMI DRUG')}), 2) AS sum_stemi_amt,
         ROUND(SUM(${numJsonSql('Palliative care')} + ${numJsonSql('Paliative Care')}), 2) AS sum_palliative_amt,
         ROUND(SUM(${numJsonSql('DMISHD')}), 2) AS sum_dmishd_amt,
         ROUND(SUM(${numJsonSql('PP')}), 2) AS sum_pp_amt,
         ROUND(SUM(${numJsonSql('FS')}), 2) AS sum_fs_amt,
         ROUND(SUM(${numJsonSql('COVID')}), 2) AS sum_covid_amt
       FROM repstm_statement_data
       WHERE data_type = 'STM'
         AND COALESCE(service_datetime, senddate, created_at) BETWEEN ? AND ?
       GROUP BY 1, 2, 3, 4, 5, 6, 7`,
      [startDate, endDate]
    );

    const stmBuckets: StmAggBucket[] = (stmRaw as Record<string, unknown>[]).map((r) => ({
      mm: String(r.mm || '').trim(),
      dept: String(r.dept || '').trim(),
      inscl: String(r.inscl || '').trim(),
      fgroup: String(r.fgroup || 'OTHER').trim(),
      mainFund: String(r.main_fund || '').trim(),
      subFund: String(r.sub_fund || '').trim(),
      subDesc: String(r.sub_desc || '').trim(),
      cnt: Number(r.cnt || 0),
      sumAmount: roundBaht(r.sum_amount),
      sumPaid: roundBaht(r.sum_paid),
      sumAdjRw: roundRw(r.sum_adjrw),
      sumOpAmt: roundBaht(r.sum_op_amt),
      sumIpAmt: roundBaht(r.sum_ip_amt),
      sumHcAmt: roundBaht(r.sum_hc_amt),
      sumAeAmt: roundBaht(r.sum_ae_amt),
      sumInstAmt: roundBaht(r.sum_inst_amt),
      sumDmisAmt: roundBaht(r.sum_dmis_amt),
      sumCataractAmt: roundBaht(r.sum_cataract_amt),
      sumStemiAmt: roundBaht(r.sum_stemi_amt),
      sumPalliativeAmt: roundBaht(r.sum_palliative_amt),
      sumDmishdAmt: roundBaht(r.sum_dmishd_amt),
      sumPpAmt: roundBaht(r.sum_pp_amt),
      sumFsAmt: roundBaht(r.sum_fs_amt),
      sumCovidAmt: roundBaht(r.sum_covid_amt),
    }));

    const [fileRaw] = await conn.query(
      `SELECT
         filename,
         COALESCE(statement_no, '') AS statement_no,
         COALESCE(department, '') AS department,
         COALESCE(maininscl, '') AS maininscl,
         COUNT(*) AS rows_cnt,
         ROUND(SUM(COALESCE(amount, 0)), 2) AS sum_amount,
         ROUND(SUM(COALESCE(paid_amount, 0)), 2) AS sum_paid,
         DATE_FORMAT(MIN(COALESCE(service_datetime, senddate, created_at)), '%Y-%m-%d') AS min_date,
         DATE_FORMAT(MAX(COALESCE(service_datetime, senddate, created_at)), '%Y-%m-%d') AS max_date
       FROM repstm_statement_data
       WHERE data_type = 'STM'
         AND COALESCE(service_datetime, senddate, created_at) BETWEEN ? AND ?
       GROUP BY filename, statement_no, department, maininscl
       ORDER BY sum_paid DESC
       LIMIT 200`,
      [startDate, endDate]
    );

    const stmFiles: StmFileSummary[] = (fileRaw as Record<string, unknown>[]).map((r) => ({
      filename: String(r.filename || ''),
      statementNo: String(r.statement_no || ''),
      department: String(r.department || ''),
      maininscl: String(r.maininscl || ''),
      rowsCount: Number(r.rows_cnt || 0),
      sumAmount: roundBaht(r.sum_amount),
      sumPaid: roundBaht(r.sum_paid),
      minDate: String(r.min_date || ''),
      maxDate: String(r.max_date || ''),
    }));

    return { startDate: range.startDate, endDate: endDate.slice(0, 10), cutoffYm, smtRows, stmBuckets, stmFiles };
  } finally {
    conn.release();
  }
}

const isUcLikeInscl = (inscl: string) => ['UCS', 'WEL', 'PUC', 'DIS', 'NRD'].includes(inscl);

function getBucketBudgetGroupCode(b: StmAggBucket): string {
  if (b.fgroup === 'DCKD' || b.mainFund.startsWith('CKD_')) return '3';
  if (b.inscl === 'LGO' || b.fgroup === 'LGO_HD') return '8';
  if (b.inscl === 'OFC' || b.fgroup === 'COCDSTM') return 'OFC_OUTSIDE';
  if (b.inscl === 'SSS' || b.fgroup === 'SIGNSTM') return 'SSS_OUTSIDE';
  if (b.sumPpAmt > 0 && b.sumPpAmt >= b.sumPaid * 0.6) return '16';
  if (isUcLikeInscl(b.inscl) || b.fgroup === 'STM_IPUCS' || b.fgroup === 'STM_OPUCS' || b.fgroup === 'ECLAIM') {
    return '1';
  }
  return '1';
}

export function buildBudgetThreeWayComparison(
  misFunds: Array<{ code?: string; fundName: string; misAmount: number; misPrevAmount?: number }>,
  smtRows: SmtAggRow[],
  stmBuckets: StmAggBucket[]
): { rows: ThreeWayBudgetRow[]; outsideNhsoStm: { ofcAmount: number; ofcCount: number; sssAmount: number; sssCount: number } } {
  const smtByGroup = new Map<string, { amount: number; net: number; cnt: number; names: string[] }>();
  for (const row of smtRows) {
    const key = row.fundGroup || normalizeThaiFundName(row.fundName);
    const cur = smtByGroup.get(key) || { amount: 0, net: 0, cnt: 0, names: [] };
    cur.amount = roundBaht(cur.amount + row.sumAmount);
    cur.net = roundBaht(cur.net + row.sumNet);
    cur.cnt += row.cnt;
    if (row.fundName && !cur.names.includes(row.fundName)) cur.names.push(row.fundName);
    smtByGroup.set(key, cur);
  }

  const stmByGroup = new Map<string, { amount: number; cnt: number }>();
  let ofcAmount = 0;
  let ofcCount = 0;
  let sssAmount = 0;
  let sssCount = 0;

  for (const b of stmBuckets) {
    const g = getBucketBudgetGroupCode(b);
    if (g === 'OFC_OUTSIDE') {
      ofcAmount = roundBaht(ofcAmount + b.sumPaid);
      ofcCount += b.cnt;
      continue;
    }
    if (g === 'SSS_OUTSIDE') {
      sssAmount = roundBaht(sssAmount + b.sumPaid);
      sssCount += b.cnt;
      continue;
    }
    const cur = stmByGroup.get(g) || { amount: 0, cnt: 0 };
    cur.amount = roundBaht(cur.amount + b.sumPaid);
    cur.cnt += b.cnt;
    stmByGroup.set(g, cur);
  }

  const matchedSmtKeys = new Set<string>();
  const matchedStmKeys = new Set<string>();
  const rows: ThreeWayBudgetRow[] = [];

  for (const mf of misFunds) {
    const code = String(mf.code || '').trim();
    const norm = normalizeThaiFundName(mf.fundName);
    const smtKey = code && smtByGroup.has(code) ? code : smtByGroup.has(norm) ? norm : '';
    const smt = smtKey ? smtByGroup.get(smtKey)! : { amount: 0, net: 0, cnt: 0, names: [] };
    if (smtKey) matchedSmtKeys.add(smtKey);

    const stmKey = code && stmByGroup.has(code) ? code : '';
    const stm = stmKey ? stmByGroup.get(stmKey)! : { amount: 0, cnt: 0 };
    if (stmKey) matchedStmKeys.add(stmKey);

    const misAmount = roundBaht(mf.misAmount);
    rows.push({
      code,
      fundName: mf.fundName,
      misAmount,
      misPrevAmount: roundBaht(mf.misPrevAmount),
      smtAmount: smt.amount,
      smtNetAmount: smt.net,
      smtRecordCount: smt.cnt,
      stmAmount: stm.amount,
      stmCount: stm.cnt,
      diffMisSmt: roundBaht(misAmount - smt.amount),
      diffMisStm: roundBaht(misAmount - stm.amount),
      coverageSmtPct: computeCoveragePct(smt.amount, misAmount),
      coverageStmPct: computeCoveragePct(stm.amount, misAmount),
    });
  }

  for (const [k, smt] of smtByGroup.entries()) {
    if (matchedSmtKeys.has(k)) continue;
    const stm = !matchedStmKeys.has(k) && stmByGroup.has(k) ? stmByGroup.get(k)! : { amount: 0, cnt: 0 };
    if (stmByGroup.has(k)) matchedStmKeys.add(k);
    rows.push({
      code: k,
      fundName: smt.names[0] || `กองทุน SMT (${k})`,
      misAmount: 0,
      misPrevAmount: 0,
      smtAmount: smt.amount,
      smtNetAmount: smt.net,
      smtRecordCount: smt.cnt,
      stmAmount: stm.amount,
      stmCount: stm.cnt,
      diffMisSmt: roundBaht(-smt.amount),
      diffMisStm: roundBaht(-stm.amount),
      coverageSmtPct: null,
      coverageStmPct: null,
      note: 'พบใน SMT ไม่พบใน MIS เงินโอน',
    });
  }

  return {
    rows: rows.sort((a, b) => Math.max(b.misAmount, b.smtAmount, b.stmAmount) - Math.max(a.misAmount, a.smtAmount, a.stmAmount)),
    outsideNhsoStm: { ofcAmount, ofcCount, sssAmount, sssCount },
  };
}

export function buildMonthlyComparison(
  budgetYear: string,
  misMonthly: Array<{
    mm: string;
    misAmount?: number;
    misOpAmount?: number;
    misIpAmount?: number;
    misPrevAmount?: number;
    misCases?: number;
    misAdjRw?: number;
  }>,
  smtRows: SmtAggRow[],
  stmBuckets: StmAggBucket[],
  cutoffYm?: string
): MonthlyCompareRow[] {
  const range = getFiscalDateRange(budgetYear);
  const misMap = new Map<string, (typeof misMonthly)[number]>();
  for (const m of misMonthly) {
    const mm = String(m.mm || '').trim().slice(-2).padStart(2, '0');
    misMap.set(mm, m);
  }

  const smtMap = new Map<string, { amt: number; net: number }>();
  for (const r of smtRows) {
    if (!r.mm) continue;
    const cur = smtMap.get(r.mm) || { amt: 0, net: 0 };
    cur.amt = roundBaht(cur.amt + r.sumAmount);
    cur.net = roundBaht(cur.net + r.sumNet);
    smtMap.set(r.mm, cur);
  }

  const stmMap = new Map<string, { amt: number; op: number; ip: number; cnt: number; adjrw: number }>();
  for (const b of stmBuckets) {
    if (!b.mm) continue;
    const cur = stmMap.get(b.mm) || { amt: 0, op: 0, ip: 0, cnt: 0, adjrw: 0 };
    cur.amt = roundBaht(cur.amt + b.sumPaid);
    if (b.dept === 'IP' || b.fgroup === 'STM_IPUCS' || b.fgroup === 'STM_IP') {
      cur.ip = roundBaht(cur.ip + b.sumPaid);
    } else {
      cur.op = roundBaht(cur.op + b.sumPaid);
    }
    cur.cnt += b.cnt;
    cur.adjrw = roundRw(cur.adjrw + b.sumAdjRw);
    stmMap.set(b.mm, cur);
  }

  const effectiveCutoff = cutoffYm || range.endMonthYm;
  return FISCAL_MONTH_ORDER.map((mm) => {
    const calYear = Number(mm) >= 10 ? range.ceYear - 1 : range.ceYear;
    const ym = `${calYear}${mm}`;
    const withinCutoff = ym <= effectiveCutoff;
    const m = misMap.get(mm);
    const smt = smtMap.get(mm) || { amt: 0, net: 0 };
    const stm = stmMap.get(mm) || { amt: 0, op: 0, ip: 0, cnt: 0, adjrw: 0 };
    const misAmount = roundBaht(m?.misAmount);
    return {
      mm,
      label: `${THAI_MONTH_LABELS[mm]} ${String(calYear + 543).slice(-2)}`,
      ym,
      withinCutoff,
      misAmount,
      misOpAmount: roundBaht(m?.misOpAmount),
      misIpAmount: roundBaht(m?.misIpAmount),
      misPrevAmount: roundBaht(m?.misPrevAmount),
      smtAmount: smt.amt,
      smtNetAmount: smt.net,
      stmAmount: stm.amt,
      stmOpAmount: stm.op,
      stmIpAmount: stm.ip,
      stmCount: stm.cnt,
      misCases: Number(m?.misCases || 0),
      misAdjRw: roundRw(m?.misAdjRw),
      stmCases: stm.cnt,
      stmAdjRw: stm.adjrw,
      diffMisSmt: roundBaht(misAmount - smt.amt),
      diffMisStm: roundBaht(misAmount - stm.amt),
    };
  });
}

function deriveStmComponentSubfunds(stmBuckets: StmAggBucket[]): Array<{
  code: string;
  fundGroup: string;
  name: string;
  visits: number;
  amount: number;
}> {
  const agg = new Map<string, { code: string; fundGroup: string; name: string; visits: number; amount: number }>();
  const add = (code: string, fundGroup: string, name: string, visits: number, amount: number) => {
    if (amount <= 0 && visits <= 0) return;
    const key = code.toUpperCase();
    const cur = agg.get(key) || { code: key, fundGroup, name, visits: 0, amount: 0 };
    cur.visits += visits;
    cur.amount = roundBaht(cur.amount + amount);
    agg.set(key, cur);
  };

  for (const b of stmBuckets) {
    if (b.subFund) {
      add(b.subFund, b.mainFund || b.fgroup, b.subDesc || b.subFund, b.cnt, b.sumPaid);
      continue;
    }
    if (b.fgroup === 'LGO_HD') {
      add('LGO_HD', 'LGO', 'ไตวายเรื้อรัง สิทธิ อปท. (LGO-HD)', b.cnt, b.sumPaid);
      continue;
    }
    if (b.fgroup === 'COCDSTM') {
      add('OFC_COCDSTM', 'OFC', 'เบิกตรงกรมบัญชีกลาง XML (COCDSTM)', b.cnt, b.sumPaid);
      continue;
    }
    if (b.fgroup === 'SIGNSTM') {
      add('SSS_SIGNSTM', 'SSS', 'ประกันสังคม IPD XML (SIGNSTM)', b.cnt, b.sumPaid);
      continue;
    }

    // Standard STM statement files store components in JSON columns rather than a single sub_fund column
    if (b.sumOpAmt > 0) add('OP', 'OP', 'พึงรับ OP (STM)', b.cnt, b.sumOpAmt);
    if (b.sumIpAmt > 0) add('IP', 'IP', 'ผู้ป่วยใน IP (STM)', b.cnt, b.sumIpAmt);
    if (b.sumHcAmt > 0) add('HC', 'HC', 'ค่าใช้จ่ายสูง HC (STM)', 0, b.sumHcAmt);
    if (b.sumAeAmt > 0) add('AE', 'AE', 'อุบัติเหตุฉุกเฉิน AE (STM)', 0, b.sumAeAmt);
    if (b.sumInstAmt > 0) add('INST', 'INST', 'อวัยวะเทียม/อุปกรณ์ INST (STM)', 0, b.sumInstAmt);
    if (b.sumDmisAmt > 0) add('DMIS', 'DMIS', 'โรคเฉพาะ DMIS (STM)', 0, b.sumDmisAmt);
    if (b.sumCataractAmt > 0) add('CATARACT', 'DMIS', 'ต้อกระจก CATARACT (STM)', 0, b.sumCataractAmt);
    if (b.sumStemiAmt > 0) add('STEMI', 'DMIS', 'STROKE-STEMI (STM)', 0, b.sumStemiAmt);
    if (b.sumPalliativeAmt > 0) add('PALLIATIVE', 'DMIS', 'Palliative Care (STM)', 0, b.sumPalliativeAmt);
    if (b.sumDmishdAmt > 0) add('DMISHD', 'DMIS', 'ไตวายเรื้อรัง DMISHD (STM)', 0, b.sumDmishdAmt);
    if (b.sumPpAmt > 0) add('PP', 'PP', 'ส่งเสริมป้องกันโรค PP (STM)', 0, b.sumPpAmt);
    if (b.sumFsAmt > 0) add('FS', 'FS', 'Fee Schedule FS (STM)', 0, b.sumFsAmt);
    if (b.sumCovidAmt > 0) add('COVID', 'POLICY', 'COVID-19 (STM)', 0, b.sumCovidAmt);

    const componentSum =
      b.sumOpAmt +
      b.sumIpAmt +
      b.sumHcAmt +
      b.sumAeAmt +
      b.sumInstAmt +
      b.sumDmisAmt +
      b.sumCataractAmt +
      b.sumStemiAmt +
      b.sumPalliativeAmt +
      b.sumDmishdAmt +
      b.sumPpAmt +
      b.sumFsAmt +
      b.sumCovidAmt;
    if (componentSum <= 0.01 && b.sumPaid > 0) {
      add(`${b.fgroup}_${b.dept || 'ALL'}`, b.inscl || b.fgroup, `${b.fgroup} (${b.inscl || b.dept || 'STM'})`, b.cnt, b.sumPaid);
    }
  }

  return Array.from(agg.values());
}

function matchStmToMisSubfund(
  misCode: string,
  misGroup: string,
  misName: string,
  stmByCode: Map<string, { code: string; fundGroup: string; name: string; visits: number; amount: number }>
): { key: string; visits: number; amount: number } {
  const codeUp = misCode.trim().toUpperCase();
  const grpUp = misGroup.trim().toUpperCase();

  if (codeUp && stmByCode.has(codeUp)) {
    const m = stmByCode.get(codeUp)!;
    return { key: codeUp, visits: m.visits, amount: m.amount };
  }

  // Known cross-system aliases between MIS subfunds and STM component columns/codes
  const aliasRules: Array<[RegExp, string[]]> = [
    [/IPINRGR|IP_DRG|IP01|ผู้ป่วยในในเขต/, ['IP', 'STM_IPUCS_IP', 'STM_IP_IP']],
    [/HD-PU|CKD_HD_PURIFY|ฟอกเลือด/, ['HD-PU', 'DMISHD']],
    [/HD-EPO/, ['HD-EPO']],
    [/CAPD/, ['CAPD-WO', 'CAPD-A', 'DMISHD']],
    [/INST|อวัยวะเทียม/, ['INST']],
    [/OPAE|ฉุกเฉิน|AE/, ['AE', 'OPAE']],
    [/CATARACT|ต้อกระจก/, ['CATARACT']],
    [/PALLIATIVE/, ['PALLIATIVE']],
    [/STEMI|STROKE|ละลายลิ่มเลือด/, ['STEMI']],
    [/OFC|กรมบัญชีกลาง/, ['OFC_COCDSTM']],
    [/LGO|ท้องถิ่น/, ['LGO_HD']],
    [/SSS|ประกันสังคม/, ['SSS_SIGNSTM']],
  ];

  const bag = `${codeUp} ${grpUp} ${misName}`;
  for (const [pattern, candidates] of aliasRules) {
    if (pattern.test(bag)) {
      for (const c of candidates) {
        if (stmByCode.has(c)) {
          const m = stmByCode.get(c)!;
          return { key: c, visits: m.visits, amount: m.amount };
        }
      }
    }
  }

  const normMis = normalizeThaiFundName(misName);
  if (normMis) {
    for (const [k, item] of stmByCode.entries()) {
      const normStm = normalizeThaiFundName(item.name);
      if (normStm && (normStm === normMis || normStm.includes(normMis) || normMis.includes(normStm))) {
        return { key: k, visits: item.visits, amount: item.amount };
      }
    }
  }

  return { key: '', visits: 0, amount: 0 };
}

export function buildSubfundComparison(
  misSubfunds: Array<{
    code: string;
    fundGroup?: string;
    name: string;
    misVisits?: number;
    misAmount: number;
    misStmAmount?: number;
    misPrevAmount?: number;
  }>,
  stmBuckets: StmAggBucket[]
): SubfundCompareRow[] {
  const stmList = deriveStmComponentSubfunds(stmBuckets);
  const stmByCode = new Map(stmList.map((s) => [s.code.toUpperCase(), s]));
  const matchedStmKeys = new Set<string>();
  const rows: SubfundCompareRow[] = [];

  for (const mf of misSubfunds) {
    const match = matchStmToMisSubfund(mf.code, mf.fundGroup || '', mf.name, stmByCode);
    if (match.key) matchedStmKeys.add(match.key);
    const misAmt = roundBaht(mf.misAmount);
    const stmAmt = roundBaht(match.amount);
    rows.push({
      code: mf.code || '-',
      fundGroup: mf.fundGroup || '',
      name: mf.name,
      misVisits: Number(mf.misVisits || 0),
      misAmount: misAmt,
      misStmAmount: roundBaht(mf.misStmAmount),
      misPrevAmount: roundBaht(mf.misPrevAmount),
      stmVisits: match.visits,
      stmAmount: stmAmt,
      diffMisStm: roundBaht(misAmt - stmAmt),
      coveragePct: computeCoveragePct(stmAmt, misAmt),
      status: classifyCompareStatus(misAmt, stmAmt),
    });
  }

  for (const [k, s] of stmByCode.entries()) {
    if (matchedStmKeys.has(k)) continue;
    rows.push({
      code: s.code,
      fundGroup: s.fundGroup,
      name: s.name,
      misVisits: 0,
      misAmount: 0,
      misStmAmount: 0,
      misPrevAmount: 0,
      stmVisits: s.visits,
      stmAmount: s.amount,
      diffMisStm: roundBaht(-s.amount),
      coveragePct: null,
      status: 'พบเฉพาะใน STM',
    });
  }

  return rows.sort((a, b) => Math.max(b.misAmount, b.stmAmount) - Math.max(a.misAmount, a.stmAmount));
}

function sliceStmBucketsForCategory(
  category: MisPageDefinition['stmMatchCategory'],
  buckets: StmAggBucket[],
  files: StmFileSummary[]
): { buckets: StmAggBucket[]; files: StmFileSummary[]; totalAmount: number; totalCount: number; totalAdjRw: number; note: string } {
  const sumBucket = (list: StmAggBucket[]) => ({
    totalAmount: roundBaht(list.reduce((s, b) => s + b.sumPaid, 0)),
    totalCount: list.reduce((s, b) => s + b.cnt, 0),
    totalAdjRw: roundRw(list.reduce((s, b) => s + b.sumAdjRw, 0)),
  });

  if (category === 'all' || category === 'budget') {
    const totals = sumBucket(buckets);
    return {
      buckets,
      files,
      ...totals,
      note: 'รวมข้อมูล STM ทุกหมวดที่นำเข้าในระบบในช่วงปีงบประมาณ',
    };
  }

  const filterMap: Record<string, { fn: (b: StmAggBucket) => boolean; amountPicker?: (b: StmAggBucket) => number; fileFn?: (f: StmFileSummary) => boolean; note: string }> = {
    eclaim_uc: {
      fn: (b) => isUcLikeInscl(b.inscl) || b.fgroup === 'STM_IPUCS' || b.fgroup === 'STM_OPUCS' || b.fgroup === 'DCKD',
      fileFn: (f) => isUcLikeInscl(f.maininscl.toUpperCase()) || /UCS|DCKD/i.test(f.filename),
      note: 'เฉพาะ STM สิทธิ UC (UCS/WEL/PUC/DIS/DCKD)',
    },
    eclaim_other: {
      fn: (b) => ['OFC', 'LGO', 'SSS'].includes(b.inscl) || ['COCDSTM', 'SIGNSTM', 'LGO_HD'].includes(b.fgroup),
      fileFn: (f) => ['OFC', 'LGO', 'SSS'].includes(f.maininscl.toUpperCase()) || /COCDSTM|SIGNSTM|LGO/i.test(f.filename),
      note: 'เฉพาะ STM สิทธิอื่น (OFC / LGO / SSS)',
    },
    op: {
      fn: (b) => b.dept === 'OP' || b.fgroup === 'STM_OPUCS' || b.fgroup === 'STM_OP',
      fileFn: (f) => f.department.toUpperCase() === 'OP' || /_OP/i.test(f.filename),
      note: 'STM ฝ่ายผู้ป่วยนอก (OP)',
    },
    ip: {
      fn: (b) => b.dept === 'IP' || b.fgroup === 'STM_IPUCS' || b.fgroup === 'STM_IP' || b.sumIpAmt > 0,
      fileFn: (f) => f.department.toUpperCase() === 'IP' || /_IP/i.test(f.filename),
      note: 'STM ฝ่ายผู้ป่วยใน (IP)',
    },
    opae: {
      fn: (b) => b.sumAeAmt > 0 || /AE|OPAE/i.test(`${b.mainFund} ${b.subFund}`),
      amountPicker: (b) => (b.sumAeAmt > 0 ? b.sumAeAmt : b.sumPaid),
      note: 'ยอดคอลัมน์ AE / อุบัติเหตุฉุกเฉินใน STM',
    },
    oprefer: {
      fn: (b) => /REFER|OPREF/i.test(`${b.mainFund} ${b.subFund} ${b.subDesc}`),
      note: 'ยอด STM กองทุน OP-Refer',
    },
    carrefer: {
      fn: (b) => /CAR|รถรับส่ง|พาหนะ/i.test(`${b.mainFund} ${b.subFund} ${b.subDesc}`),
      note: 'ยอด STM ค่าพาหนะ/ส่งต่อ',
    },
    walkin: {
      fn: (b) => /WALKIN|OPWI/i.test(`${b.mainFund} ${b.subFund} ${b.subDesc}`),
      note: 'ยอด STM OP WALKIN',
    },
    ontop: {
      fn: (b) => /ONTOP|OTCS|OTLG/i.test(`${b.mainFund} ${b.subFund}`),
      note: 'ยอด STM กองทุน On Top',
    },
    stemi: {
      fn: (b) => b.sumStemiAmt > 0 || /STEMI|STROKE|SK/i.test(`${b.mainFund} ${b.subFund}`),
      amountPicker: (b) => (b.sumStemiAmt > 0 ? b.sumStemiAmt : b.sumPaid),
      note: 'ยอด STROKE-STEMI / ยาละลายลิ่มเลือดใน STM',
    },
    cancer: {
      fn: (b) => /CA|CANCER|CHEMO/i.test(`${b.mainFund} ${b.subFund} ${b.subDesc}`),
      note: 'ยอดกองทุนมะเร็ง/เคมีบำบัดใน STM',
    },
    cataract: {
      fn: (b) => b.sumCataractAmt > 0 || /CATARACT|CATINST/i.test(`${b.mainFund} ${b.subFund}`),
      amountPicker: (b) => (b.sumCataractAmt > 0 ? b.sumCataractAmt : b.sumPaid),
      note: 'ยอดต้อกระจก (CATARACT / CATINST) ใน STM',
    },
    instrument: {
      fn: (b) => b.sumInstAmt > 0 || /INST/i.test(`${b.mainFund} ${b.subFund}`),
      amountPicker: (b) => (b.sumInstAmt > 0 ? b.sumInstAmt : b.sumPaid),
      note: 'ยอดคอลัมน์ INST / ค่าอวัยวะเทียมและอุปกรณ์ใน STM',
    },
    stone: {
      fn: (b) => /STONE|ESWL/i.test(`${b.mainFund} ${b.subFund}`),
      note: 'ยอดนิ่วในระบบทางเดินปัสสาวะใน STM',
    },
    palliative: {
      fn: (b) => b.sumPalliativeAmt > 0 || /PALLIATIVE/i.test(`${b.mainFund} ${b.subFund}`),
      amountPicker: (b) => (b.sumPalliativeAmt > 0 ? b.sumPalliativeAmt : b.sumPaid),
      note: 'ยอดคอลัมน์ Palliative Care ใน STM',
    },
    pp_anc: {
      fn: (b) => b.sumPpAmt > 0 || /ANC|PP/i.test(`${b.mainFund} ${b.subFund}`),
      amountPicker: (b) => (b.sumPpAmt > 0 ? b.sumPpAmt : b.sumPaid),
      note: 'ยอดส่งเสริมป้องกันโรค (PP / ANC) ใน STM',
    },
    pp_cancer: {
      fn: (b) => b.sumPpAmt > 0 || /PAP|CERVIX|COLON|CX/i.test(`${b.mainFund} ${b.subFund}`),
      amountPicker: (b) => (b.sumPpAmt > 0 ? b.sumPpAmt : b.sumPaid),
      note: 'ยอดคัดกรองมะเร็ง (PP) ใน STM',
    },
    pp_healthcheck: {
      fn: (b) => b.sumPpAmt > 0 || /FS|HEALTH|PP/i.test(`${b.mainFund} ${b.subFund}`),
      amountPicker: (b) => (b.sumPpAmt > 0 ? b.sumPpAmt : b.sumPaid),
      note: 'ยอดประเมินปัจจัยเสี่ยง/PP/FS ใน STM',
    },
    policy_cancerany: {
      fn: (b) => /CA|CANCER/i.test(`${b.mainFund} ${b.subFund}`),
      note: 'ยอดมะเร็งทุกที่ใน STM',
    },
    policy_covid19: {
      fn: (b) => b.sumCovidAmt > 0 || /COVID/i.test(`${b.mainFund} ${b.subFund}`),
      amountPicker: (b) => (b.sumCovidAmt > 0 ? b.sumCovidAmt : b.sumPaid),
      note: 'ยอด COVID-19 ใน STM',
    },
    policy_change_right: {
      fn: (b) => /CHANGE|RIGHT/i.test(`${b.mainFund} ${b.subFund}`),
      note: 'ยอดเปลี่ยนสิทธิใน STM',
    },
    policy_telemed: {
      fn: (b) => /TELE/i.test(`${b.mainFund} ${b.subFund}`),
      note: 'ยอด Telemedicine ใน STM',
    },
    policy_oneid: {
      fn: (b) => /ONEID|30B/i.test(`${b.mainFund} ${b.subFund}`),
      note: 'ยอดบัตรประชาชนใบเดียวใน STM',
    },
    dmis_ckd: {
      fn: (b) => b.fgroup === 'DCKD' || b.fgroup === 'LGO_HD' || b.sumDmishdAmt > 0 || /CKD|HD|CAPD/i.test(`${b.mainFund} ${b.subFund}`),
      amountPicker: (b) => (b.fgroup === 'DCKD' || b.fgroup === 'LGO_HD' ? b.sumPaid : b.sumDmishdAmt || b.sumPaid),
      fileFn: (f) => /DCKD|LGO-HD/i.test(f.filename),
      note: 'ยอดไตวายเรื้อรังจาก DCKD / LGO-HD / DMISHD ใน STM',
    },
    dmis_moph: {
      fn: (b) => /MORPROM|MOPH|DM2|NHT/i.test(`${b.mainFund} ${b.subFund}`),
      note: 'ยอด MOPH-Claim (MORPROM*) ใน STM',
    },
    dmis_ktp: {
      fn: (b) => /KTP/i.test(`${b.mainFund} ${b.subFund}`),
      note: 'ยอด Krungthai Platform (KTP*) ใน STM',
    },
    other_csmbs: {
      fn: (b) => b.inscl === 'OFC' || b.fgroup === 'COCDSTM' || /CS/i.test(b.fgroup),
      fileFn: (f) => f.maininscl.toUpperCase() === 'OFC' || /COCDSTM|IPCS|OPCS/i.test(f.filename),
      note: 'เฉพาะ STM สิทธิกรมบัญชีกลาง (OFC / COCDSTM)',
    },
    other_lgo: {
      fn: (b) => b.inscl === 'LGO' || b.fgroup === 'LGO_HD',
      fileFn: (f) => f.maininscl.toUpperCase() === 'LGO' || /LGO/i.test(f.filename),
      note: 'เฉพาะ STM สิทธิ อปท. (LGO / LGO-HD)',
    },
  };

  const rule = filterMap[category];
  if (!rule) {
    const totals = sumBucket(buckets);
    return { buckets, files, ...totals, note: 'รวม STM ทั้งหมด' };
  }

  const matchedBuckets = buckets.filter(rule.fn).map((b) =>
    rule.amountPicker ? { ...b, sumPaid: roundBaht(rule.amountPicker(b)) } : b
  );
  const matchedFiles = rule.fileFn ? files.filter(rule.fileFn) : files.slice(0, 30);
  const totals = sumBucket(matchedBuckets);
  return {
    buckets: matchedBuckets,
    files: matchedFiles,
    ...totals,
    note: rule.note,
  };
}

function buildCardComparison(
  card: MisSimpleStudioCardConfig,
  rows: Record<string, unknown>[],
  smtRows: SmtAggRow[],
  stmBuckets: StmAggBucket[]
): { compareMode: MisSimpleStudioCardResult['compareMode']; compareRows: MisCardComparisonRow[]; misTotal: number } {
  if (!rows.length) {
    return { compareMode: 'none', compareRows: [], misTotal: 0 };
  }

  const keys = Object.keys(rows[0]);
  const amountCol =
    ['BUDGET', 'ACT_AMT', 'SUM_AMT', 'CUR_AMT', 'AMT', 'NET_AMT'].find((c) => keys.includes(c)) ||
    keys.find((k) => /AMT|BUDGET/i.test(k));
  const opCol = keys.find((k) => /^ACT_AMT_OP$|^CUR_OP_AMT$/i.test(k));
  const ipCol = keys.find((k) => /^ACT_AMT_IP$|^CUR_IP_AMT$/i.test(k));

  const getRowAmount = (r: Record<string, unknown>): number => {
    if (amountCol) return roundBaht(r[amountCol]);
    if (opCol || ipCol) return roundBaht(Number(opCol ? r[opCol] : 0) + Number(ipCol ? r[ipCol] : 0));
    return 0;
  };

  const monthCol = keys.find((k) => /^(MONTH_SEND|MONTH|MM|YM)$/i.test(k));
  const subCol = keys.find((k) => /^(SUB_FUND|S_FUND_CD|FUND_AF|M_FUND_CD|CODE)$/i.test(k));
  const nameCol = keys.find((k) => /^(DESCRIPTION|DETAIL|S_FUND_DESC|M_FUND_DESC|NAME|SUB_NAME)$/i.test(k));

  if (monthCol && (amountCol || opCol || ipCol)) {
    const stmByMm = new Map<string, number>();
    for (const b of stmBuckets) {
      if (!b.mm) continue;
      stmByMm.set(b.mm, roundBaht((stmByMm.get(b.mm) || 0) + b.sumPaid));
    }
    const smtByMm = new Map<string, number>();
    for (const s of smtRows) {
      if (!s.mm) continue;
      smtByMm.set(s.mm, roundBaht((smtByMm.get(s.mm) || 0) + s.sumAmount));
    }

    let misTotal = 0;
    const compareRows: MisCardComparisonRow[] = rows.map((r, idx) => {
      const rawMm = String(r[monthCol] || '').trim();
      const mm = rawMm.slice(-2).padStart(2, '0');
      const misAmount = getRowAmount(r);
      misTotal = roundBaht(misTotal + misAmount);
      const fdhAmount = stmByMm.get(mm) || 0;
      const smtAmount = smtByMm.get(mm) || 0;
      return {
        rowKey: rawMm || `m-${idx}`,
        label: rawMm,
        misAmount,
        fdhAmount,
        smtAmount,
        diff: roundBaht(misAmount - fdhAmount),
        coveragePct: computeCoveragePct(fdhAmount, misAmount),
        status: classifyCompareStatus(misAmount, fdhAmount),
        raw: r,
      };
    });
    return { compareMode: 'monthly', compareRows, misTotal };
  }

  if ((subCol || nameCol) && (amountCol || opCol || ipCol)) {
    const stmList = deriveStmComponentSubfunds(stmBuckets);
    const stmByCode = new Map(stmList.map((s) => [s.code.toUpperCase(), s]));
    const smtByFund = new Map<string, number>();
    for (const s of smtRows) {
      const k = normalizeThaiFundName(s.fundName);
      if (k) smtByFund.set(k, roundBaht((smtByFund.get(k) || 0) + s.sumAmount));
      if (s.fundGroup) smtByFund.set(`GRP:${s.fundGroup}`, roundBaht((smtByFund.get(`GRP:${s.fundGroup}`) || 0) + s.sumAmount));
    }

    let misTotal = 0;
    const compareRows: MisCardComparisonRow[] = rows.map((r, idx) => {
      const code = subCol ? String(r[subCol] || '').trim() : '';
      const label = nameCol ? String(r[nameCol] || code || `Row ${idx + 1}`).trim() : code || `Row ${idx + 1}`;
      const misAmount = getRowAmount(r);
      misTotal = roundBaht(misTotal + misAmount);
      const stmMatch = matchStmToMisSubfund(code, String(r.FUND_AF || r.M_FUND_CD || ''), label, stmByCode);
      const normName = normalizeThaiFundName(label);
      const sFundCode = String(r.S_FUND_CD || '').trim();
      const mFundCode = String(r.M_FUND_CD || '').trim();
      const smtAmount = Number(
        (normName ? smtByFund.get(normName) : undefined) ??
          (sFundCode ? smtByFund.get(`GRP:${sFundCode}`) : undefined) ??
          (mFundCode ? smtByFund.get(`GRP:${mFundCode}`) : undefined) ??
          0
      );

      return {
        rowKey: `${code}-${idx}`,
        label: code && label !== code ? `[${code}] ${label}` : label,
        misAmount,
        fdhAmount: stmMatch.amount,
        smtAmount,
        diff: roundBaht(misAmount - stmMatch.amount),
        coveragePct: computeCoveragePct(stmMatch.amount, misAmount),
        status: classifyCompareStatus(misAmount, stmMatch.amount),
        raw: r,
      };
    });
    return { compareMode: 'subfund', compareRows, misTotal };
  }

  // Fallback for year/chart/other tables
  let misTotal = 0;
  if (amountCol) {
    misTotal = roundBaht(rows.reduce((s, r) => s + getRowAmount(r), 0));
  }
  return { compareMode: 'none', compareRows: [], misTotal };
}

export async function getMisCompareCatalog() {
  const profile = await resolveHospitalProfile();
  const now = new Date();
  const currentFiscalBe = now.getFullYear() + 543 + (now.getMonth() >= 9 ? 1 : 0);
  const years = [
    String(currentFiscalBe),
    String(currentFiscalBe - 1),
    String(currentFiscalBe - 2),
    String(currentFiscalBe - 3),
  ];
  return {
    profile,
    years,
    groups: MIS_HOS_MENU_GROUPS,
    pages: MIS_HOS_PAGES,
  };
}

interface OverviewRawCachePayload {
  budget: Record<string, any>;
  claim: Record<string, any>;
  ip: Record<string, any>;
  ip_send: Record<string, any>;
  dmis: Record<string, any>;
  moph: Record<string, any>;
  ktp: Record<string, any>;
  instrument: Record<string, any>;
  statementUcSubfunds: Record<string, unknown>[];
  budgetSubfunds: Record<string, unknown>[];
}

export async function getMisCompareOverview(options: {
  budgetYear?: string;
  refresh?: boolean;
  matchCutoff?: boolean;
}) {
  const profile = await resolveHospitalProfile();
  const range = getFiscalDateRange(options.budgetYear || '2569');
  const refresh = Boolean(options.refresh);
  const matchCutoff = options.matchCutoff !== false;

  const cached = await fetchMisWithCache<OverviewRawCachePayload>(
    profile.hcode,
    range.beYear,
    'overview',
    refresh,
    async () => {
      const parts = ['budget', 'claim', 'ip', 'ip_send', 'dmis', 'instrument'] as const;
      const partResults = await Promise.all(
        parts.map((part) =>
          postMisJson<{ data?: Record<string, any> }>('dashboard.php', {
            hcode: profile.hcode,
            year: String(range.ceYear),
            part,
            refresh: refresh ? 1 : 0,
          })
        )
      );

      const mergedData: Record<string, any> = {};
      for (const r of partResults) {
        if (r?.data && typeof r.data === 'object') {
          Object.assign(mergedData, r.data);
        }
      }

      // Fetch full subfund tables (`1824` Statement UC subfunds + `1826` budget subfunds)
      const [statementUcSubfunds, budgetSubfunds] = await Promise.all([
        postMisJson<Record<string, unknown>[]>('simplestudio/ss_statement.php', {
          ssid: '1824',
          api_type: 'get_tabledata',
          hcode: profile.hcode,
          province: profile.provinceId,
          year: String(range.ceYear),
        }).catch(() => [] as Record<string, unknown>[]),
        postMisJson<Record<string, unknown>[]>('simplestudio/ss_statement.php', {
          ssid: '1826',
          api_type: 'get_tabledata',
          hcode: profile.hcode,
          province: profile.provinceId,
          year: String(range.ceYear),
        }).catch(() => [] as Record<string, unknown>[]),
      ]);

      return {
        budget: mergedData.budget || {},
        claim: mergedData.claim || {},
        ip: mergedData.ip || {},
        ip_send: mergedData.ip_send || {},
        dmis: mergedData.dmis || {},
        moph: mergedData.moph || {},
        ktp: mergedData.ktp || {},
        instrument: mergedData.instrument || {},
        statementUcSubfunds: Array.isArray(statementUcSubfunds) ? statementUcSubfunds : [],
        budgetSubfunds: Array.isArray(budgetSubfunds) ? budgetSubfunds : [],
      };
    }
  );

  const mis = cached.payload;
  const lastMonth = String(mis.claim?.last_month || mis.budget?.last_month || range.endMonthYm).trim();
  const local = await loadLocalSmtAndStmData(profile.hcode, range.beYear, matchCutoff ? lastMonth : undefined);

  // 1. 3-way Budget comparison
  const misBudgetFunds = (Array.isArray(mis.budget?.by_fund) ? mis.budget.by_fund : []).map((f: any) => ({
    code: String(f.CODE || '').trim(),
    fundName: String(f.NAME || '').trim(),
    misAmount: roundBaht(f.CUR_AMT),
    misPrevAmount: roundBaht(f.PREV_AMT),
  }));
  const budgetThreeWay = buildBudgetThreeWayComparison(misBudgetFunds, local.smtRows, local.stmBuckets);

  // 2. Budget monthly comparison
  const budgetMonthly = buildMonthlyComparison(
    range.beYear,
    (Array.isArray(mis.budget?.monthly) ? mis.budget.monthly : []).map((m: any) => ({
      mm: String(m.MM || ''),
      misAmount: roundBaht(m.CUR_AMT),
      misPrevAmount: roundBaht(m.PREV_AMT),
    })),
    local.smtRows,
    local.stmBuckets,
    matchCutoff ? lastMonth : undefined
  );

  // 3. Service Claim monthly comparison (UC STM vs Eclaim/OP/IP)
  const ucBuckets = local.stmBuckets.filter(
    (b) => isUcLikeInscl(b.inscl) || b.fgroup === 'STM_IPUCS' || b.fgroup === 'STM_OPUCS'
  );
  const claimMonthly = buildMonthlyComparison(
    range.beYear,
    (Array.isArray(mis.claim?.monthly) ? mis.claim.monthly : []).map((m: any) => ({
      mm: String(m.MM || ''),
      misAmount: roundBaht(m.CUR_AMT),
      misOpAmount: roundBaht(m.CUR_OP_AMT),
      misIpAmount: roundBaht(m.CUR_IP_AMT),
      misPrevAmount: roundBaht(m.PREV_AMT),
      misCases: Number(m.CUR_VISIT || 0),
    })),
    [],
    ucBuckets,
    matchCutoff ? lastMonth : undefined
  );

  // 4. IP monthly comparison (MIS ip discharge vs STM IP)
  const ipBuckets = local.stmBuckets.filter(
    (b) => b.dept === 'IP' || b.fgroup === 'STM_IPUCS' || b.fgroup === 'STM_IP' || b.sumIpAmt > 0
  );
  const ipMonthly = buildMonthlyComparison(
    range.beYear,
    (Array.isArray(mis.ip?.monthly) ? mis.ip.monthly : []).map((m: any) => ({
      mm: String(m.MM || ''),
      misCases: Number(m.CUR_CASES || 0),
      misAdjRw: roundRw(m.CUR_ADJRW),
      misPrevAmount: Number(m.PREV_CASES || 0),
    })),
    [],
    ipBuckets,
    matchCutoff ? lastMonth : undefined
  );

  // 5. Subfund comparison (use full 1824 Statement UC subfunds if available, fallback to top_sub)
  const misSubfundSource =
    mis.statementUcSubfunds.length > 0
      ? mis.statementUcSubfunds.map((s: any) => ({
          code: String(s.SUB_FUND || s.FUND_AF || '').trim(),
          fundGroup: String(s.FUND_AF || '').trim(),
          name: String(s.DESCRIPTION || s.SUB_FUND || '').trim(),
          misVisits: Number(s.NUM_VISIT || 0),
          misAmount: roundBaht(s.ACT_AMT),
          misStmAmount: roundBaht(s.ACT_AMT_STM),
          misPrevAmount: 0,
        }))
      : (Array.isArray(mis.claim?.top_sub) ? mis.claim.top_sub : []).map((s: any) => ({
          code: String(s.SUB_FUND || s.FUND_AF || '').trim(),
          fundGroup: String(s.FUND_AF || '').trim(),
          name: String(s.NAME || s.SUB_FUND || '').trim(),
          misVisits: Number(s.CUR_VISIT || 0),
          misAmount: roundBaht(s.CUR_AMT),
          misStmAmount: 0,
          misPrevAmount: roundBaht(s.PREV_AMT),
        }));

  const subfundComparison = buildSubfundComparison(misSubfundSource, local.stmBuckets);

  // 6. DMIS, MOPH, KTP, Instrument sections
  const dmisSubfundSource = (Array.isArray(mis.dmis?.top_sub) ? mis.dmis.top_sub : []).map((s: any) => ({
    code: String(s.SUB_FUND || s.FUND_AF || '').trim(),
    fundGroup: String(s.FUND_AF || '').trim(),
    name: String(s.NAME || s.SUB_FUND || '').trim(),
    misVisits: Number(s.CUR_VISIT || 0),
    misAmount: roundBaht(s.CUR_AMT),
    misPrevAmount: roundBaht(s.PREV_AMT),
  }));
  const dmisComparison = buildSubfundComparison(
    dmisSubfundSource,
    local.stmBuckets.filter((b) => b.fgroup === 'DCKD' || b.fgroup === 'LGO_HD' || b.sumDmisAmt > 0 || b.sumDmishdAmt > 0)
  );

  const mophItems = (Array.isArray(mis.moph?.items) ? mis.moph.items : []).map((s: any) => ({
    code: String(s.SUB_FUND || '').trim(),
    fundGroup: String(s.FUND_AF || 'MORPROM').trim(),
    name: String(s.NAME || '').trim(),
    misVisits: Number(s.CUR_VISIT || 0),
    misAmount: roundBaht(s.CUR_AMT),
    misPrevAmount: roundBaht(s.PREV_AMT),
  }));
  const ktpItems = (Array.isArray(mis.ktp?.items) ? mis.ktp.items : []).map((s: any) => ({
    code: String(s.SUB_FUND || '').trim(),
    fundGroup: String(s.FUND_AF || 'KTP').trim(),
    name: String(s.NAME || '').trim(),
    misVisits: Number(s.CUR_VISIT || 0),
    misAmount: roundBaht(s.CUR_AMT),
    misPrevAmount: roundBaht(s.PREV_AMT),
  }));

  const instrumentTotalMis = roundBaht(
    (Array.isArray(mis.instrument?.monthly) ? mis.instrument.monthly : []).reduce(
      (sum: number, m: any) => sum + Number(m.CUR_AMT || 0),
      0
    )
  );
  const instrumentQtyMis = (Array.isArray(mis.instrument?.monthly) ? mis.instrument.monthly : []).reduce(
    (sum: number, m: any) => sum + Number(m.CUR_QTY || 0),
    0
  );
  const instrumentTotalStm = roundBaht(local.stmBuckets.reduce((sum, b) => sum + b.sumInstAmt, 0));

  // KPI Totals
  const misBudgetTotal = roundBaht(misBudgetFunds.reduce((s: number, f: any) => s + f.misAmount, 0));
  const smtTotal = roundBaht(local.smtRows.reduce((s, r) => s + r.sumAmount, 0));
  const smtNetTotal = roundBaht(local.smtRows.reduce((s, r) => s + r.sumNet, 0));
  const stmTotalAll = roundBaht(local.stmBuckets.reduce((s, b) => s + b.sumPaid, 0));
  const stmTotalUc = roundBaht(ucBuckets.reduce((s, b) => s + b.sumPaid, 0));

  const misClaimTotal = roundBaht(claimMonthly.reduce((s, m) => s + m.misAmount, 0));
  const misClaimVisits = claimMonthly.reduce((s, m) => s + m.misCases, 0);

  const misIpCases = ipMonthly.reduce((s, m) => s + m.misCases, 0);
  const misIpAdjRw = roundRw(ipMonthly.reduce((s, m) => s + m.misAdjRw, 0));
  const stmIpCases = ipBuckets.reduce((s, b) => s + b.cnt, 0);
  const stmIpAdjRw = roundRw(ipBuckets.reduce((s, b) => s + b.sumAdjRw, 0));

  const misDmisTotal = roundBaht(mis.dmis?.total?.CUR_AMT);
  const misDmisVisits = Number(mis.dmis?.total?.CUR_VISIT || 0);
  const stmDmisTotal = roundBaht(
    local.stmBuckets
      .filter((b) => b.fgroup === 'DCKD' || b.fgroup === 'LGO_HD' || b.sumDmisAmt > 0 || b.sumDmishdAmt > 0)
      .reduce((s, b) => s + (b.fgroup === 'DCKD' || b.fgroup === 'LGO_HD' ? b.sumPaid : b.sumDmisAmt + b.sumDmishdAmt), 0)
  );

  return {
    profile,
    budgetYear: range.beYear,
    lastMonth,
    matchCutoff,
    dateRange: { startDate: local.startDate, endDate: local.endDate, cutoffYm: local.cutoffYm },
    cache: {
      fetchedAt: cached.fetchedAt,
      fromCache: cached.fromCache,
      stale: cached.stale,
      warning: cached.warning,
    },
    kpis: {
      budget: {
        misAmount: misBudgetTotal,
        smtAmount: smtTotal,
        smtNetAmount: smtNetTotal,
        stmAmount: stmTotalAll,
        diffMisSmt: roundBaht(misBudgetTotal - smtTotal),
        diffMisStm: roundBaht(misBudgetTotal - stmTotalAll),
        coverageSmtPct: computeCoveragePct(smtTotal, misBudgetTotal),
        coverageStmPct: computeCoveragePct(stmTotalAll, misBudgetTotal),
      },
      claim: {
        misAmount: misClaimTotal,
        misVisits: misClaimVisits,
        stmUcAmount: stmTotalUc,
        stmAllAmount: stmTotalAll,
        diffMisStmUc: roundBaht(misClaimTotal - stmTotalUc),
        coveragePct: computeCoveragePct(stmTotalUc, misClaimTotal),
      },
      ip: {
        misCases: misIpCases,
        misAdjRw: misIpAdjRw,
        misCmi: misIpCases > 0 ? Math.round((misIpAdjRw / misIpCases) * 100) / 100 : 0,
        stmCases: stmIpCases,
        stmAdjRw: stmIpAdjRw,
        stmCmi: stmIpCases > 0 ? Math.round((stmIpAdjRw / stmIpCases) * 100) / 100 : 0,
      },
      dmis: {
        misAmount: misDmisTotal,
        misVisits: misDmisVisits,
        stmAmount: stmDmisTotal,
        diffMisStm: roundBaht(misDmisTotal - stmDmisTotal),
        coveragePct: computeCoveragePct(stmDmisTotal, misDmisTotal),
      },
      instrument: {
        misAmount: instrumentTotalMis,
        misQty: instrumentQtyMis,
        stmAmount: instrumentTotalStm,
        diffMisStm: roundBaht(instrumentTotalMis - instrumentTotalStm),
        coveragePct: computeCoveragePct(instrumentTotalStm, instrumentTotalMis),
      },
    },
    budgetThreeWay: budgetThreeWay.rows,
    outsideNhsoStm: budgetThreeWay.outsideNhsoStm,
    budgetSubfunds: mis.budgetSubfunds,
    budgetMonthly,
    claimMonthly,
    ipMonthly,
    subfundComparison,
    dmisComparison,
    moph: { total: mis.moph?.total || {}, items: mophItems },
    ktp: { total: mis.ktp?.total || {}, items: ktpItems },
    instrument: {
      topItems: Array.isArray(mis.instrument?.top_items) ? mis.instrument.top_items : [],
      totalMis: instrumentTotalMis,
      totalStm: instrumentTotalStm,
    },
    stmFiles: local.stmFiles.slice(0, 60),
  };
}

interface SimpleStudioPageCachePayload {
  templateName: string;
  stId: string;
  cards: Array<{
    config: MisSimpleStudioCardConfig;
    rows: Record<string, unknown>[];
  }>;
}

async function fetchSimpleStudioTemplateWithCards(
  stId: string,
  profile: MisHospitalProfile,
  ceYear: number
): Promise<SimpleStudioPageCachePayload> {
  const tplList = await postMisJson<Array<Record<string, unknown>>>('simplestudio/ss_statement.php', {
    st_id: stId,
    api_type: 'template_get',
    year: String(ceYear),
    hcode: profile.hcode,
  });

  const tpl = Array.isArray(tplList) ? tplList[0] : undefined;
  const templateName = String(tpl?.ST_TEMPLATENAME || `Template ${stId}`).trim();
  const cardConfigs = decodeStConfig(tpl?.ST_CONFIG);

  const cards = await Promise.all(
    cardConfigs.map(async (config) => {
      try {
        const rows = await postMisJson<Record<string, unknown>[]>('simplestudio/ss_statement.php', {
          ssid: config.ssid,
          api_type: 'get_tabledata',
          hcode: profile.hcode,
          province: profile.provinceId,
          year: String(ceYear),
        });
        return { config, rows: Array.isArray(rows) ? rows : [] };
      } catch {
        return { config, rows: [] };
      }
    })
  );

  return { templateName, stId, cards };
}

export async function getMisComparePage(options: {
  pageKey: string;
  budgetYear?: string;
  refresh?: boolean;
  matchCutoff?: boolean;
}) {
  const pageDef = getMisPageByKey(options.pageKey);
  if (!pageDef) {
    throw new Error(`ไม่พบหน้า MIS HOS รหัส "${options.pageKey}"`);
  }
  if (pageDef.kind === 'overview') {
    return { kind: 'overview', overview: await getMisCompareOverview(options) };
  }

  const profile = await resolveHospitalProfile();
  const range = getFiscalDateRange(options.budgetYear || '2569');
  const refresh = Boolean(options.refresh);

  const cached = await fetchMisWithCache<{ primary: SimpleStudioPageCachePayload; extras: SimpleStudioPageCachePayload[] }>(
    profile.hcode,
    range.beYear,
    pageDef.key,
    refresh,
    async () => {
      const primary = await fetchSimpleStudioTemplateWithCards(pageDef.stId!, profile, range.ceYear);
      const extras = await Promise.all(
        (pageDef.extraStIds || []).map((id) => fetchSimpleStudioTemplateWithCards(id, profile, range.ceYear))
      );
      return { primary, extras };
    }
  );

  const local = await loadLocalSmtAndStmData(profile.hcode, range.beYear);
  const sliced = sliceStmBucketsForCategory(pageDef.stmMatchCategory, local.stmBuckets, local.stmFiles);

  const allRawCards = [
    ...cached.payload.primary.cards,
    ...cached.payload.extras.flatMap((e) => e.cards),
  ];

  const cards: MisSimpleStudioCardResult[] = allRawCards.map(({ config, rows }) => {
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    const cmp = buildCardComparison(config, rows, pageDef.supportsThreeWay ? local.smtRows : [], sliced.buckets);
    return {
      ssid: config.ssid,
      reportName: config.report_name || `Card ${config.ssid}`,
      chartType: config.chart_type,
      reportWidth: config.report_width,
      remark: config.remark,
      columns,
      rows,
      compareMode: cmp.compareMode,
      compareRows: cmp.compareRows,
      misTotal: cmp.misTotal,
    };
  });

  // Choose the most informative positive total across cards as the page headline MIS total
  const tableCardsWithTotal = cards.filter((c) => c.misTotal > 0);
  const misHeadlineTotal =
    tableCardsWithTotal.find((c) => c.compareMode === 'subfund')?.misTotal ??
    tableCardsWithTotal.find((c) => c.compareMode === 'monthly')?.misTotal ??
    tableCardsWithTotal[0]?.misTotal ??
    0;

  const smtTotal = pageDef.supportsThreeWay ? roundBaht(local.smtRows.reduce((s, r) => s + r.sumAmount, 0)) : null;

  return {
    kind: 'simplestudio',
    profile,
    page: pageDef,
    templateName: cached.payload.primary.templateName,
    budgetYear: range.beYear,
    dateRange: { startDate: local.startDate, endDate: local.endDate, cutoffYm: local.cutoffYm },
    cache: {
      fetchedAt: cached.fetchedAt,
      fromCache: cached.fromCache,
      stale: cached.stale,
      warning: cached.warning,
    },
    summary: {
      misAmount: misHeadlineTotal,
      smtAmount: smtTotal,
      stmAmount: sliced.totalAmount,
      stmCount: sliced.totalCount,
      stmAdjRw: sliced.totalAdjRw,
      diffMisStm: roundBaht(misHeadlineTotal - sliced.totalAmount),
      coveragePct: computeCoveragePct(sliced.totalAmount, misHeadlineTotal),
      sliceNote: sliced.note,
      allStmAmount: roundBaht(local.stmBuckets.reduce((s, b) => s + b.sumPaid, 0)),
    },
    cards,
    stmBreakdown: deriveStmComponentSubfunds(sliced.buckets).sort((a, b) => b.amount - a.amount),
    stmFiles: sliced.files,
  };
}
