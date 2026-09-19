import { getUTFConnection, getAppSetting } from './db.js';
import { RECEIVABLE_RIGHT_MAPPINGS, type ReceivableRightMapping } from './receivableMapping.js';

export interface DebtorMetadata {
  debtor_code: string;
  debtor_name: string;
  recognition: string;
  control_register: 'รายสิทธิ' | 'รายตัว';
}

// Standard debtor metadata matching Ministry of Public Health / HOSxP definitions
export const DEBTOR_METADATA: Record<string, { name: string; recognition: string; register: 'รายสิทธิ' | 'รายตัว' }> = {
  '1102050101.201': { name: 'ลูกหนี้ค่ารักษา UC-OP ใน CUP', recognition: 'ตัดด้วยเงินกองทุน', register: 'รายสิทธิ' },
  '1102050101.202': { name: 'ลูกหนี้ค่ารักษา UC-IP ใน CUP', recognition: 'ตัดด้วยเงินกองทุน', register: 'รายสิทธิ' },
  '1102050101.203': { name: 'ลูกหนี้ค่ารักษา UC-OP นอก CUP ในจังหวัด', recognition: '', register: 'รายตัว' },
  '1102050101.204': { name: 'ลูกหนี้ค่ารักษา UC-OP นอก CUP ต่างจังหวัด', recognition: '', register: 'รายตัว' },
  '1102050101.209': { name: 'ลูกหนี้ค่ารักษา UC-PP Expressed demand', recognition: '', register: 'รายสิทธิ' },
  '1102050101.216': { name: 'ลูกหนี้ค่ารักษา UC-OP บริการเฉพาะ', recognition: '', register: 'รายตัว' },
  '1102050101.217': { name: 'ลูกหนี้ค่ารักษา UC-IP บริการเฉพาะ', recognition: '', register: 'รายตัว' },
  '1102050101.222': { name: 'ลูกหนี้ค่ารักษา OP Refer', recognition: '', register: 'รายตัว' },
  '1102050101.301': { name: 'ลูกหนี้ค่ารักษา-ประกันสังคม OP-เครือข่าย', recognition: '', register: 'รายสิทธิ' },
  '1102050101.302': { name: 'ลูกหนี้ค่ารักษา-ประกันสังคม IP-เครือข่าย', recognition: '', register: 'รายสิทธิ' },
  '1102050101.303': { name: 'ลูกหนี้ค่ารักษา-ประกันสังคม OP นอกเครือข่าย', recognition: '', register: 'รายตัว' },
  '1102050101.304': { name: 'ลูกหนี้ค่ารักษา-ประกันสังคม IP นอกเครือข่าย', recognition: '', register: 'รายตัว' },
  '1102050101.307': { name: 'ลูกหนี้ค่ารักษาประกันสังคม กองทุนทดแทน', recognition: 'เฉพาะทันตกรรม', register: 'รายสิทธิ' },
  '1102050101.308': { name: 'ลูกหนี้ค่ารักษาประกันสังคม 72 ชั่วโมงแรก', recognition: '', register: 'รายตัว' },
  '1102050101.401': { name: 'ลูกหนี้ค่ารักษา-เบิกจ่ายตรงกรมบัญชีกลาง OP', recognition: '', register: 'รายตัว' },
  '1102050101.402': { name: 'ลูกหนี้ค่ารักษา-เบิกจ่ายตรงกรมบัญชีกลาง IP', recognition: '', register: 'รายตัว' },
  '1102050101.501': { name: 'ลูกหนี้ค่ารักษาแรงงานต่างด้าว OP', recognition: '', register: 'รายตัว' },
  '1102050101.502': { name: 'ลูกหนี้ค่ารักษาแรงงานต่างด้าว IP', recognition: '', register: 'รายตัว' },
  '1102050102.106': { name: 'ลูกหนี้ค่ารักษา-ชำระเงิน OP', recognition: '', register: 'รายตัว' },
  '1102050102.107': { name: 'ลูกหนี้ค่ารักษา-ชำระเงิน IP', recognition: '', register: 'รายตัว' },
  '1102050102.108': { name: 'ลูกหนี้ค่ารักษาใช้สิทธิเบิกหน่วยงานต้นสังกัด OP', recognition: '', register: 'รายตัว' },
  '1102050102.109': { name: 'ลูกหนี้ค่ารักษาใช้สิทธิเบิกหน่วยงานต้นสังกัด IP', recognition: '', register: 'รายตัว' },
  '1102050102.110': { name: 'ลูกหนี้ค่ารักษา เบิกจ่ายตรงหน่วยงานอื่น OP', recognition: '', register: 'รายตัว' },
  '1102050102.602': { name: 'ลูกหนี้ค่ารักษา-พรบ.รถ OP', recognition: '', register: 'รายตัว' },
  '1102050102.603': { name: 'ลูกหนี้ค่ารักษา-พรบ.รถ IP', recognition: '', register: 'รายตัว' },
  '1102050102.801': { name: 'ลูกหนี้ค่ารักษา-เบิกจ่ายตรง อปท.OP', recognition: '', register: 'รายตัว' },
  '1102050102.802': { name: 'ลูกหนี้ค่ารักษา-เบิกจ่ายตรง อปท.IP', recognition: '', register: 'รายตัว' },
  '1102050102.803': { name: 'ลูกหนี้ค่ารักษา-เบิกจ่ายตรง อปท.พิเศษ OP', recognition: '', register: 'รายตัว' },
  '1102050102.804': { name: 'ลูกหนี้ค่ารักษา-เบิกจ่ายตรง อปท.พิเศษ IP', recognition: '', register: 'รายตัว' },
};

const mappingByPttype = new Map<string, ReceivableRightMapping>(
  RECEIVABLE_RIGHT_MAPPINGS.map((m) => [String(m.hosxp_code).trim(), m])
);

export const resolveDebtorForPttype = (pttype: string, isIpd = false) => {
  const code = String(pttype || '').trim();
  const mapping = mappingByPttype.get(code);
  let debtorCode = isIpd ? (mapping?.debtor_ipd || '') : (mapping?.debtor_opd || '');

  // Default fallback if not in mapping
  if (!debtorCode) {
    debtorCode = isIpd ? '1102050102.107' : '1102050102.106';
  }

  const meta = DEBTOR_METADATA[debtorCode];
  return {
    debtorCode,
    debtorName: meta?.name || 'ลูกหนี้ค่ารักษาพยาบาล',
    recognition: meta?.recognition || '',
    controlRegister: meta?.register || 'รายสิทธิ',
  };
};

// Hospital Profile
export const getHospitalInfo = async () => {
  const connection = await getUTFConnection();
  try {
    let rows: unknown[] = [];
    try {
      const [res] = await connection.query(`SELECT * FROM opdconfig LIMIT 1`);
      rows = Array.isArray(res) ? res : [];
    } catch {
      rows = [];
    }
    const row = rows.length > 0 ? (rows[0] as Record<string, unknown>) : null;
    const siteSettings = await getAppSetting<Record<string, unknown>>('site_settings').catch(() => null);
    const hospitalCode = String(siteSettings?.hospital_code || row?.hospitalcode || row?.hospital_code || '').trim();
    const hospitalName = String(siteSettings?.hospital_name || row?.hospitalname || row?.hospital_name || '').trim() || 'โรงพยาบาล';
    const chwpart = String(row?.chwpart || '').trim();
    const amppart = String(row?.amppart || '').trim();
    return {
      hospitalCode,
      hospitalName,
      chwpart,
      amppart,
    };
  } finally {
    connection.release();
  }
};

const buildInCupSqlCondition = (hosp: { hospitalCode: string; chwpart: string; amppart: string }, alias = 'o') => {
  const hospCol = `${alias}.hospmain`;
  const cleanCode = hosp.hospitalCode.replace(/\D/g, '');
  const cleanChw = hosp.chwpart.replace(/\D/g, '');
  const cleanAmp = hosp.amppart.replace(/\D/g, '');

  if (cleanChw && cleanAmp && cleanCode) {
    return `((p.chwpart = '${cleanChw}' AND p.amppart = '${cleanAmp}') OR ${hospCol} = '${cleanCode}')`;
  }
  if (cleanCode) {
    return `(${hospCol} = '${cleanCode}')`;
  }
  return `(${hospCol} = (SELECT hospitalcode FROM opdconfig LIMIT 1))`;
};

// ==========================================
// รายงานที่ 1: สรุปรวมสิทธิการรักษา ผู้ป่วยนอก
// ==========================================
export interface DebtorOpdSummaryItem {
  no: number;
  debtorCode: string;
  debtorName: string;
  recognition: string;
  controlRegister: string;
  patientCount: number;
  visitCount: number;
  newCount: number;
  oldCount: number;
  inCupCount: number;
  outCupCount: number;
  totalAmount: number;
  paidAmount: number;
  remainAmount: number;
}

export const getDebtorOpdSummary = async (startDate: string, endDate: string) => {
  const hosp = await getHospitalInfo();
  const inCupCondition = buildInCupSqlCondition(hosp, 'o');
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT
         o.pttype,
         COUNT(DISTINCT o.hn) AS patient_count,
         COUNT(DISTINCT o.vn) AS visit_count,
         SUM(CASE WHEN o.ovstist = '01' OR o.vstdate = p.firstday THEN 1 ELSE 0 END) AS new_count,
         SUM(CASE WHEN ${inCupCondition} THEN 1 ELSE 0 END) AS in_cup_count,
         SUM(COALESCE(v.income, 0)) AS total_income,
         SUM(COALESCE(v.rcpt_money, 0)) AS paid_money
       FROM ovst o
       JOIN vn_stat v ON v.vn = o.vn
       LEFT JOIN patient p ON p.hn = o.hn
       WHERE o.vstdate BETWEEN ? AND ?
         AND COALESCE(v.income, 0) > 0
       GROUP BY o.pttype
       ORDER BY o.pttype`,
      [startDate, endDate]
    );

    const grouped = new Map<string, DebtorOpdSummaryItem>();

    for (const r of (Array.isArray(rows) ? rows : []) as Record<string, unknown>[]) {
      const pttype = String(r.pttype || '').trim();
      const debtor = resolveDebtorForPttype(pttype, false);

      const existing = grouped.get(debtor.debtorCode) || {
        no: 0,
        debtorCode: debtor.debtorCode,
        debtorName: debtor.debtorName,
        recognition: debtor.recognition,
        controlRegister: debtor.controlRegister,
        patientCount: 0,
        visitCount: 0,
        newCount: 0,
        oldCount: 0,
        inCupCount: 0,
        outCupCount: 0,
        totalAmount: 0,
        paidAmount: 0,
        remainAmount: 0,
      };

      const visitCount = Number(r.visit_count || 0);
      const patientCount = Number(r.patient_count || 0);
      const newCount = Number(r.new_count || 0);
      const inCup = Number(r.in_cup_count || 0);
      const totalIncome = Number(r.total_income || 0);
      const paidMoney = Number(r.paid_money || 0);

      existing.visitCount += visitCount;
      existing.patientCount += patientCount;
      existing.newCount += newCount;
      existing.inCupCount += inCup;
      existing.totalAmount += totalIncome;
      existing.paidAmount += paidMoney;

      grouped.set(debtor.debtorCode, existing);
    }

    // Sort by debtorCode ascending
    const sorted = Array.from(grouped.values()).sort((a, b) => a.debtorCode.localeCompare(b.debtorCode));

    // Assign sequential numbering and compute old & out-cup & remain
    sorted.forEach((item, index) => {
      item.no = index + 1;
      item.oldCount = Math.max(0, item.visitCount - item.newCount);
      item.outCupCount = Math.max(0, item.visitCount - item.inCupCount);
      item.remainAmount = Math.max(0, item.totalAmount - item.paidAmount);
    });

    return sorted;
  } finally {
    connection.release();
  }
};

// ==========================================
// รายงานที่ 2: แยกตามสิทธิการรักษา ผู้ป่วยนอก
// ==========================================
export interface PttypeOpdSummaryItem {
  no: number;
  pttype: string;
  nhsoCode: string;
  pcode: string;
  pttypeName: string;
  debtorCode: string;
  debtorName: string;
  patientCount: number;
  visitCount: number;
  newCount: number;
  oldCount: number;
  inCupCount: number;
  outCupCount: number;
  totalAmount: number;
  paidAmount: number;
  remainAmount: number;
}

export const getPttypeOpdSummary = async (startDate: string, endDate: string) => {
  const hosp = await getHospitalInfo();
  const inCupCondition = buildInCupSqlCondition(hosp, 'o');
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT
         o.pttype,
         COALESCE(pt.nhso_code, pt.oldcode, '') AS nhso_code,
         COALESCE(pt.pcode, '') AS pcode,
         COALESCE(pt.name, '') AS pttype_name,
         COUNT(DISTINCT o.hn) AS patient_count,
         COUNT(DISTINCT o.vn) AS visit_count,
         SUM(CASE WHEN o.ovstist = '01' OR o.vstdate = p.firstday THEN 1 ELSE 0 END) AS new_count,
         SUM(CASE WHEN ${inCupCondition} THEN 1 ELSE 0 END) AS in_cup_count,
         SUM(COALESCE(v.income, 0)) AS total_income,
         SUM(COALESCE(v.rcpt_money, 0)) AS paid_money
       FROM ovst o
       JOIN vn_stat v ON v.vn = o.vn
       LEFT JOIN patient p ON p.hn = o.hn
       LEFT JOIN pttype pt ON pt.pttype = o.pttype
       WHERE o.vstdate BETWEEN ? AND ?
         AND COALESCE(v.income, 0) > 0
       GROUP BY o.pttype, pt.nhso_code, pt.oldcode, pt.pcode, pt.name
       ORDER BY o.pttype`,
      [startDate, endDate]
    );

    const results: PttypeOpdSummaryItem[] = [];
    let idx = 1;

    for (const r of (Array.isArray(rows) ? rows : []) as Record<string, unknown>[]) {
      const pttype = String(r.pttype || '').trim();
      const debtor = resolveDebtorForPttype(pttype, false);
      const visitCount = Number(r.visit_count || 0);
      const inCup = Number(r.in_cup_count || 0);
      const outCup = Math.max(0, visitCount - inCup);
      const totalAmount = Number(r.total_income || 0);
      const paidAmount = Number(r.paid_money || 0);
      const remainAmount = Math.max(0, totalAmount - paidAmount);

      results.push({
        no: idx++,
        pttype,
        nhsoCode: String(r.nhso_code || ''),
        pcode: String(r.pcode || ''),
        pttypeName: String(r.pttype_name || ''),
        debtorCode: debtor.debtorCode,
        debtorName: debtor.debtorName,
        patientCount: Number(r.patient_count || 0),
        visitCount,
        newCount: Number(r.new_count || 0),
        oldCount: Math.max(0, visitCount - Number(r.new_count || 0)),
        inCupCount: inCup,
        outCupCount: outCup,
        totalAmount,
        paidAmount,
        remainAmount,
      });
    }

    return results;
  } finally {
    connection.release();
  }
};

// ==========================================
// รายงานที่ 3: แยกตามสิทธิการรักษา ผู้ป่วยใน
// ==========================================
export interface PttypeIpdSummaryItem {
  no: number;
  pttype: string;
  nhsoCode: string;
  pcode: string;
  pttypeName: string;
  debtorCode: string;
  debtorName: string;
  patientCount: number;
  visitCount: number;
  newCount: number;
  oldCount: number;
  inCupCount: number;
  outCupCount: number;
  losDays: number;
  totalAmount: number;
  paidAmount: number;
  remainAmount: number;
}

export const getPttypeIpdSummary = async (startDate: string, endDate: string) => {
  const hosp = await getHospitalInfo();
  const inCupCondition = buildInCupSqlCondition(hosp, 'ov');
  const connection = await getUTFConnection();
  try {
    const [rows] = await connection.query(
      `SELECT
         i.pttype,
         COALESCE(pt.nhso_code, pt.oldcode, '') AS nhso_code,
         COALESCE(pt.pcode, '') AS pcode,
         COALESCE(pt.name, '') AS pttype_name,
         COUNT(DISTINCT i.hn) AS patient_count,
         COUNT(DISTINCT i.an) AS visit_count,
         SUM(CASE WHEN i.dchdate = p.firstday OR i.regdate = p.firstday THEN 1 ELSE 0 END) AS new_count,
         SUM(CASE WHEN ${inCupCondition} THEN 1 ELSE 0 END) AS in_cup_count,
         SUM(GREATEST(DATEDIFF(COALESCE(i.dchdate, CURDATE()), i.regdate), 1)) AS los_days,
         SUM(COALESCE(a.income, 0)) AS total_income,
         SUM(COALESCE(a.rcpt_money, 0)) AS paid_money
       FROM ipt i
       JOIN an_stat a ON a.an = i.an
       LEFT JOIN ovst ov ON ov.vn = i.vn
       LEFT JOIN patient p ON p.hn = i.hn
       LEFT JOIN pttype pt ON pt.pttype = i.pttype
       WHERE COALESCE(i.dchdate, i.regdate) BETWEEN ? AND ?
         AND COALESCE(a.income, 0) > 0
       GROUP BY i.pttype, pt.nhso_code, pt.oldcode, pt.pcode, pt.name
       ORDER BY i.pttype`,
      [startDate, endDate]
    );

    const results: PttypeIpdSummaryItem[] = [];
    let idx = 1;

    for (const r of (Array.isArray(rows) ? rows : []) as Record<string, unknown>[]) {
      const pttype = String(r.pttype || '').trim();
      const debtor = resolveDebtorForPttype(pttype, true);
      const visitCount = Number(r.visit_count || 0);
      const patientCount = Number(r.patient_count || 0);
      const newCount = Number(r.new_count || 0);
      const inCup = Number(r.in_cup_count || 0);
      const losDays = Number(r.los_days || visitCount);
      const totalAmount = Number(r.total_income || 0);
      const paidAmount = Number(r.paid_money || 0);

      results.push({
        no: idx++,
        pttype,
        nhsoCode: String(r.nhso_code || pttype),
        pcode: String(r.pcode || ''),
        pttypeName: String(r.pttype_name || pttype),
        debtorCode: debtor.debtorCode,
        debtorName: debtor.debtorName,
        patientCount,
        visitCount,
        newCount,
        oldCount: Math.max(0, visitCount - newCount),
        inCupCount: inCup,
        outCupCount: Math.max(0, visitCount - inCup),
        losDays,
        totalAmount,
        paidAmount,
        remainAmount: Math.max(0, totalAmount - paidAmount),
      });
    }

    return results;
  } finally {
    connection.release();
  }
};

// ==============================================================
// รายงานที่ 4: ค่ารักษาพยาบาลลูกหนี้ผู้ป่วยนอก แบบแจกแจงรายละเอียด
// ==============================================================
export interface DetailedOpdItem {
  no: number;
  serviceDate: string;
  pttype: string;
  cid: string;
  receiptNo: string;
  patientName: string;
  hn: string;
  vn: string;
  sexAge: string;
  diagnosis: string;
  procedureCode: string;
  // 12 Standard Income Categories
  incProsthesis: number;     // inc02: ค่าอวัยวะเทียมและอุปกรณ์บำบัดโรค
  incMedicine: number;       // inc03 + inc05: ค่ายาและเวชภัณฑ์
  incLab: number;            // inc07: ค่าตรวจวินิจฉัยทางเทคนิคการแพทย์
  incXray: number;           // inc08: ค่าตรวจวินิจฉัยทางรังสีวิทยา
  incSpecialDiag: number;    // inc09: ค่าตรวจวินิจฉัยโดยวิธีพิเศษอื่น
  incEquipment: number;      // inc10: ค่าอุปกรณ์ของใช้และเครื่องมือทางการแพทย์
  incOperation: number;      // inc11: ค่าทำหัตถการและวิสัญญี
  incNursing: number;        // inc12: ค่าบริการทางการพยาบาล
  incDental: number;         // inc13: ค่าบริการทางทันตกรรม
  incPhysical: number;       // inc14: ค่าบริการทางกายภาพ
  incTraditional: number;    // inc15: ค่าบริการบำบัดของผู้ประกอบโรคศิลปะอื่น
  incOther: number;          // inc04 + inc06 + inc16 + inc17: ค่าบริการอื่นๆ
  totalAmount: number;       // ยอดเงิน
  paidAmount: number;        // จ่ายแล้ว
  remainAmount: number;      // คงเหลือ
}

export const getDetailedOpd = async (
  startDate: string,
  endDate: string,
  pttypeFilter?: string,
  debtorFilter?: string
) => {
  const connection = await getUTFConnection();
  try {
    const params: unknown[] = [startDate, endDate];
    let whereExtra = '';

    if (pttypeFilter && pttypeFilter !== 'ALL') {
      whereExtra += ' AND o.pttype = ?';
      params.push(pttypeFilter);
    }

    const [rows] = await connection.query(
      `SELECT
         DATE_FORMAT(o.vstdate, '%d/%m/%Y') AS service_date,
         o.pttype,
         pt.cid,
         COALESCE(v.rcp_no, rp.rcpno, '') AS receipt_no,
         CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
         o.hn,
         o.vn,
         CONCAT(CASE WHEN pt.sex = '1' THEN 'ชาย' WHEN pt.sex = '2' THEN 'หญิง' ELSE '' END, ' ', COALESCE(v.age_y, '')) AS sex_age,
         COALESCE(v.pdx, '') AS pdx,
         COALESCE(v.op0, '') AS oprt,
         COALESCE(v.inc02, 0) AS inc02,
         COALESCE(v.inc03, 0) + COALESCE(v.inc05, 0) AS inc_med,
         COALESCE(v.inc07, 0) AS inc07,
         COALESCE(v.inc08, 0) AS inc08,
         COALESCE(v.inc09, 0) AS inc09,
         COALESCE(v.inc10, 0) AS inc10,
         COALESCE(v.inc11, 0) AS inc11,
         COALESCE(v.inc12, 0) AS inc12,
         COALESCE(v.inc13, 0) AS inc13,
         COALESCE(v.inc14, 0) AS inc14,
         COALESCE(v.inc15, 0) AS inc15,
         COALESCE(v.inc04, 0) + COALESCE(v.inc06, 0) + COALESCE(v.inc16, 0) + COALESCE(v.inc17, 0) AS inc_other,
         COALESCE(v.income, 0) AS total_income,
         COALESCE(v.rcpt_money, 0) AS paid_money
       FROM ovst o
       JOIN vn_stat v ON v.vn = o.vn
       LEFT JOIN patient pt ON pt.hn = o.hn
       LEFT JOIN (
         SELECT vn, MAX(rcpno) AS rcpno
         FROM rcpt_print
         GROUP BY vn
       ) rp ON rp.vn = o.vn
       WHERE o.vstdate BETWEEN ? AND ?
         AND COALESCE(v.income, 0) > 0
         ${whereExtra}
       ORDER BY o.vstdate, o.vn`,
      params
    );

    const items: DetailedOpdItem[] = [];
    let idx = 1;

    for (const r of (Array.isArray(rows) ? rows : []) as Record<string, unknown>[]) {
      const pttype = String(r.pttype || '').trim();
      const debtor = resolveDebtorForPttype(pttype, false);

      if (debtorFilter && debtorFilter !== 'ALL' && debtor.debtorCode !== debtorFilter) {
        continue;
      }

      const totalAmount = Number(r.total_income || 0);
      const paidAmount = Number(r.paid_money || 0);

      items.push({
        no: idx++,
        serviceDate: String(r.service_date || ''),
        pttype,
        cid: String(r.cid || ''),
        receiptNo: String(r.receipt_no || ''),
        patientName: String(r.patient_name || ''),
        hn: String(r.hn || ''),
        vn: String(r.vn || ''),
        sexAge: String(r.sex_age || '').trim(),
        diagnosis: String(r.pdx || ''),
        procedureCode: String(r.oprt || '0'),
        incProsthesis: Number(r.inc02 || 0),
        incMedicine: Number(r.inc_med || 0),
        incLab: Number(r.inc07 || 0),
        incXray: Number(r.inc08 || 0),
        incSpecialDiag: Number(r.inc09 || 0),
        incEquipment: Number(r.inc10 || 0),
        incOperation: Number(r.inc11 || 0),
        incNursing: Number(r.inc12 || 0),
        incDental: Number(r.inc13 || 0),
        incPhysical: Number(r.inc14 || 0),
        incTraditional: Number(r.inc15 || 0),
        incOther: Number(r.inc_other || 0),
        totalAmount,
        paidAmount,
        remainAmount: Math.max(0, totalAmount - paidAmount),
      });
    }

    return items;
  } finally {
    connection.release();
  }
};

// ==============================================================
// รายงานที่ 5: ค่ารักษาพยาบาลลูกหนี้ผู้ป่วยใน แบบแจกแจงรายละเอียด
// ==============================================================
export interface DetailedIpdItem {
  no: number;
  admitDate: string;
  dchDate: string;
  pttype: string;
  cid: string;
  receiptNo: string;
  patientName: string;
  hn: string;
  an: string;
  sexAge: string;
  diagnosis: string;
  procedureCode: string;
  // 13 Standard Income Categories (includes Room & Board inc01)
  incRoomBoard: number;      // inc01: ค่าห้อง/ค่าอาหาร
  incProsthesis: number;     // inc02: ค่าอวัยวะเทียมและอุปกรณ์บำบัดโรค
  incMedicine: number;       // inc03 + inc05: ค่ายาและเวชภัณฑ์
  incLab: number;            // inc07: ค่าตรวจวินิจฉัยทางเทคนิคการแพทย์
  incXray: number;           // inc08: ค่าตรวจวินิจฉัยทางรังสีวิทยา
  incSpecialDiag: number;    // inc09: ค่าตรวจวินิจฉัยโดยวิธีพิเศษอื่น
  incEquipment: number;      // inc10: ค่าอุปกรณ์ของใช้และเครื่องมือทางการแพทย์
  incOperation: number;      // inc11: ค่าทำหัตถการและวิสัญญี
  incNursing: number;        // inc12: ค่าบริการทางการพยาบาล
  incDental: number;         // inc13: ค่าบริการทางทันตกรรม
  incPhysical: number;       // inc14: ค่าบริการทางกายภาพ
  incTraditional: number;    // inc15: ค่าบริการบำบัดของผู้ประกอบโรคศิลปะอื่น
  incOther: number;          // inc04 + inc06 + inc16 + inc17: ค่าบริการอื่นๆ
  totalAmount: number;       // ยอดเงิน
  paidAmount: number;        // จ่ายแล้ว
  remainAmount: number;      // คงเหลือ
}

export const getDetailedIpd = async (
  startDate: string,
  endDate: string,
  pttypeFilter?: string,
  debtorFilter?: string
) => {
  const connection = await getUTFConnection();
  try {
    const params: unknown[] = [startDate, endDate];
    let whereExtra = '';

    if (pttypeFilter && pttypeFilter !== 'ALL') {
      whereExtra += ' AND i.pttype = ?';
      params.push(pttypeFilter);
    }

    const [rows] = await connection.query(
      `SELECT
         DATE_FORMAT(i.regdate, '%d/%m/%Y') AS admit_date,
         DATE_FORMAT(COALESCE(i.dchdate, i.regdate), '%d/%m/%Y') AS dch_date,
         i.pttype,
         pt.cid,
         TRIM(BOTH '"' FROM COALESCE(a.rcpno_list, '')) AS receipt_no,
         CONCAT(COALESCE(pt.pname, ''), COALESCE(pt.fname, ''), ' ', COALESCE(pt.lname, '')) AS patient_name,
         i.hn,
         i.an,
         CONCAT(CASE WHEN pt.sex = '1' THEN 'ชาย' WHEN pt.sex = '2' THEN 'หญิง' ELSE '' END, ' ', COALESCE(a.age_y, '')) AS sex_age,
         COALESCE(a.pdx, '') AS pdx,
         COALESCE(a.op0, '') AS oprt,
         COALESCE(a.inc01, 0) AS inc01,
         COALESCE(a.inc02, 0) AS inc02,
         COALESCE(a.inc03, 0) + COALESCE(a.inc05, 0) AS inc_med,
         COALESCE(a.inc07, 0) AS inc07,
         COALESCE(a.inc08, 0) AS inc08,
         COALESCE(a.inc09, 0) AS inc09,
         COALESCE(a.inc10, 0) AS inc10,
         COALESCE(a.inc11, 0) AS inc11,
         COALESCE(a.inc12, 0) AS inc12,
         COALESCE(a.inc13, 0) AS inc13,
         COALESCE(a.inc14, 0) AS inc14,
         COALESCE(a.inc15, 0) AS inc15,
         COALESCE(a.inc04, 0) + COALESCE(a.inc06, 0) + COALESCE(a.inc16, 0) + COALESCE(a.inc17, 0) AS inc_other,
         COALESCE(a.income, 0) AS total_income,
         COALESCE(a.rcpt_money, 0) AS paid_money
       FROM ipt i
       JOIN an_stat a ON a.an = i.an
       LEFT JOIN patient pt ON pt.hn = i.hn
       WHERE COALESCE(i.dchdate, i.regdate) BETWEEN ? AND ?
         AND COALESCE(a.income, 0) > 0
         ${whereExtra}
       ORDER BY COALESCE(i.dchdate, i.regdate), i.an`,
      params
    );

    const items: DetailedIpdItem[] = [];
    let idx = 1;

    for (const r of (Array.isArray(rows) ? rows : []) as Record<string, unknown>[]) {
      const pttype = String(r.pttype || '').trim();
      const debtor = resolveDebtorForPttype(pttype, true);

      if (debtorFilter && debtorFilter !== 'ALL' && debtor.debtorCode !== debtorFilter) {
        continue;
      }

      const totalAmount = Number(r.total_income || 0);
      const paidAmount = Number(r.paid_money || 0);

      items.push({
        no: idx++,
        admitDate: String(r.admit_date || ''),
        dchDate: String(r.dch_date || ''),
        pttype,
        cid: String(r.cid || ''),
        receiptNo: String(r.receipt_no || ''),
        patientName: String(r.patient_name || ''),
        hn: String(r.hn || ''),
        an: String(r.an || ''),
        sexAge: String(r.sex_age || '').trim(),
        diagnosis: String(r.pdx || ''),
        procedureCode: String(r.oprt || '0'),
        incRoomBoard: Number(r.inc01 || 0),
        incProsthesis: Number(r.inc02 || 0),
        incMedicine: Number(r.inc_med || 0),
        incLab: Number(r.inc07 || 0),
        incXray: Number(r.inc08 || 0),
        incSpecialDiag: Number(r.inc09 || 0),
        incEquipment: Number(r.inc10 || 0),
        incOperation: Number(r.inc11 || 0),
        incNursing: Number(r.inc12 || 0),
        incDental: Number(r.inc13 || 0),
        incPhysical: Number(r.inc14 || 0),
        incTraditional: Number(r.inc15 || 0),
        incOther: Number(r.inc_other || 0),
        totalAmount,
        paidAmount,
        remainAmount: Math.max(0, totalAmount - paidAmount),
      });
    }

    return items;
  } finally {
    connection.release();
  }
};
