import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import './LocalAiAssistant.css';

type ChatMessage = {
  role: 'user' | 'assistant';
  text: string;
  sources?: Array<{ id: number; source: string; heading: string }>;
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

export function LocalAiAssistant() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<AiStatus>();
  const [accessKey, setAccessKey] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    await loadStatus();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const prompt = question.trim();
    if (!prompt || loading) return;
    setQuestion('');
    setMessages((current) => [...current, { role: 'user', text: prompt }]);
    setLoading(true);

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: prompt }),
      });
      const payload = await response.json() as {
        answer?: string;
        error?: string;
        sources?: ChatMessage['sources'];
      };
      if (response.status === 401) await loadStatus();
      if (!response.ok) throw new Error(payload.error || 'Local AI ไม่สามารถตอบได้');
      setMessages((current) => [...current, {
        role: 'assistant',
        text: payload.answer || 'ไม่พบคำตอบ',
        sources: payload.sources,
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

  return (
    <div className={`local-ai ${open ? 'local-ai--open' : ''}`}>
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
                <strong>ถามเรื่องเงื่อนไขและรายงาน FDHChecker ได้ครับ</strong>
                <p>AI จะตอบจากเอกสารในโปรเจกต์เท่านั้น และไม่ได้เชื่อมฐานข้อมูลโดยตรง</p>
              </div>
            )}
            {status?.auth?.authenticated && messages.map((message, index) => (
              <article key={`${message.role}-${index}`} className={`local-ai-message is-${message.role}`}>
                <div>{message.text}</div>
                {!!message.sources?.length && (
                  <details>
                    <summary>แหล่งข้อมูล {message.sources.length} รายการ</summary>
                    {message.sources.map((source) => (
                      <small key={`${source.id}-${source.source}`}>[{source.id}] {source.source} › {source.heading}</small>
                    ))}
                  </details>
                )}
              </article>
            ))}
            {loading && <div className="local-ai-thinking">กำลังค้นข้อมูลและประมวลผล…</div>}
          </div>

          {status?.auth?.authenticated && <form className="local-ai-form" onSubmit={submit}>
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
              placeholder="เช่น การเบิกฟอกไตต้องตรวจอะไรบ้าง"
              disabled={loading}
            />
            <button type="submit" disabled={!question.trim() || loading}>ส่ง</button>
          </form>}
          <footer>AI session ถูกสร้างใหม่อัตโนมัติสำหรับแต่ละเครื่อง</footer>
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
