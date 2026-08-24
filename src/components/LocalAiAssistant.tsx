import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AI_PROMPT_EXAMPLES, AI_PROMPT_TEMPLATE } from '../config/aiPromptExamples';
import './LocalAiAssistant.css';
import './AiPromptExamples.css';

type ChatMessage = {
  role: 'user' | 'assistant';
  text: string;
  question?: string;
  feedback?: string;
  feedbackBusy?: boolean;
  needsClarification?: boolean;
  sources?: Array<{ id: number; source: string; heading: string }>;
  attachment?: {
    filename: string;
    mimeType: string;
    base64: string;
    size: number;
  };
};

type AiStatus = {
  ai?: {
    provider?: string;
    model?: string;
    configured?: boolean;
    reachable?: boolean | null;
  };
  auth?: {
    configured?: boolean;
    authenticated?: boolean;
    sessionHours?: number;
    trustedAutoLogin?: boolean;
  };
};

type ConversationContext = {
  patient?: { hn: string; patientName: string };
  waitingFor?: string;
  lastAction?: { kind: 'patient-report' | 'operational' | 'hospital-report' | 'dynamic-query'; label: string };
};

type LocalAiAssistantProps = {
  avoidBottomActionBar?: boolean;
};

export function LocalAiAssistant({ avoidBottomActionBar = false }: LocalAiAssistantProps) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<AiStatus>();
  const [accessKey, setAccessKey] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [conversationContext, setConversationContext] = useState<ConversationContext>({});
  const [progressText, setProgressText] = useState('กำลังค้นข้อมูลและประมวลผล…');
  const scrollRef = useRef<HTMLDivElement>(null);
  const conversationIdRef = useRef((() => {
    const storageKey = 'fdh-ai-conversation-id';
    const existing = window.sessionStorage.getItem(storageKey);
    if (existing && /^[a-zA-Z0-9_-]{8,80}$/.test(existing)) return existing;
    const created = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `fdh-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(storageKey, created);
    return created;
  })());

  const loadStatus = async (allowAutoLogin = true) => {
    const response = await fetch('/api/ai/status');
    let payload = await response.json() as AiStatus;
    if (
      allowAutoLogin
      && payload.auth?.configured
      && payload.auth.trustedAutoLogin
      && !payload.auth.authenticated
    ) {
      const sessionResponse = await fetch('/api/ai/session/auto', { method: 'POST' });
      if (sessionResponse.ok) {
        const refreshedResponse = await fetch('/api/ai/status');
        payload = await refreshedResponse.json() as AiStatus;
      }
    }
    setStatus(payload);
  };

  useEffect(() => {
    if (!open) return;
    loadStatus().catch(() => setStatus({ ai: { configured: false, reachable: false } }));
  }, [open]);

  useEffect(() => {
    const handleApplicationLogin = () => {
      void loadStatus(true);
    };
    window.addEventListener('fdh:login', handleApplicationLogin);
    return () => window.removeEventListener('fdh:login', handleApplicationLogin);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessKey.trim() || loginLoading) return;
    setLoginLoading(true);
    setLoginError('');
    try {
      const response = await fetch('/api/ai/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessKey: accessKey.trim() }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'ไม่สามารถเข้าสู่ระบบ AI ได้');
      setAccessKey('');
      await loadStatus();
    } catch (error) {
      setLoginError((error as Error).message);
    } finally {
      setLoginLoading(false);
    }
  };

  const logout = async () => {
    await fetch('/api/ai/session', { method: 'DELETE' });
    setMessages([]);
    setConversationContext({});
    await loadStatus();
  };

  const sendPrompt = async (suppliedPrompt?: string) => {
    const prompt = (suppliedPrompt ?? question).trim();
    if (!prompt || loading) return;
    setQuestion('');
    setProgressText(
      /excel|xlsx|word|docx|csv|json|ไฟล์/i.test(prompt)
        ? 'กำลังสร้างไฟล์จากข้อมูลที่ตรวจสอบแล้ว…'
        : /error|ข้อผิดพลาด|รหัส|ผิดอะไร/i.test(prompt)
          ? 'กำลังตรวจรหัสและแนวทางแก้ไข…'
          : 'กำลังค้นข้อมูลและประมวลผล…',
    );
    setMessages((current) => [...current, { role: 'user', text: prompt }]);
    setLoading(true);

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: prompt, conversationId: conversationIdRef.current }),
      });
      const payload = await response.json() as {
        answer?: string;
        error?: string;
        sources?: ChatMessage['sources'];
        attachment?: ChatMessage['attachment'];
        needsClarification?: boolean;
        context?: ConversationContext;
      };
      if (response.status === 401) await loadStatus();
      if (!response.ok) throw new Error(payload.error || 'Local AI ไม่สามารถตอบได้');
      setConversationContext(payload.context || {});
      setMessages((current) => [...current, {
        role: 'assistant',
        text: payload.answer || 'ไม่พบคำตอบ',
        question: prompt,
        sources: payload.sources,
        attachment: payload.attachment,
        needsClarification: payload.needsClarification,
      }]);
    } catch (error) {
      setMessages((current) => [...current, {
        role: 'assistant',
        text: `เกิดข้อผิดพลาด: ${(error as Error).message}`,
      }]);
    } finally {
      setLoading(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void sendPrompt();
  };

  const resetConversation = async () => {
    if (loading) return;
    const response = await fetch('/api/ai/conversation/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: conversationIdRef.current }),
    });
    if (!response.ok) return;
    setMessages([]);
    setConversationContext({});
  };

  const sendFeedback = async (messageIndex: number, rating: 'correct' | 'incorrect' | 'remember') => {
    const message = messages[messageIndex];
    if (!message?.question || message.feedbackBusy) return;
    let correction = '';
    if (rating === 'incorrect') {
      const supplied = window.prompt('คำตอบที่ถูกต้องหรือความหมายที่ AI ควรจำคืออะไร? (เว้นว่างได้)');
      if (supplied === null) return;
      correction = supplied.trim();
    }
    setMessages((current) => current.map((item, index) => (
      index === messageIndex ? { ...item, feedbackBusy: true } : item
    )));
    try {
      const response = await fetch('/api/ai/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversationIdRef.current,
          question: message.question,
          rating,
          correction,
        }),
      });
      const payload = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || 'บันทึก feedback ไม่สำเร็จ');
      setMessages((current) => current.map((item, index) => (
        index === messageIndex ? { ...item, feedbackBusy: false, feedback: payload.message || 'บันทึกแล้ว' } : item
      )));
    } catch (error) {
      setMessages((current) => current.map((item, index) => (
        index === messageIndex ? { ...item, feedbackBusy: false, feedback: (error as Error).message } : item
      )));
    }
  };

  return (
    <div className={`local-ai ${open ? 'local-ai--open' : ''} ${avoidBottomActionBar ? 'local-ai--raised' : ''}`}>
      {open && (
        <section className="local-ai-panel" aria-label="ผู้ช่วย FDH Local AI">
          <header className="local-ai-header">
            <div>
              <strong>FDH Local AI</strong>
              <span className={`local-ai-status ${status?.ai?.configured && status.auth?.authenticated ? 'is-ready' : ''}`}>
                {status?.ai?.configured ? `${status.ai.model} ${status.auth?.authenticated ? 'พร้อมใช้งาน' : 'รอ Access Key'}` : 'กำลังตรวจสอบ Ollama'}
              </span>
            </div>
            <div className="local-ai-header-actions">
              {status?.auth?.authenticated && (
                <button type="button" className="local-ai-logout" onClick={logout}>ออก</button>
              )}
              <button type="button" className="local-ai-close" onClick={() => setOpen(false)} aria-label="ปิดผู้ช่วย">×</button>
            </div>
          </header>

          {status?.auth?.authenticated && (
            <div className="local-ai-context" aria-label="บริบทการสนทนาปัจจุบัน">
              <div>
                {conversationContext.patient && (
                  <span>ผู้ป่วย: {conversationContext.patient.patientName || 'ไม่ระบุชื่อ'} · HN {conversationContext.patient.hn}</span>
                )}
                {conversationContext.lastAction && <span>งานล่าสุด: {conversationContext.lastAction.label}</span>}
                {conversationContext.waitingFor && <span className="is-waiting">กำลังรอ: {conversationContext.waitingFor}</span>}
                {!conversationContext.patient && !conversationContext.lastAction && !conversationContext.waitingFor && (
                  <span>ยังไม่ได้เลือกผู้ป่วยหรือรายงาน</span>
                )}
              </div>
              <button type="button" onClick={() => void resetConversation()} disabled={loading}>ล้างบริบท</button>
            </div>
          )}

          <div className="local-ai-messages" ref={scrollRef}>
            {status?.auth?.configured === false && (
              <div className="local-ai-login">
                <strong>Server ยังไม่มี AI Access Key</strong>
                <p>รัน <code>npm run ai:key:setup</code> บนเครื่อง Server แล้วรีสตาร์ต Backend</p>
              </div>
            )}
            {status?.auth?.configured && !status.auth.authenticated && (
              <form className="local-ai-login" onSubmit={login}>
                <div className="local-ai-lock">🔐</div>
                <strong>กรอก FDH AI Access Key</strong>
                <p>โหมด Session อัตโนมัติไม่พร้อม จึงต้องใช้ Access Key สำรอง</p>
                <input
                  type="password"
                  value={accessKey}
                  onChange={(event) => setAccessKey(event.target.value)}
                  autoComplete="current-password"
                  placeholder="วาง Access Key"
                  disabled={loginLoading}
                />
                {loginError && <span className="local-ai-login-error">{loginError}</span>}
                <button type="submit" disabled={!accessKey.trim() || loginLoading}>
                  {loginLoading ? 'กำลังตรวจสอบ…' : 'เข้าใช้งาน AI'}
                </button>
              </form>
            )}
            {status?.auth?.authenticated && !messages.length && (
              <div className="local-ai-welcome">
                <strong>ถามข้อมูล HOSxP ต่อเนื่อง หรือให้สร้าง Word/Excel ได้ครับ</strong>
                <p>ค้นด้วย HN, VN, AN, CID หรือชื่อ ดูประวัติ ยา แล็บ วันนัด ถามต่อจากคำตอบเดิม และดาวน์โหลด Word, Excel, CSV หรือ JSON ได้ ทุกคำค้นถูกตรวจและรันแบบอ่านอย่างเดียว</p>
                <p>Prompt ที่แม่นยำควรมี: ต้องการอะไร · ช่วงวันที่ · เงื่อนไข · หน่วยนับ · รูปแบบผลลัพธ์</p>
                <div className="local-ai-starter-prompts">
                  {AI_PROMPT_EXAMPLES.slice(0, 4).map((example) => (
                    <button type="button" key={example.id} onClick={() => setQuestion(example.prompt)}>{example.label}</button>
                  ))}
                </div>
              </div>
            )}
            {status?.auth?.authenticated && messages.map((message, index) => (
              <article key={`${message.role}-${index}`} className={`local-ai-message is-${message.role}`}>
                <div>{message.text}</div>
                {message.needsClarification && (
                  <small className="local-ai-clarification-hint">ตอบคำถามนี้เพื่อให้ AI ดำเนินงานเดิมต่อ</small>
                )}
                {!!message.sources?.length && (
                  <details>
                    <summary>แหล่งข้อมูล {message.sources.length} รายการ</summary>
                    {message.sources.map((source) => (
                      <small key={`${source.id}-${source.source}`}>[{source.id}] {source.source} › {source.heading}</small>
                    ))}
                  </details>
                )}
                {message.attachment && (
                  <button
                    type="button"
                    className="local-ai-download"
                    onClick={() => {
                      const binary = window.atob(message.attachment!.base64);
                      const bytes = new Uint8Array(binary.length);
                      for (let byteIndex = 0; byteIndex < binary.length; byteIndex += 1) {
                        bytes[byteIndex] = binary.charCodeAt(byteIndex);
                      }
                      const url = URL.createObjectURL(new Blob([bytes], { type: message.attachment!.mimeType }));
                      const link = document.createElement('a');
                      link.href = url;
                      link.download = message.attachment!.filename;
                      link.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    ดาวน์โหลด {message.attachment.filename} ({Math.max(1, Math.round(message.attachment.size / 1024)).toLocaleString('th-TH')} KB)
                  </button>
                )}
                {message.role === 'assistant' && message.question && (
                  <div className="local-ai-feedback">
                    {message.feedback ? (
                      <small>{message.feedback}</small>
                    ) : (
                      <>
                        <button type="button" disabled={message.feedbackBusy} onClick={() => void sendFeedback(index, 'correct')}>✓ ถูกต้อง</button>
                        <button type="button" disabled={message.feedbackBusy} onClick={() => void sendFeedback(index, 'incorrect')}>✕ ไม่ถูกต้อง</button>
                        <button type="button" disabled={message.feedbackBusy} onClick={() => void sendFeedback(index, 'remember')}>จำวิธีนี้</button>
                      </>
                    )}
                  </div>
                )}
              </article>
            ))}
            {loading && <div className="local-ai-thinking">{progressText}</div>}
          </div>

          {status?.auth?.authenticated && <form className="local-ai-form" onSubmit={submit}>
            <div className="local-ai-quick-actions">
              <button type="button" onClick={() => setQuestion(AI_PROMPT_TEMPLATE)}>＋ แม่แบบ Prompt</button>
              <button type="button" onClick={() => setQuestion(AI_PROMPT_EXAMPLES[0].prompt)}>ยอด OPD วันนี้</button>
              <button type="button" onClick={() => setQuestion(AI_PROMPT_EXAMPLES[2].prompt)}>ตรวจ VN</button>
              <button type="button" onClick={() => setQuestion(AI_PROMPT_EXAMPLES[5].prompt)}>เกณฑ์พอกเข่า</button>
              <button type="button" disabled={!conversationContext.lastAction || loading} onClick={() => void sendPrompt('เอาผลล่าสุดเป็น Excel')}>ทำ Excel</button>
              <button type="button" disabled={!conversationContext.patient || loading} onClick={() => void sendPrompt('ขอผลแล็บล่าสุด')}>ผลแล็บ</button>
            </div>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              maxLength={2_000}
              rows={2}
              placeholder="ระบุ: ต้องการอะไร • ช่วงวันที่ • เงื่อนไข • หน่วยนับ • รูปแบบผลลัพธ์"
              disabled={loading}
            />
            <button type="submit" disabled={!question.trim() || loading}>ส่ง</button>
            <small className="local-ai-input-hint">Enter ส่ง • Shift+Enter ขึ้นบรรทัดใหม่ • ตอบต่อจากคำถาม AI ได้ทันที</small>
          </form>}
          <footer>AI session สร้างอัตโนมัติ • Feedback ช่วยให้ AI เรียนรู้รูปแบบคำถามที่ถูกต้อง</footer>
        </section>
      )}

      <button
        type="button"
        className="local-ai-toggle"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={open ? 'ปิด FDH Local AI' : 'เปิด FDH Local AI'}
      >
        {open ? '×' : 'AI'}
      </button>
    </div>
  );
}
