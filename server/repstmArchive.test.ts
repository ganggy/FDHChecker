import assert from 'node:assert';
import test from 'node:test';
import AdmZip from 'adm-zip';
import iconv from 'iconv-lite';
import { analyzeRepstmArchive } from './repstmArchive.js';

const buildDbf = (rows: Record<string, string>[]) => {
  const fields = [
    ['HCODE', 5], ['HN', 9], ['HCEXT', 2], ['HREG', 5], ['SESSNO', 9],
    ['SID', 30], ['STAT', 1], ['REPID', 4], ['STMID', 8], ['CHKCODE', 1],
  ] as const;
  const headerLength = 32 + (fields.length * 32) + 1;
  const recordLength = 1 + fields.reduce((sum, [, length]) => sum + length, 0);
  const buffer = Buffer.alloc(headerLength + (recordLength * rows.length) + 1, 0x20);
  buffer[0] = 0x03;
  buffer.writeUInt32LE(rows.length, 4);
  buffer.writeUInt16LE(headerLength, 8);
  buffer.writeUInt16LE(recordLength, 10);
  fields.forEach(([name, length], index) => {
    const offset = 32 + (index * 32);
    buffer.write(name, offset, 'ascii');
    buffer[offset + 11] = 0x43;
    buffer[offset + 16] = length;
  });
  buffer[headerLength - 1] = 0x0d;
  rows.forEach((row, rowIndex) => {
    let offset = headerLength + (rowIndex * recordLength);
    buffer[offset] = 0x20;
    offset += 1;
    fields.forEach(([name, length]) => {
      buffer.write(String(row[name] || '').slice(0, length).padEnd(length), offset, length, 'ascii');
      offset += length;
    });
  });
  buffer[buffer.length - 1] = 0x1a;
  return buffer;
};

test('reads COCD STM ZIP and preserves identifiers with leading zeroes', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <STMSTM>
    <stmAccountID>COCD</stmAccountID><hcode id="EA0011101">11101</hcode><hname>Test Hospital</hname>
    <AccPeriod>260502</AccPeriod><STMdoc>11101_COCDSTM_20260502</STMdoc><amount>3295.0000</amount>
    <STMdat code="HD" name="Kidney"><Dat><Tcount>1</Tcount></Dat></STMdat>
    <TBills code="HD"><TBill><sys>HD</sys><station>01</station><hreg>10710</hreg><hn>0014302</hn>
      <namepat>Patient One</namepat><invno>863059381</invno><dttran>2026-05-18T14:11:00</dttran>
      <amount>3295.0000</amount><paid>0.0000</paid><ExtP code="N">0.0000</ExtP><rid>1295</rid><cstat/><HDflag>COC</HDflag>
    </TBill></TBills>
  </STMSTM>`;
  const zip = new AdmZip();
  zip.addFile('11101_COCDSTM_20260502.xml', Buffer.from(xml, 'utf8'));

  const result = analyzeRepstmArchive(zip.toBuffer(), 'sample.zip');
  assert.equal(result.datasets.length, 1);
  assert.equal(result.datasets[0].detectedType, 'STM');
  assert.equal(result.datasets[0].importerId, 'cocd-statement');
  assert.equal(result.datasets[0].rows[0].HN, '0014302');
  assert.equal(result.datasets[0].rows[0].paid_amount, '3295.0000');
  assert.equal(result.datasets[0].rows[0].source_paid, '0.0000');
});

test('rejects ZIP files without supported statement detail XML', () => {
  const zip = new AdmZip();
  zip.addFile('readme.xml', Buffer.from('<OTHER><value>1</value></OTHER>', 'utf8'));
  assert.throws(() => analyzeRepstmArchive(zip.toBuffer(), 'unsupported.zip'), /ไม่พบ REP ไต CHI หรือ XML รายละเอียด STM/);
});

test('reads CHI kidney REP from paired BIL and DBF and keeps rejected error details', () => {
  const bil = `เอกสารตอบรับ ข้อมูลการเบิกค่ารักษาพยาบาลผู้ป่วยนอกโรคไต
รหัส รพ. = 11101
วันที่ออกเลขที่ตอบรับ = 18/08/2569 09:03:52
เลขที่ตอบรับ = 1354
งวดส่งของ ร.พ. = 1571_01_20260817-171557
*| A 01, 1, 11101, 0010613, 872134990, 17/08/2569 06:10:00, C, O, S, N, EPIAO, 8000, 35, 1, 384.00, 1500.00, 1500, |
*| C 01, 2, 11505, 3286_____, 872133720, 17/08/2569 06:02:00, C, O, C, , N, 2032.00, 0.00, 0.00, | 44,
44 : เบิกยา ESA สูงกว่าราคาที่ให้เบิก
`;
  const dbf = buildDbf([
    { HCODE: '11101', HN: '0010613', HCEXT: '01', HREG: '11101', SESSNO: '872134990', SID: '1571_01_20260817-171557', REPID: '1354', STMID: 'XXXXXXXX', CHKCODE: 'A' },
    { HCODE: '11101', HN: '3286', HCEXT: '01', HREG: '11505', SESSNO: '872133720', SID: '1571_01_20260817-171557', REPID: '1354', STMID: 'XXXXXXXX', CHKCODE: 'C' },
  ]);
  const zip = new AdmZip();
  zip.addFile('11101_CORTBIL_1354.BIL', iconv.encode(bil, 'tis620'));
  zip.addFile('11101_CORTBIL_1354.DBF', dbf);

  const result = analyzeRepstmArchive(zip.toBuffer(), '11101_cortbil_1354.zip');
  const dataset = result.datasets[0];
  assert.equal(dataset.importerId, 'chi-hd-rep');
  assert.equal(dataset.detectedType, 'REP');
  assert.equal(dataset.summary.responseNo, '1354');
  assert.equal(dataset.summary.acceptedCount, 1);
  assert.equal(dataset.summary.rejectedCount, 1);
  assert.equal(dataset.rows[0].SESSNO, '872134990');
  assert.equal(dataset.rows[0]['ชดเชยสุทธิ'], 1884);
  assert.equal(dataset.rows[1].errorcode, '44');
  assert.equal(dataset.rows[1]['รายละเอียดข้อผิดพลาด'], 'เบิกยา ESA สูงกว่าราคาที่ให้เบิก');
  assert.equal(dataset.rows[1]['ชดเชยสุทธิ'], 0);
});
