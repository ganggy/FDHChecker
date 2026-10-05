import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  calculateFiscalPeriod,
  resolveDebtorCode,
  buildOfficialExcelWorkbook,
  type AgingForm1Result,
  type ClaimControlForm2Result,
  type OpdControlForm3Result,
  type IpdControlForm4Result,
} from './officialReceivableReportService.js';
import {
  OFFICIAL_CHART_OF_ACCOUNTS_54,
  normalizeAccountCode,
} from './officialReceivableConstants.js';

test('OFFICIAL_CHART_OF_ACCOUNTS_54 contains exactly 54 unique standard accounts', () => {
  assert.equal(OFFICIAL_CHART_OF_ACCOUNTS_54.length, 54);
  const seenCodes = new Set<string>();
  const seenOrders = new Set<number>();

  OFFICIAL_CHART_OF_ACCOUNTS_54.forEach((acc, index) => {
    assert.equal(acc.order, index + 1);
    assert.ok(acc.code.startsWith('1102050101.') || acc.code.startsWith('1102050102.'));
    assert.ok(acc.name.length > 0);
    assert.ok(!seenCodes.has(acc.code), `Duplicate code: ${acc.code}`);
    assert.ok(!seenOrders.has(acc.order), `Duplicate order: ${acc.order}`);
    seenCodes.add(acc.code);
    seenOrders.add(acc.order);
  });
});

test('normalizeAccountCode standardizes 3 decimal precision for .310 and .110', () => {
  assert.equal(normalizeAccountCode('1102050101.31'), '1102050101.310');
  assert.equal(normalizeAccountCode('1102050102.11'), '1102050102.110');
  assert.equal(normalizeAccountCode('1102050101.201'), '1102050101.201');
});

test('calculateFiscalPeriod computes correct dates for Thai fiscal year', () => {
  // Test month 10 (Oct) of FY 2568 -> starts 2024-10-01
  const octPeriod = calculateFiscalPeriod(10, 2568);
  assert.equal(octPeriod.month, 10);
  assert.equal(octPeriod.yearBE, 2568);
  assert.equal(octPeriod.yearCE, 2024);
  assert.equal(octPeriod.startDate, '2024-10-01');
  assert.equal(octPeriod.endDate, '2024-10-31');
  assert.equal(octPeriod.fyStartDate, '2024-10-01');

  // Test month 1 (Jan) of FY 2568 -> 2025-01-01
  const janPeriod = calculateFiscalPeriod(1, 2568);
  assert.equal(janPeriod.month, 1);
  assert.equal(janPeriod.yearBE, 2568);
  assert.equal(janPeriod.yearCE, 2025);
  assert.equal(janPeriod.startDate, '2025-01-01');
  assert.equal(janPeriod.endDate, '2025-01-31');
  assert.equal(janPeriod.fyStartDate, '2024-10-01');

  // Test month 2 in leap year (Feb 2024 in FY 2567)
  const feb2024 = calculateFiscalPeriod(2, 2567);
  assert.equal(feb2024.endDate, '2024-02-29');
});

test('resolveDebtorCode maps pttype correctly to OPD and IPD debtor accounts', () => {
  // Right 10 (ชำระเงิน): OPD 1102050102.106, IPD 1102050102.107
  assert.equal(resolveDebtorCode('10', false), '1102050102.106');
  assert.equal(resolveDebtorCode('10', true), '1102050102.107');

  // Right 11 (UC ใน CUP): OPD 1102050101.201, IPD 1102050101.202
  assert.equal(resolveDebtorCode('11', false), '1102050101.201');
  assert.equal(resolveDebtorCode('11', true), '1102050101.202');

  // Unmapped fallback: default to paid
  assert.equal(resolveDebtorCode('UNKNOWN_RIGHT', false), '1102050102.106');
  assert.equal(resolveDebtorCode('UNKNOWN_RIGHT', true), '1102050102.107');
});

test('buildOfficialExcelWorkbook generates 4 correctly formatted sheets', () => {
  const period = calculateFiscalPeriod(8, 2569);
  const hospName = 'โรงพยาบาลทดสอบ';

  const f1: AgingForm1Result = {
    period,
    hospitalName: hospName,
    items: OFFICIAL_CHART_OF_ACCOUNTS_54.map(acc => ({
      code: acc.code,
      order: acc.order,
      name: acc.name,
      isIpd: acc.isIpd,
      caseCount: acc.order === 6 ? 10 : 0,
      totalValue: acc.order === 6 ? 5000 : 0,
      le30Days: acc.order === 6 ? 3000 : 0,
      gt30Days: acc.order === 6 ? 2000 : 0,
    })),
    totals: { caseCount: 10, totalValue: 5000, le30Days: 3000, gt30Days: 2000 },
  };

  const f2: ClaimControlForm2Result = {
    period,
    hospitalName: hospName,
    accountFilter: '1102050101.201',
    accountName: 'ลูกหนี้ค่ารักษา UC- OP ใน CUP',
    rows: [
      {
        no: 1,
        hn: '000001',
        vn: '6908010001',
        an: '',
        cid: '1234567890123',
        patientName: 'ทดสอบ ผู้ป่วย',
        serviceDate: '01/08/2569',
        dischargeDate: '',
        pttypeName: 'UC ใน CUP',
        debtorCode: '1102050101.201',
        costAmount: 500,
        claimedAmount: 500,
        repStm: 'STM-001',
        compensatedAmount: 450,
        varianceAmount: 50,
        balanceAmount: 50,
        paidDate: '05/08/2569',
        paidAmount: 0,
        remainderAmount: 50,
        le30DaysAmount: 50,
        gt30DaysAmount: 0,
        reason: 'รอชดเชยส่วนต่าง',
      }
    ],
    monthTotals: {
      costAmount: 500,
      claimedAmount: 500,
      compensatedAmount: 450,
      varianceAmount: 50,
      balanceAmount: 50,
      paidAmount: 0,
      remainderAmount: 50,
      le30DaysAmount: 50,
      gt30DaysAmount: 0,
    },
    ytdTotals: {
      costAmount: 1000,
      claimedAmount: 1000,
      compensatedAmount: 900,
      varianceAmount: 100,
      balanceAmount: 100,
      paidAmount: 0,
      remainderAmount: 100,
      le30DaysAmount: 100,
      gt30DaysAmount: 0,
    },
  };

  const f3: OpdControlForm3Result = {
    period,
    hospitalName: hospName,
    accountFilter: 'ALL',
    accountName: 'ทุกประเภทผังบัญชี (OPD)',
    rows: [],
    monthTotals: {
      broughtForward: 0, monthlyAmount: 500, balance1: 500, claimedAmount: 500,
      adjAdd: 0, adjSub: 0, balance2: 500, stmCompensation: 450, stmVariance: 50,
      stmUnclaimable: 0, balance3: 50, settleDebtCut: 0, balance4: 50, carriedForward: 50
    },
    ytdTotals: {
      broughtForward: 0, monthlyAmount: 1000, balance1: 1000, claimedAmount: 1000,
      adjAdd: 0, adjSub: 0, balance2: 1000, stmCompensation: 900, stmVariance: 100,
      stmUnclaimable: 0, balance3: 100, settleDebtCut: 0, balance4: 100, carriedForward: 100
    },
  };

  const f4: IpdControlForm4Result = {
    period,
    hospitalName: hospName,
    accountFilter: 'ALL',
    accountName: 'ทุกประเภทผังบัญชี (IPD)',
    rows: [],
    monthTotals: {
      broughtForward: 0, monthlyAmount: 0, balance1: 0, claimedAmount: 0,
      adjAdd: 0, adjSub: 0, balance2: 0, stmCompensation: 0, varianceHigh: 0,
      varianceLow: 0, balance3: 0, settleDebtCut: 0, accruedRevenue: 0, balance4: 0, carriedForward: 0
    },
    ytdTotals: {
      broughtForward: 0, monthlyAmount: 0, balance1: 0, claimedAmount: 0,
      adjAdd: 0, adjSub: 0, balance2: 0, stmCompensation: 0, varianceHigh: 0,
      varianceLow: 0, balance3: 0, settleDebtCut: 0, accruedRevenue: 0, balance4: 0, carriedForward: 0
    },
  };

  const wb = buildOfficialExcelWorkbook(f1, f2, f3, f4);
  assert.equal(wb.SheetNames.length, 4);
  assert.deepEqual(wb.SheetNames, [
    'สรุปลูกหนี้คงเหลือ แยกตามอายุ',
    'ทะเบียนคุมงานเรียกเก็บ',
    'ทะเบียนคุมบัญชี OP',
    'ทะเบียนคุมบัญชี IP'
  ]);

  const sheet1Data = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['สรุปลูกหนี้คงเหลือ แยกตามอายุ'], { header: 1 });
  assert.ok(sheet1Data[0][0].includes('รายงานลูกหนี้ค่ารักษาพยาบาลคงเหลือ'));
  assert.equal(sheet1Data.length, 59); // 4 header rows + 54 account rows + 1 total row = 59 rows
});
