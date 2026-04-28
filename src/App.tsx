import { useEffect, useState } from 'react';
import { StaffPage } from './pages/StaffPage';
import { IPDPage } from './pages/IPDPage';
import { AdminDashboard } from './pages/AdminDashboard';
import { FDHCheckerPage } from './pages/FDHCheckerPage';
import { FDHImportStatusPage } from './pages/FDHImportStatusPage';
import { NhsoClosePage } from './pages/NhsoClosePage';
import { RepStmImportPage } from './pages/RepStmImportPage';
import { ReceivablePage } from './pages/ReceivablePage';
import { RepDenyPage } from './pages/RepDenyPage';
import { SpecificFundPage } from './pages/SpecificFundPage';
import { SpecialMonitorPage } from './pages/SpecialMonitorPage';
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
    { page: 'fdhImport', icon: '📥', label: 'นำเข้าสถานะ FDH' },
    { page: 'repstm', icon: '🧾', label: 'นำเข้า REP/STM' },
    { page: 'receivable', icon: '💼', label: 'บัญชีลูกหนี้' },
    { page: 'repDeny', icon: '⚠️', label: 'ติด C/Deny' },
    { page: 'admin', icon: '📊', label: 'แดชบอร์ดสรุป' },
    { page: 'specific', icon: '🎯', label: 'รายกองทุน (พิเศษ)' },
    { page: 'monitor', icon: '📈', label: 'รายการมอนิเตอร์พิเศษ' },
  ];
  const guideNavItem: { page: AppPage; icon: string; label: string; soft?: boolean } = {
    page: 'guide',
    icon: '📚',
    label: 'คู่มือเงื่อนไขกองทุน',
    soft: true,
  };

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
            <div className="navbar-nav">
              {toolNavItems.map((item) => (
                <button
                  key={item.page}
                  className={`nav-btn ${item.soft ? 'nav-btn--soft' : ''} ${currentPage === item.page ? 'active' : ''}`}
                  onClick={() => setCurrentPage(item.page)}
                >
                  <span className="nav-btn-icon">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
            <div className="navbar-guide-rail">
              <button
                className={`nav-btn nav-btn--soft nav-btn--guide ${currentPage === guideNavItem.page ? 'active' : ''}`}
                onClick={() => setCurrentPage(guideNavItem.page)}
              >
                <span className="nav-btn-icon">{guideNavItem.icon}</span>
                <span>{guideNavItem.label}</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="app-main">
        {currentPage === 'staff' && <StaffPage />}
        {currentPage === 'ipd' && <IPDPage />}
        {currentPage === 'fdh' && <FDHCheckerPage />}
        {currentPage === 'fdhImport' && <FDHImportStatusPage />}
        {currentPage === 'nhsoClose' && <NhsoClosePage />}
        {currentPage === 'repstm' && <RepStmImportPage />}
        {currentPage === 'receivable' && <ReceivablePage />}
        {currentPage === 'repDeny' && <RepDenyPage />}
        {currentPage === 'admin' && <AdminDashboard />}
        {currentPage === 'specific' && <SpecificFundPage />}
        {currentPage === 'monitor' && <SpecialMonitorPage />}
        {currentPage === 'guide' && <GuidePage />}
        {currentPage === 'settings' && <SettingsPage />}
      </div>
    </div>
  );
}


export default App;
