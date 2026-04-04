import React, { useState } from 'react';

interface FDHPreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    data: any;
    onDownload: () => void;
    isDownloading: boolean;
}

export const FDHPreviewModal: React.FC<FDHPreviewModalProps> = ({
    isOpen,
    onClose,
    data,
    onDownload,
    isDownloading
}) => {
    const [activeTab, setActiveTab] = useState('INS');
    
    if (!isOpen || !data) return null;

    const folders = ['INS', 'PAT', 'OPD', 'ORF', 'ODX', 'OOP', 'IPD', 'IRF', 'IDX', 'IOP', 'CHT', 'CHA', 'AER', 'ADP', 'LVD', 'DRU'];

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
                        {rows.map((row: any, idx: number) => (
                            <tr key={idx}>
                                <td style={{ textAlign: 'center', color: '#64748b', fontSize: 12 }}>{idx + 1}</td>
                                {columns.map(col => (
                                    <td key={col} style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{row[col] ?? ''}</td>
                                ))}
                            </tr>
                        ))}
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
                            className="btn btn-primary" 
                            onClick={onDownload} 
                            disabled={isDownloading}
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

                {/* Tabs */}
                <div className="fdh-preview-tabs">
                    {folders.map(folder => {
                        const count = data[folder]?.length || 0;
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
