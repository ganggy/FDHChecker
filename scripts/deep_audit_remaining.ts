import fs from 'fs';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import AdmZip from 'adm-zip';
dotenv.config();

async function inspectRemaining() {
  const html = fs.readFileSync('C:/Users/Admin/.gemini/antigravity/brain/ae4aa078-b365-4866-b446-01fa78cace88/.user_uploaded/media_1791791135383_a0a37fec.xls', 'utf8');
  const rows: string[][] = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;
  while ((match = trRegex.exec(html)) !== null) {
    const rowContent = match[1];
    const cells: string[] = [];
    const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = tdRegex.exec(rowContent)) !== null) {
      const text = cellMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      cells.push(text);
    }
    if (cells.length > 0) rows.push(cells);
  }
  const data = rows.slice(1);

  const zip1 = new AdmZip('d:/fdh_migrade/exports/FDH_EXPORT_UUC2_DIALYSIS_AND_179_20261012.zip');
  const handledVns1 = new Set(zip1.getEntry('OPD.txt').getData().toString('utf8').trim().split(/\r?\n/).slice(1).map(l => l.split('|')[4]));

  const zip2 = new AdmZip('d:/fdh_migrade/exports/FDH_EXPORT_UUC2_CODE438_20261013.zip');
  const handledVns2 = new Set(zip2.getEntry('OPD.txt').getData().toString('utf8').trim().split(/\r?\n/).slice(1).map(l => l.split('|')[4]));

  const remaining = data.filter(r => !handledVns1.has(r[15]) && !handledVns2.has(r[15]));
  console.log('Total remaining records to analyze:', remaining.length);

  const conn = await mysql.createConnection({
    host: process.env.HOSXP_HOST || '127.0.0.1',
    port: Number(process.env.HOSXP_PORT) || 3306,
    user: process.env.HOSXP_USER || 'sa',
    password: process.env.HOSXP_PASSWORD || '',
    database: process.env.HOSXP_DB || 'hosxp',
    connectTimeout: 5000
  });

  // 1. Group 514, 515
  const g514 = remaining.filter(r => (r[16] || '').includes('514') || (r[16] || '').includes('515'));
  console.log('\n--- Group 514/515 (Refer):', g514.length, 'records ---');
  const g514Details = [];
  for (const r of g514) {
    const vn = r[15];
    const [ovst]: any = await conn.query('SELECT o.vn, o.hn, o.vstdate, o.pttype, pt.name as ptname, pt.pcode, pt.hipdata_code, o.hospmain FROM ovst o LEFT JOIN pttype pt ON o.pttype = pt.pttype WHERE o.vn = ?', [vn]);
    const [refer]: any = await conn.query('SELECT referout_id, vn, refer_hospcode, refer_cause, refer_point, with_ambulance FROM referout WHERE vn = ?', [vn]);
    const [items]: any = await conn.query('SELECT oo.icode, ni.name, oo.sum_price, ni.nhso_adp_code FROM opitemrece oo LEFT JOIN nondrugitems ni ON oo.icode = ni.icode WHERE oo.vn = ? AND (oo.income IN ("12") OR ni.nhso_adp_code = "S1801" OR ni.name LIKE "%refer%")', [vn]);
    g514Details.push({
      vn,
      claimNo: r[1],
      claimAmt: r[12],
      err: r[16],
      ovst: ovst[0],
      refer: refer[0],
      ambulanceItems: items
    });
  }

  // Count by right
  const g514Rights: Record<string, number> = {};
  g514Details.forEach(d => {
    const key = `${d.ovst?.hipdata_code || d.ovst?.pcode || 'UNKNOWN'} (${d.ovst?.hospmain === '11101' ? 'In-CUP' : 'Out-CUP'})`;
    g514Rights[key] = (g514Rights[key] || 0) + 1;
  });
  console.log('514/515 Rights Breakdown:', g514Rights);
  console.log('Sample 3 514/515:', JSON.stringify(g514Details.slice(0, 3), null, 2));

  // 2. Group 201 (Missing Primary Diag)
  const g201 = remaining.filter(r => (r[16] || '').includes('201'));
  console.log('\n--- Group 201 (Missing PDX):', g201.length, 'records ---');
  const g201Audit = [];
  for (const r of g201) {
    const vn = r[15];
    const [dx]: any = await conn.query('SELECT vn, icd10, diagtype, doctor FROM ovstdiag WHERE vn = ? ORDER BY diagtype', [vn]);
    const [ovst]: any = await conn.query('SELECT vn, hn, vstdate, main_dep FROM ovst WHERE vn = ?', [vn]);
    const [screen]: any = await conn.query('SELECT cc FROM opdscreen WHERE vn = ?', [vn]);
    g201Audit.push({
      vn,
      claimAmt: r[12],
      dxCount: dx.length,
      dxs: dx,
      cc: screen[0]?.cc
    });
  }
  const hasNoDx = g201Audit.filter(a => a.dxCount === 0).length;
  const hasDxNoPdx = g201Audit.filter(a => a.dxCount > 0 && !a.dxs.some((d: any) => d.diagtype === '1')).length;
  const hasPdx = g201Audit.filter(a => a.dxs.some((d: any) => d.diagtype === '1')).length;
  console.log(`201 Diagnosis status: Truly No Diag: ${hasNoDx}, Has Diag but no type 1 (PDX): ${hasDxNoPdx}, Has Diag type 1 already: ${hasPdx}`);
  console.log('Sample 3 201 cases:', JSON.stringify(g201Audit.slice(0, 3), null, 2));

  // 3. Group 232 (Injury PDX lacking external cause)
  const g232 = remaining.filter(r => (r[16] || '').includes('232'));
  console.log('\n--- Group 232 (Injury lack cause):', g232.length, 'records ---');
  const g232Audit = [];
  for (const r of g232) {
    const vn = r[15];
    const [dx]: any = await conn.query('SELECT vn, icd10, diagtype FROM ovstdiag WHERE vn = ? ORDER BY diagtype', [vn]);
    const [er]: any = await conn.query('SELECT er_accident_type_id, accident_transport_type_id, er_emergency_type FROM er_regist WHERE vn = ?', [vn]);
    const [screen]: any = await conn.query('SELECT cc FROM opdscreen WHERE vn = ?', [vn]);
    g232Audit.push({
      vn,
      pdx: dx.find((d: any) => d.diagtype === '1')?.icd10,
      allDx: dx.map((d: any) => `${d.icd10}(${d.diagtype})`),
      er: er[0],
      cc: screen[0]?.cc
    });
  }
  console.log('Sample 4 232 cases:', JSON.stringify(g232Audit.slice(0, 4), null, 2));

  // 4. Other groups (406, 217, 349, etc.)
  const otherCodes = remaining.filter(r => 
    !g514.includes(r) && !g201.includes(r) && !g232.includes(r) &&
    (r[16] !== '301' || parseFloat((r[12]||'0').replace(/,/g, '')) > 0) &&
    r[16] !== '357' && !['236','634','756','239'].some(p => (r[16]||'').includes(p)) &&
    r[16] !== '305'
  );
  console.log('\n--- Other groups (406, 217, 349 etc.):', otherCodes.length, 'records ---');
  const otherBreakdown: Record<string, any[]> = {};
  for (const r of otherCodes) {
    const err = r[16] || 'UNKNOWN';
    if (!otherBreakdown[err]) otherBreakdown[err] = [];
    otherBreakdown[err].push({
      vn: r[15],
      claimNo: r[1],
      claimAmt: r[12],
      err: r[16],
      name: r[4]
    });
  }
  console.log('Other Error Codes:', Object.keys(otherBreakdown));
  for (const [code, items] of Object.entries(otherBreakdown)) {
    console.log(`Code ${code} (${items.length} records): sample VN ${items[0].vn}, Claim: ${items[0].claimAmt}`);
  }

  // 5. Group 301 true 0 baht
  const g301Zero = remaining.filter(r => r[16] === '301' && parseFloat((r[12]||'0').replace(/,/g, '')) === 0);
  console.log('\n--- Group 301 (0 THB):', g301Zero.length, 'records ---');

  await conn.end();
}

inspectRemaining().catch(console.error);
