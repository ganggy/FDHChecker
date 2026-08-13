import { useState } from 'react';
import { formatLocalDateDaysAgo, formatLocalDateInput } from '../utils/dateUtils';

interface ClopidogrelRecord {
  vn: number;
  hn: string;
  ptname: string;
  vstdate: string;
  pttypename: string;
  department: string;
  clinic: string;
  drugname: string;
  qty: number;
  money: number;
  doctorname: string;
  status_eclaim: string;
  compensated: number;
  rep: string;
}

export function ClopidogrelPage() {
  const [startDate, setStartDate] = useState(
    formatLocalDateDaysAgo(30)
  );
  const [endDate, setEndDate] = useState(formatLocalDateInput());
  const [records, setRecords] = useState<ClopidogrelRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/clopidogrel?startDate=${startDate}&endDate=${endDate}`
      );
      if (!response.ok) throw new Error('Failed to fetch Clopidogrel data');
      const result = await response.json();
      setRecords(result?.data || []);
    } catch (err) {
      setError(typeof err === 'string' ? err : (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate summary
  const summary = records.reduce(
    (acc, record) => ({
      totalCases: acc.totalCases + 1,
      totalMoney: acc.totalMoney + (record.money || 0),
      totalCompensated: acc.totalCompensated + (record.compensated || 0),
      totalQty: acc.totalQty + (record.qty || 0),
    }),
    { totalCases: 0, totalMoney: 0, totalCompensated: 0, totalQty: 0 }
  );

  const totalRecords = records.length;

  return (
    <div style={{ padding: '20px', width: '100%', maxWidth: 'var(--content-max)', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '30px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 800, marginBottom: '10px' }}>
          💊 รายชื่อผู้ใช้ยา Clopidogrel
        </h1>
        <p style={{ color: '#666', fontSize: '14px' }}>
          ตรวจสอบและวิเคราะห์ข้อมูลผู้ป่วยที่ใช้ยา Clopidogrel
        </p>
      </div>

      {/* Summary Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '15px',
          marginBottom: '30px',
        }}
      >
        <div style={{ padding: '20px', background: '#e3f2fd', borderRadius: '8px', borderLeft: '4px solid #2196f3' }}>
          <div style={{ fontSize: '12px', color: '#1976d2', fontWeight: 700, marginBottom: '8px' }}>
            📊 จำนวนเคส
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#1976d2' }}>
            {summary.totalCases.toLocaleString()}
          </div>
          <div style={{ fontSize: '11px', color: '#666', marginTop: '8px' }}>
            ทั้งหมด {totalRecords.toLocaleString()} เคส
          </div>
        </div>

        <div style={{ padding: '20px', background: '#f3e5f5', borderRadius: '8px', borderLeft: '4px solid #9c27b0' }}>
          <div style={{ fontSize: '12px', color: '#6a1b9a', fontWeight: 700, marginBottom: '8px' }}>
            💰 รายรับทั้งหมด
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#6a1b9a' }}>
            ฿{summary.totalMoney.toLocaleString()}
          </div>
          <div style={{ fontSize: '11px', color: '#666', marginTop: '8px' }}>
            เบิกจากระบบ
          </div>
        </div>

        <div style={{ padding: '20px', background: '#fff3e0', borderRadius: '8px', borderLeft: '4px solid #f57c00' }}>
          <div style={{ fontSize: '12px', color: '#e65100', fontWeight: 700, marginBottom: '8px' }}>
            💸 ได้รับอนุมัติ
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#e65100' }}>
            ฿{summary.totalCompensated.toLocaleString()}
          </div>
          <div style={{ fontSize: '11px', color: '#666', marginTop: '8px' }}>
            ผ่านการอนุมัติแล้ว
          </div>
        </div>

        <div style={{ padding: '20px', background: '#e8f5e9', borderRadius: '8px', borderLeft: '4px solid #2e7d32' }}>
          <div style={{ fontSize: '12px', color: '#1b5e20', fontWeight: 700, marginBottom: '8px' }}>
            📦 จำนวนหน่วยยา
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#1b5e20' }}>
            {summary.totalQty.toLocaleString()}
          </div>
          <div style={{ fontSize: '11px', color: '#666', marginTop: '8px' }}>
            หน่วยทั้งหมด
          </div>
        </div>
      </div>

      {/* Search Section */}
      <div
        style={{
          padding: '20px',
          background: '#f5f5f5',
          borderRadius: '8px',
          marginBottom: '30px',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '15px',
            alignItems: 'flex-end',
          }}
        >
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '5px' }}>
              📅 วันเริ่มต้น:
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '14px',
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '5px' }}>
              📅 วันสิ้นสุด:
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '14px',
              }}
            />
          </div>

          <button
            onClick={handleSearch}
            style={{
              padding: '10px 20px',
              background: '#2196f3',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '14px',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#1976d2')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#2196f3')}
          >
            🔍 ค้นหา
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div
          style={{
            padding: '15px',
            background: '#ffebee',
            color: '#c62828',
            borderRadius: '4px',
            marginBottom: '20px',
            fontSize: '14px',
          }}
        >
          ⚠️ เกิดข้อผิดพลาด: {error}
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
          ⏳ กำลังโหลดข้อมูล...
        </div>
      )}

      {/* Data Table */}
      {!isLoading && records.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              background: 'white',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
              borderRadius: '8px',
              overflow: 'hidden',
            }}
          >
            <thead style={{ background: '#2196f3', color: 'white' }}>
              <tr>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600 }}>VN</th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600 }}>HN</th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600 }}>ชื่อ-สกุล</th>
                <th style={{ padding: '12px', textAlign: 'center', fontWeight: 600 }}>📅 วันที่</th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600 }}>สิทธิ์</th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600 }}>แผนก</th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600 }}>คลินิก</th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600 }}>ชื่อยา</th>
                <th style={{ padding: '12px', textAlign: 'center', fontWeight: 600 }}>หน่วยยา</th>
                <th style={{ padding: '12px', textAlign: 'right', fontWeight: 600 }}>ราคา</th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600 }}>สถานะ e-Claim</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record, idx) => (
                <tr
                  key={idx}
                  style={{
                    borderBottom: '1px solid #e0e0e0',
                    background: idx % 2 === 0 ? '#ffffff' : '#f9f9f9',
                  }}
                >
                  <td style={{ padding: '12px' }}>{record.vn}</td>
                  <td style={{ padding: '12px' }}>{record.hn}</td>
                  <td style={{ padding: '12px', fontWeight: 600 }}>{record.ptname}</td>
                  <td style={{ padding: '12px', textAlign: 'center', fontSize: '12px' }}>
                    {new Date(record.vstdate).toLocaleDateString('th-TH')}
                  </td>
                  <td style={{ padding: '12px', fontSize: '12px' }}>{record.pttypename}</td>
                  <td style={{ padding: '12px', fontSize: '12px' }}>{record.department}</td>
                  <td style={{ padding: '12px', fontSize: '12px' }}>{record.clinic}</td>
                  <td style={{ padding: '12px', fontSize: '12px', fontWeight: 600 }}>{record.drugname}</td>
                  <td style={{ padding: '12px', textAlign: 'center', fontWeight: 600 }}>
                    {record.qty}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right', fontWeight: 800, color: '#1976d2' }}>
                    ฿{record.money?.toLocaleString() || '0'}
                  </td>
                  <td style={{ padding: '12px', fontSize: '11px' }}>
                    <span
                      style={{
                        padding: '4px 8px',
                        background: record.status_eclaim === 'NHSO :: ได้ใบ Invoice แล้ว' ? '#c8e6c9' : '#ffccbc',
                        borderRadius: '4px',
                        fontWeight: 600,
                      }}
                    >
                      {record.status_eclaim || '-'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && records.length === 0 && !error && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#999', fontSize: '16px' }}>
          📭 ไม่มีข้อมูล กรุณาเลือกช่วงวันที่และค้นหา
        </div>
      )}
    </div>
  );
}
