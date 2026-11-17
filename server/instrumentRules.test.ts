import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateInstrument4511 } from './instrumentRules.js';

test('evaluateInstrument4511 passes emergency defibrillation with UCS ceiling 2,850', () => {
  const res = evaluateInstrument4511({
    has_4511: 'Y',
    instrument_4511_price: 2850,
    instrument_4511_qty: 1,
    instrument_diags: 'I46.0',
    instrument_procs: '99.62',
    hipdata_code: 'UCS',
    pttypename: 'บัตรทอง',
  });
  assert.equal(res.has4511, true);
  assert.equal(res.fund, 'UCS');
  assert.equal(res.ceiling, 2850);
  assert.deepEqual(res.missing, []);
  assert.deepEqual(res.warnings, []);
});

test('evaluateInstrument4511 enforces Cardiovascular Instability during PCI', () => {
  const resMissingInstability = evaluateInstrument4511({
    has_4511: 'Y',
    instrument_4511_price: 3000,
    instrument_4511_qty: 1,
    instrument_diags: 'I25.1',
    instrument_procs: '00.66',
    hipdata_code: 'OFC',
    pttypename: 'ข้าราชการ',
  });
  assert.equal(resMissingInstability.fund, 'OFC');
  assert.equal(resMissingInstability.ceiling, 3000);
  assert.ok(resMissingInstability.missing.some((m) => m.includes('Cardiovascular Instability')));
  assert.deepEqual(resMissingInstability.warnings, []);

  const resWithInstability = evaluateInstrument4511({
    has_4511: 'Y',
    instrument_4511_price: 3000,
    instrument_4511_qty: 1,
    instrument_diags: 'I21.0, R57.0',
    instrument_procs: '00.66',
    hipdata_code: 'OFC',
    pttypename: 'ข้าราชการ',
  });
  assert.deepEqual(resWithInstability.missing, []);
});

test('evaluateInstrument4511 flags missing clinical indication and over-ceiling UCS price', () => {
  const res = evaluateInstrument4511({
    has_4511: 'Y',
    instrument_4511_price: 3000,
    instrument_4511_qty: 1,
    instrument_diags: 'J06.9',
    instrument_procs: '',
    hipdata_code: 'UCS',
    pttypename: 'บัตรทอง',
  });
  assert.ok(res.missing.some((m) => m.includes('ขาดข้อบ่งชี้')));
  assert.ok(res.warnings.some((w) => w.includes('เกินเพดานสิทธิ UCS (2,850 บาท/ชุด)')));
});
