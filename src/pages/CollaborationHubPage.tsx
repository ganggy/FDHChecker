import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthUser } from '../services/authService';
import {
  fetchCollaborationMessages,
  fetchCollaborationOverview,
  fetchCollaborationRooms,
  markCollaborationRoomRead,
  runCollaborationBot,
  sendCollaborationMessage,
  uploadCollaborationAttachment,
  type CollaborationAttachment,
  type CollaborationIssue,
  type CollaborationMessage,
  type CollaborationOverview,
  type CollaborationRoom,
} from '../services/collaborationService';
import './CollaborationHubPage.css';

type HubTab = 'overview' | 'issues' | 'chat';

const initialOverview: CollaborationOverview = {
  summary: { total: 0, needs_fix: 0, urgent: 0, completed: 0, open_rejects: 0 },
  issues: [],
  generated_at: '',
};

const statusLabels: Record<string, string> = {
  pending_mr: 'รอแก้เวชระเบียน', pending_authen: 'รอ Authen Code', pending_icd: 'รอ ICD/ICD9',
  pending_finance: 'รอการเงิน', rejected: 'ตีกลับ', open: 'ยังไม่แก้ไข', in_progress: 'กำลังแก้ไข',
  special_fund_error: 'กองทุนพิเศษ',
};

const formatDateTime = (value?: string | null) => value
  ? new Date(value).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  : '';

const formatServiceDate = (value?: string | null) => value
  ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
  : 'ไม่ระบุวันที่';

const issueTitle = (issue: CollaborationIssue) => issue.source === 'reject'
  ? `Reject ${issue.vn ? `VN ${issue.vn}` : issue.hn ? `HN ${issue.hn}` : ''}`
  : issue.source === 'special_fund'
    ? `${issue.fund || 'กองทุนพิเศษ'} · HN ${issue.hn || '-'}`
    : `งาน ${issue.vn ? `VN ${issue.vn}` : issue.hn ? `HN ${issue.hn}` : ''}`;

const getMessageAttachment = (message: CollaborationMessage): CollaborationAttachment | null => {
  let metadata = message.metadata;
  if (typeof metadata === 'string') {
    try { metadata = JSON.parse(metadata) as Record<string, unknown>; } catch { return null; }
  }
  if (!metadata || typeof metadata !== 'object') return null;
  const attachment = (metadata as { attachment?: CollaborationAttachment }).attachment;
  return attachment?.url ? attachment : null;
};

function ChatAttachment({ attachment }: { attachment: CollaborationAttachment }) {
  const [previewUrl, setPreviewUrl] = useState('');
  const [opening, setOpening] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const isImage = attachment.mime_type.startsWith('image/');

  useEffect(() => {
    if (!isImage) return;
    let active = true;
    let objectUrl = '';
    void fetch(attachment.url)
      .then((response) => {
        if (!response.ok) throw new Error('โหลดรูปไม่สำเร็จ');
        return response.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setPreviewUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment.url, isImage]);

  useEffect(() => {
    if (!viewerOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setViewerOpen(false); };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [viewerOpen]);

  const downloadAttachment = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const response = await fetch(attachment.url);
      if (!response.ok) throw new Error('เปิดไฟล์ไม่สำเร็จ');
      const blob = await response.blob();
      const shareFile = new File([blob], attachment.filename, { type: attachment.mime_type });
      if (isImage && navigator.share && navigator.canShare?.({ files: [shareFile] })) {
        await navigator.share({ files: [shareFile], title: attachment.filename });
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = attachment.filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) console.error('Download chat attachment failed:', error);
    } finally {
      setOpening(false);
    }
  };

  return (
    <>
      <button type="button" className={`chat-attachment ${isImage ? 'chat-attachment--image' : ''}`} onClick={() => isImage ? setViewerOpen(true) : void downloadAttachment()}>
        {isImage && previewUrl ? <img src={previewUrl} alt={attachment.filename} /> : <span className="attachment-file-icon">{attachment.mime_type === 'application/pdf' ? 'PDF' : 'FILE'}</span>}
        <span><strong>{attachment.filename}</strong><small>{Math.max(1, Math.ceil(attachment.size / 1024)).toLocaleString('th-TH')} KB · {isImage ? 'แตะเพื่อดูรูปขยาย' : opening ? 'กำลังเปิด…' : 'แตะเพื่อดาวน์โหลด'}</small></span>
      </button>
      {isImage && viewerOpen && (
        <div className="image-viewer" role="dialog" aria-modal="true" aria-label={`ดูรูป ${attachment.filename}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setViewerOpen(false); }}>
          <header>
            <span title={attachment.filename}>{attachment.filename}</span>
            <button type="button" onClick={() => setViewerOpen(false)} aria-label="ปิดรูป">✕</button>
          </header>
          <div className="image-viewer-stage">
            {previewUrl ? <img src={previewUrl} alt={attachment.filename} /> : <span>กำลังโหลดรูป…</span>}
          </div>
          <footer>
            <button type="button" className="image-viewer-close" onClick={() => setViewerOpen(false)}>ปิด</button>
            <button type="button" className="image-viewer-save" onClick={() => void downloadAttachment()} disabled={opening}>{opening ? 'กำลังเตรียมรูป…' : '↓ บันทึกรูป'}</button>
          </footer>
        </div>
      )}
    </>
  );
}

export default function CollaborationHubPage({ currentUser }: { currentUser: AuthUser }) {
  const [activeTab, setActiveTab] = useState<HubTab>('overview');
  const [overview, setOverview] = useState(initialOverview);
  const [rooms, setRooms] = useState<CollaborationRoom[]>([]);
  const [roomId, setRoomId] = useState(0);
  const [messages, setMessages] = useState<CollaborationMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [botLoading, setBotLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const lastMessageId = messages[messages.length - 1]?.id || 0;

  const loadDashboard = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [nextOverview, nextRooms] = await Promise.all([fetchCollaborationOverview(), fetchCollaborationRooms()]);
      setOverview(nextOverview);
      setRooms(nextRooms);
      setRoomId((current) => current || Number(nextRooms[0]?.id || 0));
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (selectedRoomId: number, after = 0) => {
    if (!selectedRoomId) return;
    try {
      const incoming = await fetchCollaborationMessages(selectedRoomId, after);
      if (incoming.length) {
        setMessages((current) => after
          ? [...current, ...incoming.filter((item) => !current.some((existing) => existing.id === item.id))]
          : incoming);
        const newestId = incoming[incoming.length - 1]?.id;
        if (newestId) void markCollaborationRoomRead(selectedRoomId, newestId).catch(() => undefined);
      } else if (!after) {
        setMessages([]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'โหลดข้อความไม่สำเร็จ');
    }
  }, []);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);
  useEffect(() => { if (roomId) void loadMessages(roomId); }, [roomId, loadMessages]);
  useEffect(() => {
    const container = chatScrollRef.current;
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [messages.length, activeTab]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadDashboard(true);
      if (roomId) void loadMessages(roomId, lastMessageId);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [lastMessageId, loadDashboard, loadMessages, roomId]);

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || !roomId || sending) return;
    setSending(true);
    try {
      setDraft('');
      await sendCollaborationMessage(roomId, body);
      await loadMessages(roomId, lastMessageId);
      void loadDashboard(true);
    } catch (sendError) {
      setDraft(body);
      setError(sendError instanceof Error ? sendError.message : 'ส่งข้อความไม่สำเร็จ');
    } finally {
      setSending(false);
    }
  };

  const handleAttachments = async (files: FileList | null) => {
    if (!files?.length || !roomId || uploading) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name} มีขนาดเกิน 10 MB`);
        await uploadCollaborationAttachment(roomId, file);
      }
      await loadMessages(roomId, lastMessageId);
      void loadDashboard(true);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'แนบไฟล์ไม่สำเร็จ');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (imageInputRef.current) imageInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
    }
  };

  const handleBotScan = async () => {
    setBotLoading(true);
    try {
      const result = await runCollaborationBot();
      setOverview(result.overview);
      await loadMessages(result.room_id, lastMessageId);
      setActiveTab('chat');
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'บอทสรุปข้อมูลไม่สำเร็จ');
    } finally {
      setBotLoading(false);
    }
  };

  const openIssue = (issue: CollaborationIssue) => {
    const page = issue.source === 'reject' ? 'rejectTracking' : issue.source === 'special_fund' ? 'specific' : 'workQueue';
    window.dispatchEvent(new CustomEvent('fdh:navigate', { detail: { page } }));
  };

  const selectedRoom = rooms.find((room) => Number(room.id) === roomId);
  const unreadTotal = rooms.reduce((sum, room) => sum + Number(room.unread_count || 0), 0);

  return (
    <div className={`collaboration-page collaboration-page--${activeTab}`}>
      <header className="collaboration-hero">
        <div>
          <span className="collaboration-eyebrow">TEAM CONTROL CENTER</span>
          <h1>ศูนย์ตรวจสอบและสื่อสารทีม</h1>
          <p>ดูภาพรวมงานที่ต้องแก้ รับแจ้งเตือน และคุยกันในกลุ่มเดียวทั้งมือถือและเว็บ</p>
        </div>
        <div className="collaboration-hero-actions">
          <span className="collaboration-live"><i /> อัปเดตอัตโนมัติทุก 10 วินาที</span>
          <button type="button" onClick={() => void handleBotScan()} disabled={botLoading}>
            {botLoading ? 'กำลังตรวจ…' : '🤖 ให้บอทสรุปตอนนี้'}
          </button>
        </div>
      </header>

      {error && <div className="collaboration-error"><span>⚠️ {error}</span><button onClick={() => setError('')}>ปิด</button></div>}

      <nav className="collaboration-tabs" aria-label="ส่วนของศูนย์ตรวจสอบ">
        <button className={activeTab === 'overview' ? 'active' : ''} onClick={() => setActiveTab('overview')}>ภาพรวม</button>
        <button className={activeTab === 'issues' ? 'active' : ''} onClick={() => setActiveTab('issues')}>ต้องแก้ไข <b>{overview.summary.needs_fix}</b></button>
        <button className={activeTab === 'chat' ? 'active' : ''} onClick={() => setActiveTab('chat')}>แชตกลุ่ม {unreadTotal > 0 && <b>{unreadTotal}</b>}</button>
      </nav>

      <main className="collaboration-layout">
        <section className={`collaboration-overview ${activeTab === 'overview' ? 'mobile-active' : ''}`}>
          <div className="collaboration-summary-grid">
            <article className="summary-tile summary-tile--all"><span>งานในคิว</span><strong>{overview.summary.total.toLocaleString('th-TH')}</strong><small>รายการทั้งหมด</small></article>
            <article className="summary-tile summary-tile--fix"><span>ต้องแก้ไข</span><strong>{overview.summary.needs_fix.toLocaleString('th-TH')}</strong><small>รวมกองทุนพิเศษ งานค้าง และ Reject</small></article>
            <article className="summary-tile summary-tile--urgent"><span>เร่งด่วน</span><strong>{overview.summary.urgent.toLocaleString('th-TH')}</strong><small>ควรดำเนินการก่อน</small></article>
            <article className="summary-tile summary-tile--done"><span>พร้อม/ส่งแล้ว</span><strong>{overview.summary.completed.toLocaleString('th-TH')}</strong><small>ผ่านขั้นตอนเบื้องต้น</small></article>
          </div>

          <article className="collaboration-card attention-card">
            <div className="card-heading"><div><span>สถานะเบื้องต้น</span><h2>สิ่งที่ทีมควรทำตอนนี้</h2></div><span className="updated-label">{loading ? 'กำลังโหลด…' : formatDateTime(overview.generated_at)}</span></div>
            {overview.summary.needs_fix > 0 ? (
              <div className="attention-body"><div className="attention-icon">!</div><div><strong>ยังมี {overview.summary.needs_fix.toLocaleString('th-TH')} รายการรอดำเนินการ</strong><p>วันนี้พบเคสกองทุนพิเศษ {(overview.summary.special_fund_issues || 0).toLocaleString('th-TH')} รายการ และ Reject {overview.summary.open_rejects.toLocaleString('th-TH')} รายการ</p></div></div>
            ) : (
              <div className="attention-body attention-body--clear"><div className="attention-icon">✓</div><div><strong>ไม่พบรายการค้าง</strong><p>ข้อมูลผ่านการตรวจสอบเบื้องต้นในขณะนี้</p></div></div>
            )}
            <button type="button" className="attention-action" onClick={() => setActiveTab('issues')}>ดูรายการที่ต้องแก้ไข →</button>
          </article>
        </section>

        <section className={`collaboration-card issue-panel ${activeTab === 'issues' ? 'mobile-active' : ''}`}>
          <div className="card-heading"><div><span>ACTION LIST · TODAY</span><h2>รายการที่จะต้องแก้ไข</h2><small className="special-fund-caption">เคสกองทุนพิเศษของวันนี้จะแสดงก่อน</small></div><b className="count-pill">{overview.issues.length}</b></div>
          <div className="issue-list">
            {overview.issues.length === 0 && <div className="empty-state"><span>✓</span><strong>ไม่มีรายการค้าง</strong><p>เมื่อตรวจพบปัญหา รายการจะแสดงที่นี่</p></div>}
            {overview.issues.map((issue) => (
              <button type="button" className={`issue-row ${issue.source === 'special_fund' ? 'issue-row--special-fund' : ''}`} key={issue.issue_id} onClick={() => openIssue(issue)}>
                <i className={`severity-dot severity-dot--${issue.severity}`} />
                <span className="issue-copy"><strong>{issueTitle(issue)}</strong><small>{issue.notes || statusLabels[issue.status] || issue.status}</small><em>{issue.fund || 'ไม่ระบุกองทุน'} · {formatServiceDate(issue.service_date)}</em></span>
                <span className={`issue-status issue-status--${issue.severity}`}>{statusLabels[issue.status] || issue.status}</span>
                <span className="issue-chevron">›</span>
              </button>
            ))}
          </div>
        </section>

        <section className={`collaboration-card chat-panel ${activeTab === 'chat' ? 'mobile-active' : ''}`}>
          <header className="chat-header">
            <div className="chat-avatar">FDH</div>
            <div><h2>{selectedRoom?.name || 'กลุ่มตรวจสอบ FDH'}</h2><span><i /> ทีมงานและ FDH Bot</span></div>
          </header>
          <div className="chat-messages" aria-live="polite" ref={chatScrollRef}>
            {messages.length === 0 && <div className="chat-empty"><span>💬</span><strong>เริ่มคุยกับทีมได้เลย</strong><p>หรือกด “ให้บอทสรุปตอนนี้” เพื่อรับรายงานในห้องนี้</p></div>}
            {messages.map((message) => {
              const mine = message.sender_type === 'user' && Number(message.user_id) === currentUser.id;
              const bot = message.sender_type === 'bot';
              const attachment = getMessageAttachment(message);
              return (
                <article className={`chat-message ${mine ? 'chat-message--mine' : ''} ${bot ? 'chat-message--bot' : ''}`} key={message.id}>
                  {!mine && <div className="message-avatar">{bot ? '🤖' : message.sender_name.slice(0, 1).toUpperCase()}</div>}
                  <div><span className="message-sender">{mine ? 'คุณ' : message.sender_name}</span><div className="message-bubble">{bot && <strong>แจ้งเตือนจากบอท</strong>}{attachment ? <ChatAttachment attachment={attachment} /> : <p>{message.body}</p>}</div><time>{formatDateTime(message.created_at)}</time></div>
                </article>
              );
            })}
          </div>
          <footer className="chat-composer">
            <div className="chat-attachment-actions">
              <input ref={fileInputRef} type="file" multiple hidden accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip" onChange={(event) => void handleAttachments(event.target.files)} />
              <input ref={imageInputRef} type="file" multiple hidden accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif" onChange={(event) => void handleAttachments(event.target.files)} />
              <input ref={cameraInputRef} type="file" hidden accept="image/*" capture="environment" onChange={(event) => void handleAttachments(event.target.files)} />
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} aria-label="แนบเอกสาร" title="แนบเอกสาร">📎</button>
              <button type="button" onClick={() => imageInputRef.current?.click()} disabled={uploading} aria-label="เลือกรูปภาพ" title="เลือกรูปภาพ">🖼️</button>
              <button type="button" onClick={() => cameraInputRef.current?.click()} disabled={uploading} aria-label="ถ่ายภาพ" title="ถ่ายภาพ">📷</button>
            </div>
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void handleSend(); } }} placeholder="พิมพ์ข้อความถึงทีม…" maxLength={2000} rows={1} />
            <button type="button" className="chat-send-button" onClick={() => void handleSend()} disabled={!draft.trim() || sending || uploading} aria-label="ส่งข้อความ">{uploading ? '…' : '➤'}</button>
          </footer>
        </section>
      </main>
    </div>
  );
}
