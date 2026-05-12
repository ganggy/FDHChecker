import { useEffect, useState } from 'react';
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
import './App.css';

function App() {
  const [currentPage, setCurrentPage] = useState<AppPage>('staff');

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
    { page: 'specific', icon: '🎯', label: 'กองทุนพิเศษ' },
    { page: 'monitor', icon: '📈', label: 'มอนิเตอร์พิเศษ' },
    { page: 'fsMonitor', icon: '💰', label: 'มอนิเตอร์ FS' },
    { page: 'mophDmht', icon: '🧪', label: 'MOPH DMHT' },
    { page: 'mophVaccine', icon: '💉', label: 'MOPH Vaccine' },
    { page: 'guide', icon: '📚', label: 'คู่มือกองทุน', soft: true },
  ];

  const toolNavGroups: Array<{ label: string; pages: AppPage[] }> = [
    { label: 'ส่งข้อมูล', pages: ['fdhImport', 'fdhClaimDetail', 'repstm', 'authenSync', 'preValidator'] },
    { label: 'ติดตาม', pages: ['workQueue', 'rejectTracking', 'repDeny'] },
    { label: 'บัญชี', pages: ['receivable', 'reconciliation', 'insuranceOverview', 'admin'] },
    { label: 'กองทุน/MOPH', pages: ['specific', 'monitor', 'fsMonitor', 'mophDmht', 'mophVaccine', 'guide'] },
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
              <div>{new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
            </div>
            <button
              className={`nav-btn nav-icon-btn ${currentPage === 'settings' ? 'active' : ''}`}
              onClick={() => setCurrentPage('settings')}
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
                  onClick={() => setCurrentPage(item.page)}
                >
                  <span className="nav-btn-icon">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="navbar-menu-group navbar-menu-group--tools">
            <div className="navbar-group-label">เครื่องมือ</div>
            <div className="navbar-tool-sections">
              {toolNavGroups.map((group) => (
                <div className="navbar-tool-section" key={group.label}>
                  <div className="navbar-tool-section-label">{group.label}</div>
                  <div className="navbar-nav navbar-nav--tools">
                    {group.pages.map((page) => {
                      const item = toolNavItemByPage.get(page);
                      if (!item) return null;
                      return (
                        <button
                          key={item.page}
                          className={`nav-btn ${item.soft ? 'nav-btn--soft' : ''} ${currentPage === item.page ? 'active' : ''}`}
                          onClick={() => setCurrentPage(item.page)}
                        >
                          <span className="nav-btn-icon">{item.icon}</span>
                          <span>{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
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
