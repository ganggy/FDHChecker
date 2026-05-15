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
import { RepDenyPage } from './pages/RepDenyPage';
import { AuthenSyncPage } from './pages/AuthenSyncPage';
import PreSubmitValidatorPage from './pages/PreSubmitValidatorPage';
import WorkQueuePage from './pages/WorkQueuePage';
import RejectedClaimTrackingPage from './pages/RejectedClaimTrackingPage';
import { SpecificFundPage } from './pages/SpecificFundPage';
import { SpecialMonitorPage } from './pages/SpecialMonitorPage';
import { FsMonitorPage } from './pages/FsMonitorPage';
import { MophDmhtClaimPage } from './pages/MophDmhtClaimPage';
import { MophVaccineClaimPage } from './pages/MophVaccineClaimPage';
import { GuidePage } from './pages/GuidePage';
import { SettingsPage } from './pages/SettingsPage';
import type { AppPage } from './utils/navigationState';
import businessRules from './config/business_rules.json';
import './App.css';

function App() {
  const [currentPage, setCurrentPage] = useState<AppPage>('staff');
  const [openNavGroup, setOpenNavGroup] = useState<string | null>(null);
  const navMenuRef = useRef<HTMLDivElement | null>(null);
  const siteSettings = (businessRules as { site_settings?: { hospital_name?: string; nhso_region?: string } }).site_settings || {};
  const hospitalLabel = siteSettings.hospital_name || 'FDH Checker';
  const regionLabel = siteSettings.nhso_region ? `เขต ${siteSettings.nhso_region}` : '';

  const primaryNavItems: Array<{ page: AppPage; icon: string; label: string; divider?: boolean }> = [
    { page: 'staff', icon: '📋', label: 'รายการ OPD' },
    { page: 'ipd', icon: '🛏️', label: 'รายการ IPD' },
    { page: 'fdh', icon: '🔍', label: 'ตรวจสอบเบิก FDH', divider: true },
    { page: 'nhsoClose', icon: '🔐', label: 'ปิดสิทธิ NHSO' },
  ];

  const toolNavItems: Array<{ page: AppPage; icon: string; label: string; soft?: boolean }> = [
    { page: 'fdhImport', icon: '📥', label: 'สถานะ FDH' },
    { page: 'fdhClaimDetail', icon: '📄', label: 'ClaimDetail FDH' },
    { page: 'repstm', icon: '🧾', label: 'REP/STM' },
    { page: 'authenSync', icon: '🪪', label: 'Authen Code' },
    { page: 'preValidator', icon: '✅', label: 'Pre-submit' },
    { page: 'workQueue', icon: '📋', label: 'คิวงาน' },
    { page: 'rejectTracking', icon: '🔴', label: 'ติดตาม Reject' },
    { page: 'receivable', icon: '💼', label: 'บัญชีลูกหนี้' },
    { page: 'reconciliation', icon: '🔄', label: 'กระทบยอด REP/STM' },
    { page: 'insuranceOverview', icon: '🧭', label: 'ภาพรวมประกัน' },
    { page: 'repDeny', icon: '⚠️', label: 'ติด C/Deny' },
    { page: 'admin', icon: '📊', label: 'Dashboard' },
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

  const toolNavGroups: Array<{ label: string; icon: string; pages: AppPage[] }> = [
    { label: 'ส่งข้อมูล', icon: '📤', pages: ['fdhImport', 'fdhClaimDetail', 'repstm', 'authenSync', 'preValidator'] },
    { label: 'ติดตาม', icon: '🔎', pages: ['workQueue', 'rejectTracking', 'repDeny'] },
    { label: 'บัญชี', icon: '💼', pages: ['receivable', 'reconciliation', 'insuranceOverview', 'admin'] },
    { label: 'FDH/e-Claim', icon: '🏥', pages: ['fundFdh', 'monitor', 'fsMonitor'] },
    { label: '43 แฟ้ม', icon: '🗂️', pages: ['fund43'] },
    { label: 'MOPH Claim', icon: '🧪', pages: ['mophDmht', 'mophVaccine'] },
    { label: 'KTB/NTIP/อื่นๆ', icon: '🏦', pages: ['fundKtb', 'fundOther', 'specific', 'guide'] },
  ];

  const toolNavItemByPage = new Map(toolNavItems.map((item) => [item.page, item]));

  useEffect(() => {
    const handleNavigate = (event: Event) => {
      const customEvent = event as CustomEvent<{ page?: AppPage }>;
      if (customEvent.detail?.page) {
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
    setCurrentPage(page);
    setOpenNavGroup(null);
  };

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
            <div className="navbar-time navbar-meta-card">
              <div style={{ fontWeight: 700, color: 'rgba(255,255,255,0.94)' }}>ระบบตรวจสอบเบิกจ่าย v1.0</div>
              <div>{hospitalLabel}{regionLabel ? ` · ${regionLabel}` : ''}</div>
              <div>{new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
            </div>
            <button
              className={`nav-btn nav-icon-btn ${currentPage === 'settings' ? 'active' : ''}`}
              onClick={() => goToPage('settings')}
              title="ตั้งค่าระบบ"
            >
              <span style={{ fontSize: '1.4rem' }}>⚙️</span>
            </button>
          </div>
        </div>

        <div className="navbar-menu-shell">
          <div className="navbar-menu-group">
            <div className="navbar-group-label">งานประจำ</div>
            <div className="navbar-nav">
              {primaryNavItems.map((item) => (
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
              {toolNavGroups.map((group) => {
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
        {currentPage === 'guide' && <GuidePage />}
        {currentPage === 'settings' && <SettingsPage />}
      </div>
    </div>
  );
}


export default App;
