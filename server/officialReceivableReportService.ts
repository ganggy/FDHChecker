import * as XLSX from 'xlsx';
import { getUTFConnection, getRepstmConnection } from './db/connection.js';
import { getHospitalInfo } from './receivableReportService.js';
import {
  OFFICIAL_CHART_OF_ACCOUNTS_54,
  normalizeAccountCode,
  THAI_MONTH_NAMES,
  type OfficialChartAccount,
} from './officialReceivableConstants.js';
import { RECEIVABLE_RIGHT_MAPPINGS } from './receivableMapping.js';

export interface FiscalPeriodInfo {
  month: number;
  yearBE: number;
  yearCE: number;
  monthName: string;
  startDate: string;
  endDate: string;
  fyStartDate: string;
  cutoffDate: string;
}

export const calculateFiscalPeriod = (monthInput: unknown, yearBeInput: unknown): FiscalPeriodInfo => {
  const now = new Date();
  let month = Number(monthInput);
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    month = now.getMonth() + 1;
  }

  let yearBE = Number(yearBeInput);
  if (!Number.isFinite(yearBE) || yearBE < 2500 || yearBE > 2600) {
    const curYearCE = now.getFullYear();
    // In Thailand fiscal year starts Oct 1: if cur month >= 10, FY = curYear + 544, else curYear + 543
    yearBE = curYearCE + (now.getMonth() + 1 >= 10 ? 544 : 543);
  }

  // Calendar year CE for this month in the fiscal year:
  // Month 10-12 belongs to calendar year (yearBE - 544)
  // Month 1-9 belongs to calendar year (yearBE - 543)
  const yearCE = month >= 10 ? yearBE - 544 : yearBE - 543;
  const fyStartCE = yearBE - 544; // October 1 of this calendar year

  const mm = String(month).padStart(2, '0');
  const startDate = `${yearCE}-${mm}-01`;
  const lastDay = new Date(yearCE, month, 0).getDate();
  const endDate = `${yearCE}-${mm}-${String(lastDay).padStart(2, '0')}`;
  const fyStartDate = `${fyStartCE}-10-01`;

  return {
    month,
    yearBE,
    yearCE,
    monthName: THAI_MONTH_NAMES[month - 1] || `เดือน ${month}`,
    startDate,
    endDate,
    fyStartDate,
    cutoffDate: endDate,
  };
};

export const resolveDebtorCode = (pttype: string, isIpd = false): string => {
  const code = String(pttype || '').trim();
  const mapping = RECEIVABLE_RIGHT_MAPPINGS.find(m => m.hosxp_code === code);
  let debtorCode = isIpd ? (mapping?.debtor_ipd || '') : (mapping?.debtor_opd || '');
  if (!debtorCode) {
    debtorCode = isIpd ? '1102050102.107' : '1102050102.106';
  }
  return normalizeAccountCode(debtorCode);
};

// =========================================================================
// Reconciliation Data Interfaces & Helpers (FDH + REP + STM)
// =========================================================================
export interface FdhStatusInfo {
  txId: string;
  statusMessage: string;
  stmPeriod: string;
  sendDate: string;
}

export interface RepDataInfo {
  repNo: string;
  tranId: string;
  errorCodes: string;
  compensated: number;
}

export interface StmDataInfo {
  statementNo: string;
  tranId: string;
  errorCode: string;
  paidAmount: number;
}

export const fetchReconciliationMaps = async (
  connection: any,
  repConn: any,
  vns: string[],
  ans: string[]
): Promise<{
  fdhMap: Map<string, FdhStatusInfo>;
  repMap: Map<string, RepDataInfo>;
  stmMap: Map<string, StmDataInfo>;
}> => {
  const fdhMap = new Map<string, FdhStatusInfo>();
  const repMap = new Map<string, RepDataInfo>();
  const stmMap = new Map<string, StmDataInfo>();

  const cleanVns = [...new Set(vns.map(v => String(v || '').trim()).filter(Boolean))];
  const cleanAns = [...new Set(ans.map(a => String(a || '').trim()).filter(Boolean))];

  // 1. FDH from HOSxP (connection)
  if (cleanVns.length > 0) {
    try {
      for (let i = 0; i < cleanVns.length; i += 1000) {
        const chunk = cleanVns.slice(i, i + 1000);
        const [rows] = await connection.query(
          `SELECT
             vn,
             COALESCE(transaction_uid, '') AS tx_id,
             COALESCE(fdh_claim_status_message, '') AS status_msg,
             COALESCE(fdh_stm_period, '') AS stm_period,
             DATE_FORMAT(fdh_claim_status_datetime, '%d/%m/%Y %H:%i') AS send_date
           FROM fdh_claim_status
           WHERE vn IN (?)`,
          [chunk]
        );
        for (const r of (Array.isArray(rows) ? rows : []) as Record<string, unknown>[]) {
          const vn = String(r.vn || '').trim();
          if (vn) {
            fdhMap.set(vn, {
              txId: String(r.tx_id || ''),
              statusMessage: String(r.status_msg || ''),
              stmPeriod: String(r.stm_period || ''),
              sendDate: String(r.send_date || ''),
            });
          }
        }
      }
    } catch {
      // optional FDH table lookup tolerance
    }
  }

  // 2. REP & STM from repstminv (repConn)
  if (repConn) {
    // REP for VNs
    if (cleanVns.length > 0) {
      try {
        for (let i = 0; i < cleanVns.length; i += 1000) {
          const chunk = cleanVns.slice(i, i + 1000);
          const [rows] = await repConn.query(
            `SELECT
               vn,
               GROUP_CONCAT(DISTINCT NULLIF(TRIM(rep_no), '') SEPARATOR ', ') AS rep_no,
               GROUP_CONCAT(DISTINCT NULLIF(TRIM(tran_id), '') SEPARATOR ', ') AS tran_id,
               GROUP_CONCAT(DISTINCT NULLIF(TRIM(errorcode), '') SEPARATOR ', ') AS error_codes,
               SUM(COALESCE(compensated, 0)) AS rep_compensated
             FROM rep_data
             WHERE vn IN (?)
             GROUP BY vn`,
            [chunk]
          );
          for (const r of (Array.isArray(rows) ? rows : []) as Record<string, unknown>[]) {
            const vn = String(r.vn || '').trim();
            if (vn) {
              repMap.set(vn, {
                repNo: String(r.rep_no || ''),
                tranId: String(r.tran_id || ''),
                errorCodes: String(r.error_codes || ''),
                compensated: Number(r.rep_compensated || 0),
              });
            }
          }
        }
      } catch {
        // optional REP lookup tolerance
      }
    }

    // REP for ANs
    if (cleanAns.length > 0) {
      try {
        for (let i = 0; i < cleanAns.length; i += 1000) {
          const chunk = cleanAns.slice(i, i + 1000);
          const [rows] = await repConn.query(
            `SELECT
               an,
               GROUP_CONCAT(DISTINCT NULLIF(TRIM(rep_no), '') SEPARATOR ', ') AS rep_no,
               GROUP_CONCAT(DISTINCT NULLIF(TRIM(tran_id), '') SEPARATOR ', ') AS tran_id,
               GROUP_CONCAT(DISTINCT NULLIF(TRIM(errorcode), '') SEPARATOR ', ') AS error_codes,
               SUM(COALESCE(compensated, 0)) AS rep_compensated
             FROM rep_data
             WHERE an IN (?)
             GROUP BY an`,
            [chunk]
          );
          for (const r of (Array.isArray(rows) ? rows : []) as Record<string, unknown>[]) {
            const an = String(r.an || '').trim();
            if (an) {
              repMap.set(an, {
                repNo: String(r.rep_no || ''),
                tranId: String(r.tran_id || ''),
                errorCodes: String(r.error_codes || ''),
                compensated: Number(r.rep_compensated || 0),
              });
            }
          }
        }
      } catch {
        // optional REP lookup tolerance
      }
    }

    // STM for VNs
    if (cleanVns.length > 0) {
      try {
        for (let i = 0; i < cleanVns.length; i += 1000) {
          const chunk = cleanVns.slice(i, i + 1000);
          const [rows] = await repConn.query(
            `SELECT
               vn,
               GROUP_CONCAT(DISTINCT NULLIF(TRIM(statement_no), '') SEPARATOR ', ') AS statement_no,
               SUM(COALESCE(paid_amount, amount, 0)) AS total_paid,
               GROUP_CONCAT(DISTINCT NULLIF(TRIM(tran_id), '') SEPARATOR ', ') AS tran_id,
               GROUP_CONCAT(DISTINCT NULLIF(TRIM(errorcode), '') SEPARATOR ', ') AS error_codes
             FROM repstm_statement_data
             WHERE data_type IN ('STM', 'INV') AND vn IN (?)
             GROUP BY vn`,
            [chunk]
          );
          for (const r of (Array.isArray(rows) ? rows : []) as Record<string, unknown>[]) {
            const vn = String(r.vn || '').trim();
            if (vn) {
              stmMap.set(vn, {
                statementNo: String(r.statement_no || ''),
                paidAmount: Number(r.total_paid || 0),
                errorCode: String(r.error_codes || ''),
                tranId: String(r.tran_id || ''),
              });
            }
          }
        }
      } catch {
        // optional STM lookup tolerance
      }
    }

    // STM for ANs
    if (cleanAns.length > 0) {
      try {
        for (let i = 0; i < cleanAns.length; i += 1000) {
          const chunk = cleanAns.slice(i, i + 1000);
          const [rows] = await repConn.query(
            `SELECT
               an,
               GROUP_CONCAT(DISTINCT NULLIF(TRIM(statement_no), '') SEPARATOR ', ') AS statement_no,
               SUM(COALESCE(paid_amount, amount, 0)) AS total_paid,
               GROUP_CONCAT(DISTINCT NULLIF(TRIM(tran_id), '') SEPARATOR ', ') AS tran_id,
               GROUP_CONCAT(DISTINCT NULLIF(TRIM(errorcode), '') SEPARATOR ', ') AS error_codes
             FROM repstm_statement_data
             WHERE data_type IN ('STM', 'INV') AND an IN (?)
             GROUP BY an`,
            [chunk]
          );
          for (const r of (Array.isArray(rows) ? rows : []) as Record<string, unknown>[]) {
            const an = String(r.an || '').trim();
            if (an) {
              stmMap.set(an, {
                statementNo: String(r.statement_no || ''),
                paidAmount: Number(r.total_paid || 0),
                errorCode: String(r.error_codes || ''),
                tranId: String(r.tran_id || ''),
              });
            }
          }
        }
      } catch {
        // optional STM lookup tolerance
      }
    }
  }

  return { fdhMap, repMap, stmMap };
};

export const formatReconciledRepStm = (
  fdh?: FdhStatusInfo,
  rep?: RepDataInfo,
  stm?: StmDataInfo
): string => {
  const parts: string[] = [];
  if (stm?.statementNo) parts.push(`STM:${stm.statementNo}`);
  if (rep?.repNo) parts.push(`REP:${rep.repNo}`);
  if (parts.length === 0) {
    if (fdh?.stmPeriod) parts.push(`FDH:${fdh.stmPeriod}`);
    else if (fdh?.txId) parts.push(`FDH:${fdh.txId.slice(0, 8)}`);
    else if (fdh?.statusMessage) parts.push(`FDH:${fdh.statusMessage}`);
  }
  return parts.join(' | ');
};

export const formatReconciledReason = (
  fdh?: FdhStatusInfo,
  rep?: RepDataInfo,
  stm?: StmDataInfo,
  remainder = 0,
  claimed = 0
): string => {
  if (stm?.errorCode && stm.errorCode !== '-') {
    return `STM ข้อผิดพลาด: ${stm.errorCode}`;
  }
  if (rep?.errorCodes && rep.errorCodes !== '-') {
    return `REP ติด C: ${rep.errorCodes}`;
  }
  if (fdh?.statusMessage) {
    return `FDH: ${fdh.statusMessage}`;
  }
  if (remainder <= 0 && claimed > 0) {
    return 'ชำระ/ชดเชยครบถ้วน';
  }
  if (stm?.statementNo) {
    return 'รับชดเชยแล้ว';
  }
  if (rep?.repNo) {
    return 'ผ่าน REP รอ STM';
  }
  return claimed > 0 ? 'รอส่งเคลม/รอผล' : 'ยังไม่เรียกเก็บ';
};

// =========================================================================
// 1. สรุปลูกหนี้คงเหลือ แยกตามอายุ (54 ผังบัญชี)
// =========================================================================
export interface AgingForm1Item {
  code: string;
  order: number;
  name: string;
  isIpd: boolean;
  caseCount: number;
  totalValue: number;
  le30Days: number;
  gt30Days: number;
}

export interface AgingForm1Result {
  period: FiscalPeriodInfo;
  hospitalName: string;
  items: AgingForm1Item[];
  totals: {
    caseCount: number;
    totalValue: number;
    le30Days: number;
    gt30Days: number;
  };
}

export const getOfficialReceivableAgingReport = async (
  monthInput?: unknown,
  yearBeInput?: unknown
): Promise<AgingForm1Result> => {
  const period = calculateFiscalPeriod(monthInput, yearBeInput);
  const hosp = await getHospitalInfo();
  const connection = await getUTFConnection();
  let repConn: any = null;
  try {
    repConn = await getRepstmConnection();
  } catch {
    repConn = null;
  }

  try {
    // 1. OPD visits in month
    const [opdRows] = await connection.query(
      `SELECT
         o.pttype,
         o.vstdate,
         o.vn,
         DATEDIFF(?, o.vstdate) AS age_days,
         COALESCE(v.income, 0) AS total_income,
         COALESCE(v.rcpt_money, 0) AS paid_money
       FROM ovst o
       JOIN vn_stat v ON v.vn = o.vn
       WHERE o.vstdate BETWEEN ? AND ?
         AND COALESCE(v.income, 0) > 0`,
      [period.cutoffDate, period.startDate, period.endDate]
    );

    // 2. IPD admissions in month
    const [ipdRows] = await connection.query(
      `SELECT
         i.pttype,
         i.an,
         COALESCE(i.vn, '') AS vn,
         COALESCE(i.dchdate, i.regdate) AS discharge_date,
         DATEDIFF(?, COALESCE(i.dchdate, i.regdate)) AS age_days,
         COALESCE(a.income, 0) AS total_income,
         COALESCE(a.rcpt_money, 0) AS paid_money
       FROM ipt i
       JOIN an_stat a ON a.an = i.an
       WHERE COALESCE(i.dchdate, i.regdate) BETWEEN ? AND ?
         AND COALESCE(a.income, 0) > 0`,
      [period.cutoffDate, period.startDate, period.endDate]
    );

    const opdList = (Array.isArray(opdRows) ? opdRows : []) as Record<string, unknown>[];
    const ipdList = (Array.isArray(ipdRows) ? ipdRows : []) as Record<string, unknown>[];
    const vns = [...opdList.map(r => String(r.vn || '')), ...ipdList.map(r => String(r.vn || ''))].filter(Boolean);
    const ans = ipdList.map(r => String(r.an || '')).filter(Boolean);

    const { stmMap } = await fetchReconciliationMaps(connection, repConn, vns, ans);

    // Grouping by normalized account code
    const statsMap = new Map<string, { count: number; total: number; le30: number; gt30: number }>();

    const addRecord = (accountCode: string, total: number, ageDays: number) => {
      if (total <= 0) return;
      const cur = statsMap.get(accountCode) || { count: 0, total: 0, le30: 0, gt30: 0 };
      cur.count += 1;
      cur.total += total;
      if (ageDays <= 30) {
        cur.le30 += total;
      } else {
        cur.gt30 += total;
      }
      statsMap.set(accountCode, cur);
    };

    for (const r of opdList) {
      const code = resolveDebtorCode(String(r.pttype || ''), false);
      const vn = String(r.vn || '');
      const stm = stmMap.get(vn);
      const compensated = stm ? Number(stm.paidAmount || 0) : 0;
      const remain = Math.max(0, Math.round((Number(r.total_income || 0) - Number(r.paid_money || 0) - compensated) * 100) / 100);
      const ageDays = Math.max(0, Number(r.age_days || 0));
      addRecord(code, remain, ageDays);
    }

    for (const r of ipdList) {
      const code = resolveDebtorCode(String(r.pttype || ''), true);
      const an = String(r.an || '');
      const vn = String(r.vn || '');
      const stm = stmMap.get(an) || (vn ? stmMap.get(vn) : undefined);
      const compensated = stm ? Number(stm.paidAmount || 0) : 0;
      const remain = Math.max(0, Math.round((Number(r.total_income || 0) - Number(r.paid_money || 0) - compensated) * 100) / 100);
      const ageDays = Math.max(0, Number(r.age_days || 0));
      addRecord(code, remain, ageDays);
    }

    // Build the 54 rows
    const items: AgingForm1Item[] = OFFICIAL_CHART_OF_ACCOUNTS_54.map((acc) => {
      const stat = statsMap.get(acc.code) || { count: 0, total: 0, le30: 0, gt30: 0 };
      return {
        code: acc.code,
        order: acc.order,
        name: acc.name,
        isIpd: acc.isIpd,
        caseCount: stat.count,
        totalValue: Math.round(stat.total * 100) / 100,
        le30Days: Math.round(stat.le30 * 100) / 100,
        gt30Days: Math.round(stat.gt30 * 100) / 100,
      };
    });

    const totals = items.reduce(
      (acc, item) => {
        acc.caseCount += item.caseCount;
        acc.totalValue += item.totalValue;
        acc.le30Days += item.le30Days;
        acc.gt30Days += item.gt30Days;
        return acc;
      },
      { caseCount: 0, totalValue: 0, le30Days: 0, gt30Days: 0 }
    );

    totals.totalValue = Math.round(totals.totalValue * 100) / 100;
    totals.le30Days = Math.round(totals.le30Days * 100) / 100;
    totals.gt30Days = Math.round(totals.gt30Days * 100) / 100;

    return {
      period,
      hospitalName: hosp.hospitalName,
      items,
      totals,
    };
  } finally {
    connection.release();
    if (repConn) repConn.release();
  }
};

// =========================================================================
// 2. ทะเบียนคุมงานเรียกเก็บ (ตัวอย่างจากทะเบียนคุมงานประกัน)
// =========================================================================
export interface ClaimControlForm2Row {
  no: number;
  hn: string;
  vn: string;
  an: string;
  cid: string;
  patientName: string;
  serviceDate: string;
  dischargeDate: string;
  pttypeName: string;
  debtorCode: string;
  costAmount: number;
  claimedAmount: number;
  repStm: string;
  compensatedAmount: number;
  varianceAmount: number;
  balanceAmount: number;
  paidDate: string;
  paidAmount: number;
  remainderAmount: number;
  le30DaysAmount: number;
  gt30DaysAmount: number;
  reason: string;
}

export interface ClaimControlForm2Result {
  period: FiscalPeriodInfo;
  hospitalName: string;
  accountFilter: string;
  accountName: string;
  rows: ClaimControlForm2Row[];
  monthTotals: {
    costAmount: number;
    claimedAmount: number;
    compensatedAmount: number;
    varianceAmount: number;
    balanceAmount: number;
    paidAmount: number;
    remainderAmount: number;
    le30DaysAmount: number;
    gt30DaysAmount: number;
  };
  ytdTotals: {
    costAmount: number;
    claimedAmount: number;
    compensatedAmount: number;
    varianceAmount: number;
    balanceAmount: number;
    paidAmount: number;
    remainderAmount: number;
    le30DaysAmount: number;
    gt30DaysAmount: number;
  };
}

export const getOfficialClaimControlLedger = async (
  monthInput?: unknown,
  yearBeInput?: unknown,
  accountCodeFilter?: string
): Promise<ClaimControlForm2Result> => {
  const period = calculateFiscalPeriod(monthInput, yearBeInput);
  const hosp = await getHospitalInfo();
  const filterCode = accountCodeFilter ? normalizeAccountCode(accountCodeFilter) : 'ALL';
  const targetMeta = OFFICIAL_CHART_OF_ACCOUNTS_54.find(a => a.code === filterCode);
  const accountName = targetMeta ? targetMeta.name : (filterCode === 'ALL' ? 'ทุกประเภทผังบัญชี' : filterCode);

  const connection = await getUTFConnection();
  let repConn: any = null;
  try {
    repConn = await getRepstmConnection();
  } catch {
    repConn = null;
  }

  try {
    // We query both the selected month AND the YTD period (fyStartDate to endDate)
    // To be efficient, we query YTD and split into month vs YTD in memory
    const [opdData] = await connection.query(
      `SELECT
         o.hn,
         o.vn,
         '' AS an,
         COALESCE(pt.cid, '') AS cid,
         CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
         DATE_FORMAT(o.vstdate, '%d/%m/%Y') AS service_date_fmt,
         o.vstdate AS service_date_raw,
         '' AS discharge_date_fmt,
         COALESCE(ptt.name, o.pttype) AS pttype_name,
         o.pttype,
         COALESCE(v.income, 0) AS cost_amount,
         '' AS claim_code,
         COALESCE(v.rcpt_money, 0) AS paid_money,
         CASE WHEN COALESCE(v.rcpt_money, 0) > 0 THEN DATE_FORMAT(o.vstdate, '%d/%m/%Y') ELSE '' END AS paid_date_fmt
       FROM ovst o
       JOIN vn_stat v ON v.vn = o.vn
       LEFT JOIN patient pt ON pt.hn = o.hn
       LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
       WHERE o.vstdate BETWEEN ? AND ?
         AND COALESCE(v.income, 0) > 0
       ORDER BY o.vstdate, o.vn`,
      [period.fyStartDate, period.endDate]
    );

    const [ipdData] = await connection.query(
      `SELECT
         i.hn,
         COALESCE(i.vn, '') AS vn,
         i.an,
         COALESCE(pt.cid, '') AS cid,
         CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
         DATE_FORMAT(i.regdate, '%d/%m/%Y') AS service_date_fmt,
         COALESCE(i.dchdate, i.regdate) AS service_date_raw,
         DATE_FORMAT(COALESCE(i.dchdate, i.regdate), '%d/%m/%Y') AS discharge_date_fmt,
         COALESCE(ptt.name, i.pttype) AS pttype_name,
         i.pttype,
         COALESCE(a.income, 0) AS cost_amount,
         '' AS claim_code,
         COALESCE(a.rcpt_money, 0) AS paid_money,
         '' AS paid_date_fmt
       FROM ipt i
       JOIN an_stat a ON a.an = i.an
       LEFT JOIN patient pt ON pt.hn = i.hn
       LEFT JOIN pttype ptt ON ptt.pttype = i.pttype
       WHERE COALESCE(i.dchdate, i.regdate) BETWEEN ? AND ?
         AND COALESCE(a.income, 0) > 0
       ORDER BY COALESCE(i.dchdate, i.regdate), i.an`,
      [period.fyStartDate, period.endDate]
    );

    const opdList = (Array.isArray(opdData) ? opdData : []) as Record<string, unknown>[];
    const ipdList = (Array.isArray(ipdData) ? ipdData : []) as Record<string, unknown>[];
    const allVns = [...opdList.map(r => String(r.vn || '')), ...ipdList.map(r => String(r.vn || ''))].filter(Boolean);
    const allAns = ipdList.map(r => String(r.an || '')).filter(Boolean);

    const { fdhMap, repMap, stmMap } = await fetchReconciliationMaps(connection, repConn, allVns, allAns);

    const cutoffDateObj = new Date(period.cutoffDate);
    const monthStartObj = new Date(period.startDate);
    const monthEndObj = new Date(period.endDate);

    const monthRows: ClaimControlForm2Row[] = [];
    const monthTotals = {
      costAmount: 0,
      claimedAmount: 0,
      compensatedAmount: 0,
      varianceAmount: 0,
      balanceAmount: 0,
      paidAmount: 0,
      remainderAmount: 0,
      le30DaysAmount: 0,
      gt30DaysAmount: 0,
    };
    const ytdTotals = {
      costAmount: 0,
      claimedAmount: 0,
      compensatedAmount: 0,
      varianceAmount: 0,
      balanceAmount: 0,
      paidAmount: 0,
      remainderAmount: 0,
      le30DaysAmount: 0,
      gt30DaysAmount: 0,
    };

    let rowIdx = 1;

    const processVisit = (raw: Record<string, unknown>, isIpd: boolean) => {
      const pttype = String(raw.pttype || '').trim();
      const debtorCode = resolveDebtorCode(pttype, isIpd);
      if (filterCode !== 'ALL' && debtorCode !== filterCode) {
        return;
      }

      const cost = Number(raw.cost_amount || 0);
      const claimed = cost; // Default claimable is hospital cost
      const anKey = isIpd ? String(raw.an || '') : '';
      const vnKey = String(raw.vn || '');
      const fdh = vnKey ? fdhMap.get(vnKey) : undefined;
      const rep = isIpd ? (repMap.get(anKey) || (vnKey ? repMap.get(vnKey) : undefined)) : repMap.get(vnKey);
      const stm = isIpd ? (stmMap.get(anKey) || (vnKey ? stmMap.get(vnKey) : undefined)) : stmMap.get(vnKey);

      const repStm = formatReconciledRepStm(fdh, rep, stm);
      const compensated = stm ? Number(stm.paidAmount || 0) : 0;
      const variance = Math.round((claimed - compensated) * 100) / 100;
      const balance = Math.max(0, variance);
      const paid = Number(raw.paid_money || 0);
      const paidDate = String(raw.paid_date_fmt || '');
      const remainder = Math.max(0, Math.round((cost - compensated - paid) * 100) / 100);

      const sDateRaw = new Date(String(raw.service_date_raw || ''));
      const ageDays = Math.max(0, Math.round((cutoffDateObj.getTime() - sDateRaw.getTime()) / (1000 * 60 * 60 * 24)));
      const le30 = ageDays <= 30 ? remainder : 0;
      const gt30 = ageDays > 30 ? remainder : 0;
      const reason = formatReconciledReason(fdh, rep, stm, remainder, claimed);

      // Accumulate YTD
      ytdTotals.costAmount += cost;
      ytdTotals.claimedAmount += claimed;
      ytdTotals.compensatedAmount += compensated;
      ytdTotals.varianceAmount += variance;
      ytdTotals.balanceAmount += balance;
      ytdTotals.paidAmount += paid;
      ytdTotals.remainderAmount += remainder;
      ytdTotals.le30DaysAmount += le30;
      ytdTotals.gt30DaysAmount += gt30;

      // Check if within current month
      const isCurrentMonth = sDateRaw >= monthStartObj && sDateRaw <= monthEndObj;
      if (isCurrentMonth) {
        monthTotals.costAmount += cost;
        monthTotals.claimedAmount += claimed;
        monthTotals.compensatedAmount += compensated;
        monthTotals.varianceAmount += variance;
        monthTotals.balanceAmount += balance;
        monthTotals.paidAmount += paid;
        monthTotals.remainderAmount += remainder;
        monthTotals.le30DaysAmount += le30;
        monthTotals.gt30DaysAmount += gt30;

        monthRows.push({
          no: rowIdx++,
          hn: String(raw.hn || ''),
          vn: String(raw.vn || ''),
          an: String(raw.an || ''),
          cid: String(raw.cid || ''),
          patientName: String(raw.patient_name || ''),
          serviceDate: String(raw.service_date_fmt || ''),
          dischargeDate: String(raw.discharge_date_fmt || ''),
          pttypeName: String(raw.pttype_name || ''),
          debtorCode,
          costAmount: cost,
          claimedAmount: claimed,
          repStm,
          compensatedAmount: compensated,
          varianceAmount: variance,
          balanceAmount: balance,
          paidDate,
          paidAmount: paid,
          remainderAmount: remainder,
          le30DaysAmount: le30,
          gt30DaysAmount: gt30,
          reason,
        });
      }
    };

    for (const r of (Array.isArray(opdData) ? opdData : []) as Record<string, unknown>[]) {
      processVisit(r, false);
    }
    for (const r of (Array.isArray(ipdData) ? ipdData : []) as Record<string, unknown>[]) {
      processVisit(r, true);
    }

    const roundTotals = (t: typeof monthTotals) => {
      for (const k of Object.keys(t) as (keyof typeof monthTotals)[]) {
        t[k] = Math.round(t[k] * 100) / 100;
      }
    };
    roundTotals(monthTotals);
    roundTotals(ytdTotals);

    return {
      period,
      hospitalName: hosp.hospitalName,
      accountFilter: filterCode,
      accountName,
      rows: monthRows,
      monthTotals,
      ytdTotals,
    };
  } finally {
    connection.release();
    if (repConn) repConn.release();
  }
};

// =========================================================================
// 3. ทะเบียนคุมบัญชี OP (ประจำเดือน/ประจำปีงบประมาณ)
// =========================================================================
export interface OpdControlForm3Row {
  hn: string;
  vn: string;
  patientName: string;
  serviceDate: string;
  debtorCode: string;
  broughtForward: number;      // ยอดยกมา
  monthlyAmount: number;       // ระหว่างเดือน
  balance1: number;            // ลูกหนี้คงเหลือ
  claimedAmount: number;       // จำนวนเงินที่เรียกเก็บ
  adjDate: string;             // วันที่ปรับปรุง
  adjRight: string;            // สิทธิรักษา
  adjDoc: string;              // เอกสารลงบัญชี
  adjAdd: number;              // เพิ่ม
  adjSub: number;              // ลด
  balance2: number;            // ลูกหนี้คงเหลือ
  stmAdjDate: string;          // วันที่ปรับปรุง STM
  stmDoc: string;              // เอกสารลงบัญชี
  stmRound: string;            // งวด STM
  stmReqNo: string;            // เลขที่คำขอเบิก
  stmCompensation: number;     // เงินชดเชย
  stmVariance: number;         // ผลต่าง
  stmUnclaimable: number;      // ส่วนที่เรียกไม่ได้
  balance3: number;            // ลูกหนี้คงเหลือ
  settleDate: string;          // วันที่โอน
  settleDoc: string;           // เอกสารลงบัญชี
  settleReceiptNo: string;     // เลขที่ใบเสร็จ
  settleReqNo: string;         // เลขที่คำขอเบิก
  settleDebtCut: number;       // ตัดลูกหนี้
  balance4: number;            // ลูกหนี้คงเหลือ
  carriedForward: number;      // พันยอดลูกหนี้
  outstandingReason: string;   // สาเหตุค้างชำระ
}

export interface OpdControlForm3Result {
  period: FiscalPeriodInfo;
  hospitalName: string;
  accountFilter: string;
  accountName: string;
  rows: OpdControlForm3Row[];
  monthTotals: Record<string, number>;
  ytdTotals: Record<string, number>;
}

export const getOfficialOpdControlRegister = async (
  monthInput?: unknown,
  yearBeInput?: unknown,
  accountCodeFilter?: string
): Promise<OpdControlForm3Result> => {
  const period = calculateFiscalPeriod(monthInput, yearBeInput);
  const hosp = await getHospitalInfo();
  const filterCode = accountCodeFilter ? normalizeAccountCode(accountCodeFilter) : 'ALL';
  const targetMeta = OFFICIAL_CHART_OF_ACCOUNTS_54.find(a => a.code === filterCode);
  const accountName = targetMeta ? targetMeta.name : (filterCode === 'ALL' ? 'ทุกประเภทผังบัญชี (OPD)' : filterCode);

  const connection = await getUTFConnection();
  let repConn: any = null;
  try {
    repConn = await getRepstmConnection();
  } catch {
    repConn = null;
  }

  try {
    const [opdData] = await connection.query(
      `SELECT
         o.hn,
         o.vn,
         CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
         DATE_FORMAT(o.vstdate, '%d/%m/%Y') AS service_date_fmt,
         o.vstdate AS service_date_raw,
         COALESCE(ptt.name, o.pttype) AS pttype_name,
         o.pttype,
         COALESCE(v.income, 0) AS monthly_income,
         COALESCE(v.rcpt_money, 0) AS paid_money,
         COALESCE(v.rcp_no, '') AS rcp_no
       FROM ovst o
       JOIN vn_stat v ON v.vn = o.vn
       LEFT JOIN patient pt ON pt.hn = o.hn
       LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
       WHERE o.vstdate BETWEEN ? AND ?
         AND COALESCE(v.income, 0) > 0
       ORDER BY o.vstdate, o.vn`,
      [period.fyStartDate, period.endDate]
    );

    const opdList = (Array.isArray(opdData) ? opdData : []) as Record<string, unknown>[];
    const vns = opdList.map(r => String(r.vn || '')).filter(Boolean);

    const { fdhMap, repMap, stmMap } = await fetchReconciliationMaps(connection, repConn, vns, []);

    const monthStartObj = new Date(period.startDate);
    const monthEndObj = new Date(period.endDate);

    const rows: OpdControlForm3Row[] = [];
    const keys = [
      'broughtForward', 'monthlyAmount', 'balance1', 'claimedAmount',
      'adjAdd', 'adjSub', 'balance2', 'stmCompensation', 'stmVariance',
      'stmUnclaimable', 'balance3', 'settleDebtCut', 'balance4', 'carriedForward'
    ];
    const monthTotals: Record<string, number> = Object.fromEntries(keys.map(k => [k, 0]));
    const ytdTotals: Record<string, number> = Object.fromEntries(keys.map(k => [k, 0]));

    for (const r of opdList) {
      const pttype = String(r.pttype || '').trim();
      const debtorCode = resolveDebtorCode(pttype, false);
      if (filterCode !== 'ALL' && debtorCode !== filterCode) {
        continue;
      }

      const income = Number(r.monthly_income || 0);
      const paid = Number(r.paid_money || 0);
      const vn = String(r.vn || '');
      const fdh = fdhMap.get(vn);
      const rep = repMap.get(vn);
      const stm = stmMap.get(vn);

      const broughtForward = 0; // Inside current FY, new encounters start from 0 brought forward
      const monthlyAmount = income;
      const balance1 = broughtForward + monthlyAmount;
      const claimedAmount = monthlyAmount;
      const adjAdd = 0;
      const adjSub = 0;
      const balance2 = balance1 + adjAdd - adjSub;
      const stmCompensation = stm ? Number(stm.paidAmount || 0) : 0;
      const stmVariance = Math.max(0, Math.round((claimedAmount - stmCompensation) * 100) / 100);
      const stmUnclaimable = 0;
      const balance3 = Math.max(0, Math.round((balance2 - stmCompensation) * 100) / 100);
      const settleDebtCut = paid;
      const balance4 = Math.max(0, Math.round((balance3 - settleDebtCut) * 100) / 100);
      const carriedForward = balance4;

      const itemValues: Record<string, number> = {
        broughtForward, monthlyAmount, balance1, claimedAmount,
        adjAdd, adjSub, balance2, stmCompensation, stmVariance,
        stmUnclaimable, balance3, settleDebtCut, balance4, carriedForward
      };

      // YTD totals
      for (const k of keys) {
        ytdTotals[k] += itemValues[k] || 0;
      }

      const sDateRaw = new Date(String(r.service_date_raw || ''));
      if (sDateRaw >= monthStartObj && sDateRaw <= monthEndObj) {
        for (const k of keys) {
          monthTotals[k] += itemValues[k] || 0;
        }

        const roundParts: string[] = [];
        if (stm?.statementNo) roundParts.push(`STM:${stm.statementNo}`);
        if (rep?.repNo) roundParts.push(`REP:${rep.repNo}`);
        if (roundParts.length === 0) {
          if (fdh?.stmPeriod) roundParts.push(`FDH:${fdh.stmPeriod}`);
          else if (fdh?.statusMessage) roundParts.push(`FDH:${fdh.statusMessage}`);
        }
        const stmRound = roundParts.join(' | ');
        const stmReqNo = stm?.tranId || rep?.tranId || (fdh?.txId ? fdh.txId.slice(0, 18) : '');
        const outstandingReason = formatReconciledReason(fdh, rep, stm, carriedForward, claimedAmount);

        rows.push({
          hn: String(r.hn || ''),
          vn,
          patientName: String(r.patient_name || ''),
          serviceDate: String(r.service_date_fmt || ''),
          debtorCode,
          broughtForward,
          monthlyAmount,
          balance1,
          claimedAmount,
          adjDate: '',
          adjRight: String(r.pttype_name || ''),
          adjDoc: '',
          adjAdd,
          adjSub,
          balance2,
          stmAdjDate: '',
          stmDoc: '',
          stmRound,
          stmReqNo,
          stmCompensation,
          stmVariance,
          stmUnclaimable,
          balance3,
          settleDate: '',
          settleDoc: '',
          settleReceiptNo: String(r.rcp_no || ''),
          settleReqNo: '',
          settleDebtCut,
          balance4,
          carriedForward,
          outstandingReason,
        });
      }
    }

    for (const k of keys) {
      monthTotals[k] = Math.round(monthTotals[k] * 100) / 100;
      ytdTotals[k] = Math.round(ytdTotals[k] * 100) / 100;
    }

    return {
      period,
      hospitalName: hosp.hospitalName,
      accountFilter: filterCode,
      accountName,
      rows,
      monthTotals,
      ytdTotals,
    };
  } finally {
    connection.release();
    if (repConn) repConn.release();
  }
};

// =========================================================================
// 4. ทะเบียนคุมบัญชี IP (ประจำเดือน/ประจำปีงบประมาณ)
// =========================================================================
export interface IpdControlForm4Row {
  hn: string;
  an: string;
  patientName: string;
  serviceDate: string;
  dischargeDate: string;
  debtorCode: string;
  broughtForward: number;      // ยอดยกมา
  monthlyAmount: number;       // ระหว่างเดือน
  balance1: number;            // ลูกหนี้คงเหลือ
  claimedAmount: number;       // จำนวนเงินที่เรียกเก็บ
  adjDate: string;
  adjRight: string;
  adjDoc: string;
  adjAdd: number;
  adjSub: number;
  balance2: number;
  stmAdjDate: string;
  stmDoc: string;
  stmRound: string;
  stmReqNo: string;
  stmCompensation: number;
  varianceHigh: number;        // ส่วนต่างสูงกว่าฯ
  varianceLow: number;         // ส่วนต่างต่ำกว่าฯ
  balance3: number;
  settleDate: string;
  settleDoc: string;
  settleReceiptNo: string;
  settleReqNo: string;
  settleDebtCut: number;
  accruedRevenue: number;      // รายได้ค้างรับ
  balance4: number;
  carriedForward: number;      // พันยอดลูกหนี้
  outstandingReason: string;   // สาเหตุค้างชำระ
}

export interface IpdControlForm4Result {
  period: FiscalPeriodInfo;
  hospitalName: string;
  accountFilter: string;
  accountName: string;
  rows: IpdControlForm4Row[];
  monthTotals: Record<string, number>;
  ytdTotals: Record<string, number>;
}

export const getOfficialIpdControlRegister = async (
  monthInput?: unknown,
  yearBeInput?: unknown,
  accountCodeFilter?: string
): Promise<IpdControlForm4Result> => {
  const period = calculateFiscalPeriod(monthInput, yearBeInput);
  const hosp = await getHospitalInfo();
  const filterCode = accountCodeFilter ? normalizeAccountCode(accountCodeFilter) : 'ALL';
  const targetMeta = OFFICIAL_CHART_OF_ACCOUNTS_54.find(a => a.code === filterCode);
  const accountName = targetMeta ? targetMeta.name : (filterCode === 'ALL' ? 'ทุกประเภทผังบัญชี (IPD)' : filterCode);

  const connection = await getUTFConnection();
  let repConn: any = null;
  try {
    repConn = await getRepstmConnection();
  } catch {
    repConn = null;
  }

  try {
    const [ipdData] = await connection.query(
      `SELECT
         i.hn,
         i.an,
         COALESCE(i.vn, '') AS vn,
         CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
         DATE_FORMAT(i.regdate, '%d/%m/%Y') AS admit_date_fmt,
         DATE_FORMAT(COALESCE(i.dchdate, i.regdate), '%d/%m/%Y') AS dch_date_fmt,
         COALESCE(i.dchdate, i.regdate) AS dch_date_raw,
         COALESCE(ptt.name, i.pttype) AS pttype_name,
         i.pttype,
         COALESCE(a.income, 0) AS monthly_income,
         COALESCE(a.rcpt_money, 0) AS paid_money,
         COALESCE(a.rcpno_list, '') AS rcp_no
       FROM ipt i
       JOIN an_stat a ON a.an = i.an
       LEFT JOIN patient pt ON pt.hn = i.hn
       LEFT JOIN pttype ptt ON ptt.pttype = i.pttype
       WHERE COALESCE(i.dchdate, i.regdate) BETWEEN ? AND ?
         AND COALESCE(a.income, 0) > 0
       ORDER BY COALESCE(i.dchdate, i.regdate), i.an`,
      [period.fyStartDate, period.endDate]
    );

    const ipdList = (Array.isArray(ipdData) ? ipdData : []) as Record<string, unknown>[];
    const ans = ipdList.map(r => String(r.an || '')).filter(Boolean);
    const vns = ipdList.map(r => String(r.vn || '')).filter(Boolean);

    const { fdhMap, repMap, stmMap } = await fetchReconciliationMaps(connection, repConn, vns, ans);

    const monthStartObj = new Date(period.startDate);
    const monthEndObj = new Date(period.endDate);

    const rows: IpdControlForm4Row[] = [];
    const keys = [
      'broughtForward', 'monthlyAmount', 'balance1', 'claimedAmount',
      'adjAdd', 'adjSub', 'balance2', 'stmCompensation', 'varianceHigh',
      'varianceLow', 'balance3', 'settleDebtCut', 'accruedRevenue', 'balance4', 'carriedForward'
    ];
    const monthTotals: Record<string, number> = Object.fromEntries(keys.map(k => [k, 0]));
    const ytdTotals: Record<string, number> = Object.fromEntries(keys.map(k => [k, 0]));

    for (const r of ipdList) {
      const pttype = String(r.pttype || '').trim();
      const debtorCode = resolveDebtorCode(pttype, true);
      if (filterCode !== 'ALL' && debtorCode !== filterCode) {
        continue;
      }

      const income = Number(r.monthly_income || 0);
      const paid = Number(r.paid_money || 0);
      const an = String(r.an || '');
      const vn = String(r.vn || '');
      const fdh = vn ? fdhMap.get(vn) : undefined;
      const rep = repMap.get(an) || (vn ? repMap.get(vn) : undefined);
      const stm = stmMap.get(an) || (vn ? stmMap.get(vn) : undefined);

      const broughtForward = 0;
      const monthlyAmount = income;
      const balance1 = broughtForward + monthlyAmount;
      const claimedAmount = monthlyAmount;
      const adjAdd = 0;
      const adjSub = 0;
      const balance2 = balance1 + adjAdd - adjSub;
      const stmCompensation = stm ? Number(stm.paidAmount || 0) : 0;
      const diff = stmCompensation - claimedAmount;
      const varianceHigh = diff > 0 ? diff : 0;
      const varianceLow = diff < 0 ? Math.abs(diff) : 0;
      const balance3 = Math.max(0, Math.round((balance2 - stmCompensation) * 100) / 100);
      const settleDebtCut = paid;
      const accruedRevenue = 0;
      const balance4 = Math.max(0, Math.round((balance3 - settleDebtCut - accruedRevenue) * 100) / 100);
      const carriedForward = balance4;

      const itemValues: Record<string, number> = {
        broughtForward, monthlyAmount, balance1, claimedAmount,
        adjAdd, adjSub, balance2, stmCompensation, varianceHigh,
        varianceLow, balance3, settleDebtCut, accruedRevenue, balance4, carriedForward
      };

      for (const k of keys) {
        ytdTotals[k] += itemValues[k] || 0;
      }

      const dDateRaw = new Date(String(r.dch_date_raw || ''));
      if (dDateRaw >= monthStartObj && dDateRaw <= monthEndObj) {
        for (const k of keys) {
          monthTotals[k] += itemValues[k] || 0;
        }

        const roundParts: string[] = [];
        if (stm?.statementNo) roundParts.push(`STM:${stm.statementNo}`);
        if (rep?.repNo) roundParts.push(`REP:${rep.repNo}`);
        if (roundParts.length === 0) {
          if (fdh?.stmPeriod) roundParts.push(`FDH:${fdh.stmPeriod}`);
          else if (fdh?.statusMessage) roundParts.push(`FDH:${fdh.statusMessage}`);
        }
        const stmRound = roundParts.join(' | ');
        const stmReqNo = stm?.tranId || rep?.tranId || (fdh?.txId ? fdh.txId.slice(0, 18) : '');
        const outstandingReason = formatReconciledReason(fdh, rep, stm, carriedForward, claimedAmount);

        rows.push({
          hn: String(r.hn || ''),
          an,
          patientName: String(r.patient_name || ''),
          serviceDate: String(r.admit_date_fmt || ''),
          dischargeDate: String(r.dch_date_fmt || ''),
          debtorCode,
          broughtForward,
          monthlyAmount,
          balance1,
          claimedAmount,
          adjDate: '',
          adjRight: String(r.pttype_name || ''),
          adjDoc: '',
          adjAdd,
          adjSub,
          balance2,
          stmAdjDate: '',
          stmDoc: '',
          stmRound,
          stmReqNo,
          stmCompensation,
          varianceHigh,
          varianceLow,
          balance3,
          settleDate: '',
          settleDoc: '',
          settleReceiptNo: String(r.rcp_no || ''),
          settleReqNo: '',
          settleDebtCut,
          accruedRevenue,
          balance4,
          carriedForward,
          outstandingReason,
        });
      }
    }

    for (const k of keys) {
      monthTotals[k] = Math.round(monthTotals[k] * 100) / 100;
      ytdTotals[k] = Math.round(ytdTotals[k] * 100) / 100;
    }

    return {
      period,
      hospitalName: hosp.hospitalName,
      accountFilter: filterCode,
      accountName,
      rows,
      monthTotals,
      ytdTotals,
    };
  } finally {
    connection.release();
    if (repConn) repConn.release();
  }
};

// =========================================================================
// 5. Excel Workbook Generator (Exact match with user's uploaded template)
// =========================================================================
export const buildOfficialExcelWorkbook = (
  f1: AgingForm1Result,
  f2: ClaimControlForm2Result,
  f3: OpdControlForm3Result,
  f4: IpdControlForm4Result
): XLSX.WorkBook => {
  const wb = XLSX.utils.book_new();

  // -------------------------------------------------------------
  // Sheet 1: สรุปลูกหนี้คงเหลือ แยกตามอายุ
  // -------------------------------------------------------------
  const ws1Data: unknown[][] = [
    [`รายงานลูกหนี้ค่ารักษาพยาบาลคงเหลือ (แยกตามอายุ)  ประจำเดือน ${f1.period.monthName} ${f1.period.yearBE}    (จากทะเบียนคุมของงานประกัน)`],
    [`โรงพยาบาล ${f1.hospitalName}`],
    ['รหัสผังบัญชี', 'ลำดับ', 'ชื่อผังบัญชี', 'คงเหลือลูกหนี้', null, 'จำแนกตามอายุ (ระบุมูลค่า)'],
    [null, null, null, 'จำนวนราย', 'มูลค่าลูกหนี้', 'ไม่เกิน 30 วัน (บาท)', 'เกิน 30 วัน (บาท)'],
  ];

  f1.items.forEach(item => {
    ws1Data.push([
      item.code,
      item.order,
      item.name,
      item.caseCount,
      item.totalValue,
      item.le30Days,
      item.gt30Days,
    ]);
  });

  ws1Data.push([
    null,
    null,
    'ยอดรวมเงิน',
    f1.totals.caseCount,
    f1.totals.totalValue,
    f1.totals.le30Days,
    f1.totals.gt30Days,
  ]);

  const ws1 = XLSX.utils.aoa_to_sheet(ws1Data);
  XLSX.utils.book_append_sheet(wb, ws1, 'สรุปลูกหนี้คงเหลือ แยกตามอายุ');

  // -------------------------------------------------------------
  // Sheet 2: ทะเบียนคุมงานเรียกเก็บ
  // -------------------------------------------------------------
  const ws2Data: unknown[][] = [
    [`ลูกหนี้ค่ารักษาพยาบาลประเภท ${f2.accountName}   (ตัวอย่างจากทะเบียนคุมงานประกัน)`],
    [null, 'ข้อมูลลูกหนี้ตาม hosXP', null, null, null, null, null, null, null, null, 'รายละเอียดการเรียกเก็บ', null, null, null, null, 'รายละเอียดการรับเงิน', null, null, 'หมายเหตุประกอบ'],
    [
      'ที่', 'HN', 'VN', 'AN', 'CID', 'ชื่อผู้ป่วย', 'วันที่ตรวจ', 'วันที่จำหน่าย', 'ชื่อสิทธิ',
      'ค่าใช้จ่าย (บาท)', 'เรียกเก็บ  (บาท)', 'Rep/STM', 'ชดเชย  (บาท)', 'ส่วนต่าง  (บาท)', 'คงเหลือ (บาท)',
      'วันที่รับเงิน', 'จำนวนเงิน', 'คงเหลือ (บาท)', 'ไม่เกิน30วัน (มูลค่า)', 'เกิน30วัน  (มูลค่า)', 'สาเหตุค้างชำระ /สถานะการเรียกเก็บ'
    ],
  ];

  f2.rows.forEach(r => {
    ws2Data.push([
      r.no, r.hn, r.vn, r.an, r.cid, r.patientName, r.serviceDate, r.dischargeDate, r.pttypeName,
      r.costAmount, r.claimedAmount, r.repStm, r.compensatedAmount, r.varianceAmount, r.balanceAmount,
      r.paidDate, r.paidAmount, r.remainderAmount, r.le30DaysAmount, r.gt30DaysAmount, r.reason
    ]);
  });

  ws2Data.push([
    null, null, null, null, null, null, null, null, 'รวมประจำเดือน',
    f2.monthTotals.costAmount, f2.monthTotals.claimedAmount, null, f2.monthTotals.compensatedAmount,
    f2.monthTotals.varianceAmount, f2.monthTotals.balanceAmount, null, f2.monthTotals.paidAmount,
    f2.monthTotals.remainderAmount, f2.monthTotals.le30DaysAmount, f2.monthTotals.gt30DaysAmount, null
  ]);

  ws2Data.push([
    null, null, null, null, null, null, null, null, 'รวมแต่ต้นปี',
    f2.ytdTotals.costAmount, f2.ytdTotals.claimedAmount, null, f2.ytdTotals.compensatedAmount,
    f2.ytdTotals.varianceAmount, f2.ytdTotals.balanceAmount, null, f2.ytdTotals.paidAmount,
    f2.ytdTotals.remainderAmount, f2.ytdTotals.le30DaysAmount, f2.ytdTotals.gt30DaysAmount, null
  ]);

  const ws2 = XLSX.utils.aoa_to_sheet(ws2Data);
  XLSX.utils.book_append_sheet(wb, ws2, 'ทะเบียนคุมงานเรียกเก็บ');

  // -------------------------------------------------------------
  // Sheet 3: ทะเบียนคุมบัญชี OP
  // -------------------------------------------------------------
  const ws3Data: unknown[][] = [
    [`ทะเบียนคุมลูกหนี้ค่ารักษาพยาบาล ${f3.accountName}  ประจำปีงบประมาณ ${f3.period.yearBE}`],
    [`ประจำเดือน ${f3.period.monthName}`],
    [],
    [
      'รายละเอียดลูกหนี้ค่ารักษาตาม hosXP', null, null, null, null, null,
      'ลูกหนี้คงเหลือ', 'จำนวนเงินที่เรียกเก็บ',
      'รายการปรับปรุงจากการเรียกเก็บ', null, null, null, null,
      'ลูกหนี้คงเหลือ',
      'รายละเอียดแบบตอบกลับ REP/ STM ', null, null, null, null, null, null,
      'ลูกหนี้คงเหลือ',
      'รายละเอียดการรับชำระหนี้', null, null, null, null,
      'ลูกหนี้คงเหลือ', 'พันยอดลูกหนี้', 'สาเหตุค้างชำระ/ คืนข้อมูลจากเรียกเก็บ'
    ],
    [
      'HN', 'VN', 'ชื่อ- สกุล', 'วันเข้ารักษา', 'ยอดยกมา', 'ระหว่างเดือน',
      null, null,
      'วันที่ปรับปรุง', 'สิทธิรักษา', 'เอกสารลงบัญชี', 'เพิ่ม', 'ลด',
      null,
      'วันที่ปรับปรุง', 'เอกสารลงบัญชี', 'งวด STM', 'เลขที่คำขอเบิก', 'เงินชดเชย', 'ผลต่าง', 'ส่วนที่เรียกไม่ได้',
      null,
      'วันที่โอน', 'เอกสารลงบัญชี', 'เลขที่ใบเสร็จ', 'เลขที่คำขอเบิก', 'ตัดลูกหนี้',
      null, null, null
    ]
  ];

  f3.rows.forEach(r => {
    ws3Data.push([
      r.hn, r.vn, r.patientName, r.serviceDate, r.broughtForward, r.monthlyAmount,
      r.balance1, r.claimedAmount,
      r.adjDate, r.adjRight, r.adjDoc, r.adjAdd, r.adjSub,
      r.balance2,
      r.stmAdjDate, r.stmDoc, r.stmRound, r.stmReqNo, r.stmCompensation, r.stmVariance, r.stmUnclaimable,
      r.balance3,
      r.settleDate, r.settleDoc, r.settleReceiptNo, r.settleReqNo, r.settleDebtCut,
      r.balance4, r.carriedForward, r.outstandingReason
    ]);
  });

  ws3Data.push([
    null, null, 'รวมประจำเดือน', null,
    f3.monthTotals.broughtForward, f3.monthTotals.monthlyAmount, f3.monthTotals.balance1, f3.monthTotals.claimedAmount,
    null, null, null, f3.monthTotals.adjAdd, f3.monthTotals.adjSub, f3.monthTotals.balance2,
    null, null, null, null, f3.monthTotals.stmCompensation, f3.monthTotals.stmVariance, f3.monthTotals.stmUnclaimable, f3.monthTotals.balance3,
    null, null, null, null, f3.monthTotals.settleDebtCut,
    f3.monthTotals.balance4, f3.monthTotals.carriedForward, null
  ]);

  ws3Data.push([
    null, null, 'รวมแต่ต้นปี', null,
    f3.ytdTotals.broughtForward, f3.ytdTotals.monthlyAmount, f3.ytdTotals.balance1, f3.ytdTotals.claimedAmount,
    null, null, null, f3.ytdTotals.adjAdd, f3.ytdTotals.adjSub, f3.ytdTotals.balance2,
    null, null, null, null, f3.ytdTotals.stmCompensation, f3.ytdTotals.stmVariance, f3.ytdTotals.stmUnclaimable, f3.ytdTotals.balance3,
    null, null, null, null, f3.ytdTotals.settleDebtCut,
    f3.ytdTotals.balance4, f3.ytdTotals.carriedForward, null
  ]);

  const ws3 = XLSX.utils.aoa_to_sheet(ws3Data);
  XLSX.utils.book_append_sheet(wb, ws3, 'ทะเบียนคุมบัญชี OP');

  // -------------------------------------------------------------
  // Sheet 4: ทะเบียนคุมบัญชี IP
  // -------------------------------------------------------------
  const ws4Data: unknown[][] = [
    [`ทะเบียนคุมลูกหนี้ค่ารักษาพยาบาล ${f4.accountName}  ประจำปีงบประมาณ ${f4.period.yearBE}`],
    [`ประจำเดือน ${f4.period.monthName}`],
    [],
    [
      'รายละเอียดลูกหนี้ค่ารักษาตาม hosXP', null, null, null, null, null, null,
      'ลูกหนี้คงเหลือ', 'จำนวนเงินที่เรียกเก็บ',
      'รายการปรับปรุงจากการเรียกเก็บ', null, null, null, null,
      'ลูกหนี้คงเหลือ',
      'รายละเอียดแบบตอบกลับ REP/ STM ', null, null, null, null, null, null,
      'ลูกหนี้คงเหลือ',
      'รายละเอียดการรับชำระหนี้', null, null, null, null, null,
      'ลูกหนี้คงเหลือ', 'พันยอดลูกหนี้', 'สาเหตุค้างชำระ/ คืนข้อมูลจากเรียกเก็บ'
    ],
    [
      'HN', 'AN', 'ชื่อ- สกุล', 'วันเข้ารักษา', 'วันจำหน่าย', 'ยอดยกมา', 'ระหว่างเดือน',
      null, null,
      'วันที่ปรับปรุง', 'สิทธิรักษา', 'เอกสารลงบัญชี', 'เพิ่ม', 'ลด',
      null,
      'วันที่ปรับปรุง', 'เอกสารลงบัญชี', 'งวด STM', 'เลขที่คำขอเบิก', 'เงินชดเชย', 'ส่วนต่างสูงกว่าฯ', 'ส่วนต่างต่ำกว่าฯ',
      null,
      'วันที่โอน', 'เอกสารลงบัญชี', 'เลขที่ใบเสร็จ', 'เลขที่คำขอเบิก', 'ตัดลูกหนี้', 'รายได้ค้างรับ',
      null, null, null
    ]
  ];

  f4.rows.forEach(r => {
    ws4Data.push([
      r.hn, r.an, r.patientName, r.serviceDate, r.dischargeDate, r.broughtForward, r.monthlyAmount,
      r.balance1, r.claimedAmount,
      r.adjDate, r.adjRight, r.adjDoc, r.adjAdd, r.adjSub,
      r.balance2,
      r.stmAdjDate, r.stmDoc, r.stmRound, r.stmReqNo, r.stmCompensation, r.varianceHigh, r.varianceLow,
      r.balance3,
      r.settleDate, r.settleDoc, r.settleReceiptNo, r.settleReqNo, r.settleDebtCut, r.accruedRevenue,
      r.balance4, r.carriedForward, r.outstandingReason
    ]);
  });

  ws4Data.push([
    null, null, null, 'รวมประจำเดือน', null,
    f4.monthTotals.broughtForward, f4.monthTotals.monthlyAmount, f4.monthTotals.balance1, f4.monthTotals.claimedAmount,
    null, null, null, f4.monthTotals.adjAdd, f4.monthTotals.adjSub, f4.monthTotals.balance2,
    null, null, null, null, f4.monthTotals.stmCompensation, f4.monthTotals.varianceHigh, f4.monthTotals.varianceLow, f4.monthTotals.balance3,
    null, null, null, null, f4.monthTotals.settleDebtCut, f4.monthTotals.accruedRevenue,
    f4.monthTotals.balance4, f4.monthTotals.carriedForward, null
  ]);

  ws4Data.push([
    null, null, null, 'รวมแต่ต้นปี', null,
    f4.ytdTotals.broughtForward, f4.ytdTotals.monthlyAmount, f4.ytdTotals.balance1, f4.ytdTotals.claimedAmount,
    null, null, null, f4.ytdTotals.adjAdd, f4.ytdTotals.adjSub, f4.ytdTotals.balance2,
    null, null, null, null, f4.ytdTotals.stmCompensation, f4.ytdTotals.varianceHigh, f4.ytdTotals.varianceLow, f4.ytdTotals.balance3,
    null, null, null, null, f4.ytdTotals.settleDebtCut, f4.ytdTotals.accruedRevenue,
    f4.ytdTotals.balance4, f4.ytdTotals.carriedForward, null
  ]);

  const ws4 = XLSX.utils.aoa_to_sheet(ws4Data);
  XLSX.utils.book_append_sheet(wb, ws4, 'ทะเบียนคุมบัญชี IP');

  return wb;
};
