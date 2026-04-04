import React, { useEffect, useMemo, useState } from 'react';
import { fetchAppSettings, fetchRcmdbData, saveAppSettings } from '../services/hosxpService';
import { formatLocalDateStamp } from '../utils/dateUtils';

type RepCategory = 'all' | 'c' | 'deny' | 'other';

interface RepRow {
  id: number;
  rep_no?: string;
  seq_no?: number;
  tran_id?: string;
  hcode?: string;
  hn?: string;
  vn?: string;
  an?: string;
  pid?: string;
  patient_name?: string;
  patient_type?: string;
  department?: string;
  admdate?: string;
  dchdate?: string;
  senddate?: string;
  maininscl?: string;
  subinscl?: string;
  errorcode?: string;
  verifycode?: string;
  projectcode?: string;
  filename?: string;
  income?: number | null;
  compensated?: number | null;
  diff?: number | null;
  raw_data?: Record<string, unknown> | string;
  created_at?: string;
}

interface CodeSummary {
  code: string;
  count: number;
  category: Exclude<RepCategory, 'all'>;
  latestAt: string;
  sampleRows: RepRow[];
}

interface RepDenyNotes {
  codeNotes?: Record<string, string>;
}

interface RepDenySettings {
  rep_deny_notes?: RepDenyNotes;
}

interface RepGuide {
  title: string;
  summary: string;
  conditions: string[];
  fixSteps: string[];
  fixData: string[];
  references: string[];
}

const OFFICIAL_REFERENCES = [
  {
    label: 'NHSO ตรวจรหัส C, D และ V',
    url: 'https://twww.nhso.go.th/th/moveorg-7',
  },
  {
    label: 'คู่มือ e-Claim NHSO',
    url: 'https://www.nhso.go.th/files/nhso_Manual-v2.pdf',
  },
  {
    label: 'Claim Book (Thai)',
    url: 'https://media.nhso.go.th/assets/portals/1/files/62-2_Claim_Book%28Thai%29.pdf',
  },
];

const DEFAULT_GUIDE: Record<Exclude<RepCategory, 'all'>, RepGuide> = {
  c: {
    title: 'เงื่อนไขการติด C',
    summary: 'ใช้เมื่อข้อมูลยังไม่ผ่านการตรวจสอบโครงสร้างหรือเงื่อนไขเบื้องต้นของรายการ REP',
    conditions: [
      'รหัสบริการไม่ครบหรือไม่ตรงกับโครงการ',
      'วันที่/สิทธิ/เลข Visit หรือเลข Admit ไม่สัมพันธ์กัน',
      'รหัสโรค หัตถการ แล็บ หรือรายการยาไม่ครบตามที่ระบบต้องการ',
    ],
    fixSteps: [
      'เปิดข้อมูลต้นทางใน HOSxP แล้วดูฟิลด์ที่ติด errorcode เดียวกัน',
      'แก้ข้อมูลใน visit / dx / op / drug / adp / lab ให้ครบตามเงื่อนไข',
      'ส่ง REP/STM/INV ใหม่หลังแก้ต้นทาง',
    ],
    fixData: [
      'HN / VN / AN / CID',
      'วันที่รับบริการ / วันที่จำหน่าย / วันที่ส่ง',
      'สิทธิหลัก / สิทธิย่อย / project code',
      'รหัสโรค / หัตถการ / แล็บ / ยา / รายการเบิก',
    ],
    references: ['อ้างอิงคู่มือ e-Claim ของ NHSO และแนวทางตรวจสอบข้อมูลก่อนส่ง'],
  },
  deny: {
    title: 'เงื่อนไขการติด Deny',
    summary: 'ใช้เมื่อข้อมูลถูกปฏิเสธหลังตรวจรับ หรือไม่ผ่านเกณฑ์จ่ายตามสิทธิ/โครงการ',
    conditions: [
      'เงื่อนไขสิทธิไม่ตรงกับรายการที่เบิก',
      'มีข้อมูลครบ แต่ไม่เข้าเกณฑ์ของโครงการนั้น',
      'ผลตรวจ/รายการเบิกไม่สอดคล้องกับวันที่หรือสิทธิ',
    ],
    fixSteps: [
      'ตรวจรหัสที่ระบบแจ้งและเทียบกับรายการในประวัติ REP',
      'แก้ข้อมูลสิทธิ/การลงรหัส/วันที่บริการ/รายการคิดเงินให้ตรง',
      'ตรวจทานก่อน export และส่งใหม่อีกครั้ง',
    ],
    fixData: [
      'หลักฐานสิทธิและสถานะปิดสิทธิ',
      'รหัสโครงการ / project code / verify code',
      'วันที่บริการและสถานะ visit',
      'ข้อมูลค่าชดเชยและรายการที่นำไปคำนวณ',
    ],
    references: ['อ้างอิงคู่มือ e-Claim และแนวปฏิบัติการแก้รายการถูกปฏิเสธ'],
  },
  other: {
    title: 'รหัสอื่น ๆ ที่พบ',
    summary: 'กรณีรหัสไม่ขึ้นต้น C หรือไม่ได้อยู่ในกลุ่มปฏิเสธตรง ๆ',
    conditions: [
      'อาจเป็นรหัสตรวจสอบเฉพาะรายการ',
      'อาจเป็นรหัสชุด validation หรือรหัสโครงการเฉพาะ',
      'ต้องเปิดข้อความจากระบบหรือคู่มือประกอบ',
    ],
    fixSteps: [
      'ดูข้อความในคอลัมน์ errorcode / verifycode ทั้งก้อน',
      'ตรวจฟิลด์ต้นทางที่เกี่ยวข้อง',
      'จดวิธีแก้เฉพาะหน่วยงานไว้ในช่องบันทึกด้านขวา',
    ],
    fixData: [
      'ข้อความ error ดิบจาก REP',
      'เลข Visit / Admit / File name',
      'ข้อมูลที่ระบบตรวจแล้วไม่ผ่าน',
    ],
    references: ['บันทึกคำอธิบายเฉพาะรหัสของหน่วยงานเพิ่มเติมได้'],
  },
};

const normalizeText = (value: unknown) => String(value ?? '').trim();

const splitCodes = (value?: string) =>
  normalizeText(value)
    .split(/[,|;/\n]+/)
    .map((part) => part.trim().toUpperCase().replace(/\s+/g, ''))
    .filter(Boolean);

const getCategory = (code: string): Exclude<RepCategory, 'all'> => {
  if (code.startsWith('C')) return 'c';
  if (code.includes('DENY') || code.startsWith('D')) return 'deny';
  return 'other';
};

const getCategoryLabel = (category: Exclude<RepCategory, 'all'>) => {
  switch (category) {
    case 'c':
      return 'C';
    case 'deny':
      return 'Deny';
    default:
      return 'อื่น ๆ';
  }
};

const getBadgeClass = (category: RepCategory) => {
  if (category === 'c') return 'badge-warning';
  if (category === 'deny') return 'badge-danger';
  if (category === 'other') return 'badge-info';
  return 'badge-primary';
};

const getDisplayDate = (value?: string) => (value ? String(value).replace('T', ' ').slice(0, 19) : '-');

const getGuideForCategory = (category: Exclude<RepCategory, 'all'>): RepGuide => DEFAULT_GUIDE[category];

export const RepDenyPage: React.FC = () => {
  const [rows, setRows] = useState<RepRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<RepCategory>('all');
  const [selectedCode, setSelectedCode] = useState<string>('all');
  const [notes, setNotes] = useState<RepDenyNotes>({});
  const [notesDraft, setNotesDraft] = useState('');
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [repResponse, appSettingsResponse] = await Promise.all([
        fetchRcmdbData('REP', 1000),
        fetchAppSettings<RepDenySettings>(),
      ]);

      const repRows = Array.isArray(repResponse?.data) ? (repResponse.data as RepRow[]) : (Array.isArray(repResponse) ? repResponse as RepRow[] : []);
      setRows(repRows);
      const savedNotes = appSettingsResponse.data?.rep_deny_notes?.codeNotes || {};
      setNotes({ codeNotes: savedNotes });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูล C/Deny ไม่สำเร็จ');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const codeSummaries = useMemo<CodeSummary[]>(() => {
    const map = new Map<string, CodeSummary>();

    rows.forEach((row) => {
      const codes = splitCodes(row.errorcode);
      if (codes.length === 0) return;

      codes.forEach((code) => {
        const category = getCategory(code);
        const current = map.get(code);
        if (!current) {
          map.set(code, {
            code,
            count: 1,
            category,
            latestAt: row.created_at || row.senddate || '',
            sampleRows: [row],
          });
          return;
        }

        current.count += 1;
        current.sampleRows = current.sampleRows.length < 3 ? [...current.sampleRows, row] : current.sampleRows;
        if (normalizeText(row.created_at || row.senddate) > normalizeText(current.latestAt)) {
          current.latestAt = row.created_at || row.senddate || current.latestAt;
        }
      });
    });

    return Array.from(map.values()).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  }, [rows]);

  const issueRows = useMemo(() => rows.filter((row) => splitCodes(row.errorcode).length > 0), [rows]);

  const filteredSummaries = useMemo(() => {
    return codeSummaries.filter((item) => {
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (!searchTerm.trim()) return true;
      const haystack = [
        item.code,
        item.category,
        item.latestAt,
        ...(item.sampleRows.map((row) => [row.rep_no, row.vn, row.an, row.hn, row.patient_name, row.verifycode, row.projectcode].join(' ')))
      ].join(' ').toLowerCase();
      return haystack.includes(searchTerm.toLowerCase());
    });
  }, [categoryFilter, codeSummaries, searchTerm]);

  useEffect(() => {
    if (selectedCode !== 'all' && !filteredSummaries.some((item) => item.code === selectedCode)) {
      setSelectedCode(filteredSummaries[0]?.code || 'all');
    }
    if (selectedCode === 'all' && filteredSummaries.length > 0 && categoryFilter !== 'all') {
      setSelectedCode(filteredSummaries[0].code);
    }
  }, [categoryFilter, filteredSummaries, selectedCode]);

  useEffect(() => {
    if (selectedCode === 'all') {
      setNotesDraft(notes.codeNotes?.all || '');
      return;
    }
    setNotesDraft(notes.codeNotes?.[selectedCode] || '');
  }, [notes, selectedCode]);

  const selectedSummary = useMemo(() => {
    if (selectedCode === 'all') return null;
    return codeSummaries.find((item) => item.code === selectedCode) || null;
  }, [codeSummaries, selectedCode]);

  const selectedGuide = getGuideForCategory(selectedSummary?.category || (categoryFilter === 'deny' ? 'deny' : categoryFilter === 'c' ? 'c' : 'other'));

  const visibleRows = useMemo(() => {
    const baseRows = selectedCode === 'all'
      ? issueRows
      : issueRows.filter((row) => splitCodes(row.errorcode).includes(selectedCode));

    return baseRows.filter((row) => {
      if (!searchTerm.trim()) return true;
      const haystack = [
        row.rep_no,
        row.tran_id,
        row.vn,
        row.an,
        row.hn,
        row.pid,
        row.patient_name,
        row.patient_type,
        row.department,
        row.maininscl,
        row.subinscl,
        row.errorcode,
        row.verifycode,
        row.projectcode,
        row.filename,
      ].map((value) => normalizeText(value)).join(' ').toLowerCase();
      return haystack.includes(searchTerm.toLowerCase());
    });
  }, [issueRows, searchTerm, selectedCode]);

  const stats = useMemo(() => ({
    imported: rows.length,
    issueRows: issueRows.length,
    codes: codeSummaries.length,
    cCodes: codeSummaries.filter((item) => item.category === 'c').length,
    denyCodes: codeSummaries.filter((item) => item.category === 'deny').length,
  }), [codeSummaries, issueRows.length, rows.length]);

  const handleSaveNotes = async () => {
    try {
      setSaving(true);
      setError(null);
      const nextNotes = {
        ...notes,
        codeNotes: {
          ...(notes.codeNotes || {}),
          ...(selectedCode === 'all' ? { all: notesDraft } : { [selectedCode]: notesDraft }),
        },
      };
      await saveAppSettings({
        rep_deny_notes: nextNotes,
      });
      setNotes(nextNotes);
      setLastSaved(formatLocalDateStamp());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกโน้ตไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const clearSelection = () => {
    setSelectedCode('all');
    setNotesDraft(notes.codeNotes?.all || '');
  };

  return (
    <div className="page-container">
      <div className="page-header repdeny-hero">
        <h1 className="page-title">⚠️ ตรวจ C / Deny REP</h1>
        <p className="page-subtitle">
          หน้ารวมสำหรับไล่รายการที่ติด C / Deny หลังนำเข้า REP/STM/INV พร้อมสรุปเงื่อนไข วิธีแก้ และข้อมูลที่ควรกลับไปแก้ที่ต้นทาง
        </p>
        <div className="repdeny-reference-row">
          {OFFICIAL_REFERENCES.map((item) => (
            <a key={item.url} className="repdeny-reference-pill" href={item.url} target="_blank" rel="noreferrer">
              {item.label}
            </a>
          ))}
        </div>
      </div>

      <div className="repdeny-summary-grid">
        <div className="repdeny-metric-card">
          <div className="repdeny-metric-label">ข้อมูล REP ที่โหลด</div>
          <div className="repdeny-metric-value">{stats.imported.toLocaleString()}</div>
          <div className="repdeny-metric-sub">ล่าสุดจากฐาน repstminv</div>
        </div>
        <div className="repdeny-metric-card repdeny-metric-card--warning">
          <div className="repdeny-metric-label">รายการที่มีปัญหา</div>
          <div className="repdeny-metric-value">{stats.issueRows.toLocaleString()}</div>
          <div className="repdeny-metric-sub">errorcode ไม่ว่าง</div>
        </div>
        <div className="repdeny-metric-card repdeny-metric-card--info">
          <div className="repdeny-metric-label">รหัส C ที่พบ</div>
          <div className="repdeny-metric-value">{stats.cCodes.toLocaleString()}</div>
          <div className="repdeny-metric-sub">จัดกลุ่มจาก errorcode</div>
        </div>
        <div className="repdeny-metric-card repdeny-metric-card--danger">
          <div className="repdeny-metric-label">รหัส Deny ที่พบ</div>
          <div className="repdeny-metric-value">{stats.denyCodes.toLocaleString()}</div>
          <div className="repdeny-metric-sub">ตรวจสอบกับเงื่อนไขจ่ายจริง</div>
        </div>
      </div>

      <div className="card repdeny-filter-card" style={{ marginBottom: 16 }}>
        <div className="card-body">
          <div className="repdeny-filter-grid">
            <div className="form-group">
              <label className="form-label">ค้นหา</label>
              <input
                className="form-control"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="ค้นหา code, VN, HN, ชื่อผู้ป่วย..."
              />
            </div>
            <div className="form-group">
              <label className="form-label">กลุ่มรหัส</label>
              <select className="form-control" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as RepCategory)}>
                <option value="all">ทั้งหมด</option>
                <option value="c">C</option>
                <option value="deny">Deny</option>
                <option value="other">อื่น ๆ</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">รหัสที่เลือก</label>
              <select className="form-control" value={selectedCode} onChange={(e) => setSelectedCode(e.target.value)}>
                <option value="all">ภาพรวมทั้งหมด</option>
                {filteredSummaries.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.code} ({item.count})
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group repdeny-filter-actions">
              <label className="form-label">การทำงาน</label>
              <button className="btn btn-secondary" type="button" onClick={loadData} disabled={loading}>
                {loading ? 'กำลังโหลด...' : 'รีเฟรชข้อมูล'}
              </button>
              <button className="btn btn-secondary" type="button" onClick={clearSelection}>
                ล้างการเลือก
              </button>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      <div className="repdeny-main-grid">
        <div className="card repdeny-list-card">
          <div className="card-header">
            <div className="card-title">รหัสที่ติดบ่อย</div>
            <span className="badge badge-info">{filteredSummaries.length} รหัส</span>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {filteredSummaries.length > 0 ? (
              <div className="repdeny-code-list">
                {filteredSummaries.map((item) => {
                  const isActive = item.code === selectedCode;
                  return (
                    <button
                      key={item.code}
                      type="button"
                      className={`repdeny-code-item ${isActive ? 'active' : ''}`}
                      onClick={() => setSelectedCode(item.code)}
                    >
                      <div className="repdeny-code-item-row">
                        <div>
                          <div className="repdeny-code-name">{item.code}</div>
                          <div className="repdeny-code-meta">
                            ล่าสุด {getDisplayDate(item.latestAt)}
                          </div>
                        </div>
                        <span className={`badge ${getBadgeClass(item.category)}`}>{getCategoryLabel(item.category)}</span>
                      </div>
                      <div className="repdeny-code-footer">
                        <span>พบ {item.count.toLocaleString()} ครั้ง</span>
                        <span>ดูรายละเอียด</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="repdeny-empty-state">
                <div className="repdeny-empty-icon">🔎</div>
                <div className="repdeny-empty-title">ยังไม่พบรหัสที่ตรงกับตัวกรอง</div>
                <div className="repdeny-empty-text">ลองเปลี่ยนคำค้นหรือเลือกกลุ่มรหัสใหม่</div>
              </div>
            )}
          </div>
        </div>

        <div className="card repdeny-detail-card">
          <div className="card-header">
            <div className="card-title">
              {selectedCode === 'all' ? 'ภาพรวมการแก้ C / Deny' : `รายละเอียดรหัส ${selectedCode}`}
            </div>
            <span className={`badge ${selectedSummary ? getBadgeClass(selectedSummary.category) : 'badge-primary'}`}>
              {selectedSummary ? getCategoryLabel(selectedSummary.category) : 'All'}
            </span>
          </div>
          <div className="card-body">
            <div className="repdeny-detail-banner">
              <div className="repdeny-detail-banner-title">{selectedGuide.title}</div>
              <div className="repdeny-detail-banner-subtitle">{selectedGuide.summary}</div>
            </div>

            <div className="repdeny-detail-columns">
              <section>
                <div className="repdeny-section-title">เงื่อนไขการติด</div>
                <ul className="repdeny-bullet-list">
                  {selectedGuide.conditions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
              <section>
                <div className="repdeny-section-title">วิธีแก้</div>
                <ol className="repdeny-number-list">
                  {selectedGuide.fixSteps.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              </section>
            </div>

            <section className="repdeny-data-box">
              <div className="repdeny-section-title">ข้อมูลที่ควรแก้ / ตรวจสอบ</div>
              <div className="repdeny-chip-grid">
                {selectedGuide.fixData.map((item) => (
                  <span key={item} className="repdeny-data-chip">{item}</span>
                ))}
              </div>
            </section>

            <section className="repdeny-note-box">
              <div className="repdeny-section-title">ข้อมูลการแก้การติดของหน่วยงาน</div>
              <textarea
                className="form-control repdeny-note-input"
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                placeholder="เช่น ให้ตรวจ ICD, สิทธิหลัก, close status, หรือรายการแล็บที่หาย ..."
              />
              <div className="repdeny-note-actions">
                <button className="btn btn-primary" type="button" onClick={handleSaveNotes} disabled={saving}>
                  {saving ? 'กำลังบันทึก...' : 'บันทึกโน้ต'}
                </button>
                <span className="repdeny-note-meta">
                  {lastSaved ? `บันทึกล่าสุด ${lastSaved}` : 'โน้ตนี้จะเก็บใน app_settings ของระบบ'}
                </span>
              </div>
            </section>

            <section className="repdeny-reference-box">
              <div className="repdeny-section-title">อ้างอิง / หมายเหตุ</div>
              <ul className="repdeny-bullet-list">
                {selectedGuide.references.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div className="card-title">รายการที่ติด C / Deny</div>
          <span className="badge badge-info">{visibleRows.length.toLocaleString()} รายการ</span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {visibleRows.length > 0 ? (
            <div className="modal-table-wrap repdeny-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>REP</th>
                    <th>VN / AN</th>
                    <th>HN</th>
                    <th>ชื่อผู้ป่วย</th>
                    <th>สิทธิ</th>
                    <th>วันที่ส่ง</th>
                    <th>errorcode</th>
                    <th>verifycode</th>
                    <th>projectcode</th>
                    <th>ชดเชย</th>
                    <th>Income</th>
                    <th>Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.slice(0, 80).map((row) => {
                    const codes = splitCodes(row.errorcode);
                    return (
                      <tr key={`${row.id}-${row.tran_id || row.vn || row.an || 'row'}`}>
                        <td className="table-cell-nowrap">{row.rep_no || '-'}</td>
                        <td className="table-cell-nowrap">{row.vn || row.an || '-'}</td>
                        <td className="table-cell-nowrap">{row.hn || '-'}</td>
                        <td>
                          <div style={{ fontWeight: 700 }}>{row.patient_name || '-'}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.pid || '-'}</div>
                        </td>
                        <td className="table-cell-nowrap">{row.maininscl || row.patient_type || '-'}</td>
                        <td className="table-cell-nowrap">{getDisplayDate(row.senddate || row.created_at)}</td>
                        <td>
                          <div className="repdeny-cell-tags">
                            {codes.map((code) => (
                              <span key={code} className={`badge ${code.startsWith('C') ? 'badge-warning' : code.includes('DENY') ? 'badge-danger' : 'badge-info'}`}>
                                {code}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="table-cell-nowrap">{row.verifycode || '-'}</td>
                        <td className="table-cell-nowrap">{row.projectcode || '-'}</td>
                        <td className="table-cell-nowrap">{row.compensated != null ? Number(row.compensated).toLocaleString() : '-'}</td>
                        <td className="table-cell-nowrap">{row.income != null ? Number(row.income).toLocaleString() : '-'}</td>
                        <td className="table-cell-nowrap">{row.diff != null ? Number(row.diff).toLocaleString() : '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="repdeny-empty-state" style={{ margin: 20 }}>
              <div className="repdeny-empty-icon">✅</div>
              <div className="repdeny-empty-title">ไม่พบรายการติด C / Deny ตามตัวกรองนี้</div>
              <div className="repdeny-empty-text">ลองเปลี่ยนคำค้น, กลุ่มรหัส หรือเลือกข้อมูลชุดใหม่จาก REP/STM/INV ที่เพิ่งนำเข้า</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
