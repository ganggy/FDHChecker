import fs from 'fs';

let file = fs.readFileSync('server/repositories/claims.repository.ts', 'utf8');

// 1. Replace the SQL joins in OPD query
const target1 = `      LEFT JOIN referin ri ON ri.vn = o.vn\r
      LEFT JOIN referout ro ON ro.vn = o.vn\r
      LEFT JOIN er_regist er ON er.vn = o.vn\r
      LEFT JOIN er_pt_type ept ON ept.er_pt_type = er.er_pt_type`;

const replacement1 = `      LEFT JOIN (SELECT DISTINCT vn FROM referin) ri ON ri.vn = o.vn\r
      LEFT JOIN (SELECT DISTINCT vn FROM referout) ro ON ro.vn = o.vn\r
      LEFT JOIN (SELECT vn, MAX(er_pt_type) AS er_pt_type FROM er_regist GROUP BY vn) er ON er.vn = o.vn\r
      LEFT JOIN er_pt_type ept ON ept.er_pt_type = er.er_pt_type`;

if (file.includes(target1)) {
  file = file.replace(target1, replacement1);
  console.log('1. Updated SQL join for OPD query.');
} else {
  const t1LF = target1.replace(/\r\n/g, '\n');
  const r1LF = replacement1.replace(/\r\n/g, '\n');
  if (file.includes(t1LF)) {
    file = file.replace(t1LF, r1LF);
    console.log('1. Updated SQL join for OPD query (LF).');
  } else {
    console.error('Failed to find target1');
  }
}

// 2. Add deduplication by SEQ in normalizedOpd
const target2 = `    const seenSameDayHn = new Set<string>();\r
    const normalizedOpd = (opd as Record<string, unknown>[]).map((row) => {`;

const replacement2 = `    const seenSameDayHn = new Set<string>();\r
    const seenOpdSeqs = new Set<string>();\r
    const uniqueOpd = (opd as Record<string, unknown>[]).filter((row) => {\r
      const seq = String(row.SEQ || '').trim();\r
      if (!seq || seenOpdSeqs.has(seq)) return false;\r
      seenOpdSeqs.add(seq);\r
      return true;\r
    });\r
    const normalizedOpd = uniqueOpd.map((row) => {`;

if (file.includes(target2)) {
  file = file.replace(target2, replacement2);
  console.log('2. Added SEQ deduplication in normalizedOpd.');
} else {
  const t2LF = target2.replace(/\r\n/g, '\n');
  const r2LF = replacement2.replace(/\r\n/g, '\n');
  if (file.includes(t2LF)) {
    file = file.replace(t2LF, r2LF);
    console.log('2. Added SEQ deduplication in normalizedOpd (LF).');
  } else {
    console.error('Failed to find target2');
  }
}

fs.writeFileSync('server/repositories/claims.repository.ts', file, 'utf8');
console.log('Done updating server/repositories/claims.repository.ts');
