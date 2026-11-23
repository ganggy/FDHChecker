import type { HospitalConnection } from './hospitalDatabase.js';
import { readHospitalSchema } from './hospitalSchema.js';

const pad2 = (n: number) => String(n).padStart(2, '0');

export const toIsoDate = (raw: unknown): string => {
  if (raw instanceof Date && Number.isFinite(raw.getTime())) {
    return `${raw.getFullYear()}-${pad2(raw.getMonth() + 1)}-${pad2(raw.getDate())}`;
  }
  const s = String(raw ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
};

export const getThaiFiscalYearRange = (rawDate: unknown): { fiscalYear: number; start: string; end: string } | null => {
  const iso = toIsoDate(rawDate);
  if (!iso) return null;
  const [yStr, mStr, dStr] = iso.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  if (!Number.isFinite(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const startYear = month >= 10 ? year : year - 1;
  return {
    fiscalYear: startYear + 1,
    start: `${startYear}-10-01`,
    end: `${startYear + 1}-09-30`,
  };
};

export const FPG_EXCLUDED_DM_CODES = [
  'E10', 'E11', 'E12', 'E13', 'E14',
  ...['E10', 'E11', 'E12', 'E13', 'E14'].flatMap((prefix) =>
    Array.from({ length: 10 }, (_, n) => `${prefix}${n}`)
  ),
];

export const excludedScreeningCode = (fund: string, value: unknown) => {
  const code = String(value || '').toUpperCase().replace(/[.\s]/g, '');
  return fund === 'fpg_screening' ? /^E1[0-4]\d?$/.test(code)
    : fund === 'cholesterol_screening' && /^(I10|I11\d?|I120)$/.test(code);
};
const blocked = (row: Record<string, unknown>, reason: string, review = false) => ({
  ...row, eligibility_blocked: true, eligibility_review: review, eligibility_reason: reason,
});

export async function attachFundEligibility(connection: HospitalConnection, fund: string, rows: Record<string, unknown>[]) {
  if (!rows.length || !['fpg_screening', 'cholesterol_screening', 'anc_ultrasound'].includes(fund)) return rows;
  const query = async (sql: string, values: unknown[]) => (await connection.query(sql, values))[0] as Record<string, unknown>[];
  if (fund !== 'anc_ultrasound') {
    const schemaTables = fund === 'fpg_screening'
      ? ['ovstdiag', 'ovst', 'iptdiag', 'ipt', 'vn_stat', 'an_stat', 'opitemrece', 's_drugitems']
      : ['ovstdiag', 'ovst', 'iptdiag', 'ipt', 'vn_stat', 'an_stat'];
    const has = await readHospitalSchema(connection, schemaTables);
    const sources: string[] = [];
    const hns = [...new Set(rows.map(row => String(row.hn || '')).filter(Boolean))];
    if (!hns.length) return rows.map(row => blocked(row, 'ไม่พบ HN สำหรับตรวจประวัติวินิจฉัย', true));
    const placeholders = hns.map(() => '?').join(',');
    const excludedCodes = fund === 'fpg_screening'
      ? FPG_EXCLUDED_DM_CODES
      : ['I10', 'I11', ...Array.from({ length: 10 }, (_, n) => `I11${n}`), 'I120'];
    const codeFilter = excludedCodes.map(code => `'${code}'`).join(',');
    for (const [diag, visit, key] of [['ovstdiag', 'ovst', 'vn'], ['iptdiag', 'ipt', 'an']]) {
      if (has(diag, key, 'icd10') && has(visit, key, 'hn')) sources.push(`SELECT DISTINCT v.hn, d.icd10 FROM ${diag} d JOIN ${visit} v ON v.${key} = d.${key} WHERE v.hn IN (${placeholders}) AND REPLACE(UPPER(TRIM(d.icd10)), '.', '') IN (${codeFilter})`);
    }
    const completeHistory = sources.length === 2;
    // Summary diagnoses can exist even when the separate diagnosis rows are absent.
    for (const table of ['vn_stat', 'an_stat']) {
      const columns = ['pdx', 'dx0', 'dx1', 'dx2', 'dx3', 'dx4', 'dx5'].filter(column => has(table, column));
      if (has(table, 'hn') && columns.length) sources.push(`SELECT DISTINCT s.hn,
        CONCAT_WS(',', ${columns.map(column => `s.${column}`).join(',')}) AS icd10 FROM ${table} s
        WHERE s.hn IN (${placeholders}) AND (${columns.map(column => `REPLACE(UPPER(TRIM(s.${column})), '.', '') IN (${codeFilter})`).join(' OR ')})`);
    }
    const history = sources.length ? await query(sources.join(' UNION ALL '), sources.flatMap(() => hns)) : [];
    const matches = new Map<string, Set<string>>();
    for (const item of history) for (const code of String(item.icd10 || '').split(',')) if (excludedScreeningCode(fund, code)) {
      const hn = String(item.hn); const codes = matches.get(hn) || new Set<string>();
      codes.add(code); matches.set(hn, codes);
    }

    const fyMap = new Map<string, Array<{ vn: string; vstdate: string }>>();
    if (
      fund === 'fpg_screening' &&
      completeHistory &&
      has('opitemrece', 'vn', 'icode') &&
      has('s_drugitems', 'icode', 'nhso_adp_code') &&
      has('ovst', 'vn', 'hn', 'vstdate')
    ) {
      const candidateHnsSet = new Set<string>();
      let minStart = '';
      let maxEnd = '';
      for (const row of rows) {
        const hn = String(row.hn || '');
        if (!hn || matches.get(hn)?.size) continue;
        const fy = getThaiFiscalYearRange(row.serviceDate ?? row.vstdate);
        if (!fy) continue;
        candidateHnsSet.add(hn);
        if (!minStart || fy.start < minStart) minStart = fy.start;
        if (!maxEnd || fy.end > maxEnd) maxEnd = fy.end;
      }
      const candidateHns = [...candidateHnsSet];
      if (candidateHns.length > 0 && minStart && maxEnd) {
        const fyPlaceholders = candidateHns.map(() => '?').join(',');
        const fyRows = await query(
          `SELECT DISTINCT v.hn, v.vn, DATE_FORMAT(v.vstdate, '%Y-%m-%d') AS vstdate
           FROM opitemrece oo
           JOIN s_drugitems sd ON sd.icode = oo.icode
           JOIN ovst v ON v.vn = oo.vn
           WHERE v.hn IN (${fyPlaceholders})
             AND TRIM(sd.nhso_adp_code) = '12003'
             AND v.vstdate BETWEEN ? AND ?
           ORDER BY v.vstdate ASC, v.vn ASC`,
          [...candidateHns, minStart, maxEnd],
        );
        for (const r of fyRows) {
          const rDate = toIsoDate(r.vstdate);
          const fy = getThaiFiscalYearRange(rDate);
          const rHn = String(r.hn || '');
          const rVn = String(r.vn || '');
          if (!fy || !rHn || !rVn) continue;
          const key = `${rHn}|${fy.fiscalYear}`;
          const list = fyMap.get(key) || [];
          list.push({ vn: rVn, vstdate: rDate });
          fyMap.set(key, list);
        }
      }
    }

    return rows.map(row => {
      const codes = matches.get(String(row.hn));
      if (codes?.size) return blocked(row, `ไม่เข้าเกณฑ์คัดกรอง: พบประวัติวินิจฉัย ${[...codes].sort().join(', ')} ในประวัติผู้ป่วย`);
      if (!completeHistory) return blocked(row, 'ตรวจประวัติวินิจฉัย OPD/IPD ได้ไม่ครบ กรุณาตรวจสอบก่อนเบิก', true);
      if (fund === 'fpg_screening') {
        const fy = getThaiFiscalYearRange(row.serviceDate ?? row.vstdate);
        if (fy) {
          const rowVn = String(row.vn || '');
          const rowDate = toIsoDate(row.serviceDate ?? row.vstdate);
          const list = fyMap.get(`${String(row.hn)}|${fy.fiscalYear}`) || [];
          const prior = list.find(
            (rec) => rec.vn !== rowVn && (rec.vstdate < rowDate || (rec.vstdate === rowDate && (!rowVn || rec.vn < rowVn))),
          );
          if (prior) {
            return blocked(
              row,
              `ไม่เข้าเกณฑ์คัดกรอง: เคยได้รับบริการคัดกรองเบาหวาน (ADP 12003) แล้วในปีงบประมาณนี้ (VN ${prior.vn} วันที่ ${prior.vstdate}) — เบิกได้ 1 ครั้ง/ปีงบประมาณ`,
            );
          }
        }
      }
      return { ...row, eligibility_blocked: false };
    });
  }
  const has = await readHospitalSchema(connection, ['person_anc_service', 'opitemrece', 's_drugitems', 'ovst']);
  if (!has('person_anc_service', 'vn', 'person_anc_id') || !has('opitemrece', 'vn', 'icode', 'qty') || !has('s_drugitems', 'icode', 'nhso_adp_code')) {
    return rows.map(row => blocked(row, 'ไม่สามารถตรวจประวัติ Ultrasound ต่อครรภ์ได้ กรุณาตรวจสอบก่อนเบิก', true));
  }
  const vns = [...new Set(rows.map(row => String(row.vn || '')).filter(Boolean))];
  const links = vns.length ? await query(`SELECT DISTINCT vn, person_anc_id FROM person_anc_service WHERE vn IN (${vns.map(() => '?').join(',')})`, vns) : [];
  const pregnancyIds = [...new Set(links.map(row => String(row.person_anc_id || '')).filter(Boolean))];
  const services = pregnancyIds.length ? await query(`SELECT p.person_anc_id, o.vn, SUM(o.qty) AS qty
    FROM (SELECT DISTINCT person_anc_id, vn FROM person_anc_service) p
    JOIN opitemrece o ON o.vn = p.vn JOIN s_drugitems d ON d.icode = o.icode
    WHERE p.person_anc_id IN (${pregnancyIds.map(() => '?').join(',')}) AND d.nhso_adp_code = '30010'
    GROUP BY p.person_anc_id, o.vn`, pregnancyIds) : [];
  return rows.map(row => {
    const ids = [...new Set(links.filter(link => String(link.vn) === String(row.vn)).map(link => String(link.person_anc_id || '')).filter(Boolean))];
    if (ids.length !== 1) return blocked(row, 'ไม่พบรหัสครรภ์ที่ชัดเจน กรุณาเชื่อมโยงบริการ ANC ก่อนตรวจสิทธิ์', true);
    const visits = services.filter(service => String(service.person_anc_id) === ids[0]);
    if (visits.length > 1 || visits.some(service => Number(service.qty) > 1)) {
      return blocked(row, 'พบ ADP 30010 มากกว่า 1 ครั้งในครรภ์เดียวกัน ต้องตรวจรายการซ้ำก่อนเบิก (ไม่ใช่หลักฐานว่าจ่ายแล้ว)', true);
    }
    return { ...row, eligibility_blocked: false, pregnancy_id: ids[0] };
  });
}
