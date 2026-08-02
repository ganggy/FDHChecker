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
};

export function LocalAiAssistant() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<AiStatus['ai']>();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    fetch('/api/ai/status')
      .then((response) => response.json())
      .then((payload: AiStatus) => setStatus(payload.ai))
      .catch(() => setStatus({ configured: false, reachable: false }));
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

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
              <span className={`local-ai-status ${status?.configured ? 'is-ready' : ''}`}>
                {status?.configured ? `${status.model} พร้อมใช้งาน` : 'กำลังตรวจสอบ Ollama'}
              </span>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="ปิดผู้ช่วย">×</button>
          </header>

          <div className="local-ai-messages" ref={scrollRef}>
            {!messages.length && (
              <div className="local-ai-welcome">
                <strong>ถามเรื่องเงื่อนไขและรายงาน FDHChecker ได้ครับ</strong>
                <p>AI จะตอบจากเอกสารในโปรเจกต์เท่านั้น และไม่ได้เชื่อมฐานข้อมูลโดยตรง</p>
              </div>
            )}
            {messages.map((message, index) => (
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

          <form className="local-ai-form" onSubmit={submit}>
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
          </form>
          <footer>ห้ามส่ง HN, VN, AN, เลขบัตร หรือชื่อผู้ป่วย</footer>
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
