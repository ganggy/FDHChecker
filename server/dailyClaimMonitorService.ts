import { ensureNhsoClosePrivilegeTable, getRepstmConnection, getUTFConnection } from './db.js';

export type MonitorClaimStage =
  | 'incomplete'
  | 'pending_close'
  | 'ready'
  | 'sent'
  | 'rep_passed'
  | 'rep_rejected'
  | 'cash_or_other';

export interface DailyClaimMonitorEncounter {
  patientType: 'OPD' | 'IPD';
  vn: string;
  an: string;
  hn: string;
  patientName: string;
  cid: string;
  serviceDate: string;
  serviceTime: string;
  pttype: string;
  pttypeName: string;
  hipdataCode: string;
  fundGroup: 'UCS' | 'OFC' | 'SSS' | 'LGO' | 'OTHER';
  fundLabel: string;
  departmentCode: string;
  departmentName: string;
  income: number;
  paidMoney: number;
  claimableAmount: number;
  diagCount: number;
  mainDiagCount: number;
  chargeCount: number;
  hasCloseCode: boolean;
  closeStatus: string;
  fdhStatus: string;
  fdhMessage: string;
  repStatus: string;
  repPaidAmount: number;
  stage: MonitorClaimStage;
  stageLabel: string;
  issues: string[];
}

export interface DailyClaimFundSummary {
  fundGroup: string;
  fundLabel: string;
  totalCount: number;
  totalIncome: number;
  incompleteCount: number;
  pendingCloseCount: number;
  readyCount: number;
  sentCount: number;
  repPassedCount: number;
  repRejectedCount: number;
  repPaidAmount: number;
}

export interface DailyClaimDepartmentSummary {
  departmentCode: string;
  departmentName: string;
  totalCount: number;
  totalIncome: number;
  incompleteCount: number;
  pendingCloseCount: number;
  readyCount: number;
  sentOrPassedCount: number;
}

export interface DailyClaimTrendRow {
  date: string;
  totalCount: number;
  opdCount: number;
  ipdCount: number;
  totalIncome: number;
  closedCount: number;
  readyCount: number;
  sentOrPassedCount: number;
  incompleteCount: number;
  repPaidAmount: number;
}

export interface DailyClaimMonitorSummary {
  totalCount: number;
  opdCount: number;
  ipdCount: number;
  totalIncome: number;
  totalClaimable: number;
  totalRepPaid: number;
  closedCount: number;
  pendingCloseCount: number;
  incompleteCount: number;
  readyCount: number;
  sentCount: number;
  repPassedCount: number;
  repRejectedCount: number;
  cashOrOtherCount: number;
  closeRatePct: number;
}

export interface DailyClaimMonitorResponse {
  period: { startDate: string; endDate: string };
  generatedAt: string;
  summary: DailyClaimMonitorSummary;
  fundBreakdown: DailyClaimFundSummary[];
  departmentBreakdown: DailyClaimDepartmentSummary[];
  dailyTrend: DailyClaimTrendRow[];
  encounters: DailyClaimMonitorEncounter[];
}

const num = (v: unknown) => Number(v || 0) || 0;
const text = (v: unknown) => String(v ?? '').trim();
const yes = (v: unknown) => num(v) === 1 || String(v).toUpperCase() === 'Y';

export function classifyFundGroup(hipdataCode: string, pttypeName: string): {
  fundGroup: 'UCS' | 'OFC' | 'SSS' | 'LGO' | 'OTHER';
  fundLabel: string;
} {
  const hip = hipdataCode.toUpperCase();
  const name = pttypeName;
  if (hip === 'UCS' || hip === 'WEL' || hip === 'UC' || name.includes('บัตรทอง') || name.includes('UC')) {
    return { fundGroup: 'UCS', fundLabel: 'บัตรทอง (UCS)' };
  }
  if (hip === 'OFC' || hip === 'OF' || name.includes('ข้าราชการ') || name.includes('เบิกตรง')) {
    return { fundGroup: 'OFC', fundLabel: 'ข้าราชการ (OFC)' };
  }
  if (hip === 'SSS' || hip === 'SSI' || hip === 'SS' || name.includes('ประกันสังคม')) {
    return { fundGroup: 'SSS', fundLabel: 'ประกันสังคม (SSS)' };
  }
  if (hip === 'LGO' || hip === 'LG' || name.includes('อปท') || name.includes('ท้องถิ่น')) {
    return { fundGroup: 'LGO', fundLabel: 'อปท. (LGO)' };
  }
  return { fundGroup: 'OTHER', fundLabel: 'ชำระเงิน / อื่นๆ' };
}

export function determineMonitorStage(params: {
  fundGroup: string;
  patientType: 'OPD' | 'IPD';
  income: number;
  cid: string;
  diagCount: number;
  mainDiagCount: number;
  chargeCount: number;
  hasCloseCode: boolean;
  closeStatus: string;
  fdhStatus: string;
  repStatus: string;
}): { stage: MonitorClaimStage; stageLabel: string; issues: string[] } {
  const issues: string[] = [];

  if (params.fundGroup === 'OTHER' && params.income <= 0) {
    return { stage: 'cash_or_other', stageLabel: 'ไม่เข้าเงื่อนไขเคลม', issues: [] };
  }

  if (!/^\d{13}$/.test(params.cid)) issues.push('ไม่มีเลขบัตรประชาชน 13 หลัก');
  if (params.diagCount === 0) issues.push('ยังไม่ลง DIAG');
  else if (params.mainDiagCount === 0) issues.push('ไม่มี DIAG หลัก');
  if (params.chargeCount === 0) issues.push('ไม่มีรายการค่าใช้จ่าย');
  else if (params.income <= 0) issues.push('ยอดค่าใช้จ่ายเป็น 0');
  if (params.closeStatus === 'E') issues.push('ปิดสิทธิ์ NHSO ไม่สำเร็จ (Error)');

  // Check REP outcome first (historical reconciliation)
  const repUpper = params.repStatus.toUpperCase();
  if (repUpper === 'REJECT' || repUpper === 'DENY' || repUpper === 'C') {
    issues.push('ติด C / ปฏิเสธจ่ายใน REP');
    return { stage: 'rep_rejected', stageLabel: 'ติด C / ปฏิเสธจ่าย', issues };
  }
  if (repUpper === 'PASS' || repUpper === 'PAID' || repUpper === 'A') {
    return { stage: 'rep_passed', stageLabel: 'ผ่าน REP / ชดเชยแล้ว', issues };
  }

  // Check FDH submission status
  const fdhUpper = params.fdhStatus.toUpperCase();
  if (
    fdhUpper.includes('REJECT') ||
    fdhUpper.includes('DENY') ||
    fdhUpper.includes('FAIL') ||
    fdhUpper.includes('ERROR')
  ) {
    issues.push(`FDH แจ้งไม่ผ่าน: ${params.fdhStatus}`);
    return { stage: 'rep_rejected', stageLabel: 'ส่งไม่ผ่าน / รอแก้ไข', issues };
  }
  if (
    fdhUpper === 'SENT' ||
    fdhUpper.includes('APPROVE') ||
    fdhUpper.includes('PROCESS') ||
    fdhUpper.includes('ACCEPT') ||
    fdhUpper.includes('WAIT') ||
    fdhUpper === 'Y' ||
    fdhUpper === 'SUCCESS'
  ) {
    return { stage: 'sent', stageLabel: 'ส่งเคลมแล้ว (FDH)', issues };
  }

  if (params.fundGroup === 'OTHER') {
    return { stage: 'cash_or_other', stageLabel: 'ชำระเงิน / สิทธิอื่น', issues };
  }

  // Clinical / Billing completeness errors
  if (issues.length > 0) {
    return { stage: 'incomplete', stageLabel: 'ข้อมูลไม่ครบ / ติด Error', issues };
  }

  // OPD UCS/OFC/LGO requires close right EP code (SSS does not require NHSO close right)
  if (params.patientType === 'OPD' && params.fundGroup !== 'SSS' && !params.hasCloseCode) {
    return { stage: 'pending_close', stageLabel: 'รอปิดสิทธิ์ NHSO', issues: ['ยังไม่มีรหัสปิดสิทธิ์ (EP)'] };
  }

  return { stage: 'ready', stageLabel: 'พร้อมส่งเคลม', issues: [] };
}

export async function getDailyClaimMonitor(options: {
  startDate: string;
  endDate: string;
  fund?: string;
  patientType?: string;
}): Promise<DailyClaimMonitorResponse> {
  await ensureNhsoClosePrivilegeTable();
  const { startDate, endDate } = options;
  const fundFilter = (options.fund || 'ALL').toUpperCase();
  const typeFilter = (options.patientType || 'ALL').toUpperCase();

  const hosConn = await getUTFConnection();
  const repConn = await getRepstmConnection();

  try {
    // 1. Query OPD visits
    let opdRows: Record<string, unknown>[] = [];
    if (typeFilter === 'ALL' || typeFilter === 'OPD') {
      const [rows] = await hosConn.query(
        `SELECT
           'OPD' AS patient_type,
           o.vn,
           '' AS an,
           o.hn,
           CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
           COALESCE(NULLIF(pt.cid, ''), '') AS cid,
           DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
           TIME_FORMAT(o.vsttime, '%H:%i:%s') AS service_time,
           IFNULL(o.pttype, '') AS pttype,
           IFNULL(ptt.name, '') AS pttype_name,
           IFNULL(ptt.hipdata_code, '') AS hipdata_code,
           COALESCE(o.main_dep, '') AS department_code,
           COALESCE(k.department, '') AS department_name,
           COALESCE(v.income, 0) AS income,
           COALESCE(v.rcpt_money, 0) AS paid_money,
           (SELECT COUNT(*) FROM ovstdiag od WHERE od.vn = o.vn) AS diag_count,
           (SELECT COUNT(*) FROM ovstdiag od WHERE od.vn = o.vn AND od.diagtype = '1') AS main_diag_count,
           (SELECT COUNT(*) FROM opitemrece oi WHERE oi.vn = o.vn) AS charge_count,
           CASE WHEN EXISTS (
             SELECT 1 FROM nhso_confirm_privilege ncp WHERE ncp.vn = o.vn AND ncp.nhso_status = 'Y' AND ncp.nhso_authen_code REGEXP '^EP'
           ) OR EXISTS (
             SELECT 1 FROM authenhos ah WHERE ah.vn = o.vn AND ah.claim_code REGEXP '^EP'
           ) OR EXISTS (
             SELECT 1 FROM visit_pttype vp WHERE vp.vn = o.vn AND vp.auth_code REGEXP '^EP'
           ) THEN 1 ELSE 0 END AS has_close_code,
           COALESCE((
             SELECT ncp.nhso_status
             FROM nhso_confirm_privilege ncp
             WHERE ncp.vn = o.vn
             ORDER BY ncp.nhso_confirm_privilege_id DESC
             LIMIT 1
           ), '') AS close_status,
           COALESCE((
             SELECT fcs.fdh_claim_status_response
             FROM fdh_claim_status fcs
             WHERE fcs.vn = o.vn
             ORDER BY fcs.fdh_claim_status_id DESC
             LIMIT 1
           ), '') AS hos_fdh_status,
           COALESCE((
             SELECT fcs.fdh_claim_status_message
             FROM fdh_claim_status fcs
             WHERE fcs.vn = o.vn
             ORDER BY fcs.fdh_claim_status_id DESC
             LIMIT 1
           ), '') AS hos_fdh_message
         FROM ovst o
         LEFT JOIN patient pt ON pt.hn = o.hn
         LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
         LEFT JOIN kskdepartment k ON k.depcode = o.main_dep
         LEFT JOIN vn_stat v ON v.vn = o.vn
         WHERE o.vstdate BETWEEN ? AND ?
           AND IFNULL(o.an, '') = ''
         ORDER BY o.vstdate DESC, o.vsttime DESC`,
        [startDate, endDate]
      );
      opdRows = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
    }

    // 2. Query IPD discharges (by dchdate) or active admissions if within range
    let ipdRows: Record<string, unknown>[] = [];
    if (typeFilter === 'ALL' || typeFilter === 'IPD') {
      const [rows] = await hosConn.query(
        `SELECT
           'IPD' AS patient_type,
           COALESCE(i.vn, '') AS vn,
           i.an,
           i.hn,
           CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
           COALESCE(NULLIF(pt.cid, ''), '') AS cid,
           DATE_FORMAT(COALESCE(i.dchdate, i.regdate), '%Y-%m-%d') AS service_date,
           TIME_FORMAT(COALESCE(i.dchtime, i.regtime), '%H:%i:%s') AS service_time,
           IFNULL(i.pttype, '') AS pttype,
           IFNULL(ptt.name, '') AS pttype_name,
           IFNULL(ptt.hipdata_code, '') AS hipdata_code,
           COALESCE(i.ward, '') AS department_code,
           COALESCE(w.name, 'ผู้ป่วยใน (IPD)') AS department_name,
           COALESCE(a.income, 0) AS income,
           COALESCE(a.rcpt_money, 0) AS paid_money,
           (SELECT COUNT(*) FROM iptdiag idg WHERE idg.an = i.an) AS diag_count,
           (SELECT COUNT(*) FROM iptdiag idg WHERE idg.an = i.an AND idg.diagtype = '1') AS main_diag_count,
           (SELECT COUNT(*) FROM opitemrece oi WHERE oi.an = i.an) AS charge_count,
           1 AS has_close_code,
           'Y' AS close_status,
           '' AS hos_fdh_status,
           '' AS hos_fdh_message
         FROM ipt i
         LEFT JOIN patient pt ON pt.hn = i.hn
         LEFT JOIN pttype ptt ON ptt.pttype = i.pttype
         LEFT JOIN ward w ON w.ward = i.ward
         LEFT JOIN an_stat a ON a.an = i.an
         WHERE (i.dchdate BETWEEN ? AND ?) OR (i.dchdate IS NULL AND i.regdate BETWEEN ? AND ?)
         ORDER BY COALESCE(i.dchdate, i.regdate) DESC, i.an DESC`,
        [startDate, endDate, startDate, endDate]
      );
      ipdRows = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
    }

    const allHosRows = [...opdRows, ...ipdRows];

    // 3. Collect VN & AN lists to look up FDH Claim Detail & REP/STM status in repstminv
    const vnList = allHosRows.map((r) => text(r.vn)).filter(Boolean);
    const anList = allHosRows.map((r) => text(r.an)).filter(Boolean);

    const fdhDetailMap = new Map<string, { status: string; sentAt: string }>();
    const repMap = new Map<string, { status: string; paidAmount: number }>();

    if (vnList.length > 0 || anList.length > 0) {
      // Query fdh_claim_detail_row in chunks or single query
      const conds: string[] = [];
      const params: string[] = [];
      if (vnList.length > 0) {
        conds.push(`vn IN (${vnList.map(() => '?').join(',')})`);
        params.push(...vnList);
      }
      if (anList.length > 0) {
        conds.push(`an IN (${anList.map(() => '?').join(',')})`);
        params.push(...anList);
      }

      if (conds.length > 0) {
        try {
          const [fdhRows] = await repConn.query(
            `SELECT vn, an, claim_status, sent_at FROM fdh_claim_detail_row WHERE ${conds.join(' OR ')} ORDER BY id ASC`,
            params
          );
          if (Array.isArray(fdhRows)) {
            for (const fr of fdhRows as Record<string, unknown>[]) {
              const key = text(fr.an) ? `AN:${text(fr.an)}` : `VN:${text(fr.vn)}`;
              fdhDetailMap.set(key, {
                status: text(fr.claim_status),
                sentAt: text(fr.sent_at),
              });
            }
          }
        } catch {
          // Table might be empty or missing optional columns
        }

        try {
          const [repRows] = await repConn.query(
            `SELECT vn, an, data_type, amount, raw_data FROM repstm_import_row WHERE ${conds.join(' OR ')} ORDER BY id ASC`,
            params
          );
          if (Array.isArray(repRows)) {
            for (const rr of repRows as Record<string, unknown>[]) {
              const key = text(rr.an) ? `AN:${text(rr.an)}` : `VN:${text(rr.vn)}`;
              const amt = num(rr.amount);
              let rawStr = '';
              try {
                rawStr = typeof rr.raw_data === 'string' ? rr.raw_data : JSON.stringify(rr.raw_data || {});
              } catch {
                rawStr = '';
              }
              const hasErrorFlag = /"error"|ติด\s*C|ปฏิเสธ|DENY/i.test(rawStr);
              const existing = repMap.get(key) || { status: '', paidAmount: 0 };
              const nextPaid = existing.paidAmount + amt;
              const nextStatus = hasErrorFlag && nextPaid <= 0 ? 'REJECT' : nextPaid > 0 ? 'PASS' : existing.status || 'PASS';
              repMap.set(key, { status: nextStatus, paidAmount: nextPaid });
            }
          }
        } catch {
          // ignore
        }

        // Also check sss_import_row for SSS REP
        if (vnList.length > 0) {
          try {
            const [sssRows] = await repConn.query(
              `SELECT vn, status_code, paid_amount, check_code FROM sss_import_row WHERE vn IN (${vnList.map(() => '?').join(',')})`,
              vnList
            );
            if (Array.isArray(sssRows)) {
              for (const sr of sssRows as Record<string, unknown>[]) {
                const key = `VN:${text(sr.vn)}`;
                const paid = num(sr.paid_amount);
                const status = text(sr.status_code).toUpperCase();
                const hasCheckErr = text(sr.check_code) !== '' && paid <= 0;
                repMap.set(key, {
                  status: status === 'R' || status === 'C' || hasCheckErr ? 'REJECT' : 'PASS',
                  paidAmount: paid,
                });
              }
            }
          } catch {
            // ignore
          }
        }
      }
    }

    // 4. Build encounters & aggregate summaries
    const encounters: DailyClaimMonitorEncounter[] = [];

    for (const r of allHosRows) {
      const patientType = text(r.patient_type) === 'IPD' ? 'IPD' : 'OPD';
      const vn = text(r.vn);
      const an = text(r.an);
      const key = an ? `AN:${an}` : `VN:${vn}`;

      const hipdataCode = text(r.hipdata_code);
      const pttypeName = text(r.pttype_name);
      const { fundGroup, fundLabel } = classifyFundGroup(hipdataCode, pttypeName);

      if (fundFilter !== 'ALL' && fundGroup !== fundFilter) {
        continue;
      }

      const income = num(r.income);
      const paidMoney = num(r.paid_money);
      const claimableAmount = Math.max(0, income - paidMoney);
      const diagCount = num(r.diag_count);
      const mainDiagCount = num(r.main_diag_count);
      const chargeCount = num(r.charge_count);
      const hasCloseCode = yes(r.has_close_code);
      const closeStatus = text(r.close_status);
      const cid = text(r.cid);

      const fdhDetail = fdhDetailMap.get(key);
      const fdhStatus = text(r.hos_fdh_status) || fdhDetail?.status || '';
      const fdhMessage = text(r.hos_fdh_message);
      const repInfo = repMap.get(key);
      const repStatus = repInfo?.status || '';
      const repPaidAmount = repInfo?.paidAmount || 0;

      const { stage, stageLabel, issues } = determineMonitorStage({
        fundGroup,
        patientType,
        income,
        cid,
        diagCount,
        mainDiagCount,
        chargeCount,
        hasCloseCode,
        closeStatus,
        fdhStatus,
        repStatus,
      });

      encounters.push({
        patientType,
        vn,
        an,
        hn: text(r.hn),
        patientName: text(r.patient_name) || 'ไม่ระบุชื่อ',
        cid,
        serviceDate: text(r.service_date),
        serviceTime: text(r.service_time),
        pttype: text(r.pttype),
        pttypeName,
        hipdataCode,
        fundGroup,
        fundLabel,
        departmentCode: text(r.department_code),
        departmentName: text(r.department_name) || 'ไม่ระบุจุดบริการ',
        income,
        paidMoney,
        claimableAmount,
        diagCount,
        mainDiagCount,
        chargeCount,
        hasCloseCode,
        closeStatus,
        fdhStatus,
        fdhMessage,
        repStatus,
        repPaidAmount,
        stage,
        stageLabel,
        issues,
      });
    }

    // 5. Compute Summary, Fund Breakdown, Department Breakdown, and Daily Trend
    const summary: DailyClaimMonitorSummary = {
      totalCount: encounters.length,
      opdCount: 0,
      ipdCount: 0,
      totalIncome: 0,
      totalClaimable: 0,
      totalRepPaid: 0,
      closedCount: 0,
      pendingCloseCount: 0,
      incompleteCount: 0,
      readyCount: 0,
      sentCount: 0,
      repPassedCount: 0,
      repRejectedCount: 0,
      cashOrOtherCount: 0,
      closeRatePct: 0,
    };

    const fundMap = new Map<string, DailyClaimFundSummary>();
    const deptMap = new Map<string, DailyClaimDepartmentSummary>();
    const trendMap = new Map<string, DailyClaimTrendRow>();

    let opdClaimableTargetCount = 0;

    for (const enc of encounters) {
      if (enc.patientType === 'OPD') summary.opdCount++;
      else summary.ipdCount++;

      summary.totalIncome += enc.income;
      summary.totalClaimable += enc.claimableAmount;
      summary.totalRepPaid += enc.repPaidAmount;

      if (enc.patientType === 'OPD' && enc.fundGroup !== 'OTHER' && enc.fundGroup !== 'SSS') {
        opdClaimableTargetCount++;
        if (enc.hasCloseCode) summary.closedCount++;
      }

      if (enc.stage === 'incomplete') summary.incompleteCount++;
      else if (enc.stage === 'pending_close') summary.pendingCloseCount++;
      else if (enc.stage === 'ready') summary.readyCount++;
      else if (enc.stage === 'sent') summary.sentCount++;
      else if (enc.stage === 'rep_passed') summary.repPassedCount++;
      else if (enc.stage === 'rep_rejected') summary.repRejectedCount++;
      else if (enc.stage === 'cash_or_other') summary.cashOrOtherCount++;

      // Fund Breakdown
      const fEntry = fundMap.get(enc.fundGroup) || {
        fundGroup: enc.fundGroup,
        fundLabel: enc.fundLabel,
        totalCount: 0,
        totalIncome: 0,
        incompleteCount: 0,
        pendingCloseCount: 0,
        readyCount: 0,
        sentCount: 0,
        repPassedCount: 0,
        repRejectedCount: 0,
        repPaidAmount: 0,
      };
      fEntry.totalCount++;
      fEntry.totalIncome += enc.income;
      fEntry.repPaidAmount += enc.repPaidAmount;
      if (enc.stage === 'incomplete') fEntry.incompleteCount++;
      else if (enc.stage === 'pending_close') fEntry.pendingCloseCount++;
      else if (enc.stage === 'ready') fEntry.readyCount++;
      else if (enc.stage === 'sent') fEntry.sentCount++;
      else if (enc.stage === 'rep_passed') fEntry.repPassedCount++;
      else if (enc.stage === 'rep_rejected') fEntry.repRejectedCount++;
      fundMap.set(enc.fundGroup, fEntry);

      // Department Breakdown
      const deptKey = enc.departmentCode || enc.departmentName;
      const dEntry = deptMap.get(deptKey) || {
        departmentCode: enc.departmentCode,
        departmentName: enc.departmentName,
        totalCount: 0,
        totalIncome: 0,
        incompleteCount: 0,
        pendingCloseCount: 0,
        readyCount: 0,
        sentOrPassedCount: 0,
      };
      dEntry.totalCount++;
      dEntry.totalIncome += enc.income;
      if (enc.stage === 'incomplete') dEntry.incompleteCount++;
      else if (enc.stage === 'pending_close') dEntry.pendingCloseCount++;
      else if (enc.stage === 'ready') dEntry.readyCount++;
      else if (enc.stage === 'sent' || enc.stage === 'rep_passed') dEntry.sentOrPassedCount++;
      deptMap.set(deptKey, dEntry);

      // Daily Trend
      const tEntry = trendMap.get(enc.serviceDate) || {
        date: enc.serviceDate,
        totalCount: 0,
        opdCount: 0,
        ipdCount: 0,
        totalIncome: 0,
        closedCount: 0,
        readyCount: 0,
        sentOrPassedCount: 0,
        incompleteCount: 0,
        repPaidAmount: 0,
      };
      tEntry.totalCount++;
      if (enc.patientType === 'OPD') tEntry.opdCount++;
      else tEntry.ipdCount++;
      tEntry.totalIncome += enc.income;
      tEntry.repPaidAmount += enc.repPaidAmount;
      if (enc.hasCloseCode && enc.patientType === 'OPD' && enc.fundGroup !== 'OTHER' && enc.fundGroup !== 'SSS') {
        tEntry.closedCount++;
      }
      if (enc.stage === 'ready') tEntry.readyCount++;
      else if (enc.stage === 'sent' || enc.stage === 'rep_passed') tEntry.sentOrPassedCount++;
      else if (enc.stage === 'incomplete' || enc.stage === 'pending_close') tEntry.incompleteCount++;
      trendMap.set(enc.serviceDate, tEntry);
    }

    summary.closeRatePct =
      opdClaimableTargetCount > 0 ? Math.round((summary.closedCount / opdClaimableTargetCount) * 1000) / 10 : 100;

    const fundOrder = ['UCS', 'OFC', 'SSS', 'LGO', 'OTHER'];
    const fundBreakdown = Array.from(fundMap.values()).sort(
      (a, b) => fundOrder.indexOf(a.fundGroup) - fundOrder.indexOf(b.fundGroup)
    );

    const departmentBreakdown = Array.from(deptMap.values()).sort((a, b) => b.totalCount - a.totalCount);
    const dailyTrend = Array.from(trendMap.values()).sort((a, b) => b.date.localeCompare(a.date));

    return {
      period: { startDate, endDate },
      generatedAt: new Date().toISOString(),
      summary,
      fundBreakdown,
      departmentBreakdown,
      dailyTrend,
      encounters,
    };
  } finally {
    hosConn.release();
    repConn.release();
  }
}
