import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fiscalYearDateRange,
  HOSPITAL_PCU_SCOPE,
  parseCommunityDeathReportIntent,
  parseHospitalReportInstructionFilters,
  parseHospitalReportIntent,
  runHospitalReport,
} from './hospitalReportTools.js';

test('turns an explicit UC-only instruction into a real payer filter', () => {
  assert.deepEqual(parseHospitalReportInstructionFilters('เอาเฉพาะสิทธิ์ uc'), { payerGroup: 'uc' });
  assert.deepEqual(parseHospitalReportInstructionFilters('บัตรทองเท่านั้น'), { payerGroup: 'uc' });
  assert.deepEqual(parseHospitalReportInstructionFilters('สรุปสำหรับประชุมเช้า'), { payerGroup: undefined });
  assert.deepEqual(parseHospitalReportInstructionFilters('ไม่เอา UC'), { payerGroup: undefined });
});

test('maps the hospital PCU villages from the confirmed area image', () => {
  assert.equal(HOSPITAL_PCU_SCOPE.addressId, '471501');
  assert.deepEqual(HOSPITAL_PCU_SCOPE.villages, [1, 2, 4, 5, 7, 8, 9, 10, 13, 14, 15, 16]);
  assert.equal(HOSPITAL_PCU_SCOPE.villages.includes(3 as never), false);
});

test('uses the current and two prior Thai fiscal years for a three-year report', () => {
  assert.deepEqual(fiscalYearDateRange(3, new Date('2026-08-05T01:00:00Z')), {
    fiscalYears: [2567, 2568, 2569], dateStart: '2023-10-01', dateEnd: '2026-09-30',
  });
  assert.deepEqual(fiscalYearDateRange(3, new Date('2026-10-01T01:00:00Z')), {
    fiscalYears: [2568, 2569, 2570], dateStart: '2024-10-01', dateEnd: '2027-09-30',
  });
});

test('recognizes a PCU death Excel request and explicit fiscal years', () => {
  assert.deepEqual(
    parseCommunityDeathReportIntent('รายงานการเสียชีวิตในเขต PCU โรงพยาบาล 3 ปีย้อนหลัง ออกเป็น Excel', new Date('2026-08-05T01:00:00Z')),
    {
      reportId: 'pcu-death', dateStart: '2023-10-01', dateEnd: '2026-09-30', format: 'xlsx',
      aiSummary: true, instructions: 'ปีงบประมาณ 2567, 2568, 2569',
    },
  );
  assert.deepEqual(
    parseCommunityDeathReportIntent('ผู้เสียชีวิต ตองโขบ ปีงบประมาณ 2567 ถึง 2568 เป็น Word'),
    {
      reportId: 'pcu-death', dateStart: '2023-10-01', dateEnd: '2025-09-30', format: 'docx',
      aiSummary: true, instructions: 'ปีงบประมาณ 2567, 2568',
    },
  );
  assert.equal(parseCommunityDeathReportIntent('รายงานผู้ป่วยนอกวันนี้'), null);
});

test('routes verified bed and payer templates without model-generated SQL', () => {
  assert.deepEqual(parseHospitalReportIntent('ขอสถานะผู้ครองเตียงเป็น Excel'), {
    reportId: 'bed-occupancy', format: 'xlsx', aiSummary: true,
  });
  assert.deepEqual(parseHospitalReportIntent('ขอสัดส่วนสิทธิการรักษาเดือนนี้เป็น Excel', new Date('2026-08-05T01:00:00Z')), {
    reportId: 'payer-mix', dateStart: '2026-08-01', dateEnd: '2026-08-31', format: 'xlsx', aiSummary: true,
  });
  assert.deepEqual(parseHospitalReportIntent('รวมทุกตึก 30 เตียงตามการขึ้นทะเบียน และ 38 ตาม กบรส'), {
    reportId: 'bed-occupancy', registeredBeds: 30, operationalBeds: 38, aiSummary: true,
  });
  assert.deepEqual(parseHospitalReportIntent('อยากได้ข้อมูลคนไข้แยกราย รพ.สต. ค่าใช้จ่าย visit และ refer เป็น Excel', new Date('2026-08-05T01:00:00Z')), {
    reportId: 'pcu-patient-service', dateStart: '2026-08-01', dateEnd: '2026-08-31', format: 'xlsx', aiSummary: true,
  });
  assert.deepEqual(parseHospitalReportIntent('ขอสรุปบริการแยก รพ.สต. ว่ามาทำอะไร ค่ายา ยาอะไร lab และอื่นๆ เป็น Excel', new Date('2026-08-05T01:00:00Z')), {
    reportId: 'pcu-visit-service-detail', dateStart: '2026-08-01', dateEnd: '2026-08-31', format: 'xlsx', aiSummary: true,
  });
});

test('rejects patient reports without an exact identifier before querying HOSxP', async () => {
  await assert.rejects(
    () => runHospitalReport({ reportId: 'discharge-summary', identifierType: 'an', identifier: '' }),
    /กรุณาระบุ AN หรือ HN/,
  );
});

test('rejects reversed and oversized financial report date ranges', async () => {
  await assert.rejects(
    () => runHospitalReport({ reportId: 'payer-mix', dateStart: '2026-08-05', dateEnd: '2026-08-01' }),
    /วันที่เริ่มต้นต้องไม่เกิน/,
  );
  await assert.rejects(
    () => runHospitalReport({ reportId: 'cost-per-drg', dateStart: '2024-01-01', dateEnd: '2026-08-05' }),
    /ไม่เกิน 366 วัน/,
  );
});

test('does not run report ids that have no verified source mapping', async () => {
  await assert.rejects(
    () => runHospitalReport({ reportId: 'incident-report' as never }),
    /ยังไม่พร้อมใช้งาน/,
  );
});
