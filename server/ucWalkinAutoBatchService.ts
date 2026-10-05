import { getAppSetting, setAppSetting } from './db.js';
import {
  getUcOutsideCupWalkinAudit,
  insertMissingUcOutsideCupWalkin,
  getUcOutsideCupClinicalAudit,
  batchFixWalkinClinicalIssues,
} from './ucOutsideCupWalkin.js';

export const UC_WALKIN_BATCH_SETTINGS_KEY = 'uc_walkin_batch_settings';
export const UC_WALKIN_START_DATE = '2024-10-01';

export interface UcWalkinBatchConfig {
  enabled: boolean;
  intervalMinutes: number;
  scanDays: number;
  autoFixClinical: boolean;
  autoInsertWalkin: boolean;
}

export interface UcWalkinBatchSummary {
  timestamp: string;
  startDate: string;
  endDate: string;
  walkinChecked: number;
  walkinInserted: number;
  clinicalChecked: number;
  clinicalFixed: number;
  errors: string[];
  durationMs: number;
  triggeredBy: 'scheduler' | 'manual' | 'startup';
}

export interface UcWalkinBatchStatus {
  enabled: boolean;
  intervalMinutes: number;
  scanDays: number;
  autoFixClinical: boolean;
  autoInsertWalkin: boolean;
  isRunning: boolean;
  isSchedulerActive: boolean;
  lastRunAt: string | null;
  lastSummary: UcWalkinBatchSummary | null;
  lastError: string | null;
}

const DEFAULT_CONFIG: UcWalkinBatchConfig = {
  enabled: false,
  intervalMinutes: 30,
  scanDays: 30,
  autoFixClinical: true,
  autoInsertWalkin: true,
};

// Runtime state
let schedulerTimer: NodeJS.Timeout | null = null;
let isExecuting = false;
let lastRunAt: string | null = null;
let lastSummary: UcWalkinBatchSummary | null = null;
let lastError: string | null = null;

export const getUcWalkinBatchConfig = async (): Promise<UcWalkinBatchConfig> => {
  try {
    const saved = (await getAppSetting<Record<string, unknown>>(UC_WALKIN_BATCH_SETTINGS_KEY)) || {};
    return {
      enabled: saved.enabled === true,
      intervalMinutes: Math.min(1440, Math.max(5, Number(saved.intervalMinutes || DEFAULT_CONFIG.intervalMinutes))),
      scanDays: Math.min(365, Math.max(1, Number(saved.scanDays || DEFAULT_CONFIG.scanDays))),
      autoFixClinical: saved.autoFixClinical !== false,
      autoInsertWalkin: saved.autoInsertWalkin !== false,
    };
  } catch (err) {
    console.warn('Unable to load UC WALKIN batch settings:', err);
    return { ...DEFAULT_CONFIG };
  }
};

export const saveUcWalkinBatchConfig = async (patch: Partial<UcWalkinBatchConfig>): Promise<UcWalkinBatchConfig> => {
  const current = await getUcWalkinBatchConfig();
  const updated: UcWalkinBatchConfig = {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
    intervalMinutes: patch.intervalMinutes != null
      ? Math.min(1440, Math.max(5, Number(patch.intervalMinutes)))
      : current.intervalMinutes,
    scanDays: patch.scanDays != null
      ? Math.min(365, Math.max(1, Number(patch.scanDays)))
      : current.scanDays,
    autoFixClinical: typeof patch.autoFixClinical === 'boolean' ? patch.autoFixClinical : current.autoFixClinical,
    autoInsertWalkin: typeof patch.autoInsertWalkin === 'boolean' ? patch.autoInsertWalkin : current.autoInsertWalkin,
  };

  await setAppSetting(UC_WALKIN_BATCH_SETTINGS_KEY, updated);

  // Restart scheduler to reflect updated config
  if (updated.enabled) {
    startUcWalkinBatchScheduler();
  } else {
    stopUcWalkinBatchScheduler();
  }

  return updated;
};

export const getUcWalkinBatchStatus = async (): Promise<UcWalkinBatchStatus> => {
  const config = await getUcWalkinBatchConfig();
  return {
    ...config,
    isRunning: isExecuting,
    isSchedulerActive: schedulerTimer !== null,
    lastRunAt,
    lastSummary,
    lastError,
  };
};

export const runUcWalkinBatchJob = async (
  triggeredBy: 'scheduler' | 'manual' | 'startup' = 'scheduler'
): Promise<UcWalkinBatchSummary> => {
  if (isExecuting) {
    throw new Error('ระบบ Batch กำลังทำงานอยู่ กรุณารอสักครู่');
  }

  isExecuting = true;
  lastError = null;
  const startTime = Date.now();

  const config = await getUcWalkinBatchConfig();
  const today = new Date();
  const endDate = today.toISOString().slice(0, 10);

  const pastDate = new Date(today);
  pastDate.setDate(pastDate.getDate() - config.scanDays);
  const rawStartDate = pastDate.toISOString().slice(0, 10);
  const startDate = rawStartDate < UC_WALKIN_START_DATE ? UC_WALKIN_START_DATE : rawStartDate;

  const errors: string[] = [];
  let walkinChecked = 0;
  let walkinInserted = 0;
  let clinicalChecked = 0;
  let clinicalFixed = 0;

  try {
    console.log(`[uc-walkin-batch] Starting job (${triggeredBy}): ${startDate} to ${endDate}`);

    // Step 1: Check and Insert WALKIN item
    if (config.autoInsertWalkin) {
      try {
        const walkinAuditRes = await getUcOutsideCupWalkinAudit({
          startDate,
          endDate,
          missingOnly: true,
          pageSize: 200,
        });

        walkinChecked = walkinAuditRes.summary.total_visits || 0;
        const missingCount = walkinAuditRes.summary.missing_walkin || 0;

        if (missingCount > 0) {
          const insertRes = await insertMissingUcOutsideCupWalkin({
            startDate,
            endDate,
            configurationKey: walkinAuditRes.configurationKey,
            expectedCount: missingCount,
            confirmation: 'AUTO',
            auto: true,
            actorUserId: null,
            actorName: 'ระบบ Batch อัตโนมัติ',
          });
          walkinInserted = insertRes.insertedCount;
          console.log(`[uc-walkin-batch] Inserted ${walkinInserted} WALKIN items`);
        }
      } catch (walkinErr) {
        const msg = walkinErr instanceof Error ? walkinErr.message : String(walkinErr);
        console.error('[uc-walkin-batch] WALKIN insert step failed:', msg);
        errors.push(`WALKIN: ${msg}`);
      }
    }

    // Step 2: Check and Auto-Fix Clinical / Dental issues
    if (config.autoFixClinical) {
      try {
        const clinicalRes = await getUcOutsideCupClinicalAudit({
          startDate,
          endDate,
          auditStatus: 'ALL',
          pageSize: 200,
        });

        clinicalChecked = clinicalRes.summary.total_visits || 0;
        const fixableRows = (clinicalRes.data || []).filter((r) => r.can_auto_fix);

        if (fixableRows.length > 0) {
          const vns = fixableRows.map((r) => r.vn);
          const fixResult = await batchFixWalkinClinicalIssues({
            vns,
            actorUserId: null,
            actorName: 'ระบบ Batch อัตโนมัติ',
          });
          clinicalFixed = fixResult.success_count;
          console.log(`[uc-walkin-batch] Auto-fixed ${clinicalFixed}/${vns.length} clinical issues`);
        }
      } catch (clinicalErr) {
        const msg = clinicalErr instanceof Error ? clinicalErr.message : String(clinicalErr);
        console.error('[uc-walkin-batch] Clinical auto-fix step failed:', msg);
        errors.push(`Clinical: ${msg}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lastError = msg;
    errors.push(msg);
  } finally {
    isExecuting = false;
  }

  const durationMs = Date.now() - startTime;
  const summary: UcWalkinBatchSummary = {
    timestamp: new Date().toISOString(),
    startDate,
    endDate,
    walkinChecked,
    walkinInserted,
    clinicalChecked,
    clinicalFixed,
    errors,
    durationMs,
    triggeredBy,
  };

  lastRunAt = summary.timestamp;
  lastSummary = summary;
  if (errors.length > 0) {
    lastError = errors.join('; ');
  }

  console.log(`[uc-walkin-batch] Finished job (${durationMs}ms): fixed=${clinicalFixed}, walkin=${walkinInserted}, errors=${errors.length}`);
  return summary;
};

export const startUcWalkinBatchScheduler = () => {
  stopUcWalkinBatchScheduler();

  void (async () => {
    const config = await getUcWalkinBatchConfig();
    if (!config.enabled) {
      console.log('[uc-walkin-batch] Scheduler is disabled by configuration');
      return;
    }

    const intervalMs = config.intervalMinutes * 60 * 1000;
    console.log(`[uc-walkin-batch] Scheduler started (interval: ${config.intervalMinutes}m)`);

    // Run first check after a brief startup delay of 30 seconds
    const startupTimer = setTimeout(() => {
      void runUcWalkinBatchJob('startup').catch((err) => {
        console.error('[uc-walkin-batch] Startup job failed:', err);
      });
    }, 30_000);
    startupTimer.unref();

    schedulerTimer = setInterval(() => {
      void runUcWalkinBatchJob('scheduler').catch((err) => {
        console.error('[uc-walkin-batch] Scheduled job failed:', err);
      });
    }, intervalMs);
    schedulerTimer.unref();
  })();
};

export const stopUcWalkinBatchScheduler = () => {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log('[uc-walkin-batch] Scheduler stopped');
  }
};
