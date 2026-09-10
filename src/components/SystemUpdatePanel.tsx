import { useCallback, useEffect, useMemo, useState } from 'react';

type UpdateJob = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
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

type UpdateInfo = {
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
  job: UpdateJob | null;
};

const readPayload = async (response: Response) => {
  const payload = await response.json().catch(() => ({})) as { success?: boolean; data?: UpdateInfo | UpdateJob; error?: string };
  if (!response.ok || payload.success === false) throw new Error(payload.error || 'เชื่อมต่อระบบอัปเดตไม่สำเร็จ');
  return payload;
};

const shortCommit = (value: string) => value ? value.slice(0, 8) : '-';

export const SystemUpdatePanel = () => {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const [starting, setStarting] = useState(false);
  const [connectionState, setConnectionState] = useState<'online' | 'reconnecting'>('online');
  const [error, setError] = useState('');

  const running = info?.job?.status === 'queued' || info?.job?.status === 'running';

  const loadStatus = useCallback(async (refreshRemote = false) => {
    if (refreshRemote) setChecking(true);
    try {
      const response = await fetch(`/api/admin/system-update?refresh=${refreshRemote ? '1' : '0'}`, { cache: 'no-store' });
      const payload = await readPayload(response);
      setInfo(payload.data as UpdateInfo);
      setConnectionState('online');
      setError('');
    } catch (loadError) {
      setConnectionState('reconnecting');
      setError(loadError instanceof Error ? loadError.message : 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      if (refreshRemote) setChecking(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus(true);
  }, [loadStatus]);

  useEffect(() => {
    const delay = running || connectionState === 'reconnecting' ? 2500 : 5 * 60 * 1000;
    const timer = window.setInterval(() => void loadStatus(false), delay);
    const reconnect = () => void loadStatus(false);
    window.addEventListener('online', reconnect);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', reconnect);
    };
  }, [connectionState, loadStatus, running]);

  useEffect(() => {
    const job = info?.job;
    if (job?.status !== 'completed') return;
    const storageKey = 'fdh-last-reloaded-update-job';
    if (window.sessionStorage.getItem(storageKey) === job.id) return;
    window.sessionStorage.setItem(storageKey, job.id);
    const timer = window.setTimeout(() => window.location.reload(), 2500);
    return () => window.clearTimeout(timer);
  }, [info?.job]);

  const confirmationText = useMemo(() => {
    if (!info?.remoteCommit) return '';
    const details = info.changes.slice(0, 6).map((item) => `• ${item.commit} ${item.subject}`).join('\n');
    return `ยืนยันอัปเดตระบบจาก ${shortCommit(info.currentCommit)} เป็น ${shortCommit(info.remoteCommit)} ใช่หรือไม่?\n\n${details}\n\nระบบจะตรวจสอบ สร้างโปรแกรม และรีสตาร์ตบริการชั่วคราว`;
  }, [info]);

  const startUpdate = async () => {
    if (!info?.available || !info.remoteCommit || !window.confirm(confirmationText)) return;
    setStarting(true);
    setError('');
    try {
      const response = await fetch('/api/admin/system-update/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRemoteCommit: info.remoteCommit }),
      });
      const payload = await readPayload(response);
      setInfo((current) => current ? { ...current, job: payload.data as UpdateJob } : current);
      window.setTimeout(() => void loadStatus(false), 600);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'เริ่มอัปเดตไม่สำเร็จ');
    } finally {
      setStarting(false);
    }
  };

  const job = info?.job;
  const progress = Math.max(0, Math.min(100, Number(job?.progress || 0)));
  const disabledReason = !info?.enabled
    ? 'ระบบอัปเดตอัตโนมัติไม่ได้เปิดบนเซิร์ฟเวอร์นี้'
    : info.checkError
      ? info.checkError
      : info.currentBranch !== info.branch
        ? `เซิร์ฟเวอร์อยู่ branch ${info.currentBranch || '(detached)'} กรุณาเปลี่ยนเป็น ${info.branch}`
        : info.dirty
          ? 'มีไฟล์แก้ไขค้างอยู่บนเซิร์ฟเวอร์'
          : '';

  return (
    <div className="settings-section system-update-panel">
      <div className="system-update-heading">
        <div>
          <h3>🔄 อัปเดตระบบจาก GitHub</h3>
          <p className="settings-section-description">
            ตรวจรุ่นใหม่และอัปเดตเฉพาะ branch ที่กำหนด ระบบจะตรวจสอบโค้ดก่อนรีสตาร์ต และกลับมาติดตามงานเดิมอัตโนมัติเมื่อการเชื่อมต่อหลุด
          </p>
        </div>
        <span className={`system-update-connection is-${connectionState}`}>
          {connectionState === 'online' ? '● เชื่อมต่อแล้ว' : '◌ กำลังเชื่อมต่อใหม่…'}
        </span>
      </div>

      <div className="system-update-version-grid">
        <div><span>Branch</span><strong>{info?.branch || '-'}</strong></div>
        <div><span>รุ่นที่ใช้อยู่</span><strong>{shortCommit(info?.currentCommit || '')}</strong></div>
        <div><span>รุ่นบน GitHub</span><strong>{shortCommit(info?.remoteCommit || '')}</strong></div>
        <div><span>สถานะ</span><strong>{info?.available ? `มีใหม่ ${info.behind} commit` : 'เป็นรุ่นล่าสุด'}</strong></div>
      </div>

      {job && (
        <div className={`system-update-progress-card is-${job.status}`} aria-live="polite">
          <div className="system-update-progress-head">
            <div>
              <strong>{job.status === 'completed' ? 'อัปเดตสำเร็จ' : job.status === 'failed' ? 'อัปเดตไม่สำเร็จ' : 'กำลังอัปเดตระบบ'}</strong>
              <span>{job.message}</span>
            </div>
            <b>{progress}%</b>
          </div>
          <div className="system-update-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <div style={{ width: `${progress}%` }} />
          </div>
          <small>ขั้นตอน: {job.stage} · {shortCommit(job.fromCommit)} → {shortCommit(job.toCommit)}</small>
          {job.status === 'completed' && <small>ระบบจะโหลดหน้าใหม่อัตโนมัติเพื่อใช้รุ่นล่าสุด</small>}
        </div>
      )}

      {(error || disabledReason) && <div className="alert alert-danger system-update-alert">{error || disabledReason}</div>}
      {info?.ahead ? <div className="alert alert-info system-update-alert">เซิร์ฟเวอร์มี commit ที่ยังไม่มีบน GitHub {info.ahead} รายการ ต้องตรวจ branch ก่อนอัปเดต</div> : null}

      {info?.changes?.length ? (
        <div className="system-update-changes">
          <h4>รายการเปลี่ยนแปลง</h4>
          {info.changes.map((item) => (
            <div key={item.commit}><code>{item.commit}</code><span>{item.subject}</span></div>
          ))}
        </div>
      ) : null}

      <div className="system-update-actions">
        <button type="button" className="secondary-btn" onClick={() => void loadStatus(true)} disabled={checking || running || starting}>
          {checking ? 'กำลังตรวจ GitHub…' : '↻ ตรวจสอบรุ่นใหม่'}
        </button>
        <button
          type="button"
          className="save-btn"
          onClick={() => void startUpdate()}
          disabled={starting || running || !info?.available || Boolean(disabledReason) || Boolean(info?.ahead)}
        >
          {starting ? 'กำลังเริ่มงาน…' : running ? 'กำลังอัปเดต…' : '⬇️ ยืนยันและอัปเดตระบบ'}
        </button>
        {job?.status === 'completed' && <button type="button" className="secondary-btn" onClick={() => window.location.reload()}>โหลดหน้าใหม่ตอนนี้</button>}
      </div>
    </div>
  );
};
