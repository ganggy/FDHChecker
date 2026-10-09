import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import xlsxPkg from 'xlsx';
import { parseFlexibleDateTime } from './utils/dataNormalization.js';

const XLSX = (xlsxPkg as unknown as { default?: typeof xlsxPkg }).default || xlsxPkg;

test('parseFlexibleDateTime parses full Thai Buddhist era dates with time', () => {
  const result = parseFlexibleDateTime('วันที่ 23 กันยายน 2569 เวลา 20:04 น.');
  assert.equal(result, '2026-09-23 20:04:00');

  const resultShort = parseFlexibleDateTime('23 ก.ย. 2569 20:04:15');
  assert.equal(resultShort, '2026-09-23 20:04:15');

  const resultStandard = parseFlexibleDateTime('2026-09-23 20:04:00');
  assert.equal(resultStandard, '2026-09-23 20:04:00');
});

test('parses FDH individual 16-file export accurately', () => {
  const filePath = 'C:/Users/Admin/.gemini/antigravity/brain/ae4aa078-b365-4866-b446-01fa78cace88/.user_uploaded/media_1791515916328_538f92c1.xlsx';
  const buffer = fs.readFileSync(filePath);
  const wb = XLSX.read(buffer, { type: 'buffer' });
  assert.ok(wb.SheetNames.length > 0);

  const sheet = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false });

  const normalizeCell = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

  const isHeaderRow = (row: unknown[]) => {
    const text = row.map(normalizeCell).join('|');
    const format1Signals = ['รหัสการเคลม', 'HN', 'รหัสบริการ (SEQ)', 'รหัสผู้ป่วยใน (AN)', 'ประเภทผู้ป่วย', 'สถานะรายการเคลม'];
    if (format1Signals.filter((signal) => text.includes(signal)).length >= 4) return true;
    const format2Signals = ['HN', 'AN', 'SEQ', 'ประเภทผู้ป่วย', 'ผ่าน / ไม่ผ่าน', 'สถานะรายการเคลม'];
    if (format2Signals.filter((signal) => text.includes(signal)).length >= 4) return true;
    return false;
  };

  const headerIndex = grid.findIndex((r) => Array.isArray(r) && isHeaderRow(r));
  assert.equal(headerIndex, 10);

  const metadata: {
    title?: string;
    sentAtText?: string;
    sentAt?: string;
    hcode?: string;
    hname?: string;
    importedBy?: string;
  } = {};

  for (let i = 0; i < headerIndex; i++) {
    const row = grid[i];
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      const cellStr = normalizeCell(cell);
      if (!cellStr) continue;
      if (cellStr.includes('รายละเอียดการนำเข้า 16 แฟ้ม')) {
        metadata.title = cellStr;
      }
      const dateMatch = cellStr.match(/วันเวลาส่งข้อมูล\s*:\s*(.+)/);
      if (dateMatch) {
        metadata.sentAtText = dateMatch[1].trim();
        const parsedDate = parseFlexibleDateTime(metadata.sentAtText);
        if (parsedDate) metadata.sentAt = parsedDate;
      }
      const hospMatch = cellStr.match(/หน่วยบริการ\s*:\s*(\d+)\s*(?:-\s*(.+))?/);
      if (hospMatch) {
        metadata.hcode = hospMatch[1].trim();
        if (hospMatch[2]) metadata.hname = hospMatch[2].trim();
      }
      const senderMatch = cellStr.match(/ชื่อผู้ส่ง\s*:\s*(.+)/);
      if (senderMatch) {
        metadata.importedBy = senderMatch[1].trim();
      }
    }
  }

  assert.equal(metadata.sentAt, '2026-09-23 20:04:00');
  assert.equal(metadata.hcode, '11101');
  assert.equal(metadata.importedBy, 'เปรมศักดิ์ เทพวงสา');

  const rawHeaders = grid[headerIndex].map(normalizeCell);
  const activeIndexes = rawHeaders.map((header, index) => ({ header, index })).filter(({ header }) => header);

  const rows = grid
    .slice(headerIndex + 1)
    .filter((row) => Array.isArray(row) && row.some((cell) => normalizeCell(cell)))
    .map((row) => {
      const obj = Object.fromEntries(activeIndexes.map(({ header, index }) => [header, normalizeCell(row[index])]));
      const hn = obj['HN'];
      const seq = obj['SEQ'];
      const an = obj['AN'];
      const pType = obj['ประเภทผู้ป่วย'] || 'OP';
      const passFail = obj['ผ่าน / ไม่ผ่าน'];
      const rawStatus = obj['สถานะรายการเคลม'];
      const oldStatus = obj['สถานะเดิม'];

      if (passFail) {
        const combinedStatus = `${passFail} - ${rawStatus}${oldStatus ? ` (${oldStatus})` : ''}`;
        obj['สถานะรายการเคลม'] = combinedStatus;
        obj['claim_status'] = combinedStatus;
      }
      if (!obj['รหัสบริการ (SEQ)'] && seq) {
        obj['รหัสบริการ (SEQ)'] = seq;
      }
      if (!obj['รหัสผู้ป่วยใน (AN)']) {
        obj['รหัสผู้ป่วยใน (AN)'] = (pType === 'OP' && an === seq) ? '' : an;
      }
      if (!obj['รหัสการเคลม']) {
        obj['รหัสการเคลม'] = `${pType}-${seq || an || hn}`;
      }
      if (metadata.sentAt) {
        obj['sent_at'] = metadata.sentAt;
      }
      return obj;
    });

  assert.equal(rows.length, 65);
  const passRows = rows.filter((r) => r['ผ่าน / ไม่ผ่าน'] === 'ผ่าน');
  const failRows = rows.filter((r) => r['ผ่าน / ไม่ผ่าน'] === 'ไม่ผ่าน');
  assert.equal(passRows.length, 63);
  assert.equal(failRows.length, 2);

  // Check fail rows
  assert.equal(failRows[0]['claim_status'], 'ไม่ผ่าน - เคยส่งแล้ว (รับข้อมูลรอประมวลผล)');
  assert.equal(failRows[0]['HN'], '000095086');
  assert.equal(failRows[0]['SEQ'], '690922000058');

  assert.equal(failRows[1]['claim_status'], 'ไม่ผ่าน - เคยส่งแล้ว (ประมวลผลผ่าน)');
  assert.equal(failRows[1]['HN'], '000070850');
  assert.equal(failRows[1]['SEQ'], '690919103116');
});
