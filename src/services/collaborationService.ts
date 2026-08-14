export type CollaborationRoom = {
  id: number;
  room_key: string;
  name: string;
  description?: string | null;
  last_message_id?: number | null;
  last_message?: string | null;
  last_sender_name?: string | null;
  last_message_at?: string | null;
  unread_count: number;
};

export type CollaborationMessage = {
  id: number;
  room_id: number;
  user_id?: number | null;
  sender_name: string;
  sender_type: 'user' | 'bot' | 'system';
  message_type: 'text' | 'alert' | 'status' | 'attachment';
  body: string;
  metadata?: Record<string, unknown> | string | null;
  created_at: string;
};

export type CollaborationAttachment = {
  id: number;
  filename: string;
  mime_type: string;
  size: number;
  url: string;
};

export type CollaborationIssue = {
  issue_id: string;
  source: 'work_queue' | 'reject' | 'special_fund';
  vn?: string | null;
  hn?: string | null;
  fund?: string | null;
  service_date?: string | null;
  status: string;
  assigned_to?: string | null;
  notes?: string | null;
  severity: 'urgent' | 'warning';
  updated_at?: string | null;
};

export type CollaborationOverview = {
  summary: { total: number; needs_fix: number; urgent: number; completed: number; open_rejects: number; special_fund_issues?: number };
  issues: CollaborationIssue[];
  generated_at: string;
};

const requestJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) throw new Error(payload.error || 'เชื่อมต่อระบบไม่สำเร็จ');
  return payload.data as T;
};

export const fetchCollaborationOverview = () => requestJson<CollaborationOverview>('/api/collaboration/overview');
export const fetchCollaborationRooms = () => requestJson<CollaborationRoom[]>('/api/collaboration/rooms');
export const fetchCollaborationMessages = (roomId: number, after = 0) =>
  requestJson<CollaborationMessage[]>(`/api/collaboration/rooms/${roomId}/messages?after=${after}&limit=200`);
export const sendCollaborationMessage = (roomId: number, body: string) =>
  requestJson<{ id: number }>(`/api/collaboration/rooms/${roomId}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
  });
const attachmentMimeType = (file: File) => file.type || ({
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv', txt: 'text/plain', zip: 'application/zip', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif',
} as Record<string, string>)[file.name.split('.').pop()?.toLowerCase() || ''] || 'application/octet-stream';

export const uploadCollaborationAttachment = (roomId: number, file: File) =>
  requestJson<{ id: number; attachment: CollaborationAttachment }>(
    `/api/collaboration/rooms/${roomId}/attachments?filename=${encodeURIComponent(file.name)}`,
    { method: 'POST', headers: { 'Content-Type': attachmentMimeType(file) }, body: file },
  );
export const markCollaborationRoomRead = (roomId: number, messageId: number) =>
  requestJson<void>(`/api/collaboration/rooms/${roomId}/read`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId }),
  });
export const runCollaborationBot = () =>
  requestJson<{ created: boolean; room_id: number; overview: CollaborationOverview }>('/api/collaboration/bot/scan', { method: 'POST' });
