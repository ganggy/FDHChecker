---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "src/pages/PreSubmitValidatorPage.tsx"
source_hash: "ee5135f790001adbbb3cfa635c7cdb6c640b87fef204ddc69c6af8ad30be274e"
managed_by: "sync-ksp-vault"
---
# PreSubmitValidatorPage.tsx

> Source: `src/pages/PreSubmitValidatorPage.tsx`
> SHA-256: `ee5135f790001adbbb3cfa635c7cdb6c640b87fef204ddc69c6af8ad30be274e`

````tsx
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
  ER214: ['ADP', 'DRU'],
  'OPD-DOC01': ['MR'],
  'OPD-DOC02': ['MR'],
  'OPD-LAB01': ['MR'],
  'OPD-CHG01': ['CHT', 'CHA'],
  'OPD-CHG02': ['CHT', 'CHA'],
  'OPD-CHG03': ['CHT'],
  'OPD-CHG04': ['CHT'],
  'OPD-CHG05': ['MR', 'CHT'],
  'OPD-DRU01': ['DRU'],
};

const FILE_LABELS: Record<string, string> = {
  INS: 'INS - ข้อมูลสิทธิ์',
  PAT: 'PAT - ข้อมูลผู้ป่วย',
  OPD: 'OPD - ข้อมูลการตรวจ',
  ODX: 'ODX - การวินิจฉัย',
  ADP: 'ADP - บริการพิเศษ',
  DRU: 'DRU - รายการยา',
  CHT: 'CHT - ค่าบริการ',
  CHA: 'CHA - ค่าบริการอื่น',
  MR: 'เวชระเบียน OPD / หลักฐานบริการ',
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
  ER214: 'DRUGP: ต้องมีรายการยา',
  'OPD-DOC01': 'ไม่พบแพทย์/ผู้ให้บริการประจำ visit',
  'OPD-DOC02': 'ไม่พบบันทึกอาการสำคัญหรือประวัติ',
  'OPD-LAB01': 'มีคำสั่ง LAB แต่ไม่พบผลตรวจ',
  'OPD-CHG01': 'จำนวนรายการค่าใช้จ่ายเป็นศูนย์หรือติดลบ',
  'OPD-CHG02': 'รายการค่าใช้จ่ายรหัสเดียวกันซ้ำ',
  'OPD-CHG03': 'เบิก 55020 และ 55021 พร้อมกัน',
  'OPD-CHG04': 'ค่าเตียงสังเกตอาการชนกับ 55020/55021',
  'OPD-CHG05': 'หัตถการไม่พบผู้ตรวจแต่เบิกค่าบริการ OPD',
  'OPD-DRU01': 'จำนวนยาที่จ่ายเป็นศูนย์หรือติดลบ',
};

const OPD_BLOCKING_CODES = new Set(['OPD-LAB01', 'OPD-CHG01', 'OPD-CHG03', 'OPD-CHG04', 'OPD-CHG05', 'OPD-DRU01']);
const extractIssueCode = (issue: string) => issue.split(':')[0]?.trim() || issue.trim();
const isCritical = (issue: string) => {
  const code = extractIssueCode(issue);
  return code.startsWith('ER1') || code === 'ER214' || OPD_BLOCKING_CODES.has(code);
};

interface VisitRow {
  vn: string;
  hn: string;
  patient_name?: string;
  patientName?: string;
  vstdate?: string;
  serviceDate?: string;
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
      const issueCode = extractIssueCode(issue);
      const files = ISSUE_FILE_MAP[issueCode];
      if (!files) continue;
      for (const f of files) {
        if (!fileMap[f]) continue;
        const entry = {
          vn: v.vn,
          hn: v.hn,
          patient_name: v.patient_name || v.patientName,
          vstdate: v.vstdate || v.serviceDate,
          issue: issueCode,
          isCritical: isCritical(issueCode),
        };
        fileMap[f].visits.push(entry);
        if (isCritical(issueCode)) {
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
      setVisits(data.filter((item) => item.isBillable !== false));
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-container workflow-page">
      <div className="workflow-hero">
        <div className="workflow-hero__content">
          <div>
            <h1 className="page-title workflow-hero__title">Pre-submit Validator OPD + 16 แฟ้ม</h1>
            <p className="workflow-hero__description">ตรวจโครงสร้าง 16 แฟ้ม พร้อมหลักฐานเวชระเบียน คำสั่ง–ผล LAB และความผิดปกติของค่าใช้จ่ายก่อนส่งเบิก</p>
          </div>
          <div className="workflow-hero__meta">
            <span className="workflow-badge workflow-badge--accent">พร้อมส่งออก 16 แฟ้ม</span>
            <span className="workflow-badge">ตรวจย้อนหลังได้ตามช่วงวันที่</span>
          </div>
        </div>
      </div>

      <div className="card workflow-panel">
        <div className="card-body">
          <div className="workflow-filter-grid">
            <div className="form-group">
              <label>วันที่เริ่มต้น</label>
              <input type="date" className="form-control" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label>วันที่สิ้นสุด</label>
              <input type="date" className="form-control" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className="workflow-filter-actions">
              <button className="btn btn-primary" onClick={handleLoad} disabled={loading}>
                {loading ? 'กำลังโหลด...' : '🔍 ตรวจสอบ'}
              </button>
            </div>
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
          <div className="workflow-summary-grid">
            <div className="workflow-stat" style={{ ['--stat-color' as string]: '#6366f1' }}>
              <div className="workflow-stat__value">{totalVisits}</div>
              <div className="workflow-stat__label">Visit ทั้งหมด</div>
            </div>
            <div className="workflow-stat" style={{ ['--stat-color' as string]: '#10b981' }}>
              <div className="workflow-stat__value">{ready}</div>
              <div className="workflow-stat__label">ผ่านการตรวจ / พร้อมส่ง</div>
            </div>
            <div className="workflow-stat" style={{ ['--stat-color' as string]: '#ef4444' }}>
              <div className="workflow-stat__value">{blocking}</div>
              <div className="workflow-stat__label">ห้ามส่ง (ER1xx)</div>
            </div>
            <div className="workflow-stat" style={{ ['--stat-color' as string]: '#f59e0b' }}>
              <div className="workflow-stat__value">{withIssues - blocking}</div>
              <div className="workflow-stat__label">ควรตรวจสอบ (ER2xx)</div>
            </div>
          </div>

          {fileSummaries.length === 0 ? (
            <div className="workflow-empty">
              ✅ ไม่พบปัญหาในช่วงวันที่เลือก — ข้อมูลผ่านการตรวจสอบทั้งหมด
            </div>
          ) : (
            <div>
              <h3 className="workflow-section-title">รายละเอียดปัญหาตามแฟ้ม</h3>
              {fileSummaries.map((f) => (
                <div key={f.fileCode} className="workflow-accordion-card">
                  <button
                    type="button"
                    className="workflow-accordion-header"
                    onClick={() => setExpandedFile(expandedFile === f.fileCode ? null : f.fileCode)}
                  >
                    <span className="workflow-accordion-title">{f.label}</span>
                    <span className="workflow-accordion-meta">
                      {f.critical > 0 && (
                        <span className="badge badge-danger">{f.critical} ห้ามส่ง</span>
                      )}
                      {f.warning > 0 && (
                        <span className="badge badge-warning">{f.warning} ควรตรวจสอบ</span>
                      )}
                      <span style={{ color: '#9ca3af' }}>{expandedFile === f.fileCode ? '▲' : '▼'}</span>
                    </span>
                  </button>

                  {expandedFile === f.fileCode && (
                    <div className="card-body" style={{ padding: 0 }}>
                      <div className="modal-table-wrap">
                        <table className="data-table workflow-readable-table workflow-readable-table--validator">
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
                                <td className="table-cell-nowrap workflow-id-cell">{row.vn}</td>
                                <td className="table-cell-nowrap workflow-id-cell">{row.hn}</td>
                                <td className="workflow-person-cell">{row.patient_name || '-'}</td>
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

````
