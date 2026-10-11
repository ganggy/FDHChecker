---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "operations"
source: "src/components/FDHPreviewModal.tsx"
source_hash: "eda83f9c606195baa1282d65f9e200c16ee1436d588cb21e5c0787e68fcb4d48"
managed_by: "sync-ksp-vault"
---
# FDHPreviewModal.tsx

> Source: `src/components/FDHPreviewModal.tsx`
> SHA-256: `eda83f9c606195baa1282d65f9e200c16ee1436d588cb21e5c0787e68fcb4d48`

````tsx
import React, { useState } from 'react';

interface FDHPreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    data: any;
    validation?: {
        valid: boolean;
        totalRows: number;
        errors: Array<{ code: string; file?: string; row?: number; field?: string; message: string }>;
        warnings: Array<{ code: string; file?: string; row?: number; field?: string; message: string }>;
    } | null;
    onDownload: () => void;
    isDownloading: boolean;
    onSubmit: () => void;
    isSubmitting: boolean;
    exportRequest?: any;
}

export const FDHPreviewModal: React.FC<FDHPreviewModalProps> = ({
    isOpen,
    onClose,
    data,
    validation,
    onDownload,
    isDownloading,
    onSubmit,
    isSubmitting,
    exportRequest,
}) => {
    const [viewFormat, setViewFormat] = useState<'16files' | 'fdsv3'>('16files');
    const [activeTab, setActiveTab] = useState('INS');
    const [fdsV3Data, setFdsV3Data] = useState<{ payload?: any; validation?: any } | null>(null);
    const [loadingFdsV3, setLoadingFdsV3] = useState(false);
    const [downloadingFdsJson, setDownloadingFdsJson] = useState(false);
    const [copySuccess, setCopySuccess] = useState(false);

    const loadFdsV3 = React.useCallback(async () => {
        if (!exportRequest) return;
        try {
            setLoadingFdsV3(true);
            const response = await fetch('/api/fdh/v3/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(exportRequest),
            });
            const result = await response.json();
            if (result.success) {
                setFdsV3Data(result);
            }
        } catch (error) {
            console.error('Error loading FDS v3 preview:', error);
        } finally {
            setLoadingFdsV3(false);
        }
    }, [exportRequest]);

    React.useEffect(() => {
        if (viewFormat === 'fdsv3' && !fdsV3Data && exportRequest) {
            void loadFdsV3();
        }
    }, [viewFormat, fdsV3Data, exportRequest, loadFdsV3]);

    const handleDownloadFdsJson = async () => {
        if (!exportRequest) return;
        try {
            setDownloadingFdsJson(true);
            const response = await fetch('/api/fdh/v3/export-json', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(exportRequest),
            });
            if (!response.ok) throw new Error('Download failed');
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `FDS_v3_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (error) {
            alert('ไม่สามารถดาวน์โหลดไฟล์ FDS v3 JSON ได้: ' + (error instanceof Error ? error.message : String(error)));
        } finally {
            setDownloadingFdsJson(false);
        }
    };

    const handleCopyJson = () => {
        if (!fdsV3Data?.payload) return;
        void navigator.clipboard.writeText(JSON.stringify(fdsV3Data.payload, null, 2));
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
    };

    if (!isOpen || !data) return null;

    const folders = ['INS', 'PAT', 'OPD', 'ORF', 'ODX', 'OOP', 'IPD', 'IRF', 'IDX', 'IOP', 'CHT', 'CHA', 'AER', 'ADP', 'LVD', 'DRU'];
    const errorsForFile = (folder: string) => validation?.errors.filter(
        issue => String(issue.file || '').toUpperCase() === folder,
    ) || [];
    const errorsForRow = (folder: string, rowNumber: number) => errorsForFile(folder).filter(
        issue => Number(issue.row) === rowNumber,
    );

    const renderTable = (folder: string) => {
        const rows = data[folder] || [];
        if (rows.length === 0) {
            return (
                <div style={{ padding: '40px 0', textAlign: 'center', color: '#94a3b8' }}>
                    <div style={{ fontSize: '3rem', marginBottom: 16 }}>📁</div>
                    <div style={{ fontWeight: 600 }}>ไม่พบข้อมูลในแฟ้ม {folder} (0 รายการ)</div>
                    <p style={{ fontSize: 13, marginTop: 4 }}>ข้อมูลส่วนนี้อาจไม่มีความจำเป็นสำหรับรายการที่เลือก</p>
                </div>
            );
        }

        const columns = Object.keys(rows[0]);

        return (
            <div className="modal-table-wrap" style={{ maxHeight: '500px' }}>
                <table className="data-table fdh-preview-table">
                    <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                        <tr>
                            <th style={{ background: '#f8fafc', width: 40 }}>#</th>
                            {columns.map(col => (
                                <th key={col} style={{ background: '#f8fafc', whiteSpace: 'nowrap' }}>{col}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row: any, idx: number) => {
                            const rowErrors = errorsForRow(folder, idx + 1);
                            const errorTitle = rowErrors.map(issue => issue.message).join('\n');
                            return (
                            <tr
                                key={idx}
                                className={rowErrors.length > 0 ? 'fdh-preview-row--error' : undefined}
                                title={errorTitle || undefined}
                                aria-label={rowErrors.length > 0 ? `แถว ${idx + 1} มีข้อผิดพลาด ${rowErrors.length} รายการ` : undefined}
                            >
                                <td style={{ textAlign: 'center', color: rowErrors.length > 0 ? '#991b1b' : '#64748b', fontSize: 12, fontWeight: rowErrors.length > 0 ? 800 : 400 }}>
                                    {rowErrors.length > 0 && <span className="fdh-preview-error-icon" aria-hidden="true">!</span>}
                                    {idx + 1}
                                </td>
                                {columns.map(col => (
                                    <td
                                        key={col}
                                        className={rowErrors.some(issue => issue.field === col) ? 'fdh-preview-cell--error' : undefined}
                                        style={{ whiteSpace: 'nowrap', fontSize: 13 }}
                                    >
                                        {row[col] ?? ''}
                                    </td>
                                ))}
                            </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        );
    };

    return (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
            <div className="modal-content fdh-preview-shell">
                {/* Header */}
                <div className="fdh-preview-header">
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                            <h2 style={{ margin: 0, fontSize: 18, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: '1.4rem' }}>📊</span>
                                MOPH Finance Data Viewer
                            </h2>
                            <div style={{ display: 'inline-flex', background: '#e2e8f0', borderRadius: 8, padding: 2 }}>
                                <button
                                    type="button"
                                    onClick={() => setViewFormat('16files')}
                                    style={{
                                        border: 'none',
                                        background: viewFormat === '16files' ? '#fff' : 'transparent',
                                        color: viewFormat === '16files' ? '#0f172a' : '#64748b',
                                        fontWeight: viewFormat === '16files' ? 700 : 500,
                                        fontSize: 12,
                                        padding: '4px 10px',
                                        borderRadius: 6,
                                        cursor: 'pointer',
                                        boxShadow: viewFormat === '16files' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                                    }}
                                >
                                    📁 16 แฟ้มมาตรฐาน
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setViewFormat('fdsv3')}
                                    style={{
                                        border: 'none',
                                        background: viewFormat === 'fdsv3' ? '#4338ca' : 'transparent',
                                        color: viewFormat === 'fdsv3' ? '#fff' : '#4338ca',
                                        fontWeight: viewFormat === 'fdsv3' ? 700 : 600,
                                        fontSize: 12,
                                        padding: '4px 10px',
                                        borderRadius: 6,
                                        cursor: 'pointer',
                                        boxShadow: viewFormat === 'fdsv3' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
                                    }}
                                >
                                    ✨ FDS v3.0 JSON (ปีงบ 2569)
                                </button>
                            </div>
                        </div>
                        <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
                            {viewFormat === '16files'
                                ? 'ตรวจสอบความถูกต้องของข้อมูล Pipe-Delimited ก่อนการส่งออกไฟล์ ZIP 16 แฟ้ม'
                                : 'ตรวจสอบโครงสร้างและ Pre-flight Guard สำหรับ Unified FDS v3.0.0.59 (Single Clearing House)'}
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        {viewFormat === '16files' ? (
                            <>
                                <button
                                    className="btn btn-success"
                                    onClick={onSubmit}
                                    disabled={isSubmitting || isDownloading || validation?.valid !== true}
                                    style={{ padding: '8px 20px', fontSize: 14 }}
                                    title={validation?.valid ? 'ส่ง multipart ไป FDH API จริง' : 'ต้องแก้ข้อผิดพลาด Preflight ก่อน'}
                                >
                                    {isSubmitting ? '⏳ กำลังส่ง FDH...' : '🚀 ส่ง FDH API'}
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={onDownload}
                                    disabled={isDownloading || isSubmitting || validation?.valid !== true}
                                    style={{ padding: '8px 20px', fontSize: 14 }}
                                >
                                    {isDownloading ? '⏳ กำลังสร้าง ZIP...' : '📦 ดาวน์โหลดไฟล์ ZIP'}
                                </button>
                            </>
                        ) : (
                            <>
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={handleCopyJson}
                                    disabled={!fdsV3Data?.payload}
                                    style={{ padding: '8px 16px', fontSize: 13 }}
                                >
                                    {copySuccess ? '✓ คัดลอกแล้ว' : '📋 คัดลอก JSON'}
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-primary"
                                    onClick={() => void handleDownloadFdsJson()}
                                    disabled={downloadingFdsJson || !exportRequest}
                                    style={{ padding: '8px 20px', fontSize: 14, background: '#4338ca', borderColor: '#4338ca' }}
                                >
                                    {downloadingFdsJson ? '⏳ กำลังเตรียม...' : '⬇️ ดาวน์โหลด FDS v3 (JSON)'}
                                </button>
                            </>
                        )}
                        <button onClick={onClose} style={{
                            background: '#f1f5f9',
                            border: 'none',
                            borderRadius: '50%',
                            width: 36,
                            height: 36,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            color: '#64748b',
                            fontSize: 20
                        }}>×</button>
                    </div>
                </div>

                {viewFormat === '16files' ? (
                    <>
                        {validation && (
                            <div style={{ padding: '12px 20px', borderBottom: '1px solid #e2e8f0', background: validation.valid ? '#ecfdf5' : '#fff7ed' }}>
                                <div style={{ fontWeight: 700, color: validation.valid ? '#047857' : '#c2410c' }}>
                                    {validation.valid
                                        ? `✓ Preflight ผ่าน — ${validation.totalRows.toLocaleString()} แถว พร้อมส่ง API`
                                        : `✗ Preflight ไม่ผ่าน — ${validation.errors.length} ข้อผิดพลาด`}
                                    {validation.warnings.length > 0 && ` / ${validation.warnings.length} คำเตือน`}
                                </div>
                                {!validation.valid && (
                                    <div style={{ maxHeight: 150, overflowY: 'auto', marginTop: 8, fontSize: 12, color: '#9a3412' }}>
                                        {validation.errors.slice(0, 50).map((issue, index) => (
                                            <button
                                                type="button"
                                                className="fdh-preview-error-link"
                                                key={`${issue.code}-${issue.file}-${issue.row}-${index}`}
                                                onClick={() => issue.file && setActiveTab(String(issue.file).toUpperCase())}
                                                disabled={!issue.file}
                                                title={issue.file ? `เปิดแฟ้ม ${issue.file}${issue.row ? ` แถว ${issue.row}` : ''}` : undefined}
                                            >
                                                {index + 1}. {issue.message}
                                            </button>
                                        ))}
                                        {validation.errors.length > 50 && <div>…และอีก {validation.errors.length - 50} รายการ</div>}
                                    </div>
                                )}
                                {validation.warnings.length > 0 && (
                                    <div className="fdh-preview-warning-list">
                                        {validation.warnings.slice(0, 50).map((issue, index) => (
                                            <button
                                                type="button"
                                                className="fdh-preview-warning-link"
                                                key={`warning-${issue.code}-${issue.file}-${issue.row}-${index}`}
                                                onClick={() => issue.file && setActiveTab(String(issue.file).toUpperCase())}
                                                disabled={!issue.file}
                                                title={issue.file ? `เปิดแฟ้ม ${issue.file}` : undefined}
                                            >
                                                ⚠ {issue.message}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Tabs */}
                        <div className="fdh-preview-tabs">
                            {folders.map(folder => {
                                const count = data[folder]?.length || 0;
                                const errorCount = errorsForFile(folder).length;
                                return (
                                    <button
                                        key={folder}
                                        onClick={() => setActiveTab(folder)}
                                        className={`modal-tab${activeTab === folder ? ' active' : ''}`}
                                        style={{ opacity: count > 0 ? 1 : 0.5 }}
                                    >
                                        {folder}
                                        {count > 0 && (
                                            <span className="modal-tab-count">
                                                {count}
                                            </span>
                                        )}
                                        {errorCount > 0 && (
                                            <span className="fdh-preview-tab-error" title={`${errorCount} ข้อผิดพลาด`}>
                                                ! {errorCount}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Content */}
                        <div className="fdh-preview-content">
                            <div className="modal-banner">
                                <span>แสดงตัวอย่างข้อมูลแฟ้ม <strong>{activeTab}</strong> - ทั้งหมด {data[activeTab]?.length || 0} รายการ</span>
                                <span style={{ fontSize: 11, opacity: 0.8 }}>เลื่อนซ้าย-ขวา เพื่อดูคอลัมน์ทั้งหมด</span>
                            </div>

                            <div className="modal-table-card">
                                {renderTable(activeTab)}
                            </div>
                        </div>
                    </>
                ) : (
                    /* FDS v3 JSON View */
                    <div className="fdh-preview-content" style={{ padding: 20 }}>
                        {loadingFdsV3 ? (
                            <div style={{ textAlign: 'center', padding: '60px 0', color: '#6366f1' }}>
                                <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>⏳</div>
                                <div style={{ fontWeight: 600 }}>กำลังแปลงข้อมูลสู่โครงสร้าง FDS v3.0.0.59...</div>
                            </div>
                        ) : fdsV3Data ? (
                            <div>
                                {/* Summary banner */}
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
                                    <div style={{ background: fdsV3Data.validation?.valid ? '#f0fdf4' : '#fff7ed', border: `1px solid ${fdsV3Data.validation?.valid ? '#86efac' : '#fdba74'}`, borderRadius: 8, padding: 12 }}>
                                        <div style={{ fontSize: 12, color: '#6b7280' }}>สถานะ FDS Pre-flight</div>
                                        <div style={{ fontSize: 16, fontWeight: 700, color: fdsV3Data.validation?.valid ? '#15803d' : '#c2410c' }}>
                                            {fdsV3Data.validation?.valid ? '✓ ผ่านเกณฑ์ FDS v3' : `⚠ พบข้อบกพร่อง (${fdsV3Data.validation?.errors?.length || 0})`}
                                        </div>
                                    </div>
                                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
                                        <div style={{ fontSize: 12, color: '#6b7280' }}>จำนวน Visits รวม</div>
                                        <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                                            {fdsV3Data.payload?.totalVisits?.total || 0} เคส
                                        </div>
                                    </div>
                                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
                                        <div style={{ fontSize: 12, color: '#6b7280' }}>แยกตามสิทธิหลัก</div>
                                        <div style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>
                                            UC: {fdsV3Data.validation?.ucVisits || 0} | OFC: {fdsV3Data.validation?.ofcVisits || 0} | SSS: {fdsV3Data.validation?.sssVisits || 0}
                                        </div>
                                    </div>
                                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
                                        <div style={{ fontSize: 12, color: '#6b7280' }}>Transaction ID (27 หลัก)</div>
                                        <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#4338ca', fontWeight: 600 }}>
                                            {fdsV3Data.payload?.transactionId || '-'}
                                        </div>
                                    </div>
                                </div>

                                {/* Validation issues list */}
                                {fdsV3Data.validation?.errors?.length > 0 && (
                                    <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 12, color: '#991b1b' }}>
                                        <div style={{ fontWeight: 700, marginBottom: 4 }}>ข้อผิดพลาดที่ต้องแก้ไขก่อนส่ง FDS API จริง:</div>
                                        {fdsV3Data.validation.errors.map((err: any, idx: number) => (
                                            <div key={idx}>• [{err.rule}] {err.vn ? `(${err.vn}) ` : ''}{err.message}</div>
                                        ))}
                                    </div>
                                )}
                                {fdsV3Data.validation?.warnings?.length > 0 && (
                                    <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 12, color: '#92400e' }}>
                                        <div style={{ fontWeight: 700, marginBottom: 4 }}>คำแนะนำเพิ่มเติมสำหรับ FDS v3:</div>
                                        {fdsV3Data.validation.warnings.map((w: any, idx: number) => (
                                            <div key={idx}>⚠ [{w.rule}] {w.vn ? `(${w.vn}) ` : ''}{w.message}</div>
                                        ))}
                                    </div>
                                )}

                                {/* JSON preview container */}
                                <div style={{ background: '#0f172a', borderRadius: 8, padding: 16, maxHeight: 420, overflowY: 'auto' }}>
                                    <pre style={{ margin: 0, color: '#e2e8f0', fontSize: 12, fontFamily: 'Consolas, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                        {JSON.stringify(fdsV3Data.payload, null, 2)}
                                    </pre>
                                </div>
                            </div>
                        ) : (
                            <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8' }}>
                                <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>📑</div>
                                <div style={{ fontWeight: 600 }}>พร้อมสร้างโครงสร้าง FDS v3</div>
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={() => void loadFdsV3()}
                                    style={{ marginTop: 12 }}
                                >
                                    🔄 โหลดตัวอย่าง FDS v3 JSON
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* Footer */}
                <div className="fdh-preview-footer">
                    <button className="btn btn-secondary" onClick={onClose}>ปิดหน้าต่างนี้</button>
                </div>
            </div>
        </div>
    );
};

````
