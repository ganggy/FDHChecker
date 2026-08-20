import { useMemo, useState } from 'react';
import './HospitalReportHubPage.css';

type ReportStatus = 'ready' | 'partial' | 'source-required';
type ReportDefinition = {
  id: string;
  category: 'clinical' | 'operations' | 'quality' | 'financial';
  title: string;
  english: string;
  description: string;
  icon: string;
  status: ReportStatus;
  requirement?: string;
  input?: 'patient' | 'visit' | 'admission' | 'date' | 'none';
  defaultFormat?: 'docx' | 'xlsx';
};

const categories = {
  clinical: { label: 'การแพทย์และบริการผู้ป่วย', short: 'Clinical', icon: '🩺' },
  operations: { label: 'การบริหารและปฏิบัติการ', short: 'Operations', icon: '🏥' },
  quality: { label: 'คุณภาพและความปลอดภัย', short: 'Quality & Safety', icon: '🛡️' },
  financial: { label: 'การเงินและการบริหารจัดการ', short: 'Financial', icon: '💹' },
} as const;

const reports: ReportDefinition[] = [
  { id: 'discharge-summary', category: 'clinical', title: 'สรุปประวัติการรักษา', english: 'Discharge Summary', description: 'สรุปการรับไว้ วินิจฉัย DRG ค่าใช้จ่าย และสถานะจำหน่าย', icon: '📄', status: 'ready', input: 'admission', defaultFormat: 'docx' },
  { id: 'referral-report', category: 'clinical', title: 'รายงานส่งต่อและส่งเวร', english: 'Handover / Referral', description: 'อาการล่าสุด สัญญาณชีพ เหตุผลและปลายทางการส่งต่อ', icon: '🚑', status: 'source-required', requirement: 'ต้องกำหนดฟิลด์ referout/referin และแบบฟอร์มส่งเวรที่หน่วยงานใช้งานจริง' },
  { id: 'operative-note', category: 'clinical', title: 'บันทึกการผ่าตัดและหัตถการ', english: 'Operative Note', description: 'รายการหัตถการ ICD9 ที่บันทึกใน HOSxP', icon: '🫀', status: 'partial', input: 'visit', defaultFormat: 'docx', requirement: 'ฉบับลงนามยังต้องเชื่อมรายนามทีม OR ขั้นตอน และภาวะแทรกซ้อน' },
  { id: 'lab-report', category: 'clinical', title: 'ผลตรวจทางห้องปฏิบัติการ', english: 'Lab & Imaging', description: 'ผล Lab พร้อมค่าปกติและวันที่ตรวจ ผูกกับ HN/VN ที่ยืนยันแล้ว', icon: '🧪', status: 'partial', input: 'patient', defaultFormat: 'docx', requirement: 'รองรับ Lab แล้ว; Imaging/CT ต้องเชื่อม PACS หรือ RIS' },
  { id: 'bed-occupancy', category: 'operations', title: 'สถานะผู้ครองเตียง', english: 'Bed Occupancy', description: 'จำนวนผู้ป่วยที่ยังไม่จำหน่ายและวันนอนเฉลี่ยแยกตามวอร์ด', icon: '🛏️', status: 'partial', input: 'none', defaultFormat: 'xlsx', requirement: 'ต้องเพิ่มจำนวนเตียงมาตรฐานต่อวอร์ดเพื่อคำนวณเตียงว่างและอัตราครองเตียง' },
  { id: 'ed-overcrowding', category: 'operations', title: 'ความหนาแน่นห้องฉุกเฉิน', english: 'ED Overcrowding', description: 'จำนวนผู้ป่วยรอตรวจ ระยะเวลารอ และผู้ป่วยค้างใน ER', icon: '🚨', status: 'source-required', requirement: 'ต้องยืนยัน timestamp จุดคัดกรอง พบแพทย์ และออกจาก ER' },
  { id: 'staffing-rota', category: 'operations', title: 'อัตรากำลังพลและตารางเวร', english: 'Staffing & Rota', description: 'ชั่วโมงทำงานและบุคลากรในแต่ละกะ', icon: '👥', status: 'source-required', requirement: 'ต้องเชื่อมระบบ HR/ตารางเวร และรหัสบุคลากรกลาง' },
  { id: 'inventory-pharmacy', category: 'operations', title: 'คลังเวชภัณฑ์และยา', english: 'Inventory & Pharmacy', description: 'อัตราจ่ายยา ยาใกล้หมด และรายการขาดคลัง', icon: '💊', status: 'source-required', requirement: 'ต้องเชื่อม stock movement, จุดสั่งซื้อ และ minimum stock ของคลังยา' },
  { id: 'incident-report', category: 'quality', title: 'อุบัติการณ์และความเสี่ยง', english: 'Incident / Adverse Event', description: 'เหตุไม่พึงประสงค์ ระดับความรุนแรง และมาตรการป้องกัน', icon: '⚠️', status: 'source-required', requirement: 'ต้องสร้างทะเบียน Incident ที่แยกสิทธิและปกปิดผู้รายงาน' },
  { id: 'hai-report', category: 'quality', title: 'การติดเชื้อในโรงพยาบาล', english: 'Hospital-Acquired Infection', description: 'ติดตาม HAI ตามแผนก อุปกรณ์ และวันนอน', icon: '🦠', status: 'source-required', requirement: 'ต้องกำหนดนิยาม HAI, microbiology, device-days และการยืนยันโดย ICN' },
  { id: 'complaint-satisfaction', category: 'quality', title: 'ข้อร้องเรียนและความพึงพอใจ', english: 'Complaint & Satisfaction', description: 'คะแนน ประเด็นร้องเรียน และสถานะการปรับปรุง', icon: '💬', status: 'source-required', requirement: 'ต้องเชื่อมแบบประเมิน/ศูนย์รับเรื่อง และกำหนด taxonomy ข้อร้องเรียน' },
  { id: 'cost-per-drg', category: 'financial', title: 'ค่าใช้จ่ายต่อกลุ่มโรค', english: 'Cost per DRG', description: 'จำนวนเคส RW และยอดเรียกเก็บเฉลี่ยแยก DRG', icon: '🧮', status: 'partial', input: 'date', defaultFormat: 'xlsx', requirement: 'ปัจจุบันเป็นยอดเรียกเก็บจาก HOSxP ยังไม่ใช่ต้นทุนบัญชีจริง' },
  { id: 'payer-mix', category: 'financial', title: 'สัดส่วนสิทธิการรักษา', english: 'Payer Mix', description: 'จำนวนคน จำนวนครั้ง และสัดส่วน OPD แยกตามสิทธิ', icon: '💳', status: 'ready', input: 'date', defaultFormat: 'xlsx' },
  { id: 'pcu-patient-service', category: 'operations', title: 'ผู้รับบริการแยกราย รพ.สต.', english: 'PCU Patient Services', description: 'รายชื่อผู้ป่วย จำนวน visit ค่าใช้จ่าย ประเภทบริการ สิทธิ และ Refer แยกตามหน่วยบริการประจำ', icon: '🏘️', status: 'ready', input: 'date', defaultFormat: 'xlsx' },
];

type ReportOutput = {
  answer?: string;
  title?: string;
  subtitle?: string;
  rows?: Array<Record<string, unknown>>;
  columns?: Array<{ key: string; label: string }>;
  totalRows?: number;
  notes?: string[];
  attachment?: { filename: string; mimeType: string; base64: string; size: number };
};

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const monthStart = () => `${isoDate(new Date()).slice(0, 7)}-01`;

const downloadAttachment = (attachment: NonNullable<ReportOutput['attachment']>) => {
  const binary = window.atob(attachment.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const url = URL.createObjectURL(new Blob([bytes], { type: attachment.mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = attachment.filename;
  link.click();
  URL.revokeObjectURL(url);
};

export function HospitalReportHubPage() {
  const [category, setCategory] = useState<'all' | keyof typeof categories>('all');
  const [selectedId, setSelectedId] = useState('discharge-summary');
  const [identifier, setIdentifier] = useState('');
  const [identifierType, setIdentifierType] = useState<'hn' | 'vn' | 'an'>('an');
  const [dateStart, setDateStart] = useState(monthStart());
  const [dateEnd, setDateEnd] = useState(isoDate(new Date()));
  const [format, setFormat] = useState<'docx' | 'xlsx' | 'csv' | 'json'>('docx');
  const [instructions, setInstructions] = useState('');
  const [useAi, setUseAi] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [output, setOutput] = useState<ReportOutput | null>(null);

  const selected = reports.find((report) => report.id === selectedId) || reports[0];
  const visibleReports = useMemo(() => reports.filter((report) => category === 'all' || report.category === category), [category]);
  const readyCount = reports.filter((report) => report.status !== 'source-required').length;

  const selectReport = (report: ReportDefinition) => {
    setSelectedId(report.id);
    setOutput(null);
    setError('');
    if (report.defaultFormat) setFormat(report.defaultFormat);
    if (report.input === 'patient') setIdentifierType('hn');
    if (report.input === 'visit') setIdentifierType('vn');
    if (report.input === 'admission') setIdentifierType('an');
  };

  const runReport = async () => {
    if (selected.status === 'source-required' || loading) return;
    setLoading(true);
    setError('');
    setOutput(null);
    try {
      const response = await fetch('/api/hospital-reports/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId: selected.id, identifier: identifier.trim(), identifierType,
          dateStart, dateEnd, format, aiSummary: useAi, instructions: instructions.trim(),
        }),
      });
      const payload = await response.json() as { success?: boolean; data?: ReportOutput; error?: string };
      if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error || 'สร้างรายงานไม่สำเร็จ');
      setOutput(payload.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'สร้างรายงานไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="hospital-report-hub">
      <section className="report-hero">
        <div>
          <span className="report-eyebrow">FDHChecker × Local AI</span>
          <h1>ศูนย์รายงานโรงพยาบาล</h1>
          <p>สร้างรายงานจากข้อมูลจริงใน HOSxP พร้อมให้ AI ช่วยสรุป โดยแสดงข้อจำกัดของข้อมูลทุกครั้ง</p>
        </div>
        <div className="report-hero-stats">
          <article><strong>{reports.length}</strong><span>แบบรายงานทั้งหมด</span></article>
          <article><strong>{readyCount}</strong><span>พร้อมใช้/ใช้ได้บางส่วน</span></article>
          <article><strong>Read-only</strong><span>ไม่แก้ไข HOSxP</span></article>
        </div>
      </section>

      <section className="report-filter" aria-label="หมวดรายงาน">
        <button className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>ทั้งหมด</button>
        {Object.entries(categories).map(([key, value]) => (
          <button key={key} className={category === key ? 'active' : ''} onClick={() => setCategory(key as keyof typeof categories)}>
            <span>{value.icon}</span>{value.label}
          </button>
        ))}
      </section>

      <div className="report-workspace">
        <section className="report-catalog">
          {visibleReports.map((report) => (
            <button key={report.id} type="button" className={`report-card ${selected.id === report.id ? 'selected' : ''}`} onClick={() => selectReport(report)}>
              <span className="report-card-icon">{report.icon}</span>
              <span className="report-card-copy">
                <strong>{report.title}</strong><small>{report.english}</small><p>{report.description}</p>
              </span>
              <span className={`report-status is-${report.status}`}>
                {report.status === 'ready' ? 'พร้อมใช้' : report.status === 'partial' ? 'ใช้ได้บางส่วน' : 'รอเชื่อมข้อมูล'}
              </span>
            </button>
          ))}
        </section>

        <aside className="report-builder">
          <header>
            <span>{selected.icon}</span>
            <div><small>{categories[selected.category].short}</small><h2>{selected.title}</h2><p>{selected.english}</p></div>
          </header>

          {selected.requirement && <div className={`report-requirement is-${selected.status}`}><strong>ขอบเขตข้อมูลปัจจุบัน</strong><span>{selected.requirement}</span></div>}

          {selected.status !== 'source-required' ? (
            <div className="report-form">
              {(selected.input === 'patient' || selected.input === 'visit' || selected.input === 'admission') && (
                <label>
                  <span>ตัวระบุผู้ป่วย/ครั้งรับบริการ</span>
                  <div className="report-identifier">
                    <select value={identifierType} onChange={(event) => setIdentifierType(event.target.value as 'hn' | 'vn' | 'an')}>
                      {selected.input !== 'visit' && <option value="hn">HN</option>}
                      {selected.input !== 'admission' && <option value="vn">VN</option>}
                      {selected.input === 'admission' && <option value="an">AN</option>}
                    </select>
                    <input value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder={`ระบุ ${identifierType.toUpperCase()}`} maxLength={30} />
                  </div>
                </label>
              )}
              {selected.input === 'date' && <div className="report-date-row"><label><span>วันที่เริ่ม</span><input type="date" value={dateStart} onChange={(event) => setDateStart(event.target.value)} /></label><label><span>วันที่สิ้นสุด</span><input type="date" value={dateEnd} onChange={(event) => setDateEnd(event.target.value)} /></label></div>}
              <label><span>รูปแบบไฟล์</span><select value={format} onChange={(event) => setFormat(event.target.value as typeof format)}><option value="docx">Word (.docx)</option><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV</option><option value="json">JSON</option></select></label>
              <label><span>สิ่งที่ต้องการเน้น (ไม่บังคับ)</span><textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={3} maxLength={500} placeholder="เช่น เน้นความเสี่ยงที่ต้องติดตาม หรือสรุปสำหรับประชุมเช้า" /></label>
              <label className="report-ai-toggle"><input type="checkbox" checked={useAi} onChange={(event) => setUseAi(event.target.checked)} /><span><strong>ให้ Local AI ช่วยสรุป</strong><small>AI ใช้เฉพาะผลที่ Backend ดึงมาและไม่แก้ไขฐานข้อมูล</small></span></label>
              <button className="report-run" onClick={() => void runReport()} disabled={loading || ((selected.input === 'patient' || selected.input === 'visit' || selected.input === 'admission') && !identifier.trim())}>{loading ? 'กำลังค้นและจัดทำรายงาน…' : 'สร้างรายงาน'}</button>
            </div>
          ) : (
            <div className="report-not-ready"><span>🔌</span><strong>ต้องเชื่อมแหล่งข้อมูลก่อน</strong><p>ระบบจะไม่สร้างข้อมูลประมาณการหรือให้ AI เดาตัวเลขแทนข้อมูลจริง</p></div>
          )}

          {error && <div className="report-error">{error}</div>}
          {output && (
            <section className="report-output">
              <div className="report-output-head"><div><small>ผลรายงาน</small><h3>{output.title || selected.title}</h3><p>{output.subtitle}</p></div>{output.attachment && <button onClick={() => downloadAttachment(output.attachment!)}>ดาวน์โหลดไฟล์</button>}</div>
              {output.answer && <div className="report-ai-summary"><strong>AI Summary</strong><p>{output.answer}</p></div>}
              {!!output.notes?.length && <ul>{output.notes.map((note) => <li key={note}>{note}</li>)}</ul>}
              {!!output.rows?.length && <div className="report-preview"><table><thead><tr>{output.columns?.slice(0, 6).map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{output.rows.slice(0, 8).map((row, index) => <tr key={index}>{output.columns?.slice(0, 6).map((column) => <td key={column.key}>{String(row[column.key] ?? '')}</td>)}</tr>)}</tbody></table><small>แสดงตัวอย่าง {Math.min(8, output.rows.length)} จาก {output.totalRows ?? output.rows.length} รายการ</small></div>}
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
