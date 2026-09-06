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
}) => {
    const [activeTab, setActiveTab] = useState('INS');
    
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
                        <h2 style={{ margin: 0, fontSize: 18, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: '1.4rem' }}>📊</span> 
                            MOPH Finance Data Viewer (FDH 16 แฟ้ม)
                            <span className="badge badge-info" style={{ fontSize: 12 }}>{Object.values(data).reduce((acc: number, val: any) => acc + (val?.length || 0), 0)} แถวรวม</span>
                        </h2>
                        <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#64748b' }}>
                            ตรวจสอบความถูกต้องของข้อมูล Pipe-Delimited ก่อนการส่งออกไฟล์ ZIP
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
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

                {/* Footer */}
                <div className="fdh-preview-footer">
                    <button className="btn btn-secondary" onClick={onClose}>ปิดหน้าต่างนี้</button>
                </div>
            </div>
        </div>
    );
};
