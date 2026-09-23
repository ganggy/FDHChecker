import crypto from 'crypto';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

export type SystemUpdateJobStatus = 'queued' | 'running' | 'completed' | 'failed';
export type SystemUpdateAction = 'update' | 'rollback';

export type SystemVersionNote = {
  commit: string;
  shortCommit: string;
  subject: string;
  details: string;
  authoredAt: string;
  author: string;
};

export type SystemUpdateJob = {
  id: string;
  status: SystemUpdateJobStatus;
  stage: string;
  progress: number;
  message: string;
  action: SystemUpdateAction;
  actor: string;
  changeSummary: string;
  branch: string;
  fromCommit: string;
  toCommit: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  runnerName?: string;
};

export type SystemUpdateInfo = {
  enabled: boolean;
  supported: boolean;
  branch: string;
  currentBranch: string;
  currentCommit: string;
  remoteCommit: string;
  available: boolean;
  behind: number;
  ahead: number;
  dirty: boolean;
  changes: SystemVersionNote[];
  versions: SystemVersionNote[];
  history: SystemUpdateJob[];
  checkedAt: string;
  checkError?: string;
  job: SystemUpdateJob | null;
  directSupported?: boolean;
  canResetLock?: boolean;
  isWindows?: boolean;
};

const commandTimeoutMs = 60_000;
const activeJobMaxAgeMs = 2 * 60 * 60 * 1000;
const runnerStartupGraceMs = 90_000;

const appDirectory = () => path.resolve(process.env.FDH_APP_DIR || process.cwd());
const stateDirectory = () => path.resolve(process.env.FDH_UPDATE_STATE_DIR || path.join(appDirectory(), '.update-state'));
const currentJobPath = () => path.join(stateDirectory(), 'current.json');

export const validateUpdateBranch = (value: string) => /^[A-Za-z0-9._/-]+$/.test(value) && !value.includes('..');

const configuredBranch = () => {
  const branch = String(process.env.FDH_DEPLOY_BRANCH || 'main').trim();
  if (!validateUpdateBranch(branch)) throw new Error('FDH_DEPLOY_BRANCH มีรูปแบบไม่ถูกต้อง');
  return branch;
};

const run = (command: string, args: string[], timeout = commandTimeoutMs) => new Promise<string>((resolve, reject) => {
  execFile(command, args, {
    cwd: appDirectory(),
    timeout,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
    env: process.env,
  }, (error, stdout, stderr) => {
    if (error) {
      const detail = String(stderr || error.message || '').trim().split(/\r?\n/).slice(-3).join(' ');
      reject(new Error(detail || `คำสั่ง ${command} ทำงานไม่สำเร็จ`));
      return;
    }
    resolve(String(stdout || '').trim());
  });
});

const runGit = (args: string[], timeout?: number) => run('git', args, timeout);

const runNpm = (args: string[], timeout = 300_000) => {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return run(npmCmd, args, timeout);
};

const runPm2 = (args: string[], timeout = 30_000) => {
  const pm2Cmd = process.platform === 'win32' ? 'pm2.cmd' : 'pm2';
  return run(pm2Cmd, args, timeout);
};

const readVersionNote = async (commit: string): Promise<SystemVersionNote> => {
  const output = await runGit(['show', '-s', '--format=%H%n%h%n%aI%n%an%n%s%n%b', commit]);
  const [fullCommit = '', shortCommit = '', authoredAt = '', author = '', subject = '', ...body] = output.split(/\r?\n/);
  return {
    commit: fullCommit,
    shortCommit,
    subject: subject || '(ไม่มีรายละเอียด)',
    details: body.join('\n').trim(),
    authoredAt,
    author,
  };
};

const listVersionNotes = async (revision: string, maxCount: number): Promise<SystemVersionNote[]> => {
  const hashes = (await runGit(['rev-list', `--max-count=${maxCount}`, revision]))
    .split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  return Promise.all(hashes.map(readVersionNote));
};

const normalizeJob = (value: SystemUpdateJob): SystemUpdateJob => ({
  ...value,
  action: value.action === 'rollback' ? 'rollback' : 'update',
  actor: String(value.actor || 'admin'),
  changeSummary: String(value.changeSummary || ''),
});

export const reconcileUpdateJob = (
  job: SystemUpdateJob, runnerAlive: boolean | null, now = Date.now(),
): SystemUpdateJob => {
  if (!['queued', 'running'].includes(job.status)) return job;
  const age = now - Date.parse(job.updatedAt);
  if (age <= runnerStartupGraceMs || runnerAlive === true) return job;
  // An unavailable PM2 status is not evidence that a managed worker died.
  if (runnerAlive === null && job.runnerName) return {
    ...job,
    message: `ยังตรวจสถานะตัวอัปเดตจาก PM2 ไม่ได้ (ขั้น ${job.stage}) กรุณาตรวจ PM2 และ log บนเซิร์ฟเวอร์ก่อนเริ่มงานใหม่`,
  };
  if (runnerAlive === null && age <= activeJobMaxAgeMs) return job;
  return {
    ...job, status: 'failed', stage: 'interrupted',
    message: `ตัวอัปเดตหยุดตอบสนองในขั้น ${job.stage} ยังไม่ยืนยันว่าอัปเดตครบ กรุณาตรวจ log update-${job.id}.log`,
    updatedAt: new Date(now).toISOString(), completedAt: new Date(now).toISOString(),
  };
};

const runnerChecks = new Map<string, { checkedAt: number; alive: boolean | null }>();
export const parsePm2ProcessList = (output: string): Array<{
  name?: string; pid?: number; pm2_env?: { status?: string };
}> => {
  // Some PM2 versions print a daemon/CLI version warning even with --silent.
  for (let offset = output.indexOf('['); offset !== -1; offset = output.indexOf('[', offset + 1)) {
    try {
      const parsed = JSON.parse(output.slice(offset).trim());
      if (Array.isArray(parsed)) return parsed;
    } catch { /* Try the next array start after the diagnostic prefix. */ }
  }
  throw new Error('PM2 did not return a process list');
};
const runnerIsAlive = async (name: string): Promise<boolean | null> => {
  const cached = runnerChecks.get(name);
  if (cached && Date.now() - cached.checkedAt < 15_000) return cached.alive;
  let alive: boolean | null = null;
  try {
    const list = parsePm2ProcessList(await runPm2(['jlist', '--silent'], 5_000));
    if (Array.isArray(list)) alive = list.some((entry) => entry.name === name
      && Boolean(entry.pid) && entry.pm2_env?.status === 'online');
  } catch { /* Keep the active job locked when PM2 cannot be queried. */ }
  if (runnerChecks.size > 20) runnerChecks.clear();
  runnerChecks.set(name, { checkedAt: Date.now(), alive });
  return alive;
};

export const cleanupStoppedRunners = async (): Promise<void> => {
  try {
    const list = parsePm2ProcessList(await runPm2(['jlist', '--silent'], 5_000));
    if (!Array.isArray(list)) return;
    const stopped = list.filter((entry) => entry.name?.startsWith('fdh-update-') && entry.pm2_env?.status !== 'online');
    for (const entry of stopped) {
      if (entry.name) {
        await runPm2(['delete', entry.name], 5_000).catch(() => undefined);
      }
    }
  } catch {
    /* Ignore PM2 errors during cleanup */
  }
};

const readCurrentJob = async (): Promise<SystemUpdateJob | null> => {
  try {
    const raw = await fs.readFile(currentJobPath(), 'utf8');
    const job = normalizeJob(JSON.parse(raw) as SystemUpdateJob);
    if (!job?.id || !job.status) return null;
    if (['queued', 'running'].includes(job.status) && Date.now() - Date.parse(job.updatedAt) > runnerStartupGraceMs) {
      const alive = job.runnerName ? await runnerIsAlive(job.runnerName) : null;
      // The runner may have completed while we were querying PM2.
      const latest = normalizeJob(JSON.parse(await fs.readFile(currentJobPath(), 'utf8')) as SystemUpdateJob);
      if (latest.id !== job.id || latest.updatedAt !== job.updatedAt || latest.status !== job.status) return latest;
      return reconcileUpdateJob(job, alive);
    }
    return job;
  } catch {
    return null;
  }
};

const readHistory = async (): Promise<SystemUpdateJob[]> => {
  try {
    const entries = (await fs.readdir(stateDirectory()))
      .filter((name) => /^history-[A-Za-z0-9-]+\.json$/.test(name))
      .sort().reverse().slice(0, 20);
    const jobs = await Promise.all(entries.map(async (name) => {
      try {
        return normalizeJob(JSON.parse(await fs.readFile(path.join(stateDirectory(), name), 'utf8')) as SystemUpdateJob);
      } catch {
        return null;
      }
    }));
    return jobs.filter((job): job is SystemUpdateJob => Boolean(job?.id));
  } catch {
    return [];
  }
};

const isSupported = () => true;
const isEnabled = () => String(process.env.FDH_SELF_UPDATE_ENABLED || '1') !== '0';

export const getSystemUpdateInfo = async (refreshRemote = false): Promise<SystemUpdateInfo> => {
  const branch = configuredBranch();
  const checkedAt = new Date().toISOString();
  const [job, history] = await Promise.all([readCurrentJob(), readHistory()]);
  const base: SystemUpdateInfo = {
    enabled: isEnabled(),
    supported: isSupported(),
    branch,
    currentBranch: '',
    currentCommit: '',
    remoteCommit: '',
    available: false,
    behind: 0,
    ahead: 0,
    dirty: false,
    changes: [],
    versions: [],
    history,
    checkedAt,
    job,
    directSupported: true,
    canResetLock: Boolean(job && ['queued', 'running', 'failed'].includes(job.status)),
    isWindows: process.platform === 'win32',
  };

  try {
    await fs.access(path.join(appDirectory(), '.git'));
    const [currentBranch, currentCommit, worktree] = await Promise.all([
      runGit(['branch', '--show-current']),
      runGit(['rev-parse', 'HEAD']),
      runGit(['status', '--porcelain']),
    ]);
    base.currentBranch = currentBranch;
    base.currentCommit = currentCommit;
    base.dirty = Boolean(worktree);

    if (refreshRemote) {
      await runGit(['fetch', '--prune', 'origin', branch], 120_000);
    }

    base.remoteCommit = await runGit(['rev-parse', `origin/${branch}`]);
    const [behindText, aheadText, changeHashes, versions] = await Promise.all([
      runGit(['rev-list', '--count', `HEAD..origin/${branch}`]),
      runGit(['rev-list', '--count', `origin/${branch}..HEAD`]),
      runGit(['rev-list', '--max-count=12', `HEAD..origin/${branch}`]),
      listVersionNotes('HEAD', 12),
    ]);
    base.behind = Number(behindText || 0);
    base.ahead = Number(aheadText || 0);
    base.available = base.behind > 0;
    const pendingHashes = changeHashes.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    base.changes = await Promise.all(pendingHashes.map(readVersionNote));
    base.versions = versions;
  } catch (error) {
    base.checkError = error instanceof Error ? error.message : 'ตรวจสอบ GitHub ไม่สำเร็จ';
  }

  return base;
};

const writeInitialJob = async (job: SystemUpdateJob) => {
  await fs.mkdir(stateDirectory(), { recursive: true });
  const tempPath = `${currentJobPath()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(job, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tempPath, currentJobPath());
};

export const buildUpdateRunnerConfig = (job: SystemUpdateJob, directory: string, stateDir: string) => ({
  apps: [{
    name: `fdh-update-${job.id}`,
    script: path.join(stateDir, `runner-${job.id}.sh`),
    interpreter: 'bash', cwd: directory,
    autorestart: false, watch: false,
    out_file: path.join(stateDir, `launcher-${job.id}.log`),
    error_file: path.join(stateDir, `launcher-${job.id}.log`),
    env: {
      PATH: process.env.PATH || '',
      FDH_APP_DIR: directory, FDH_UPDATE_STATE_DIR: stateDir,
      FDH_UPDATE_JOB_ID: job.id, FDH_UPDATE_STARTED_AT: job.startedAt,
      FDH_UPDATE_FROM_COMMIT: job.fromCommit, FDH_UPDATE_TO_COMMIT: job.toCommit,
      FDH_UPDATE_ACTOR: job.actor.slice(0, 80), FDH_UPDATE_ACTION: job.action,
      FDH_UPDATE_CHANGE_SUMMARY: job.changeSummary, FDH_DEPLOY_BRANCH: job.branch,
      FDH_UPDATE_RUNNER_NAME: `fdh-update-${job.id}`,
    },
  }],
});

const launchUpdateRunner = async (job: SystemUpdateJob) => {
  await cleanupStoppedRunners();
  job.runnerName = `fdh-update-${job.id}`;
  await writeInitialJob(job);
  let launchRequested = false;
  try {
    const config = buildUpdateRunnerConfig(job, appDirectory(), stateDirectory());
    await fs.copyFile(path.join(appDirectory(), 'deploy/scripts/self-update-runner.sh'), config.apps[0].script);
    await fs.chmod(config.apps[0].script, 0o700);
    const configPath = path.join(stateDirectory(), `runner-${job.id}.json`);
    await fs.writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    // PM2's daemon owns the worker; restarting the backend must not kill its child tree.
    // Do not save the global process list: it includes unrelated apps and this one-shot job.
    launchRequested = true;
    await runPm2(['start', configPath], 60_000);
  } catch (error) {
    await fs.appendFile(path.join(stateDirectory(), `launcher-${job.id}.log`),
      `${new Date().toISOString()} launch failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
      { mode: 0o600 }).catch(() => undefined);
    // A timed-out CLI may already have launched the worker. Never overwrite its state
    // or report it as failed until PM2 confirms it is absent/stopped.
    const alive = launchRequested ? await runnerIsAlive(job.runnerName) : false;
    if (alive !== false) return;
    const current = await readCurrentJob();
    if (current?.id === job.id && current.stage === 'queued') {
      await writeInitialJob({ ...job, status: 'failed', stage: 'launch_failed',
        message: 'เริ่มตัวอัปเดตผ่าน PM2 ไม่สำเร็จ กรุณาตรวจ PM2 และ launcher log บนเซิร์ฟเวอร์',
        updatedAt: new Date().toISOString(), completedAt: new Date().toISOString() });
    }
    throw new Error('เริ่มตัวอัปเดตผ่าน PM2 ไม่สำเร็จ');
  }
};

export const startSystemUpdate = async (expectedRemoteCommit: string, actor: string) => {
  if (!isEnabled()) throw new Error('ระบบอัปเดตอัตโนมัติถูกปิดหรือไม่รองรับบนเครื่องนี้');
  if (!/^[a-f0-9]{40}$/i.test(expectedRemoteCommit)) throw new Error('รหัสรุ่นที่ยืนยันไม่ถูกต้อง');

  if (process.platform === 'win32') {
    return startDirectSystemUpdate({ expectedRemoteCommit, actor, force: false });
  }

  const existingJob = await readCurrentJob();
  if (existingJob?.status === 'queued' || existingJob?.status === 'running') {
    throw new Error('มีงานอัปเดตกำลังทำงานอยู่ ระบบจะติดตามงานเดิมต่ออัตโนมัติ');
  }

  const info = await getSystemUpdateInfo(true);
  if (info.checkError) throw new Error(info.checkError);
  if (info.currentBranch !== info.branch) throw new Error(`เซิร์ฟเวอร์อยู่ branch ${info.currentBranch || '(detached)'} แต่กำหนดให้อัปเดต ${info.branch}`);
  if (info.dirty) throw new Error('เซิร์ฟเวอร์มีไฟล์ที่ยังไม่ได้ commit กรุณาตรวจสอบก่อนอัปเดต');
  if (!info.available) throw new Error('เซิร์ฟเวอร์เป็นรุ่นล่าสุดแล้ว');
  if (info.remoteCommit.toLowerCase() !== expectedRemoteCommit.toLowerCase()) {
    throw new Error('GitHub มีรุ่นใหม่กว่าใบยืนยัน กรุณาตรวจสอบรายการเปลี่ยนแปลงอีกครั้ง');
  }

  const now = new Date().toISOString();
  const jobId = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
  const job: SystemUpdateJob = {
    id: jobId,
    status: 'queued',
    stage: 'queued',
    progress: 1,
    message: `รับคำสั่งอัปเดตจาก ${actor || 'admin'} แล้ว`,
    action: 'update',
    actor: actor || 'admin',
    changeSummary: info.changes.map((item) => item.subject).join(' • ').slice(0, 2000),
    branch: info.branch,
    fromCommit: info.currentCommit,
    toCommit: info.remoteCommit,
    startedAt: now,
    updatedAt: now,
  };
  await launchUpdateRunner(job);
  return job;
};

export const startSystemRollback = async (targetCommit: string, actor: string) => {
  if (!isEnabled()) throw new Error('ระบบย้อนเวอร์ชันอัตโนมัติถูกปิดหรือไม่รองรับบนเครื่องนี้');
  if (!/^[a-f0-9]{40}$/i.test(targetCommit)) throw new Error('รหัสเวอร์ชันที่ต้องการย้อนไม่ถูกต้อง');

  const existingJob = await readCurrentJob();
  if (existingJob?.status === 'queued' || existingJob?.status === 'running') {
    throw new Error('มีงานอัปเดตหรือย้อนเวอร์ชันกำลังทำงานอยู่ ระบบจะติดตามงานเดิมต่ออัตโนมัติ');
  }

  const info = await getSystemUpdateInfo(false);
  if (info.checkError) throw new Error(info.checkError);
  if (info.currentBranch !== info.branch) throw new Error(`เซิร์ฟเวอร์อยู่ branch ${info.currentBranch || '(detached)'} แต่กำหนด branch ${info.branch}`);
  if (info.dirty) throw new Error('เซิร์ฟเวอร์มีไฟล์ที่ยังไม่ได้ commit กรุณาตรวจสอบก่อนย้อนเวอร์ชัน');
  if (info.currentCommit.toLowerCase() === targetCommit.toLowerCase()) throw new Error('เซิร์ฟเวอร์ใช้งานเวอร์ชันนี้อยู่แล้ว');

  const isAncestor = await runGit(['merge-base', '--is-ancestor', targetCommit, info.currentCommit])
    .then(() => true, () => false);
  if (!isAncestor) throw new Error('เลือกย้อนกลับได้เฉพาะเวอร์ชันก่อนหน้าที่ตรวจสอบแล้วใน branch นี้');
  const target = await readVersionNote(targetCommit);
  if (!target.commit || target.commit.toLowerCase() !== targetCommit.toLowerCase()) throw new Error('ไม่พบเวอร์ชันที่เลือกใน Git repository');

  const now = new Date().toISOString();
  const jobId = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
  const job: SystemUpdateJob = {
    id: jobId,
    status: 'queued',
    stage: 'queued',
    progress: 1,
    message: `รับคำสั่งย้อนเวอร์ชันจาก ${actor || 'admin'} แล้ว`,
    action: 'rollback',
    actor: actor || 'admin',
    changeSummary: `ย้อนกลับเป็น ${target.shortCommit}: ${target.subject}`,
    branch: info.branch,
    fromCommit: info.currentCommit,
    toCommit: target.commit,
    startedAt: now,
    updatedAt: now,
  };
  await launchUpdateRunner(job);
  return job;
};

export const startDirectSystemUpdate = async (options: {
  force?: boolean;
  actor?: string;
  expectedRemoteCommit?: string;
} = {}): Promise<SystemUpdateJob> => {
  const branch = configuredBranch();
  const actor = options.actor || 'admin';
  const force = Boolean(options.force);

  await fs.access(path.join(appDirectory(), '.git')).catch(() => {
    throw new Error('ไม่พบโฟลเดอร์ Git repository บนเซิร์ฟเวอร์');
  });

  const fromCommit = await runGit(['rev-parse', 'HEAD']);

  // Fetch remote branch
  await runGit(['fetch', '--prune', 'origin', branch], 120_000);
  const toCommit = await runGit(['rev-parse', `origin/${branch}`]);

  if (options.expectedRemoteCommit && options.expectedRemoteCommit.toLowerCase() !== toCommit.toLowerCase() && !force) {
    throw new Error('GitHub มีรุ่นใหม่กว่าใบยืนยัน กรุณาตรวจสอบรายการเปลี่ยนแปลงอีกครั้ง');
  }

  // Check dirty working tree
  const worktreeStatus = await runGit(['status', '--porcelain']);
  const isDirty = Boolean(worktreeStatus.trim());

  if (isDirty) {
    if (!force) {
      throw new Error('เซิร์ฟเวอร์มีไฟล์แก้ไขค้างอยู่ กรุณากดเลือก "สำรอง/ข้ามไฟล์ค้าง (Force/Stash)" เพื่อดำเนินการ');
    }
    // Stash local modifications
    try {
      await runGit(['stash', 'push', '-u', '-m', `fdh-auto-stash-before-update-${Date.now()}`]);
    } catch {
      await runGit(['reset', '--hard', 'HEAD']);
    }
  }

  // Update working branch to latest
  try {
    await runGit(['checkout', branch]);
    if (force) {
      await runGit(['reset', '--hard', `origin/${branch}`]);
    } else {
      await runGit(['pull', 'origin', branch]);
    }
  } catch {
    await runGit(['reset', '--hard', `origin/${branch}`]);
  }

  const finalCommit = await runGit(['rev-parse', 'HEAD']);

  // Build frontend
  try {
    await runNpm(['run', 'build'], 300_000);
  } catch (buildErr) {
    const errorMsg = buildErr instanceof Error ? buildErr.message : String(buildErr);
    throw new Error(`ดึงโค้ดสำเร็จ (${finalCommit.slice(0, 8)}) แต่ Build ไม่สำเร็จ: ${errorMsg}`);
  }

  // Record completed job
  const jobId = `direct-${Date.now()}`;
  const now = new Date().toISOString();
  const job: SystemUpdateJob = {
    id: jobId,
    status: 'completed',
    stage: 'completed',
    progress: 100,
    message: `อัปเดตระบบตรงสำเร็จโดย ${actor} (รุ่น ${finalCommit.slice(0, 8)})`,
    action: 'update',
    actor,
    changeSummary: `Direct update: ${fromCommit.slice(0, 8)} -> ${finalCommit.slice(0, 8)}`,
    branch,
    fromCommit,
    toCommit: finalCommit,
    startedAt: now,
    updatedAt: now,
    completedAt: now,
  };

  await fs.mkdir(stateDirectory(), { recursive: true });
  await fs.writeFile(currentJobPath(), `${JSON.stringify(job, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.writeFile(path.join(stateDirectory(), `history-${jobId}.json`), `${JSON.stringify(job, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });

  // Restart via PM2 if alive
  try {
    await runPm2(['reload', 'all'], 30_000);
  } catch {
    // PM2 might not be active or this is Windows standalone
  }

  return job;
};

export const resetSystemUpdateLock = async (actor: string = 'admin') => {
  await cleanupStoppedRunners();
  let clearedJobId: string | null = null;
  try {
    const current = await readCurrentJob();
    if (current) {
      clearedJobId = current.id;
      const updatedJob: SystemUpdateJob = {
        ...current,
        status: 'failed',
        stage: 'unlocked',
        message: `ผู้ดูแลระบบ (${actor}) ทำการปลดล็อกสถานะงานเรียบร้อยแล้ว`,
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      await fs.writeFile(path.join(stateDirectory(), `history-${current.id}.json`), `${JSON.stringify(updatedJob, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await fs.unlink(currentJobPath()).catch(() => undefined);
    } else {
      await fs.unlink(currentJobPath()).catch(() => undefined);
    }
  } catch {
    await fs.unlink(currentJobPath()).catch(() => undefined);
  }

  return {
    success: true,
    clearedJobId,
    message: 'ปลดล็อกสถานะงานเรียบร้อยแล้ว สามารถเริ่มอัปเดตใหม่ได้ทันที',
  };
};

let cachedUpdateCheck: { available: boolean; behind: number; checkedAt: string; changesCount: number } | null = null;
let lastRemoteFetchTime = 0;
const REMOTE_CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes cache

export const getQuickUpdateCheck = async (forceRefresh = false): Promise<{ available: boolean; behind: number; checkedAt: string; changesCount: number }> => {
  const now = Date.now();
  const shouldFetch = forceRefresh || (now - lastRemoteFetchTime > REMOTE_CHECK_INTERVAL_MS);

  if (!shouldFetch && cachedUpdateCheck) {
    return cachedUpdateCheck;
  }

  try {
    const info = await getSystemUpdateInfo(shouldFetch);
    lastRemoteFetchTime = now;
    cachedUpdateCheck = {
      available: Boolean(info.available),
      behind: Number(info.behind || 0),
      checkedAt: info.checkedAt || new Date().toISOString(),
      changesCount: Array.isArray(info.changes) ? info.changes.length : Number(info.behind || 0),
    };
    return cachedUpdateCheck;
  } catch {
    return cachedUpdateCheck || { available: false, behind: 0, checkedAt: new Date().toISOString(), changesCount: 0 };
  }
};

