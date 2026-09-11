import { getUTFConnection } from './db.js';
import { RECEIVABLE_RIGHT_MAPPINGS } from './receivableMapping.js';

export type RevenueCategoryKey = 'uc' | 'agency' | 'local' | 'csm' | 'sss' | 'migrant' | 'stateless' | 'other';
export type RevenueSourceRow = { pttype?: string | null; pttype_name?: string | null; hipdata_code?: string | null; service_count?: number | string | null; adjrw?: number | string | null; actual_charge?: number | string | null };
export type RevenueReportRow = {
  key: RevenueCategoryKey; account_code: string; label: string; service_count: number; adjrw: number; actual_charge: number;
  rights: Array<{ pttype: string; name: string; hipdata_code: string; service_count: number; adjrw: number; actual_charge: number; mapped_by: 'finance' | 'hipdata' | 'name' | 'fallback' }>;
};

const CATEGORY_DEFINITIONS: Array<{ key: RevenueCategoryKey; opd: string; ipd: string; label: string }> = [
  { key: 'uc', opd: '41010', ipd: '42010', label: 'รายได้ค่ารักษาสิทธิ UC' },
  { key: 'agency', opd: '41020', ipd: '42020', label: 'รายได้ค่ารักษาเบิกต้นสังกัด' },
  { key: 'local', opd: '41030', ipd: '42030', label: 'รายได้ค่ารักษาเบิกจ่ายตรง อปท.' },
  { key: 'csm', opd: '41040', ipd: '42040', label: 'รายได้ค่ารักษาเบิกจ่ายตรงกรมบัญชีกลาง' },
  { key: 'sss', opd: '41050', ipd: '42050', label: 'รายได้ค่ารักษาสิทธิประกันสังคม' },
  { key: 'migrant', opd: '41060', ipd: '42060', label: 'รายได้ค่ารักษาแรงงานต่างด้าว' },
  { key: 'stateless', opd: '41065', ipd: '42065', label: 'รายได้ค่ารักษาบุคคลที่มีปัญหาสถานะและสิทธิ' },
  { key: 'other', opd: '41070', ipd: '42070', label: 'รายได้ค่ารักษาและบริการอื่น ๆ' },
];

const mappingByPttype = new Map(RECEIVABLE_RIGHT_MAPPINGS.map((row) => [String(row.hosxp_code), row]));
const clean = (value: unknown) => String(value || '').normalize('NFKC').trim();
const upper = (value: unknown) => clean(value).toUpperCase();
const numeric = (value: unknown) => { const parsed = Number(value || 0); return Number.isFinite(parsed) ? parsed : 0; };

export const classifyRevenueRight = (row: Pick<RevenueSourceRow, 'pttype' | 'pttype_name' | 'hipdata_code'>) => {
  const pttype = clean(row.pttype);
  const mapping = mappingByPttype.get(pttype);
  const finance = clean(mapping?.finance_name);
  const hipdata = upper(mapping?.hipdata_code || row.hipdata_code);
  const name = clean(mapping?.hosxp_name || row.pttype_name);
  if (/เบิกต้นสังกัด/.test(finance) || hipdata === 'A2') return { key: 'agency' as const, mapped_by: mapping ? 'finance' as const : 'hipdata' as const };
  if (/อปท|พัทยา|กทม/.test(finance) || ['LGO', 'PTY', 'BKK'].includes(hipdata)) return { key: 'local' as const, mapped_by: mapping ? 'finance' as const : 'hipdata' as const };
  if (/กรมบัญชีกลาง/.test(finance) || ['OFC', 'CSMBS'].includes(hipdata)) return { key: 'csm' as const, mapped_by: mapping && /กรมบัญชีกลาง/.test(finance) ? 'finance' as const : 'hipdata' as const };
  if (/ประกันสังคม/.test(finance) || ['SSS', 'SSI'].includes(hipdata)) return { key: 'sss' as const, mapped_by: mapping ? 'finance' as const : 'hipdata' as const };
  if (/ต่างด้าว/.test(finance) || hipdata === 'NRD' || /ต่างด้าว|แรงงานต่างชาติ/.test(name)) return { key: 'migrant' as const, mapped_by: mapping ? 'finance' as const : name ? 'name' as const : 'hipdata' as const };
  if (/ปัญหาสถานะ|สถานะและสิทธิ/.test(finance) || hipdata === 'STP' || /ปัญหาสถานะ|บุคคลไร้สถานะ/.test(name)) return { key: 'stateless' as const, mapped_by: mapping ? 'finance' as const : name ? 'name' as const : 'hipdata' as const };
  if (/^UC\b|หลักประกันสุขภาพ|บัตรทอง/.test(finance) || hipdata === 'UCS' || /บัตรทอง|หลักประกันสุขภาพ/.test(name)) return { key: 'uc' as const, mapped_by: mapping ? 'finance' as const : name ? 'name' as const : 'hipdata' as const };
  return { key: 'other' as const, mapped_by: mapping ? 'finance' as const : 'fallback' as const };
};

export const aggregateRevenueRows = (sourceRows: RevenueSourceRow[], patientType: 'opd' | 'ipd'): RevenueReportRow[] => {
  const rows: RevenueReportRow[] = CATEGORY_DEFINITIONS.map((definition) => ({ key: definition.key, account_code: patientType === 'opd' ? definition.opd : definition.ipd, label: definition.label, service_count: 0, adjrw: 0, actual_charge: 0, rights: [] }));
  const byKey = new Map(rows.map((row) => [row.key, row]));
  for (const source of sourceRows) {
    const classification = classifyRevenueRight(source);
    const target = byKey.get(classification.key)!;
    const serviceCount = numeric(source.service_count); const adjrw = numeric(source.adjrw); const actualCharge = numeric(source.actual_charge);
    target.service_count += serviceCount; target.adjrw += adjrw; target.actual_charge += actualCharge;
    target.rights.push({ pttype: clean(source.pttype), name: clean(source.pttype_name), hipdata_code: upper(source.hipdata_code), service_count: serviceCount, adjrw, actual_charge: actualCharge, mapped_by: classification.mapped_by });
  }
  return rows;
};

const validDate = (value: string) => /^20\d{2}-\d{2}-\d{2}$/.test(value);
export const getAccountingRevenueReport = async (input: { startDate: string; endDate: string }) => {
  const { startDate, endDate } = input;
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) throw new Error('กรุณาระบุช่วงวันที่ให้ถูกต้อง');
  const days = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000;
  if (days > 366) throw new Error('ช่วงรายงานต้องไม่เกิน 366 วัน');
  const connection = await getUTFConnection();
  try {
    const [, iptFields] = await connection.query('SELECT * FROM ipt LIMIT 0');
    const [, anStatFields] = await connection.query('SELECT * FROM an_stat LIMIT 0');
    const iptColumnNames = new Set((iptFields as Array<{ name?: string }>).map((field) => String(field.name || '').toLowerCase()));
    const anStatColumnNames = new Set((anStatFields as Array<{ name?: string }>).map((field) => String(field.name || '').toLowerCase()));
    const weightExpression = iptColumnNames.has('adjrw') ? 'i.adjrw'
      : anStatColumnNames.has('adjrw') ? 'a.adjrw'
        : iptColumnNames.has('rw') ? 'i.rw'
          : anStatColumnNames.has('rw') ? 'a.rw' : '';
    if (!weightExpression) throw new Error('ไม่พบคอลัมน์ AdjRW หรือ RW ใน ipt/an_stat กรุณาตรวจโครงสร้าง HOSxP');
    const [opdRaw] = await connection.query(
      `SELECT o.pttype AS pttype, COALESCE(pt.name, '') AS pttype_name, COALESCE(pt.hipdata_code, '') AS hipdata_code,
         COUNT(DISTINCT o.vn) AS service_count, 0 AS adjrw, COALESCE(SUM(COALESCE(v.income, 0)), 0) AS actual_charge
       FROM ovst o LEFT JOIN vn_stat v ON v.vn = o.vn LEFT JOIN pttype pt ON pt.pttype = o.pttype
       WHERE o.vstdate BETWEEN ? AND ? GROUP BY o.pttype, pt.name, pt.hipdata_code ORDER BY o.pttype`, [startDate, endDate]);
    const [ipdRaw] = await connection.query(
      `SELECT i.pttype AS pttype, COALESCE(pt.name, '') AS pttype_name, COALESCE(pt.hipdata_code, '') AS hipdata_code,
         COUNT(DISTINCT i.an) AS service_count, COALESCE(SUM(COALESCE(${weightExpression}, 0)), 0) AS adjrw,
         COALESCE(SUM(COALESCE(a.income, 0)), 0) AS actual_charge
       FROM ipt i LEFT JOIN an_stat a ON a.an = i.an LEFT JOIN pttype pt ON pt.pttype = i.pttype
       WHERE i.dchdate BETWEEN ? AND ? GROUP BY i.pttype, pt.name, pt.hipdata_code ORDER BY i.pttype`, [startDate, endDate]);
    const opd = aggregateRevenueRows(opdRaw as RevenueSourceRow[], 'opd');
    const ipd = aggregateRevenueRows(ipdRaw as RevenueSourceRow[], 'ipd');
    const opdSourceCount = (opdRaw as RevenueSourceRow[]).reduce((sum, row) => sum + numeric(row.service_count), 0);
    const ipdSourceCount = (ipdRaw as RevenueSourceRow[]).reduce((sum, row) => sum + numeric(row.service_count), 0);
    const opdGroupedCount = opd.reduce((sum, row) => sum + row.service_count, 0);
    const ipdGroupedCount = ipd.reduce((sum, row) => sum + row.service_count, 0);
    const fallbackRights = Array.from(new Map(
      [...opd, ...ipd].flatMap((row) => row.rights).filter((right) => right.mapped_by === 'fallback')
        .map((right) => [`${right.pttype}|${right.name}|${right.hipdata_code}`, right]),
    ).values());
    const usingAdjrw = weightExpression.endsWith('.adjrw');
    return { startDate, endDate, opd, ipd, audit: { opd_source_count: opdSourceCount, opd_grouped_count: opdGroupedCount, ipd_source_count: ipdSourceCount, ipd_grouped_count: ipdGroupedCount, opd_balanced: opdSourceCount === opdGroupedCount, ipd_balanced: ipdSourceCount === ipdGroupedCount, fallback_rights: fallbackRights }, notes: ['OP Visit นับ VN ไม่ซ้ำตามวันที่รับบริการ (ovst.vstdate)', `น้ำหนักสัมพัทธ์รวมใช้ ${weightExpression} ของผู้ป่วยในที่จำหน่ายในช่วงวันที่เลือก (ipt.dchdate)${usingAdjrw ? '' : ' เนื่องจาก HOSxP แห่งนี้ไม่มีคอลัมน์ adjrw'}`, 'ยอดค่ารักษา HOSxP เป็นยอดอ้างอิงจาก vn_stat/an_stat.income ไม่ใช่รายรับทางบัญชีที่รับเงินจริง'] };
  } finally { connection.release(); }
};
