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
  { page: 'ipd', icon: '🛏️', label: 'รายการ IPD' },
  { page: 'fdh', icon: '🔍', label: 'ตรวจสอบเบิก FDH', divider: true },
  { page: 'nhsoClose', icon: '🔐', label: 'ปิดสิทธิ NHSO' },
];

export const toolNavItems: NavItem[] = [
  { page: 'fdhImport', icon: '📥', label: 'สถานะ FDH' },
  { page: 'fdhClaimDetail', icon: '📄', label: 'ClaimDetail FDH' },
  { page: 'repstm', icon: '🧾', label: 'REP/STM' },
  { page: 'authenSync', icon: '🪪', label: 'Authen Code' },
  { page: 'preValidator', icon: '✅', label: 'Pre-submit' },
  { page: 'workQueue', icon: '📋', label: 'คิวงาน' },
  { page: 'rejectTracking', icon: '🔴', label: 'ติดตาม Reject' },
  { page: 'uuc1Tracking', icon: '📌', label: 'ติดตาม UUC1' },
  { page: 'receivable', icon: '💼', label: 'บัญชีลูกหนี้' },
  { page: 'reconciliation', icon: '🔄', label: 'กระทบยอด REP/STM' },
  { page: 'repDailySummary', icon: '📊', label: 'สรุป REP รายวัน' },
  { page: 'ppfsBenchmark', icon: '📈', label: 'เทียบยอด PPFS' },
  { page: 'ppfsVisitMatch', icon: '🔎', label: 'Match PPFS' },
  { page: 'insuranceOverview', icon: '🧭', label: 'ภาพรวมประกัน' },
  { page: 'repDeny', icon: '⚠️', label: 'ติด C/Deny' },
  { page: 'admin', icon: '📊', label: 'Dashboard' },
  { page: 'memberAdmin', icon: '👥', label: 'สมาชิก/สิทธิ์เมนู' },
  { page: 'fundFdh', icon: '📤', label: 'FDH/e-Claim' },
  { page: 'fund43', icon: '🗂️', label: '43 แฟ้ม' },
  { page: 'fundKtb', icon: '🏦', label: 'KTB/NTIP' },
  { page: 'fundOther', icon: '🧩', label: 'อื่นๆ' },
  { page: 'specific', icon: '🎯', label: 'รวมทุกช่องทาง' },
  { page: 'monitor', icon: '📈', label: 'มอนิเตอร์พิเศษ' },
  { page: 'fsMonitor', icon: '💰', label: 'มอนิเตอร์ FS' },
  { page: 'mophDmht', icon: '🧪', label: 'MOPH DMHT' },
  { page: 'mophVaccine', icon: '💉', label: 'MOPH Vaccine' },
  { page: 'guide', icon: '📚', label: 'คู่มือกองทุน', soft: true },
];

export const toolNavGroups: NavGroup[] = [
  { label: 'นำเข้า/ตรวจสอบ', icon: '📤', pages: ['fdhImport', 'fdhClaimDetail', 'repstm', 'authenSync', 'preValidator'] },
  { label: 'ติดตามเคลม', icon: '🔎', pages: ['workQueue', 'rejectTracking', 'uuc1Tracking', 'repDeny'] },
  { label: 'การเงิน/บัญชี', icon: '💼', pages: ['receivable', 'reconciliation', 'repDailySummary', 'ppfsBenchmark', 'ppfsVisitMatch', 'insuranceOverview'] },
  { label: 'FDH/e-Claim', icon: '🏥', pages: ['fundFdh', 'monitor', 'fsMonitor'] },
  { label: '43 แฟ้ม', icon: '🗂️', pages: ['fund43'] },
  { label: 'MOPH Claim', icon: '🧪', pages: ['mophDmht', 'mophVaccine'] },
  { label: 'KTB/NTIP/อื่นๆ', icon: '🏦', pages: ['fundKtb', 'fundOther', 'specific', 'guide'] },
  { label: 'บริหารระบบ', icon: '⚙️', pages: ['admin', 'memberAdmin'] },
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

export const adminOnlyPages: AppPage[] = ['settings', 'memberAdmin'];
