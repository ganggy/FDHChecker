import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { LoginPage } from './pages/LoginPage';
import { adminOnlyPages, primaryNavItems, toolNavGroups, toolNavItems } from './config/menuDefinitions';
import { fetchMe, logout, type AuthSession } from './services/authService';
import type { AppPage } from './utils/navigationState';
import businessRules from './config/business_rules.json';
import './App.css';

const lazyNamed = <T extends Record<string, unknown>, K extends keyof T>(
  loader: () => Promise<T>,
  name: K,
) => lazy(async () => ({ default: (await loader())[name] as ComponentType<Record<string, never>> }));

const StaffPage = lazyNamed(() => import('./pages/StaffPage'), 'StaffPage');
const IPDPage = lazyNamed(() => import('./pages/IPDPage'), 'IPDPage');
const IpdClaimMonitorPage = lazyNamed(() => import('./pages/IpdClaimMonitorPage'), 'IpdClaimMonitorPage');
const AdminDashboard = lazyNamed(() => import('./pages/AdminDashboard'), 'AdminDashboard');
const FDHCheckerPage = lazyNamed(() => import('./pages/FDHCheckerPage'), 'FDHCheckerPage');
const FDHImportStatusPage = lazyNamed(() => import('./pages/FDHImportStatusPage'), 'FDHImportStatusPage');
const FdhClaimDetailImportPage = lazyNamed(() => import('./pages/FdhClaimDetailImportPage'), 'FdhClaimDetailImportPage');
const NhsoClosePage = lazyNamed(() => import('./pages/NhsoClosePage'), 'NhsoClosePage');
const RepStmImportPage = lazyNamed(() => import('./pages/RepStmImportPage'), 'RepStmImportPage');
const AuthenSyncPage = lazyNamed(() => import('./pages/AuthenSyncPage'), 'AuthenSyncPage');
const ReceivablePage = lazyNamed(() => import('./pages/ReceivablePage'), 'ReceivablePage');
const InsuranceOverviewPage = lazyNamed(() => import('./pages/InsuranceOverviewPage'), 'InsuranceOverviewPage');
const VisitReconciliationPage = lazy(() => import('./pages/VisitReconciliationPage'));
const RepDailySummaryPage = lazy(() => import('./pages/RepDailySummaryPage'));
const PpfsBenchmarkPage = lazy(() => import('./pages/PpfsBenchmarkPage'));
const PpfsVisitMatchPage = lazy(() => import('./pages/PpfsVisitMatchPage'));
const RepDenyPage = lazyNamed(() => import('./pages/RepDenyPage'), 'RepDenyPage');
const PreSubmitValidatorPage = lazy(() => import('./pages/PreSubmitValidatorPage'));
const WorkQueuePage = lazy(() => import('./pages/WorkQueuePage'));
const RejectedClaimTrackingPage = lazy(() => import('./pages/RejectedClaimTrackingPage'));
const Uuc1TrackingPage = lazy(() => import('./pages/Uuc1TrackingPage'));
const SpecificFundPage = lazy(() => import('./pages/SpecificFundPage').then((module) => ({ default: module.SpecificFundPage })));
const SpecialMonitorPage = lazyNamed(() => import('./pages/SpecialMonitorPage'), 'SpecialMonitorPage');
const FsMonitorPage = lazyNamed(() => import('./pages/FsMonitorPage'), 'FsMonitorPage');
const MophDmhtClaimPage = lazyNamed(() => import('./pages/MophDmhtClaimPage'), 'MophDmhtClaimPage');
const MophVaccineClaimPage = lazyNamed(() => import('./pages/MophVaccineClaimPage'), 'MophVaccineClaimPage');
const GuidePage = lazyNamed(() => import('./pages/GuidePage'), 'GuidePage');
const SettingsPage = lazyNamed(() => import('./pages/SettingsPage'), 'SettingsPage');
const MemberAdminPage = lazyNamed(() => import('./pages/MemberAdminPage'), 'MemberAdminPage');

function App() {
  const [requestedPage, setCurrentPage] = useState<AppPage>('staff');
  const [openNavGroup, setOpenNavGroup] = useState<string | null>(null);
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const navMenuRef = useRef<HTMLDivElement | null>(null);
  const siteSettings = (businessRules as { site_settings?: { hospital_name?: string; nhso_region?: string } }).site_settings || {};
  const hospitalLabel = siteSettings.hospital_name || 'FDH Checker';
  const regionLabel = siteSettings.nhso_region ? `เขต ${siteSettings.nhso_region}` : '';
  const isAdmin = Boolean(authSession?.user.is_admin);
  const allowedPageSet = useMemo(() => new Set<AppPage>(isAdmin
    ? [...primaryNavItems, ...toolNavItems].map((item) => item.page).concat(adminOnlyPages)
    : (authSession?.user.menu_permissions || []).filter((page) => !adminOnlyPages.includes(page))), [authSession, isAdmin]);
  const hasAnyAllowedPage = allowedPageSet.size > 0;
  const visiblePrimaryNavItems = primaryNavItems.filter((item) => allowedPageSet.has(item.page));
  const visibleToolNavGroups = toolNavGroups
    .map((group) => ({ ...group, pages: group.pages.filter((page) => allowedPageSet.has(page)) }))
    .filter((group) => group.pages.length > 0);
  const toolNavItemByPage = new Map(toolNavItems.map((item) => [item.page, item]));

  useEffect(() => {
    fetchMe()
      .then((session) => setAuthSession(session))
      .finally(() => setAuthLoading(false));
  }, []);

  const canOpenPage = useCallback((page: AppPage) => allowedPageSet.has(page), [allowedPageSet]);

  const firstAllowedPage = visiblePrimaryNavItems[0]?.page || visibleToolNavGroups[0]?.pages[0];
  const currentPage = canOpenPage(requestedPage) ? requestedPage : firstAllowedPage;

  useEffect(() => {
    const handleNavigate = (event: Event) => {
      const customEvent = event as CustomEvent<{ page?: AppPage }>;
      if (customEvent.detail?.page && canOpenPage(customEvent.detail.page)) {
        setCurrentPage(customEvent.detail.page);
      }
    };

    window.addEventListener('fdh:navigate', handleNavigate as EventListener);
    return () => window.removeEventListener('fdh:navigate', handleNavigate as EventListener);
  }, [canOpenPage]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!navMenuRef.current) return;
      if (!navMenuRef.current.contains(event.target as Node)) {
        setOpenNavGroup(null);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  const goToPage = (page: AppPage) => {
    if (!canOpenPage(page)) return;
    setCurrentPage(page);
    setOpenNavGroup(null);
  };

  const handleLogout = async () => {
    await logout();
    setAuthSession(null);
    setCurrentPage('staff');
  };

  if (authLoading) {
    return (
      <div className="auth-page">
        <div className="auth-card auth-card--loading">กำลังตรวจสอบ session...</div>
      </div>
    );
  }

  if (!authSession) {
    return <LoginPage onAuthenticated={setAuthSession} />;
  }

  if (!hasAnyAllowedPage) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-brand">
            <div className="brand-icon">🏥</div>
            <div>
              <h1>ยังไม่มีสิทธิ์เมนู</h1>
              <p>บัญชีนี้ได้รับอนุมัติแล้ว แต่ยังไม่ได้ถูกกำหนดเมนูให้ใช้งาน กรุณาให้ admin ตั้งค่ากลุ่มหรือสิทธิ์เมนู</p>
            </div>
          </div>
          <button className="auth-submit" type="button" onClick={handleLogout}>ออกจากระบบ</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <nav className="navbar">
        <div className="navbar-top">
          <div className="navbar-brand">
            <div className="brand-icon">🏥</div>
            <div className="navbar-brand-copy">
              <span className="navbar-brand-title">FDH Checker</span>
              <span className="navbar-brand-subtitle">ระบบตรวจสอบเบิกจ่ายและปิดสิทธิ</span>
            </div>
          </div>

          <div className="navbar-end">
            <div className="navbar-user navbar-meta-card">
              <div style={{ fontWeight: 700, color: 'rgba(255,255,255,0.94)' }}>{authSession.user.display_name || authSession.user.username}</div>
              <div>{authSession.user.group_name || (authSession.user.is_admin ? 'ผู้ดูแลระบบ' : 'ผู้ใช้งาน')}</div>
            </div>
            <div className="navbar-time navbar-meta-card">
              <div style={{ fontWeight: 700, color: 'rgba(255,255,255,0.94)' }}>ระบบตรวจสอบเบิกจ่าย v1.0</div>
              <div>{hospitalLabel}{regionLabel ? ` · ${regionLabel}` : ''}</div>
              <div>{new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
            </div>
            {canOpenPage('settings') && (
              <button
                className={`nav-btn nav-icon-btn ${currentPage === 'settings' ? 'active' : ''}`}
                onClick={() => goToPage('settings')}
                title="ตั้งค่าระบบ"
              >
                <span style={{ fontSize: '1.4rem' }}>⚙️</span>
              </button>
            )}
            <button className="nav-btn nav-icon-btn" onClick={handleLogout} title="ออกจากระบบ">
              <span style={{ fontSize: '1.15rem' }}>⏻</span>
            </button>
          </div>
        </div>

        <div className="navbar-menu-shell">
          <div className="navbar-menu-group">
            <div className="navbar-group-label">งานประจำ</div>
            <div className="navbar-nav">
              {visiblePrimaryNavItems.map((item) => (
                <button
                  key={item.page}
                  className={`nav-btn ${item.divider ? 'nav-btn--divider' : ''} ${currentPage === item.page ? 'active' : ''}`}
                  onClick={() => goToPage(item.page)}
                >
                  <span className="nav-btn-icon">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="navbar-menu-group navbar-menu-group--tools navbar-menu-group--compact" ref={navMenuRef}>
            <div className="navbar-group-label">เครื่องมือ</div>
            <div className="navbar-dropdown-row">
              {visibleToolNavGroups.map((group) => {
                const isGroupActive = group.pages.includes(currentPage);
                const isOpen = openNavGroup === group.label;
                return (
                  <div className="navbar-dropdown" key={group.label}>
                    <button
                      type="button"
                      className={`nav-btn navbar-dropdown-trigger ${isGroupActive ? 'active' : ''} ${isOpen ? 'is-open' : ''}`}
                      onClick={() => setOpenNavGroup(isOpen ? null : group.label)}
                      aria-expanded={isOpen}
                    >
                      <span className="nav-btn-icon">{group.icon}</span>
                      <span>{group.label}</span>
                      <span className="navbar-dropdown-chevron">▾</span>
                    </button>
                    {isOpen && (
                      <div className="navbar-dropdown-menu">
                        {group.pages.map((page) => {
                          const item = toolNavItemByPage.get(page);
                          if (!item) return null;
                          return (
                            <button
                              key={item.page}
                              type="button"
                              className={`navbar-dropdown-item ${currentPage === item.page ? 'active' : ''}`}
                              onClick={() => goToPage(item.page)}
                            >
                              <span className="nav-btn-icon">{item.icon}</span>
                              <span>{item.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </nav>

      <div className="app-main">
        <Suspense fallback={<div className="page-loading" role="status">กำลังโหลดหน้าจอ...</div>}>
        {currentPage === 'staff' && <StaffPage />}
        {currentPage === 'ipd' && <IPDPage />}
        {currentPage === 'ipdClaimMonitor' && <IpdClaimMonitorPage />}
        {currentPage === 'fdh' && <FDHCheckerPage />}
        {currentPage === 'fdhImport' && <FDHImportStatusPage />}
        {currentPage === 'fdhClaimDetail' && <FdhClaimDetailImportPage />}
        {currentPage === 'nhsoClose' && <NhsoClosePage />}
        {currentPage === 'repstm' && <RepStmImportPage />}
        {currentPage === 'authenSync' && <AuthenSyncPage />}
        {currentPage === 'receivable' && <ReceivablePage />}
        {currentPage === 'insuranceOverview' && <InsuranceOverviewPage />}
        {currentPage === 'reconciliation' && <VisitReconciliationPage />}
        {currentPage === 'repDailySummary' && <RepDailySummaryPage />}
        {currentPage === 'ppfsBenchmark' && <PpfsBenchmarkPage />}
        {currentPage === 'ppfsVisitMatch' && <PpfsVisitMatchPage />}
        {currentPage === 'repDeny' && <RepDenyPage />}
        {currentPage === 'admin' && <AdminDashboard />}
        {currentPage === 'specific' && <SpecificFundPage />}
        {currentPage === 'fundFdh' && <SpecificFundPage channelView="fdh" />}
        {currentPage === 'fund43' && <SpecificFundPage channelView="43" />}
        {currentPage === 'fundKtb' && <SpecificFundPage channelView="ktb" />}
        {currentPage === 'fundOther' && <SpecificFundPage channelView="other" />}
        {currentPage === 'monitor' && <SpecialMonitorPage />}
        {currentPage === 'fsMonitor' && <FsMonitorPage />}
        {currentPage === 'mophDmht' && <MophDmhtClaimPage />}
        {currentPage === 'mophVaccine' && <MophVaccineClaimPage />}
        {currentPage === 'preValidator' && <PreSubmitValidatorPage />}
        {currentPage === 'workQueue' && <WorkQueuePage />}
        {currentPage === 'rejectTracking' && <RejectedClaimTrackingPage />}
        {currentPage === 'uuc1Tracking' && <Uuc1TrackingPage />}
        {currentPage === 'guide' && <GuidePage />}
        {currentPage === 'settings' && <SettingsPage />}
        {currentPage === 'memberAdmin' && <MemberAdminPage />}
        </Suspense>
      </div>
    </div>
  );
}


export default App;
