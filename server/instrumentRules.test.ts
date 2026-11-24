import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateInstrument4511,
  evaluateInstrumentVisit2569,
  get4511CeilingByFund,
  getInstrumentType2Spec2569,
  INSTRUMENT_TYPE2_2569_CATALOG,
} from './instrumentRules.js';

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

test('2569 Type 2 catalog loads key hospital codes and aligns 4511 LGO ceiling', () => {
  assert.ok(INSTRUMENT_TYPE2_2569_CATALOG.length > 250);
  const requiredCodes = [
    '1001', '4511', '8301', '8608', '8610', '8704', '8705', '8806', '9202', '9214',
    'IP006', 'REH1', 'REH2', 'REH3', 'REH4', 'REH5', 'REH6', 'REH7', 'REH8', 'REH9', 'REH10',
  ];
  for (const code of requiredCodes) {
    assert.ok(getInstrumentType2Spec2569(code), `Expected code ${code} in 2569 catalog`);
  }
  assert.equal(get4511CeilingByFund('LGO', 'อปท').ceiling, 3000);
});

test('evaluateInstrumentVisit2569 flags unclaimable fund items for 8608 (UCS) and 8704 (OFC)', () => {
  const ucsWith8608 = evaluateInstrumentVisit2569(
    [{ adpCode: '8608', icode: '3001001', name: 'Knee support', qty: 1, unitprice: 800, sumPrice: 800 }],
    'UCS',
    'บัตรทอง'
  );
  assert.equal(ucsWith8608.fund, 'UCS');
  assert.equal(ucsWith8608.unclaimableItems.length, 1);
  assert.equal(ucsWith8608.eligibleAmount, 0);
  assert.equal(ucsWith8608.excessAmount, 800);
  assert.equal(ucsWith8608.errors.length, 1);

  const ofcWith8608 = evaluateInstrumentVisit2569(
    [{ adpCode: '8608', icode: '3001001', name: 'Knee support', qty: 1, unitprice: 800, sumPrice: 800 }],
    'OFC',
    'ข้าราชการ'
  );
  assert.equal(ofcWith8608.unclaimableItems.length, 0);
  assert.equal(ofcWith8608.eligibleAmount, 800);
  assert.equal(ofcWith8608.excessAmount, 0);
  assert.deepEqual(ofcWith8608.errors, []);

  const ofcWith8704 = evaluateInstrumentVisit2569(
    [{ adpCode: '8704', icode: '3001002', name: 'ไม้เท้า 3 ปุ่ม', qty: 1, unitprice: 600, sumPrice: 600 }],
    'OFC',
    'เบิกตรงกรมบัญชีกลาง'
  );
  assert.equal(ofcWith8704.unclaimableItems.length, 1);
  assert.equal(ofcWith8704.errors.length, 1);

  const ucsWith8704 = evaluateInstrumentVisit2569(
    [{ adpCode: '8704', icode: '3001002', name: 'ไม้เท้า 3 ปุ่ม', qty: 1, unitprice: 600, sumPrice: 600 }],
    'UCS',
    'บัตรทอง'
  );
  assert.deepEqual(ucsWith8704.errors, []);
  assert.equal(ucsWith8704.eligibleAmount, 600);
});

test('evaluateInstrumentVisit2569 calculates over-ceiling excess for 8610 by fund and warns on unknown code 9901', () => {
  const ucs8610 = evaluateInstrumentVisit2569(
    [{ adpCode: '8610', icode: '3001003', name: 'อุปกรณ์พยุงส้นเท้า', qty: 1, unitprice: 2000, sumPrice: 2000 }],
    'UCS',
    'บัตรทอง'
  );
  assert.equal(ucs8610.eligibleAmount, 1200);
  assert.equal(ucs8610.excessAmount, 800);
  assert.equal(ucs8610.overCeilingItems.length, 1);
  assert.equal(ucs8610.warnings.length, 1);
  assert.deepEqual(ucs8610.errors, []);

  const ofc8610 = evaluateInstrumentVisit2569(
    [{ adpCode: '8610', icode: '3001003', name: 'อุปกรณ์พยุงส้นเท้า', qty: 1, unitprice: 2000, sumPrice: 2000 }],
    'OFC',
    'ข้าราชการ'
  );
  assert.equal(ofc8610.eligibleAmount, 2000);
  assert.equal(ofc8610.excessAmount, 0);
  assert.deepEqual(ofc8610.overCeilingItems, []);
  assert.deepEqual(ofc8610.warnings, []);

  const unknownVisit = evaluateInstrumentVisit2569(
    [{ adpCode: '9901', icode: '3009901', name: 'อุปกรณ์นอกบัญชี', qty: 1, unitprice: 500, sumPrice: 500 }],
    'UCS',
    'บัตรทอง'
  );
  assert.equal(unknownVisit.unknownCodeItems.length, 1);
  assert.equal(unknownVisit.warnings.length, 1);
  assert.deepEqual(unknownVisit.errors, []);
});

test('evaluateInstrumentVisit2569 validates 8301 Soft Collar across funds and scales ceiling by qty', () => {
  const ucsCollar = evaluateInstrumentVisit2569(
    [{ adpCode: '8301', icode: '3000326', name: 'SOFT COLLAR', qty: 2, unitprice: 210, sumPrice: 420 }],
    'UCS',
    'บัตรทอง'
  );
  assert.equal(ucsCollar.eligibleAmount, 420);
  assert.equal(ucsCollar.excessAmount, 0);
  assert.deepEqual(ucsCollar.errors, []);
  assert.deepEqual(ucsCollar.warnings, []);

  const sssCollar = evaluateInstrumentVisit2569(
    [{ adpCode: '8301', icode: '3000140', name: 'Soft Collar', qty: 1, unitprice: 250, sumPrice: 250 }],
    'SSS',
    'ประกันสังคม'
  );
  assert.equal(sssCollar.unclaimableItems.length, 1);
  assert.equal(sssCollar.errors.length, 1);
});
