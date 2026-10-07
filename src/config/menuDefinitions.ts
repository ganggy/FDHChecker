import type { AppPage } from '../utils/navigationState';

export type NavItem = {
  page: AppPage;
  icon: string;
  label: string;
  divider?: boolean;
  soft?: boolean;
};

export type NavGroup = {
  label: string;
  icon: string;
  pages: AppPage[];
};

export const primaryNavItems: NavItem[] = [
  { page: 'staff', icon: '📋', label: 'รายการ OPD' },
  { page: 'fdh', icon: '📤', label: 'ส่งออก OPD' },
  { page: 'ipd', icon: '🛏️', label: 'รายการ IPD' },
  { page: 'ipdExport', icon: '📤', label: 'ส่งออก IPD' },
  { page: 'ipdClaimMonitor', icon: '📡', label: 'มอนิเตอร์เคลม IPD' },
  { page: 'nhsoClose', icon: '🔐', label: 'ปิดสิทธิ สปสช.' },
];

export const toolNavItems: NavItem[] = [
  { page: 'collaboration', icon: '💬', label: 'ศูนย์ตรวจสอบ (LINE)' },
  { page: 'aiReports', icon: '✨', label: 'FDH AI Analytics' },
  { page: 'hospitalReports', icon: '📑', label: 'ศูนย์รายงานโรงพยาบาล' },
  { page: 'annualCheckupReport', icon: '🩺', label: 'หลักฐานเบิกตรวจสุขภาพ' },
  { page: 'officialReceivable', icon: '🏛️', label: 'แบบลูกหนี้ราชการ 4 แบบ' },
  { page: 'receivableStandardReport', icon: '📑', label: 'รายงานลูกหนี้ 6 รูปแบบ' },
  { page: 'fdhImport', icon: '📥', label: 'ดึงสถานะเคลม FDH' },
  { page: 'fdhClaimDetail', icon: '📄', label: 'รายละเอียดเคลม FDH' },
  { page: 'repstm', icon: '🧾', label: 'นำเข้า REP/STM' },
  { page: 'repstmManage', icon: '🗃️', label: 'จัดการฐานข้อมูล REP/STM' },
  { page: 'sssExport', icon: '📦', label: 'ส่งออก SSOP (ประกันสังคม)' },
  { page: 'sssRepStm', icon: '📥', label: 'REP/STM ประกันสังคม' },
  { page: 'authenSync', icon: '🪪', label: 'ตรวจสอบ Authen สปสช.' },
  { page: 'ktbApproveCode', icon: '🏦', label: 'นำเข้า Approve Code KTB (EDC)' },
  { page: 'preValidator', icon: '✅', label: 'ตรวจความพร้อม 16 แฟ้ม' },
  { page: 'workQueue', icon: '📋', label: 'คิวงานส่งตรวจ' },
  { page: 'rejectTracking', icon: '🔴', label: 'ติดตามเคส Reject' },
  { page: 'uuc1Tracking', icon: '📌', label: 'เคสบัตรทองรอเบิก (UUC1)' },
  { page: 'receivable', icon: '💼', label: 'บัญชีลูกหนี้สิทธิ' },
  { page: 'receivableSettlement', icon: '💳', label: 'ตัดรับรู้ลูกหนี้' },
  { page: 'reconciliation', icon: '🔄', label: 'กระทบยอด REP/STM' },
  { page: 'stmZeroAudit', icon: '🔎', label: 'ตรวจ STM 0' },
  { page: 'repSheetZeroAudit', icon: '📄', label: 'ตรวจ REP Data Sheet 0' },
  { page: 'repDailySummary', icon: '📊', label: 'สรุป REP รายวัน' },
  { page: 'ppfsBenchmark', icon: '📈', label: 'เทียบยอดจัดสรร PPFS' },
  { page: 'ppfsVisitMatch', icon: '🔎', label: 'จับคู่บริการ PPFS' },
  { page: 'insuranceOverview', icon: '🧭', label: 'ภาพรวมประกันสุขภาพ' },
  { page: 'accountingRevenueBudget', icon: '🧮', label: 'รายงานบัญชี / ประมาณการรายได้' },
  { page: 'smtBudget', icon: '🏦', label: 'ตัดลูกหนี้ SMT / e-Budget' },
  { page: 'ucOutsideCup', icon: '🏥', label: 'UC นอก CUP (WALKIN)' },
  { page: 'dentalAudit', icon: '🦷', label: 'ตรวจสอบงานห้องฟัน' },
  { page: 'repDeny', icon: '⚠️', label: 'รายการติด C / ปฏิเสธจ่าย' },
  { page: 'admin', icon: '📊', label: 'Dashboard ภาพรวม' },
  { page: 'memberAdmin', icon: '👥', label: 'สมาชิกและสิทธิ์เมนู' },
  { page: 'fundFdh', icon: '📤', label: 'กองทุน FDH / e-Claim' },
  { page: 'fund43', icon: '🗂️', label: 'กองทุน 43 แฟ้ม' },
  { page: 'fundKtb', icon: '🏦', label: 'กองทุน KTB / NTIP' },
  { page: 'fundOther', icon: '🧩', label: 'กองทุนอื่นๆ' },
  { page: 'specific', icon: '🎯', label: 'รวมภาพรวมทุกกองทุน' },
  { page: 'monitor', icon: '📈', label: 'มอนิเตอร์กองทุนพิเศษ' },
  { page: 'fsMonitor', icon: '💰', label: 'มอนิเตอร์ Fee Schedule' },
  { page: 'revenueOpportunity', icon: '🧭', label: 'โอกาสสร้างรายได้' },
  { page: 'mophDmht', icon: '🧪', label: 'MOPH DMHT' },
  { page: 'mophVaccine', icon: '💉', label: 'MOPH Vaccine' },
  { page: 'icd9Lookup', icon: '🔍', label: 'ค้นหารหัสหัตถการ ICD-9' },
  { page: 'guide', icon: '📚', label: 'คู่มือกองทุน', soft: true },
];

export const toolNavGroups: NavGroup[] = [
  { label: 'นำเข้า/ตรวจสิทธิ', icon: '📥', pages: ['authenSync', 'ktbApproveCode', 'fdhImport', 'fdhClaimDetail', 'preValidator'] },
  { label: 'ติดตามงาน', icon: '🔎', pages: ['workQueue', 'rejectTracking', 'uuc1Tracking', 'repDeny', 'collaboration'] },
  { label: 'REP/STM & กระทบยอด', icon: '🧾', pages: ['repstm', 'reconciliation', 'stmZeroAudit', 'repSheetZeroAudit', 'repDailySummary'] },
  { label: 'ลูกหนี้ & บัญชี', icon: '💰', pages: ['receivable', 'receivableSettlement', 'smtBudget', 'officialReceivable', 'receivableStandardReport', 'accountingRevenueBudget'] },
  { label: 'กองทุนเฉพาะ', icon: '🎯', pages: ['fundFdh', 'fund43', 'fundKtb', 'dentalAudit', 'mophDmht', 'mophVaccine', 'fsMonitor', 'monitor', 'specific', 'fundOther'] },
  { label: 'ประกันสังคม', icon: '🔵', pages: ['sssExport', 'sssRepStm'] },
  { label: 'ผู้บริหาร/วิเคราะห์', icon: '📊', pages: ['insuranceOverview', 'admin', 'aiReports', 'hospitalReports', 'annualCheckupReport', 'revenueOpportunity', 'ppfsBenchmark', 'ppfsVisitMatch', 'ucOutsideCup'] },
  { label: 'ระบบ/อ้างอิง', icon: '⚙️', pages: ['memberAdmin', 'repstmManage', 'icd9Lookup', 'guide'] },
];

const groupPages = (...labels: string[]): AppPage[] =>
  toolNavGroups.filter((group) => labels.includes(group.label)).flatMap((group) => group.pages);

const claimPages: AppPage[] = ['staff', 'fdh', 'ipd', 'ipdExport', 'ipdClaimMonitor', 'nhsoClose'];

/** ชุดสิทธิ์สำเร็จรูปสำหรับกลุ่มผู้ใช้ — กดเลือกในหน้าจัดการสมาชิก แล้วปรับรายเมนูต่อได้ */
export const rolePresets: Array<{ key: string; label: string; pages: AppPage[] }> = [
  {
    key: 'claim',
    label: '🏥 เจ้าหน้าที่เคลม',
    pages: [...claimPages, ...groupPages('นำเข้า/ตรวจสิทธิ', 'ติดตามงาน'), 'icd9Lookup', 'guide'],
  },
  {
    key: 'audit',
    label: '👩‍⚕️ พยาบาลตรวจการเบิก (UR / Audit)',
    pages: [
      ...claimPages,
      'preValidator',
      'workQueue',
      'rejectTracking',
      'uuc1Tracking',
      'repDeny',
      'collaboration',
      'stmZeroAudit',
      'repSheetZeroAudit',
      'repDailySummary',
      'reconciliation',
      'dentalAudit',
      'mophDmht',
      'mophVaccine',
      'ucOutsideCup',
      'icd9Lookup',
      'guide',
    ],
  },
  {
    key: 'stat',
    label: '📊 เวชสถิติและรหัสโรค',
    pages: [
      ...claimPages,
      'preValidator',
      'icd9Lookup',
      'ppfsVisitMatch',
      'ppfsBenchmark',
      'reconciliation',
      'stmZeroAudit',
      'repSheetZeroAudit',
      'guide',
    ],
  },
  {
    key: 'finance',
    label: '💰 การเงิน/บัญชีลูกหนี้',
    pages: [...groupPages('REP/STM & กระทบยอด', 'ลูกหนี้ & บัญชี'), 'insuranceOverview', 'guide'],
  },
  {
    key: 'executive',
    label: '📈 ผู้บริหารและวิเคราะห์',
    pages: [...groupPages('ผู้บริหาร/วิเคราะห์'), 'receivableStandardReport', 'accountingRevenueBudget', 'guide'],
  },
  {
    key: 'insurance',
    label: '🛡️ ประกันสุขภาพ (ครอบคลุมครบวงจร)',
    pages: [
      ...claimPages,
      ...groupPages('นำเข้า/ตรวจสิทธิ', 'ติดตามงาน', 'REP/STM & กระทบยอด', 'กองทุนเฉพาะ', 'ประกันสังคม'),
      'icd9Lookup',
      'guide',
    ],
  },
];

export const allMenuItems: NavItem[] = [
  ...primaryNavItems,
  ...toolNavItems,
  { page: 'settings', icon: '⚙️', label: 'ตั้งค่าระบบ' },
];

export const allMenuPages = allMenuItems.map((item) => item.page);

export const menuLabelByPage = allMenuItems.reduce<Record<string, string>>((acc, item) => {
  acc[item.page] = item.label;
  return acc;
}, {});

export const adminOnlyPages: AppPage[] = ['settings', 'repstmManage', 'memberAdmin'];
