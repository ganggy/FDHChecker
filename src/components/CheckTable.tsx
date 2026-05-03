import React from 'react';
import type { CheckRecord } from '../mockData';
import { evaluateBillingLogic } from '../utils/billingUtils';

interface CheckTableProps {
  items: CheckRecord[];
  onRowClick?: (record: CheckRecord) => void;
}

export const CheckTable: React.FC<CheckTableProps> = ({ items, onRowClick }) => {
  if (items.length === 0) return null;

  return (
    <div className="modal-table-card">
      <div className="modal-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 48, textAlign: 'center' }}>#</th>
              <th>VN</th>
              <th>HN</th>
              <th>ชื่อผู้ป่วย</th>
              <th>สิทธิ์</th>
              <th style={{ textAlign: 'center' }}>วันที่รับบริการ</th>
              <th style={{ textAlign: 'center' }}>ประเภท</th>
              <th style={{ textAlign: 'center' }}>Diag</th>
              <th style={{ minWidth: 150 }}>สถานะกองทุน</th>
              <th style={{ minWidth: 180 }}>สถานะ FDH / ECLAIM</th>
              <th style={{ textAlign: 'center' }}>สถานะข้อมูล</th>
              <th style={{ textAlign: 'right' }}>ราคา (บาท)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const logic = evaluateBillingLogic(item);
              const specialFundNotes = logic.specialFundNotes.filter((note) => !note.includes('ปิดสิทธิ'));
              const epNotes = logic.specialFundNotes.filter((note) => note.includes('ปิดสิทธิ'));
              const hasSpecialFundBlock = specialFundNotes.length > 0;
              const specialSummary = logic.matchedFund
                ? 'เข้าเงื่อนไขกองทุนพิเศษ'
                : logic.incompleteFund
                  ? 'ใกล้เข้าเงื่อนไขกองทุนพิเศษ'
                  : '';
              const eclaimCode = String(item.pttype_eclaim_id || '').trim();
              const eclaimName = String(item.pttype_eclaim_name || '').trim();
              const eclaimLabel = eclaimCode
                ? `${eclaimCode}${eclaimName ? `: ${eclaimName}` : ''}`
                : 'ไม่ระบุ';
              const fdhLabel = item.fdh_status_label
                || (item.has_close ? 'ปิดสิทธิแล้ว (EP)' : item.has_authen ? 'มี Authen (PP)' : 'ยังไม่มีสถานะ FDH');

              return (
                <tr
                  key={item.id}
                  className={`table-row-emphasis ${item.status === 'pending' || item.status === 'rejected' ? 'row-danger' : ''}`}
                  style={{ opacity: logic.opacity, backgroundColor: logic.bgStyle, cursor: 'pointer' }}
                  onClick={() => onRowClick?.(item)}
                >
                  <td style={{ textAlign: 'center', opacity: 0.5, fontSize: 12 }}>{index + 1}</td>
                  <td className="table-cell-nowrap" style={{ fontSize: 13, color: '#64748b' }}>{item.vn}</td>
                  <td style={{ fontWeight: 600 }}>{item.hn}</td>
                  <td style={{ fontWeight: 500 }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span>{item.patientName}</span>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 400 }}>
                        {item.sex === '2' ? 'หญิง' : item.sex === '1' ? 'ชาย' : ''} {item.age || item.age_y || '-'} ปี
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-info" style={{
                      background: item.hipdata_code === 'UCS' ? '#dbeafe' : item.hipdata_code === 'WEL' ? '#f0f9ff' : '#f1f5f9',
                      color: item.hipdata_code === 'UCS' ? '#1e40af' : item.hipdata_code === 'WEL' ? '#0369a1' : '#475569',
                      fontSize: 11
                    }}>
                      {item.fund || item.hipdata_code}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center', fontSize: 13 }}>{item.serviceDate || '-'}</td>
                  <td style={{ textAlign: 'center' }}>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-full)',
                      fontSize: 11,
                      fontWeight: 600,
                      background: item.serviceType === 'ผู้ป่วยนอก' ? '#eff6ff' : '#fff1f2',
                      color: item.serviceType === 'ผู้ป่วยนอก' ? '#3b82f6' : '#e11d48',
                      whiteSpace: 'nowrap'
                    }}>
                      {item.serviceType}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center', fontWeight: 700, color: logic.hasNoDiagnosis ? '#ef4444' : '#1e40af' }}>
                    {logic.hasNoDiagnosis ? 'ใส่ ICD10' : (item.pdx || item.main_diag || '-')}
                  </td>
                  <td>
                    <div className="fund-status-block">
                      <div className="fund-status-title">
                        {logic.billingStatusLabel}
                      </div>
                      {hasSpecialFundBlock && (
                        <>
                          <div className={`fund-status-summary ${logic.matchedFund ? 'fund-status-summary--success' : 'fund-status-summary--warning'}`}>
                            <span>{specialSummary}</span>
                          </div>
                          <div className="fund-status-kicker">กองทุนพิเศษ</div>
                          <div className="fund-status-badges">
                            {specialFundNotes.map((note, idx) => {
                              const badgeStyle: React.CSSProperties = { fontSize: 10, padding: '2px 6px' };
                              
                              // Color coding logic
                              if (note.includes('ขาด') || note.includes('ไม่ผ่าน') || note.includes('ไม่ถึงเกณฑ์') || note.includes('เบิกไม่ได้')) {
                                 return <span key={idx} className="badge badge-danger" style={badgeStyle}>{note}</span>;
                              }
                              
                              if (note.match(/ANC|ตรวจครรภ์/)) {
                                 return <span key={idx} className="badge" style={{...badgeStyle, background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd'}}>{note}</span>;
                              }
                              if (note.match(/ตรวจหลังคลอด/)) {
                                 return <span key={idx} className="badge" style={{...badgeStyle, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a'}}>{note}</span>;
                              }
                              if (note.match(/คัดกรอง|ตรวจมะเร็ง/)) {
                                 return <span key={idx} className="badge" style={{...badgeStyle, background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0'}}>{note}</span>;
                              }
                              if (note.match(/Telemedicine|EMS/)) {
                                 return <span key={idx} className="badge" style={{...badgeStyle, background: '#faf5ff', color: '#6b21a8', border: '1px solid #e9d5ff'}}>{note}</span>;
                              }
                              if (note.match(/คุมกำเนิด|ถุงยาง/)) {
                                 return <span key={idx} className="badge" style={{...badgeStyle, background: '#fff1f2', color: '#9f1239', border: '1px solid #fecdd3'}}>{note}</span>;
                              }
                              if (note.match(/ล้างไต/)) {
                                 return <span key={idx} className="badge badge-info" style={badgeStyle}>{note}</span>;
                              }

                              return (
                                <span key={idx} className="badge badge-success" style={badgeStyle}>
                                  {note}
                                </span>
                              );
                            })}
                          </div>
                        </>
                      )}
                      {epNotes.length > 0 && (
                        <div className="fund-status-badges fund-status-badges--ep">
                          {epNotes.map((note, idx) => (
                            <span key={idx} className={`badge ${item.has_close ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: 10 }}>
                              {note}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span className={`badge ${item.has_close ? 'badge-success' : item.has_authen ? 'badge-info' : 'badge-warning'}`} style={{ fontSize: 10, alignSelf: 'flex-start' }}>
                        FDH: {fdhLabel}
                      </span>
                      <span className="badge" style={{ fontSize: 10, alignSelf: 'flex-start', background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1' }}>
                        ECLAIM: {eclaimLabel}
                      </span>
                    </div>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                      <span className={`badge ${item.status === 'ready' ? 'badge-success' : item.status === 'pending' ? 'badge-warning' : 'badge-danger'}`}>
                        {item.status === 'ready' ? 'พร้อมส่ง' : item.status === 'pending' ? 'รอปิดสิทธิ/แก้ไข' : 'ไม่ส่ง'}
                      </span>
                      <span className={`badge ${item.has_close ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: 10 }}>
                        EP {item.has_close ? '✓' : '✗'}
                      </span>
                    </div>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>
                    {item.price?.toLocaleString() || '0'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
