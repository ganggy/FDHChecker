import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeStConfig,
  fiscalYearBeToCe,
  getFiscalDateRange,
  getMisPageByKey,
  MIS_HOS_MENU_GROUPS,
  MIS_HOS_PAGES,
  normalizeThaiFundName,
} from './misHosCatalog.js';
import {
  buildBudgetThreeWayComparison,
  buildMonthlyComparison,
  buildSubfundComparison,
  type SmtAggRow,
  type StmAggBucket,
} from './misHosCompareService.js';

const makeStmBucket = (overrides: Partial<StmAggBucket> = {}): StmAggBucket => ({
  mm: '10',
  dept: 'OP',
  inscl: 'UCS',
  fgroup: 'STM_OPUCS',
  mainFund: '',
  subFund: '',
  subDesc: '',
  cnt: 1,
  sumAmount: 0,
  sumPaid: 0,
  sumAdjRw: 0,
  sumOpAmt: 0,
  sumIpAmt: 0,
  sumHcAmt: 0,
  sumAeAmt: 0,
  sumInstAmt: 0,
  sumDmisAmt: 0,
  sumCataractAmt: 0,
  sumStemiAmt: 0,
  sumPalliativeAmt: 0,
  sumDmishdAmt: 0,
  sumPpAmt: 0,
  sumFsAmt: 0,
  sumCovidAmt: 0,
  ...overrides,
});

test('MIS catalog covers all 10 sidebar categories plus Overview and valid ST_IDs', () => {
  assert.equal(MIS_HOS_MENU_GROUPS.length, 11);
  assert.ok(MIS_HOS_PAGES.length >= 30);
  const overview = getMisPageByKey('overview');
  assert.equal(overview?.kind, 'overview');
  for (const p of MIS_HOS_PAGES) {
    if (p.kind === 'simplestudio') {
      assert.ok(p.stId && /^\d+$/.test(p.stId), `Invalid stId on ${p.key}`);
    }
  }
});

test('fiscalYearBeToCe and getFiscalDateRange convert Thai fiscal year correctly', () => {
  assert.equal(fiscalYearBeToCe('2569'), 2026);
  assert.equal(fiscalYearBeToCe(2026), 2026);
  const r = getFiscalDateRange('2569');
  assert.deepEqual(r, {
    beYear: '2569',
    ceYear: 2026,
    startDate: '2025-10-01',
    endDate: '2026-09-30',
    startMonthYm: '202510',
    endMonthYm: '202609',
  });
});

test('decodeStConfig decodes base64 ST_CONFIG and filters active flag_data=Y cards', () => {
  const sample = [
    { ssid: '1825', report_name: 'รายรับ', chart_type: 'bar', flag_data: 'Y' },
    { ssid: '9999', report_name: 'ซ่อน', chart_type: 'table', flag_data: 'N' },
  ];
  const b64 = Buffer.from(JSON.stringify(sample), 'utf8').toString('base64');
  const cards = decodeStConfig(b64);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].ssid, '1825');
  assert.equal(decodeStConfig('invalid!!').length, 0);
});

test('normalizeThaiFundName strips redundant prefixes for matching', () => {
  assert.equal(normalizeThaiFundName('กองทุนไตวายเรื้อรัง'), 'ไตวายเรื้อรัง');
  assert.equal(normalizeThaiFundName('  ค่าบริการผู้ป่วยไตวายเรื้อรัง  '), 'ผู้ป่วยไตวายเรื้อรัง');
});

test('buildBudgetThreeWayComparison reconciles MIS, SMT, STM, and separates OFC/SSS outside NHSO transfer', () => {
  const misFunds = [
    { code: '1', fundName: 'กองทุนค่าบริการทางการแพทย์', misAmount: 1000000, misPrevAmount: 900000 },
    { code: '3', fundName: 'กองทุนไตวายเรื้อรัง', misAmount: 500000, misPrevAmount: 450000 },
  ];
  const smtRows: SmtAggRow[] = [
    { fundGroup: '1', fundName: 'กองทุนผู้ป่วยนอก', mm: '10', cnt: 5, sumAmount: 600000, sumNet: 590000 },
    { fundGroup: '1', fundName: 'กองทุนผู้ป่วยใน', mm: '11', cnt: 4, sumAmount: 400000, sumNet: 400000 },
    { fundGroup: '3', fundName: 'กองทุนไตวายเรื้อรัง', mm: '10', cnt: 2, sumAmount: 480000, sumNet: 480000 },
  ];
  const stmBuckets: StmAggBucket[] = [
    makeStmBucket({ inscl: 'UCS', fgroup: 'STM_OPUCS', cnt: 100, sumPaid: 950000 }),
    makeStmBucket({ inscl: 'WEL', fgroup: 'DCKD', mainFund: 'CKD_HD_PURIFY', cnt: 50, sumPaid: 500000 }),
    makeStmBucket({ inscl: 'OFC', fgroup: 'COCDSTM', cnt: 20, sumPaid: 300000 }),
    makeStmBucket({ inscl: 'SSS', fgroup: 'SIGNSTM', cnt: 10, sumPaid: 120000 }),
  ];

  const { rows, outsideNhsoStm } = buildBudgetThreeWayComparison(misFunds, smtRows, stmBuckets);
  const g1 = rows.find((r) => r.code === '1')!;
  const g3 = rows.find((r) => r.code === '3')!;

  assert.equal(g1.misAmount, 1000000);
  assert.equal(g1.smtAmount, 1000000);
  assert.equal(g1.stmAmount, 950000);
  assert.equal(g1.diffMisSmt, 0);
  assert.equal(g1.diffMisStm, 50000);
  assert.equal(g1.coverageStmPct, 95);

  assert.equal(g3.smtAmount, 480000);
  assert.equal(g3.stmAmount, 500000);
  assert.equal(g3.diffMisSmt, 20000);
  assert.equal(g3.diffMisStm, 0);

  assert.equal(outsideNhsoStm.ofcAmount, 300000);
  assert.equal(outsideNhsoStm.sssAmount, 120000);
});

test('buildMonthlyComparison aligns all 12 fiscal months (10..09) and respects cutoffYm', () => {
  const rows = buildMonthlyComparison(
    '2569',
    [{ mm: '10', misAmount: 1000, misOpAmount: 400, misIpAmount: 600 }],
    [{ fundGroup: '1', fundName: 'OP', mm: '10', cnt: 1, sumAmount: 900, sumNet: 900 }],
    [
      makeStmBucket({ mm: '10', dept: 'OP', sumPaid: 400, cnt: 2 }),
      makeStmBucket({ mm: '10', dept: 'IP', fgroup: 'STM_IPUCS', sumPaid: 550, cnt: 1 }),
    ],
    '202512'
  );
  assert.equal(rows.length, 12);
  assert.equal(rows[0].mm, '10');
  assert.equal(rows[0].withinCutoff, true);
  assert.equal(rows[0].stmOpAmount, 400);
  assert.equal(rows[0].stmIpAmount, 550);
  assert.equal(rows[0].diffMisStm, 50);
  assert.equal(rows[3].mm, '01');
  assert.equal(rows[3].withinCutoff, false);
});

test('buildSubfundComparison matches aliases and preserves MIS-only and STM-only subfunds', () => {
  const rows = buildSubfundComparison(
    [
      { code: 'HD-PU', fundGroup: 'CKD_HD_PURIFY', name: 'ค่าฟอกเลือด', misAmount: 150000, misVisits: 100 },
      { code: 'HERB_FS', fundGroup: 'HC22', name: 'บริการสมุนไพร', misAmount: 50000, misVisits: 200 },
    ],
    [
      makeStmBucket({ fgroup: 'DCKD', subFund: 'HD-PU', subDesc: 'HD - ค่าฟอกเลือด', sumPaid: 150000, cnt: 100 }),
      makeStmBucket({ fgroup: 'STM_OPUCS', sumInstAmt: 80000, sumPaid: 80000, cnt: 10 }),
    ]
  );

  const hd = rows.find((r) => r.code === 'HD-PU')!;
  const herb = rows.find((r) => r.code === 'HERB_FS')!;
  const inst = rows.find((r) => r.code === 'INST')!;

  assert.equal(hd.status, 'ตรงกัน');
  assert.equal(herb.status, 'ยังไม่มี STM');
  assert.equal(herb.diffMisStm, 50000);
  assert.equal(inst.status, 'พบเฉพาะใน STM');
  assert.equal(inst.stmAmount, 80000);
});
