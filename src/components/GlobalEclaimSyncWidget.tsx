import React, { useEffect, useState, useRef } from 'react';
import './GlobalEclaimSyncWidget.css';

export interface EclaimWorkerProgress {
  jobId: string;
  running: boolean;
  phase: 'idle' | 'starting' | 'navigating' | 'scraping' | 'downloading' | 'importing' | 'completed' | 'stopped' | 'error';
  message: string;
  portal: 'new_client' | 'legacy_webcomponent' | 'both';
  currentPage: number;
  totalPages: number;
  totalFound: number;
  downloadedCount: number;
  importedCount: number;
  skippedCount: number;
  errorCount: number;
  currentFilename: string | null;
  startTime: string | null;
  endTime: string | null;
  logs: Array<{ time: string; type: 'info' | 'success' | 'warning' | 'error'; text: string }>;
}

export const GlobalEclaimSyncWidget: React.FC = () => {
  const [status, setStatus] = useState<EclaimWorkerProgress | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/nhso-eclaim/worker-status');
      if (res.ok) {
        const data = await res.json() as EclaimWorkerProgress & { success: boolean };
        if (data.success !== false) {
          setStatus(data);
        }
      }
    } catch {
      // ignore network glitch
    }
  };

  useEffect(() => {
    void fetchStatus();
    const intervalMs = status?.running ? 2500 : 8000;
    const timer = setInterval(() => {
      void fetchStatus();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [status?.running]);

  const handleStart = async (maxPages = 5) => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/nhso-eclaim/worker-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxPages }),
      });
      const data = await res.json() as { success: boolean; message: string };
      if (!data.success) {
        alert(data.message || 'เริ่มงานไม่สำเร็จ กรุณาสแกน ThaID ก่อน');
      } else {
        void fetchStatus();
      }
    } catch (e: any) {
      alert(`เกิดข้อผิดพลาด: ${e.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleStop = async () => {
    setActionLoading(true);
    try {
      await fetch('/api/nhso-eclaim/worker-stop', { method: 'POST' });
      void fetchStatus();
    } catch {
      // ignore
    } finally {
      setActionLoading(false);
    }
  };

  const isRunning = Boolean(status?.running);
  const isCompleted = status?.phase === 'completed';
  const isError = status?.phase === 'error';

  return (
    <>
      {/* ── Top-Right Pill Trigger in Navbar ── */}
      <button
        type="button"
        className={`nav-global-eclaim-pill ${isRunning ? 'is-running' : isCompleted ? 'is-completed' : isError ? 'is-error' : 'is-idle'}`}
        onClick={() => setModalOpen(true)}
        title="คลิกเพื่อดูสถานะการนำเข้าข้อมูล e-Claim ในพื้นหลัง"
      >
        {isRunning ? (
          <>
            <span className="eclaim-pill-spinner" />
            <span className="eclaim-pill-text">
              e-Claim: นำเข้าหน้า {status?.currentPage || 1}/{status?.totalPages || '...'} (+{status?.importedCount || 0})
            </span>
          </>
        ) : isCompleted ? (
          <>
            <span>✅</span>
            <span className="eclaim-pill-text">e-Claim สำเร็จ (+{status?.importedCount || 0})</span>
          </>
        ) : isError ? (
          <>
            <span>⚠️</span>
            <span className="eclaim-pill-text">e-Claim ขัดข้อง</span>
          </>
        ) : (
          <>
            <span>☁️</span>
            <span className="eclaim-pill-text">ซิงค์ e-Claim</span>
          </>
        )}
      </button>

      {/* ── Global Floating Monitor Modal / Drawer ── */}
      {modalOpen && (
        <div className="eclaim-modal-backdrop" onClick={() => setModalOpen(false)}>
          <div className="eclaim-floating-panel" onClick={(e) => e.stopPropagation()}>
            <div className="eclaim-panel-header">
              <div className="eclaim-panel-title">
                <span className="eclaim-panel-icon">📡</span>
                <div>
                  <strong>ระบบซิงค์ e-Claim ในพื้นหลัง</strong>
                  <div className="eclaim-panel-sub">ทำงานเบื้องหลังอัตโนมัติ สลับไปหน้าอื่นได้ตลอดเวลา</div>
                </div>
              </div>
              <button type="button" className="eclaim-panel-close" onClick={() => setModalOpen(false)}>
                ✕
              </button>
            </div>

            {/* Status bar & progress */}
            <div className="eclaim-panel-body">
              <div className="eclaim-status-banner">
                <div className="eclaim-status-left">
                  <span className={`eclaim-phase-tag phase-${status?.phase || 'idle'}`}>
                    {status?.phase === 'downloading'
                      ? 'กำลังดาวน์โหลด'
                      : status?.phase === 'importing'
                      ? 'กำลังนำเข้าฐานข้อมูล'
                      : status?.phase === 'scraping'
                      ? 'กำลังอ่านรายชื่อไฟล์'
                      : status?.phase === 'navigating'
                      ? 'กำลังเปิดหน้าเว็บ'
                      : status?.phase === 'completed'
                      ? 'เสร็จสิ้นเรียบร้อย'
                      : status?.phase === 'stopped'
                      ? 'หยุดการทำงาน'
                      : status?.phase === 'error'
                      ? 'เกิดข้อผิดพลาด'
                      : 'พร้อมทำงาน'}
                  </span>
                  <span className="eclaim-banner-msg">{status?.message || 'พร้อมเริ่มงาน'}</span>
                </div>
                {status?.startTime && (
                  <div className="eclaim-status-time">
                    เริ่ม: {status.startTime} {status.endTime ? `· เสร็จ: ${status.endTime}` : ''}
                  </div>
                )}
              </div>

              {/* Progress metrics */}
              <div className="eclaim-metrics-grid">
                <div className="eclaim-metric-card">
                  <span>หน้าที่กำลังตรวจ</span>
                  <strong>{status?.currentPage || 0} / {status?.totalPages || '-'}</strong>
                </div>
                <div className="eclaim-metric-card">
                  <span>ดาวน์โหลดแล้ว</span>
                  <strong>{status?.downloadedCount || 0} ไฟล์</strong>
                </div>
                <div className="eclaim-metric-card metric-success">
                  <span>นำเข้าสำเร็จ</span>
                  <strong>{status?.importedCount || 0} ไฟล์</strong>
                </div>
                <div className="eclaim-metric-card metric-muted">
                  <span>มีอยู่แล้ว (ข้าม)</span>
                  <strong>{status?.skippedCount || 0} ไฟล์</strong>
                </div>
              </div>

              {/* Current Active File */}
              {status?.currentFilename && (
                <div className="eclaim-current-file">
                  <span className="file-spinner" />
                  <span>กำลังดำเนินการ: <b>{status.currentFilename}</b></span>
                </div>
              )}

              {/* Real-time Log Stream */}
              <div className="eclaim-logs-section">
                <div className="eclaim-logs-title">
                  <span>บันทึกการทำงานสด (Live Logs)</span>
                  <small>{status?.logs?.length || 0} รายการ</small>
                </div>
                <div className="eclaim-logs-box" ref={logContainerRef}>
                  {!status?.logs || status.logs.length === 0 ? (
                    <div className="eclaim-log-empty">ยังไม่มีบันทึกการทำงาน</div>
                  ) : (
                    status.logs.map((log, idx) => (
                      <div key={`${log.time}-${idx}`} className={`eclaim-log-entry log-${log.type}`}>
                        <span className="log-time">{log.time}</span>
                        <span className="log-text">{log.text}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Panel Footer Actions */}
            <div className="eclaim-panel-footer">
              <div className="eclaim-footer-left">
                {isRunning ? (
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={handleStop}
                    disabled={actionLoading}
                  >
                    🛑 หยุดการทำงาน
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => handleStart(5)}
                    disabled={actionLoading}
                  >
                    🚀 เริ่มซิงค์ 5 หน้าล่าสุด
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => {
                    setModalOpen(false);
                    window.dispatchEvent(new CustomEvent('fdh:navigate', { detail: { page: 'repstm' } }));
                  }}
                >
                  📂 ไปที่หน้านำเข้า REP/STM
                </button>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setModalOpen(false)}
              >
                ปิดหน้าต่าง (ให้ทำงานต่อในพื้นหลัง)
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
export default GlobalEclaimSyncWidget;
