export const MIS_HOS_API_BASE = 'https://mishos.nhso.go.th/mis_hos_apixam/';

export const FISCAL_MONTH_ORDER = ['10', '11', '12', '01', '02', '03', '04', '05', '06', '07', '08', '09'] as const;
export type FiscalMonthCode = (typeof FISCAL_MONTH_ORDER)[number];

export const THAI_MONTH_LABELS: Record<FiscalMonthCode, string> = {
  '10': 'ต.ค.',
  '11': 'พ.ย.',
  '12': 'ธ.ค.',
  '01': 'ม.ค.',
  '02': 'ก.พ.',
  '03': 'มี.ค.',
  '04': 'เม.ย.',
  '05': 'พ.ค.',
  '06': 'มิ.ย.',
  '07': 'ก.ค.',
  '08': 'ส.ค.',
  '09': 'ก.ย.',
};

export interface MisMenuGroup {
  id: string;
  label: string;
  order: number;
}

export interface MisPageDefinition {
  key: string;
  groupId: string;
  label: string;
  misRoute: string;
  kind: 'overview' | 'simplestudio';
  stId?: string;
  extraStIds?: string[];
  supportsThreeWay?: boolean;
  stmMatchCategory:
    | 'all'
    | 'budget'
    | 'eclaim_uc'
    | 'eclaim_other'
    | 'op'
    | 'ip'
    | 'opae'
    | 'oprefer'
    | 'carrefer'
    | 'walkin'
    | 'ontop'
    | 'stemi'
    | 'cancer'
    | 'cataract'
    | 'instrument'
    | 'stone'
    | 'palliative'
    | 'pp_anc'
    | 'pp_cancer'
    | 'pp_healthcheck'
    | 'policy_cancerany'
    | 'policy_covid19'
    | 'policy_change_right'
    | 'policy_telemed'
    | 'policy_oneid'
    | 'dmis_ckd'
    | 'dmis_moph'
    | 'dmis_ktp'
    | 'other_csmbs'
    | 'other_lgo';
}

export const MIS_HOS_MENU_GROUPS: MisMenuGroup[] = [
  { id: 'overview', label: 'Dashboard ภาพรวม', order: 0 },
  { id: 'budget', label: 'การโอนเงิน', order: 1 },
  { id: 'eclaim', label: '0-Eclaim Data', order: 2 },
  { id: 'op', label: '1.บริการผู้ป่วยนอก', order: 3 },
  { id: 'ip', label: '2.บริการผู้ป่วยใน', order: 4 },
  { id: 'outside', label: '3.บริการนอกเครือข่าย', order: 5 },
  { id: 'central', label: '4.บริการค่าใช้จ่ายสูง', order: 6 },
  { id: 'pp', label: '5.การส่งเสริมป้องกันโรค', order: 7 },
  { id: 'policy', label: '7.นโยบายสำคัญ', order: 8 },
  { id: 'dmis', label: '8.บริการเฉพาะ (DMIS)', order: 9 },
  { id: 'other', label: '9.บริการสิทธิอื่น', order: 10 },
];

export const MIS_HOS_PAGES: MisPageDefinition[] = [
  {
    key: 'overview',
    groupId: 'overview',
    label: 'Dashboard ภาพรวม',
    misRoute: '#/dashboard/overview',
    kind: 'overview',
    supportsThreeWay: true,
    stmMatchCategory: 'all',
  },
  {
    key: 'budget_dashboard',
    groupId: 'budget',
    label: '0.0 Dashboard สรุปงบประมาณ',
    misRoute: '#/budget/dashboard',
    kind: 'simplestudio',
    stId: '1843',
    extraStIds: ['1823'],
    supportsThreeWay: true,
    stmMatchCategory: 'budget',
  },
  {
    key: 'budget_transfer',
    groupId: 'budget',
    label: '0.1 รายการรับเงิน',
    misRoute: '#/budget/budget',
    kind: 'simplestudio',
    stId: '1843',
    supportsThreeWay: true,
    stmMatchCategory: 'budget',
  },
  {
    key: 'budget_statement_uc',
    groupId: 'budget',
    label: '0.2 Statement-UC',
    misRoute: '#/budget/statementuc',
    kind: 'simplestudio',
    stId: '1823',
    supportsThreeWay: true,
    stmMatchCategory: 'eclaim_uc',
  },
  {
    key: 'eclaim_uc',
    groupId: 'eclaim',
    label: 'สิทธิ UC',
    misRoute: '#/eclaimdata/uc',
    kind: 'simplestudio',
    stId: '404',
    stmMatchCategory: 'eclaim_uc',
  },
  {
    key: 'eclaim_other',
    groupId: 'eclaim',
    label: 'สิทธิอื่นๆ',
    misRoute: '#/eclaimdata/other',
    kind: 'simplestudio',
    stId: '424',
    stmMatchCategory: 'eclaim_other',
  },
  {
    key: 'op_ae',
    groupId: 'op',
    label: '1.1 ผู้ป่วยนอกฉุกเฉิน',
    misRoute: '#/Central/opae',
    kind: 'simplestudio',
    stId: '1603',
    stmMatchCategory: 'opae',
  },
  {
    key: 'op_refer',
    groupId: 'op',
    label: '1.2 OP-Refer',
    misRoute: '#/Central/oprefer',
    kind: 'simplestudio',
    stId: '582',
    stmMatchCategory: 'oprefer',
  },
  {
    key: 'op_carrefer',
    groupId: 'op',
    label: '1.3 ค่าพาหนะ',
    misRoute: '#/Central/carrefer',
    kind: 'simplestudio',
    stId: '1631',
    stmMatchCategory: 'carrefer',
  },
  {
    key: 'op_walkin',
    groupId: 'op',
    label: '1.4 OP WALKIN',
    misRoute: '#/op/opwalkin',
    kind: 'simplestudio',
    stId: '503',
    stmMatchCategory: 'walkin',
  },
  {
    key: 'op_ontop',
    groupId: 'op',
    label: '1.5 ชดเชยเพิ่มเติม (On Top)',
    misRoute: '#/op/opontop',
    kind: 'simplestudio',
    stId: '1202',
    stmMatchCategory: 'ontop',
  },
  {
    key: 'ip_service',
    groupId: 'ip',
    label: '2.1 การบริการผู้ป่วยใน',
    misRoute: '#/ip/ipservice0102',
    kind: 'simplestudio',
    stId: '453',
    stmMatchCategory: 'ip',
  },
  {
    key: 'ip_monitor',
    groupId: 'ip',
    label: '2.2 การส่งข้อมูลผู้ป่วยใน',
    misRoute: '#/ip/ipmonitor',
    kind: 'simplestudio',
    stId: '1224',
    stmMatchCategory: 'ip',
  },
  {
    key: 'outside_opae',
    groupId: 'outside',
    label: '3.1 ผู้ป่วยนอกฉุกเฉิน',
    misRoute: '#/Central/opae',
    kind: 'simplestudio',
    stId: '1603',
    stmMatchCategory: 'opae',
  },
  {
    key: 'outside_oprefer',
    groupId: 'outside',
    label: '3.2 OP-Refer',
    misRoute: '#/Central/oprefer',
    kind: 'simplestudio',
    stId: '582',
    stmMatchCategory: 'oprefer',
  },
  {
    key: 'outside_carrefer',
    groupId: 'outside',
    label: '3.3 ค่าพาหนะ',
    misRoute: '#/Central/carrefer',
    kind: 'simplestudio',
    stId: '1631',
    stmMatchCategory: 'carrefer',
  },
  {
    key: 'hc_stemi',
    groupId: 'central',
    label: '4.1 ยาละลายลิ่มเลือด',
    misRoute: '#/Central/stemi',
    kind: 'simplestudio',
    stId: '1468',
    stmMatchCategory: 'stemi',
  },
  {
    key: 'hc_cancer',
    groupId: 'central',
    label: '4.2 เคมีบำบัด',
    misRoute: '#/Central/cancer',
    kind: 'simplestudio',
    stId: '1469',
    stmMatchCategory: 'cancer',
  },
  {
    key: 'hc_cataract',
    groupId: 'central',
    label: '4.3 ต้อกระจก',
    misRoute: '#/Central/cataract',
    kind: 'simplestudio',
    stId: '1470',
    stmMatchCategory: 'cataract',
  },
  {
    key: 'hc_instrument',
    groupId: 'central',
    label: '4.4 อวัยวะเทียม/อุปกรณ์',
    misRoute: '#/Central/instrument',
    kind: 'simplestudio',
    stId: '1084',
    stmMatchCategory: 'instrument',
  },
  {
    key: 'hc_stone',
    groupId: 'central',
    label: '4.5 นิ่วในระบบทางเดินปัสสาวะ',
    misRoute: '#/Central/stone',
    kind: 'simplestudio',
    stId: '1472',
    stmMatchCategory: 'stone',
  },
  {
    key: 'hc_palliative',
    groupId: 'central',
    label: '4.6 PalliativeCare',
    misRoute: '#/Central/palliativecare',
    kind: 'simplestudio',
    stId: '1062',
    stmMatchCategory: 'palliative',
  },
  {
    key: 'pp_anc',
    groupId: 'pp',
    label: '5.1 บริการหญิงตั้งครรภ์',
    misRoute: '#/Pp/Ppfee',
    kind: 'simplestudio',
    stId: '742',
    stmMatchCategory: 'pp_anc',
  },
  {
    key: 'pp_cancer',
    groupId: 'pp',
    label: '5.2 ตรวจคัดกรองมะเร็ง',
    misRoute: '#/Pp/PpfeePap',
    kind: 'simplestudio',
    stId: '727',
    stmMatchCategory: 'pp_cancer',
  },
  {
    key: 'pp_healthcheck',
    groupId: 'pp',
    label: '5.3 ประเมินปัจจัยเสี่ยงต่อสุขภาพ',
    misRoute: '#/Pp/healthcheck',
    kind: 'simplestudio',
    stId: '1104',
    stmMatchCategory: 'pp_healthcheck',
  },
  {
    key: 'policy_cancerany',
    groupId: 'policy',
    label: '7.1 มะเร็งทุกที่',
    misRoute: '#/policy/cancerany',
    kind: 'simplestudio',
    stId: '865',
    stmMatchCategory: 'policy_cancerany',
  },
  {
    key: 'policy_covid19',
    groupId: 'policy',
    label: '7.2 Covid19',
    misRoute: '#/policy/covid19',
    kind: 'simplestudio',
    stId: '444',
    stmMatchCategory: 'policy_covid19',
  },
  {
    key: 'policy_change_right',
    groupId: 'policy',
    label: '7.3 เปลี่ยนสิทธิ',
    misRoute: '#/policy/change_right',
    kind: 'simplestudio',
    stId: '844',
    stmMatchCategory: 'policy_change_right',
  },
  {
    key: 'policy_walkin',
    groupId: 'policy',
    label: '7.4 รักษาทุกที่',
    misRoute: '#/op/opwalkin',
    kind: 'simplestudio',
    stId: '503',
    stmMatchCategory: 'walkin',
  },
  {
    key: 'policy_telemed',
    groupId: 'policy',
    label: '7.5 Telemed',
    misRoute: '#/policy/telemed',
    kind: 'simplestudio',
    stId: '1164',
    stmMatchCategory: 'policy_telemed',
  },
  {
    key: 'policy_oneid',
    groupId: 'policy',
    label: '7.6 บัตรประชาชนใบเดียว',
    misRoute: '#/policy/oneid',
    kind: 'simplestudio',
    stId: '2207',
    stmMatchCategory: 'policy_oneid',
  },
  {
    key: 'dmis_ckd',
    groupId: 'dmis',
    label: '8.1 ไตวายเรื้อรัง',
    misRoute: '#/dmis/ckd',
    kind: 'simplestudio',
    stId: '2183',
    stmMatchCategory: 'dmis_ckd',
  },
  {
    key: 'dmis_moph',
    groupId: 'dmis',
    label: '8.2 MOPH-Claim',
    misRoute: '#/dmis/moph',
    kind: 'simplestudio',
    stId: '2204',
    stmMatchCategory: 'dmis_moph',
  },
  {
    key: 'dmis_ktp',
    groupId: 'dmis',
    label: '8.3 KTP-Claim',
    misRoute: '#/dmis/ktp',
    kind: 'simplestudio',
    stId: '2243',
    stmMatchCategory: 'dmis_ktp',
  },
  {
    key: 'other_csmbs',
    groupId: 'other',
    label: '9.1 กรมบัญชีกลาง',
    misRoute: '#/Other/Csmbs',
    kind: 'simplestudio',
    stId: '1526',
    stmMatchCategory: 'other_csmbs',
  },
  {
    key: 'other_lgo',
    groupId: 'other',
    label: '9.2 ข้าราชการท้องถิ่น',
    misRoute: '#/Other/Lgo',
    kind: 'simplestudio',
    stId: '1504',
    stmMatchCategory: 'other_lgo',
  },
];

export interface MisSimpleStudioCardConfig {
  ssid: string;
  report_name: string;
  chart_type: string;
  report_width?: string;
  flag_data?: string;
  remark?: string;
}

export function getMisPageByKey(key: string): MisPageDefinition | undefined {
  return MIS_HOS_PAGES.find((p) => p.key === key);
}

/**
 * Convert Thai Buddhist Era fiscal year (e.g. "2569") to Christian Era year (2026) expected by MIS HOS API.
 */
export function fiscalYearBeToCe(be: string | number): number {
  const num = Number(String(be ?? '').trim());
  if (!Number.isFinite(num) || num <= 0) {
    return new Date().getFullYear();
  }
  return num >= 2400 ? num - 543 : num;
}

/**
 * Return fiscal date bounds (Oct 1 prev CE year through Sep 30 CE year) for a BE fiscal year.
 */
export function getFiscalDateRange(be: string | number): {
  beYear: string;
  ceYear: number;
  startDate: string;
  endDate: string;
  startMonthYm: string;
  endMonthYm: string;
} {
  const ce = fiscalYearBeToCe(be);
  const beYear = String(ce + 543);
  const prevCe = ce - 1;
  return {
    beYear,
    ceYear: ce,
    startDate: `${prevCe}-10-01`,
    endDate: `${ce}-09-30`,
    startMonthYm: `${prevCe}10`,
    endMonthYm: `${ce}09`,
  };
}

/**
 * Decode SimpleStudio base64 ST_CONFIG payload into active card definitions.
 */
export function decodeStConfig(base64Str: unknown): MisSimpleStudioCardConfig[] {
  const raw = String(base64Str ?? '').trim();
  if (!raw) return [];
  try {
    const jsonText = Buffer.from(raw, 'base64').toString('utf8').replace(/^\uFEFF/, '').trim();
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        ssid: String(item.ssid ?? item.ss_id ?? '').trim(),
        report_name: String(item.report_name ?? item.SS_REPORTNAME ?? '').trim(),
        chart_type: String(item.chart_type ?? 'table').trim().toLowerCase(),
        report_width: item.report_width != null ? String(item.report_width) : undefined,
        flag_data: item.flag_data != null ? String(item.flag_data) : 'Y',
        remark: item.remark != null ? String(item.remark) : undefined,
      }))
      .filter((card) => Boolean(card.ssid) && card.flag_data === 'Y');
  } catch {
    return [];
  }
}

/**
 * Normalize Thai fund / subfund names for fuzzy matching across MIS HOS, SMT, and STM.
 */
export function normalizeThaiFundName(name: unknown): string {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\([^)]*\)/g, (m) => ` ${m.slice(1, -1)} `)
    .replace(/^(กองทุนค่าบริการทางการแพทย์|กองทุน|ค่าบริการทางการแพทย์|ค่าบริการสาธารณสุข|ค่าบริการ|งบ|เงิน)\s*/g, '')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
