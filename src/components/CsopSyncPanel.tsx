import React, { useState, useEffect, useRef } from 'react';

export interface CsopConfig {
  hcode: string;
  username: string;
  hasPassword?: boolean;
  password?: string;
  autoDownload: boolean;
  autoImport: boolean;
  headless: boolean;
}

interface CsopStatus {
  alive: boolean;
  ready: boolean;
  phase: string;
  message: string;
  url: string | null;
  title: string | null;
  screenshotDataUrl: string | null;
  error: string | null;
}

interface InspectionLink {
  text: string;
  href: string;
  id?: string | null;
  className?: string | null;
}

interface InspectionTable {
  tableIndex: number;
  headers: string[];
  rowCount: number;
  sampleRows: Array<{
    cells: string[];
    downloadLinks: Array<{ text: string; href: string }>;
  }>;
}

interface Props {
  onImportTriggered?: () => void;
  defaultOpen?: boolean;
}

export const CsopSyncPanel: React.FC<Props> = ({ onImportTriggered, defaultOpen = true }) => {
  void onImportTriggered;
  const [open, setOpen] = useState(defaultOpen);
  const [showSettings, setShowSettings] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  // Config State
  const [hcode, setHcode] = useState('11101');
  const [username, setUsername] = useState('jirawan11101');
  const [password, setPassword] = useState('jirawan11101');
  const [hasPassword, setHasPassword] = useState(true);
  const [autoDownload, setAutoDownload] = useState(true);
  const [autoImport, setAutoImport] = useState(true);
  const [headless, setHeadless] = useState(false);

  // Status State
  const [status, setStatus] = useState<CsopStatus>({
    alive: false,
    ready: false,
    phase: 'closed',
    message: 'ยังไม่ได้เริ่มเชื่อมต่อ CSOP',
    url: null,
    title: null,
    screenshotDataUrl: null,
    error: null,
  });

  const [loading, setLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Page inspection state
  const [inspectData, setInspectData] = useState<{
    links: InspectionLink[];
    tables: InspectionTable[];
  } | null>(null);
  const [inspecting, setInspecting] = useState(false);

  const imgRef = useRef<HTMLImageElement>(null);

  // Load config on mount
  useEffect(() => {
    fetch('/api/csop/config')
      .then((res) => res.json())
      .then((res) => {
        if (res.success && res.data) {
          setHcode(res.data.hcode || '11101');
          setUsername(res.data.username || 'jirawan11101');
          setHasPassword(Boolean(res.data.hasPassword));
          setAutoDownload(Boolean(res.data.autoDownload));
          setAutoImport(Boolean(res.data.autoImport));
          setHeadless(Boolean(res.data.headless));
        }
      })
      .catch(() => {});
  }, []);

  // Poll status when panel is open or browser is alive
  useEffect(() => {
    if (!open && !status.alive && !modalOpen) return;

    let active = true;
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/csop/browser-status', { cache: 'no-store' });
        const data = (await res.json()) as { success: boolean } & CsopStatus;
        if (!active) return;
        setStatus({
          alive: Boolean(data.alive),
          ready: Boolean(data.ready),
          phase: String(data.phase || 'closed'),
          message: String(data.message || ''),
          url: data.url || null,
          title: data.title || null,
          screenshotDataUrl: data.screenshotDataUrl || null,
          error: data.error || null,
        });

        if (data.ready && modalOpen) {
          // Keep modal open briefly to show success, or auto-close
          setTimeout(() => {
            if (active) setModalOpen(false);
          }, 1500);
        }
      } catch {
        /* ignore network drop */
      }
    };

    const interval = setInterval(checkStatus, modalOpen ? 1500 : 3000);
    void checkStatus();

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [open, status.alive, modalOpen]);

  const handleSaveConfig = async () => {
    setLoading(true);
    setActionMessage(null);
    try {
      const res = await fetch('/api/csop/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hcode,
          username,
          password: password || undefined,
          autoDownload,
          autoImport,
          headless,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage('✅ บันทึกการตั้งค่าสำเร็จ');
        setHasPassword(Boolean(data.data?.hasPassword));
        setPassword('');
      } else {
        setActionMessage(`⚠️ ${data.error || 'บันทึกไม่สำเร็จ'}`);
      }
    } catch (err) {
      setActionMessage(`⚠️ ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStartBrowser = async () => {
    setLoading(true);
    setActionMessage(null);
    setModalOpen(true);
    try {
      const res = await fetch('/api/csop/browser-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hcode,
          username,
          password: password || undefined,
          headless,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus((prev) => ({
          ...prev,
          alive: true,
          phase: data.phase || 'opening',
          message: data.message || 'กำลังเปิดหน้าเว็บ CSOP...',
          screenshotDataUrl: data.screenshotDataUrl || null,
        }));
      } else {
        setActionMessage(`⚠️ ${data.error || 'เปิดเชื่อมต่อไม่สำเร็จ'}`);
      }
    } catch (err) {
      setActionMessage(`⚠️ ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCloseBrowser = async () => {
    setLoading(true);
    try {
      await fetch('/api/csop/browser-close', { method: 'POST' });
      setStatus((prev) => ({
        ...prev,
        alive: false,
        ready: false,
        phase: 'closed',
        message: 'ปิดการเชื่อมต่อแล้ว',
        screenshotDataUrl: null,
      }));
      setModalOpen(false);
      setInspectData(null);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  // Handle clicking on the remote browser screenshot
  const handleScreenshotClick = async (e: React.MouseEvent<HTMLImageElement>) => {
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const naturalWidth = imgRef.current.naturalWidth || rect.width;
    const naturalHeight = imgRef.current.naturalHeight || rect.height;

    const scaleX = naturalWidth / rect.width;
    const scaleY = naturalHeight / rect.height;

    const clickX = Math.round((e.clientX - rect.left) * scaleX);
    const clickY = Math.round((e.clientY - rect.top) * scaleY);

    try {
      const res = await fetch('/api/csop/browser-click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: clickX, y: clickY }),
      });
      const data = await res.json();
      if (data.screenshotDataUrl) {
        setStatus((prev) => ({
          ...prev,
          screenshotDataUrl: data.screenshotDataUrl,
          message: data.message || prev.message,
          phase: data.phase || prev.phase,
          ready: Boolean(data.ready),
        }));
      }
    } catch {
      /* ignore */
    }
  };

  const handleAutoClickVerify = async () => {
    try {
      const res = await fetch('/api/csop/auto-click-turnstile', { method: 'POST' });
      const data = await res.json();
      if (data.screenshotDataUrl) {
        setStatus((prev) => ({
          ...prev,
          screenshotDataUrl: data.screenshotDataUrl,
          message: data.message || prev.message,
          phase: data.phase || prev.phase,
          ready: Boolean(data.ready),
        }));
      }
    } catch {
      /* ignore */
    }
  };

  const handleRefill = async () => {
    try {
      const res = await fetch('/api/csop/refill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hcode, username, password }),
      });
      const data = await res.json();
      if (data.screenshotDataUrl) {
        setStatus((prev) => ({
          ...prev,
          screenshotDataUrl: data.screenshotDataUrl,
          message: data.message || prev.message,
          phase: data.phase || prev.phase,
          ready: Boolean(data.ready),
        }));
      }
    } catch {
      /* ignore */
    }
  };

  const handleInspectPage = async () => {
    setInspecting(true);
    try {
      const res = await fetch('/api/csop/inspect-page', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setInspectData({ links: data.links || [], tables: data.tables || [] });
      } else {
        alert(data.error || 'สำรวจหน้าไม่สำเร็จ');
      }
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setInspecting(false);
    }
  };

  const handleNavigate = async (url: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/csop/navigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus((prev) => ({
          ...prev,
          url: data.url,
          title: data.title,
          message: `เปิดหน้า ${data.title || url} แล้ว`,
        }));
        // Re-inspect newly navigated page
        void handleInspectPage();
      } else {
        alert(data.error || 'เปลี่ยนหน้าไม่สำเร็จ');
      }
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      {/* Card Header */}
      <div
        className="card-header"
        style={{ cursor: 'pointer' }}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="card-title">
          🏥 CSOP (สกส. กรมบัญชีกลาง / อปท.) Auto Download — ดึงไฟล์ REP / STM อัตโนมัติ
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {status.ready ? (
            <span className="badge badge-success" style={{ fontSize: 11 }}>
              ✅ เชื่อมต่อ CSOP พร้อมใช้งาน
            </span>
          ) : status.alive ? (
            <span className="badge badge-warning" style={{ fontSize: 11 }}>
              ⏳ กำลังเชื่อมต่อ ({status.phase})
            </span>
          ) : (
            <span className="badge badge-secondary" style={{ fontSize: 11 }}>
              ⏸️ ยังไม่ได้เชื่อมต่อ
            </span>
          )}
          <span style={{ fontSize: 18 }}>{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Card Body */}
      {open && (
        <div className="card-body">
          {/* Info Banner */}
          <div
            className="alert alert-info"
            style={{
              marginBottom: 12,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <div>
              <span>ℹ️ </span>
              <span>
                ระบบ <strong>CSOP (สกส.) Auto Sync</strong>: เชื่อมต่อไปยังระบบธุรกรรมข้อมูลผู้ป่วยนอกข้าราชการ{' '}
                <strong>https://cs8.chi.or.th/csopupload</strong> อัตโนมัติ
                (รหัส รพ. <strong>{hcode}</strong>, ผู้ใช้งาน <strong>{username}</strong>)
                เพื่อดึงไฟล์ <strong>REP และ STM (COCD)</strong> สำหรับสิทธิข้าราชการ/อปท. เข้าสู่ฐานข้อมูล
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: 12, padding: '4px 10px' }}
                onClick={() => setShowSettings((v) => !v)}
              >
                ⚙️ {showSettings ? 'ซ่อนการตั้งค่า' : 'ตั้งค่าบัญชี CSOP'}
              </button>
            </div>
          </div>

          {/* Collapsible Settings Drawer */}
          {showSettings && (
            <div
              style={{
                background: 'var(--bg-secondary, #f8fafc)',
                border: '1px solid var(--border-color, #cbd5e1)',
                borderRadius: 8,
                padding: 14,
                marginBottom: 14,
                fontSize: 12,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 13 }}>
                ⚙️ ตั้งค่าบัญชีและระบบเชื่อมต่อ CSOP
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: 10,
                  marginBottom: 10,
                }}
              >
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">รหัสโรงพยาบาล (5 หลัก)</label>
                  <input
                    type="text"
                    className="form-control"
                    maxLength={5}
                    value={hcode}
                    onChange={(e) => setHcode(e.target.value.trim().toUpperCase())}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">รหัสผู้ใช้งาน (Username)</label>
                  <input
                    type="text"
                    className="form-control"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.trim())}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">
                    รหัสผ่าน {hasPassword ? <span style={{ color: '#16a34a' }}>(บันทึกแล้ว)</span> : null}
                  </label>
                  <input
                    type="password"
                    className="form-control"
                    placeholder={hasPassword ? '•••••••• (เว้นว่างหากไม่เปลี่ยน)' : 'ระบุรหัสผ่าน CSOP'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={autoImport}
                    onChange={(e) => setAutoImport(e.target.checked)}
                  />
                  <span>นำเข้าไฟล์ REP / STM เข้าฐานข้อมูลทันทีเมื่อดาวน์โหลด</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={headless}
                    onChange={(e) => setHeadless(e.target.checked)}
                  />
                  <span>รันเบราว์เซอร์แบบพื้นหลัง (Headless Mode)</span>
                </label>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ fontSize: 12, padding: '4px 12px', marginLeft: 'auto' }}
                  onClick={handleSaveConfig}
                  disabled={loading}
                >
                  💾 บันทึกการตั้งค่า
                </button>
              </div>
            </div>
          )}

          {/* Connection Control & Status Area */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '12px 16px',
              background: '#f1f5f9',
              borderRadius: 8,
              marginBottom: 14,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                className={`btn ${status.ready ? 'btn-success' : 'btn-primary'}`}
                style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                onClick={handleStartBrowser}
                disabled={loading}
              >
                {status.ready ? '🔄 รีเฟรช / ตรวจสอบการเชื่อมต่อ CSOP' : '🔐 เริ่มเชื่อมต่อ CSOP (สกส.)'}
              </button>

              {status.alive && !status.ready && (
                <button
                  type="button"
                  className="btn btn-warning"
                  style={{ fontSize: 12 }}
                  onClick={() => setModalOpen(true)}
                >
                  🖥️ เปิดหน้าจอยืนยันตัวตน (Verify)
                </button>
              )}

              {status.alive && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: 12 }}
                  onClick={handleCloseBrowser}
                  disabled={loading}
                >
                  ❌ ปิดการเชื่อมต่อ
                </button>
              )}
            </div>

            <div style={{ fontSize: 13, color: '#334155' }}>
              <strong>สถานะ:</strong> {status.message || 'พร้อมเริ่มเชื่อมต่อ'}
            </div>
          </div>

          {actionMessage && (
            <div className="alert alert-info" style={{ marginBottom: 12, fontSize: 13 }}>
              {actionMessage}
            </div>
          )}

          {/* Area Available when CSOP is Ready */}
          {status.ready && (
            <div
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: 16,
                background: '#ffffff',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 12,
                  flexWrap: 'wrap',
                  gap: 10,
                }}
              >
                <div>
                  <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
                    📋 ระบบนำทางและกวาดค้นหาไฟล์ CSOP
                  </h4>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                    หน้าปัจจุบัน: <strong>{status.title || status.url}</strong> ({status.url})
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ fontSize: 12, fontWeight: 600 }}
                    onClick={handleInspectPage}
                    disabled={inspecting}
                  >
                    {inspecting ? '⏳ กำลังสำรวจหน้า...' : '🔍 สำรวจเมนูและตารางในหน้าปัจจุบัน'}
                  </button>
                </div>
              </div>

              {/* Inspection Results */}
              {inspectData && (
                <div style={{ marginTop: 14 }}>
                  {/* Found Menus / Links */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
                      🔗 เมนูและลิงก์ที่พบในหน้า ({inspectData.links.length} รายการ):
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 6,
                        maxHeight: 140,
                        overflowY: 'auto',
                        padding: 8,
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: 6,
                      }}
                    >
                      {inspectData.links.map((link, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className="btn btn-secondary"
                          style={{ fontSize: 11, padding: '3px 8px' }}
                          onClick={() => handleNavigate(link.href)}
                          title={link.href}
                        >
                          👉 {link.text}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Found Tables */}
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
                      📊 ตารางข้อมูล / ไฟล์ในหน้า ({inspectData.tables.length} ตาราง):
                    </div>
                    {inspectData.tables.length === 0 ? (
                      <div style={{ fontSize: 12, color: '#64748b', padding: 8 }}>
                        ไม่พบตารางไฟล์ในหน้านี้ (กรุณากดคลิกเลือกเมนูที่เกี่ยวข้อง เช่น รายงาน หรือ ผลการตรวจ)
                      </div>
                    ) : (
                      inspectData.tables.map((tbl, tIdx) => (
                        <div
                          key={tIdx}
                          style={{
                            marginBottom: 12,
                            border: '1px solid #e2e8f0',
                            borderRadius: 6,
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              background: '#f1f5f9',
                              padding: '6px 12px',
                              fontSize: 12,
                              fontWeight: 600,
                            }}
                          >
                            ตารางที่ {tIdx + 1} ({tbl.rowCount} แถว)
                          </div>
                          <div style={{ overflowX: 'auto', maxHeight: 240 }}>
                            <table className="table table-bordered table-sm" style={{ margin: 0, fontSize: 12 }}>
                              <thead>
                                <tr>
                                  {tbl.headers.map((h, hIdx) => (
                                    <th key={hIdx}>{h}</th>
                                  ))}
                                  <th>การกระทำ</th>
                                </tr>
                              </thead>
                              <tbody>
                                {tbl.sampleRows.map((row, rIdx) => (
                                  <tr key={rIdx}>
                                    {row.cells.map((cell, cIdx) => (
                                      <td key={cIdx}>{cell}</td>
                                    ))}
                                    <td>
                                      {row.downloadLinks.map((dl, dIdx) => (
                                        <a
                                          key={dIdx}
                                          href={dl.href}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="btn btn-primary"
                                          style={{ fontSize: 11, padding: '2px 6px' }}
                                        >
                                          ⬇️ {dl.text || 'ดาวน์โหลด'}
                                        </a>
                                      ))}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Interactive Cloudflare Verification Popup Modal */}
          {modalOpen && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 9999,
                background: 'rgba(15, 23, 42, 0.75)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16,
              }}
              onClick={() => setModalOpen(false)}
            >
              <div
                style={{
                  background: '#ffffff',
                  borderRadius: 14,
                  maxWidth: 960,
                  width: '100%',
                  maxHeight: '92vh',
                  display: 'flex',
                  flexDirection: 'column',
                  boxShadow: '0 25px 50px -12px rgba(0,0,0,0.45)',
                  overflow: 'hidden',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Modal Header */}
                <div
                  style={{
                    padding: '14px 18px',
                    background: 'linear-gradient(135deg, #0d9488, #0f766e)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>
                      🏥 ยืนยันตัวตนเข้าสู่ระบบ CSOP Web Application
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>
                      {status.message}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-warning"
                      style={{
                        fontSize: 12,
                        padding: '4px 10px',
                        background: '#f59e0b',
                        color: '#fff',
                        border: 'none',
                        fontWeight: 700,
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                      }}
                      onClick={handleAutoClickVerify}
                      title="ส่งคำสั่งให้เซิร์ฟเวอร์คลิกกล่อง Turnstile อัตโนมัติ"
                    >
                      ⚡ คลิก Verify อัตโนมัติ
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{
                        fontSize: 12,
                        padding: '4px 10px',
                        background: 'rgba(255,255,255,0.25)',
                        color: '#fff',
                        border: '1px solid rgba(255,255,255,0.4)',
                        fontWeight: 600,
                      }}
                      onClick={handleRefill}
                      title="กรอก User / Password อีกครั้งหากช่องว่างเปล่า"
                    >
                      🔑 กรอกรหัสใหม่
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{
                        fontSize: 12,
                        padding: '4px 10px',
                        background: '#fff',
                        color: '#0f766e',
                        border: 'none',
                        fontWeight: 600,
                      }}
                      onClick={handleStartBrowser}
                    >
                      🔄 รีเฟรชหน้า
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{
                        fontSize: 12,
                        padding: '4px 10px',
                        background: 'rgba(255,255,255,0.2)',
                        color: '#fff',
                        border: 'none',
                      }}
                      onClick={() => setModalOpen(false)}
                    >
                      ย่อหน้าต่าง ✕
                    </button>
                  </div>
                </div>

                {/* Modal Body */}
                <div
                  style={{
                    padding: 16,
                    overflowY: 'auto',
                    background: '#f8fafc',
                    textAlign: 'center',
                  }}
                >
                  {status.ready ? (
                    <div style={{ padding: '40px 20px' }}>
                      <div style={{ fontSize: 48, marginBottom: 10 }}>🎉</div>
                      <h3 style={{ color: '#0f766e', fontWeight: 700 }}>เข้าสู่ระบบ CSOP สำเร็จเรียบร้อย!</h3>
                      <p style={{ color: '#64748b', fontSize: 14 }}>
                        ระบบพร้อมสำหรับการกวาดค้นหาและดาวน์โหลดไฟล์ REP / STM อัตโนมัติแล้ว
                      </p>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => setModalOpen(false)}
                      >
                        เข้าสู่หน้าจัดการไฟล์
                      </button>
                    </div>
                  ) : status.screenshotDataUrl ? (
                    <div>
                      <div
                        style={{
                          background: '#f0fdf4',
                          border: '1px solid #bbf7d0',
                          color: '#166534',
                          padding: '10px 14px',
                          borderRadius: 8,
                          fontSize: 13,
                          marginBottom: 12,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 12,
                          flexWrap: 'wrap',
                          justifyContent: 'center',
                          maxWidth: '90%',
                        }}
                      >
                        <span>
                          👆 ระบบกรอกรหัส รพ. <strong>{hcode}</strong> และผู้ใช้งาน <strong>{username}</strong> ให้แล้ว — คลิกที่กล่อง <strong>"Verify you are human"</strong> บนหน้าจอด้านล่าง หรือกดปุ่ม:
                        </span>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            type="button"
                            className="btn btn-sm btn-warning"
                            onClick={handleAutoClickVerify}
                            style={{ fontWeight: 700, fontSize: 12, padding: '4px 10px' }}
                          >
                            ⚡ คลิก Verify ทันที
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary"
                            onClick={handleRefill}
                            style={{ fontSize: 12, padding: '4px 10px', background: '#fff' }}
                          >
                            🔑 กรอกรหัสใหม่
                          </button>
                        </div>
                      </div>
                      <div
                        style={{
                          display: 'inline-block',
                          border: '2px solid #cbd5e1',
                          borderRadius: 8,
                          overflow: 'hidden',
                          cursor: 'crosshair',
                          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                        }}
                      >
                        <img
                          ref={imgRef}
                          src={status.screenshotDataUrl}
                          alt="CSOP Login Screen"
                          style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
                          onClick={handleScreenshotClick}
                          title="คลิกที่กล่องเพื่อส่งการคลิกไปยังเบราว์เซอร์"
                        />
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: '40px 20px', color: '#64748b' }}>
                      <div className="spinner-border spinner-border-sm mr-2" />
                      กำลังโหลดหน้าจอ CSOP...
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
