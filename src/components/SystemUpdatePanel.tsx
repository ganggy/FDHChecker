import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchSystemUpdateStatus } from '../services/systemUpdateStatus';

type UpdateJob = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  stage: string;
  progress: number;
  message: string;
  action?: 'update' | 'rollback';
  actor?: string;
  changeSummary?: string;
  branch: string;
  fromCommit: string;
  toCommit: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
};

type VersionNote = {
  commit: string;
  shortCommit: string;
  subject: string;
  details: string;
  authoredAt: string;
  author: string;
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
  changes: VersionNote[];
  versions: VersionNote[];
  history: UpdateJob[];
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
const thaiDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
};

export const SystemUpdatePanel = () => {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const [starting, setStarting] = useState(false);
  const [connectionState, setConnectionState] = useState<'online' | 'reconnecting'>('online');
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const statusRequestInFlight = useRef(false);
  const [selectedRollbackCommit, setSelectedRollbackCommit] = useState('');

  const running = info?.job?.status === 'queued' || info?.job?.status === 'running';

  const loadStatus = useCallback(async (refreshRemote = false) => {
    if (statusRequestInFlight.current) return;
    statusRequestInFlight.current = true;
    if (refreshRemote) setChecking(true);
    try {
      const data = await fetchSystemUpdateStatus(refreshRemote);
      setInfo(data as UpdateInfo);
      setConnectionState('online');
      setStatusError('');
    } catch (loadError) {
      setConnectionState('reconnecting');
      setStatusError(loadError instanceof Error ? loadError.message : 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      statusRequestInFlight.current = false;
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

  const reloadJobId = info?.job?.id;
  const reloadJobStatus = info?.job?.status;
  useEffect(() => {
    if (reloadJobStatus !== 'completed' || !reloadJobId) return;
    const storageKey = 'fdh-last-reloaded-update-job';
    if (window.sessionStorage.getItem(storageKey) === reloadJobId) return;
    const timer = window.setTimeout(() => {
      window.sessionStorage.setItem(storageKey, reloadJobId);
      window.location.reload();
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [reloadJobId, reloadJobStatus]);

  const confirmationText = useMemo(() => {
    if (!info?.remoteCommit) return '';
    const details = info.changes.slice(0, 8).map((item) => (
      `• ${item.shortCommit || shortCommit(item.commit)} ${item.subject}${item.details ? `\n  ${item.details}` : ''}`
    )).join('\n');
    return `ยืนยันอัปเดตระบบจาก ${shortCommit(info.currentCommit)} เป็น ${shortCommit(info.remoteCommit)} ใช่หรือไม่?\n\n${details}\n\nระบบจะตรวจสอบ สร้างโปรแกรม และรีสตาร์ตบริการชั่วคราว`;
  }, [info]);

  const rollbackVersions = useMemo(
    () => (info?.versions || []).filter((version) => version.commit !== info?.currentCommit),
    [info?.currentCommit, info?.versions],
  );
  const selectedRollback = rollbackVersions.find((version) => version.commit === selectedRollbackCommit) || null;

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

  const startRollback = async () => {
    if (!selectedRollback || running || starting || connectionState !== 'online') return;
    const detail = selectedRollback.details ? `\n\nรายละเอียด:\n${selectedRollback.details}` : '';
    const confirmed = window.confirm(
      `ยืนยันย้อนระบบจาก ${shortCommit(info?.currentCommit || '')} ไปเป็น ${selectedRollback.shortCommit}\n\n${selectedRollback.subject}${detail}\n\nระบบจะสร้างจุดกู้คืน ทดสอบ Build รีสตาร์ตบริการ และกู้รุ่นปัจจุบันกลับอัตโนมัติหากดำเนินการไม่สำเร็จ\n\nการย้อนเวอร์ชันเปลี่ยนเฉพาะโปรแกรม ไม่ย้อนข้อมูลในฐานข้อมูล`,
    );
    if (!confirmed) return;
    setStarting(true);
    setError('');
    try {
      const response = await fetch('/api/admin/system-update/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetCommit: selectedRollback.commit }),
      });
      const payload = await readPayload(response);
      setInfo((current) => current ? { ...current, job: payload.data as UpdateJob } : current);
      window.setTimeout(() => void loadStatus(false), 600);
    } catch (rollbackError) {
      setError(rollbackError instanceof Error ? rollbackError.message : 'เริ่มย้อนเวอร์ชันไม่สำเร็จ');
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
        <div><span>สถานะ</span><strong>{!info ? 'ยังไม่ได้รับข้อมูล' : connectionState === 'reconnecting' ? 'รอยืนยันสถานะล่าสุด' : info.available ? `มีใหม่ ${info.behind} commit` : 'เป็นรุ่นล่าสุด'}</strong></div>
      </div>

      {job && (
        <div className={`system-update-progress-card is-${job.status}`} aria-live="polite">
          <div className="system-update-progress-head">
            <div>
              <strong>{job.status === 'completed'
                ? (job.action === 'rollback' ? 'ย้อนเวอร์ชันสำเร็จ' : 'อัปเดตสำเร็จ')
                : job.status === 'failed' ? 'ดำเนินการไม่สำเร็จ'
                  : connectionState === 'reconnecting' ? 'กำลังรอยืนยันผลจากเซิร์ฟเวอร์'
                    : (job.action === 'rollback' ? 'กำลังย้อนเวอร์ชัน' : 'กำลังอัปเดตระบบ')}</strong>
              <span>{job.message}</span>
            </div>
            <b>{progress}%</b>
          </div>
          <div className="system-update-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <div style={{ width: `${progress}%` }} />
          </div>
          <small>ขั้นตอน: {job.stage} · {shortCommit(job.fromCommit)} → {shortCommit(job.toCommit)}</small>
          {connectionState === 'reconnecting' && <small>ข้อมูลล่าสุดที่อ่านได้: {thaiDateTime(job.updatedAt)} — เปอร์เซ็นต์นี้อาจยังไม่ใช่สถานะปัจจุบัน</small>}
          {job.changeSummary && <small>รายการ: {job.changeSummary}</small>}
          <small>ผู้ดำเนินการ: {job.actor || 'admin'} · เริ่ม {thaiDateTime(job.startedAt)}</small>
          {job.status === 'completed' && <small>ระบบจะโหลดหน้าใหม่อัตโนมัติเพื่อใช้รุ่นล่าสุด</small>}
        </div>
      )}

      {connectionState === 'reconnecting' && <div role="status" className="alert alert-info system-update-alert" style={{ display: 'block' }}>
        การเชื่อมต่อหน้าจอกับเซิร์ฟเวอร์ขาดช่วง ยังสรุปไม่ได้ว่างานอัปเดตสำเร็จหรือล้มเหลว ระบบกำลังเชื่อมต่อกลับโดยไม่เริ่มอัปเดตซ้ำ
        <div>{statusError}</div>
        <button type="button" className="secondary-btn" onClick={() => void loadStatus(false)}>ตรวจสถานะอีกครั้ง</button>
      </div>}
      {(error || (info && disabledReason)) && <div className="alert alert-danger system-update-alert">{error || disabledReason}</div>}
      {info?.ahead ? <div className="alert alert-info system-update-alert">เซิร์ฟเวอร์มี commit ที่ยังไม่มีบน GitHub {info.ahead} รายการ ต้องตรวจ branch ก่อนอัปเดต</div> : null}

      {info?.changes?.length ? (
        <div className="system-update-changes">
          <h4>📝 สิ่งที่จะได้รับจากการอัปเดต</h4>
          {info.changes.map((item) => (
            <div key={item.commit}>
              <code>{item.shortCommit || shortCommit(item.commit)}</code>
              <span>
                <strong>{item.subject}</strong>
                {item.details && <small>{item.details}</small>}
                <small>{thaiDateTime(item.authoredAt)} · {item.author}</small>
              </span>
            </div>
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
          disabled={starting || running || connectionState !== 'online' || !info?.available || Boolean(disabledReason) || Boolean(info?.ahead)}
        >
          {starting ? 'กำลังเริ่มงาน…' : running ? 'กำลังอัปเดต…' : '⬇️ ยืนยันและอัปเดตระบบ'}
        </button>
        {job?.status === 'completed' && <button type="button" className="secondary-btn" onClick={() => window.location.reload()}>โหลดหน้าใหม่ตอนนี้</button>}
      </div>

      <div className="system-update-rollback">
        <div>
          <h4>↩️ ย้อนเวอร์ชัน</h4>
          <p>เลือกรุ่นก่อนหน้าที่ต้องการ ระบบจะสร้างจุดกู้คืนและตรวจสอบความพร้อมก่อนเปิดใช้งาน การย้อนเวอร์ชันเปลี่ยนเฉพาะโปรแกรมและไม่ย้อนข้อมูลในฐานข้อมูล</p>
        </div>
        <div className="system-update-rollback-controls">
          <select
            value={selectedRollbackCommit}
            onChange={(event) => setSelectedRollbackCommit(event.target.value)}
            disabled={running || starting || rollbackVersions.length === 0}
          >
            <option value="">-- เลือกเวอร์ชันก่อนหน้า --</option>
            {rollbackVersions.map((version) => (
              <option key={version.commit} value={version.commit}>
                {version.shortCommit} · {version.subject} · {thaiDateTime(version.authoredAt)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="secondary-btn system-update-rollback-button"
            onClick={() => void startRollback()}
            disabled={!selectedRollback || running || starting || Boolean(disabledReason)}
          >
            ↩ ยืนยันและย้อนเวอร์ชัน
          </button>
        </div>
        {selectedRollback && (
          <div className="system-update-selected-version">
            <strong>{selectedRollback.shortCommit} — {selectedRollback.subject}</strong>
            {selectedRollback.details && <p>{selectedRollback.details}</p>}
            <small>บันทึกเมื่อ {thaiDateTime(selectedRollback.authoredAt)} โดย {selectedRollback.author}</small>
          </div>
        )}
      </div>

      {(info?.history || []).length > 0 && (
        <div className="system-update-history">
          <h4>🕘 ประวัติการติดตั้ง</h4>
          {info!.history.map((entry) => (
            <div key={entry.id}>
              <span className={`system-update-history-status is-${entry.status}`}>
                {entry.action === 'rollback' ? 'ย้อนเวอร์ชัน' : 'อัปเดต'} · {entry.status === 'completed' ? 'สำเร็จ' : 'ไม่สำเร็จ'}
              </span>
              <div>
                <strong>{shortCommit(entry.fromCommit)} → {shortCommit(entry.toCommit)}</strong>
                {entry.changeSummary && <p>{entry.changeSummary}</p>}
                <small>{thaiDateTime(entry.completedAt || entry.updatedAt)} · โดย {entry.actor || 'admin'}</small>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
