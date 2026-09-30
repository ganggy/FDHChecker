import type { RepErrorCatalog } from '../services/repErrorCatalogService';
import type { StmZeroRow } from './stmZeroAudit';

const normalize = (key: string) => key.normalize('NFKC').toLowerCase().replace(/[\s_.-]/g, '');
export function repSheetZeroReasons(row: StmZeroRow, catalog: RepErrorCatalog) {
  const reasonKeys = ['reason', 'remark', 'remarks', 'error_description', 'error_message', 'deny_reason', 'เหตุผล', 'เหตุผลที่ไม่ชดเชย', 'สาเหตุ', 'รายละเอียดข้อผิดพลาด', 'หมายเหตุ'];
  const original = Object.entries(row.raw_data).filter(([key, value]) => reasonKeys.some(k => normalize(k) === normalize(key)) && value != null && String(value).trim())
    .map(([key, value]) => ({ label: key, text: String(value) }));
  const codes = [...new Set(`${row.errorcode}|${row.verifycode}`.split(/[,|;/\s]+/).map(c => c.trim().toUpperCase()).filter(Boolean))];
  const explanations = codes.map(code => {
    const key = catalog[code] ? code : /^C\d+(?:-\d+)?$/.test(code) ? code.slice(1) : code;
    return { code, description: catalog[key]?.description || 'ยังไม่มีคำอธิบายรหัสนี้ในระบบ กรุณาตรวจแถวต้นฉบับ REP',
      guide: catalog[key]?.guide || '', known: Boolean(catalog[key]) };
  });
  return { original, explanations };
}
