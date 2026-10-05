import React, { useState, useEffect, useCallback } from 'react';
import '../styles/Settings.css';

export interface TableCheckItem {
  table: string;
  required: boolean;
  exists: boolean;
  missingColumns?: string[];
  description: string;
}

export interface CatalogCheckItem {
  catalog: string;
  total: number;
  ready: number;
  percent: number;
  description: string;
  status: 'good' | 'warning' | 'critical';
}

export interface FeatureCapabilityItem {
  id: string;
  name: string;
  status: 'ready' | 'needs_config' | 'partial' | 'disabled';
  statusLabel: string;
  details: string;
  actionTab?: string;
}

export interface HospitalReadinessReport {
  timestamp: string;
  hospital: {
    hospital_code: string;
    hospital_name: string;
    database_type: 'mysql' | 'postgresql';
    database_name: string;
  };
  overallScore: number;
  readinessLevel: 'READY' | 'NEEDS_ATTENTION' | 'INCOMPLETE';
  schemaChecks: TableCheckItem[];
  catalogChecks: CatalogCheckItem[];
  authenSource: {
    detectedSources: string[];
    primarySource: string;
    status: 'ready' | 'partial' | 'missing';
  };
  capabilities: FeatureCapabilityItem[];
  recommendations: string[];
}

interface HospitalReadinessPanelProps {
  onNavigateTab?: (tab: string) => void;
}

export const HospitalReadinessPanel: React.FC<HospitalReadinessPanelProps> = ({ onNavigateTab }) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<HospitalReadinessReport | null>(null);

  const fetchReadiness = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/system/hospital-readiness', { headers });
      const body = await res.json().catch(() => ({}));

      if (!res.ok || !body.success) {
        throw new Error(body.error || 'ไม่สามารถตรวจสอบความพร้อมของระบบได้');
      }

      setReport(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการโหลดผลตรวจ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchReadiness();
  }, [fetchReadiness]);

  const getScoreColor = (score: number) => {
    if (score >= 85) return '#10b981'; // Green
    if (score >= 60) return '#f59e0b'; // Amber
    return '#ef4444'; // Red
  };

  const getLevelBadge = (level: string) => {
    switch (level) {
      case 'READY':
        return <span className="settings-status-chip is-ok" style={{ fontSize: '0.9rem', fontWeight: 700 }}>✅ พร้อมใช้งานเต็มรูปแบบ</span>;
      case 'NEEDS_ATTENTION':
        return <span className="settings-status-chip is-warning" style={{ fontSize: '0.9rem', fontWeight: 700 }}>⚠️ ใช้งานได้บางส่วน (ต้องตั้งค่าเพิ่มเติม)</span>;
      default:
        return <span className="settings-status-chip" style={{ fontSize: '0.9rem', fontWeight: 700, color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.1)' }}>❌ ยังไม่พร้อม (ขาดข้อมูลสำคัญ)</span>;
    }
  };

  const getCapabilityBadge = (status: FeatureCapabilityItem['status'], label: string) => {
    switch (status) {
      case 'ready':
        return <span className="settings-status-chip is-ok">✅ {label}</span>;
      case 'needs_config':
        return <span className="settings-status-chip is-warning">⚙️ {label}</span>;
      case 'partial':
        return <span className="settings-status-chip" style={{ color: '#0284c7', borderColor: 'rgba(2,132,199,0.3)', background: 'rgba(2,132,199,0.08)' }}>ℹ️ {label}</span>;
      default:
        return <span className="settings-status-chip">⚪ {label}</span>;
    }
  };

  return (
    <div className="settings-section" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', background: 'var(--card-bg, #fff)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color, #e2e8f0)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-main, #0f172a)' }}>
              🩺 ตรวจความพร้อมระบบ & ความเข้ากันได้ของ HOSxP
            </h2>
            {report && getLevelBadge(report.readinessLevel)}
          </div>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted, #64748b)', fontSize: '0.88rem' }}>
            ประเมินโครงสร้างตาราง HOSxP, คุณภาพชุดข้อมูล Master Data (TMT/ADP/สิทธิ), และความพร้อมในการเชื่อมต่อก่อนใช้งานจริง
          </p>
        </div>

        <button
          type="button"
          onClick={fetchReadiness}
          disabled={loading}
          className="settings-action-btn"
          style={{ minWidth: '150px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
        >
          {loading ? '⏳ กำลังสแกน...' : '🔄 สแกนความพร้อมใหม่'}
        </button>
      </div>

      {error && (
        <div className="settings-load-error">
          <div>
            <strong>ไม่สามารถสแกนความพร้อมของระบบได้:</strong> {error}
          </div>
          <button type="button" onClick={fetchReadiness} className="settings-action-btn" style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
            ลองอีกครั้ง
          </button>
        </div>
      )}

      {loading && !report && (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: 'var(--card-bg, #fff)', borderRadius: '12px', border: '1px solid var(--border-color, #e2e8f0)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '12px' }}>🔍</div>
          <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>กำลังตรวจสอบโครงสร้างฐานข้อมูล HOSxP และแคตตาล็อกยา/หัตถการ...</div>
          <div style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.88rem', marginTop: '4px' }}>ระบบกำลังวิเคราะห์ตารางและคำนวณคะแนนความพร้อม กรุณารอสักครู่</div>
        </div>
      )}

      {report && (
        <>
          {/* Hospital Identity & Overall Score Gauge */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
            {/* Score Card */}
            <div style={{ background: 'var(--card-bg, #fff)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border-color, #e2e8f0)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted, #64748b)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  คะแนนความพร้อมโดยรวม (Hospital Readiness Score)
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginTop: '12px' }}>
                  <span style={{ fontSize: '3.2rem', fontWeight: 900, color: getScoreColor(report.overallScore), lineHeight: 1 }}>
                    {report.overallScore}
                  </span>
                  <span style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-muted, #64748b)' }}>/ 100</span>
                </div>
                <div style={{ marginTop: '14px', height: '10px', background: 'rgba(148, 163, 184, 0.2)', borderRadius: '999px', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${report.overallScore}%`,
                      backgroundColor: getScoreColor(report.overallScore),
                      transition: 'width 0.8s ease',
                      borderRadius: '999px',
                    }}
                  />
                </div>
              </div>

              <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-color, #e2e8f0)', fontSize: '0.85rem', color: 'var(--text-muted, #64748b)' }}>
                สแกนล่าสุดเมื่อ: {new Date(report.timestamp).toLocaleString('th-TH')}
              </div>
            </div>

            {/* Hospital Target Profile */}
            <div style={{ background: 'var(--card-bg, #fff)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border-color, #e2e8f0)' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted, #64748b)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                ข้อมูลหน่วยบริการเป้าหมาย (Target HOSxP Site)
              </div>
              <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div>
                  <span style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.85rem' }}>ชื่อโรงพยาบาล: </span>
                  <strong style={{ fontSize: '1.05rem', color: 'var(--text-main, #0f172a)' }}>{report.hospital.hospital_name || '-'}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.85rem' }}>รหัสหน่วยบริการ (HCODE): </span>
                  <strong style={{ fontSize: '1rem', color: 'var(--text-main, #0f172a)', fontFamily: 'monospace' }}>{report.hospital.hospital_code || 'ยังไม่ได้ระบุ'}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.85rem' }}>ประเภทฐานข้อมูล: </span>
                  <span className="settings-status-chip" style={{ marginLeft: '4px' }}>
                    {report.hospital.database_type.toUpperCase()} ({report.hospital.database_name})
                  </span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.85rem' }}>แหล่งรหัส Authen สปสช.: </span>
                  <strong style={{ fontSize: '0.9rem', color: report.authenSource.status === 'ready' ? 'var(--success, #10b981)' : '#b45309' }}>
                    {report.authenSource.primarySource}
                  </strong>
                </div>
              </div>
            </div>
          </div>

          {/* Actionable Recommendations */}
          {report.recommendations.length > 0 && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '12px', padding: '20px' }}>
              <h3 style={{ margin: '0 0 12px', fontSize: '1.05rem', fontWeight: 700, color: '#92400e', display: 'flex', alignItems: 'center', gap: '8px' }}>
                💡 ข้อแนะนำเพื่อการตั้งค่าและเปิดใช้งานอย่างสมบูรณ์ ({report.recommendations.length} รายการ)
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {report.recommendations.map((rec, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '0.9rem', color: '#78350f' }}>
                    <span style={{ fontWeight: 800 }}>•</span>
                    <span style={{ flex: 1 }}>{rec}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Feature Capability Matrix */}
          <div style={{ background: 'var(--card-bg, #fff)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border-color, #e2e8f0)' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main, #0f172a)' }}>
              🎯 เมทริกซ์ความพร้อมของฟังก์ชัน (Feature Capability Matrix)
            </h3>
            <p style={{ margin: '-10px 0 16px', fontSize: '0.85rem', color: 'var(--text-muted, #64748b)' }}>
              ประเมินความพร้อมใช้งานของแต่ละโมดูลตามโครงสร้างและการตั้งค่าปัจจุบัน
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '16px' }}>
              {report.capabilities.map((cap) => (
                <div
                  key={cap.id}
                  style={{
                    padding: '16px',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color, #e2e8f0)',
                    background: 'var(--background-soft, #f8fafc)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '12px',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '8px' }}>
                      <strong style={{ fontSize: '0.95rem', color: 'var(--text-main, #0f172a)' }}>{cap.name}</strong>
                      {getCapabilityBadge(cap.status, cap.statusLabel)}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted, #64748b)', lineHeight: 1.4 }}>
                      {cap.details}
                    </div>
                  </div>

                  {cap.actionTab && onNavigateTab && cap.status !== 'ready' && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '8px' }}>
                      <button
                        type="button"
                        onClick={() => onNavigateTab(cap.actionTab!)}
                        className="settings-action-btn"
                        style={{ fontSize: '0.78rem', padding: '4px 10px' }}
                      >
                        ⚙️ ไปหน้าตั้งค่า →
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Master Data Completeness */}
          <div style={{ background: 'var(--card-bg, #fff)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border-color, #e2e8f0)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main, #0f172a)' }}>
                  📦 ความสมบูรณ์ของชุดข้อมูล Master Data ใน HOSxP
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-muted, #64748b)' }}>
                  ความถูกต้องของรหัสมาตรฐานในตารางยา ค่าบริการ และสิทธิ มีผลโดยตรงต่อการผ่านการตรวจสอบ (Audit) ของ FDH และ สปสช.
                </p>
              </div>
              {onNavigateTab && (
                <button
                  type="button"
                  onClick={() => onNavigateTab('masterData')}
                  className="settings-action-btn"
                  style={{ background: '#3b82f6', color: '#fff', borderColor: '#2563eb', fontWeight: 700, fontSize: '0.85rem' }}
                >
                  ✏️ เติมข้อมูล & แก้ไขรหัสที่ไม่สมบูรณ์ →
                </button>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
              {report.catalogChecks.map((cat, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '16px',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color, #e2e8f0)',
                    background: 'var(--background-soft, #f8fafc)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <strong style={{ fontSize: '0.92rem', color: 'var(--text-main, #0f172a)' }}>{cat.catalog}</strong>
                    <span style={{ fontSize: '1.1rem', fontWeight: 800, color: cat.status === 'good' ? '#10b981' : cat.status === 'warning' ? '#f59e0b' : '#ef4444' }}>
                      {cat.percent}%
                    </span>
                  </div>

                  <div style={{ height: '8px', background: 'rgba(148, 163, 184, 0.2)', borderRadius: '999px', overflow: 'hidden', margin: '8px 0' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${cat.percent}%`,
                        backgroundColor: cat.status === 'good' ? '#10b981' : cat.status === 'warning' ? '#f59e0b' : '#ef4444',
                        borderRadius: '999px',
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted, #64748b)', marginTop: '6px' }}>
                    <span>สมบูรณ์แล้ว {cat.ready.toLocaleString()} รายการ</span>
                    <span>จากทั้งหมด {cat.total.toLocaleString()} รายการ</span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted, #64748b)', marginTop: '4px', fontStyle: 'italic' }}>
                    {cat.description}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Schema & Table Structure Checklist */}
          <div style={{ background: 'var(--card-bg, #fff)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border-color, #e2e8f0)' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main, #0f172a)' }}>
              📑 ตรวจสอบโครงสร้างตาราง HOSxP (Schema Integrity)
            </h3>
            <p style={{ margin: '-10px 0 16px', fontSize: '0.85rem', color: 'var(--text-muted, #64748b)' }}>
              ตรวจสอบความมีอยู่ของตารางหลักและคอลัมน์สำคัญที่ระบบเรียกอ่าน
            </p>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                <thead>
                  <tr style={{ background: 'var(--background-soft, #f8fafc)', borderBottom: '2px solid var(--border-color, #e2e8f0)', textAlign: 'left' }}>
                    <th style={{ padding: '10px 12px' }}>ชื่อตาราง (HOSxP Table)</th>
                    <th style={{ padding: '10px 12px' }}>ความสำคัญ</th>
                    <th style={{ padding: '10px 12px' }}>สถานะ</th>
                    <th style={{ padding: '10px 12px' }}>คำอธิบาย</th>
                    <th style={{ padding: '10px 12px' }}>คอลัมน์ที่ขาด</th>
                  </tr>
                </thead>
                <tbody>
                  {report.schemaChecks.map((row) => (
                    <tr key={row.table} style={{ borderBottom: '1px solid var(--border-color, #e2e8f0)' }}>
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 700 }}>
                        {row.table}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        {row.required ? (
                          <span style={{ color: '#ef4444', fontWeight: 600, fontSize: '0.78rem' }}>จำเป็น (Required)</span>
                        ) : (
                          <span style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.78rem' }}>เสริม (Optional)</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        {row.exists ? (
                          <span className="settings-status-chip is-ok" style={{ fontSize: '0.78rem' }}>พบตาราง</span>
                        ) : (
                          <span className="settings-status-chip" style={{ fontSize: '0.78rem', color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)' }}>
                            ไม่พบตาราง
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-muted, #64748b)' }}>
                        {row.description}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        {row.missingColumns && row.missingColumns.length > 0 ? (
                          <span style={{ color: '#ef4444', fontSize: '0.8rem', fontFamily: 'monospace' }}>
                            {row.missingColumns.join(', ')}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.8rem' }}>-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
