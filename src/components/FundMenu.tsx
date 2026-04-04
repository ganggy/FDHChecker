import React from 'react';

interface FundMenuProps {
  funds: { id: string; name: string }[];
  selected: string;
  onSelect: (id: string) => void;
}

export const FundMenu: React.FC<FundMenuProps> = ({ funds, selected, onSelect }) => (
  <nav style={{ marginBottom: 20 }}>
    {/* ปุ่มทั้งหมด */}
    <button
      onClick={() => onSelect('')}
      style={{
        marginRight: 8,
        padding: '8px 16px',
        background: selected === '' ? '#1976d2' : '#f0f0f0',
        color: selected === '' ? '#fff' : '#222',
        border: 'none',
        borderRadius: 4,
        cursor: 'pointer',
        fontWeight: selected === '' ? 'bold' : 'normal',
      }}
    >
      ทั้งหมด
    </button>
    {funds.map(fund => (
      <button
        key={fund.id}
        onClick={() => onSelect(fund.id)}
        style={{
          marginRight: 8,
          padding: '8px 16px',
          background: selected === fund.id ? '#1976d2' : '#f0f0f0',
          color: selected === fund.id ? '#fff' : '#222',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        {fund.name}
      </button>
    ))}
  </nav>
);
