export type AppPage = 'staff' | 'ipd' | 'ipdClaimMonitor' | 'hospitalReports' | 'admin' | 'fdh' | 'fdhImport' | 'fdhClaimDetail' | 'nhsoClose' | 'repstm' | 'repstmManage' | 'receivable' | 'insuranceOverview' | 'repDeny' | 'specific' | 'fundFdh' | 'fund43' | 'fundKtb' | 'fundOther' | 'monitor' | 'fsMonitor' | 'revenueOpportunity' | 'mophDmht' | 'mophVaccine' | 'guide' | 'settings' | 'memberAdmin' | 'authenSync' | 'preValidator' | 'workQueue' | 'rejectTracking' | 'reconciliation' | 'repDailySummary' | 'ppfsBenchmark' | 'ppfsVisitMatch' | 'uuc1Tracking' | 'ucOutsideCup';

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
