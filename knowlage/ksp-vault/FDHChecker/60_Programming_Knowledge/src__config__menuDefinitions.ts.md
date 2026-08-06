---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "src/config/menuDefinitions.ts"
source_hash: "9fd4789078bf45d44b07d2e5e5b1bb2ffacd112b89bb4fce0782a0a9f6587a0b"
managed_by: "sync-ksp-vault"
---
# menuDefinitions.ts

> Source: `src/config/menuDefinitions.ts`
> SHA-256: `9fd4789078bf45d44b07d2e5e5b1bb2ffacd112b89bb4fce0782a0a9f6587a0b`

````typescript
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
  { page: 'ipdClaimMonitor', icon: '📡', label: 'Monitor IPD Claim' },
  { page: 'fdh', icon: '🔍', label: 'ตรวจสอบเบิก FDH', divider: true },
  { page: 'nhsoClose', icon: '🔐', label: 'ปิดสิทธิ NHSO' },
];

export const toolNavItems: NavItem[] = [
  { page: 'aiReports', icon: '✨', label: 'FDH AI Report' },
  { page: 'hospitalReports', icon: '📑', label: 'ศูนย์รายงาน' },
  { page: 'fdhImport', icon: '📥', label: 'สถานะ FDH' },
  { page: 'fdhClaimDetail', icon: '📄', label: 'ClaimDetail FDH' },
  { page: 'repstm', icon: '🧾', label: 'REP/STM' },
  { page: 'repstmManage', icon: '🗃️', label: 'จัดการ REP/STM' },
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
  { page: 'ucOutsideCup', icon: '🏥', label: 'UC นอก CUP' },
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
  { page: 'revenueOpportunity', icon: '🧭', label: 'โอกาสรายได้' },
  { page: 'mophDmht', icon: '🧪', label: 'MOPH DMHT' },
  { page: 'mophVaccine', icon: '💉', label: 'MOPH Vaccine' },
  { page: 'guide', icon: '📚', label: 'คู่มือกองทุน', soft: true },
];

export const toolNavGroups: NavGroup[] = [
  { label: 'รายงานโรงพยาบาล', icon: '📑', pages: ['aiReports', 'hospitalReports'] },
  { label: 'นำเข้า/ตรวจสอบ', icon: '📤', pages: ['fdhImport', 'fdhClaimDetail', 'repstm', 'authenSync', 'preValidator'] },
  { label: 'ติดตามเคลม', icon: '🔎', pages: ['workQueue', 'rejectTracking', 'uuc1Tracking', 'repDeny'] },
  { label: 'การเงิน/บัญชี', icon: '💼', pages: ['revenueOpportunity', 'receivable', 'ucOutsideCup', 'reconciliation', 'repDailySummary', 'ppfsBenchmark', 'ppfsVisitMatch', 'insuranceOverview'] },
  { label: 'FDH/e-Claim', icon: '🏥', pages: ['fundFdh', 'monitor', 'fsMonitor'] },
  { label: '43 แฟ้ม', icon: '🗂️', pages: ['fund43'] },
  { label: 'MOPH Claim', icon: '🧪', pages: ['mophDmht', 'mophVaccine'] },
  { label: 'KTB/NTIP/อื่นๆ', icon: '🏦', pages: ['fundKtb', 'fundOther', 'specific', 'guide'] },
  { label: 'บริหารระบบ', icon: '⚙️', pages: ['admin', 'repstmManage', 'memberAdmin'] },
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

````
