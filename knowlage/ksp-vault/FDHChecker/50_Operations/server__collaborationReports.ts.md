---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "operations"
source: "server/collaborationReports.ts"
source_hash: "330411852558998c907646f365d4cb4d364dd3f64feab2a49b9f7f12ffeb1380"
managed_by: "sync-ksp-vault"
---
# collaborationReports.ts

> Source: `server/collaborationReports.ts`
> SHA-256: `330411852558998c907646f365d4cb4d364dd3f64feab2a49b9f7f12ffeb1380`

````typescript
import {
  buildDailyFundLineMessages,
  isLineAlertExcludedFund,
  queryFundErrorReport,
  type FundErrorSection,
} from './fundErrorReport.js';
import {
  buildDailyWorkOverviewMessages,
  getBangkokDateTime,
  queryDailyWorkOverview,
} from './dailyWorkOverview.js';
import { publishCollaborationBotMessages } from './collaboration.js';

const FUND_BOT_NAME = () => String(process.env.LINE_FUND_BOT_DISPLAY_NAME || 'พี่นกหมายเลขสอง').trim();
const OVERVIEW_BOT_NAME = () => String(process.env.LINE_OVERVIEW_BOT_DISPLAY_NAME || 'พี่นุชหมายเลขสอง').trim();
const CACHE_TTL_MS = 15 * 60 * 1000;

let fundCache: { reportDate: string; loadedAt: number; sections: FundErrorSection[] } | null = null;
let fundQuery: Promise<FundErrorSection[]> | null = null;

export const getTodayFundErrorSections = async (force = false) => {
  const reportDate = getBangkokDateTime().date;
  const cacheFresh = fundCache?.reportDate === reportDate && Date.now() - fundCache.loadedAt < CACHE_TTL_MS;
  if (!force && cacheFresh) return { reportDate, sections: fundCache!.sections };
  if (!fundQuery) {
    fundQuery = queryFundErrorReport(reportDate, reportDate)
      .then((sections) => {
        fundCache = { reportDate, loadedAt: Date.now(), sections };
        return sections;
      })
      .finally(() => { fundQuery = null; });
  }
  return { reportDate, sections: await fundQuery };
};

export const buildSpecialFundIssues = (sections: FundErrorSection[], reportDate: string) => sections
  .filter((section) => !isLineAlertExcludedFund(section.id))
  .flatMap((section) => section.errors.map((error, index) => ({
    issue_id: `special-fund-${section.id}-${error.hn}-${error.serviceDate}-${index}`,
    source: 'special_fund' as const,
    hn: error.hn,
    fund: section.name,
    service_date: error.serviceDate || reportDate,
    status: 'special_fund_error',
    notes: error.missing.some((item) => item.startsWith('ติด C:'))
      ? error.missing.join(', ')
      : `ขาด ${error.missing.join(', ')}`,
    severity: 'urgent' as const,
    updated_at: new Date().toISOString(),
  })));

export const appendTodaySpecialFundIssues = async <T extends {
  summary: Record<string, number>;
  issues: unknown[];
}>(overview: T, limit = 60) => {
  const { reportDate, sections } = await getTodayFundErrorSections();
  const specialIssues = buildSpecialFundIssues(sections, reportDate);
  return {
    ...overview,
    summary: {
      ...overview.summary,
      total: Number(overview.summary.total || 0) + specialIssues.length,
      needs_fix: Number(overview.summary.needs_fix || 0) + specialIssues.length,
      urgent: Number(overview.summary.urgent || 0) + specialIssues.length,
      special_fund_issues: specialIssues.length,
    },
    issues: [...specialIssues, ...overview.issues].slice(0, limit),
  };
};

export const syncTodayLineBotMessages = async () => {
  const reportDate = getBangkokDateTime().date;
  const [fundResult, dailyOverview] = await Promise.all([
    getTodayFundErrorSections(true),
    queryDailyWorkOverview(reportDate),
  ]);
  const [fundPublish, overviewPublish] = await Promise.all([
    publishCollaborationBotMessages({
      botKey: 'fund-errors', senderName: FUND_BOT_NAME(), reportDate,
      messages: buildDailyFundLineMessages(fundResult.sections, reportDate),
      metadata: { reportType: 'special_fund' },
    }),
    publishCollaborationBotMessages({
      botKey: 'daily-overview', senderName: OVERVIEW_BOT_NAME(), reportDate,
      messages: buildDailyWorkOverviewMessages(dailyOverview),
      metadata: { reportType: 'daily_overview' },
    }),
  ]);
  return { created: fundPublish.created + overviewPublish.created, room_id: fundPublish.room_id };
};

````
