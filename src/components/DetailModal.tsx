import React, { useState, useEffect } from 'react';
import type { CheckRecord, PrescriptionItem, ServiceADPItem } from '../mockData';
import { fetchPrescriptionData, fetchServiceADPData, fetchReceiptData, fetchDiagsAndProceduresData } from '../services/hosxpService';

interface DetailModalProps {
  record: CheckRecord | null;
  onClose: () => void;
}

interface ReceiptItem {
  icode: string;
  item_name: string;
  item_type: string;
  qty: number;
  unitprice: number;
  sum_price: number;
  income: string;
  income_name: string;
  nhso_adp_code?: string;
  tmlt_code?: string;
  ttmt_code?: string;
  s_drugname?: string;
  s_strength?: string;
  s_units?: string;
  has_nhso_adp: number;
  has_tmlt: number;
  has_ttmt: number;
}

interface ReceiptResponse {
  success: boolean;
  dataSource: string;
  vn: string;
  totalItems: number;
  totalAmount: number;
  message?: string;
  statistics?: {
    byClaimType: {
      nhsoAdp: number;
      tmlt: number;
      ttmt: number;
      nhsoAdpPercentage: number;
      tmltPercentage: number;
      ttmtPercentage: number;
    };
    byItemType: {
      drugs: number;
      lab: number;
      services: number;
    };
  };
  items: ReceiptItem[];
}

export const DetailModal: React.FC<DetailModalProps> = ({ record, onClose }) => {
  const [prescriptions, setPrescriptions] = useState<PrescriptionItem[]>([]);
  const [services, setServices] = useState<ServiceADPItem[]>([]);
  const [receiptData, setReceiptData] = useState<ReceiptResponse | null>(null);
  const [diagsData, setDiagsData] = useState<{ diagnoses: any[], procedures: any[] }>({ diagnoses: [], procedures: [] });
  const [loadingPrescriptions, setLoadingPrescriptions] = useState(false);
  const [loadingServices, setLoadingServices] = useState(false);
  const [loadingReceipt, setLoadingReceipt] = useState(false);
  const [loadingDiags, setLoadingDiags] = useState(false);
  const [prescriptionError, setPrescriptionError] = useState<string | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [diagsError, setDiagsError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'receipt' | 'drug' | 'service' | 'diags' | 'status'>('diags');

  useEffect(() => {
    if (!record) {
      setPrescriptions([]);
      setServices([]);
      setReceiptData(null);
      setDiagsData({ diagnoses: [], procedures: [] });
      setPrescriptionError(null);
      setServiceError(null);
      setReceiptError(null);
      setDiagsError(null);
      setLoadingPrescriptions(false);
      setLoadingServices(false);
      setLoadingReceipt(false);
      setLoadingDiags(false);
      setActiveTab('diags');
    }
  }, [record]);

  useEffect(() => {
    if (!record?.vn) return;
    let mounted = true;

    const loadReceiptData = async () => {
      if (mounted) setLoadingReceipt(true);
      try {
        const data = await fetchReceiptData(record.vn!);
        if (mounted) { setReceiptData(data); setReceiptError(null); }
      } catch {
        if (mounted) { setReceiptError('ไม่สามารถโหลดข้อมูลใบเสร็จได้'); setReceiptData(null); }
      } finally {
        if (mounted) setLoadingReceipt(false);
      }
    };

    const loadPrescriptions = async () => {
      if (mounted) setLoadingPrescriptions(true);
      try {
        const data = await fetchPrescriptionData(record.vn!);
        if (mounted) { setPrescriptions(data || []); setPrescriptionError(null); }
      } catch {
        if (mounted) { setPrescriptionError('ไม่สามารถโหลดข้อมูลยาได้'); setPrescriptions([]); }
      } finally {
        if (mounted) setLoadingPrescriptions(false);
      }
    };

    const loadServices = async () => {
      if (mounted) setLoadingServices(true);
      try {
        const data = await fetchServiceADPData(record.vn!);
        if (mounted) { setServices(data || []); setServiceError(null); }
      } catch {
        if (mounted) { setServiceError('ไม่สามารถโหลดข้อมูลค่าบริการได้'); setServices([]); }
      } finally {
        if (mounted) setLoadingServices(false);
      }
    };

    const loadDiags = async () => {
      if (mounted) setLoadingDiags(true);
      try {
        const res = await fetchDiagsAndProceduresData(record.vn!);
        if (mounted) {
          setDiagsData(res.data || { diagnoses: [], procedures: [] });
          setDiagsError(null);
        }
      } catch {
        if (mounted) {
          setDiagsError('ไม่สามารถโหลดข้อมูลวินิจฉัยและหัตถการได้');
          setDiagsData({ diagnoses: [], procedures: [] });
        }
      } finally {
        if (mounted) setLoadingDiags(false);
      }
    };

    loadDiags();
    loadReceiptData();
    loadPrescriptions();
    loadServices();

    return () => { mounted = false; };
  }, [record?.vn]);

  if (!record) return null;

  const tabs = [
    { id: 'diags' as const, label: '🩺 การวินิจฉัย/หัตถการ', count: (diagsData.diagnoses.length + diagsData.procedures.length) },
    { id: 'receipt' as const, label: '🧾 ใบเสร็จ', count: receiptData?.totalItems },
    { id: 'drug' as const, label: '💊 ยา', count: prescriptions.length },
    { id: 'service' as const, label: '🏥 บริการ ADP', count: services.length },
    { id: 'status' as const, label: '✅ สถานะ', count: record.issues.length || undefined },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div>
            <div className="modal-title">รายละเอียดการตรวจสอบ</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              VN: {record.vn || '-'} | HN: {record.hn}
            </div>
          </div>
          <button className="modal-close-btn" onClick={e => { e.stopPropagation(); onClose(); }}>
            ×
          </button>
        </div>

        {/* Body */}
        <div className="modal-body">
          {/* Patient Info */}
          <div className="section">
            <div className="info-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
              <div className="info-item">
                <span className="info-label">ชื่อผู้ป่วย</span>
                <span className="info-value">{record.patientName}</span>
              </div>
              <div className="info-item">
                <span className="info-label">สิทธิ์การรักษา</span>
                <span className="info-value">{record.fund}</span>
              </div>
              <div className="info-item">
                <span className="info-label">วันที่รับบริการ</span>
                <span className="info-value">{record.serviceDate}</span>
              </div>
              <div className="info-item">
                <span className="info-label">ประเภทบริการ</span>
                <span className="info-value">{record.serviceType || '-'}</span>
              </div>
              <div className="info-item">
                <span className="info-label">ราคารวม</span>
                <span className="info-value" style={{ color: 'var(--teal)' }}>
                  {record.price.toLocaleString()} บาท
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">สถานะ</span>
                <span className={`badge ${record.status === 'ready' ? 'badge-success' : record.status === 'pending' ? 'badge-warning' : 'badge-danger'}`}>
                  {record.status === 'ready' ? '✓' : '✗'} {record.status === 'ready' ? 'พร้อมส่ง' : record.status === 'pending' ? 'รอแก้ไข' : 'UUC2 ไม่ประสงค์เบิก'}
                </span>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="modal-tab-bar">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`modal-tab${activeTab === tab.id ? ' active' : ''}`}
              >
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span className="modal-tab-count">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab: Diags and Procedures */}
          {activeTab === 'diags' && (
            <div>
              {loadingDiags && (
                <div className="loading-container" style={{ padding: 24 }}>
                  <div className="spinner" />
                  <span>กำลังโหลดข้อมูลวินิจฉัยและหัตถการ...</span>
                </div>
              )}
              {diagsError && <div className="alert alert-danger">{diagsError}</div>}

              {!loadingDiags && !diagsError && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Diagnoses Table */}
                  <div className="modal-table-card">
                    <div className="modal-table-head" style={{ background: 'var(--surface-2)', color: 'var(--primary)' }}>
                      🩺 รายการการวินิจฉัยโรค (Diagnoses)
                    </div>
                    {diagsData.diagnoses.length > 0 ? (
                      <div className="modal-table-wrap">
                        <table className="data-table detail-modal-table detail-modal-table--diagnoses">
                          <thead>
                            <tr>
                              <th style={{ width: 80 }}>Type</th>
                              <th style={{ width: 100 }}>ICD-10</th>
                              <th>Description</th>
                            </tr>
                          </thead>
                          <tbody>
                            {diagsData.diagnoses.map((item, idx) => (
                              <tr key={'diag-' + idx}>
                                <td style={{ textAlign: 'center' }}>
                                  <span className={item.type === '1' ? 'badge badge-primary' : 'badge'} style={{ background: item.type !== '1' ? 'var(--surface-2)' : undefined, color: item.type !== '1' ? 'var(--text-secondary)' : undefined }}>
                                    {item.type === '1' ? 'Main' : item.type === '2' ? 'Comorb.' : item.type === '3' ? 'Comp.' : item.type === '4' ? 'Other' : item.type === '5' ? 'Ext.' : item.type}
                                  </span>
                                </td>
                                <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{item.code}</td>
                                <td>{item.name || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>ไม่มีข้อมูลการวินิจฉัย</div>
                    )}
                  </div>

                  {/* Procedures Table */}
                  <div className="modal-table-card">
                    <div className="modal-table-head" style={{ background: 'var(--surface-2)', color: 'var(--teal)' }}>
                      🔪 รายการหัตถการ (Procedures)
                    </div>
                    {diagsData.procedures.length > 0 ? (
                      <div className="modal-table-wrap">
                        <table className="data-table detail-modal-table detail-modal-table--procedures">
                          <thead>
                            <tr>
                              <th style={{ width: 100 }}>ICD-9-CM</th>
                              <th>Description</th>
                            </tr>
                          </thead>
                          <tbody>
                            {diagsData.procedures.map((item, idx) => (
                              <tr key={'proc-' + idx}>
                                <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{item.code}</td>
                                <td>{item.name || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>ไม่มีข้อมูลหัตถการ</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab: Receipt */}
          {activeTab === 'receipt' && (
            <div>
              {loadingReceipt && (
                <div className="loading-container" style={{ padding: 24 }}>
                  <div className="spinner" />
                  <span>กำลังโหลดข้อมูลใบเสร็จ...</span>
                </div>
              )}
              {receiptError && <div className="alert alert-danger">{receiptError}</div>}

              {receiptData && receiptData.success && (
                <>
                  {/* Receipt Stats */}
                  <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                    <span className="badge badge-primary">📦 {receiptData.totalItems} รายการ</span>
                    <span className="badge" style={{ background: 'var(--teal-light)', color: 'var(--teal)', border: '1px solid #99f6e4' }}>
                      💰 {receiptData.totalAmount?.toLocaleString()} บาท
                    </span>
                    {receiptData.statistics?.byClaimType && (
                      <>
                        <span className="badge badge-primary">
                          ADP: {receiptData.statistics.byClaimType.nhsoAdp} ({receiptData.statistics.byClaimType.nhsoAdpPercentage}%)
                        </span>
                        <span style={{ background: '#dcfce7', color: '#16a34a', border: '1px solid #bbf7d0' }} className="badge">
                          TMLT: {receiptData.statistics.byClaimType.tmlt}
                        </span>
                      </>
                    )}
                  {receiptData.statistics?.byItemType && (
                      <>
                        <span className="badge badge-success">🏥 ยา: {receiptData.statistics.byItemType.drugs}</span>
                        <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd' }}>
                          🔬 แลป: {receiptData.statistics.byItemType.lab}
                        </span>
                        <span className="badge badge-warning">⚕️ บริการ: {receiptData.statistics.byItemType.services}</span>
                      </>
                    )}
                  </div>

                  {/* Receipt Table */}
                  {receiptData.items && receiptData.items.length > 0 ? (
                    <div className="modal-table-card">
                      <div className="modal-table-wrap" style={{ maxHeight: 350 }}>
                      <table className="data-table detail-modal-table detail-modal-table--receipt">
                        <thead>
                          <tr>
                            <th>รหัส</th>
                            <th style={{ minWidth: 160 }}>รายการ</th>
                            <th style={{ textAlign: 'center' }}>ประเภท</th>
                            <th style={{ textAlign: 'center' }}>จำนวน</th>
                            <th style={{ textAlign: 'right' }}>ราคา/หน่วย</th>
                            <th style={{ textAlign: 'right' }}>รวม</th>
                            <th style={{ textAlign: 'center', minWidth: 120 }}>รหัสเคลม</th>
                            <th>หมวดรายได้</th>
                          </tr>
                        </thead>
                        <tbody>
                          {receiptData.items.map((item, index) => {
                            let typeColor = { bg: 'transparent', text: 'var(--text-primary)' };
                            if (item.item_type.includes('ยา')) typeColor = { bg: '#dcfce7', text: '#16a34a' };
                            else if (item.item_type.includes('เวชภัณฑ์')) typeColor = { bg: '#f3e8ff', text: '#7c3aed' };
                            else if (item.item_type.includes('การตรวจ')) typeColor = { bg: '#e0f2fe', text: '#0369a1' };
                            else if (item.item_type.includes('บริการ')) typeColor = { bg: '#fff7ed', text: '#c2410c' };

                            return (
                              <tr key={`${item.icode}-${index}`} style={{ cursor: 'default', background: typeColor.bg }}>
                                <td className="detail-modal-code-cell" style={{ color: 'var(--text-muted)' }}>
                                  {item.icode}
                                </td>
                                <td className="detail-modal-primary-cell">
                                  <div style={{ fontWeight: 500, fontSize: 12 }}>{item.item_name || item.icode}</div>
                                  {item.s_drugname && (
                                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                      {item.s_drugname} {item.s_strength && `(${item.s_strength})`}
                                    </div>
                                  )}
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                  <span style={{
                                    padding: '2px 6px', borderRadius: 'var(--radius-full)',
                                    fontSize: 10, fontWeight: 600,
                                    background: typeColor.text, color: 'white',
                                  }}>
                                    {item.item_type}
                                  </span>
                                </td>
                                <td style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 12 }}>
                                  {Number(item.qty)?.toLocaleString() || '-'}
                                  {item.s_units && <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{item.s_units}</div>}
                                </td>
                                <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                                  {Number(item.unitprice)?.toFixed(2)}
                                </td>
                                <td style={{
                                  textAlign: 'right', fontFamily: 'monospace', fontSize: 12,
                                  fontWeight: 600,
                                  color: Number(item.sum_price) > 100 ? 'var(--warning)' : 'var(--text-primary)',
                                }}>
                                  {Number(item.sum_price)?.toFixed(2)}
                                </td>

                                <td style={{ textAlign: 'center' }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                                    {item.has_nhso_adp === 1 && item.nhso_adp_code && (
                                      <span className="badge badge-primary" style={{ fontSize: 9 }}>ADP: {item.nhso_adp_code}</span>
                                    )}
                                    {item.has_tmlt === 1 && item.tmlt_code && (
                                      <span className="badge badge-success" style={{ fontSize: 9 }}>TMLT: {item.tmlt_code}</span>
                                    )}
                                    {item.has_ttmt === 1 && item.ttmt_code && (
                                      <span className="badge badge-warning" style={{ fontSize: 9 }}>TTMT: {item.ttmt_code}</span>
                                    )}
                                    {item.has_nhso_adp === 0 && item.has_tmlt === 0 && item.has_ttmt === 0 && (
                                      <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>ไม่มีรหัส</span>
                                    )}
                                  </div>
                                </td>
                                <td style={{ fontSize: 11 }}>
                                  <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-muted)' }}>{item.income}</div>
                                  <div>{item.income_name || '-'}</div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <div style={{
                        padding: '10px 12px',
                        background: 'var(--surface-2)',
                        borderTop: '2px solid var(--border)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          รวม {receiptData.totalItems} รายการ
                        </span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary)', fontFamily: 'monospace' }}>
                          {receiptData.totalAmount?.toFixed(2)} บาท
                        </span>
                      </div>
                    </div>
                    </div>
                  ) : (
                    <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}>ไม่มีรายการในใบเสร็จ</p>
                  )}
                </>
              )}

              {receiptData && !receiptData.success && (
                <div className="alert alert-warning">
                  <span>📋</span>
                  <span>{receiptData.message || 'ไม่พบรายการใบเสร็จ'}</span>
                </div>
              )}
            </div>
          )}

          {/* Tab: Drug */}
          {activeTab === 'drug' && (
            <div>
              {loadingPrescriptions && (
                <div className="loading-container" style={{ padding: 24 }}>
                  <div className="spinner" />
                  <span>กำลังโหลดข้อมูลยา...</span>
                </div>
              )}
              {prescriptionError && <div className="alert alert-danger">{prescriptionError}</div>}

              {!loadingPrescriptions && !prescriptionError && prescriptions.length > 0 && (
                <div className="modal-table-card">
                  <div className="modal-table-wrap">
                  <table className="data-table detail-modal-table detail-modal-table--drugs">
                    <thead>
                      <tr>
                        <th>รหัสยา</th>
                        <th>ชื่อยา</th>
                        <th style={{ textAlign: 'center' }}>จำนวน</th>
                        <th style={{ textAlign: 'right' }}>ราคา/หน่วย</th>
                        <th style={{ textAlign: 'right' }}>รวม</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prescriptions.map((item, idx) => (
                        <tr key={idx} style={{ cursor: 'default' }}>
                          <td className="detail-modal-code-cell">{item.icode}</td>
                          <td className="detail-modal-primary-cell">{item.drugName || '-'}</td>
                          <td style={{ textAlign: 'center', fontFamily: 'monospace' }}>{item.qty}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{item.unitPrice?.toLocaleString() || '0'} ฿</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{item.price?.toLocaleString() || '0'} ฿</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={4} style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600, background: 'var(--surface-2)', borderTop: '2px solid var(--border)' }}>
                          รวมค่ายา:
                        </td>
                        <td style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 700, fontFamily: 'monospace', color: 'var(--primary)', background: 'var(--surface-2)', borderTop: '2px solid var(--border)' }}>
                          {prescriptions.reduce((sum, item) => sum + (item.price || 0), 0).toLocaleString()} ฿
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                </div>
              )}

              {!loadingPrescriptions && !prescriptionError && prescriptions.length === 0 && (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic', padding: '24px 0' }}>ไม่มีข้อมูลยา</p>
              )}

              <div className="alert alert-warning" style={{ marginTop: 12 }}>
                <span>ℹ️</span>
                <span style={{ fontSize: 12 }}>ยาเบิกตามรายการยาแยกต่างหาก ไม่ใช้รหัส ADP Code</span>
              </div>
            </div>
          )}

          {/* Tab: Service ADP */}
          {activeTab === 'service' && (
            <div>
              {loadingServices && (
                <div className="loading-container" style={{ padding: 24 }}>
                  <div className="spinner" />
                  <span>กำลังโหลดข้อมูลบริการ...</span>
                </div>
              )}
              {serviceError && <div className="alert alert-danger">{serviceError}</div>}

              {!loadingServices && !serviceError && services.length > 0 && (
                <div className="modal-table-card">
                  <div className="modal-table-wrap">
                  <table className="data-table detail-modal-table detail-modal-table--services">
                    <thead>
                      <tr>
                        <th>รหัสบริการ</th>
                        <th>ประเภทรายได้</th>
                        <th style={{ textAlign: 'center' }}>ADP Code</th>
                        <th style={{ textAlign: 'right' }}>ราคา ADP</th>
                        <th style={{ textAlign: 'center' }}>สถานะเบิก</th>
                      </tr>
                    </thead>
                    <tbody>
                      {services.map((item, idx) => {
                        const canClaim = item.can_claim === 1 || item.adp_code;
                        return (
                          <tr key={idx} style={{ background: canClaim ? '#f0fdf4' : '#fef2f2', cursor: 'default' }}>
                            <td className="detail-modal-code-cell">{item.icode}</td>
                            <td className="detail-modal-primary-cell">{item.income_name || '-'}</td>
                            <td style={{ textAlign: 'center' }}>
                              {item.adp_code ? (
                                <>
                                  <span className="badge badge-success">{item.adp_code}</span>
                                  {item.adp_name && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{item.adp_name}</div>}
                                </>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>-</span>
                              )}
                            </td>
                            <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                              {item.adp_price?.toLocaleString() || '0'} ฿
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <span className={canClaim ? 'badge badge-success' : 'badge badge-danger'}>
                                {canClaim ? '✓ เบิกได้' : '✗ ไม่เบิก'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={3} style={{ textAlign: 'right', padding: '10px 12px', background: 'var(--surface-2)', borderTop: '2px solid var(--border)', fontWeight: 600 }}>
                          รวมที่เบิกได้: ({services.filter(s => s.can_claim === 1 || s.adp_code).length}/{services.length} รายการ)
                        </td>
                        <td colSpan={2} style={{ textAlign: 'center', padding: '10px 12px', background: 'var(--surface-2)', borderTop: '2px solid var(--border)', fontWeight: 700, fontFamily: 'monospace', color: 'var(--primary)' }}>
                          {services.filter(s => s.can_claim === 1).reduce((sum, item) => sum + (item.adp_price || 0), 0).toLocaleString()} ฿
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                </div>
              )}

              {!loadingServices && !serviceError && services.length === 0 && (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic', padding: '24px 0' }}>ไม่มีข้อมูลค่าบริการ ADP</p>
              )}
            </div>
          )}

          {/* Tab: Status */}
          {activeTab === 'status' && (
            <div>
              <div style={{ marginBottom: 16 }}>
                <span className={`badge ${record.status === 'ready' ? 'badge-success' : record.status === 'pending' ? 'badge-warning' : 'badge-danger'}`} style={{ fontSize: 14, padding: '6px 16px' }}>
                  {record.status === 'ready' ? '✓ ข้อมูลพร้อมส่ง' : record.status === 'pending' ? '⚠️ ข้อมูลรอแก้ไข' : '✗ UUC2 ไม่ประสงค์เบิก'}
                </span>
              </div>

              {record.issues.length > 0 ? (
                <div>
                  <div className="section-title">ปัญหาที่พบ</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {record.issues.map((issue, idx) => (
                      <div key={idx} className="alert alert-danger" style={{ padding: '10px 14px' }}>
                        <span>⚠️</span>
                        <span>{issue}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="alert alert-success">
                  <span>✅</span>
                  <span>ไม่พบปัญหา ข้อมูลครบถ้วน</span>
                </div>
              )}

              {record.details && (
                <div style={{ marginTop: 20 }}>
                  <div className="section-title">ข้อมูลรายละเอียด</div>
                  <div className="info-grid">
                    <div className="info-item">
                      <span className="info-label">รหัสยา</span>
                      <span className="info-value">{record.details.drugCode || '-'}</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">รหัสหัตถการ</span>
                      <span className="info-value">{record.details.procedureCode || '-'}</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">รหัสสิทธิ์</span>
                      <span className="info-value">{record.details.rightCode || '-'}</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">ราคามาตรฐาน</span>
                      <span className="info-value">{record.details.standardPrice?.toLocaleString() || '-'} บาท</span>
                    </div>
                  </div>
                  {record.details.notes && (
                    <div className="alert alert-warning" style={{ marginTop: 12 }}>
                      <span>📝</span>
                      <span>{record.details.notes}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onClose}>
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
};
