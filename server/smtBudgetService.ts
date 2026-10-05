import { getRepstmConnection, getUTFConnection } from './db/connection.js';
import { ensureRepstmTables } from './db/schema.js';
import { readHospitalIdentity } from './siteProfile.js';

export interface SmtTransferRow {
  id?: number;
  hcode: string;
  budget_year: string;
  run_date: string;
  posting_date: string;
  batch_no: string;
  ref_doc_no: string;
  fund_name: string;
  fund_group?: string;
  fund_descr?: string;
  efund_desc?: string;
  budget_source?: string;
  moph_id?: string;
  moph_desc?: string;
  amount: number;
  wait_amount: number;
  debt_amount: number;
  bond_amount: number;
  vat_amount: number;
  net_total: number;
  bank_name?: string;
  mou_grp_code?: string;
  efund_cd?: string;
  sfund_cd?: string;
  reconcile_status?: 'settled' | 'stm_imported' | 'unimported';
  matched_statement_file?: string | null;
}

export interface MophAccountSummary {
  moph_id: string;
  moph_desc: string;
  account_type: 'receivable_1' | 'revenue_4' | 'other';
  record_count: number;
  sum_amount: number;
  sum_wait: number;
  sum_debt: number;
  sum_vat: number;
  sum_net_total: number;
}

export interface SmtBudgetSummaryResult {
  budget_year: string;
  hcode: string;
  hospital_name: string;
  total_records: number;
  total_amount: number;
  total_wait: number;
  total_debt: number;
  total_vat: number;
  total_net: number;
  settled_count: number;
  imported_count: number;
  unimported_count: number;
  transfers: SmtTransferRow[];
  moph_accounts: MophAccountSummary[];
  unimported_alerts: Array<{
    ref_doc_no: string;
    batch_no: string;
    run_date: string;
    fund_name: string;
    moph_id: string;
    moph_desc: string;
    net_total: number;
    wait_amount: number;
    debt_amount: number;
  }>;
}

/**
 * Automatically fetch budget transfers from NHSO SMT API
 */
export async function syncSmtTransfers(customBudgetYear?: string): Promise<{
  success: boolean;
  budget_year: string;
  total_fetched: number;
  inserted_or_updated: number;
  message: string;
}> {
  await ensureRepstmTables();
  const utfConn = await getUTFConnection();
  let hcode = '11101';
  let hospitalName = '';
  try {
    const ident = await readHospitalIdentity(utfConn);
    if (ident.hospital_code) hcode = ident.hospital_code;
    hospitalName = ident.hospital_name || '';
  } catch (err) {
    console.warn('Unable to read hospital identity, fallback to 11101:', err);
  } finally {
    utfConn.release();
  }

  // Determine current Thai fiscal year if not provided
  // Oct 1st starts the next fiscal year
  const now = new Date();
  const currentBYear = customBudgetYear || String(
    now.getFullYear() + 543 + (now.getMonth() >= 9 ? 1 : 0)
  );

  const prevYear = Number(currentBYear) - 1;
  const transferStartDate = `01/10/${prevYear}`;
  const transferEndDate = `30/09/${currentBYear}`;

  // 1. Resolve Zone and Province from SMT vendor lookup
  let zoneId = '08';
  let provinceId = '4700';
  try {
    const vendorLookupRes = await fetch('https://smt.nhso.go.th/smtf/api/group-request/budgetsummary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        getOptionZone: false,
        getOptionProvince: false,
        getOptionVendorForBudgetAll: true,
        vendorForBudgetAllRequestDTO: { zoneId: null, provinceId: null, vendor: hcode },
        getFiscalYearList: false,
        getOptionNhsoBudgetType: false,
        getCountNhsoBudgetUserAll: false,
        getCountNhsoBudgetUserSysdate: false,
        getFiscalYear: false,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (vendorLookupRes.ok) {
      const vData = await vendorLookupRes.json() as any;
      const vendors = vData?.optionVendorForbudgetAll || [];
      const match = vendors.find((v: any) => String(v.vendorId || '').includes(hcode));
      if (match) {
        if (match.zoneId) zoneId = String(match.zoneId);
        if (match.provinceId) provinceId = String(match.provinceId);
      }
    }
  } catch (err) {
    console.warn('Vendor lookup in SMT error, continuing with defaults:', err);
  }

  // 2. Fetch all budget transfers from SMT
  const searchPayload = {
    vendorSearchConditionCode: '1',
    zoneId,
    provinceId,
    vendorId: `00000${hcode}`,
    vendorId5Digit: hcode,
    budgetSource: '',
    budgetYear: currentBYear,
    transferStartDate,
    transferEndDate,
    hospType: '',
    isTest: '',
  };

  const response = await fetch('https://smt.nhso.go.th/smtf/api/budgetreport/budgetSummaryByVendorReport/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(searchPayload),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`เชื่อมต่อระบบ SMT สปสช. ล้มเหลว (HTTP ${response.status})`);
  }

  const result = await response.json() as any;
  if (!result || result.status !== 'success') {
    throw new Error(result?.message || result?.description || 'ไม่สามารถดึงข้อมูลรายงานการโอนเงินจาก SMT ได้');
  }

  const rawDatas: any[] = Array.isArray(result.datas) ? result.datas : [];
  if (rawDatas.length === 0) {
    return {
      success: true,
      budget_year: currentBYear,
      total_fetched: 0,
      inserted_or_updated: 0,
      message: `ไม่พบรายการโอนเงินในระบบ SMT ปีงบประมาณ ${currentBYear}`,
    };
  }

  // 3. Batch insert / update into MySQL smt_budget_transfers
  const repConn = await getRepstmConnection();
  let affected = 0;
  try {
    for (const item of rawDatas) {
      const runDate = item.runDt || `${item.cpostingYear || '2024'}-01-01`;
      const postingDate = String(item.postingDate || '');
      const batchNo = String(item.batchNo || '');
      const refDocNo = String(item.refDocNo || '');
      const fundName = String(item.fundName || '');
      const fundGroup = String(item.fundGroup || '');
      const fundDescr = String(item.fundDescr || '');
      const efundDesc = String(item.efundDesc || '');
      const budgetSource = String(item.budgetSource || '');
      const mophId = String(item.mophId || '');
      const mophDesc = String(item.mophDesc || '');
      const amount = Number(item.amount || 0);
      const waitAmount = Number(item.wait || 0);
      const debtAmount = Number(item.debt || 0);
      const bondAmount = Number(item.bond || 0);
      const vatAmount = Number(item.vat || 0);
      const netTotal = Number(item.total || 0);
      const bankName = String(item.bankNm || '');
      const mouGrpCode = String(item.mouGrpCode || '');
      const efundCd = String(item.efundCd || '');
      const sfundCd = String(item.sfundCd || '');

      await repConn.query(
        `INSERT INTO smt_budget_transfers (
          hcode, budget_year, run_date, posting_date, batch_no, ref_doc_no,
          fund_name, fund_group, fund_descr, efund_desc, budget_source,
          moph_id, moph_desc, amount, wait_amount, debt_amount, bond_amount, vat_amount, net_total,
          bank_name, mou_grp_code, efund_cd, sfund_cd, raw_payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          fund_name = VALUES(fund_name),
          efund_desc = VALUES(efund_desc),
          moph_id = VALUES(moph_id),
          moph_desc = VALUES(moph_desc),
          amount = VALUES(amount),
          wait_amount = VALUES(wait_amount),
          debt_amount = VALUES(debt_amount),
          vat_amount = VALUES(vat_amount),
          net_total = VALUES(net_total),
          bank_name = VALUES(bank_name),
          raw_payload = VALUES(raw_payload),
          updated_at = CURRENT_TIMESTAMP`,
        [
          hcode, currentBYear, runDate, postingDate, batchNo, refDocNo,
          fundName, fundGroup, fundDescr, efundDesc, budgetSource,
          mophId, mophDesc, amount, waitAmount, debtAmount, bondAmount, vatAmount, netTotal,
          bankName, mouGrpCode, efundCd, sfundCd, JSON.stringify(item),
        ]
      );
      affected++;
    }
  } finally {
    repConn.release();
  }

  return {
    success: true,
    budget_year: currentBYear,
    total_fetched: rawDatas.length,
    inserted_or_updated: affected,
    message: `ดึงข้อมูลจาก SMT สำเร็จ ${rawDatas.length} รายการ (ปีงบประมาณ ${currentBYear})`,
  };
}

/**
 * Get SMT budget summary, reconciliations, and alerts
 */
export async function getSmtBudgetSummary(budgetYear: string): Promise<SmtBudgetSummaryResult> {
  await ensureRepstmTables();
  const utfConn = await getUTFConnection();
  let hcode = '11101';
  let hospitalName = 'โรงพยาบาลโคกศรีสุพรรณ';
  try {
    const ident = await readHospitalIdentity(utfConn);
    if (ident.hospital_code) hcode = ident.hospital_code;
    if (ident.hospital_name) hospitalName = ident.hospital_name;
  } catch (err) {
    console.warn('Unable to read identity:', err);
  } finally {
    utfConn.release();
  }

  const repConn = await getRepstmConnection();
  try {
    // 1. Fetch SMT transfers
    const [rows] = await repConn.query(
      `SELECT * FROM smt_budget_transfers
       WHERE hcode = ? AND budget_year = ?
       ORDER BY run_date DESC, id DESC`,
      [hcode, budgetYear]
    );

    const transferRows = (rows as any[]) || [];

    // 2. Fetch imported STM filenames & settlement batches to match
    const [batchRows] = await repConn.query(
      `SELECT DISTINCT source_filename FROM repstm_import_batch`
    );
    const importedFilenames = new Set((batchRows as any[]).map(b => String(b.source_filename || '').toUpperCase()));

    const [settledRows] = await repConn.query(
      `SELECT DISTINCT statement_no FROM receivable_settlement_batch`
    );
    const settledStatements = new Set((settledRows as any[]).map(s => String(s.statement_no || '').trim().toUpperCase()));

    let totalAmount = 0;
    let totalWait = 0;
    let totalDebt = 0;
    let totalVat = 0;
    let totalNet = 0;
    let settledCount = 0;
    let importedCount = 0;
    let unimportedCount = 0;

    const mophMap = new Map<string, MophAccountSummary>();
    const unimportedAlerts: SmtBudgetSummaryResult['unimported_alerts'] = [];
    const transfers: SmtTransferRow[] = [];

    for (const r of transferRows) {
      const refDoc = String(r.ref_doc_no || '').trim();
      const refNormalized = refDoc.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

      // Check if settled
      let isSettled = settledStatements.has(refDoc.toUpperCase());
      // Check if imported STM exists
      let matchedFile: string | null = null;
      if (!isSettled) {
        for (const fn of importedFilenames) {
          if (refNormalized && fn.includes(refNormalized)) {
            matchedFile = fn;
            break;
          }
          // Also check by batch or period if refDoc is like 6709_IP_02
          const parts = refDoc.split('_');
          if (parts.length >= 2) {
            const shortCode = parts[0] + parts[1];
            if (fn.includes(shortCode.toUpperCase())) {
              matchedFile = fn;
              break;
            }
          }
        }
      }

      let status: 'settled' | 'stm_imported' | 'unimported' = 'unimported';
      if (isSettled) {
        status = 'settled';
        settledCount++;
      } else if (matchedFile) {
        status = 'stm_imported';
        importedCount++;
      } else {
        status = 'unimported';
        unimportedCount++;
        unimportedAlerts.push({
          ref_doc_no: r.ref_doc_no,
          batch_no: r.batch_no,
          run_date: r.run_date,
          fund_name: r.fund_name,
          moph_id: r.moph_id,
          moph_desc: r.moph_desc,
          net_total: Number(r.net_total || 0),
          wait_amount: Number(r.wait_amount || 0),
          debt_amount: Number(r.debt_amount || 0),
        });
      }

      const amt = Number(r.amount || 0);
      const wait = Number(r.wait_amount || 0);
      const debt = Number(r.debt_amount || 0);
      const vat = Number(r.vat_amount || 0);
      const net = Number(r.net_total || 0);

      totalAmount += amt;
      totalWait += wait;
      totalDebt += debt;
      totalVat += vat;
      totalNet += net;

      // Group by MOPH Account (ผังบัญชี สป.สธ.)
      const mophCode = String(r.moph_id || '9999999999.999').trim();
      const mophDesc = String(r.moph_desc || 'ไม่ระบุผังบัญชี').trim();
      let accountType: 'receivable_1' | 'revenue_4' | 'other' = 'other';
      if (mophCode.startsWith('1')) accountType = 'receivable_1';
      else if (mophCode.startsWith('4')) accountType = 'revenue_4';

      if (!mophMap.has(mophCode)) {
        mophMap.set(mophCode, {
          moph_id: mophCode,
          moph_desc: mophDesc,
          account_type: accountType,
          record_count: 0,
          sum_amount: 0,
          sum_wait: 0,
          sum_debt: 0,
          sum_vat: 0,
          sum_net_total: 0,
        });
      }

      const mSummary = mophMap.get(mophCode)!;
      mSummary.record_count++;
      mSummary.sum_amount += amt;
      mSummary.sum_wait += wait;
      mSummary.sum_debt += debt;
      mSummary.sum_vat += vat;
      mSummary.sum_net_total += net;

      transfers.push({
        id: r.id,
        hcode: r.hcode,
        budget_year: r.budget_year,
        run_date: r.run_date ? String(r.run_date).substring(0, 10) : '',
        posting_date: r.posting_date,
        batch_no: r.batch_no,
        ref_doc_no: r.ref_doc_no,
        fund_name: r.fund_name,
        fund_group: r.fund_group,
        fund_descr: r.fund_descr,
        efund_desc: r.efund_desc,
        budget_source: r.budget_source,
        moph_id: r.moph_id,
        moph_desc: r.moph_desc,
        amount: amt,
        wait_amount: wait,
        debt_amount: debt,
        bond_amount: Number(r.bond_amount || 0),
        vat_amount: vat,
        net_total: net,
        bank_name: r.bank_name,
        mou_grp_code: r.mou_grp_code,
        efund_cd: r.efund_cd,
        sfund_cd: r.sfund_cd,
        reconcile_status: status,
        matched_statement_file: matchedFile,
      });
    }

    const mophAccounts = Array.from(mophMap.values()).sort((a, b) => a.moph_id.localeCompare(b.moph_id));

    return {
      budget_year: budgetYear,
      hcode,
      hospital_name: hospitalName,
      total_records: transferRows.length,
      total_amount: Math.round(totalAmount * 100) / 100,
      total_wait: Math.round(totalWait * 100) / 100,
      total_debt: Math.round(totalDebt * 100) / 100,
      total_vat: Math.round(totalVat * 100) / 100,
      total_net: Math.round(totalNet * 100) / 100,
      settled_count: settledCount,
      imported_count: importedCount,
      unimported_count: unimportedCount,
      transfers,
      moph_accounts: mophAccounts,
      unimported_alerts: unimportedAlerts,
    };
  } finally {
    repConn.release();
  }
}
