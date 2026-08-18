import React, { useCallback, useEffect, useRef, useState } from 'react';
import './CollaborationPage.css';

interface Room {
  id: number;
  roomKey: string;
  name: string;
  description?: string | null;
  unreadCount: number;
  lastMessage?: {
    senderName: string;
    body: string;
    createdAt: string;
  } | null;
}

interface MessageAttachment {
  id: number;
  originalName: string;
  mimeType: string;
  fileSize: number;
}

interface Message {
  id: number;
  roomId: number;
  userId?: number | null;
  senderName: string;
  senderType: 'user' | 'bot' | 'system';
  messageType: 'text' | 'image' | 'file' | 'system';
  body: string;
  createdAt: string;
  attachments?: MessageAttachment[];
}

interface OverviewData {
  roomsCount: number;
  messagesCount: number;
  unreadTotal: number;
  botTodayMessagesCount: number;
  specialFundIssuesCount: number;
  todayIssues?: Array<{ issue_code: string; title: string; count: number }>;
}

export const CollaborationPage: React.FC = () => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [scanningBot, setScanningBot] = useState(false);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Fetch logged in user
  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((payload) => {
        if (payload?.user?.id) setCurrentUserId(Number(payload.user.id));
      })
      .catch(() => undefined);
  }, []);

  // Load Overview
  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/collaboration/overview');
      const payload = await res.json();
      if (payload.success) setOverview(payload.data);
    } catch {
      /* best effort */
    }
  }, []);

  // Load Rooms
  const loadRooms = useCallback(async () => {
    try {
      const res = await fetch('/api/collaboration/rooms');
      const payload = await res.json();
      if (payload.success && Array.isArray(payload.data)) {
        setRooms(payload.data);
        if (!activeRoomId && payload.data.length > 0) {
          setActiveRoomId(payload.data[0].id);
        }
      }
    } catch {
      /* best effort */
    } finally {
      setLoadingRooms(false);
    }
  }, [activeRoomId]);

  // Load Messages for Active Room
  const loadMessages = useCallback(async (roomId: number, isSilent = false) => {
    if (!isSilent) setLoadingMessages(true);
    try {
      const res = await fetch(`/api/collaboration/rooms/${roomId}/messages?limit=100`);
      const payload = await res.json();
      if (payload.success && Array.isArray(payload.data)) {
        setMessages(payload.data);
        // Mark as read
        if (payload.data.length > 0) {
          const lastMsg = payload.data[payload.data.length - 1];
          void fetch(`/api/collaboration/rooms/${roomId}/read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageId: lastMsg.id }),
          }).catch(() => undefined);
        }
      }
    } catch {
      /* best effort */
    } finally {
      if (!isSilent) setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
    void loadRooms();
  }, [loadOverview, loadRooms]);

  useEffect(() => {
    if (activeRoomId) {
      void loadMessages(activeRoomId);
    }
  }, [activeRoomId, loadMessages]);

  // Auto-refresh messages every 4 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      if (activeRoomId) {
        void loadMessages(activeRoomId, true);
        void loadOverview();
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [activeRoomId, loadMessages, loadOverview]);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Trigger LINE Bot Scan
  const triggerBotScan = async () => {
    setScanningBot(true);
    try {
      const res = await fetch('/api/collaboration/bot/scan', { method: 'POST' });
      const payload = await res.json();
      if (payload.success) {
        await loadRooms();
        if (activeRoomId) await loadMessages(activeRoomId, true);
        await loadOverview();
      }
    } catch {
      alert('สแกนข้อความ LINE ไม่สำเร็จ');
    } finally {
      setScanningBot(false);
    }
  };

  // Send Text Message
  const sendMessage = async () => {
    if (!inputText.trim() || !activeRoomId || sending) return;
    const bodyText = inputText.trim();
    setInputText('');
    setSending(true);

    try {
      const res = await fetch(`/api/collaboration/rooms/${activeRoomId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: bodyText }),
      });
      const payload = await res.json();
      if (payload.success) {
        await loadMessages(activeRoomId, true);
        await loadRooms();
      } else {
        alert(payload.error || 'ส่งข้อความไม่สำเร็จ');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'ส่งข้อความไม่สำเร็จ');
    } finally {
      setSending(false);
    }
  };

  // Upload Attachment
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !activeRoomId) return;

    const formData = new FormData();
    formData.append('file', file);

    setSending(true);
    try {
      const res = await fetch(`/api/collaboration/rooms/${activeRoomId}/attachments?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: await file.arrayBuffer(),
      });
      const payload = await res.json();
      if (payload.success) {
        await loadMessages(activeRoomId, true);
        await loadRooms();
      } else {
        alert(payload.error || 'แนบไฟล์ไม่สำเร็จ');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'แนบไฟล์ไม่สำเร็จ');
    } finally {
      setSending(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const activeRoom = rooms.find((r) => r.id === activeRoomId);

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">💬 ศูนย์ประสานงาน & แชทตรวจเบิก (LINE Collaboration)</h1>
          <p className="page-subtitle">สนทนา แจ้งเตือนข้อผิดพลาดเบิก และซิงค์ข้อความจาก LINE Bot ในที่เดียว</p>
        </div>
        {overview && (
          <div style={{ display: 'flex', gap: 10 }}>
            <span className="badge badge-info">💬 {overview.messagesCount} ข้อความ</span>
            <span className="badge badge-success">🤖 LINE {overview.botTodayMessagesCount} รายการวันนี้</span>
            {overview.specialFundIssuesCount > 0 && (
              <span className="badge badge-warning">⚠️ พบประเด็น {overview.specialFundIssuesCount} รายการ</span>
            )}
          </div>
        )}
      </div>

      <div className="collab-container">
        {/* Sidebar */}
        <div className="collab-sidebar">
          <div className="collab-sidebar__header">
            <div className="collab-sidebar__title">
              <span>ห้องสนทนาทีมเบิก</span>
              <span className="collab-sidebar__title-badge">LINE Sync</span>
            </div>
            <button
              className="collab-sidebar__scan-btn"
              type="button"
              onClick={() => void triggerBotScan()}
              disabled={scanningBot}
            >
              {scanningBot ? '⏳ กำลังสแกน...' : '🔄 สแกนข้อความ LINE'}
            </button>
          </div>

          <div className="collab-sidebar__rooms">
            {loadingRooms ? (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>กำลังโหลดห้องสนทนา...</div>
            ) : rooms.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>ยังไม่มีห้องสนทนา</div>
            ) : (
              rooms.map((room) => {
                const isActive = room.id === activeRoomId;
                const isBot = room.roomKey === 'line-bot' || room.name.includes('LINE');
                return (
                  <div
                    key={room.id}
                    className={`collab-room-item ${isActive ? 'is-active' : ''}`}
                    onClick={() => setActiveRoomId(room.id)}
                  >
                    <div className={`collab-room-item__avatar ${isBot ? 'collab-room-item__avatar--bot' : ''}`}>
                      {isBot ? 'LINE' : room.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="collab-room-item__info">
                      <div className="collab-room-item__name">{room.name}</div>
                      <div className="collab-room-item__preview">
                        {room.lastMessage ? `${room.lastMessage.senderName}: ${room.lastMessage.body}` : room.description || 'กดเพื่อเริ่มสนทนา'}
                      </div>
                    </div>
                    {room.unreadCount > 0 && (
                      <div className="collab-room-item__unread">{room.unreadCount}</div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Main Chat Window */}
        {activeRoom ? (
          <div className="collab-main">
            <div className="collab-header">
              <div>
                <h3 className="collab-header__title">
                  <span>{activeRoom.name}</span>
                  <span className="badge badge-success" style={{ fontSize: 11 }}>ออนไลน์</span>
                </h3>
                {activeRoom.description && (
                  <div className="collab-header__subtitle">{activeRoom.description}</div>
                )}
              </div>
            </div>

            <div className="collab-messages">
              {loadingMessages ? (
                <div style={{ margin: 'auto', color: 'var(--text-muted)' }}>กำลังโหลดข้อความ...</div>
              ) : messages.length === 0 ? (
                <div className="collab-empty">
                  <div className="collab-empty__icon">💬</div>
                  <div>ยังไม่มีข้อความในห้องนี้ พิมพ์ข้อความด้านล่างเพื่อเริ่มแชท</div>
                </div>
              ) : (
                messages.map((msg) => {
                  const isOwn = currentUserId != null && msg.userId === currentUserId;
                  const isBot = msg.senderType === 'bot' || msg.senderName.includes('LINE');
                  const isSystem = msg.senderType === 'system' || msg.messageType === 'system';

                  if (isSystem) {
                    return (
                      <div key={msg.id} className="collab-msg collab-msg--system">
                        <div className="collab-msg__bubble">{msg.body}</div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={msg.id}
                      className={`collab-msg ${isOwn ? 'collab-msg--own' : 'collab-msg--other'}`}
                    >
                      {!isOwn && (
                        <div className={`collab-msg__avatar ${isBot ? 'collab-msg__avatar--bot' : ''}`}>
                          {isBot ? 'L' : msg.senderName.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="collab-msg__content">
                        {!isOwn && <div className="collab-msg__sender">{msg.senderName}</div>}
                        <div className="collab-msg__bubble">
                          {msg.body}
                          {msg.attachments && msg.attachments.length > 0 && (
                            <div className="collab-msg__attachment">
                              <span>📎</span>
                              <a
                                href={`/api/collaboration/attachments/${msg.attachments[0].id}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {msg.attachments[0].originalName}
                              </a>
                            </div>
                          )}
                        </div>
                        <div className="collab-msg__time">
                          {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Bar */}
            <div className="collab-input-bar">
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                onChange={(e) => void handleFileUpload(e)}
              />
              <button
                type="button"
                className="collab-input-bar__attach-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending}
                title="แนบไฟล์หรือรูปภาพ"
              >
                📎 แนบไฟล์
              </button>
              <textarea
                className="collab-input-bar__textarea"
                rows={1}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder="พิมพ์ข้อความ... (กด Enter เพื่อส่ง)"
              />
              <button
                type="button"
                className="collab-input-bar__send-btn"
                onClick={() => void sendMessage()}
                disabled={sending || !inputText.trim()}
              >
                {sending ? '⏳' : '🚀 ส่งข้อความ'}
              </button>
            </div>
          </div>
        ) : (
          <div className="collab-empty">
            <div className="collab-empty__icon">💬</div>
            <div>เลือกห้องสนทนาด้านซ้ายเพื่อเริ่มแชท</div>
          </div>
        )}
      </div>
    </div>
  );
};
