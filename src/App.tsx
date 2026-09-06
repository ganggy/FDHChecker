import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { LoginPage } from './pages/LoginPage';
import { adminOnlyPages, menuLabelByPage, primaryNavItems, toolNavGroups, toolNavItems } from './config/menuDefinitions';
import { changePassword, fetchMe, logout, type AuthSession } from './services/authService';
import { LocalAiAssistant } from './components/LocalAiAssistant';
import { TableScrollNavigator } from './components/TableScrollNavigator';
import type { AppPage } from './utils/navigationState';
import businessRules from './config/business_rules.json';
import './App.css';
import './styles/mobile.css';

const lazyNamed = <T extends Record<string, unknown>, K extends keyof T>(
  loader: () => Promise<T>,
  name: K,
) => lazy(async () => ({ default: (await loader())[name] as ComponentType<Record<string, never>> }));

const StaffPage = lazyNamed(() => import('./pages/StaffPage'), 'StaffPage');
const IPDPage = lazyNamed(() => import('./pages/IPDPage'), 'IPDPage');
const IpdFdhExportPage = lazyNamed(() => import('./pages/IpdFdhExportPage'), 'IpdFdhExportPage');
const IpdClaimMonitorPage = lazyNamed(() => import('./pages/IpdClaimMonitorPage'), 'IpdClaimMonitorPage');
const CollaborationHubPage = lazy(() => import('./pages/CollaborationHubPage'));
const AiReportWorkspacePage = lazyNamed(() => import('./pages/AiReportWorkspacePage'), 'AiReportWorkspacePage');
const HospitalReportHubPage = lazyNamed(() => import('./pages/HospitalReportHubPage'), 'HospitalReportHubPage');
const AdminDashboard = lazyNamed(() => import('./pages/AdminDashboard'), 'AdminDashboard');
const FDHCheckerPage = lazyNamed(() => import('./pages/FDHCheckerPage'), 'FDHCheckerPage');
const FDHImportStatusPage = lazyNamed(() => import('./pages/FDHImportStatusPage'), 'FDHImportStatusPage');
const FdhClaimDetailImportPage = lazyNamed(() => import('./pages/FdhClaimDetailImportPage'), 'FdhClaimDetailImportPage');
const NhsoClosePage = lazyNamed(() => import('./pages/NhsoClosePage'), 'NhsoClosePage');
const RepStmImportPage = lazyNamed(() => import('./pages/RepStmImportPage'), 'RepStmImportPage');
const RepStmManagePage = lazyNamed(() => import('./pages/RepStmManagePage'), 'RepStmManagePage');
const SssExportPage = lazyNamed(() => import('./pages/SssExportPage'), 'SssExportPage');
const SssRepStmPage = lazyNamed(() => import('./pages/SssRepStmPage'), 'SssRepStmPage');
const AuthenSyncPage = lazyNamed(() => import('./pages/AuthenSyncPage'), 'AuthenSyncPage');
const ReceivablePage = lazyNamed(() => import('./pages/ReceivablePage'), 'ReceivablePage');
const InsuranceOverviewPage = lazyNamed(() => import('./pages/InsuranceOverviewPage'), 'InsuranceOverviewPage');
const UcOutsideCupPage = lazyNamed(() => import('./pages/UcOutsideCupPage'), 'UcOutsideCupPage');
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
const RevenueOpportunityPage = lazyNamed(() => import('./pages/RevenueOpportunityPage'), 'RevenueOpportunityPage');
const MophDmhtClaimPage = lazyNamed(() => import('./pages/MophDmhtClaimPage'), 'MophDmhtClaimPage');
const MophVaccineClaimPage = lazyNamed(() => import('./pages/MophVaccineClaimPage'), 'MophVaccineClaimPage');
const GuidePage = lazyNamed(() => import('./pages/GuidePage'), 'GuidePage');
const SettingsPage = lazyNamed(() => import('./pages/SettingsPage'), 'SettingsPage');
const MemberAdminPage = lazyNamed(() => import('./pages/MemberAdminPage'), 'MemberAdminPage');

function App() {
  const [requestedPage, setCurrentPage] = useState<AppPage>('staff');
  const [openNavGroup, setOpenNavGroup] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
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

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    const handleUnauthorized = () => {
      setAuthSession(null);
      setCurrentPage('staff');
    };
    window.addEventListener('fdh:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('fdh:unauthorized', handleUnauthorized);
  }, []);

  useEffect(() => {
    if (!authSession) return;
    void fetch('/api/ai/session/auto', { method: 'POST' }).catch(() => undefined);
  }, [authSession]);

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
    setMobileMenuOpen(false);
  };

  const handleLogout = async () => {
    await logout();
    setAuthSession(null);
    setCurrentPage('staff');
  };

  const closePasswordDialog = () => {
    if (passwordSaving) return;
    setPasswordDialogOpen(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
  };

  const handleChangePassword = async () => {
    setPasswordError('');
    if (newPassword.length < 12) {
      setPasswordError('รหัสผ่านใหม่ต้องมีอย่างน้อย 12 ตัวอักษร');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('ยืนยันรหัสผ่านใหม่ไม่ตรงกัน');
      return;
    }
    try {
      setPasswordSaving(true);
      await changePassword(currentPassword, newPassword);
      setPasswordDialogOpen(false);
      setAuthSession(null);
      setCurrentPage('staff');
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : 'เปลี่ยนรหัสผ่านไม่สำเร็จ');
    } finally {
      setPasswordSaving(false);
    }
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

  const mobilePagePriority: AppPage[] = ['collaboration', 'staff', 'ipd', 'ipdClaimMonitor'];
  const mobilePageRank = new Map(mobilePagePriority.map((page, index) => [page, index]));
  const mobilePrimaryItems = [...visiblePrimaryNavItems]
    .sort((left, right) => (mobilePageRank.get(left.page) ?? 99) - (mobilePageRank.get(right.page) ?? 99))
    .slice(0, 4);
  const mobilePrimaryPageSet = new Set(mobilePrimaryItems.map((item) => item.page));
  const mobileMoreActive = Boolean(currentPage && !mobilePrimaryPageSet.has(currentPage));

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
            <button className="nav-btn nav-icon-btn" onClick={() => setPasswordDialogOpen(true)} title="เปลี่ยนรหัสผ่าน">
              <span style={{ fontSize: '1.15rem' }}>🔑</span>
            </button>
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
            <button
              className="nav-btn nav-icon-btn mobile-menu-toggle"
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="เปิดเมนูทั้งหมด"
              aria-expanded={mobileMenuOpen}
            >
              <span aria-hidden="true">☰</span>
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

      {mobileMenuOpen && (
        <div className="mobile-nav-layer">
          <button
            className="mobile-nav-backdrop"
            type="button"
            aria-label="ปิดเมนู"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="mobile-nav-drawer" aria-label="เมนูหลัก">
            <header className="mobile-nav-header">
              <div className="mobile-nav-brand">
                <span className="mobile-nav-brand-icon">🏥</span>
                <div>
                  <strong>FDH Checker</strong>
                  <span>{hospitalLabel}{regionLabel ? ` · ${regionLabel}` : ''}</span>
                </div>
              </div>
              <button type="button" onClick={() => setMobileMenuOpen(false)} aria-label="ปิดเมนู">✕</button>
            </header>

            <div className="mobile-nav-profile">
              <span className="mobile-nav-avatar" aria-hidden="true">👤</span>
              <div>
                <strong>{authSession.user.display_name || authSession.user.username}</strong>
                <span>{authSession.user.group_name || (authSession.user.is_admin ? 'ผู้ดูแลระบบ' : 'ผู้ใช้งาน')}</span>
              </div>
            </div>

            <div className="mobile-nav-scroll">
              <section className="mobile-nav-section">
                <h2>งานประจำ</h2>
                <div className="mobile-nav-grid">
                  {visiblePrimaryNavItems.map((item) => (
                    <button
                      key={item.page}
                      type="button"
                      className={currentPage === item.page ? 'active' : ''}
                      onClick={() => goToPage(item.page)}
                    >
                      <span aria-hidden="true">{item.icon}</span>
                      <b>{item.label}</b>
                    </button>
                  ))}
                </div>
              </section>

              {visibleToolNavGroups.map((group) => (
                <section className="mobile-nav-section" key={group.label}>
                  <h2><span aria-hidden="true">{group.icon}</span>{group.label}</h2>
                  <div className="mobile-nav-list">
                    {group.pages.map((page) => {
                      const item = toolNavItemByPage.get(page);
                      if (!item) return null;
                      return (
                        <button
                          key={item.page}
                          type="button"
                          className={currentPage === item.page ? 'active' : ''}
                          onClick={() => goToPage(item.page)}
                        >
                          <span aria-hidden="true">{item.icon}</span>
                          <b>{item.label}</b>
                          <span aria-hidden="true">›</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>

            <footer className="mobile-nav-actions">
              <button type="button" onClick={() => { setMobileMenuOpen(false); setPasswordDialogOpen(true); }}>🔑 เปลี่ยนรหัสผ่าน</button>
              {canOpenPage('settings') && <button type="button" onClick={() => goToPage('settings')}>⚙️ ตั้งค่า</button>}
              <button type="button" className="is-danger" onClick={() => void handleLogout()}>⏻ ออกจากระบบ</button>
            </footer>
          </aside>
        </div>
      )}

      <div className="app-main">
        <Suspense fallback={<div className="page-loading" role="status">กำลังโหลดหน้าจอ...</div>}>
        {currentPage === 'staff' && <StaffPage />}
        {currentPage === 'ipd' && <IPDPage />}
        {currentPage === 'ipdExport' && <IpdFdhExportPage />}
        {currentPage === 'ipdClaimMonitor' && <IpdClaimMonitorPage />}
        {currentPage === 'collaboration' && <CollaborationHubPage currentUser={authSession.user} />}
        {currentPage === 'aiReports' && <AiReportWorkspacePage />}
        {currentPage === 'hospitalReports' && <HospitalReportHubPage />}
        {currentPage === 'fdh' && <FDHCheckerPage />}
        {currentPage === 'fdhImport' && <FDHImportStatusPage />}
        {currentPage === 'fdhClaimDetail' && <FdhClaimDetailImportPage />}
        {currentPage === 'nhsoClose' && <NhsoClosePage />}
        {currentPage === 'repstm' && <RepStmImportPage />}
        {currentPage === 'repstmManage' && <RepStmManagePage />}
        {currentPage === 'sssExport' && <SssExportPage />}
        {currentPage === 'sssRepStm' && <SssRepStmPage />}
        {currentPage === 'authenSync' && <AuthenSyncPage />}
        {currentPage === 'receivable' && <ReceivablePage />}
        {currentPage === 'insuranceOverview' && <InsuranceOverviewPage />}
        {currentPage === 'ucOutsideCup' && <UcOutsideCupPage />}
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
        {currentPage === 'revenueOpportunity' && <RevenueOpportunityPage />}
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
      <nav className="mobile-bottom-nav" aria-label="เมนูลัด">
        {mobilePrimaryItems.map((item) => (
          <button
            key={item.page}
            type="button"
            className={currentPage === item.page ? 'active' : ''}
            onClick={() => goToPage(item.page)}
            aria-current={currentPage === item.page ? 'page' : undefined}
          >
            <span aria-hidden="true">{item.icon}</span>
            <b>{item.label}</b>
          </button>
        ))}
        <button
          type="button"
          className={mobileMoreActive ? 'active' : ''}
          onClick={() => setMobileMenuOpen(true)}
          aria-label={`เมนูทั้งหมด หน้าปัจจุบัน ${currentPage ? menuLabelByPage[currentPage] || '' : ''}`}
        >
          <span aria-hidden="true">☰</span>
          <b>เมนู</b>
        </button>
      </nav>
      {passwordDialogOpen && (
        <div className="password-dialog-backdrop" role="presentation" onMouseDown={closePasswordDialog}>
          <section className="password-dialog" role="dialog" aria-modal="true" aria-labelledby="password-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2 id="password-dialog-title">เปลี่ยนรหัสผ่าน</h2>
                <p>ระบบจะออกจากทุกอุปกรณ์หลังเปลี่ยนสำเร็จ</p>
              </div>
              <button type="button" onClick={closePasswordDialog} aria-label="ปิด">✕</button>
            </header>
            <div className="password-dialog-body">
              <label>รหัสผ่านปัจจุบัน<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
              <label>รหัสผ่านใหม่<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
              <label>ยืนยันรหัสผ่านใหม่<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
              <small>อย่างน้อย 12 ตัวอักษร และต้องไม่ซ้ำกับรหัสผ่านเดิม</small>
              {passwordError && <div className="alert alert-danger">{passwordError}</div>}
            </div>
            <footer>
              <button type="button" className="btn" onClick={closePasswordDialog} disabled={passwordSaving}>ยกเลิก</button>
              <button type="button" className="btn btn-primary" onClick={() => void handleChangePassword()} disabled={passwordSaving || !currentPassword || !newPassword || !confirmPassword}>{passwordSaving ? 'กำลังบันทึก…' : 'เปลี่ยนรหัสผ่าน'}</button>
            </footer>
          </section>
        </div>
      )}
      {!mobileMenuOpen && currentPage !== 'aiReports' && (
        <LocalAiAssistant avoidBottomActionBar={currentPage === 'fdh' || currentPage === 'ipdExport'} />
      )}
      {!mobileMenuOpen && <TableScrollNavigator />}
    </div>
  );
}


export default App;
