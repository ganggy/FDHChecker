import { getUTFConnection } from './db/connection.js';

export function validateIpdAudit(input: Record<string, unknown>, actor: string) {
  const an = String(input.an || '').trim();
  const status = String(input.status || '').trim();
  const notes = String(input.notes || '').trim();
  if (!/^[A-Za-z0-9-]{1,20}$/.test(an) || status !== 'AUDITED' || notes.length > 4000) {
    throw new Error('ข้อมูลการตรวจสอบไม่ถูกต้อง');
  }
  if (!actor || actor.length > 100) throw new Error('ไม่พบผู้ตรวจสอบที่เข้าสู่ระบบ');
  return { an, status, notes, actor };
}

export async function appendIpdAudit(input: Record<string, unknown>, actor: string,
  connect = getUTFConnection) {
  const event = validateIpdAudit(input, actor);
  const connection = await connect();
  try {
    const [admissions] = await connection.query('SELECT an FROM ipt WHERE an = ? LIMIT 1', [event.an]);
    if (!Array.isArray(admissions) || !admissions.length) throw new Error('ไม่พบรายการผู้ป่วยใน');
    await connection.query(`CREATE TABLE IF NOT EXISTS z_fdh_audit_history (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      an VARCHAR(20) NOT NULL, status VARCHAR(30) NOT NULL,
      updated_by VARCHAR(100) NOT NULL, notes TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_audit_an_id (an, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await connection.query(`INSERT INTO z_fdh_audit_history (an, status, updated_by, notes)
      VALUES (?, ?, ?, ?)`, [event.an, event.status, event.actor, event.notes]);
    return { success: true };
  } finally { connection.release(); }
}
