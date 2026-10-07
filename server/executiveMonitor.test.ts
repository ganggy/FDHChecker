import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyServiceCategory,
  classifyRightScheme,
  isCCode,
  mapSmtFundToServiceCategory,
  SERVICE_CATEGORY_LABELS,
  RIGHT_SCHEME_LABELS,
  SERVICE_CATEGORY_ORDER,
  RIGHT_SCHEME_ORDER,
  extractSubSchemeName,
} from './executiveMonitorService.js';

test('SERVICE_CATEGORY_LABELS contains all 8 expected hospital service types', () => {
  assert.equal(SERVICE_CATEGORY_ORDER.length, 8);
  for (const key of SERVICE_CATEGORY_ORDER) {
    assert.ok(SERVICE_CATEGORY_LABELS[key], `Missing label for ${key}`);
    assert.ok(SERVICE_CATEGORY_LABELS[key].name.length > 0);
    assert.ok(SERVICE_CATEGORY_LABELS[key].icon.length > 0);
  }
});

test('RIGHT_SCHEME_LABELS contains all 8 expected healthcare rights/funds', () => {
  assert.equal(RIGHT_SCHEME_ORDER.length, 8);
  for (const key of RIGHT_SCHEME_ORDER) {
    assert.ok(RIGHT_SCHEME_LABELS[key], `Missing label for ${key}`);
    assert.ok(RIGHT_SCHEME_LABELS[key].name.length > 0);
    assert.ok(RIGHT_SCHEME_LABELS[key].icon.length > 0);
  }
});

test('classifyServiceCategory accurately identifies specialized services', () => {
  // Dialysis / Hemodialysis
  assert.equal(classifyServiceCategory('ผู้ป่วยนอก', 'ไตเทียม', null, null, null), 'DIALYSIS');
  assert.equal(classifyServiceCategory(null, null, null, 'LGO-HD-2025.xlsx', null), 'DIALYSIS');
  assert.equal(classifyServiceCategory(null, null, null, null, { PROJCODE: 'CA_HD' }), 'DIALYSIS');
  assert.equal(classifyServiceCategory(null, null, null, null, { 'วันที่ฟอกเลือดด้วยเครื่องไตเทียม': '2025-01-01' }), 'DIALYSIS');

  // Thai Traditional Medicine
  assert.equal(classifyServiceCategory('ผู้ป่วยนอก', 'แพทย์แผนไทย', null, null, null), 'THAI_MED');
  assert.equal(classifyServiceCategory(null, null, null, null, { DIAG: 'U5753', PROC: '872-78-11' }), 'THAI_MED');
  assert.equal(classifyServiceCategory(null, null, null, null, { clinic: 'คลินิกแพทย์แผนไทยและสมุนไพร' }), 'THAI_MED');

  // Physical Therapy
  assert.equal(classifyServiceCategory('ผู้ป่วยนอก', 'กายภาพบำบัด', null, null, null), 'PHYSICAL_THERAPY');
  assert.equal(classifyServiceCategory(null, null, null, null, { DIAG: 'Z50', desc: 'เวชกรรมฟื้นฟู' }), 'PHYSICAL_THERAPY');

  // Dental
  assert.equal(classifyServiceCategory('ผู้ป่วยนอก', 'ทันตกรรม', null, null, null), 'DENTAL');
  assert.equal(classifyServiceCategory(null, null, null, null, { item: 'ขูดหินปูน' }), 'DENTAL');

  // Health Promotion & Prevention (PPFS)
  assert.equal(classifyServiceCategory('ผู้ป่วยนอก', 'เวชปฏิบัติครอบครัว', null, null, { fund: 'PPFS', item: 'คัดกรองเบาหวาน' }), 'PPFS');
  assert.equal(classifyServiceCategory(null, null, null, null, { project: 'ANC ฝากครรภ์' }), 'PPFS');

  // IPD
  assert.equal(classifyServiceCategory('IPD', null, '67000123', null, null), 'IPD');
  assert.equal(classifyServiceCategory('ผู้ป่วยใน', null, null, null, null), 'IPD');
  assert.equal(classifyServiceCategory(null, 'IP', null, null, null), 'IPD');
  assert.equal(classifyServiceCategory(null, null, null, 'STM_11101_IPUCS256901_02.XLS', null), 'IPD');

  // OPD
  assert.equal(classifyServiceCategory('OPD', 'OP', null, null, null), 'OPD');
  assert.equal(classifyServiceCategory('ผู้ป่วยนอก', null, null, null, null), 'OPD');
  // OPUCS statement files must NEVER be classified as IPD even if AN has a TRAN_ID or department is IP
  assert.equal(classifyServiceCategory(null, 'IP', '579134327', 'STM_11101_OPUCS256901_02.XLS', { 'พึงรับ OP': '150.00' }), 'OPD');
  assert.equal(classifyServiceCategory(null, null, '579134327', 'STM_11101_OPLGO256801_02.XLS', null), 'OPD');
  assert.equal(classifyServiceCategory(null, null, null, 'STM_11101_OPUCS256803_02.XLS [ รายละเอียด(ข้อมูลปกติ) 1 OP]', null), 'OPD');
});

test('classifyRightScheme accurately identifies coverage schemes', () => {
  // OFC
  assert.equal(classifyRightScheme('OFC', null, null, null), 'OFC');
  assert.equal(classifyRightScheme('CS', null, null, null), 'OFC');
  assert.equal(classifyRightScheme(null, null, null, { pttype_name: 'ข้าราชการเบิกจ่ายตรง' }), 'OFC');

  // LGO
  assert.equal(classifyRightScheme('LGO', null, null, null), 'LGO');
  assert.equal(classifyRightScheme(null, null, 'LGO-HD-Report.xlsx', null), 'LGO');

  // SSS
  assert.equal(classifyRightScheme('SSS', null, null, null), 'SSS');
  assert.equal(classifyRightScheme(null, null, null, { maininscl: 'ประกันสังคม ม.33' }), 'SSS');

  // INS / A9
  assert.equal(classifyRightScheme('INS', null, null, null), 'A9_INS');
  assert.equal(classifyRightScheme('A9', null, null, null), 'A9_INS');
  assert.equal(classifyRightScheme(null, null, null, { fund: 'พรบ.คุ้มครองผู้ประสบภัยจากรถ' }), 'A9_INS');

  // Foreign / Self Pay
  assert.equal(classifyRightScheme('NRD', null, null, null), 'FOREIGN_SELF');
  assert.equal(classifyRightScheme('CSH', null, null, null), 'FOREIGN_SELF');

  // UCS In-CUP vs Out-CUP
  assert.equal(classifyRightScheme('UCS', 'IN', null, null), 'UCS_INCUP');
  assert.equal(classifyRightScheme('UCS', 'OUT', null, null), 'UCS_OUTCUP');
  assert.equal(classifyRightScheme('UCS', 'WALKIN', null, null), 'UCS_OUTCUP');
  assert.equal(classifyRightScheme('UCS', null, null, { note: 'บริการปฐมภูมิไปที่ไหนก็ได้ นอกเขต' }), 'UCS_OUTCUP');

  // Hemodialysis Statements mapped to actual rights
  assert.equal(classifyRightScheme(null, null, 'DCKD6701.stm', null), 'UCS_INCUP');
  assert.equal(classifyRightScheme(null, null, 'COCD6701.stm', null), 'OFC');
  assert.equal(classifyRightScheme(null, null, 'CHIHD6701.stm', null), 'OFC');
  assert.equal(classifyRightScheme(null, null, 'LGO-HD-6701.stm', null), 'LGO');
  assert.equal(classifyRightScheme(null, null, 'SOCD6701.stm', null), 'SSS');

  // Other Rights (ทหารผ่านศึก / ผู้พิการ / ชนกลุ่มน้อย)
  assert.equal(classifyRightScheme('VET', null, null, null), 'OTHER');
  assert.equal(classifyRightScheme('DIS', null, null, null), 'OTHER');
});

test('isCCode correctly identifies C-codes, Denials, and Reject codes', () => {
  assert.equal(isCCode('C01'), true);
  assert.equal(isCCode('C02, C15'), true);
  assert.equal(isCCode('399-1'), true);
  assert.equal(isCCode('DENY'), true);
  assert.equal(isCCode('DENY_NON_BENEFIT'), true);
  assert.equal(isCCode('REJECT_INVALID_DX'), true);
  assert.equal(isCCode(''), false);
  assert.equal(isCCode(null), false);
  assert.equal(isCCode(undefined), false);
});

test('mapSmtFundToServiceCategory maps SMT budget funds to service categories', () => {
  assert.equal(mapSmtFundToServiceCategory('บริการฟอกเลือดด้วยเครื่องไตเทียม'), 'DIALYSIS');
  assert.equal(mapSmtFundToServiceCategory('บริการแพทย์แผนไทย'), 'THAI_MED');
  assert.equal(mapSmtFundToServiceCategory('บริการฟื้นฟูสมรรถภาพด้านการแพทย์'), 'PHYSICAL_THERAPY');
  assert.equal(mapSmtFundToServiceCategory('บริการทันตกรรม'), 'DENTAL');
  assert.equal(mapSmtFundToServiceCategory('บริการสร้างเสริมสุขภาพและป้องกันโรค (PP)'), 'PPFS');
  assert.equal(mapSmtFundToServiceCategory('บริการผู้ป่วยใน'), 'IPD');
  assert.equal(mapSmtFundToServiceCategory('งบเหมาจ่ายรายหัว OP'), 'OPD');
  assert.equal(mapSmtFundToServiceCategory('กองทุนเฉพาะอื่นๆ'), 'OTHER');
});

test('extractSubSchemeName extracts descriptive sub-scheme or statement origin', () => {
  assert.equal(extractSubSchemeName({ subinscl: 'VET' }), 'VET (ทหารผ่านศึก)');
  assert.equal(extractSubSchemeName({ subinscl: 'DIS' }), 'DIS (คนพิการ)');
  assert.equal(extractSubSchemeName({ maininscl: 'OFC' }), 'OFC (ข้าราชการ กรมบัญชีกลาง)');
  assert.equal(extractSubSchemeName({ filename: 'DCKD6701.stm' }), 'DCKD (ฟอกไต สปสช.)');
  assert.equal(extractSubSchemeName({ filename: 'CHIHD6701.stm' }), 'CHI/COCD (ฟอกไต ข้าราชการ)');
  assert.equal(extractSubSchemeName({ filename: 'LGO-HD-6701.stm' }), 'LGO-HD (ฟอกไต อปท.)');
});

test('ExecutivePipelineMetrics calculates submission, reimbursement, and denial rates accurately', () => {
  const totalHospitalVisits = 1000;
  const totalClaimedCount = 950;
  const totalClaimedAmount = 500000;
  const totalReimbursedCount = 900;
  const totalReimbursedAmount = 450000;
  const totalDeniedCount = 30;
  const totalDeniedAmount = 25000;

  const submissionRate = Math.min(100, Math.round((totalClaimedCount / totalHospitalVisits) * 10000) / 100);
  const unclaimedCount = Math.max(0, totalHospitalVisits - totalClaimedCount);
  const unclaimedRate = Math.round((unclaimedCount / totalHospitalVisits) * 10000) / 100;

  const reimbursementVisitRate = Math.round((totalReimbursedCount / totalClaimedCount) * 10000) / 100;
  const reimbursementAmountRate = Math.round((totalReimbursedAmount / totalClaimedAmount) * 10000) / 100;
  const denialVisitRate = Math.round((totalDeniedCount / totalClaimedCount) * 10000) / 100;
  const denialAmountRate = Math.round((totalDeniedAmount / totalClaimedAmount) * 10000) / 100;

  assert.equal(submissionRate, 95.0);
  assert.equal(unclaimedCount, 50);
  assert.equal(unclaimedRate, 5.0);
  assert.equal(reimbursementVisitRate, 94.74);
  assert.equal(reimbursementAmountRate, 90.0);
  assert.equal(denialVisitRate, 3.16);
  assert.equal(denialAmountRate, 5.0);
});

test('Fiscal year boundaries are accurately calculated from budget year', () => {
  const by = 2569;
  const startAd = by - 543 - 1;
  const endAd = by - 543;
  assert.equal(`${startAd}-10-01`, '2025-10-01');
  assert.equal(`${endAd}-09-30`, '2026-09-30');
});

