---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "src/components/Navbar.tsx"
source_hash: "026636fd96ffb1cdb15043561b0468e4ec1dc20f4e52d910823210908b3e1529"
managed_by: "sync-ksp-vault"
---
# Navbar.tsx

> Source: `src/components/Navbar.tsx`
> SHA-256: `026636fd96ffb1cdb15043561b0468e4ec1dc20f4e52d910823210908b3e1529`

````tsx
import React from 'react';

interface NavbarProps {
  currentPage: 'staff' | 'admin';
  onNavigate: (page: 'staff' | 'admin') => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentPage, onNavigate }) => {
  return (
    <nav
      style={{
        background: '#1976d2',
        color: '#fff',
        padding: '12px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 32,
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      }}
    >
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 'bold' }}>
        🏥 HOSxP Fund Check System
      </h1>

      <div style={{ flex: 1 }}></div>

      <button
        onClick={() => onNavigate('staff')}
        style={{
          background: currentPage === 'staff' ? '#fff' : 'rgba(255,255,255,0.2)',
          color: currentPage === 'staff' ? '#1976d2' : '#fff',
          border: 'none',
          padding: '8px 16px',
          borderRadius: 4,
          cursor: 'pointer',
          fontWeight: 'bold',
          transition: 'all 0.2s',
        }}
      >
        👤 หน้างานเจ้าหน้าที่
      </button>

      <button
        onClick={() => onNavigate('admin')}
        style={{
          background: currentPage === 'admin' ? '#fff' : 'rgba(255,255,255,0.2)',
          color: currentPage === 'admin' ? '#1976d2' : '#fff',
          border: 'none',
          padding: '8px 16px',
          borderRadius: 4,
          cursor: 'pointer',
          fontWeight: 'bold',
          transition: 'all 0.2s',
        }}
      >
        📊 แดชบอร์ดผู้บริหาร
      </button>
    </nav>
  );
};

````
