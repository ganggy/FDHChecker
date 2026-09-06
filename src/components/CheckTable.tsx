import React from 'react';
import type { CheckRecord } from '../mockData';
import { evaluateBillingLogic } from '../utils/billingUtils';

interface CheckTableProps {
  items: CheckRecord[];
  onRowClick?: (record: CheckRecord) => void;
}

const THAI_SHORT_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

const formatThaiServiceDate = (value?: string) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value || '-';

  const [, year, month, day] = match;
  const monthLabel = THAI_SHORT_MONTHS[Number(month) - 1];
  return monthLabel ? `${Number(day)} ${monthLabel} ${Number(year) + 543}` : value || '-';
};

const formatServiceTime = (value?: string) => {
  const match = String(value || '').match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]} น.` : '-';
};

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
              <th className="opd-service-datetime-header">วัน–เวลารับบริการ</th>
              <th style={{ textAlign: 'center' }}>ประเภท</th>
              <th style={{ textAlign: 'center' }}>Diag</th>
              <th className="fund-status-column">สถานะกองทุน</th>
              <th style={{ minWidth: 180 }}>สถานะ FDH / ECLAIM</th>
              <th style={{ minWidth: 210 }}>OPD Pre-audit</th>
              <th style={{ textAlign: 'center' }}>สถานะข้อมูล</th>
              <th style={{ textAlign: 'right' }}>ราคา (บาท)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const logic = evaluateBillingLogic(item);
              const specialFundNotes = logic.specialFundNotes.filter((note) => !note.includes('ปิดสิทธิ'));
              const epNotes = logic.specialFundNotes.filter((note) => note.includes('ปิดสิทธิ'));
              const specialSummary = logic.matchedFund
                ? 'เข้าเงื่อนไขกองทุนพิเศษ'
                : logic.incompleteFund
                  ? 'ใกล้เข้าเงื่อนไขกองทุนพิเศษ'
                  : '';
              const fundSecondaryText = [
                specialSummary,
                ...specialFundNotes,
                ...epNotes,
              ].filter(Boolean).join(' • ');
              const eclaimCode = String(item.pttype_eclaim_id || '').trim();
              const eclaimName = String(item.pttype_eclaim_name || '').trim();
              const eclaimLabel = eclaimCode
                ? `${eclaimCode}${eclaimName ? `: ${eclaimName}` : ''}`
                : 'ไม่ระบุ';
              const fdhLabel = item.fdh_status_label
                || (item.has_close ? 'ปิดสิทธิแล้ว (EP)' : item.has_authen ? 'มี Authen (PP)' : 'ยังไม่มีสถานะ FDH');
              const opdAudit = item.opd_pre_audit;

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
                  <td className="opd-service-datetime-cell">
                    <div className="opd-service-datetime">
                      <span className="opd-service-date">{formatThaiServiceDate(item.serviceDate)}</span>
                      <span className="opd-service-time">
                        <span className="opd-service-time-dot" />
                        {formatServiceTime(item.serviceTime)}
                      </span>
                    </div>
                  </td>
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
                  <td className="fund-status-column">
                    <div
                      className="fund-status-block fund-status-block--two-lines"
                      title={[logic.billingStatusLabel, fundSecondaryText].filter(Boolean).join(' — ')}
                    >
                      <div className="fund-status-line fund-status-line--primary">
                        {logic.billingStatusLabel}
                      </div>
                      <div className={`fund-status-line fund-status-line--secondary ${logic.matchedFund ? 'is-success' : 'is-warning'}`}>
                        {fundSecondaryText || '—'}
                      </div>
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
                  <td onClick={(event) => event.stopPropagation()}>
                    {!opdAudit ? (
                      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                        {item.serviceType === 'ผู้ป่วยใน' || item.serviceType === 'IPD'
                          ? 'ไม่ใช่รายการ OPD'
                          : 'ยังไม่ได้ประมวลผล Pre-audit'}
                      </span>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-start' }}>
                        <span className={`badge ${opdAudit.status === 'clear' ? 'badge-success' : opdAudit.status === 'blocking' ? 'badge-danger' : 'badge-warning'}`}>
                          {opdAudit.status === 'clear'
                            ? 'ผ่านกฎ OPD'
                            : opdAudit.status === 'blocking'
                              ? `ห้ามส่ง ${opdAudit.blockingCount} จุด`
                              : `ควรตรวจ ${opdAudit.reviewCount} จุด`}
                        </span>
                        {opdAudit.findings.length > 0 && (
                          <details style={{ fontSize: 11, color: 'var(--text-secondary)', maxWidth: 280 }}>
                            <summary style={{ cursor: 'pointer' }}>
                              {opdAudit.findings.slice(0, 2).map((finding) => finding.code).join(', ')}
                              {opdAudit.findings.length > 2 ? ` +${opdAudit.findings.length - 2}` : ''}
                            </summary>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 5 }}>
                              {opdAudit.findings.map((finding) => (
                                <div key={finding.code} style={{ color: finding.severity === 'blocking' ? '#b91c1c' : '#92400e' }}>
                                  <strong>{finding.code}</strong>: {finding.message}
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    )}
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
