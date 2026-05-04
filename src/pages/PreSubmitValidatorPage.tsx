import { useState } from 'react';
import { formatLocalDateDaysAgo, formatLocalDateInput } from '../utils/dateUtils';

// แมปรหัส issue ไปยัง 16 แฟ้ม
const ISSUE_FILE_MAP: Record<string, string[]> = {
  ER101: ['INS', 'PAT'],
  ER102: ['ODX'],
  ER103: ['CHT', 'CHA'],
  ER105: ['INS'],
  ER106: ['OPD'],
  ER107: ['OPD'],
  ER108: ['INS'],
  ER201: ['ADP'],
  ER202: ['ADP'],
  ER203: ['ADP'],
  ER204: ['ADP'],
  ER205: ['ADP'],
  ER206: ['ADP'],
  ER207: ['ADP'],
  ER208: ['ADP'],
  ER209: ['ADP'],
  ER210: ['ADP'],
  ER211: ['ADP'],
  ER212: ['ADP'],
  ER213: ['ADP'],
};

const FILE_LABELS: Record<string, string> = {
  INS: 'INS - ข้อมูลสิทธิ์',
  PAT: 'PAT - ข้อมูลผู้ป่วย',
  OPD: 'OPD - ข้อมูลการตรวจ',
  ODX: 'ODX - การวินิจฉัย',
  ADP: 'ADP - บริการพิเศษ',
  CHT: 'CHT - ค่าบริการ',
  CHA: 'CHA - ค่าบริการอื่น',
};

const ISSUE_LABELS: Record<string, string> = {
  ER101: 'ขาด CID / ชื่อ-สกุล',
  ER102: 'ขาดการวินิจฉัย ICD-10',
  ER103: 'ขาดค่าบริการหรือยอดเป็น 0',
  ER105: 'ไม่ระบุสิทธิ์การรักษา',
  ER106: 'ขาดวันที่รับบริการ',
  ER107: 'ขาดเลข VN',
  ER108: 'ยังไม่ปิดสิทธิ EP',
  ER201: 'ADP: รหัสหัตถการไม่ถูกต้อง',
  ER202: 'ADP: ขาดรหัส ICD-9',
  ER203: 'ADP: กองทุนพิเศษ - ตรวจสอบ',
  ER204: 'ADP: กองทุนพิเศษ - ตรวจสอบ',
  ER205: 'ADP: กองทุนพิเศษ - ตรวจสอบ',
  ER206: 'ADP: กองทุนพิเศษ - ตรวจสอบ',
  ER207: 'ADP: กองทุนพิเศษ - ตรวจสอบ',
  ER208: 'ADP: กองทุนพิเศษ - ตรวจสอบ',
  ER209: 'ADP: กองทุนพิเศษ - ตรวจสอบ',
  ER210: 'ADP: กองทุนพิเศษ - ตรวจสอบ',
  ER211: 'ADP: กองทุนพิเศษ - ตรวจสอบ',
  ER212: 'ADP: กองทุนพิเศษ - ตรวจสอบ',
  ER213: 'ADP: กองทุนพิเศษ - ตรวจสอบ',
};

const isCritical = (code: string) => code.startsWith('ER1');

interface VisitRow {
  vn: string;
  hn: string;
  patient_name?: string;
  vstdate?: string;
  maininscl?: string;
  issues?: string[];
  status?: string;
  isPotentialClaim?: boolean;
  isBillable?: boolean;
}

interface FileSummary {
  fileCode: string;
  label: string;
  critical: number;
  warning: number;
  visits: Array<{ vn: string; hn: string; patient_name?: string; vstdate?: string; issue: string; isCritical: boolean }>;
}

function buildFileSummary(visits: VisitRow[]): FileSummary[] {
  const fileMap: Record<string, FileSummary> = {};

  for (const file of Object.keys(FILE_LABELS)) {
    fileMap[file] = { fileCode: file, label: FILE_LABELS[file], critical: 0, warning: 0, visits: [] };
  }

  for (const v of visits) {
    const issues = v.issues || [];
    for (const issue of issues) {
      const files = ISSUE_FILE_MAP[issue];
      if (!files) continue;
      for (const f of files) {
        if (!fileMap[f]) continue;
        const entry = {
          vn: v.vn,
          hn: v.hn,
          patient_name: v.patient_name,
          vstdate: v.vstdate,
          issue,
          isCritical: isCritical(issue),
        };
        fileMap[f].visits.push(entry);
        if (isCritical(issue)) {
          fileMap[f].critical += 1;
        } else {
          fileMap[f].warning += 1;
        }
      }
    }
  }

  return Object.values(fileMap).filter((f) => f.critical + f.warning > 0);
}

export default function PreSubmitValidatorPage() {
  const [startDate, setStartDate] = useState(() => formatLocalDateDaysAgo(7));
  const [endDate, setEndDate] = useState(() => formatLocalDateInput());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  const totalVisits = visits.length;
  const withIssues = visits.filter((v) => (v.issues || []).length > 0).length;
  const blocking = visits.filter((v) => (v.issues || []).some(isCritical)).length;
  const ready = visits.filter((v) => (v.issues || []).length === 0).length;

  const fileSummaries = buildFileSummary(visits);

  const handleLoad = async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ startDate, endDate, limit: '500' });
      const resp = await fetch(`/api/hosxp/eligible-visits?${params}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      const data: VisitRow[] = Array.isArray(json) ? json : json.data || [];
      setVisits(data);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Pre-submit Validator 16 แฟ้ม</h1>
        <p style={{ color: '#6b7280', marginTop: 4 }}>ตรวจสอบความสมบูรณ์ของข้อมูลก่อนส่งเบิก สปสช.</p>
      </div>

      <div className="card">
        <div className="card-body">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label>วันที่เริ่มต้น</label>
              <input type="date" className="form-control" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>วันที่สิ้นสุด</label>
              <input type="date" className="form-control" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <button className="btn btn-primary" onClick={handleLoad} disabled={loading}>
              {loading ? 'กำลังโหลด...' : '🔍 ตรวจสอบ'}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}

      {loaded && (
        <>
          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginTop: 16 }}>
            <div className="card" style={{ borderLeft: '4px solid #6366f1' }}>
              <div className="card-body" style={{ textAlign: 'center', padding: 16 }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#6366f1' }}>{totalVisits}</div>
                <div style={{ color: '#6b7280', fontSize: 13 }}>Visit ทั้งหมด</div>
              </div>
            </div>
            <div className="card" style={{ borderLeft: '4px solid #10b981' }}>
              <div className="card-body" style={{ textAlign: 'center', padding: 16 }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#10b981' }}>{ready}</div>
                <div style={{ color: '#6b7280', fontSize: 13 }}>ผ่านการตรวจ / พร้อมส่ง</div>
              </div>
            </div>
            <div className="card" style={{ borderLeft: '4px solid #ef4444' }}>
              <div className="card-body" style={{ textAlign: 'center', padding: 16 }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#ef4444' }}>{blocking}</div>
                <div style={{ color: '#6b7280', fontSize: 13 }}>ห้ามส่ง (ER1xx)</div>
              </div>
            </div>
            <div className="card" style={{ borderLeft: '4px solid #f59e0b' }}>
              <div className="card-body" style={{ textAlign: 'center', padding: 16 }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#f59e0b' }}>{withIssues - blocking}</div>
                <div style={{ color: '#6b7280', fontSize: 13 }}>ควรตรวจสอบ (ER2xx)</div>
              </div>
            </div>
          </div>

          {/* Per-file breakdown */}
          {fileSummaries.length === 0 ? (
            <div className="alert alert-success" style={{ marginTop: 16 }}>
              ✅ ไม่พบปัญหาในช่วงวันที่เลือก — ข้อมูลผ่านการตรวจสอบทั้งหมด
            </div>
          ) : (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ marginBottom: 12 }}>รายละเอียดปัญหาตามแฟ้ม</h3>
              {fileSummaries.map((f) => (
                <div key={f.fileCode} className="card" style={{ marginBottom: 10, borderLeft: `4px solid ${f.critical > 0 ? '#ef4444' : '#f59e0b'}` }}>
                  <div
                    className="card-header"
                    style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    onClick={() => setExpandedFile(expandedFile === f.fileCode ? null : f.fileCode)}
                  >
                    <span style={{ fontWeight: 600 }}>{f.label}</span>
                    <span style={{ display: 'flex', gap: 8 }}>
                      {f.critical > 0 && (
                        <span className="badge badge-danger">{f.critical} ห้ามส่ง</span>
                      )}
                      {f.warning > 0 && (
                        <span className="badge badge-warning">{f.warning} ควรตรวจสอบ</span>
                      )}
                      <span style={{ color: '#9ca3af' }}>{expandedFile === f.fileCode ? '▲' : '▼'}</span>
                    </span>
                  </div>

                  {expandedFile === f.fileCode && (
                    <div className="card-body" style={{ padding: 0 }}>
                      <div className="modal-table-wrap">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>VN</th>
                              <th>HN</th>
                              <th>ชื่อ-สกุล</th>
                              <th>วันที่</th>
                              <th>รหัส</th>
                              <th>ปัญหา</th>
                              <th>ประเภท</th>
                            </tr>
                          </thead>
                          <tbody>
                            {f.visits.map((row, idx) => (
                              <tr key={idx}>
                                <td className="table-cell-nowrap">{row.vn}</td>
                                <td>{row.hn}</td>
                                <td>{row.patient_name || '-'}</td>
                                <td className="table-cell-nowrap">{row.vstdate?.slice(0, 10) || '-'}</td>
                                <td><span className="badge badge-secondary">{row.issue}</span></td>
                                <td style={{ fontSize: 13 }}>{ISSUE_LABELS[row.issue] || row.issue}</td>
                                <td>
                                  {row.isCritical ? (
                                    <span className="badge badge-danger">ห้ามส่ง</span>
                                  ) : (
                                    <span className="badge badge-warning">ควรตรวจสอบ</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
