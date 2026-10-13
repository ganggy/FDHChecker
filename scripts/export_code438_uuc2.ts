import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import dotenv from 'dotenv';
dotenv.config();

import { getExportData } from '../server/repositories/claims.repository.js';
import { buildFdhFiles, scopeFdhData } from '../server/fdhExport.js';

async function main() {
  console.log('--- Starting Export for Error Code 438 (UUC = 2) ---');

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
      const text = cellMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      cells.push(text);
    }
    if (cells.length > 0) rows.push(cells);
  }

  const data = rows.slice(1);
  const code438Rows = data.filter(r => r[16] === '438' || r[16].includes('438'));
  console.log(`Found ${code438Rows.length} rows for Error Code 438 in e-Claim XLS.`);

  const vns = [...new Set(code438Rows.map(r => r[15]).filter(Boolean))];
  console.log(`Unique VNs: ${vns.length}`);

  const uucByVn: Record<string, string> = {};
  for (const vn of vns) {
    uucByVn[vn] = '2';
  }

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

  const opdRows = (scopedData.OPD || []) as Array<Record<string, unknown>>;
  console.log(`Exported OPD rows: ${opdRows.length}`);

  const uuc2Count = opdRows.filter(r => String(r.UUC || '') === '2').length;
  const otherUucCount = opdRows.filter(r => String(r.UUC || '') !== '2').length;
  console.log(`OPD UUC Breakdown -> UUC=2: ${uuc2Count}, Other UUC: ${otherUucCount}`);

  if (otherUucCount > 0) {
    console.warn(`WARNING: Found ${otherUucCount} rows with UUC !== '2'! Fixing in-memory before packaging...`);
    for (const r of opdRows) {
      r.UUC = '2';
    }
  }

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

  const outPath1 = 'C:/Users/Admin/Downloads/FDH_EXPORT_UUC2_CODE438_20261013.zip';
  const outPath2 = 'd:/fdh_migrade/exports/FDH_EXPORT_UUC2_CODE438_20261013.zip';

  fs.writeFileSync(outPath1, zipBuffer);
  console.log(`\nSuccessfully saved ZIP to: ${outPath1}`);

  fs.writeFileSync(outPath2, zipBuffer);
  console.log(`Successfully saved ZIP to: ${outPath2}`);

  console.log('\n--- 16-File Export for Code 438 Completed Successfully! ---');
}

main().catch(err => {
  console.error('Export Error:', err);
  process.exit(1);
});
