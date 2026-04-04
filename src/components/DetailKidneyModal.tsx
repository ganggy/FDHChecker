import React, { useState } from 'react';
import type { KidneyMonitorRecord } from '../mockKidneyData';
import { DetailCategoryModal } from './DetailCategoryModal';

interface DetailKidneyModalProps {
  record: KidneyMonitorRecord | null;
  onClose: () => void;
}

export const DetailKidneyModal: React.FC<DetailKidneyModalProps> = ({ record, onClose }) => {
  const [selectedCategory, setSelectedCategory] = useState<'drugs' | 'labs' | 'service' | 'otherService' | null>(null);
  if (!record) return null;

  const insuranceColors: { [key: string]: { bg: string; border: string; text: string } } = {
    'UCS+SSS': { bg: '#e3f2fd', border: '#2196f3', text: '#1976d2' },
    'OFC+LGO': { bg: '#f3e5f5', border: '#9c27b0', text: '#7b1fa2' },
    'UC-EPO': { bg: '#fff3e0', border: '#ff9800', text: '#e65100' },
  };

  const colors = insuranceColors[record.insuranceType] || { bg: '#f5f5f5', border: '#999', text: '#333' };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '12px',
          maxWidth: '600px',
          width: '90%',
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '20px', background: colors.bg, borderBottom: `3px solid ${colors.border}`, borderTopLeftRadius: '12px', borderTopRightRadius: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ margin: '0 0 8px 0', color: colors.text, fontSize: '18px', fontWeight: 800 }}>
                🏥 รายละเอียดการล้างไต
              </h2>
              <p style={{ margin: 0, color: '#666', fontSize: '14px' }}>
                {record.patientName} (HN: {record.hn})
              </p>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '24px',
                cursor: 'pointer',
                color: '#666',
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: '20px' }}>
          {/* Patient Info */}
          <div style={{ marginBottom: '20px', padding: '15px', background: '#f9f9f9', borderRadius: '8px', borderLeft: `4px solid ${colors.border}` }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', fontSize: '14px' }}>
              <div>
                <div style={{ color: '#666', fontSize: '12px', marginBottom: '4px' }}>บัญชีผู้ป่วย (HN)</div>
                <div style={{ fontWeight: 600, fontSize: '16px' }}>{record.hn}</div>
              </div>
              <div>
                <div style={{ color: '#666', fontSize: '12px', marginBottom: '4px' }}>เลขที่ผู้มาใช้บริการ (VN)</div>
                <div style={{ fontWeight: 600, fontSize: '16px' }}>{record.vn}</div>
              </div>
              <div>
                <div style={{ color: '#666', fontSize: '12px', marginBottom: '4px' }}>ประเภทสิทธิ์</div>
                <div style={{ fontWeight: 600, fontSize: '16px', color: colors.text }}>
                  {record.insuranceType}
                </div>
              </div>
              <div>
                <div style={{ color: '#666', fontSize: '12px', marginBottom: '4px' }}>วันที่ใช้บริการ</div>
                <div style={{ fontWeight: 600, fontSize: '16px' }}>
                  {new Date(record.serviceDate).toLocaleDateString('th-TH', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </div>
              </div>
            </div>
          </div>          {/* Category Summary Cards */}
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ margin: '0 0 15px 0', color: '#333', fontSize: '14px', fontWeight: 700 }}>
              📊 สรุปกำไรขาดทุนแต่ละหมวด
            </h3>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>              {/* Drugs Card */}
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedCategory('drugs');
                }}
                style={{
                  padding: '15px',
                  background: '#f0f4ff',
                  borderRadius: '8px',
                  borderLeft: '4px solid #2196f3',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
                } as React.CSSProperties}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.boxShadow = '0 4px 12px rgba(33, 150, 243, 0.2)';
                  el.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.1)';
                  el.style.transform = 'translateY(0)';
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#2196f3', marginBottom: '6px' }}>💊 ยา</div>
                <div style={{ fontSize: '16px', fontWeight: 800, color: '#2196f3', marginBottom: '6px' }}>
                  ฿{record.drugTotalSale.toLocaleString()}
                </div>
                <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>
                  ทุน: ฿{record.drugTotalCost.toLocaleString()}
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: record.drugTotalSale - record.drugTotalCost > 0 ? '#4caf50' : '#f44336',
                  }}
                >
                  กำไร: ฿{(record.drugTotalSale - record.drugTotalCost).toLocaleString()}
                </div>
                <div style={{ fontSize: '10px', color: '#999', marginTop: '6px' }}>คลิกเพื่อดูรายละเอียด →</div>
              </div>              {/* Labs Card */}
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedCategory('labs');
                }}
                style={{
                  padding: '15px',
                  background: '#f0fdf4',
                  borderRadius: '8px',
                  borderLeft: '4px solid #4caf50',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
                } as React.CSSProperties}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.boxShadow = '0 4px 12px rgba(76, 175, 80, 0.2)';
                  el.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.1)';
                  el.style.transform = 'translateY(0)';
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#4caf50', marginBottom: '6px' }}>🔬 แลป</div>
                <div style={{ fontSize: '16px', fontWeight: 800, color: '#4caf50', marginBottom: '6px' }}>
                  ฿{record.labTotalSale.toLocaleString()}
                </div>
                <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>
                  ทุน: ฿{record.labTotalCost.toLocaleString()}
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: record.labTotalSale - record.labTotalCost > 0 ? '#4caf50' : '#f44336',
                  }}
                >
                  กำไร: ฿{(record.labTotalSale - record.labTotalCost).toLocaleString()}
                </div>
                <div style={{ fontSize: '10px', color: '#999', marginTop: '6px' }}>คลิกเพื่อดูรายละเอียด →</div>
              </div>              {/* Service Card */}
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedCategory('service');
                }}
                style={{
                  padding: '15px',
                  background: '#fff3e0',
                  borderRadius: '8px',
                  borderLeft: '4px solid #ff9800',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
                } as React.CSSProperties}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.boxShadow = '0 4px 12px rgba(255, 152, 0, 0.2)';
                  el.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.1)';
                  el.style.transform = 'translateY(0)';
                }}
              >                <div style={{ fontSize: '12px', fontWeight: 600, color: '#ff9800', marginBottom: '6px' }}>💉 บริการล้างไต</div>
                <div style={{ fontSize: '16px', fontWeight: 800, color: '#ff9800', marginBottom: '6px' }}>
                  ฿{record.dialysisFee.toLocaleString()}
                </div>
                <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>
                  ทุน: ฿{record.dialysisCost.toLocaleString()}
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: record.dialysisFee - record.dialysisCost > 0 ? '#4caf50' : '#f44336',
                  }}
                >
                  กำไร: ฿{(record.dialysisFee - record.dialysisCost).toLocaleString()}
                </div>
                <div style={{ fontSize: '10px', color: '#999', marginTop: '6px' }}>คลิกเพื่อดูรายละเอียด →</div>
              </div>

              {/* Other Services Card - แสดงเฉพาะเมื่อมีข้อมูล */}
              {((record.otherServiceFee ?? 0) > 0 || (record.otherServiceCost ?? 0) > 0) && (
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedCategory('otherService');
                  }}
                  style={{
                    padding: '15px',
                    background: '#f3e5f5',
                    borderRadius: '8px',
                    borderLeft: '4px solid #9c27b0',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
                  } as React.CSSProperties}
                  onMouseEnter={(e) => {
                    const el = e.currentTarget as HTMLElement;
                    el.style.boxShadow = '0 4px 12px rgba(156, 39, 176, 0.2)';
                    el.style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget as HTMLElement;
                    el.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.1)';
                    el.style.transform = 'translateY(0)';
                  }}
                >
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#9c27b0', marginBottom: '6px' }}>🏥 บริการอื่น</div>
                  <div style={{ fontSize: '16px', fontWeight: 800, color: '#9c27b0', marginBottom: '6px' }}>
                    ฿{(record.otherServiceFee ?? 0).toLocaleString()}
                  </div>
                  <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>
                    ทุน: ฿{(record.otherServiceCost ?? 0).toLocaleString()}
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: (record.otherServiceFee ?? 0) - (record.otherServiceCost ?? 0) > 0 ? '#4caf50' : '#f44336',
                    }}
                  >
                    กำไร: ฿{((record.otherServiceFee ?? 0) - (record.otherServiceCost ?? 0)).toLocaleString()}
                  </div>
                  <div style={{ fontSize: '10px', color: '#999', marginTop: '6px' }}>คลิกเพื่อดูรายละเอียด →</div>
                </div>
              )}
            </div>
          </div>

          {/* Summary */}
          <div style={{ marginBottom: '20px', padding: '15px', background: colors.bg, borderRadius: '8px', borderLeft: `4px solid ${colors.border}` }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
              <div>
                <div style={{ color: '#666', fontSize: '12px', marginBottom: '4px' }}>รวมค่าใช้ทั้งหมด</div>
                <div style={{ fontWeight: 700, fontSize: '18px', color: colors.text }}>
                  ฿{record.costTotal.toLocaleString()}
                </div>
              </div>
              <div>
                <div style={{ color: '#666', fontSize: '12px', marginBottom: '4px' }}>รายได้ที่ได้รับ</div>
                <div style={{ fontWeight: 700, fontSize: '18px', color: colors.text }}>
                  ฿{record.revenue.toLocaleString()}
                </div>
              </div>
              <div>
                <div style={{ color: '#666', fontSize: '12px', marginBottom: '4px' }}>กำไรสุทธิ</div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: '18px',
                    color: record.profit > 0 ? '#4caf50' : '#f44336',
                  }}
                >
                  ฿{record.profit.toLocaleString()}
                </div>
              </div>
              <div>
                <div style={{ color: '#666', fontSize: '12px', marginBottom: '4px' }}>Profit Margin</div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: '18px',
                    color: record.profitMargin > 20 ? '#4caf50' : record.profitMargin > 10 ? '#ff9800' : '#f44336',
                  }}
                >
                  {record.profitMargin.toFixed(2)}%
                </div>
              </div>
            </div>
          </div>

          {/* Insurance Details */}
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ margin: '0 0 12px 0', color: '#333', fontSize: '14px', fontWeight: 700 }}>
              🏛️ ข้อมูลสิทธิ์
            </h3>
            <div style={{ padding: '12px', background: '#f5f5f5', borderRadius: '6px', fontSize: '13px', lineHeight: '1.6' }}>
              {record.insuranceType === 'UCS+SSS' && (
                <>
                  <div>
                    <strong>สิทธิ์:</strong> UCS + SSS
                  </div>
                  <div>
                    <strong>รวมค่าบริการ:</strong> 1,500 บาท
                  </div>
                  <div>
                    <strong>เบิกหน่วยไต:</strong> 1,380 บาท (รวมทั้งค่าบริการ)
                  </div>
                  <div>
                    <strong>กำไร (Hospital):</strong> Revenue 1,500 - Cost {record.costTotal} = {record.profit} บาท
                  </div>
                </>
              )}
              {record.insuranceType === 'OFC+LGO' && (
                <>
                  <div>
                    <strong>สิทธิ์:</strong> OFC + LGO
                  </div>
                  <div>
                    <strong>รวมค่าบริการ:</strong> 2,000 บาท
                  </div>
                  <div>
                    <strong>เบิกหน่วยไต:</strong> 1,380 บาท (รวมทั้งค่าบริการ)
                  </div>
                  <div>
                    <strong>กำไร (Hospital):</strong> Revenue 2,000 - Cost {record.costTotal} = {record.profit} บาท
                  </div>
                </>
              )}
              {record.insuranceType === 'UC-EPO' && (
                <>
                  <div>
                    <strong>สิทธิ์:</strong> UC - EPO (ค่าตรง)
                  </div>
                  <div>
                    <strong>รวมค่าบริการ:</strong> {record.revenue} บาท (ค่าตรงตาม Cost)
                  </div>
                  <div>
                    <strong>เบิก:</strong> EPO + Lab + Service
                  </div>
                  <div>
                    <strong>กำไร:</strong> {record.profit} บาท (Profit Margin {record.profitMargin.toFixed(2)}%)
                  </div>
                </>
              )}
            </div>
          </div>          {/* Close Button */}
          <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #eee' }}>
            <button
              onClick={onClose}
              style={{
                width: '100%',
                padding: '12px',
                background: colors.border,
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              ปิด
            </button>
          </div>
        </div>
      </div>      {/* Category Detail Modal */}
      {selectedCategory && (
        <DetailCategoryModal
          record={record}
          category={selectedCategory}
          onClose={() => setSelectedCategory(null)}
        />
      )}
    </div>
  );
};
