import React from 'react';
import type { KidneyMonitorRecord } from '../mockKidneyData';

interface DetailCategoryModalProps {
  record: KidneyMonitorRecord | null;
  category: 'drugs' | 'labs' | 'service' | 'otherService' | null;
  onClose: () => void;
}

export const DetailCategoryModal: React.FC<DetailCategoryModalProps> = ({ record, category, onClose }) => {
  if (!record || !category) return null;
  const categoryInfo = {
    drugs: {
      title: '💊 รายละเอียดค่ายา (Drugs)',
      color: '#2196f3',
      bgColor: '#e3f2fd',
      items: record.drugs || [],
      totalSale: record.drugTotalSale,
      totalCost: record.drugTotalCost,
      columns: ['Item Name', 'Qty', 'Unit Cost', 'Unit Price', 'Total Cost', 'Total Price', 'Profit'],
    },
    labs: {
      title: '🔬 รายละเอียดค่าแลป (Labs)',
      color: '#4caf50',
      bgColor: '#e8f5e9',
      items: record.labs || [],
      totalSale: record.labTotalSale,
      totalCost: record.labTotalCost,
      columns: ['Item Name', 'Unit Cost', 'Unit Price', 'Profit'],
    },    service: {
      title: '💉 รายละเอียดค่าบริการล้างไต (Dialysis Service)',
      color: '#ff9800',
      bgColor: '#fff3e0',
      items: (record.dialysisServices || []).filter((s: Record<string, unknown>) => s.isDialysis === true),
      totalSale: record.dialysisFee,
      totalCost: record.dialysisCost,
      columns: ['Service Name', 'Qty', 'Unit Cost', 'Unit Price', 'Profit'],
    },
    otherService: {
      title: '🏥 รายละเอียดบริการอื่น (Other Services)',
      color: '#9c27b0',
      bgColor: '#f3e5f5',
      items: (record.dialysisServices || []).filter((s: Record<string, unknown>) => s.isDialysis !== true),
      totalSale: record.otherServiceFee ?? 0,
      totalCost: record.otherServiceCost ?? 0,
      columns: ['Service Name', 'Qty', 'Unit Cost', 'Unit Price', 'Profit'],
    },
  };

  const info = categoryInfo[category as keyof typeof categoryInfo];
  const profit = info.totalSale - info.totalCost;
  const profitMargin = info.totalSale > 0 ? ((profit / info.totalSale) * 100).toFixed(2) : '0.00';
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2001,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '12px',
          maxWidth: '800px',
          width: '95%',
          maxHeight: '85vh',
          overflow: 'auto',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px',
            background: info.bgColor,
            borderBottom: `3px solid ${info.color}`,
            borderTopLeftRadius: '12px',
            borderTopRightRadius: '12px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ margin: '0 0 8px 0', color: info.color, fontSize: '18px', fontWeight: 800 }}>
                {info.title}
              </h2>
              <p style={{ margin: 0, color: '#666', fontSize: '13px' }}>
                ผู้ป่วย: {record.patientName} (HN: {record.hn}) | VN: {record.vn}
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
          {/* Patient and Date Info */}
          <div style={{ marginBottom: '20px', padding: '12px', background: '#f9f9f9', borderRadius: '6px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '15px', fontSize: '13px' }}>
              <div>
                <div style={{ color: '#666', fontSize: '11px', marginBottom: '4px' }}>บัญชีผู้ป่วย (HN)</div>
                <div style={{ fontWeight: 600 }}>{record.hn}</div>
              </div>
              <div>
                <div style={{ color: '#666', fontSize: '11px', marginBottom: '4px' }}>เลขที่ผู้มาใช้บริการ (VN)</div>
                <div style={{ fontWeight: 600 }}>{record.vn}</div>
              </div>
              <div>
                <div style={{ color: '#666', fontSize: '11px', marginBottom: '4px' }}>ประเภทสิทธิ์</div>
                <div style={{ fontWeight: 600, color: info.color }}>{record.insuranceType}</div>
              </div>
              <div>
                <div style={{ color: '#666', fontSize: '11px', marginBottom: '4px' }}>วันที่ใช้บริการ</div>
                <div style={{ fontWeight: 600 }}>
                  {new Date(record.serviceDate).toLocaleDateString('th-TH', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Items Table */}
          <div style={{ marginBottom: '20px', overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '13px',
              }}
            >
              <thead>
                <tr style={{ background: info.bgColor, borderBottom: `2px solid ${info.color}` }}>
                  {category === 'drugs' && (
                    <>
                      <th style={{ padding: '10px', textAlign: 'left', fontWeight: 600, color: '#333' }}>รายการยา</th>
                      <th style={{ padding: '10px', textAlign: 'center', fontWeight: 600, color: '#333' }}>จำนวน</th>
                      <th style={{ padding: '10px', textAlign: 'right', fontWeight: 600, color: '#333' }}>ทุน/หน่วย</th>
                      <th style={{ padding: '10px', textAlign: 'right', fontWeight: 600, color: '#333' }}>ราคาขาย/หน่วย</th>
                      <th style={{ padding: '10px', textAlign: 'right', fontWeight: 600, color: '#333' }}>ทุนทั้งหมด</th>
                      <th style={{ padding: '10px', textAlign: 'right', fontWeight: 600, color: '#333' }}>ขายทั้งหมด</th>
                      <th style={{ padding: '10px', textAlign: 'right', fontWeight: 600, color: '#333' }}>กำไร</th>
                    </>
                  )}
                  {category === 'labs' && (
                    <>
                      <th style={{ padding: '10px', textAlign: 'left', fontWeight: 600, color: '#333' }}>รายการแลป</th>
                      <th style={{ padding: '10px', textAlign: 'right', fontWeight: 600, color: '#333' }}>ทุน (ประมาณการ)</th>
                      <th style={{ padding: '10px', textAlign: 'right', fontWeight: 600, color: '#333' }}>ราคาขาย</th>
                      <th style={{ padding: '10px', textAlign: 'right', fontWeight: 600, color: '#333' }}>กำไร</th>
                    </>
                  )}                  {(category === 'service' || category === 'otherService') && (
                    <>
                      <th style={{ padding: '10px', textAlign: 'left', fontWeight: 600, color: '#333' }}>รายการบริการ</th>
                      <th style={{ padding: '10px', textAlign: 'center', fontWeight: 600, color: '#333' }}>จำนวน</th>
                      <th style={{ padding: '10px', textAlign: 'right', fontWeight: 600, color: '#333' }}>ทุน/หน่วย</th>
                      <th style={{ padding: '10px', textAlign: 'right', fontWeight: 600, color: '#333' }}>ราคาขาย/หน่วย</th>
                      <th style={{ padding: '10px', textAlign: 'right', fontWeight: 600, color: '#333' }}>กำไร</th>
                    </>
                  )}
                </tr>
              </thead>              <tbody>
                {category === 'drugs' &&
                  info.items.map((drug: Record<string, unknown>, idx: number) => {
                    const itemTotalCost = ((drug.unitcost as number) || 0) * ((drug.qty as number) || 1);
                    const itemTotalPrice = ((drug.unitprice as number) || 0) * ((drug.qty as number) || 1);
                    const itemProfit = itemTotalPrice - itemTotalCost;
                    const isEstimated = drug.costIsEstimated === true;
                    return (
                      <tr
                        key={idx}
                        style={{
                          borderBottom: '1px solid #e0e0e0',
                          background: idx % 2 === 0 ? '#fff' : '#f9f9f9',
                        }}
                      >                        <td style={{ padding: '10px', textAlign: 'left' }}>
                          <div>{drug.drugName as string}</div>
                          {isEstimated && (
                            <div style={{ fontSize: '10px', color: '#ff9800', fontStyle: 'italic' }}>
                              ⚠️ ไม่มีทุนในระบบ (ใช้ 50% Fallback)
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '10px', textAlign: 'center' }}>{drug.qty as number}</td>
                        <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600 }}>
                          ฿{((drug.unitcost as number) || 0).toLocaleString()}
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600 }}>฿{((drug.unitprice as number) || 0).toLocaleString()}</td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>
                          <div>฿{itemTotalCost.toLocaleString()}</div>
                          {isEstimated && <div style={{ fontSize: '9px', color: '#ff9800' }}>(50% ของขาย)</div>}
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right' }}>฿{itemTotalPrice.toLocaleString()}</td>
                        <td
                          style={{
                            padding: '10px',
                            textAlign: 'right',
                            fontWeight: 600,
                            color: itemProfit > 0 ? '#4caf50' : '#f44336',
                          }}
                        >
                          ฿{itemProfit.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                {category === 'labs' &&
                  info.items.map((lab: Record<string, unknown>, idx: number) => {
                    const itemProfit = ((lab.service_pprice as number) || 0) - ((lab.service_cost as number) || 0);
                    const isEstimated = lab.costIsEstimated === true;
                    return (
                      <tr
                        key={idx}
                        style={{
                          borderBottom: '1px solid #e0e0e0',
                          background: idx % 2 === 0 ? '#fff' : '#f9f9f9',
                        }}
                      >
                        <td style={{ padding: '10px', textAlign: 'left' }}>
                          <div>{lab.labName as string}</div>
                          {isEstimated && (
                            <div style={{ fontSize: '10px', color: '#4caf50', fontStyle: 'italic' }}>
                              🧪 ไม่มีทุนจริง (ใช้ 40% ของราคาขาย)
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600 }}>
                          <div>฿{((lab.service_cost as number) || 0).toLocaleString()}</div>
                          {isEstimated && <div style={{ fontSize: '9px', color: '#666' }}>(ประมาณการ 40%)</div>}
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600 }}>฿{((lab.service_pprice as number) || 0).toLocaleString()}</td>
                        <td
                          style={{
                            padding: '10px',
                            textAlign: 'right',
                            fontWeight: 600,
                            color: itemProfit > 0 ? '#4caf50' : '#f44336',
                          }}
                        >
                          ฿{itemProfit.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}                {(category === 'service' || category === 'otherService') &&
                  info.items.map((service: Record<string, unknown>, idx: number) => {
                    const itemProfit = ((service.total_price as number) || 0) - ((service.service_cost as number) || 0);
                    const isEstimated = service.costIsEstimated === true;
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid #e0e0e0', background: idx % 2 === 0 ? '#fff' : '#f9f9f9' }}>
                        <td style={{ padding: '10px', textAlign: 'left' }}>
                          <div>{service.serviceName as string}</div>
                          {isEstimated && (
                            <div style={{ fontSize: '10px', color: '#ff9800', fontStyle: 'italic' }}>
                              ⚠️ ค่าบริการ (ใช้ 40% Fallback)
                            </div>
                          )}
                          {!isEstimated && (service.isDialysis as unknown as boolean) && (
                            <div style={{ fontSize: '9px', color: '#4caf50' }}>(ต้นทุนคงที่ 1,380.-)</div>
                          )}
                        </td>
                        <td style={{ padding: '10px', textAlign: 'center' }}>{String(service.qty)}</td>
                        <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600 }}>
                          <div>฿{((service.service_cost as number) || 0).toLocaleString()}</div>
                          {isEstimated && <div style={{ fontSize: '9px', color: '#ff9800' }}>(40% ของราคาขาย)</div>}
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600 }}>฿{((service.total_price as number) || 0).toLocaleString()}</td>
                        <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600, color: itemProfit > 0 ? '#4caf50' : '#f44336' }}>
                          ฿{itemProfit.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          {/* Summary */}
          <div
            style={{
              marginBottom: '20px',
              padding: '15px',
              background: info.bgColor,
              borderRadius: '8px',
              borderLeft: `4px solid ${info.color}`,
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '15px' }}>
              <div>
                <div style={{ color: '#666', fontSize: '11px', marginBottom: '4px' }}>รวมทุนทั้งหมด</div>
                <div style={{ fontWeight: 700, fontSize: '16px', color: '#333' }}>
                  ฿{info.totalCost.toLocaleString()}
                </div>
              </div>
              <div>
                <div style={{ color: '#666', fontSize: '11px', marginBottom: '4px' }}>รวมขายทั้งหมด</div>
                <div style={{ fontWeight: 700, fontSize: '16px', color: info.color }}>
                  ฿{info.totalSale.toLocaleString()}
                </div>
              </div>
              <div>
                <div style={{ color: '#666', fontSize: '11px', marginBottom: '4px' }}>กำไรสุทธิ</div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: '16px',
                    color: profit > 0 ? '#4caf50' : '#f44336',
                  }}
                >
                  ฿{profit.toLocaleString()}
                </div>
              </div>
              <div>
                <div style={{ color: '#666', fontSize: '11px', marginBottom: '4px' }}>Profit Margin</div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: '16px',
                    color: parseFloat(profitMargin) > 20 ? '#4caf50' : parseFloat(profitMargin) > 10 ? '#ff9800' : '#f44336',
                  }}
                >
                  {profitMargin}%
                </div>
              </div>
            </div>
          </div>

          {/* Close Button */}
          <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #eee' }}>
            <button
              onClick={onClose}
              style={{
                width: '100%',
                padding: '12px',
                background: info.color,
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
      </div>
    </div>
  );
};
