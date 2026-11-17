import { useState } from 'react';
import { StmZeroAuditPanel } from '../components/StmZeroAuditPanel';

export default function StmZeroAuditPage() {
  const [mode, setMode] = useState<'stm' | 'rep-sheet-zero'>('stm');

  return (
    <main className="stm-zero-page">
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          padding: '0.75rem 1.5rem 0',
          maxWidth: '1440px',
          margin: '0 auto',
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={() => setMode('stm')}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: '8px',
            border: '1px solid #cbd5e1',
            fontWeight: 600,
            cursor: 'pointer',
            background: mode === 'stm' ? '#2563eb' : '#f8fafc',
            color: mode === 'stm' ? '#ffffff' : '#334155',
          }}
        >
          🔎 ตรวจ STM ยอด 0
        </button>
        <button
          type="button"
          onClick={() => setMode('rep-sheet-zero')}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: '8px',
            border: '1px solid #cbd5e1',
            fontWeight: 600,
            cursor: 'pointer',
            background: mode === 'rep-sheet-zero' ? '#2563eb' : '#f8fafc',
            color: mode === 'rep-sheet-zero' ? '#ffffff' : '#334155',
          }}
        >
          📄 ตรวจ REP Data Sheet 0
        </button>
      </div>
      <StmZeroAuditPanel mode={mode} />
    </main>
  );
}
