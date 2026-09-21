import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateBillingLogic } from '../src/utils/billingUtils.js';
import { filterSpecificFundRows, hasTraditionalMedicineDiagnosis } from '../src/utils/specificFundRules.js';
import {
  ANC_DENTAL_CLEAN_PROCEDURE_CODES,
  ANC_DENTAL_EXAM_PROCEDURE_CODES,
  hasMatchingDentalProcedureIcd9,
} from '../src/utils/ancDentalRules.js';

const opdVisit = {
  serviceType: 'ผู้ป่วยนอก',
  has_close: 0,
  main_diag: 'N185',
};

test('postnatal page excludes visits with U diagnoses from API fallback fields', () => {
  const rows = [
    { vn: 'traditional', pdx: 'Z392', dx0: 'U505', dx1: 'R42', dx2: 'U6131' },
    { vn: 'postnatal', pdx: 'Z392', dx0: 'R42' },
  ];

  assert.equal(hasTraditionalMedicineDiagnosis(rows[0]), true);
  assert.deepEqual(filterSpecificFundRows('postnatal_care', rows), [rows[1]]);
  assert.deepEqual(filterSpecificFundRows('postnatal_supplements', rows), rows);
});

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

test('normal OFC remains a UUC1 whole-visit claim without requiring EP close', () => {
  const result = evaluateBillingLogic({
    ...opdVisit,
    pttype_code: '20',
    hipdata_code: 'OFC',
    fund: 'ข้าราชการ',
  });

  assert.equal(result.isUUC1, true);
  assert.equal(result.billingStatusLabel, 'เบิกได้ทั้ง Visit (OFC/LGO)');
  assert.equal(result.specialFundNotes.some((note: string) => note.includes('ยังไม่ปิดสิทธิ')), false);
});

test('CSCD and LGO do not require EP close and remain whole-visit claims', () => {
  const cscdResult = evaluateBillingLogic({
    ...opdVisit,
    pttype_code: '30',
    hipdata_code: 'CSCD',
    fund: 'เบิกจ่ายตรงกรมบัญชีกลาง CSCD',
  });

  assert.equal(cscdResult.isUUC1, true);
  assert.equal(cscdResult.billingStatusLabel, 'เบิกได้ทั้ง Visit (OFC/LGO)');
  assert.equal(cscdResult.specialFundNotes.some((note: string) => note.includes('ยังไม่ปิดสิทธิ')), false);

  const lgoResult = evaluateBillingLogic({
    ...opdVisit,
    pttype_code: '21',
    hipdata_code: 'LGO',
    fund: 'สิทธิกองทุนบุคลากรองค์การปกครองส่วนท้องถิ่น (อปท.)',
  });

  assert.equal(lgoResult.isUUC1, true);
  assert.equal(lgoResult.billingStatusLabel, 'เบิกได้ทั้ง Visit (OFC/LGO)');
  assert.equal(lgoResult.specialFundNotes.some((note: string) => note.includes('ยังไม่ปิดสิทธิ')), false);
});

test('OPD Palliative with Authen Code is ready without a close EP', () => {
  const result = evaluateBillingLogic({
    serviceType: 'ผู้ป่วยนอก',
    hipdata_code: 'UCS',
    fund: 'บัตรประกันสุขภาพ',
    main_diag: 'Z515',
    has_pal_diag: 1,
    has_pal_adp: 1,
    has_authen: 1,
    authen_code: 'AUTHEN-PAL-001',
    has_close: 0,
  });

  assert.equal(result.isUUC1, true);
  assert.equal(result.billingStatusLabel, 'UUC1 Palliative พร้อมส่ง (Authen)');
  assert.equal(result.specialFundNotes.some((note: string) => note.includes('ยังไม่ปิดสิทธิ')), false);
  assert.equal(result.specialFundNotes.some((note: string) => note.includes('Authen Code')), true);
});

test('OPD Palliative without Authen Code or close EP still waits for EP', () => {
  const result = evaluateBillingLogic({
    serviceType: 'ผู้ป่วยนอก',
    hipdata_code: 'UCS',
    fund: 'บัตรประกันสุขภาพ',
    main_diag: 'Z515',
    has_pal_diag: 1,
    has_pal_adp: 1,
    has_authen: 0,
    has_close: 0,
  });

  assert.equal(result.isUUC1, true);
  assert.equal(result.billingStatusLabel, 'UUC1 รอปิดสิทธิ (EP)');
});

test('ANC dental rules require the approved ICD10TM and ICD-9 pair', () => {
  assert.equal(hasMatchingDentalProcedureIcd9('2330011:8931', ANC_DENTAL_EXAM_PROCEDURE_CODES, '8931'), true);
  assert.equal(hasMatchingDentalProcedureIcd9('2330010:8931', ANC_DENTAL_EXAM_PROCEDURE_CODES, '8931'), true);
  assert.equal(hasMatchingDentalProcedureIcd9('2387010:9654', ANC_DENTAL_CLEAN_PROCEDURE_CODES, '9654'), true);
  assert.equal(hasMatchingDentalProcedureIcd9('2338610:2499', ANC_DENTAL_CLEAN_PROCEDURE_CODES, '9654'), false);

  const complete = evaluateBillingLogic({
    serviceType: 'ผู้ป่วยนอก',
    hipdata_code: 'UCS',
    sex: '2',
    main_diag: 'Z340',
    has_anc_diag: 1,
    has_anc_dental_clean: 1,
    dental_procedure_codes: '2387010',
    dental_procedure_pairs: '2387010:9654',
  });
  const missingMatchingAdp = evaluateBillingLogic({
    serviceType: 'ผู้ป่วยนอก',
    hipdata_code: 'UCS',
    sex: '2',
    main_diag: 'Z340',
    has_anc_diag: 1,
    has_anc_dental_clean: 1,
    dental_procedure_codes: '2387010',
    dental_procedure_pairs: '2387010:8931',
  });

  assert.equal(complete.specialFundNotes.includes('🪥 ANC ขัดทำความสะอาดฟัน'), true);
  assert.equal(missingMatchingAdp.specialFundNotes.some((note: string) => note.includes('ICD-9 9654')), true);
});

test('WALKIN matched item qualifies as UUC1 and exports under WALKIN fund', () => {
  const result = evaluateBillingLogic({
    serviceType: 'ผู้ป่วยนอก',
    hipdata_code: 'UCS',
    main_diag: 'J00',
    has_walkin: 1,
    has_close: 1,
  });

  assert.equal(result.isUUC1, true);
  assert.equal(result.billingStatusLabel, 'UUC1 เงื่อนไขครบ');
  assert.equal(result.specialFundNotes.includes('🚶 WALKIN (ผู้ป่วยนอกเหตุสมควร)'), true);
  assert.equal(result.matchedSpecialFundNotes.includes('WALKIN (ผู้ป่วยนอกเหตุสมควร)'), true);
  assert.equal(result.detectedSpecialFundNotes.includes('WALKIN (ผู้ป่วยนอกเหตุสมควร)'), true);
});

test('WALKIN pttype without walkin item is detected as warning with missing service item', () => {
  const result = evaluateBillingLogic({
    serviceType: 'ผู้ป่วยนอก',
    hipdata_code: 'UCS',
    main_diag: 'J00',
    is_walkin_pttype: 1,
    has_walkin: 0,
    has_close: 0,
  });

  assert.equal(result.isUUC1, false);
  assert.equal(result.incompleteFund, true);
  assert.equal(result.specialFundNotes.some((note: string) => note.includes('WALKIN (ผู้ป่วยนอกเหตุสมควร): ขาด รายการค่าบริการ WALKIN')), true);
  assert.equal(result.detectedSpecialFundNotes.includes('WALKIN (ผู้ป่วยนอกเหตุสมควร)'), true);
});

