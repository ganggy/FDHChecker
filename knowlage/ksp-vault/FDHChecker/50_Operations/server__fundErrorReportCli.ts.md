---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "operations"
source: "server/fundErrorReportCli.ts"
source_hash: "ba921daaaa10bc24cfa964549281072d4e7d3bf27e570de70902333d2a883b46"
managed_by: "sync-ksp-vault"
---
# fundErrorReportCli.ts

> Source: `server/fundErrorReportCli.ts`
> SHA-256: `ba921daaaa10bc24cfa964549281072d4e7d3bf27e570de70902333d2a883b46`

````typescript
import 'dotenv/config';
import { queryFundErrorReport, sendDailyFundErrorReportToLine } from './fundErrorReport.js';

const bangkokDate = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const startDate = process.argv[2] || bangkokDate();
const endDate = process.argv[3] || startDate;

console.log(`Querying fund errors ${startDate} to ${endDate}...`);
const sections = await queryFundErrorReport(startDate, endDate, (current, total, fund) => {
  console.log(`[${current}/${total}] ${fund.name}`);
});
if (startDate !== endDate) {
  throw new Error('รายงาน LINE รองรับข้อมูลภายในวันเดียวเท่านั้น');
}
const messageCount = await sendDailyFundErrorReportToLine(sections, startDate);
const totalErrors = sections.reduce((sum, section) => sum + section.errors.length, 0);
const queryFailures = sections.filter((section) => section.queryError).length;
console.log(`LINE sent: ${messageCount} message(s), ${totalErrors} error row(s), ${queryFailures} query failure(s).`);
process.exit(queryFailures > 0 ? 2 : 0);

````
