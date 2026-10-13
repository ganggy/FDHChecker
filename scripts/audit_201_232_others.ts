import fs from 'fs';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import AdmZip from 'adm-zip';
dotenv.config();

async function checkAll() {
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
  const handled1 = new Set(zip1.getEntry('OPD.txt').getData().toString('utf8').trim().split(/\r?\n/).slice(1).map(l => l.split('|')[4]));
  const zip2 = new AdmZip('d:/fdh_migrade/exports/FDH_EXPORT_UUC2_CODE438_20261013.zip');
  const handled2 = new Set(zip2.getEntry('OPD.txt').getData().toString('utf8').trim().split(/\r?\n/).slice(1).map(l => l.split('|')[4]));
  
  const remaining = data.filter(r => !handled1.has(r[15]) && !handled2.has(r[15]));

  const conn = await mysql.createConnection({
    host: process.env.HOSXP_HOST || '127.0.0.1',
    port: Number(process.env.HOSXP_PORT) || 3306,
    user: process.env.HOSXP_USER || 'sa',
    password: process.env.HOSXP_PASSWORD || '',
    database: process.env.HOSXP_DB || 'hosxp',
  });

  // --- 1. Audit 201 (Missing Primary Diag) ---
  console.log('=== AUDIT GROUP 201 ===');
  const g201 = remaining.filter(r => (r[16]||'').includes('201'));
  const vns201 = g201.map(r => r[15]);
  const [allDxs]: any = await conn.query('SELECT vn, icd10, diagtype, doctor FROM ovstdiag WHERE vn IN (?) ORDER BY diagtype', [vns201]);
  const dxMap = new Map();
  for (const d of allDxs) {
    if (!dxMap.has(d.vn)) dxMap.set(d.vn, []);
    dxMap.get(d.vn).push(d);
  }

  const noDx201: any[] = [];
  const hasPdx201: any[] = [];
  for (const r of g201) {
    const vn = r[15];
    const dxList = dxMap.get(vn) || [];
    const pdx = dxList.find((d: any) => d.diagtype === '1');
    if (!pdx) {
      const [ovst]: any = await conn.query('SELECT o.vn, o.hn, o.vstdate, o.main_dep, o.pttype, pt.name as ptname FROM ovst o LEFT JOIN pttype pt ON o.pttype = pt.pttype WHERE o.vn = ?', [vn]);
      const [screen]: any = await conn.query('SELECT cc, temperature, bps, bpd FROM opdscreen WHERE vn = ?', [vn]);
      const [items]: any = await conn.query('SELECT COALESCE(d.name, ni.name) as name, oo.sum_price FROM opitemrece oo LEFT JOIN drugitems d ON oo.icode = d.icode LEFT JOIN nondrugitems ni ON oo.icode = ni.icode WHERE oo.vn = ? LIMIT 5', [vn]);
      noDx201.push({
        vn,
        claimAmt: r[12],
        ovst: ovst[0],
        cc: screen[0]?.cc,
        sampleItems: items
      });
    } else {
      hasPdx201.push({ vn, pdx: pdx.icd10, claimAmt: r[12] });
    }
  }

  console.log(`Total 201: ${g201.length}`);
  console.log(`- มีรหัส PDX อยู่แล้วใน HOSxP ปัจจุบัน: ${hasPdx201.length} เคส`);
  console.log(`- ไม่มี Diag ใดๆ ใน HOSxP เลยจริงๆ: ${noDx201.length} เคส`);
  noDx201.forEach((item, idx) => {
    console.log(`  ${idx+1}. VN: ${item.vn} | Claim: ${item.claimAmt}฿ | แผนก: ${item.ovst?.main_dep} | สิทธิ: ${item.ovst?.ptname}`);
    console.log(`     CC: ${(item.cc || 'ไม่มีบันทึกอาการสำคัญ').trim().replace(/\r?\n/g, ' ')}`);
    console.log(`     รายการค่ารักษา: ${item.sampleItems.map((i: any) => i.name).join(', ')}`);
  });

  // --- 2. Audit 232 (Injury lack external cause) ---
  console.log('\n=== AUDIT GROUP 232 ===');
  const g232 = remaining.filter(r => (r[16]||'').includes('232'));
  const vns232 = g232.map(r => r[15]);
  const [allDxs232]: any = await conn.query('SELECT vn, icd10, diagtype FROM ovstdiag WHERE vn IN (?) ORDER BY diagtype', [vns232]);
  const dxMap232 = new Map();
  for (const d of allDxs232) {
    if (!dxMap232.has(d.vn)) dxMap232.set(d.vn, []);
    dxMap232.get(d.vn).push(d);
  }

  for (const r of g232) {
    const vn = r[15];
    const dxList = dxMap232.get(vn) || [];
    const pdx = dxList.find((d: any) => d.diagtype === '1')?.icd10;
    const [screen]: any = await conn.query('SELECT cc, hpi FROM opdscreen WHERE vn = ?', [vn]);
    const [ovst]: any = await conn.query('SELECT o.vstdate, pt.name as ptname FROM ovst o LEFT JOIN pttype pt ON o.pttype = pt.pttype WHERE o.vn = ?', [vn]);
    console.log(`- VN: ${vn} | PDX: ${pdx} | AllDx: ${dxList.map((d: any) => `${d.icd10}(${d.diagtype})`).join(',')} | Claim: ${r[12]}฿`);
    console.log(`  CC: ${(screen[0]?.cc || '').trim().replace(/\r?\n/g, ' ')} | HPI: ${(screen[0]?.hpi || '').trim().replace(/\r?\n/g, ' ')}`);
  }

  // --- 3. Audit Other Groups (406, 217, 349 etc.) ---
  console.log('\n=== AUDIT OTHER GROUPS ===');
  const handledErrors = new Set(['357', '514', '515', '305', '201', '232', '301', '236', '634', '756', '239']);
  const others = remaining.filter(r => {
    const errs = (r[16] || '').split(',').map(s => s.trim());
    return errs.some(e => !handledErrors.has(e));
  });

  console.log(`Total other records: ${others.length}`);
  const errGroups: Record<string, any[]> = {};
  for (const r of others) {
    const err = r[16];
    if (!errGroups[err]) errGroups[err] = [];
    errGroups[err].push(r);
  }

  for (const [err, recs] of Object.entries(errGroups)) {
    console.log(`\nError Code: ${err} (${recs.length} records)`);
    for (const r of recs.slice(0, 2)) {
      const vn = r[15];
      const [ovst]: any = await conn.query('SELECT o.vn, o.hn, o.pttype, pt.name as ptname, pt.hipdata_code FROM ovst o LEFT JOIN pttype pt ON o.pttype = pt.pttype WHERE o.vn = ?', [vn]);
      const [items]: any = await conn.query('SELECT COALESCE(d.name, ni.name) as name, oo.sum_price, oo.paidst, ni.nhso_adp_code FROM opitemrece oo LEFT JOIN drugitems d ON oo.icode = d.icode LEFT JOIN nondrugitems ni ON oo.icode = ni.icode WHERE oo.vn = ? LIMIT 5', [vn]);
      const [dxs]: any = await conn.query('SELECT icd10, diagtype FROM ovstdiag WHERE vn = ?', [vn]);
      console.log(`  VN: ${vn} | Claim: ${r[12]}฿ | Name: ${r[4]} | Right: ${ovst[0]?.ptname}`);
      console.log(`  Dx: ${dxs.map((d: any) => `${d.icd10}(${d.diagtype})`).join(', ')}`);
      console.log(`  Items: ${items.map((i: any) => `${i.name}(${i.sum_price}฿, adp:${i.nhso_adp_code||'-'})`).join(', ')}`);
    }
  }

  await conn.end();
}

checkAll().catch(console.error);
