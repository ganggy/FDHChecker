import { useEffect, useRef, useState } from 'react';
import { StaffPage } from './pages/StaffPage';
import { IPDPage } from './pages/IPDPage';
import { AdminDashboard } from './pages/AdminDashboard';
import { FDHCheckerPage } from './pages/FDHCheckerPage';
import { FDHImportStatusPage } from './pages/FDHImportStatusPage';
import { FdhClaimDetailImportPage } from './pages/FdhClaimDetailImportPage';
import { NhsoClosePage } from './pages/NhsoClosePage';
import { RepStmImportPage } from './pages/RepStmImportPage';
import { ReceivablePage } from './pages/ReceivablePage';
import { InsuranceOverviewPage } from './pages/InsuranceOverviewPage';
import { VisitReconciliationPage } from './pages/VisitReconciliationPage';
import RepDailySummaryPage from './pages/RepDailySummaryPage';
import PpfsBenchmarkPage from './pages/PpfsBenchmarkPage';
import { RepDenyPage } from './pages/RepDenyPage';
import { AuthenSyncPage } from './pages/AuthenSyncPage';
import PreSubmitValidatorPage from './pages/PreSubmitValidatorPage';
import WorkQueuePage from './pages/WorkQueuePage';
import RejectedClaimTrackingPage from './pages/RejectedClaimTrackingPage';
import Uuc1TrackingPage from './pages/Uuc1TrackingPage';
import { SpecificFundPage } from './pages/SpecificFundPage';
import { SpecialMonitorPage } from './pages/SpecialMonitorPage';
import { FsMonitorPage } from './pages/FsMonitorPage';
import { MophDmhtClaimPage } from './pages/MophDmhtClaimPage';
import { MophVaccineClaimPage } from './pages/MophVaccineClaimPage';
import { GuidePage } from './pages/GuidePage';
import { SettingsPage } from './pages/SettingsPage';
import { LoginPage } from './pages/LoginPage';
import { MemberAdminPage } from './pages/MemberAdminPage';
import { adminOnlyPages, primaryNavItems, toolNavGroups, toolNavItems } from './config/menuDefinitions';
import { fetchMe, logout, type AuthSession } from './services/authService';
import type { AppPage } from './utils/navigationState';
import businessRules from './config/business_rules.json';
import './App.css';

function App() {
  const [currentPage, setCurrentPage] = useState<AppPage>('staff');
  const [openNavGroup, setOpenNavGroup] = useState<string | null>(null);
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const navMenuRef = useRef<HTMLDivElement | null>(null);
  const siteSettings = (businessRules as { site_settings?: { hospital_name?: string; nhso_region?: string } }).site_settings || {};
  const hospitalLabel = siteSettings.hospital_name || 'FDH Checker';
  const regionLabel = siteSettings.nhso_region ? `เขต ${siteSettings.nhso_region}` : '';
  const isAdmin = Boolean(authSession?.user.is_admin);
  const allowedPages = isAdmin
    ? [...primaryNavItems, ...toolNavItems].map((item) => item.page).concat(adminOnlyPages)
    : (authSession?.user.menu_permissions || []).filter((page) => !adminOnlyPages.includes(page));
  const allowedPageSet = new Set<AppPage>(allowedPages);
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

  const canOpenPage = (page: AppPage) => allowedPageSet.has(page);

  const firstAllowedPage = () => {
    const firstPrimary = visiblePrimaryNavItems[0]?.page;
    const firstTool = visibleToolNavGroups[0]?.pages[0];
    return firstPrimary || firstTool || 'guide';
  };

  useEffect(() => {
    if (authLoading || !authSession) return;
    if (!canOpenPage(currentPage)) {
      setCurrentPage(firstAllowedPage());
    }
  }, [authLoading, authSession, currentPage]);

  useEffect(() => {
    const handleNavigate = (event: Event) => {
      const customEvent = event as CustomEvent<{ page?: AppPage }>;
      if (customEvent.detail?.page && canOpenPage(customEvent.detail.page)) {
        setCurrentPage(customEvent.detail.page);
      }
    };

    window.addEventListener('fdh:navigate', handleNavigate as EventListener);
    return () => window.removeEventListener('fdh:navigate', handleNavigate as EventListener);
  }, []);

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
        {currentPage === 'staff' && <StaffPage />}
        {currentPage === 'ipd' && <IPDPage />}
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
      </div>
    </div>
  );
}


export default App;
