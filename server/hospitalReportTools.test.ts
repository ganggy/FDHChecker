import assert from 'node:assert/strict';
import test from 'node:test';
import { runHospitalReport } from './hospitalReportTools.js';

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
