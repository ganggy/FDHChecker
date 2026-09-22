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
  { page: 'collaboration', icon: '💬', label: 'ศูนย์ตรวจสอบ (LINE)' },
];

export const toolNavItems: NavItem[] = [
  { page: 'collaboration', icon: '💬', label: 'ศูนย์ตรวจสอบ (LINE)' },
  { page: 'aiReports', icon: '✨', label: 'FDH AI Analytics' },
  { page: 'hospitalReports', icon: '📑', label: 'ศูนย์รายงานโรงพยาบาล' },
  { page: 'fdhImport', icon: '📥', label: 'ดึงสถานะเคลม FDH' },
  { page: 'fdhClaimDetail', icon: '📄', label: 'รายละเอียดเคลม FDH' },
  { page: 'repstm', icon: '🧾', label: 'นำเข้า REP/STM' },
  { page: 'repstmManage', icon: '🗃️', label: 'จัดการฐานข้อมูล REP/STM' },
  { page: 'sssExport', icon: '📦', label: 'ส่งออก SSOP (ประกันสังคม)' },
  { page: 'sssRepStm', icon: '📥', label: 'REP/STM ประกันสังคม' },
  { page: 'authenSync', icon: '🪪', label: 'ตรวจสอบ Authen สปสช.' },
  { page: 'preValidator', icon: '✅', label: 'ตรวจความพร้อม 16 แฟ้ม' },
  { page: 'workQueue', icon: '📋', label: 'คิวงานส่งตรวจ' },
  { page: 'rejectTracking', icon: '🔴', label: 'ติดตามเคส Reject' },
  { page: 'uuc1Tracking', icon: '📌', label: 'เคสบัตรทองรอเบิก (UUC1)' },
  { page: 'receivable', icon: '💼', label: 'บัญชีลูกหนี้สิทธิ' },
  { page: 'receivableSettlement', icon: '💳', label: 'ตัดรับรู้ลูกหนี้' },
  { page: 'reconciliation', icon: '🔄', label: 'กระทบยอด REP/STM' },
  { page: 'repDailySummary', icon: '📊', label: 'สรุป REP รายวัน' },
  { page: 'ppfsBenchmark', icon: '📈', label: 'เทียบยอดจัดสรร PPFS' },
  { page: 'ppfsVisitMatch', icon: '🔎', label: 'จับคู่บริการ PPFS' },
  { page: 'insuranceOverview', icon: '🧭', label: 'ภาพรวมประกันสุขภาพ' },
  { page: 'accountingRevenueBudget', icon: '🧮', label: 'รายงานบัญชี / ประมาณการรายได้' },
  { page: 'ucOutsideCup', icon: '🏥', label: 'UC นอก CUP (WALKIN)' },
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
  { label: 'นำเข้า/ตรวจสิทธิ', icon: '📥', pages: ['authenSync', 'fdhImport', 'fdhClaimDetail', 'preValidator', 'repstm'] },
  { label: 'ติดตามผลเคลม', icon: '🔎', pages: ['workQueue', 'rejectTracking', 'uuc1Tracking', 'repDeny'] },
  { label: 'กองทุนเฉพาะ', icon: '🎯', pages: ['fundFdh', 'monitor', 'fsMonitor', 'fund43', 'mophDmht', 'mophVaccine', 'fundKtb', 'fundOther', 'specific', 'icd9Lookup', 'guide'] },
  { label: 'ประกันสังคม', icon: '🔵', pages: ['sssExport', 'sssRepStm'] },
  { label: 'การเงิน/ลูกหนี้', icon: '💼', pages: ['receivable', 'receivableSettlement', 'ucOutsideCup', 'accountingRevenueBudget', 'revenueOpportunity', 'reconciliation', 'repDailySummary', 'ppfsBenchmark', 'ppfsVisitMatch', 'insuranceOverview'] },
  { label: 'รายงาน/สถิติ', icon: '📊', pages: ['aiReports', 'hospitalReports', 'admin'] },
  { label: 'บริหารระบบ', icon: '⚙️', pages: ['memberAdmin', 'repstmManage'] },
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
