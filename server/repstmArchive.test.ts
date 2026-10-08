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
  assert.equal(result.datasets[0].rows[0].SESSNO, '863059381');
  assert.equal(result.datasets[0].rows[0].transaction_uid, 'CHIHD:863059381');
  assert.equal(result.datasets[0].rows[0].paid_amount, '3295.0000');
  assert.equal(result.datasets[0].rows[0].source_paid, '0.0000');
});

test('rejects ZIP files without supported statement detail XML', () => {
  const zip = new AdmZip();
  zip.addFile('readme.xml', Buffer.from('<OTHER><value>1</value></OTHER>', 'utf8'));
  assert.throws(() => analyzeRepstmArchive(zip.toBuffer(), 'unsupported.zip'), /ไม่พบไฟล์ REP หรือ STM ที่ระบบรองรับ/);
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
  assert.equal(dataset.rows[0].transaction_uid, 'CHIHD:872134990');
  assert.equal(dataset.rows[0]['ชดเชยสุทธิ'], 1884);
  assert.equal(dataset.rows[1].errorcode, '44');
  assert.equal(dataset.rows[1]['รายละเอียดข้อผิดพลาด'], 'เบิกยา ESA สูงกว่าราคาที่ให้เบิก');
  assert.equal(dataset.rows[1]['ชดเชยสุทธิ'], 0);
});

test('flattens SOCD social-security kidney STM into session rows and reconciles the source total', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <STMSTM>
    <stmAccountID>SOCD</stmAccountID><hcode id="EA0011101">11101</hcode><hname>Test Hospital</hname>
    <AccPeriod>260601</AccPeriod><STMdoc>11101_SOCDSTM_20260601</STMdoc>
    <dateStart>1 มิถุนายน 2569</dateStart><dateEnd>15 มิถุนายน 2569</dateEnd><dateData>17 มิถุนายน 2569</dateData><dateIssue>17 มิถุนายน 2569</dateIssue>
    <acount>1</acount><amount>1934.0000</amount>
    <STMdat code="HD" name="ประกันสังคม" desc="บริการไตเทียม"><amount>1934.0000</amount></STMdat>
    <HDBills><HDBill>
      <hreg>11101</hreg><hn>00000001</hn><name>Patient One</name><pid>1234567890123</pid>
      <benefit main="S" sub="" marker=""/><wkno>0710</wkno><hds>1</hds><payable>1500.00</payable>
      <EPO><epoPay>384.00</epoPay></EPO>
      <TBill><hcode>11101</hcode><station>01</station><wkno>0710</wkno><hreg>11101</hreg><hn>00000001</hn>
        <invno>863059590</invno><dttran>2026-05-18T14:12:00</dttran><hdrate>1500.00</hdrate><hdcharge>1500.00</hdcharge>
        <amount>1500.00</amount><paid>0.00</paid><rid>1295</rid><HDflag>COS</HDflag><paychk>1</paychk><EPOstat>E</EPOstat>
        <EPOs><EPOiu>8000</EPOiu><EPOpay>384.00</EPOpay><HCT>23</HCT><EPOadm>50.00</EPOadm><EPO code="1033097" eponame="EPIAO"><item code="01">384.00</item></EPO></EPOs>
      </TBill>
    </HDBill></HDBills>
  </STMSTM>`;
  const zip = new AdmZip();
  zip.addFile('11101_SOCDSTM_20260601.XML', Buffer.from(xml, 'utf8'));

  const result = analyzeRepstmArchive(zip.toBuffer(), '11101_SOCDSTM_20260601.ZIP');
  const dataset = result.datasets[0];
  assert.equal(dataset.importerId, 'socd-statement');
  assert.equal(dataset.importerLabel, 'STM ไตประกันสังคม CHI (SOCD)');
  assert.equal(dataset.rows.length, 1);
  assert.equal(dataset.rows[0].SESSNO, '863059590');
  assert.equal(dataset.rows[0].transaction_uid, 'CHIHD:863059590');
  assert.equal(dataset.rows[0].paid_amount, '1934.00');
  assert.equal(dataset.rows[0]['EPO Payment'], '384.00');
  assert.equal(dataset.summary.totalAmount, 1934);
  assert.equal(dataset.summary.sourceTotalAmount, 1934);
});

test('reads SSS IPD SIGN STM from XML archive', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <STMLIST>
    <stmAccountID>SIGN</stmAccountID>
    <stmdat>
      <hcode>11101</hcode><hname>โรงพยาบาลโคกศรีสุพรรณ</hname>
      <period>6903</period><stmno>11101ST6903</stmno><dateDue>1 เมษายน 2569</dateDue>
    </stmdat>
    <Bills>
      <Bill>
        <hcode>11101</hcode><hmain>10710</hmain><hn>97898</hn><an>690000497</an>
        <pid>1479900376930</pid><name>จันทร์จิรา ปิระนันท์</name>
        <dateadm>2026-02-22</dateadm><datedsc>2026-02-25</datedsc>
        <drg>6660</drg><rw>0.5353</rw><adjrw>0.5353</adjrw><Reimb>4480.75</Reimb>
      </Bill>
    </Bills>
  </STMLIST>`;
  const zip = new AdmZip();
  zip.addFile('11101_SIGNSTMS_6903.xml', Buffer.from(xml, 'utf8'));

  const result = analyzeRepstmArchive(zip.toBuffer(), '11101_SIGNSTM_6903.zip');
  assert.equal(result.datasets.length, 1);
  const d = result.datasets[0];
  assert.equal(d.importerId, 'sss-ipd-statement');
  assert.equal(d.detectedType, 'STM');
  assert.equal(d.rows.length, 1);
  assert.equal(d.rows[0].an, '690000497');
  assert.equal(d.rows[0].hn, '97898');
  assert.equal(d.rows[0].paid_amount, '4480.75');
  assert.equal(d.rows[0].maininscl, 'SSS');
});

test('reads SSS OPD BIL REP from .BIL archive', () => {
  const bil = `เอกสารตอบรับ ข้อมูลเบิกค่ารักษาพยาบาลผู้ป่วยนอกสิทธิประกันสังคม
รหัส ร.พ. = 11101
เลขที่ตอบรับ = 9130001
งวดส่งของ ร.พ. = 1237_01_20260930-102936
*| A 01, 1, 11101, 10710, , 28/09/2569 08:00, 690928080044, 3471500261344, S, 2330.00, 2330.00 |
*| C 01, 2, 11101, 10710, , 28/09/2569 08:59, 690928000138, 1471500083181, S, 220.00, 0.00 | 101,
`;
  const zip = new AdmZip();
  zip.addFile('11101_SOCDBIL_9130001.BIL', iconv.encode(bil, 'tis620'));

  const result = analyzeRepstmArchive(zip.toBuffer(), '11101_SOCDBIL_9130001.zip');
  assert.equal(result.datasets.length, 1);
  const d = result.datasets[0];
  assert.equal(d.importerId, 'sss-opd-bil-rep');
  assert.equal(d.detectedType, 'REP');
  assert.equal(d.rows.length, 2);
  assert.equal(d.rows[0].vn, '690928080044');
  assert.equal(d.rows[0].verifycode, 'A');
  assert.equal(d.rows[0].paid_amount, '2330.00');
  assert.equal(d.rows[1].verifycode, 'C');
  assert.equal(d.rows[1].errorcode, '101');
});

test('reads SSS IPD SIGNREP from .REP archive', () => {
  const sup = `รายละเอียดเพิ่มเติมการตอบรับ ข้อมูลเบิกค่ารักษา ระบบ AIPN
อ้างอิงเอกสารตอบรับข้อมูลผู้ป่วยใน ประกันสังคม  เลขตอบรับที่      =  10242
*| AN , HN , Name (PID),  chkstat ([checkcode])---
*|690002359     ,000041118,     พัชรี ใจหาญ  (2419900023709 ) , C (251,)
251: วันเวลา เริ่ม(in) และ/หรือ สิ้นสุด(out) ของหัตถการอยู่นอกช่วงการอยู่รพ.
`;
  const zip = new AdmZip();
  zip.addFile('11101_SIGNSUP_10242.REP', iconv.encode(sup, 'tis620'));

  const result = analyzeRepstmArchive(zip.toBuffer(), '11101_SIGNREP_10242.zip');
  assert.equal(result.datasets.length, 1);
  const d = result.datasets[0];
  assert.equal(d.importerId, 'sss-ipd-rep');
  assert.equal(d.detectedType, 'REP');
  assert.equal(d.rows.length, 1);
  assert.equal(d.rows[0].an, '690002359');
  assert.equal(d.rows[0].hn, '000041118');
  assert.equal(d.rows[0].verifycode, 'C');
  assert.equal(d.rows[0].errorcode, '251');
  assert.equal(d.rows[0]['รายละเอียดข้อผิดพลาด'], 'วันเวลา เริ่ม(in) และ/หรือ สิ้นสุด(out) ของหัตถการอยู่นอกช่วงการอยู่รพ.');
});

test('reads COCD/CSOP BIL REP from .BIL archive and maps fields accurately', () => {
  const cocdText = `เอกสารตอบรับ ข้อมูลเบิกค่ารักษาพยาบาลผู้ป่วยนอก
สำหรับ\tโคกศรีสุพรรณ
รหัส ร.พ.\t\t\t= 11101
งวดส่งของ ร.พ.\t\t= 0001_01_20260421-151122
วันที่ออกเลขตอบรับ \t\t= 22/04/2569   เวลา: 10:47:24
เลขที่ตอบรับ\t\t= 8968001\t

==  คณะกรรมการการเลือกตั้ง  ==
*| C 01  , 1,           , 08/04/2569 08:15:44, 690408000125____, ________________, 000098420, __________,              600.00 | T73,

T73 : หมวดค่าบริการทางการพยาบาลสูงผิดปกติ

==  สำนักงานกองทุนฟื้นฟูและพัฒนาเกษตรกร  ==
*| A 01  , 1,           , 16/11/2568 07:23:23, 681116072323____, ________________, 000081710, __________,              100.00 |
`;
  const zip = new AdmZip();
  zip.addFile('11101_COCDBIL_8968001.BIL', iconv.encode(cocdText, 'tis620'));

  const result = analyzeRepstmArchive(zip.toBuffer(), '11101_cocdbil_8968001.ZIP');
  assert.equal(result.datasets.length, 1);
  const d = result.datasets[0];
  assert.equal(d.importerId, 'cocd-opd-bil-rep');
  assert.equal(d.detectedType, 'REP');
  assert.equal(d.rows.length, 2);
  assert.equal(d.rows[0].vn, '690408000125');
  assert.equal(d.rows[0].hn, '000098420');
  assert.equal(d.rows[0].maininscl, 'OFC');
  assert.equal(d.rows[0].department, 'OP');
  assert.equal(d.rows[0].verifycode, 'C');
  assert.equal(d.rows[0].errorcode, 'T73');
  assert.equal(d.rows[0]['รายละเอียดข้อผิดพลาด'], 'หมวดค่าบริการทางการพยาบาลสูงผิดปกติ');
  assert.equal(d.rows[0].paid_amount, '0.00');

  assert.equal(d.rows[1].vn, '681116072323');
  assert.equal(d.rows[1].hn, '000081710');
  assert.equal(d.rows[1].maininscl, 'OFC');
  assert.equal(d.rows[1].verifycode, 'A');
  assert.equal(d.rows[1].paid_amount, '100.00');
});
