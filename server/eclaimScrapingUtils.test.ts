import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getFilenameStemAliases,
  inferDetectedTypeFromFilename,
  inferFundFromBenefitLabel,
  scoreEclaimDownloadLink,
} from './eclaimScrapingUtils.js';

test('getFilenameStemAliases matches STM_ prefix and (1) duplicate variants', () => {
  const dbAliases = getFilenameStemAliases('STM_11101_OP202605_01.xls');
  assert.ok(dbAliases.includes('stm_11101_op202605_01'));
  assert.ok(dbAliases.includes('11101_op202605_01'));

  const dbCopyAliases = getFilenameStemAliases('STM_11101_IP202608_01 (1).xls');
  assert.ok(dbCopyAliases.includes('11101_ip202608_01'));
  assert.ok(dbCopyAliases.includes('stm_11101_ip202608_01'));

  const scrapedAliases = getFilenameStemAliases('11101_OP202605_01');
  assert.ok(scrapedAliases.includes('11101_op202605_01'));
  assert.ok(scrapedAliases.includes('stm_11101_op202605_01'));
});

test('inferDetectedTypeFromFilename separates REP eclaim_ files from STM pages', () => {
  assert.equal(inferDetectedTypeFromFilename('eclaim_11101_OP_25690417_173031153.xls', 'STM'), 'REP');
  assert.equal(inferDetectedTypeFromFilename('11101_OP202605_01', 'STM'), 'STM');
  assert.equal(inferDetectedTypeFromFilename('STM_11101_IP202611_01.xls', 'REP'), 'STM');
  assert.equal(inferDetectedTypeFromFilename('11101_COCDSTM_20261002.ZIP', 'INV'), 'STM');
});

test('inferFundFromBenefitLabel maps Thai e-Claim scheme names to canonical fund codes', () => {
  assert.equal(inferFundFromBenefitLabel('ข้าราชการ', ''), 'OFC');
  assert.equal(inferFundFromBenefitLabel('สิทธิข้าราชการ (CSMBS)', ''), 'OFC');
  assert.equal(inferFundFromBenefitLabel('องค์กรปกครองส่วนท้องถิ่น (อปท.)', ''), 'LGO');
  assert.equal(inferFundFromBenefitLabel('พนักงาน กทม.', ''), 'BKK');
  assert.equal(inferFundFromBenefitLabel('ประกันสังคม', ''), 'SSS');
  assert.equal(inferFundFromBenefitLabel('หลักประกันสุขภาพถ้วนหน้า (บัตรทอง)', ''), 'UCS');
});

test('scoreEclaimDownloadLink ranks Download Statement column above PDF 7119_2 / 7106 on StatementReportWebAction', () => {
  const statementCol = scoreEclaimDownloadLink({
    href: 'javascript:void(0)',
    onclick: "getReportNCH('11101_OP202605_01')",
    label: 'Download',
    colHeader: 'Download Statement',
    linkIndex: 0,
    isStatementReportPage: true,
  });
  const form7119Col = scoreEclaimDownloadLink({
    href: 'javascript:void(0)',
    onclick: "printPdf('7119_2')",
    label: 'Download',
    colHeader: 'Download ใบสรุปค่ารักษาพยาบาล (แบบ 7119_2)',
    linkIndex: 1,
    isStatementReportPage: true,
  });
  const form7106Col = scoreEclaimDownloadLink({
    href: 'javascript:void(0)',
    onclick: "reportPdf('7106')",
    label: 'Download',
    colHeader: 'Download ใบสำคัญรับเงินสวัสดิการ (แบบ 7106)',
    linkIndex: 2,
    isStatementReportPage: true,
  });

  assert.equal(statementCol.isPdf, false);
  assert.equal(form7119Col.isPdf, true);
  assert.equal(form7106Col.isPdf, true);
  assert.ok(statementCol.score > form7119Col.score);
  assert.ok(statementCol.score > form7106Col.score);
});
