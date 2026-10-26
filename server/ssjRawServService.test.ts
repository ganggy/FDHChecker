import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {
  classifySsjRight,
  aggregateSsjRawServRows,
  generateSsjRawServExcelBuffer,
  type SsjOpdSourceRow,
  type SsjIpdSourceRow,
} from './ssjRawServService.js';

test('classifySsjRight classifies rights according to SSJ RawServ standards', () => {
  // 1. UC
  assert.equal(classifySsjRight({ hipdata_code: 'UCS', name: 'สิทธิบัตรทองทั่วไป' }), 'UC');
  assert.equal(classifySsjRight({ name: 'ประกันสุขภาพถ้วนหน้า' }), 'UC');

  // 2. SSS
  assert.equal(classifySsjRight({ hipdata_code: 'SSS', name: 'ประกันสังคม' }), 'SSS');
  assert.equal(classifySsjRight({ hipdata_code: 'SSI', name: 'ผู้ประกันตนทุพพลภาพ' }), 'SSS');

  // 3. OFC
  assert.equal(classifySsjRight({ hipdata_code: 'OFC', name: 'ข้าราชการ กรมบัญชีกลาง' }), 'OFC');
  assert.equal(classifySsjRight({ hipdata_code: 'CSMBS', name: 'จ่ายตรงข้าราชการ' }), 'OFC');

  // 4. LGO
  assert.equal(classifySsjRight({ hipdata_code: 'LGO', name: 'อปท. เบิกจ่ายตรง' }), 'LGO');
  assert.equal(classifySsjRight({ hipdata_code: 'PTY', name: 'เมืองพัทยา' }), 'LGO');

  // 5. STP
  assert.equal(classifySsjRight({ hipdata_code: 'STP', name: 'บุคคลที่มีปัญหาสถานะและสิทธิ' }), 'STP');
  assert.equal(classifySsjRight({ name: 'บุคคลไร้สัญชาติ' }), 'STP');

  // 6. FWF
  assert.equal(classifySsjRight({ hipdata_code: 'FWF', name: 'กองทุนแรงงานต่างด้าว' }), 'FWF');
  assert.equal(classifySsjRight({ hipdata_code: 'NRD', name: 'ต่างด้าว' }), 'FWF');

  // 7. ชำระเงินเอง
  assert.equal(classifySsjRight({ hipdata_code: 'CSH', name: 'ชำระเงินครบ' }), 'ชำระเงินเอง');
  assert.equal(classifySsjRight({ paidst: '01', name: 'เงินสด' }), 'ชำระเงินเอง');

  // 8. สิทธิอื่นๆ
  assert.equal(classifySsjRight({ hipdata_code: 'INS', name: 'พรบ.ผู้ประสบภัยจากรถ' }), 'สิทธิอื่นๆ');
  assert.equal(classifySsjRight({ hipdata_code: 'A2', name: 'เบิกต้นสังกัด' }), 'สิทธิอื่นๆ');
});

test('aggregateSsjRawServRows creates exactly 54 rows with exact code format and sums', () => {
  const opdRows: SsjOpdSourceRow[] = [
    { vn: '1', hn: 'HN001', hipdata_code: 'UCS', name: 'UC' },
    { vn: '2', hn: 'HN001', hipdata_code: 'UCS', name: 'UC' }, // same patient, 2 visits
    { vn: '3', hn: 'HN002', hipdata_code: 'SSS', name: 'SSS' },
    { vn: '4', hn: 'HN003', hipdata_code: 'CSH', name: 'เงินสด' },
  ];

  const ipdRows: SsjIpdSourceRow[] = [
    { an: '101', hn: 'HN001', hipdata_code: 'UCS', adjrw: 1.5, los: 3 },
    { an: '102', hn: 'HN004', hipdata_code: 'OFC', adjrw: 2.1234, los: 5 },
  ];

  const { rows, audit } = aggregateSsjRawServRows(opdRows, ipdRows);

  assert.equal(rows.length, 54);

  // Check OPD Visits (OPV)
  const opv01 = rows.find((r) => r.code_serv === 'OPV_01');
  const opv02 = rows.find((r) => r.code_serv === 'OPV_02');
  const opv07 = rows.find((r) => r.code_serv === 'OPV_07');
  const opv09 = rows.find((r) => r.code_serv === 'OPV_09');

  assert.equal(opv01?.amount, 2); // UC visits: 2
  assert.equal(opv02?.amount, 1); // SSS visits: 1
  assert.equal(opv07?.amount, 1); // Self-pay visits: 1
  assert.equal(opv09?.amount, 4); // Total visits: 4

  // Check OPD HNs (OPH)
  const oph01 = rows.find((r) => r.code_serv === 'OPH_01');
  const oph09 = rows.find((r) => r.code_serv === 'OPH_09');
  assert.equal(oph01?.amount, 1); // UC distinct HN: HN001 only
  assert.equal(oph09?.amount, 3); // Total unique HNs across categories: 1 + 1 + 1 = 3

  // Check IPD Admits (IPA)
  const ipa01 = rows.find((r) => r.code_serv === 'IPA_01');
  const ipa03 = rows.find((r) => r.code_serv === 'IPA_03');
  const ipa09 = rows.find((r) => r.code_serv === 'IPA_09');
  assert.equal(ipa01?.amount, 1);
  assert.equal(ipa03?.amount, 1);
  assert.equal(ipa09?.amount, 2);

  // Check IPD SumAdjRW (IPS)
  const ips01 = rows.find((r) => r.code_serv === 'IPS_01');
  const ips03 = rows.find((r) => r.code_serv === 'IPS_03');
  const ips09 = rows.find((r) => r.code_serv === 'IPS_09');
  assert.equal(ips01?.amount, 1.5);
  assert.equal(ips03?.amount, 2.1234);
  assert.equal(ips09?.amount, 3.6234);

  // Check IPD Los (IPL)
  const ipl01 = rows.find((r) => r.code_serv === 'IPL_01');
  const ipl03 = rows.find((r) => r.code_serv === 'IPL_03');
  const ipl09 = rows.find((r) => r.code_serv === 'IPL_09');
  assert.equal(ipl01?.amount, 3);
  assert.equal(ipl03?.amount, 5);
  assert.equal(ipl09?.amount, 8);

  // Check audit
  assert.equal(audit.opd_total_visits, 4);
  assert.equal(audit.opd_distinct_hn, 3);
  assert.equal(audit.ipd_total_admits, 2);
  assert.equal(audit.ipd_distinct_hn, 2);
  assert.equal(audit.ipd_sum_adjrw, 3.6234);
  assert.equal(audit.ipd_sum_los, 8);
});

test('generateSsjRawServExcelBuffer produces valid Excel matching template structure and sheet name', () => {
  const { rows } = aggregateSsjRawServRows(
    [{ vn: '1', hn: 'HN001', hipdata_code: 'UCS' }],
    [{ an: '101', hn: 'HN001', hipdata_code: 'UCS', adjrw: 1.2345, los: 2 }]
  );

  const buffer = generateSsjRawServExcelBuffer(rows);
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0);

  const readFn = (XLSX as any).read || (XLSX as any).default?.read;
  const wb = readFn(buffer, { type: 'buffer' });
  assert.deepEqual(wb.SheetNames, ['NewTemp']);

  const sheet = wb.Sheets['NewTemp'];
  assert.equal(sheet['B1']?.v, 'RawServ (ตารางข้อมูลบริการ)');
  assert.equal(sheet['B2']?.v, 'Code_SerV');
  assert.equal(sheet['C2']?.v, 'SerV_Type');
  assert.equal(sheet['D2']?.v, 'Item');
  assert.equal(sheet['E2']?.v, 'Rights');
  assert.equal(sheet['F2']?.v, 'Amount');

  // Row 3 (OPV_01: UC Visit)
  assert.equal(sheet['B3']?.v, 'OPV_01');
  assert.equal(sheet['F3']?.v, 1);

  // Row 11 (OPV_09: รวมทั้งหมดทุกสิทธิ)
  assert.equal(sheet['B11']?.v, 'OPV_09');
  assert.equal(sheet['F11']?.v, 1);

  // Row 39 (IPS_01: UC SumAdjRW)
  assert.equal(sheet['B39']?.v, 'IPS_01');
  assert.equal(sheet['F39']?.v, 1.2345);
});
