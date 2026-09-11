import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AI_PROMPT_EXAMPLES, AI_PROMPT_TEMPLATE } from '../config/aiPromptExamples';
import './AiReportWorkspacePage.css';
import '../components/AiPromptExamples.css';

type Attachment = { filename: string; mimeType: string; base64: string; size: number };
type ReportColumn = { key: string; label: string };
type ReportMessage = {
  role: 'user' | 'assistant';
  text: string;
  question?: string;
  attachment?: Attachment;
  rows?: Array<Record<string, unknown>>;
  columns?: ReportColumn[];
  totalRows?: number;
  notes?: string[];
  knowledge?: { status?: string; message?: string };
  feedback?: string;
};

const suggestedReports = [
  {
    icon: '🕊️',
    title: 'ผู้เสียชีวิตในเขต PCU',
    description: '3 ปีงบประมาณ พร้อมชื่อ CID ที่อยู่ โรคหลัก และสาเหตุการตาย',
    prompt: 'ขอรายงานผู้เสียชีวิตในเขต PCU โรงพยาบาล ตามปีงบประมาณ 3 ปีย้อนหลัง มีชื่อ CID วันเดือนปีเกิด ที่อยู่ วันที่เสียชีวิต โรคหลัก และสาเหตุการตาย ออกเป็น Excel',
    ready: true,
  },
  {
    icon: '🛏️', title: 'สถานะผู้ครองเตียง', description: 'จำนวนผู้ป่วยและวันนอนเฉลี่ยแยกวอร์ด',
    prompt: 'ขอรายงานสถานะผู้ครองเตียงปัจจุบัน ออกเป็น Excel', ready: true,
  },
  {
    icon: '💳', title: 'สัดส่วนสิทธิการรักษา', description: 'จำนวนคนและจำนวนครั้ง แยกตามสิทธิ',
    prompt: 'ขอรายงานสัดส่วนสิทธิการรักษาเดือนนี้ ออกเป็น Excel', ready: true,
  },
  {
    icon: '🏘️', title: 'ผู้รับบริการแยกราย รพ.สต.', description: 'รายชื่อ จำนวน visit ค่าใช้จ่าย ประเภทบริการ และ Refer',
    prompt: 'ขอข้อมูลคนไข้ที่มารับบริการเดือนนี้ แยกราย รพ.สต. พร้อมค่าใช้จ่าย จำนวน visit ประเภทบริการ และ refer ออกเป็น Excel', ready: true,
  },
  {
    icon: '🧾', title: 'รายละเอียดบริการราย Visit', description: 'มาทำอะไร ค่ายา รายการยา Lab หัตถการ และ Refer',
    prompt: 'ขอสรุปบริการราย visit แยก รพ.สต. ว่ามาทำอะไร ค่าใช้จ่ายเท่าไร มีค่ายา ยาอะไร Lab และบริการอื่นอะไรบ้าง ออกเป็น Excel', ready: true,
  },
];

const createConversationId = () => {
  const key = 'fdh-ai-report-workspace-id';
  const existing = sessionStorage.getItem(key);
  if (existing && /^[a-zA-Z0-9_-]{8,80}$/.test(existing)) return existing;
  const created = crypto.randomUUID ? crypto.randomUUID() : `report-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sessionStorage.setItem(key, created);
  return created;
};

const download = (file: Attachment) => {
  const binary = window.atob(file.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  link.click();
  URL.revokeObjectURL(url);
};

const displayValue = (value: unknown) => value === null || value === undefined || value === '' ? '—' : String(value);

export function AiReportWorkspacePage() {
  const [messages, setMessages] = useState<ReportMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [model, setModel] = useState('Local AI');
  const [error, setError] = useState('');
  const conversationId = useRef(createConversationId());
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const load = async () => {
      let response = await fetch('/api/ai/status');
      let payload = await response.json() as { ai?: { model?: string; embedModel?: string }; auth?: { authenticated?: boolean; trustedAutoLogin?: boolean } };
      if (!payload.auth?.authenticated && payload.auth?.trustedAutoLogin) {
        await fetch('/api/ai/session/auto', { method: 'POST' });
        response = await fetch('/api/ai/status');
        payload = await response.json();
      }
      setModel([payload.ai?.model, payload.ai?.embedModel].filter(Boolean).join(' + ') || 'Local AI');
      setAuthenticated(Boolean(payload.auth?.authenticated));
    };
    void load().catch(() => setAuthenticated(false));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const latestReport = useMemo(() => [...messages].reverse().find((message) => message.role === 'assistant' && message.columns?.length), [messages]);

  const send = async (supplied?: string) => {
    const prompt = (supplied ?? question).trim();
    if (!prompt || loading || !authenticated) return;
    setQuestion('');
    setError('');
    setMessages((current) => [...current, { role: 'user', text: prompt }]);
    setLoading(true);
    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: prompt, conversationId: conversationId.current }),
      });
      const payload = await response.json() as {
        answer?: string; error?: string; attachment?: Attachment;
        rows?: Array<Record<string, unknown>>; columns?: ReportColumn[]; totalRows?: number;
        notes?: string[]; knowledge?: ReportMessage['knowledge'];
      };
      if (!response.ok) throw new Error(payload.error || 'สร้างรายงานไม่สำเร็จ');
      setMessages((current) => [...current, {
        role: 'assistant', text: payload.answer || 'ดำเนินการแล้ว', question: prompt,
        attachment: payload.attachment, rows: payload.rows, columns: payload.columns,
        totalRows: payload.totalRows, notes: payload.notes, knowledge: payload.knowledge,
      }]);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'สร้างรายงานไม่สำเร็จ';
      setError(message);
      setMessages((current) => [...current, { role: 'assistant', text: `ยังทำรายการนี้ไม่สำเร็จ: ${message}` }]);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };

  const reset = async () => {
    if (loading) return;
    await fetch('/api/ai/conversation/reset', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: conversationId.current }),
    });
    sessionStorage.removeItem('fdh-ai-report-workspace-id');
    conversationId.current = createConversationId();
    setMessages([]);
    setError('');
  };

  const remember = async (messageIndex: number) => {
    const message = messages[messageIndex];
    if (!message?.question || message.feedback) return;
    const response = await fetch('/api/ai/feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: conversationId.current, question: message.question,
        rating: 'remember', correction: 'บันทึกเป็นตัวอย่างรูปแบบรายงานเพื่อรอการตรวจสอบ',
      }),
    });
    const payload = await response.json() as { message?: string; error?: string };
    setMessages((current) => current.map((item, index) => index === messageIndex
      ? { ...item, feedback: payload.message || payload.error || 'ส่งเข้าคิวตรวจสอบแล้ว' }
      : item));
  };

  return (
    <main className="ai-report-page">
      <aside className="ai-report-sidebar">
        <div className="ai-report-brand"><span>✨</span><div><strong>FDH AI Report</strong><small>รายงานจากข้อมูลจริง</small></div></div>
        <button type="button" className="ai-report-new" onClick={() => void reset()}>＋ บทสนทนาใหม่</button>
        <div className="ai-report-sidebar-section">
          <span className="ai-report-sidebar-label">ต้นแบบพร้อมใช้</span>
          {suggestedReports.map((report) => (
            <button type="button" className="ai-report-template" key={report.title} onClick={() => void send(report.prompt)} disabled={loading || !authenticated}>
              <span>{report.icon}</span><div><strong>{report.title}</strong><small>{report.description}</small></div>
            </button>
          ))}
        </div>
        <div className="ai-report-governance">
          <strong>🔒 Safe learning</strong>
          <p>Query เป็น read-only และต้นแบบใหม่ต้องผ่าน feedback/การตรวจสอบก่อนนำกลับมาใช้</p>
        </div>
      </aside>

      <section className="ai-report-chat">
        <header className="ai-report-topbar">
          <div><h1>ผู้ช่วยจัดทำรายงาน FDHChecker</h1><p>บอกข้อมูล ช่วงเวลา เงื่อนไข และรูปแบบไฟล์ได้เหมือนคุยกับผู้ช่วย</p></div>
          <div className={`ai-report-model ${authenticated ? 'is-ready' : ''}`}><i />{model} · {authenticated ? 'พร้อมใช้งาน' : 'ยังไม่เชื่อมต่อ'}</div>
        </header>

        <div className="ai-report-thread">
          {!messages.length && (
            <section className="ai-report-welcome">
              <div className="ai-report-orb">AI</div>
              <h2>วันนี้อยากได้รายงานอะไรครับ?</h2>
              <p>ระบุหัวข้อ ช่วงเวลา คอลัมน์ และไฟล์ที่ต้องการ ระบบจะค้น HOSxP แบบอ่านอย่างเดียว แสดงตัวอย่าง แล้วสร้างไฟล์ให้ดาวน์โหลด</p>
              <div className="ai-report-prompt-guide">
                <strong>Prompt ที่ควรมี</strong>
                <span>1. ข้อมูลที่ต้องการ</span><span>2. ช่วงวันที่</span><span>3. เงื่อนไข</span>
                <span>4. หน่วยนับ HN/VN/AN</span><span>5. คอลัมน์</span><span>6. Excel/Word/หน้าจอ</span>
                <button type="button" onClick={() => { setQuestion(AI_PROMPT_TEMPLATE); textareaRef.current?.focus(); }}>ใช้แม่แบบ Prompt</button>
              </div>
              <div className="ai-report-starter-grid">
                {suggestedReports.map((report) => (
                  <button type="button" key={report.title} onClick={() => void send(report.prompt)} disabled={!authenticated}>
                    <span>{report.icon}</span><strong>{report.title}</strong><small>{report.description}</small>
                  </button>
                ))}
              </div>
              <div className="ai-report-scope-note"><strong>พื้นที่รายงานแรก</strong><span>PCU โรงพยาบาล ต.ตองโขบ · หมู่ 1, 2, 4, 5, 7, 8, 9, 10, 13, 14, 15, 16</span></div>
            </section>
          )}

          {messages.map((message, index) => (
            <article className={`ai-report-message is-${message.role}`} key={`${message.role}-${index}`}>
              <div className="ai-report-avatar">{message.role === 'assistant' ? 'AI' : 'คุณ'}</div>
              <div className="ai-report-bubble">
                <div className="ai-report-message-label">{message.role === 'assistant' ? 'FDH AI Report' : 'คำขอของคุณ'}</div>
                <p>{message.text}</p>
                {message.knowledge?.message && <div className="ai-report-learned">✓ {message.knowledge.message}</div>}
                {!!message.columns?.length && (
                  <div className="ai-report-preview">
                    <div className="ai-report-preview-head"><strong>ตัวอย่างข้อมูล</strong><span>{(message.totalRows ?? message.rows?.length ?? 0).toLocaleString('th-TH')} รายการ</span></div>
                    <div className="ai-report-table-wrap"><table><thead><tr>{message.columns.slice(0, 6).map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
                      <tbody>{(message.rows || []).slice(0, 5).map((row, rowIndex) => <tr key={rowIndex}>{message.columns!.slice(0, 6).map((column) => <td key={column.key}>{displayValue(row[column.key])}</td>)}</tr>)}</tbody>
                    </table></div>
                    {(message.columns.length > 6 || (message.rows?.length || 0) > 5) && <small>ไฟล์ดาวน์โหลดมีคอลัมน์และรายการครบทั้งหมด</small>}
                  </div>
                )}
                {!!message.notes?.length && <details className="ai-report-notes"><summary>ข้อจำกัดและการใช้ข้อมูล</summary>{message.notes.map((note) => <p key={note}>• {note}</p>)}</details>}
                {message.attachment && <button type="button" className="ai-report-download" onClick={() => download(message.attachment!)}>↓ ดาวน์โหลด {message.attachment.filename}<small>{Math.max(1, Math.round(message.attachment.size / 1024)).toLocaleString('th-TH')} KB</small></button>}
                {message.role === 'assistant' && message.question && (
                  <div className="ai-report-feedback">
                    {message.feedback ? <small>✓ {message.feedback}</small> : <button type="button" onClick={() => void remember(index)}>＋ จำเป็นต้นแบบรายงาน</button>}
                  </div>
                )}
              </div>
            </article>
          ))}
          {loading && <article className="ai-report-message is-assistant"><div className="ai-report-avatar">AI</div><div className="ai-report-thinking"><i /><i /><i /><span>กำลังตรวจ query และสร้างรายงาน…</span></div></article>}
          <div ref={bottomRef} />
        </div>

        <footer className="ai-report-composer-shell">
          {error && <div className="ai-report-error">{error}</div>}
          <form className="ai-report-composer" onSubmit={submit}>
            <textarea ref={textareaRef} value={question} onChange={(event) => setQuestion(event.target.value)} rows={3} maxLength={2000}
              placeholder="ระบุข้อมูล ช่วงวันที่ เงื่อนไข หน่วยนับ คอลัมน์ และรูปแบบไฟล์…"
              onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} disabled={loading || !authenticated} />
            <button type="submit" disabled={!question.trim() || loading || !authenticated}>➤</button>
          </form>
          <div className="ai-report-composer-meta"><span>Enter ส่ง · Shift+Enter ขึ้นบรรทัดใหม่</span><div>
            <button type="button" disabled={loading} onClick={() => { setQuestion(AI_PROMPT_TEMPLATE); textareaRef.current?.focus(); }}>แม่แบบ</button>
            <button type="button" disabled={loading} onClick={() => { setQuestion(AI_PROMPT_EXAMPLES[4].prompt); textareaRef.current?.focus(); }}>ตัวอย่าง</button>
            <button type="button" disabled={!latestReport || loading} onClick={() => void send('เอารายงานล่าสุดเป็น Excel')}>Excel</button>
            <button type="button" disabled={!latestReport || loading} onClick={() => void send('เอารายงานล่าสุดเป็น Word')}>Word</button>
          </div></div>
          <p>ข้อมูลสุขภาพเป็นความลับ โปรดดาวน์โหลดและใช้งานตามสิทธิ์ที่ได้รับ</p>
        </footer>
      </section>
    </main>
  );
}
