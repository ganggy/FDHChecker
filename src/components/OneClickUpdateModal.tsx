import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchSystemUpdateStatus,
  resetSystemUpdateLock,
  startDirectSystemUpdate,
} from '../services/systemUpdateStatus';

interface VersionNote {
  commit: string;
  shortCommit: string;
  subject: string;
  authoredAt: string;
}

interface UpdateJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  stage: string;
  progress: number;
  message: string;
}

interface DetailedUpdateInfo {
  enabled: boolean;
  supported: boolean;
  directSupported?: boolean;
  canResetLock?: boolean;
  currentCommit: string;
  remoteCommit: string;
  available: boolean;
  behind: number;
  dirty: boolean;
  changes: VersionNote[];
  job: UpdateJob | null;
}

interface OneClickUpdateModalProps {
  open: boolean;
  isAdmin: boolean;
  behindHint: number;
  onClose: () => void;
  onSnoozeToday?: () => void;
  onOpenAdvancedSettings: () => void;
}

export const OneClickUpdateModal: React.FC<OneClickUpdateModalProps> = ({
  open,
  isAdmin,
  behindHint,
  onClose,
  onSnoozeToday,
  onOpenAdvancedSettings,
}) => {
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<DetailedUpdateInfo | null>(null);
  const [phase, setPhase] = useState<'idle' | 'updating' | 'restarting' | 'done' | 'error'>('idle');
  const [statusText, setStatusText] = useState('');
  const [progress, setProgress] = useState(0);
  const [errorText, setErrorText] = useState('');
  const targetCommitRef = useRef<string>('');
  const pollTimerRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const loadDetails = useCallback(async (refreshRemote = true) => {
    if (!isAdmin) return;
    setLoading(true);
    setErrorText('');
    try {
      const data = (await fetchSystemUpdateStatus(refreshRemote)) as DetailedUpdateInfo;
      setInfo(data);
      if (data.job && (data.job.status === 'queued' || data.job.status === 'running')) {
        setPhase('updating');
        setProgress(Math.max(10, data.job.progress || 20));
        setStatusText(data.job.message || 'กำลังอัปเดตระบบ...');
        targetCommitRef.current = data.remoteCommit || '';
      }
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'ไม่สามารถดึงรายละเอียดการอัปเดตได้');
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (open && isAdmin) {
      void loadDetails(true);
    }
    if (!open) {
      stopPolling();
    }
    return () => stopPolling();
  }, [open, isAdmin, loadDetails, stopPolling]);

  const startPollingForCompletion = useCallback((expectedCommit: string, initialCommit: string) => {
    stopPolling();
    let seenDisconnect = false;
    let ticks = 0;

    pollTimerRef.current = window.setInterval(async () => {
      ticks += 1;
      try {
        const data = (await fetchSystemUpdateStatus(false, 8000)) as DetailedUpdateInfo;
        setInfo(data);

        const commitChanged =
          Boolean(expectedCommit && data.currentCommit && data.currentCommit.startsWith(expectedCommit.slice(0, 7))) ||
          Boolean(initialCommit && data.currentCommit && data.currentCommit !== initialCommit);

        if (commitChanged || (!data.available && seenDisconnect)) {
          stopPolling();
          setPhase('done');
          setProgress(100);
          setStatusText('อัปเดตสำเร็จแล้ว! กำลังรีเฟรชหน้าเว็บเป็นเวอร์ชันล่าสุด...');
          try {
            window.sessionStorage.setItem('fdh-update-success-banner', 'อัปเดตระบบเป็นเวอร์ชันล่าสุดเรียบร้อยแล้ว');
          } catch {
            // ignore
          }
          window.setTimeout(() => {
            window.location.reload();
          }, 1800);
          return;
        }

        if (data.job) {
          const job = data.job;
          if (job.status === 'failed') {
            stopPolling();
            setPhase('error');
            setErrorText(job.message || 'อัปเดตไม่สำเร็จ กรุณาลองใหม่อีกครั้งหรือเปิดหน้าตั้งค่าขั้นสูง');
            return;
          }
          if (job.status === 'completed') {
            setPhase('restarting');
            setProgress(92);
            setStatusText('Build เสร็จแล้ว กำลังรอเซิร์ฟเวอร์รีสตาร์ท...');
            return;
          }
          setProgress((prev) => Math.max(prev, Math.min(90, job.progress || prev + 5)));
          setStatusText(job.message || 'กำลังอัปเดตระบบ...');
        } else if (seenDisconnect) {
          // Server came back up after direct restart
          stopPolling();
          setPhase('done');
          setProgress(100);
          setStatusText('เซิร์ฟเวอร์กลับมาออนไลน์แล้ว กำลังรีเฟรชหน้าเว็บ...');
          window.setTimeout(() => window.location.reload(), 1500);
        } else {
          setProgress((prev) => Math.min(88, prev + 3));
        }
      } catch {
        // Expected while PM2 restarts backend
        seenDisconnect = true;
        setPhase('restarting');
        setProgress((prev) => Math.max(prev, 85));
        setStatusText('เซิร์ฟเวอร์กำลังรีสตาร์ทเพื่อสลับเป็นเวอร์ชันใหม่ (กรุณารอสักครู่)...');
      }

      if (ticks > 90) {
        stopPolling();
        setPhase('error');
        setErrorText('ใช้เวลานานกว่าปกติ กรุณารีเฟรชหน้าเว็บ (F5) เพื่อตรวจสอบเวอร์ชันล่าสุด');
      }
    }, 2500);
  }, [stopPolling]);

  const handleOneClickUpdate = async () => {
    setErrorText('');
    setPhase('updating');
    setProgress(15);
    setStatusText('กำลังเตรียมการอัปเดตจาก GitHub...');

    const initialCommit = info?.currentCommit || '';
    const expectedRemoteCommit = info?.remoteCommit || '';
    targetCommitRef.current = expectedRemoteCommit;

    try {
      // 1. Auto-clear stale lock if present
      if (info?.canResetLock) {
        setStatusText('พบสถานะค้างจากรอบก่อน กำลังปลดล็อกอัตโนมัติ...');
        await resetSystemUpdateLock().catch(() => null);
      }

      // 2. Choose best path: if dirty or standard runner unsupported -> go straight to direct update (auto-stash)
      const preferDirect = Boolean(info?.dirty || info?.supported === false);

      if (!preferDirect && expectedRemoteCommit) {
        setStatusText('กำลังดึงเวอร์ชันล่าสุดและ Build ระบบ...');
        setProgress(30);
        const startRes = await fetch('/api/admin/system-update/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedRemoteCommit }),
        });
        const startPayload = await startRes.json().catch(() => ({}));
        if (startRes.ok && startPayload?.success !== false) {
          startPollingForCompletion(expectedRemoteCommit, initialCommit);
          return;
        }
        // Fallback automatically to direct update
        setStatusText('กำลังสลับไปใช้วิธีอัปเดตตรงอัตโนมัติ (auto-stash + build + restart)...');
      }

      setProgress(35);
      setStatusText('กำลังดึงโค้ดล่าสุดจาก GitHub, Build และรีสตาร์ทเซิร์ฟเวอร์...');
      await startDirectSystemUpdate({
        force: true,
        expectedRemoteCommit: expectedRemoteCommit || undefined,
      });
      startPollingForCompletion(expectedRemoteCommit, initialCommit);
    } catch (err) {
      setPhase('error');
      setErrorText(err instanceof Error ? err.message : 'เริ่มการอัปเดตไม่สำเร็จ');
    }
  };

  if (!open) return null;

  const behindCount = info?.behind ?? behindHint;
  const recentChanges = (info?.changes || []).slice(0, 6);
  const busy = phase === 'updating' || phase === 'restarting' || phase === 'done';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.58)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
        padding: 16,
      }}
      role="dialog"
      aria-modal="true"
      aria-label="อัปเดตระบบ 1 คลิก"
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 540,
          boxShadow: '0 24px 60px rgba(15, 23, 42, 0.35)',
          borderRadius: 16,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            background: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 60%, #0284c7 100%)',
            color: '#fff',
            padding: '18px 20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>🚀 มีอัปเดตระบบเวอร์ชันใหม่</div>
            <div style={{ fontSize: 12, opacity: 0.92, marginTop: 2 }}>
              รุ่นปัจจุบัน v{__APP_VERSION__} · มีรายการอัปเดตใหม่ {behindCount > 0 ? `${behindCount} รายการ` : 'พร้อมติดตั้ง'}
            </div>
          </div>
          {!busy && (
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'rgba(255,255,255,0.18)',
                border: 'none',
                color: '#fff',
                width: 32,
                height: 32,
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 16,
              }}
              aria-label="ปิดหน้าต่าง"
            >
              ✕
            </button>
          )}
        </div>

        <div className="card-body" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!isAdmin ? (
            <>
              <div className="alert alert-info" style={{ margin: 0 }}>
                พบเวอร์ชันใหม่จาก GitHub ({behindCount} รายการ) กรุณาแจ้ง <strong>ผู้ดูแลระบบ (Admin)</strong> เพื่อกดปุ่มอัปเดตระบบ 1 คลิกครับ
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-primary" onClick={onClose}>รับทราบ</button>
              </div>
            </>
          ) : (
            <>
              {errorText && (
                <div className="alert alert-danger" style={{ margin: 0, fontSize: 13 }}>
                  ⚠️ {errorText}
                </div>
              )}

              {phase === 'idle' && (
                <>
                  {loading ? (
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
                      กำลังตรวจสอบรายละเอียดเวอร์ชันล่าสุดจาก GitHub...
                    </div>
                  ) : recentChanges.length > 0 ? (
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>รายการอัปเดตล่าสุด:</div>
                      <ul
                        style={{
                          margin: 0,
                          paddingLeft: 18,
                          fontSize: 12.5,
                          lineHeight: 1.6,
                          color: 'var(--text-secondary, #334155)',
                          maxHeight: 170,
                          overflowY: 'auto',
                        }}
                      >
                        {recentChanges.map((c) => (
                          <li key={c.commit}>
                            <code style={{ fontSize: 11, marginRight: 6 }}>{c.shortCommit}</code>
                            {c.subject}
                          </li>
                        ))}
                      </ul>
                      {info && info.changes.length > recentChanges.length && (
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
                          ...และอีก {info.changes.length - recentChanges.length} รายการ
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      ระบบพร้อมดึงโค้ดล่าสุดจาก GitHub, Build และรีสตาร์ทอัตโนมัติในคลิกเดียว (ใช้เวลาประมาณ 30–60 วินาที)
                    </div>
                  )}

                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: 10,
                      padding: '10px 12px',
                      fontSize: 12,
                      color: '#475569',
                    }}
                  >
                    💡 กดปุ่มเดียว ระบบจะจัดเก็บไฟล์ค้าง (ถ้ามี), ดึงอัปเดตจาก GitHub, Build และรีสตาร์ทให้เอง จากนั้นหน้าเว็บจะรีเฟรชอัตโนมัติ
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ width: '100%', padding: '12px 16px', fontSize: 15, fontWeight: 700 }}
                      disabled={loading}
                      onClick={() => void handleOneClickUpdate()}
                    >
                      🚀 อัปเดตเป็นเวอร์ชันล่าสุดทันที (1 คลิก)
                    </button>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => {
                          onClose();
                          onOpenAdvancedSettings();
                        }}
                      >
                        ⚙️ ตั้งค่าขั้นสูง / ย้อนรุ่น
                      </button>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {onSnoozeToday && (
                          <button type="button" className="btn btn-sm btn-secondary" onClick={onSnoozeToday}>
                            เตือนใหม่พรุ่งนี้
                          </button>
                        )}
                        <button type="button" className="btn btn-sm btn-secondary" onClick={onClose}>
                          ไว้ทีหลัง
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {busy && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0' }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    {phase === 'done' ? '✅ ' : '⏳ '}
                    {statusText || 'กำลังอัปเดตระบบ...'}
                  </div>
                  <div style={{ width: '100%', height: 10, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.min(100, Math.max(8, progress))}%`,
                        height: '100%',
                        background: phase === 'done' ? '#16a34a' : 'linear-gradient(90deg, #2563eb, #0ea5e9)',
                        transition: 'width 0.4s ease',
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    กรุณาอย่าปิดหน้าต่างนี้ ระบบจะรีเฟรชหน้าเว็บให้อัตโนมัติเมื่ออัปเดตเสร็จสมบูรณ์
                  </div>
                </div>
              )}

              {phase === 'error' && (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      onClose();
                      onOpenAdvancedSettings();
                    }}
                  >
                    ⚙️ เปิดหน้าอัปเดตขั้นสูง
                  </button>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="btn btn-secondary" onClick={onClose}>ปิด</button>
                    <button type="button" className="btn btn-primary" onClick={() => void handleOneClickUpdate()}>
                      🔄 ลองอัปเดตอีกครั้ง
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
