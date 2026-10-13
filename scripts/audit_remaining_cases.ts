import fs from 'fs';
import AdmZip from 'adm-zip';

const html = fs.readFileSync('C:/Users/Admin/.gemini/antigravity/brain/ae4aa078-b365-4866-b446-01fa78cace88/.user_uploaded/media_1791791135383_a0a37fec.xls', 'utf8');
const rows = [];
const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
let match;
while ((match = trRegex.exec(html)) !== null) {
  const rowContent = match[1];
  const cells = [];
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
const opd1 = zip1.getEntry('OPD.txt').getData().toString('utf8').trim().split(/\r?\n/).slice(1).map(l => l.split('|')[4]);
const handledVns1 = new Set(opd1);

const zip2 = new AdmZip('d:/fdh_migrade/exports/FDH_EXPORT_UUC2_CODE438_20261013.zip');
const opd2 = zip2.getEntry('OPD.txt').getData().toString('utf8').trim().split(/\r?\n/).slice(1).map(l => l.split('|')[4]);
const handledVns2 = new Set(opd2);

const remaining = data.filter(r => !handledVns1.has(r[15]) && !handledVns2.has(r[15]));
console.log('Original total in XLS:', data.length);
console.log('Handled Batch 1 (301 Dialysis + 179):', handledVns1.size);
console.log('Handled Batch 2 (Code 438):', handledVns2.size);
console.log('Remaining records to fix:', remaining.length);

const errMap = {};
let totalRemainingClaim = 0;
for (const r of remaining) {
  const err = r[16] || 'UNKNOWN';
  const claim = parseFloat((r[12] || '0').replace(/,/g, '')) || 0;
  totalRemainingClaim += claim;
  if (!errMap[err]) errMap[err] = { count: 0, claim: 0 };
  errMap[err].count++;
  errMap[err].claim += claim;
}

console.log('Total Remaining Claim Amount: ' + totalRemainingClaim.toFixed(2) + ' THB');
console.log('\nBreakdown of remaining error codes:');
const sorted = Object.entries(errMap).sort((a,b) => b[1].claim - a[1].claim);
sorted.forEach(([k, v]) => {
  console.log(`- ${k}: ${v.count} records | ${v.claim.toFixed(2)} THB`);
});
