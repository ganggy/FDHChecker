import path from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';
import { getUTFConnection } from './db.js';

export type SsjRightCategory =
  | 'UC'
  | 'SSS'
  | 'OFC'
  | 'LGO'
  | 'STP'
  | 'FWF'
  | 'ชำระเงินเอง'
  | 'สิทธิอื่นๆ';

export const SSJ_RIGHTS_ORDER: SsjRightCategory[] = [
  'UC',
  'SSS',
  'OFC',
  'LGO',
  'STP',
  'FWF',
  'ชำระเงินเอง',
  'สิทธิอื่นๆ',
];

export const SSJ_RIGHT_CODE_MAP: Record<SsjRightCategory, string> = {
  UC: '01',
  SSS: '02',
  OFC: '03',
  LGO: '04',
  STP: '05',
  FWF: '06',
  ชำระเงินเอง: '07',
  สิทธิอื่นๆ: '08',
};

export interface SsjRawServRow {
  code_serv: string;
  serv_type: 'OPD' | 'IPD';
  item: string;
  rights: string;
  rights_code: string;
  amount: number;
}

export interface SsjOpdSourceRow {
  vn: string;
  hn: string;
  pttype?: string | null;
  pttype_name?: string | null;
  hipdata_code?: string | null;
  paidst?: string | null;
}

export interface SsjIpdSourceRow {
  an: string;
  hn: string;
  pttype?: string | null;
  pttype_name?: string | null;
  hipdata_code?: string | null;
  paidst?: string | null;
  adjrw?: number | string | null;
  los?: number | string | null;
}

export interface SsjReportAudit {
  opd_total_visits: number;
  opd_distinct_hn: number;
  ipd_total_admits: number;
  ipd_distinct_hn: number;
  ipd_sum_adjrw: number;
  ipd_sum_los: number;
  pttype_breakdown: Array<{
    pttype: string;
    name: string;
    hipdata_code: string;
    assigned_right: SsjRightCategory;
    opd_visits: number;
    ipd_admits: number;
  }>;
}

export interface SsjRawServReportResult {
  startDate: string;
  endDate: string;
  rows: SsjRawServRow[];
  audit: SsjReportAudit;
}

const clean = (val: unknown): string => String(val || '').normalize('NFKC').trim();
const upper = (val: unknown): string => clean(val).toUpperCase();
const numeric = (val: unknown): number => {
  const n = Number(val || 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Classifies a patient right / pttype into one of the 8 SSJ RawServ categories.
 */
export const classifySsjRight = (row: {
  pttype?: string | null;
  name?: string | null;
  pttype_name?: string | null;
  hipdata_code?: string | null;
  paidst?: string | null;
}): SsjRightCategory => {
  const hip = upper(row.hipdata_code);
  const name = clean(row.name || row.pttype_name);
  const paidst = clean(row.paidst);

  // 1. STP (บุคคลที่มีปัญหาสถานะและสิทธิ)
  if (hip === 'STP' || /ปัญหาสถานะ|บุคคลไร้สัญชาติ|บุคคลไร้สถานะ|ไร้สถานะ/.test(name)) {
    return 'STP';
  }

  // 2. FWF (แรงงานต่างด้าว)
  if (['FWF', 'NRD'].includes(hip) || /ต่างด้าว|แรงงานต่างชาติ|แรงงานต่างด้าว/.test(name)) {
    return 'FWF';
  }

  // 3. LGO (องค์กรปกครองส่วนท้องถิ่น / อปท.)
  if (['LGO', 'PTY', 'BKK'].includes(hip) || /อปท|ท้องถิ่น|เทศบาล|อบต/.test(name)) {
    return 'LGO';
  }

  // 4. OFC (ข้าราชการ กรมบัญชีกลาง)
  if (['OFC', 'CSMBS'].includes(hip) || /ข้าราชการ|กรมบัญชีกลาง/.test(name)) {
    return 'OFC';
  }

  // 5. SSS (ประกันสังคม)
  if (['SSS', 'SSI'].includes(hip) || /ประกันสังคม|ปกส/.test(name)) {
    return 'SSS';
  }

  // 6. UC (บัตรทอง / ประกันสุขภาพถ้วนหน้า)
  if (hip === 'UCS' || /หลักประกันสุขภาพ|บัตรทอง|ประกันสุขภาพถ้วนหน้า/.test(name)) {
    return 'UC';
  }

  // 7. ชำระเงินเอง (เงินสด / จ่ายตรง)
  if (
    /ชำระเงิน|เงินสด|จ่ายสด|จ่ายตรงเบิกไม่ได้/.test(name) ||
    (hip === 'CSH' && !/ประกัน/.test(name)) ||
    hip === 'PAY' ||
    paidst === '01'
  ) {
    return 'ชำระเงินเอง';
  }

  // 8. สิทธิอื่นๆ (พรบ., รัฐวิสาหกิจ, ประกันชีวิต, เบิกต้นสังกัด, etc.)
  return 'สิทธิอื่นๆ';
};

/**
 * Aggregates raw OPD and IPD rows into the exact 54 SSJ RawServ report rows.
 */
export const aggregateSsjRawServRows = (
  opdRows: SsjOpdSourceRow[],
  ipdRows: SsjIpdSourceRow[]
): { rows: SsjRawServRow[]; audit: SsjReportAudit } => {
  // Counters for OPD
  const opdVisits: Record<SsjRightCategory, number> = {
    UC: 0, SSS: 0, OFC: 0, LGO: 0, STP: 0, FWF: 0, ชำระเงินเอง: 0, สิทธิอื่นๆ: 0,
  };
  const opdHNs: Record<SsjRightCategory, Set<string>> = {
    UC: new Set(), SSS: new Set(), OFC: new Set(), LGO: new Set(),
    STP: new Set(), FWF: new Set(), ชำระเงินเอง: new Set(), สิทธิอื่นๆ: new Set(),
  };
  const allOpdHns = new Set<string>();

  // Breakdown tracker
  const pttypeStats = new Map<
    string,
    { pttype: string; name: string; hipdata_code: string; assigned_right: SsjRightCategory; opd_visits: number; ipd_admits: number }
  >();

  for (const row of opdRows) {
    const pttype = clean(row.pttype);
    const right = classifySsjRight(row);
    opdVisits[right] = (opdVisits[right] || 0) + 1;
    if (row.hn) {
      opdHNs[right].add(clean(row.hn));
      allOpdHns.add(clean(row.hn));
    }

    if (pttype) {
      if (!pttypeStats.has(pttype)) {
        pttypeStats.set(pttype, {
          pttype,
          name: clean(row.pttype_name),
          hipdata_code: upper(row.hipdata_code),
          assigned_right: right,
          opd_visits: 0,
          ipd_admits: 0,
        });
      }
      pttypeStats.get(pttype)!.opd_visits += 1;
    }
  }

  // Counters for IPD
  const ipdAdmits: Record<SsjRightCategory, number> = {
    UC: 0, SSS: 0, OFC: 0, LGO: 0, STP: 0, FWF: 0, ชำระเงินเอง: 0, สิทธิอื่นๆ: 0,
  };
  const ipdHNs: Record<SsjRightCategory, Set<string>> = {
    UC: new Set(), SSS: new Set(), OFC: new Set(), LGO: new Set(),
    STP: new Set(), FWF: new Set(), ชำระเงินเอง: new Set(), สิทธิอื่นๆ: new Set(),
  };
  const ipdSumAdjRW: Record<SsjRightCategory, number> = {
    UC: 0, SSS: 0, OFC: 0, LGO: 0, STP: 0, FWF: 0, ชำระเงินเอง: 0, สิทธิอื่นๆ: 0,
  };
  const ipdSumLos: Record<SsjRightCategory, number> = {
    UC: 0, SSS: 0, OFC: 0, LGO: 0, STP: 0, FWF: 0, ชำระเงินเอง: 0, สิทธิอื่นๆ: 0,
  };
  const allIpdHns = new Set<string>();

  for (const row of ipdRows) {
    const pttype = clean(row.pttype);
    const right = classifySsjRight(row);
    ipdAdmits[right] = (ipdAdmits[right] || 0) + 1;
    if (row.hn) {
      ipdHNs[right].add(clean(row.hn));
      allIpdHns.add(clean(row.hn));
    }
    ipdSumAdjRW[right] = (ipdSumAdjRW[right] || 0) + numeric(row.adjrw);
    ipdSumLos[right] = (ipdSumLos[right] || 0) + Math.round(numeric(row.los));

    if (pttype) {
      if (!pttypeStats.has(pttype)) {
        pttypeStats.set(pttype, {
          pttype,
          name: clean(row.pttype_name),
          hipdata_code: upper(row.hipdata_code),
          assigned_right: right,
          opd_visits: 0,
          ipd_admits: 0,
        });
      }
      pttypeStats.get(pttype)!.ipd_admits += 1;
    }
  }

  // Construct the 54 exact rows
  const resultRows: SsjRawServRow[] = [];

  // Helper for generating standard section
  const buildSection = (
    codePrefix: string,
    servType: 'OPD' | 'IPD',
    itemLabel: string,
    values: Record<SsjRightCategory, number>,
    isDecimal: boolean = false
  ) => {
    let sum = 0;
    SSJ_RIGHTS_ORDER.forEach((right, idx) => {
      const codeNum = String(idx + 1).padStart(2, '0');
      const val = values[right] || 0;
      const formattedVal = isDecimal ? Number(val.toFixed(4)) : Math.round(val);
      sum += val;
      resultRows.push({
        code_serv: `${codePrefix}_${codeNum}`,
        serv_type: servType,
        item: itemLabel,
        rights: right,
        rights_code: codeNum,
        amount: formattedVal,
      });
    });

    // Row 09: รวมทั้งหมดทุกสิทธิ
    const totalAmount = isDecimal ? Number(sum.toFixed(4)) : Math.round(sum);
    resultRows.push({
      code_serv: `${codePrefix}_09`,
      serv_type: servType,
      item: itemLabel,
      rights: 'รวมทั้งหมดทุกสิทธิ',
      rights_code: '09',
      amount: totalAmount,
    });
  };

  // 1. OPV (Visit OPD)
  buildSection('OPV', 'OPD', 'Visit (ครั้ง/เดือน)', opdVisits, false);

  // 2. OPH (HN OPD)
  const opdHnCountMap: Record<SsjRightCategory, number> = {
    UC: opdHNs.UC.size,
    SSS: opdHNs.SSS.size,
    OFC: opdHNs.OFC.size,
    LGO: opdHNs.LGO.size,
    STP: opdHNs.STP.size,
    FWF: opdHNs.FWF.size,
    ชำระเงินเอง: opdHNs['ชำระเงินเอง'].size,
    สิทธิอื่นๆ: opdHNs['สิทธิอื่นๆ'].size,
  };
  buildSection('OPH', 'OPD', 'HN (คน/เดือน)', opdHnCountMap, false);

  // 3. IPA (Admit IPD)
  buildSection('IPA', 'IPD', 'Admit (ครั้ง/เดือน)', ipdAdmits, false);

  // 4. IPH (HN IPD)
  const ipdHnCountMap: Record<SsjRightCategory, number> = {
    UC: ipdHNs.UC.size,
    SSS: ipdHNs.SSS.size,
    OFC: ipdHNs.OFC.size,
    LGO: ipdHNs.LGO.size,
    STP: ipdHNs.STP.size,
    FWF: ipdHNs.FWF.size,
    ชำระเงินเอง: ipdHNs['ชำระเงินเอง'].size,
    สิทธิอื่นๆ: ipdHNs['สิทธิอื่นๆ'].size,
  };
  buildSection('IPH', 'IPD', 'HN (คน/เดือน)', ipdHnCountMap, false);

  // 5. IPS (SumAdjRW)
  buildSection('IPS', 'IPD', 'SumAdjRW/เดือน', ipdSumAdjRW, true);

  // 6. IPL (Los/วันนอน)
  buildSection('IPL', 'IPD', 'Los/เดือน', ipdSumLos, false);

  const totalSumAdjRw = Object.values(ipdSumAdjRW).reduce((a, b) => a + b, 0);
  const totalSumLos = Object.values(ipdSumLos).reduce((a, b) => a + b, 0);

  const audit: SsjReportAudit = {
    opd_total_visits: opdRows.length,
    opd_distinct_hn: allOpdHns.size,
    ipd_total_admits: ipdRows.length,
    ipd_distinct_hn: allIpdHns.size,
    ipd_sum_adjrw: Number(totalSumAdjRw.toFixed(4)),
    ipd_sum_los: Math.round(totalSumLos),
    pttype_breakdown: Array.from(pttypeStats.values()).sort((a, b) => (b.opd_visits + b.ipd_admits) - (a.opd_visits + a.ipd_admits)),
  };

  return { rows: resultRows, audit };
};

const validDate = (value: string) => /^20\d{2}-\d{2}-\d{2}$/.test(value);

/**
 * Loads data from HOSxP and computes the SSJ RawServ Report.
 */
export const getSsjRawServReportFromDb = async (input: {
  startDate: string;
  endDate: string;
}): Promise<SsjRawServReportResult> => {
  const { startDate, endDate } = input;
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
    throw new Error('กรุณาระบุช่วงวันที่ให้ถูกต้อง (YYYY-MM-DD)');
  }

  const connection = await getUTFConnection();
  try {
    // 1. Query OPD visits
    const [opdRaw]: any = await connection.query(
      `SELECT o.vn, o.hn, o.pttype, pt.name AS pttype_name, pt.hipdata_code, pt.paidst
       FROM ovst o
       LEFT JOIN pttype pt ON pt.pttype = o.pttype
       WHERE o.vstdate BETWEEN ? AND ?`,
      [startDate, endDate]
    );

    // 2. Query IPD admits (discharged within date range)
    const [ipdRaw]: any = await connection.query(
      `SELECT i.an, i.hn, i.pttype, pt.name AS pttype_name, pt.hipdata_code, pt.paidst,
              COALESCE(i.adjrw, i.rw, 0) AS adjrw,
              COALESCE(a.admdate, GREATEST(DATEDIFF(i.dchdate, i.regdate), 1)) AS los
       FROM ipt i
       LEFT JOIN an_stat a ON a.an = i.an
       LEFT JOIN pttype pt ON pt.pttype = i.pttype
       WHERE i.dchdate BETWEEN ? AND ?`,
      [startDate, endDate]
    );

    const { rows, audit } = aggregateSsjRawServRows(
      opdRaw as SsjOpdSourceRow[],
      ipdRaw as SsjIpdSourceRow[]
    );

    return {
      startDate,
      endDate,
      rows,
      audit,
    };
  } finally {
    connection.release();
  }
};

/**
 * Generates an Excel buffer by cloning template_ข้อมูลบริการ.xlsx and injecting the calculated amounts.
 */
export const generateSsjRawServExcelBuffer = (rows: SsjRawServRow[]): Buffer => {
  const templatePath = path.resolve(process.cwd(), 'server', 'templates', 'template_ข้อมูลบริการ.xlsx');
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template file not found at: ${templatePath}`);
  }

  const templateBuffer = fs.readFileSync(templatePath);
  const readFn = (XLSX as any).read || (XLSX as any).default?.read;
  const writeFn = (XLSX as any).write || (XLSX as any).default?.write;

  const wb = readFn(templateBuffer, { type: 'buffer' });
  const sheet = wb.Sheets['NewTemp'];
  if (!sheet) {
    throw new Error("Sheet 'NewTemp' not found in template file");
  }

  // Row 3 to 56 correspond to result rows index 0 to 53
  rows.forEach((row, idx) => {
    const excelRow = idx + 3;
    const cellKey = `F${excelRow}`;
    sheet[cellKey] = {
      t: 'n',
      v: row.amount,
      w: String(row.amount),
    };
  });

  return writeFn(wb, { type: 'buffer', bookType: 'xlsx' });
};
