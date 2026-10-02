import { getUTFConnection, getAppSetting } from './db.js';
import { readHospitalIdentity } from './siteProfile.js';
import { submitNhsoClosePrivileges } from './repositories/claims.repository.js';

export const NHSO_CLOSE_SETTINGS_KEY = 'nhso_close_settings';

export interface NhsoCloseConfig {
  environment?: 'prd' | 'uat';
  token?: string;
  apiBaseUrl?: string;
  sourceId?: string;
  claimServiceCode?: string;
  recorderPid?: string;
  maxDays?: number;
  autoCloseEnabled?: boolean;
  autoCloseDelayMinutes?: number;
  autoCloseIntervalMinutes?: number;
}

export interface NhsoAutoCloseSummary {
  total: number;
  submitted: number;
  skipped: number;
  errors: number;
  timestamp: string;
  triggeredBy: 'scheduler' | 'manual' | 'startup';
}

export interface NhsoAutoCloseStatus {
  enabled: boolean;
  delayMinutes: number;
  intervalMinutes: number;
  isRunning: boolean;
  isSchedulerActive: boolean;
  lastRunAt: string | null;
  lastSummary: NhsoAutoCloseSummary | null;
  lastError: string | null;
  todayCount: number;
}

// Runtime State
let schedulerTimer: NodeJS.Timeout | null = null;
let isExecuting = false;
let lastRunAt: string | null = null;
let lastSummary: NhsoAutoCloseSummary | null = null;
let lastError: string | null = null;
let todayCount = 0;
let todayDate = new Date().toISOString().slice(0, 10);

const getTodayDateString = () => new Date().toISOString().slice(0, 10);

/**
 * ดึงรายการผู้ป่วยที่เข้าเกณฑ์ปิดสิทธิ์อัตโนมัติ:
 * 1. สถานะ = กลับบ้าน
 * 2. เป็นผู้ป่วยนอก (OPD: an IS NULL OR an = '')
 * 3. มีเลขประจำตัวประชาชน 13 หลัก
 * 4. ยังไม่มีการปิดสิทธิ์ (ยังไม่มี EP... หรือ nhso_status <> 'Y')
 * 5. เวลาจำหน่าย/การเงิน/ตรวจเสร็จ ผ่านไปแล้วเกิน delayMinutes (ค่าเริ่มต้น 15 นาที)
 */
export const getNhsoAutoCloseCandidates = async (options: {
  delayMinutes: number;
  limit?: number;
}): Promise<Record<string, unknown>[]> => {
  const connection = await getUTFConnection();
  try {
    const delayMinutes = Math.max(1, Number(options.delayMinutes || 15));
    const limit = Math.max(1, Math.min(Number(options.limit || 50), 200));

    const [rows] = await connection.query(
      `SELECT
         o.vn,
         pt.cid,
         TIMESTAMP(o.vstdate, o.vsttime) AS vst_datetime,
         DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS service_date,
         TIME_FORMAT(o.vsttime, '%H:%i:%s') AS service_time,
         IFNULL(ptt.hipdata_code, '') AS maininscl,
         CONCAT(o.pttype, ':', COALESCE(ptt.name, '')) AS pttypename,
         IFNULL(v.income, 0) AS income,
         IFNULL(v.uc_money, 0) AS uc_money,
         IFNULL(v.rcpt_money, 0) AS rcpt_money,
         IFNULL(v.debt_id_list, '') AS invno,
         COALESCE(
           NULLIF((SELECT claim_code FROM authenhos ah2 WHERE ah2.vn = o.vn AND ah2.claim_code REGEXP '^PP' LIMIT 1), ''),
           NULLIF((SELECT auth_code FROM visit_pttype vp2 WHERE vp2.vn = o.vn AND vp2.auth_code REGEXP '^PP' LIMIT 1), ''),
           ''
         ) AS authencode_web,
         COALESCE(
           (SELECT MAX(rp.bill_date_time) FROM rcpt_print rp WHERE rp.vn = o.vn),
           TIMESTAMP(o.vstdate, COALESCE(o.cur_dep_time, o.vsttime))
         ) AS discharge_datetime,
         TIMESTAMPDIFF(
           MINUTE,
           COALESCE(
             (SELECT MAX(rp.bill_date_time) FROM rcpt_print rp WHERE rp.vn = o.vn),
             TIMESTAMP(o.vstdate, COALESCE(o.cur_dep_time, o.vsttime))
           ),
           NOW()
         ) AS minutes_since_dismiss
       FROM ovst o
       LEFT JOIN patient pt ON pt.hn = o.hn
       LEFT JOIN pttype ptt ON ptt.pttype = o.pttype
       LEFT JOIN vn_stat v ON v.vn = o.vn
       LEFT JOIN ovstost ost ON ost.ovstost = o.ovstost
       LEFT JOIN nhso_confirm_privilege ncp ON ncp.vn = o.vn
       WHERE o.vstdate BETWEEN DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND CURDATE()
         AND (o.an IS NULL OR o.an = '')
         AND TRIM(COALESCE(ost.name, '')) = 'กลับบ้าน'
         AND pt.cid IS NOT NULL AND CHAR_LENGTH(TRIM(pt.cid)) = 13
         AND (
           IFNULL(ncp.nhso_status, '') <> 'Y'
           AND IFNULL(ncp.nhso_authen_code, '') NOT REGEXP '^EP'
           AND IFNULL((SELECT claim_code FROM authenhos ah2 WHERE ah2.vn = o.vn AND ah2.claim_code REGEXP '^EP' LIMIT 1), '') = ''
           AND IFNULL((SELECT auth_code FROM visit_pttype vp2 WHERE vp2.vn = o.vn AND vp2.auth_code REGEXP '^EP' LIMIT 1), '') = ''
         )
         AND TIMESTAMPDIFF(
           MINUTE,
           COALESCE(
             (SELECT MAX(rp.bill_date_time) FROM rcpt_print rp WHERE rp.vn = o.vn),
             TIMESTAMP(o.vstdate, COALESCE(o.cur_dep_time, o.vsttime))
           ),
           NOW()
         ) >= ?
       ORDER BY o.vstdate ASC, o.vsttime ASC
       LIMIT ?`,
      [delayMinutes, limit]
    );

    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  } finally {
    connection.release();
  }
};

/**
 * รันรอบประมวลผลปิดสิทธิ์อัตโนมัติ 1 รอบ
 */
export const runNhsoAutoCloseCycle = async (
  triggeredBy: 'scheduler' | 'manual' | 'startup' = 'scheduler'
): Promise<{
  success: boolean;
  candidatesCount: number;
  submittedCount: number;
  summary: NhsoAutoCloseSummary | null;
  message: string;
}> => {
  const currentToday = getTodayDateString();
  if (currentToday !== todayDate) {
    todayDate = currentToday;
    todayCount = 0;
  }

  const savedConfig = (await getAppSetting<Record<string, unknown>>(NHSO_CLOSE_SETTINGS_KEY)) || {};
  const enabled = savedConfig.autoCloseEnabled === true;

  if (triggeredBy === 'scheduler' && !enabled) {
    return {
      success: true,
      candidatesCount: 0,
      submittedCount: 0,
      summary: null,
      message: 'ระบบปิดสิทธิ์อัตโนมัติไม่ได้เปิดใช้งาน',
    };
  }

  const token = String(savedConfig.token || '').trim();
  const apiBaseUrl = String(savedConfig.apiBaseUrl || 'https://nhsoapi.nhso.go.th/nhsoendpoint').trim();
  const recorderPid = String(savedConfig.recorderPid || '').trim();
  const sourceId = String(savedConfig.sourceId || 'KSPAPI').trim() || 'KSPAPI';
  const claimServiceCode = String(savedConfig.claimServiceCode || 'PG0060001').trim() || 'PG0060001';
  const environment = String(savedConfig.environment || 'prd') === 'uat' ? 'uat' : 'prd';
  const delayMinutes = Math.max(1, Number(savedConfig.autoCloseDelayMinutes || 15));

  if (!token || !recorderPid) {
    lastError = 'ยังไม่ได้ตั้งค่า Token หรือ Recorder PID ในการปิดสิทธิ์ NHSO';
    return {
      success: false,
      candidatesCount: 0,
      submittedCount: 0,
      summary: null,
      message: lastError,
    };
  }

  // ดึง Hospital Code
  let hospitalCode = '';
  try {
    const connection = await getUTFConnection();
    try {
      hospitalCode = (await readHospitalIdentity(connection)).hospital_code;
    } finally {
      connection.release();
    }
  } catch (err: any) {
    lastError = `ไม่สามารถอ่าน Hospital Code จาก opdconfig: ${err.message}`;
    return {
      success: false,
      candidatesCount: 0,
      submittedCount: 0,
      summary: null,
      message: lastError,
    };
  }

  try {
    const candidates = await getNhsoAutoCloseCandidates({
      delayMinutes,
      limit: 50,
    });

    const nowIso = new Date().toISOString();
    lastRunAt = nowIso;
    lastError = null;

    if (candidates.length === 0) {
      const emptySummary: NhsoAutoCloseSummary = {
        total: 0,
        submitted: 0,
        skipped: 0,
        errors: 0,
        timestamp: nowIso,
        triggeredBy,
      };
      lastSummary = emptySummary;
      return {
        success: true,
        candidatesCount: 0,
        submittedCount: 0,
        summary: emptySummary,
        message: 'ไม่มีรายการที่รอปิดสิทธิ์ในรอบนี้',
      };
    }

    const items = candidates.map((c) => ({
      vn: String(c.vn || ''),
      cid: String(c.cid || ''),
      vstDateTime: String(c.vst_datetime || `${c.service_date} ${c.service_time}`),
      mainInscl: String(c.maininscl || 'UCS'),
      income: Number(c.income || 0),
      rcptMoney: Number(c.rcpt_money || 0),
      ucMoney: Number(c.uc_money || 0),
      authencodeWeb: String(c.authencode_web || ''),
      pttypeName: String(c.pttypename || ''),
      invno: String(c.invno || ''),
    }));

    const result = await submitNhsoClosePrivileges({
      token,
      baseUrl: apiBaseUrl,
      hospitalCode,
      recorderPid,
      sourceId,
      claimServiceCode,
      environment,
      items,
    });

    todayCount += result.submitted;

    const roundSummary: NhsoAutoCloseSummary = {
      total: result.total,
      submitted: result.submitted,
      skipped: result.skipped,
      errors: result.errors,
      timestamp: nowIso,
      triggeredBy,
    };
    lastSummary = roundSummary;

    console.log(
      `[NhsoAutoClose] ${triggeredBy} cycle done: candidates=${candidates.length}, submitted=${result.submitted}, skipped=${result.skipped}, errors=${result.errors}`
    );

    return {
      success: true,
      candidatesCount: candidates.length,
      submittedCount: result.submitted,
      summary: roundSummary,
      message: `ประมวลผลเรียบร้อย: ปิดสิทธิ์สำเร็จ ${result.submitted}/${candidates.length} รายการ`,
    };
  } catch (err: any) {
    lastError = err?.message || 'เกิดข้อผิดพลาดในการประมวลผลปิดสิทธิ์อัตโนมัติ';
    console.error('[NhsoAutoClose] Cycle error:', err);
    return {
      success: false,
      candidatesCount: 0,
      submittedCount: 0,
      summary: null,
      message: lastError || 'เกิดข้อผิดพลาดในการประมวลผลปิดสิทธิ์อัตโนมัติ',
    };
  }
};

/**
 * ดึงสถานะปัจจุบันของระบบปิดสิทธิ์อัตโนมัติ
 */
export const getNhsoAutoCloseStatus = async (): Promise<NhsoAutoCloseStatus> => {
  const savedConfig = (await getAppSetting<Record<string, unknown>>(NHSO_CLOSE_SETTINGS_KEY)) || {};
  return {
    enabled: savedConfig.autoCloseEnabled === true,
    delayMinutes: Math.max(1, Number(savedConfig.autoCloseDelayMinutes || 15)),
    intervalMinutes: Math.max(1, Number(savedConfig.autoCloseIntervalMinutes || 3)),
    isRunning: isExecuting,
    isSchedulerActive: schedulerTimer !== null,
    lastRunAt,
    lastSummary,
    lastError,
    todayCount,
  };
};

/**
 * เริ่มหรือรีสตาร์ทตัวตั้งเวลา (Scheduler)
 */
export const startNhsoAutoCloseScheduler = async () => {
  stopNhsoAutoCloseScheduler();

  const savedConfig = (await getAppSetting<Record<string, unknown>>(NHSO_CLOSE_SETTINGS_KEY)) || {};
  const enabled = savedConfig.autoCloseEnabled === true;
  if (!enabled) {
    return;
  }

  const intervalMinutes = Math.max(1, Number(savedConfig.autoCloseIntervalMinutes || 3));
  const intervalMs = intervalMinutes * 60 * 1000;

  console.log(`[NhsoAutoClose] Scheduler started: check every ${intervalMinutes} min, delay >= ${savedConfig.autoCloseDelayMinutes || 15} min`);

  schedulerTimer = setInterval(async () => {
    if (isExecuting) return;
    isExecuting = true;
    try {
      await runNhsoAutoCloseCycle('scheduler');
    } catch (err: any) {
      console.error('[NhsoAutoClose] Scheduled run failure:', err.message);
    } finally {
      isExecuting = false;
    }
  }, intervalMs);

  schedulerTimer.unref();

  // รันรอบแรกแบบ background หลังจากเปิดระบบ 15 วินาที
  setTimeout(async () => {
    if (!isExecuting) {
      isExecuting = true;
      try {
        await runNhsoAutoCloseCycle('startup');
      } catch (err: any) {
        console.error('[NhsoAutoClose] Startup run failure:', err.message);
      } finally {
        isExecuting = false;
      }
    }
  }, 15_000).unref();
};

/**
 * หยุดการทำงานของ Scheduler
 */
export const stopNhsoAutoCloseScheduler = () => {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log('[NhsoAutoClose] Scheduler stopped');
  }
};
