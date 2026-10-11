---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "operations"
source: "server/dailyWorkOverviewCli.ts"
source_hash: "6811178c5899de0c40b9dd20ae1211dbf275ace321b0898fd6f1fa3e518f71fa"
managed_by: "sync-ksp-vault"
---
# dailyWorkOverviewCli.ts

> Source: `server/dailyWorkOverviewCli.ts`
> SHA-256: `6811178c5899de0c40b9dd20ae1211dbf275ace321b0898fd6f1fa3e518f71fa`

````typescript
import 'dotenv/config';
import {
  buildDailyWorkOverviewMessages,
  getBangkokDateTime,
  getLastDailyWorkOverviewDate,
  markDailyWorkOverviewSent,
  queryDailyWorkOverview,
  sendDailyWorkOverviewToLine,
  shouldSendDailyWorkOverview,
} from './dailyWorkOverview.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const scheduled = args.includes('--scheduled');
const dateArg = args.find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg));
const clock = getBangkokDateTime();
const reportDate = dateArg || clock.date;

if (scheduled) {
  const configuredTime = String(process.env.LINE_OVERVIEW_REPORT_TIME || '15:00').trim();
  const lastSentDate = await getLastDailyWorkOverviewDate();
  if (!shouldSendDailyWorkOverview(configuredTime, clock, lastSentDate)) {
    console.log(`Skipped daily work overview: configured=${configuredTime}, now=${clock.time}, last=${lastSentDate || '-'}`);
    process.exit(0);
  }
}

console.log(`Querying daily work overview for ${reportDate}...`);
const overview = await queryDailyWorkOverview(reportDate);

if (dryRun) {
  console.log(buildDailyWorkOverviewMessages(overview).join('\n\n---\n\n'));
  process.exit(0);
}

const messageCount = await sendDailyWorkOverviewToLine(overview);
if (scheduled) await markDailyWorkOverviewSent(reportDate);
console.log(`Daily work overview sent: ${messageCount} message(s), affected visits=${overview.affectedVisits}.`);
process.exit(0);

````
