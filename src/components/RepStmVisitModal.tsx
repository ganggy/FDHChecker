import { useEffect, useState } from 'react';
import { fetchAppSettings, fetchRcmdbData } from '../services/hosxpService';

type VisitRef = {
  vn?: string | null;
  an?: string | null;
  hn?: string | null;
  patientName?: string | null;
};

type Props = {
  visit: VisitRef;
  onClose: () => void;
};

type DataType = 'REP' | 'STM' | 'INV';
type VisitData = Record<DataType, Record<string, unknown>[]>;
type CodeNotes = Record<string, string>;
type CatalogEntry = { type: string; description: string; guide: string };

const displayValue = (value: unknown) => {
  if (value == null || value === '') return '-';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
};

const detailFields: Record<DataType, Array<[string, string]>> = {
  REP: [
    ['rep_no', 'REP No.'], ['tran_id', 'Tran ID'], ['errorcode', 'Error/C'], ['verifycode', 'Verify/Deny'],
    ['senddate', 'วันที่ส่ง'], ['maininscl', 'สิทธิหลัก'], ['subinscl', 'สิทธิย่อย'], ['compensated', 'ยอดชดเชย'],
    ['nhso', 'สปสช.'], ['income', 'ยอดเรียกเก็บ'], ['filename', 'ไฟล์ต้นทาง'],
  ],
  STM: [
    ['statement_no', 'Statement No.'], ['stm_no', 'STM No.'], ['amount', 'ยอดเงิน'], ['paid_amount', 'ยอดจ่าย'],
    ['errorcode', 'Error/C'], ['verifycode', 'Verify/Deny'], ['service_date', 'วันที่บริการ'], ['source_filename', 'ไฟล์ต้นทาง'],
  ],
  INV: [
    ['invoice_no', 'Invoice No.'], ['inv_no', 'INV No.'], ['paid_amount', 'ยอดรับสุทธิ'], ['amount', 'ยอดเงิน INV'], ['service_date', 'วันที่บริการ'],
    ['source_filename', 'ไฟล์ต้นทาง'],
  ],
};

const normalizeRow = (row: Record<string, unknown>) => {
  let raw: Record<string, unknown> = {};
  if (typeof row.raw_data === 'string') {
    try { raw = JSON.parse(row.raw_data) as Record<string, unknown>; } catch { raw = {}; }
  } else if (row.raw_data && typeof row.raw_data === 'object') {
    raw = row.raw_data as Record<string, unknown>;
  }
  return { ...raw, ...row };
};

const splitCodes = (value: unknown) => String(value ?? '')
  .split(/[,|;/\n]+/)
  .map((code) => code.trim().toUpperCase())
  .filter(Boolean);

const getErrorExplanation = (row: Record<string, unknown>, code: string, notes: CodeNotes, catalog: Record<string, CatalogEntry>) => {
  const normalizedCode = code.replace(/\s+/g, '');
  const catalogCode = catalog[normalizedCode] ? normalizedCode : /^C\d+$/.test(normalizedCode) ? normalizedCode.slice(1) : normalizedCode;
  const specific = notes[code] || notes[normalizedCode] || notes[catalogCode];
  const catalogEntry = catalog[catalogCode];
  if (specific) return { description: specific, guide: catalogEntry?.guide || '', type: catalogEntry?.type || 'บันทึกของหน่วยงาน' };
  if (catalogEntry) return catalogEntry;
  const sourceDescription = row.errorname || row.error_desc || row.error_description || row.error_message || row.remark;
  if (sourceDescription) return { description: String(sourceDescription), guide: '', type: 'ข้อความจาก REP' };
  if (code.startsWith('C')) return { description: 'ข้อมูลยังไม่ผ่านการตรวจสอบเบื้องต้น', guide: 'ตรวจข้อมูล visit, สิทธิ, วันที่บริการ และรหัสรายการที่เกี่ยวข้องกับรหัสนี้', type: 'Corrective' };
  if (code.startsWith('D') || code.includes('DENY')) return { description: 'รายการถูกปฏิเสธตามเงื่อนไขการจ่าย', guide: 'ตรวจสิทธิ โครงการ รายการเบิก และหลักฐานประกอบ', type: 'Deny' };
  if (code.startsWith('V')) return { description: 'พบผลการตรวจสอบ Verify', guide: 'ตรวจข้อความต้นทางและเงื่อนไขของโครงการประกอบ', type: 'Verify' };
  return { description: 'ยังไม่มีคำอธิบายเฉพาะรหัสนี้ในฐานความรู้', guide: 'ตรวจข้อความต้นทางใน REP หรือเพิ่มคำอธิบายในหน้าติดตาม C/Deny', type: 'ไม่ทราบประเภท' };
};

export const RepStmVisitModal = ({ visit, onClose }: Props) => {
  const hasVisitKey = Boolean(visit.vn || visit.an);
  const [data, setData] = useState<VisitData>({ REP: [], STM: [], INV: [] });
  const [loading, setLoading] = useState(hasVisitKey);
  const [error, setError] = useState(hasVisitKey ? '' : 'visit นี้ไม่มี VN หรือ AN จึงไม่สามารถจับคู่ REP/STM/INV อย่างปลอดภัยได้');
  const [codeNotes, setCodeNotes] = useState<CodeNotes>({});
  const [errorCatalog, setErrorCatalog] = useState<Record<string, CatalogEntry>>({});

  useEffect(() => {
    let active = true;
    if (!hasVisitKey) return () => { active = false; };
    Promise.all((['REP', 'STM', 'INV'] as DataType[]).map(async (type) => {
      const result = await fetchRcmdbData(type, 100, visit);
      return [type, Array.isArray(result?.data) ? result.data : []] as const;
    }))
      .then((entries) => { if (active) setData(Object.fromEntries(entries) as VisitData); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'อ่านข้อมูลไม่สำเร็จ'); })
      .finally(() => { if (active) setLoading(false); });
    fetchAppSettings<{ rep_deny_notes?: { codeNotes?: CodeNotes } }>()
      .then((settings) => { if (active) setCodeNotes(settings.data?.rep_deny_notes?.codeNotes || {}); })
      .catch(() => {});
    import('../config/repErrorCatalog.json')
      .then((module) => { if (active) setErrorCatalog(module.default as Record<string, CatalogEntry>); })
      .catch(() => {});
    return () => { active = false; };
  }, [hasVisitKey, visit]);

  return (
    <div className="modal-overlay" onMouseDown={onClose} role="presentation">
      <div className="modal-content repstm-visit-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="รายละเอียด REP STM INV">
        <div className="repstm-visit-modal__header">
          <div>
            <h2>ตรวจสอบ REP / STM / INV</h2>
            <div>เฉพาะ Visit: VN {visit.vn || '-'} · AN {visit.an || '-'} · HN {visit.hn || '-'} {visit.patientName ? `· ${visit.patientName}` : ''}</div>
            <small>จับคู่ด้วย VN/AN เท่านั้น · หากส่ง visit เดิมหลายครั้ง ระบบจะแสดงทุกครั้ง</small>
          </div>
          <button type="button" className="btn btn-secondary" onClick={onClose}>✕ ปิด</button>
        </div>

        {loading && <div className="repstm-visit-modal__state">กำลังอ่านข้อมูล...</div>}
        {error && <div className="repstm-visit-modal__state repstm-visit-modal__state--error">{error}</div>}
        {!loading && !error && (['REP', 'STM', 'INV'] as DataType[]).map((type) => (
          <section className="repstm-visit-section" key={type}>
            <h3>{type} <span className="badge badge-info">{data[type].length} รายการ</span></h3>
            {data[type].length === 0 ? (
              <div className="repstm-visit-empty">ไม่พบข้อมูล {type} ของ visit นี้</div>
            ) : data[type].map((sourceRow, index) => {
              const row = normalizeRow(sourceRow);
              const errorCodes = type === 'REP' ? splitCodes(row.errorcode) : [];
              const verifyCodes = type === 'REP' ? splitCodes(row.verifycode) : [];
              return (
                <div className="repstm-visit-record" key={String(sourceRow.id || index)}>
                  {type === 'REP' && (errorCodes.length > 0 || verifyCodes.length > 0) && (
                    <div className="repstm-error-explanations">
                      {[
                        ...errorCodes.map((code) => ({ code, kind: 'C/Error' })),
                        ...verifyCodes.map((code) => ({ code, kind: 'Verify/Deny' })),
                      ].map(({ code, kind }) => {
                        const explanation = getErrorExplanation(row, code, codeNotes, errorCatalog);
                        return (
                          <div className="repstm-error-explanation" key={`${kind}-${code}`}>
                            <strong>{kind}: {code}<small>{explanation.type}</small></strong>
                            <span>
                              <b>{explanation.description}</b>
                              {explanation.guide && <small>แนวทางแก้ไข: {explanation.guide}</small>}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {detailFields[type].map(([key, label]) => (
                    <div className="repstm-visit-field" key={key}>
                      <span>{label}</span>
                      <strong>{displayValue(row[key])}</strong>
                    </div>
                  ))}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
};
