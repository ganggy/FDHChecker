---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "src/utils/navigationState.ts"
source_hash: "a0b5a0afbc05a7241fbb70f5d99ffe739061c8a7b0feaa14770e4618dab07e4a"
managed_by: "sync-ksp-vault"
---
# navigationState.ts

> Source: `src/utils/navigationState.ts`
> SHA-256: `a0b5a0afbc05a7241fbb70f5d99ffe739061c8a7b0feaa14770e4618dab07e4a`

````typescript
export type AppPage = 'staff' | 'ipd' | 'ipdClaimMonitor' | 'aiReports' | 'hospitalReports' | 'admin' | 'fdh' | 'fdhImport' | 'fdhClaimDetail' | 'nhsoClose' | 'repstm' | 'repstmManage' | 'receivable' | 'insuranceOverview' | 'repDeny' | 'specific' | 'fundFdh' | 'fund43' | 'fundKtb' | 'fundOther' | 'monitor' | 'fsMonitor' | 'revenueOpportunity' | 'mophDmht' | 'mophVaccine' | 'guide' | 'settings' | 'memberAdmin' | 'authenSync' | 'preValidator' | 'workQueue' | 'rejectTracking' | 'reconciliation' | 'repDailySummary' | 'ppfsBenchmark' | 'ppfsVisitMatch' | 'uuc1Tracking' | 'ucOutsideCup';

export interface DashboardNavigationPayload {
  source?: 'dashboard';
  contextLabel?: string;
  startDate?: string;
  endDate?: string;
  staff?: {
    statusFilter?: 'all' | 'complete' | 'incomplete';
    uucFilter?: 'all' | 'UUC1' | 'UUC2';
    specialFilter?: 'all' | 'special_only';
    selectedFund?: string;
    search?: string;
  };
  fdh?: {
    statusFilter?: 'all' | 'ready' | 'pending';
  };
  specific?: {
    activeFund?: string;
    showIncompleteOnly?: boolean;
  };
}

const STORAGE_KEY = 'fdh-dashboard-navigation';

export const navigateFromDashboard = (page: AppPage, payload: DashboardNavigationPayload) => {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ page, payload }));
  window.dispatchEvent(new CustomEvent('fdh:navigate', { detail: { page } }));
};

export const consumeDashboardNavigation = (page: AppPage): DashboardNavigationPayload | null => {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { page?: AppPage; payload?: DashboardNavigationPayload };
    if (parsed.page !== page) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    return parsed.payload || null;
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
};

````
