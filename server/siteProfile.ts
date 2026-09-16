import type { HospitalConnection } from './hospitalDatabase.js';

export async function readHospitalIdentity(connection: HospitalConnection) {
  const [rows] = await connection.query('SELECT * FROM opdconfig LIMIT 1');
  const row = (rows as Record<string, unknown>[])[0] || {};
  return {
    hospital_name: String(row.hospitalname || row.hospital_name || '').trim(),
    hospital_code: String(row.hospitalcode || row.hospital_code || '').trim(),
  };
}

export function parseSiteWalkinSettings(value: unknown) {
  const settings = value as Record<string, unknown> | null;
  const raw = settings?.uc_walkin_pttypes;
  if (!Array.isArray(raw) || !raw.length || raw.length > 50 || raw.some(code => typeof code !== 'string' || !/^[A-Za-z0-9]{1,10}$/.test(code))) {
    throw new Error('กรุณาตั้งค่ารหัสสิทธิ์ UC WALKIN ของโรงพยาบาลในหน้าตั้งค่า');
  }
  const icode = String(settings?.uc_walkin_icode || '').trim();
  if (!/^[A-Za-z0-9]{1,20}$/.test(icode)) throw new Error('กรุณาตั้งค่ารหัสรายการ WALKIN ของโรงพยาบาล');
  return { pttypes: [...new Set(raw as string[])], icode };
}

export function parseVillageScope(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 1000 || value.some(id => typeof id !== 'string' || !/^\d{1,10}$/.test(id))) {
    throw new Error('กรุณาเลือกหมู่บ้านในเขตรับผิดชอบจากตาราง village ในหน้าตั้งค่า');
  }
  return [...new Set(value as string[])];
}
