---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/ipdMonthlyAccounting.ts"
source_hash: "083c10a3f9b642a87f51b607636be0d93fd05ca44c56caa15fa406a5381f3ac1"
managed_by: "sync-ksp-vault"
---
# ipdMonthlyAccounting.ts

> Source: `server/ipdMonthlyAccounting.ts`
> SHA-256: `083c10a3f9b642a87f51b607636be0d93fd05ca44c56caa15fa406a5381f3ac1`

````typescript
import { getUTFConnection } from './db.js';
import { loadPaccountMappings } from './paccountReportMapping.js';

export async function ipdMonthlyAccounting(year: number) {
  if (!Number.isInteger(year) || year < 2500 || year > 2700) throw new Error('ปีงบประมาณไม่ถูกต้อง');
  const start = `${year - 544}-10-01`, end = `${year - 543}-10-01`;
  const c = await getUTFConnection();
  try {
    const [rows] = await c.query(`SELECT DATE_FORMAT(i.dchdate, '%Y-%m') AS month,
      COALESCE(pt.hipdata_code,'') AS payer, COUNT(*) AS discharged,
      SUM(COALESCE(a.admdate,0)) AS days, SUM(COALESCE(i.adjrw,0)) AS weight,
      SUM(COALESCE(a.income,0)) AS charge,
      SUM(CASE WHEN i.adjrw IS NULL THEN 1 ELSE 0 END) AS missing_weight
      FROM ipt i LEFT JOIN an_stat a ON a.an=i.an LEFT JOIN pttype pt ON pt.pttype=i.pttype
      WHERE i.dchdate >= ? AND i.dchdate < ?
      GROUP BY DATE_FORMAT(i.dchdate, '%Y-%m'), pt.hipdata_code`, [start,end]);
    const [admissions] = await c.query(`SELECT DATE_FORMAT(regdate, '%Y-%m') AS month, COUNT(*) AS admitted
      FROM ipt WHERE regdate >= ? AND regdate < ? GROUP BY DATE_FORMAT(regdate, '%Y-%m')`, [start,end]);
    const mapping=await loadPaccountMappings(c,'ipd',year);
    return {year, rows, admissions, accountMappings:[...mapping.result.values()], mappingIssues:mapping.issues};
  } finally { c.release(); }
}

````
