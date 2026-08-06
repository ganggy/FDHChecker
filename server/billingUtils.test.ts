import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateBillingLogic } from '../src/utils/billingUtils.js';

const opdVisit = {
  serviceType: 'ผู้ป่วยนอก',
  has_close: 0,
  main_diag: 'N185',
};

test('SSS is exported as UUC2 without being presented as excluded', () => {
  const result = evaluateBillingLogic({
    ...opdVisit,
    pttype_code: '34',
    hipdata_code: 'SSS',
    fund: 'บัตรประกันสังคม รพ.สกลนคร',
  });

  assert.equal(result.isUUC1, false);
  assert.equal(result.opacity, 1);
  assert.match(result.billingStatusLabel, /^UUC2 ประกันสังคม/);
});

test('paid-in-full right overrides ambiguous A1 mapping and exports as UUC2', () => {
  const result = evaluateBillingLogic({
    ...opdVisit,
    pttype_code: '10',
    hipdata_code: 'A1',
    fund: 'ชำระเงินครบ',
  });

  assert.equal(result.isUUC1, false);
  assert.match(result.billingStatusLabel, /^UUC2 ชำระเงินครบ/);
});

test('self-paid motor insurance exports as UUC2', () => {
  const result = evaluateBillingLogic({
    ...opdVisit,
    pttype_code: '83',
    hipdata_code: 'A9',
    fund: 'พรบ.ชำระเงินเอง',
  });

  assert.equal(result.isUUC1, false);
  assert.match(result.billingStatusLabel, /^UUC2 พ\.ร\.บ\.ชำระเงินเอง/);
});

test('normal OFC remains a UUC1 whole-visit claim', () => {
  const result = evaluateBillingLogic({
    ...opdVisit,
    pttype_code: '20',
    hipdata_code: 'OFC',
    fund: 'ข้าราชการ',
  });

  assert.equal(result.isUUC1, true);
});

test('ANC dental cleaning accepts 2338610 only when the same ADP code exists', () => {
  const complete = evaluateBillingLogic({
    serviceType: 'ผู้ป่วยนอก',
    hipdata_code: 'UCS',
    sex: '2',
    main_diag: 'Z340',
    has_anc_diag: 1,
    has_anc_dental_clean: 1,
    dental_procedure_codes: '2338610',
    dental_adp_codes: '2338610',
  });
  const missingMatchingAdp = evaluateBillingLogic({
    serviceType: 'ผู้ป่วยนอก',
    hipdata_code: 'UCS',
    sex: '2',
    main_diag: 'Z340',
    has_anc_diag: 1,
    has_anc_dental_clean: 1,
    dental_procedure_codes: '2338610',
    dental_adp_codes: '2387010',
  });

  assert.equal(complete.specialFundNotes.includes('🪥 ANC ขัดทำความสะอาดฟัน'), true);
  assert.equal(missingMatchingAdp.specialFundNotes.some((note: string) => note.includes('หัตถการและ ADP รหัสเดียวกัน')), true);
});
