import { ensureNhsoClosePrivilegeTable, getAppSetting, getUTFConnection, setAppSetting } from './db.js';
import { pushLineMessages, type LineMessage } from './lineMessaging.js';

export type DailyWorkVisit = {
  vn: string;
  hn: string;
  serviceDate: string;
  pttype: string;
  hipdataCode: string;
  diagCount: number;
  mainDiagCount: number;
  chargeCount: number;
  totalCharge: number;
  hasCloseCode: boolean;
  closeStatus: string;
};

export type DailyWorkCategoryId =
  | 'close_error'
  | 'pending_close'
  | 'missing_diag'
  | 'missing_main_diag'
  | 'missing_charge'
  | 'zero_charge'
  | 'missing_right';

export type DailyWorkCategory = {
  id: DailyWorkCategoryId;
  label: string;
  severity: 'error' | 'warning';
  visits: DailyWorkVisit[];
};

export type DailyWorkOverview = {
  reportDate: string;
  totalVisits: number;
  totalPatients: number;
  affectedVisits: number;
  affectedPatients: number;
  categories: DailyWorkCategory[];
};

const OVERVIEW_STATE_KEY = 'line_daily_work_overview_state';
const num = (value: unknown) => Number(value || 0);
const text = (value: unknown) => String(value ?? '').trim();
const yes = (value: unknown) => num(value) === 1 || String(value).toUpperCase() === 'Y';

export const classifyDailyWorkVisits = (visits: DailyWorkVisit[], reportDate: string): DailyWorkOverview => {
  const categorySpecs: Array<Omit<DailyWorkCategory, 'visits'> & { match: (visit: DailyWorkVisit) => boolean }> = [
    { id: 'close_error', label: 'ปิดสิทธิ์ไม่สำเร็จ (Error)', severity: 'error', match: (visit) => visit.closeStatus === 'E' },
    { id: 'pending_close', label: 'รอปิดสิทธิ์', severity: 'warning', match: (visit) => !visit.hasCloseCode },
    { id: 'missing_diag', label: 'ยังไม่ลง DIAG', severity: 'error', match: (visit) => visit.diagCount === 0 },
    { id: 'missing_main_diag', label: 'ไม่มี DIAG หลัก', severity: 'warning', match: (visit) => visit.diagCount > 0 && visit.mainDiagCount === 0 },
    { id: 'missing_charge', label: 'ไม่มีรายการค่าใช้จ่าย', severity: 'error', match: (visit) => visit.chargeCount === 0 },
    { id: 'zero_charge', label: 'ยอดค่าใช้จ่ายรวมเป็น 0', severity: 'warning', match: (visit) => visit.chargeCount > 0 && visit.totalCharge <= 0 },
    { id: 'missing_right', label: 'ข้อมูลสิทธิ์ไม่สมบูรณ์', severity: 'warning', match: (visit) => !visit.pttype || !visit.hipdataCode },
  ];
  const categories = categorySpecs.map(({ match, ...category }) => ({ ...category, visits: visits.filter(match) }));
  const affected = new Set(categories.flatMap((category) => category.visits.map((visit) => visit.vn)));
  const affectedPatients = new Set(categories.flatMap((category) => category.visits.map((visit) => visit.hn).filter(Boolean)));
  return {
    reportDate,
    totalVisits: visits.length,
    totalPatients: new Set(visits.map((visit) => visit.hn).filter(Boolean)).size,
    affectedVisits: affected.size,
    affectedPatients: affectedPatients.size,
    categories,
  };
};

export const queryDailyWorkOverview = async (reportDate: string) => {
  await ensureNhsoClosePrivilegeTable();
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT
         o.vn,
         o.hn,
         DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
         IFNULL(o.pttype, '') AS pttype,
         IFNULL(ptt.hipdata_code, '') AS hipdata_code,
         (SELECT COUNT(*) FROM ovstdiag od WHERE od.vn = o.vn) AS diag_count,
         (SELECT COUNT(*) FROM ovstdiag od WHERE od.vn = o.vn AND od.diagtype = '1') AS main_diag_count,
         (SELECT COUNT(*) FROM opitemrece oi WHERE oi.vn = o.vn) AS charge_count,
         (SELECT COALESCE(SUM(COALESCE(oi.sum_price, COALESCE(oi.unitprice, 0) * COALESCE(oi.qty, 0))), 0) FROM opitemrece oi WHERE oi.vn = o.vn) AS total_charge,
         CASE WHEN EXISTS (
           SELECT 1 FROM nhso_confirm_privilege ncp WHERE ncp.vn = o.vn AND ncp.nhso_status = 'Y' AND ncp.nhso_authen_code REGEXP '^EP'
         ) OR EXISTS (
           SELECT 1 FROM authenhos ah WHERE ah.vn = o.vn AND ah.claim_code REGEXP '^EP'
         ) OR EXISTS (
           SELECT 1 FROM visit_pttype vp WHERE vp.vn = o.vn AND vp.auth_code REGEXP '^EP'
         ) THEN 1 ELSE 0 END AS has_close_code,
         COALESCE((
           SELECT ncp.nhso_status
           FROM nhso_confirm_privilege ncp
           WHERE ncp.vn = o.vn
           ORDER BY ncp.nhso_confirm_privilege_id DESC
           LIMIT 1
         ), '') AS close_status
       FROM ovst o
       LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
       WHERE o.vstdate = ?
         AND IFNULL(o.an, '') = ''
       ORDER BY o.vsttime, o.vn`,
      [reportDate],
    );
    const visits = (Array.isArray(rows) ? rows : []).map((row) => {
      const item = row as Record<string, unknown>;
      return {
        vn: text(item.vn),
        hn: text(item.hn) || 'ไม่ระบุ HN',
        serviceDate: text(item.service_date) || reportDate,
        pttype: text(item.pttype),
        hipdataCode: text(item.hipdata_code),
        diagCount: num(item.diag_count),
        mainDiagCount: num(item.main_diag_count),
        chargeCount: num(item.charge_count),
        totalCharge: num(item.total_charge),
        hasCloseCode: yes(item.has_close_code),
        closeStatus: text(item.close_status),
      } satisfies DailyWorkVisit;
    });
    return classifyDailyWorkVisits(visits, reportDate);
  } finally {
    connection.release();
  }
};

const categoryIcon = (category: DailyWorkCategory) => category.severity === 'error' ? '❌' : '⚠️';

const uniquePatientCount = (category: DailyWorkCategory) => new Set(category.visits.map((visit) => visit.hn).filter(Boolean)).size;

export const buildDailyWorkOverviewMessages = (overview: DailyWorkOverview) => {
  const activeCategories = overview.categories.filter((category) => category.visits.length > 0);
  const summary = [
    '📊 ภาพรวมงานประจำวัน',
    `วันที่ ${overview.reportDate}`,
    `ผู้รับบริการทั้งหมด ${overview.totalPatients} คน`,
    `ต้องตรวจสอบ ${overview.affectedPatients} คน`,
    '',
    ...(activeCategories.length > 0
      ? activeCategories.map((category) => `${categoryIcon(category)} ${category.label}: ${uniquePatientCount(category)} คน`)
      : ['✅ ไม่พบรายการผิดปกติ']),
    '',
    'ตรวจสอบความสมบรูณ์ เวชระเบียนทุกครั้ง ก่อนส่งเบิก นะคะทุกคน 😊',
  ].join('\n');
  return [summary];
};

export const sendDailyWorkOverviewToLine = async (
  overview: DailyWorkOverview,
  options?: { targetId?: string; accessToken?: string },
) => {
  const targetId = text(options?.targetId || process.env.LINE_OVERVIEW_TARGET_ID);
  const accessToken = text(options?.accessToken || process.env.LINE_OVERVIEW_CHANNEL_ACCESS_TOKEN);
  if (!targetId) throw new Error('LINE_OVERVIEW_TARGET_ID is not configured');
  if (!accessToken) throw new Error('LINE_OVERVIEW_CHANNEL_ACCESS_TOKEN is not configured');
  const messages = buildDailyWorkOverviewMessages(overview);
  for (let index = 0; index < messages.length; index += 5) {
    const batch: LineMessage[] = messages.slice(index, index + 5).map((value) => ({ type: 'text', text: value.slice(0, 5000) }));
    await pushLineMessages(targetId, batch, accessToken);
  }
  return messages.length;
};

export const getBangkokDateTime = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
};

export const shouldSendDailyWorkOverview = (configuredTime: string, clock: { date: string; time: string }, lastSentDate?: string | null) => (
  /^([01]\d|2[0-3]):[0-5]\d$/.test(configuredTime)
  && clock.time === configuredTime
  && clock.date !== lastSentDate
);

export const getLastDailyWorkOverviewDate = async () => {
  const state = await getAppSetting<{ lastSentDate?: string }>(OVERVIEW_STATE_KEY);
  return text(state?.lastSentDate) || null;
};

export const markDailyWorkOverviewSent = async (reportDate: string) => {
  await setAppSetting(OVERVIEW_STATE_KEY, { lastSentDate: reportDate, sentAt: new Date().toISOString() });
};
