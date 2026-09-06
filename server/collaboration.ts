import { getRepstmConnection } from './db.js';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOM_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS collaboration_room (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    room_key VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(160) NOT NULL,
    description VARCHAR(500) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const MESSAGE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS collaboration_message (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    room_id BIGINT NOT NULL,
    user_id BIGINT NULL,
    sender_name VARCHAR(160) NOT NULL,
    sender_type VARCHAR(16) NOT NULL DEFAULT 'user',
    message_type VARCHAR(16) NOT NULL DEFAULT 'text',
    body TEXT NOT NULL,
    event_key VARCHAR(191) NULL,
    metadata JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_collaboration_event (event_key),
    INDEX idx_collaboration_room_message (room_id, id),
    INDEX idx_collaboration_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const READ_STATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS collaboration_read_state (
    room_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    last_read_message_id BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const ATTACHMENT_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS collaboration_attachment (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    message_id BIGINT NOT NULL,
    storage_name VARCHAR(191) NOT NULL UNIQUE,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(128) NOT NULL,
    file_size BIGINT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_collaboration_attachment_message (message_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const WORK_QUEUE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS claim_work_queue (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    vn VARCHAR(25) NOT NULL,
    hn VARCHAR(25) NULL,
    patient_name VARCHAR(255) NULL,
    fund VARCHAR(128) NULL,
    service_date DATE NULL,
    queue_status VARCHAR(32) NOT NULL DEFAULT 'pending_mr',
    assigned_to VARCHAR(128) NULL,
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_vn (vn),
    INDEX idx_queue_status (queue_status),
    INDEX idx_service_date (service_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const REJECT_NOTE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS claim_reject_note (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    rep_data_id BIGINT NULL,
    tran_id VARCHAR(191) NULL,
    vn VARCHAR(32) NULL,
    an VARCHAR(32) NULL,
    hn VARCHAR(32) NULL,
    errorcode VARCHAR(128) NULL,
    verifycode VARCHAR(128) NULL,
    resolve_status VARCHAR(32) NOT NULL DEFAULT 'open',
    note TEXT NULL,
    assigned_to VARCHAR(128) NULL,
    resolved_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tran_id (tran_id),
    INDEX idx_resolve_status (resolve_status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

export type CollaborationUser = {
  id: number;
  username: string;
  display_name?: string | null;
};

export const sanitizeChatMessage = (value: unknown) => String(value ?? '')
  .split(String.fromCharCode(0)).join('')
  .replace(/\r\n/g, '\n')
  .trim()
  .slice(0, 2000);

const toNumber = (value: unknown) => Number(value || 0);

export const ensureCollaborationTables = async () => {
  const connection = await getRepstmConnection();
  try {
    await connection.query(ROOM_TABLE_SQL);
    await connection.query(MESSAGE_TABLE_SQL);
    await connection.query(READ_STATE_TABLE_SQL);
    await connection.query(ATTACHMENT_TABLE_SQL);
    await connection.query(
      `INSERT INTO collaboration_room (room_key, name, description)
       VALUES ('fdh-team', 'กลุ่มตรวจสอบ FDH', 'ห้องกลางสำหรับติดตามงาน แก้ไขข้อมูล และรับการแจ้งเตือนจากบอท')
       ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), is_active = 1`
    );
  } finally {
    connection.release();
  }
};

const CHAT_UPLOAD_LIMIT = 10 * 1024 * 1024;
const CHAT_UPLOAD_DIR = path.resolve(process.env.COLLABORATION_UPLOAD_DIR || path.join(process.cwd(), 'data', 'chat-uploads'));
const ALLOWED_CHAT_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
  'application/pdf', 'text/plain', 'text/csv',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
]);

const safeOriginalFilename = (value: unknown) => Array.from(path.basename(String(value || 'ไฟล์แนบ')))
  .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
  .join('')
  .trim()
  .slice(0, 180) || 'ไฟล์แนบ';

export const validateChatAttachment = (buffer: Buffer, mimeTypeValue: unknown) => {
  const mimeType = String(mimeTypeValue || '').toLowerCase().split(';')[0].trim();
  if (!buffer.length) throw new Error('ไฟล์ว่างเปล่า');
  if (buffer.length > CHAT_UPLOAD_LIMIT) throw new Error('ไฟล์มีขนาดเกิน 10 MB');
  if (!ALLOWED_CHAT_MIME_TYPES.has(mimeType)) throw new Error('ไม่รองรับไฟล์ประเภทนี้');
  const starts = (...bytes: number[]) => bytes.every((byte, index) => buffer[index] === byte);
  if (mimeType === 'image/jpeg' && !starts(0xff, 0xd8, 0xff)) throw new Error('ข้อมูลรูป JPEG ไม่ถูกต้อง');
  if (mimeType === 'image/png' && !starts(0x89, 0x50, 0x4e, 0x47)) throw new Error('ข้อมูลรูป PNG ไม่ถูกต้อง');
  if (mimeType === 'image/gif' && !['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) throw new Error('ข้อมูลรูป GIF ไม่ถูกต้อง');
  if (mimeType === 'image/webp' && !(buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP')) throw new Error('ข้อมูลรูป WebP ไม่ถูกต้อง');
  if (mimeType === 'application/pdf' && buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('ข้อมูล PDF ไม่ถูกต้อง');
  const zipTypes = new Set([
    'application/zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ]);
  if (zipTypes.has(mimeType) && !(starts(0x50, 0x4b, 0x03, 0x04) || starts(0x50, 0x4b, 0x05, 0x06))) throw new Error('ข้อมูลไฟล์ ZIP/Office ไม่ถูกต้อง');
  return mimeType;
};

export const createCollaborationAttachment = async (
  roomId: number,
  user: CollaborationUser,
  originalNameValue: unknown,
  mimeTypeValue: unknown,
  buffer: Buffer,
) => {
  await ensureCollaborationTables();
  const mimeType = validateChatAttachment(buffer, mimeTypeValue);
  const originalName = safeOriginalFilename(originalNameValue);
  const extension = path.extname(originalName).replace(/[^.A-Za-z0-9]/g, '').slice(0, 12).toLowerCase();
  const storageName = `${new Date().toISOString().slice(0, 10)}-${randomUUID()}${extension}`;
  await fs.mkdir(CHAT_UPLOAD_DIR, { recursive: true, mode: 0o750 });
  const storagePath = path.join(CHAT_UPLOAD_DIR, storageName);
  const connection = await getRepstmConnection();
  try {
    const [roomRows] = await connection.query('SELECT id FROM collaboration_room WHERE id = ? AND is_active = 1 LIMIT 1', [roomId]);
    if (!Array.isArray(roomRows) || roomRows.length === 0) throw new Error('ไม่พบห้องสนทนา');
    await fs.writeFile(storagePath, buffer, { mode: 0o640, flag: 'wx' });
    await connection.beginTransaction();
    const senderName = sanitizeChatMessage(user.display_name || user.username).slice(0, 160) || 'ผู้ใช้งาน';
    const [messageResult] = await connection.query(
      `INSERT INTO collaboration_message (room_id, user_id, sender_name, sender_type, message_type, body)
       VALUES (?, ?, ?, 'user', 'attachment', ?)`,
      [roomId, user.id, senderName, originalName]
    );
    const messageId = toNumber((messageResult as { insertId?: number }).insertId);
    const [attachmentResult] = await connection.query(
      `INSERT INTO collaboration_attachment (message_id, storage_name, original_name, mime_type, file_size)
       VALUES (?, ?, ?, ?, ?)`,
      [messageId, storageName, originalName, mimeType, buffer.length]
    );
    const attachmentId = toNumber((attachmentResult as { insertId?: number }).insertId);
    const attachment = {
      id: attachmentId,
      filename: originalName,
      mime_type: mimeType,
      size: buffer.length,
      url: `/api/collaboration/attachments/${attachmentId}`,
    };
    await connection.query('UPDATE collaboration_message SET metadata = ? WHERE id = ?', [JSON.stringify({ attachment }), messageId]);
    await connection.commit();
    return { id: messageId, attachment };
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    await fs.unlink(storagePath).catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
};

export const getCollaborationAttachment = async (attachmentId: number) => {
  await ensureCollaborationTables();
  const connection = await getRepstmConnection();
  try {
    const [rows] = await connection.query(
      `SELECT a.id, a.original_name, a.mime_type, a.file_size, a.storage_name
       FROM collaboration_attachment a
       INNER JOIN collaboration_message m ON m.id = a.message_id
       INNER JOIN collaboration_room r ON r.id = m.room_id AND r.is_active = 1
       WHERE a.id = ? LIMIT 1`,
      [attachmentId]
    );
    const row = Array.isArray(rows) ? rows[0] as Record<string, unknown> | undefined : undefined;
    if (!row) throw new Error('ไม่พบไฟล์แนบ');
    const storageName = String(row.storage_name || '');
    if (path.basename(storageName) !== storageName) throw new Error('ชื่อไฟล์จัดเก็บไม่ถูกต้อง');
    return {
      id: toNumber(row.id),
      filename: safeOriginalFilename(row.original_name),
      mimeType: String(row.mime_type || 'application/octet-stream'),
      size: toNumber(row.file_size),
      path: path.join(CHAT_UPLOAD_DIR, storageName),
    };
  } finally {
    connection.release();
  }
};

export type CollaborationBotPublishInput = {
  botKey: string;
  senderName: string;
  reportDate: string;
  messages: string[];
  metadata?: Record<string, unknown>;
};

export const publishCollaborationBotMessages = async ({
  botKey,
  senderName,
  reportDate,
  messages,
  metadata = {},
}: CollaborationBotPublishInput) => {
  await ensureCollaborationTables();
  const connection = await getRepstmConnection();
  try {
    const [roomRows] = await connection.query("SELECT id FROM collaboration_room WHERE room_key = 'fdh-team' LIMIT 1");
    const roomId = toNumber(Array.isArray(roomRows) ? (roomRows[0] as Record<string, unknown> | undefined)?.id : 0);
    if (!roomId) throw new Error('ไม่พบห้องกลาง');
    let created = 0;
    for (const [index, rawBody] of messages.entries()) {
      const body = String(rawBody ?? '').split(String.fromCharCode(0)).join('').replace(/\r\n/g, '\n').trim().slice(0, 5000);
      if (!body) continue;
      const digest = createHash('sha256').update(body).digest('hex').slice(0, 16);
      const eventKey = `${botKey}:${reportDate}:${index}:${digest}`.slice(0, 191);
      const [result] = await connection.query(
        `INSERT IGNORE INTO collaboration_message
           (room_id, user_id, sender_name, sender_type, message_type, body, event_key, metadata)
         VALUES (?, NULL, ?, 'bot', 'alert', ?, ?, ?)`,
        [roomId, senderName.slice(0, 160), body, eventKey, JSON.stringify({ ...metadata, botKey, reportDate })]
      );
      created += toNumber((result as { affectedRows?: number }).affectedRows);
    }
    return { created, room_id: roomId };
  } finally {
    connection.release();
  }
};

export const listCollaborationRooms = async (userId: number) => {
  await ensureCollaborationTables();
  const connection = await getRepstmConnection();
  try {
    const [rows] = await connection.query(
      `SELECT r.id, r.room_key, r.name, r.description,
              latest.id AS last_message_id, latest.body AS last_message,
              latest.sender_name AS last_sender_name, latest.sender_type AS last_sender_type,
              latest.created_at AS last_message_at,
              COALESCE(SUM(CASE WHEN m.id > COALESCE(rs.last_read_message_id, 0) AND COALESCE(m.user_id, -1) <> ? THEN 1 ELSE 0 END), 0) AS unread_count
       FROM collaboration_room r
       LEFT JOIN collaboration_read_state rs ON rs.room_id = r.id AND rs.user_id = ?
       LEFT JOIN collaboration_message m ON m.room_id = r.id
       LEFT JOIN collaboration_message latest ON latest.id = (SELECT MAX(m2.id) FROM collaboration_message m2 WHERE m2.room_id = r.id)
       WHERE r.is_active = 1
       GROUP BY r.id, r.room_key, r.name, r.description, latest.id, latest.body, latest.sender_name, latest.sender_type, latest.created_at
       ORDER BY COALESCE(latest.created_at, r.created_at) DESC`,
      [userId, userId]
    );
    return Array.isArray(rows) ? rows : [];
  } finally {
    connection.release();
  }
};

export const listCollaborationMessages = async (roomId: number, afterId = 0, limit = 100) => {
  await ensureCollaborationTables();
  const connection = await getRepstmConnection();
  try {
    const boundedLimit = Math.max(1, Math.min(limit, 200));
    const [rows] = await connection.query(
      `SELECT id, room_id, user_id, sender_name, sender_type, message_type, body, metadata, created_at
       FROM collaboration_message
       WHERE room_id = ? AND id > ?
       ORDER BY id ASC
       LIMIT ?`,
      [roomId, Math.max(0, afterId), boundedLimit]
    );
    return Array.isArray(rows) ? rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      if (typeof row.metadata === 'string') {
        try { return { ...row, metadata: JSON.parse(row.metadata) }; } catch { return { ...row, metadata: null }; }
      }
      return row;
    }) : [];
  } finally {
    connection.release();
  }
};

export const createCollaborationMessage = async (roomId: number, user: CollaborationUser, bodyValue: unknown) => {
  await ensureCollaborationTables();
  const body = sanitizeChatMessage(bodyValue);
  if (!body) throw new Error('กรุณาพิมพ์ข้อความ');
  const connection = await getRepstmConnection();
  try {
    const [roomRows] = await connection.query('SELECT id FROM collaboration_room WHERE id = ? AND is_active = 1 LIMIT 1', [roomId]);
    if (!Array.isArray(roomRows) || roomRows.length === 0) throw new Error('ไม่พบห้องสนทนา');
    const senderName = sanitizeChatMessage(user.display_name || user.username).slice(0, 160) || 'ผู้ใช้งาน';
    const [result] = await connection.query(
      `INSERT INTO collaboration_message (room_id, user_id, sender_name, sender_type, message_type, body)
       VALUES (?, ?, ?, 'user', 'text', ?)`,
      [roomId, user.id, senderName, body]
    );
    return { id: toNumber((result as { insertId?: number }).insertId) };
  } finally {
    connection.release();
  }
};

export const markCollaborationRead = async (roomId: number, userId: number, messageId: number) => {
  await ensureCollaborationTables();
  const connection = await getRepstmConnection();
  try {
    await connection.query(
      `INSERT INTO collaboration_read_state (room_id, user_id, last_read_message_id)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE last_read_message_id = GREATEST(last_read_message_id, VALUES(last_read_message_id))`,
      [roomId, userId, Math.max(0, messageId)]
    );
  } finally {
    connection.release();
  }
};

export const getCollaborationOverview = async (limit = 60) => {
  const connection = await getRepstmConnection();
  try {
    await connection.query(WORK_QUEUE_TABLE_SQL);
    await connection.query(REJECT_NOTE_TABLE_SQL);
    const [queueSummaryRows] = await connection.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN queue_status NOT IN ('ready', 'sent') THEN 1 ELSE 0 END) AS needs_fix,
              SUM(CASE WHEN queue_status = 'rejected' THEN 1 ELSE 0 END) AS urgent,
              SUM(CASE WHEN queue_status IN ('ready', 'sent') THEN 1 ELSE 0 END) AS completed
       FROM claim_work_queue`
    );
    const summaryRow = Array.isArray(queueSummaryRows) ? (queueSummaryRows[0] as Record<string, unknown> | undefined) : undefined;
    const [queueRows] = await connection.query(
      `SELECT CONCAT('queue-', id) AS issue_id, 'work_queue' AS source, vn, hn, fund,
              DATE_FORMAT(service_date, '%Y-%m-%d') AS service_date, queue_status AS status,
              assigned_to, notes,
              CASE WHEN queue_status = 'rejected' THEN 'urgent' ELSE 'warning' END AS severity,
              updated_at
       FROM claim_work_queue
       WHERE queue_status NOT IN ('ready', 'sent')
       ORDER BY CASE WHEN queue_status = 'rejected' THEN 0 ELSE 1 END, updated_at DESC
       LIMIT ?`,
      [Math.max(1, Math.min(limit, 200))]
    );

    let rejectOpen = 0;
    let rejectRows: unknown[] = [];
    try {
      const [rejectCountRows] = await connection.query(
        `SELECT COUNT(*) AS total
         FROM rep_data rd
         LEFT JOIN claim_reject_note rn ON rn.tran_id = rd.tran_id AND rn.tran_id IS NOT NULL
         WHERE TRIM(COALESCE(rd.errorcode, '')) NOT IN ('', '-')
           AND COALESCE(rn.resolve_status, 'open') <> 'resolved'`
      );
      rejectOpen = toNumber(Array.isArray(rejectCountRows) ? (rejectCountRows[0] as Record<string, unknown> | undefined)?.total : 0);
      const [rows] = await connection.query(
        `SELECT CONCAT('reject-', rd.id) AS issue_id, 'reject' AS source, rd.vn, rd.hn,
                rd.maininscl AS fund, DATE_FORMAT(rd.admdate, '%Y-%m-%d') AS service_date,
                COALESCE(rn.resolve_status, 'open') AS status, rn.assigned_to,
                CONCAT('Error: ', COALESCE(rd.errorcode, '-'), IF(TRIM(COALESCE(rd.verifycode, '')) = '', '', CONCAT(' / Verify: ', rd.verifycode))) AS notes,
                'urgent' AS severity, COALESCE(rn.updated_at, rd.created_at) AS updated_at
         FROM rep_data rd
         LEFT JOIN claim_reject_note rn ON rn.tran_id = rd.tran_id AND rn.tran_id IS NOT NULL
         WHERE TRIM(COALESCE(rd.errorcode, '')) NOT IN ('', '-')
           AND COALESCE(rn.resolve_status, 'open') <> 'resolved'
         ORDER BY COALESCE(rn.updated_at, rd.created_at) DESC
         LIMIT ?`,
        [Math.max(1, Math.min(Math.ceil(limit / 2), 100))]
      );
      rejectRows = Array.isArray(rows) ? rows : [];
    } catch (error) {
      console.warn('Collaboration reject overview unavailable:', (error as Error).message);
    }

    const queueItems = Array.isArray(queueRows) ? queueRows : [];
    const issues = [...rejectRows, ...queueItems].slice(0, limit);
    const queueNeedsFix = toNumber(summaryRow?.needs_fix);
    return {
      summary: {
        total: toNumber(summaryRow?.total),
        needs_fix: queueNeedsFix + rejectOpen,
        urgent: toNumber(summaryRow?.urgent) + rejectOpen,
        completed: toNumber(summaryRow?.completed),
        open_rejects: rejectOpen,
      },
      issues,
      generated_at: new Date().toISOString(),
    };
  } finally {
    connection.release();
  }
};

export const publishOverviewBotMessage = async () => {
  const overview = await getCollaborationOverview(20);
  await ensureCollaborationTables();
  const connection = await getRepstmConnection();
  try {
    const [roomRows] = await connection.query("SELECT id FROM collaboration_room WHERE room_key = 'fdh-team' LIMIT 1");
    const roomId = toNumber(Array.isArray(roomRows) ? (roomRows[0] as Record<string, unknown> | undefined)?.id : 0);
    if (!roomId) throw new Error('ไม่พบห้องกลาง');
    const signature = `${overview.summary.total}:${overview.summary.needs_fix}:${overview.summary.urgent}:${overview.summary.completed}`;
    const eventKey = `overview:${new Date().toISOString().slice(0, 10)}:${signature}`;
    const body = overview.summary.needs_fix > 0
      ? `สรุปการตรวจสอบเบื้องต้น: มี ${overview.summary.needs_fix.toLocaleString('th-TH')} รายการที่ต้องตรวจแก้ไข โดยเป็นเรื่องเร่งด่วน ${overview.summary.urgent.toLocaleString('th-TH')} รายการ`
      : 'สรุปการตรวจสอบเบื้องต้น: ขณะนี้ไม่พบรายการค้างที่ต้องแก้ไข';
    const [result] = await connection.query(
      `INSERT IGNORE INTO collaboration_message
         (room_id, user_id, sender_name, sender_type, message_type, body, event_key, metadata)
       VALUES (?, NULL, 'FDH Bot', 'bot', 'alert', ?, ?, ?)`,
      [roomId, body, eventKey, JSON.stringify({ summary: overview.summary })]
    );
    return { created: toNumber((result as { affectedRows?: number }).affectedRows) > 0, room_id: roomId, overview };
  } finally {
    connection.release();
  }
};
