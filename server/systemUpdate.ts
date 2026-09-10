import crypto from 'crypto';
import { execFile, spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

export type SystemUpdateJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export type SystemUpdateJob = {
  id: string;
  status: SystemUpdateJobStatus;
  stage: string;
  progress: number;
  message: string;
  branch: string;
  fromCommit: string;
  toCommit: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
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
  changes: Array<{ commit: string; subject: string }>;
  checkedAt: string;
  checkError?: string;
  job: SystemUpdateJob | null;
};

const commandTimeoutMs = 60_000;
const activeJobMaxAgeMs = 2 * 60 * 60 * 1000;

const appDirectory = () => path.resolve(process.env.FDH_APP_DIR || process.cwd());
const stateDirectory = () => path.resolve(process.env.FDH_UPDATE_STATE_DIR || path.join(appDirectory(), '.update-state'));
const currentJobPath = () => path.join(stateDirectory(), 'current.json');

export const validateUpdateBranch = (value: string) => /^[A-Za-z0-9._/-]+$/.test(value) && !value.includes('..');

const configuredBranch = () => {
  const branch = String(process.env.FDH_DEPLOY_BRANCH || 'agent/add-local-ai').trim();
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

const readCurrentJob = async (): Promise<SystemUpdateJob | null> => {
  try {
    const raw = await fs.readFile(currentJobPath(), 'utf8');
    const job = JSON.parse(raw) as SystemUpdateJob;
    if (!job?.id || !job.status) return null;
    if ((job.status === 'queued' || job.status === 'running') && Date.now() - Date.parse(job.updatedAt) > activeJobMaxAgeMs) {
      return {
        ...job,
        status: 'failed',
        stage: 'stale',
        message: 'งานอัปเดตหยุดตอบสนองเกิน 2 ชั่วโมง กรุณาตรวจสอบ log บนเซิร์ฟเวอร์',
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
    }
    return job;
  } catch {
    return null;
  }
};

const isSupported = () => process.platform !== 'win32';
const isEnabled = () => isSupported() && String(process.env.FDH_SELF_UPDATE_ENABLED || '1') !== '0';

export const getSystemUpdateInfo = async (refreshRemote = false): Promise<SystemUpdateInfo> => {
  const branch = configuredBranch();
  const checkedAt = new Date().toISOString();
  const job = await readCurrentJob();
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
    checkedAt,
    job,
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
    const [behindText, aheadText, logText] = await Promise.all([
      runGit(['rev-list', '--count', `HEAD..origin/${branch}`]),
      runGit(['rev-list', '--count', `origin/${branch}..HEAD`]),
      runGit(['log', '--format=%h%x09%s', '--max-count=12', `HEAD..origin/${branch}`]),
    ]);
    base.behind = Number(behindText || 0);
    base.ahead = Number(aheadText || 0);
    base.available = base.behind > 0;
    base.changes = logText
      ? logText.split(/\r?\n/).map((line) => {
          const [commit, ...subject] = line.split('\t');
          return { commit: commit || '', subject: subject.join('\t') || '(ไม่มีรายละเอียด)' };
        })
      : [];
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

export const startSystemUpdate = async (expectedRemoteCommit: string, actor: string) => {
  if (!isEnabled()) throw new Error('ระบบอัปเดตอัตโนมัติถูกปิดหรือไม่รองรับบนเครื่องนี้');
  if (!/^[a-f0-9]{40}$/i.test(expectedRemoteCommit)) throw new Error('รหัสรุ่นที่ยืนยันไม่ถูกต้อง');

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
    branch: info.branch,
    fromCommit: info.currentCommit,
    toCommit: info.remoteCommit,
    startedAt: now,
    updatedAt: now,
  };
  await writeInitialJob(job);

  const runnerSource = path.join(appDirectory(), 'deploy', 'scripts', 'self-update-runner.sh');
  const runnerCopy = path.join(stateDirectory(), `runner-${jobId}.sh`);
  await fs.copyFile(runnerSource, runnerCopy);
  await fs.chmod(runnerCopy, 0o700);

  const child = spawn('bash', [runnerCopy], {
    cwd: appDirectory(),
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      FDH_UPDATE_JOB_ID: jobId,
      FDH_UPDATE_STARTED_AT: now,
      FDH_UPDATE_FROM_COMMIT: info.currentCommit,
      FDH_UPDATE_TO_COMMIT: info.remoteCommit,
      FDH_UPDATE_ACTOR: actor.slice(0, 80),
      FDH_DEPLOY_BRANCH: info.branch,
      FDH_APP_DIR: appDirectory(),
      FDH_UPDATE_STATE_DIR: stateDirectory(),
    },
  });
  child.unref();
  return job;
};
