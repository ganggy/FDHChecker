import fs from 'fs';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import AdmZip from 'adm-zip';
dotenv.config();

import { getExportData } from '../server/repositories/claims.repository.js';
import { buildFdhFiles, scopeFdhData } from '../server/fdhExport.js';

async function exportBatch3() {
  console.log('--- Starting Final Batch 3 Export (Remaining 410 cases) ---');

  const xlsPath = 'C:/Users/Admin/.gemini/antigravity/brain/ae4aa078-b365-4866-b446-01fa78cace88/.user_uploaded/media_1791791135383_a0a37fec.xls';
  const html = fs.readFileSync(xlsPath, 'utf8');

  const rows: string[][] = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match: RegExpExecArray | null;
  while ((match = trRegex.exec(html)) !== null) {
    const rowContent = match[1];
    const cells: string[] = [];
    const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = tdRegex.exec(rowContent)) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());
    }
    if (cells.length > 0) rows.push(cells);
  }
  const data = rows.slice(1);

  const zip1 = new AdmZip('d:/fdh_migrade/exports/FDH_EXPORT_UUC2_DIALYSIS_AND_179_20261012.zip');
  const handled1 = new Set(zip1.getEntry('OPD.txt')!.getData().toString('utf8').trim().split(/\r?\n/).slice(1).map(l => l.split('|')[4]));

  const zip2 = new AdmZip('d:/fdh_migrade/exports/FDH_EXPORT_UUC2_CODE438_20261013.zip');
  const handled2 = new Set(zip2.getEntry('OPD.txt')!.getData().toString('utf8').trim().split(/\r?\n/).slice(1).map(l => l.split('|')[4]));

  const remaining = data.filter(r => !handled1.has(r[15]) && !handled2.has(r[15]));
  console.log(`Remaining cases to process: ${remaining.length}`);

  const vns = [...new Set(remaining.map(r => r[15]).filter(Boolean))];
  console.log(`Unique VNs: ${vns.length}`);

  const conn = await mysql.createConnection({
    host: process.env.HOSXP_HOST || '127.0.0.1',
    port: Number(process.env.HOSXP_PORT) || 3306,
    user: process.env.HOSXP_USER || 'sa',
    password: process.env.HOSXP_PASSWORD || '',
    database: process.env.HOSXP_DB || 'hosxp',
    connectTimeout: 5000
  });

  // 1. Identify 201 cases with PDX vs without PDX
  const [dxRows]: any = await conn.query('SELECT vn, icd10, diagtype FROM ovstdiag WHERE vn IN (?)', [vns]);
  const dxMap = new Map<string, any[]>();
  for (const d of dxRows) {
    if (!dxMap.has(d.vn)) dxMap.set(d.vn, []);
    dxMap.get(d.vn)!.push(d);
  }

  // 2. Identify 514/515 cases
  const [ovstRows]: any = await conn.query('SELECT vn, hn, pttype, hospmain FROM ovst WHERE vn IN (?)', [vns]);
  const ovstMap = new Map<string, any>(ovstRows.map((o: any) => [o.vn, o]));

  // Injury causes mapping for group 232
  const injuryCauseMapping: Record<string, string> = {
    '691009000164': 'W19', // เท้าพลิก
    '691008000220': 'W19', // ข้อเท้า
    '691003140837': 'W19', // ปวดหักเดิม
    '691002000112': 'W22', // เดินบิณฑบาต
    '691002000153': 'X59', // T780
    '681104000070': 'W21', // ฟุตบอล
    '681119091822': 'X59', // T059
    '681127000043': 'W19', // ข้อเท้าขวา
    '681217000168': 'W22', // วิ่งชนไม้
    '681215154037': 'W22', // เตะน็อต
    '681212000190': 'W19', // เท้าพลิก
    '691005000138': 'M2559', // ข้อ
    '681008000158': 'Z480', // ล้างแผล
  };

  // Classify each VN to UUC = '1' or '2'
  const uucByVn: Record<string, string> = {};
  const claimableVns = new Set<string>();

  for (const r of remaining) {
    const vn = r[15];
    const err = r[16] || '';
    const ov = ovstMap.get(vn);
    const dxList = dxMap.get(vn) || [];
    const hasPdx = dxList.some(d => d.diagtype === '1');

    if (err.includes('232')) {
      // Injury: claimable
      uucByVn[vn] = '1';
      claimableVns.add(vn);
    } else if (err.includes('514') || err.includes('515')) {
      // Refer: if out-cup -> 1, if in-cup -> 2
      if (ov?.hospmain !== '11101') {
        uucByVn[vn] = '1';
        claimableVns.add(vn);
      } else {
        uucByVn[vn] = '2';
      }
    } else if (err.includes('201')) {
      if (hasPdx) {
        uucByVn[vn] = '1';
        claimableVns.add(vn);
      } else {
        uucByVn[vn] = '2';
      }
    } else {
      // 301, 357, PPA, others -> 2
      uucByVn[vn] = '2';
    }
  }

  const uuc1Count = Object.values(uucByVn).filter(u => u === '1').length;
  const uuc2Count = Object.values(uucByVn).filter(u => u === '2').length;
  console.log(`UUC Plan -> UUC=1 (Claim): ${uuc1Count}, UUC=2 (Service stat/Clear C): ${uuc2Count}`);

  console.log('Querying 16-file export data from HOSxP...');
  const exportData = await getExportData(vns, {
    uucByVn,
    patientType: 'OPD',
    profile: 'standard',
  });

  if (!exportData) {
    throw new Error('Failed to fetch export data from HOSxP!');
  }

  const scopedData = scopeFdhData(exportData, 'OPD');

  // --- Adjust ODX: inject missing external causes for 232 cases ---
  const odxRows = (scopedData.ODX || []) as Array<Record<string, unknown>>;
  for (const [injVn, causeCode] of Object.entries(injuryCauseMapping)) {
    if (!vns.includes(injVn)) continue;
    // Check if this vn already has a V/W/X/Y cause in ODX
    const existingCause = odxRows.find(o => String(o.SEQ || '') === injVn && /^[VWXY]/.test(String(o.DIAG || '')));
    if (!existingCause && /^[VWXY]/.test(causeCode)) {
      const sampleOdx = odxRows.find(o => String(o.SEQ || '') === injVn);
      if (sampleOdx) {
        odxRows.push({
          ...sampleOdx,
          DIAG: causeCode,
          DXTYPE: '5',
        });
        console.log(`Injected external cause ${causeCode} (DXTYPE 5) for VN ${injVn}`);
      }
    }
  }

  // --- Adjust ORF: ensure destination hospital is 10710 and REFERTYPE is '1' for Out-CUP refer ---
  const orfRows = (scopedData.ORF || []) as Array<Record<string, unknown>>;
  for (const r of orfRows) {
    const vn = String(r.SEQ || '');
    const ov = ovstMap.get(vn);
    if (ov && ov.hospmain !== '11101') {
      r.REFER = '10710';
      r.REFERTYPE = '1';
    }
  }

  // Double check OPD UUC
  const opdRows = (scopedData.OPD || []) as Array<Record<string, unknown>>;
  console.log(`Exported OPD rows: ${opdRows.length}`);
  for (const r of opdRows) {
    const seq = String(r.SEQ || '');
    if (uucByVn[seq]) {
      r.UUC = uucByVn[seq];
    }
  }

  const finalUuc1 = opdRows.filter(r => String(r.UUC) === '1').length;
  const finalUuc2 = opdRows.filter(r => String(r.UUC) === '2').length;
  console.log(`Final OPD Breakdown -> UUC=1: ${finalUuc1}, UUC=2: ${finalUuc2}`);

  console.log('Building 16 text files...');
  const encoding = process.env.FDH_EXPORT_ENCODING || 'utf8';
  const files = buildFdhFiles(scopedData, 'standard', true, encoding);

  const zip = new AdmZip();
  console.log('\n--- Exported Files Summary ---');
  for (const file of files) {
    zip.addFile(file.filename, file.content);
    console.log(`- ${file.filename}: ${file.rowCount} rows (${(file.content.length / 1024).toFixed(1)} KB)`);
  }

  const zipBuffer = zip.toBuffer();

  const outPath1 = 'C:/Users/Admin/Downloads/FDH_EXPORT_REMAINING_410_CASES_20261013.zip';
  const outPath2 = 'd:/fdh_migrade/exports/FDH_EXPORT_REMAINING_410_CASES_20261013.zip';

  fs.writeFileSync(outPath1, zipBuffer);
  console.log(`\nSuccessfully saved ZIP to: ${outPath1}`);

  fs.writeFileSync(outPath2, zipBuffer);
  console.log(`Successfully saved ZIP to: ${outPath2}`);

  console.log('\n--- Final Batch 3 Export Completed Successfully! ---');
  await conn.end();
}

exportBatch3().catch(err => {
  console.error('Batch 3 Export Error:', err);
  process.exit(1);
});
