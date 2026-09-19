import React, { useState, useEffect, useCallback, useMemo } from 'react';

interface Chapter {
  id: number;
  codeRange: string;
  title: string;
  thaiTitle: string;
}

interface FundTag {
  fundId: string;
  fundName: string;
  description: string;
}

interface PresetGroup {
  id: string;
  name: string;
  icon: string;
  description: string;
  fund: string;
  codes: string[];
  category?: number;
}

interface Icd9Item {
  code: string;
  name: string;
  chapter: Chapter | null;
  fundTags: FundTag[];
  usageCount?: number;
}

export const Icd9LookupPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'catalog' | 'topUsed' | 'chapters'>('catalog');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<number | ''>('');
  const [selectedFund, setSelectedFund] = useState<string>('');
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [presets, setPresets] = useState<PresetGroup[]>([]);
  const [results, setResults] = useState<Icd9Item[]>([]);
  const [topUsedList, setTopUsedList] = useState<Icd9Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [topLoading, setTopLoading] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  // Load presets and chapters on mount
  useEffect(() => {
    const fetchPresets = async () => {
      try {
        const res = await fetch('/api/icd9/presets');
        const data = await res.json();
        if (data.success) {
          setChapters(data.chapters || []);
          setPresets(data.presets || []);
        }
      } catch (err) {
        console.error('Failed to fetch ICD-9 presets:', err);
      }
    };
    fetchPresets();
  }, []);

  // Search function with debounce
  const executeSearch = useCallback(async (q: string, cat: number | '', fund: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (cat !== '') params.set('category', String(cat));
      if (fund) params.set('fund', fund);
      params.set('limit', '100');

      const res = await fetch(`/api/icd9/search?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setResults(data.results || []);
        setTotalCount(data.total || (data.results?.length ?? 0));
      } else {
        setResults([]);
        setTotalCount(0);
      }
    } catch (err) {
      console.error('Failed to search ICD-9:', err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce search input
  useEffect(() => {
    if (activeTab !== 'catalog') return;
    const timer = setTimeout(() => {
      executeSearch(searchQuery, selectedCategory, selectedFund);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, selectedCategory, selectedFund, activeTab, executeSearch]);

  // Load top-used procedures when switching to topUsed tab
  useEffect(() => {
    if (activeTab === 'topUsed' && topUsedList.length === 0) {
      const fetchTop = async () => {
        setTopLoading(true);
        try {
          const res = await fetch('/api/icd9/top-used?limit=60');
          const data = await res.json();
          if (data.success) {
            setTopUsedList(data.results || []);
          }
        } catch (err) {
          console.error('Failed to fetch top-used ICD-9:', err);
        } finally {
          setTopLoading(false);
        }
      };
      fetchTop();
    }
  }, [activeTab, topUsedList.length]);

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 1800);
  };

  const handlePresetClick = (preset: PresetGroup) => {
    setActiveTab('catalog');
    setSelectedFund(preset.fund);
    if (preset.category) {
      setSelectedCategory(preset.category);
    } else {
      setSelectedCategory('');
    }
    setSearchQuery('');
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedCategory('');
    setSelectedFund('');
  };

  const filteredTopUsed = useMemo(() => {
    if (!searchQuery) return topUsedList;
    const q = searchQuery.toLowerCase();
    return topUsedList.filter(
      (item) => item.code.toLowerCase().includes(q) || item.name.toLowerCase().includes(q)
    );
  }, [topUsedList, searchQuery]);

  return (
    <div className="page-container" style={{ padding: '1.25rem 2rem', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header Banner */}
      <div style={{
        background: 'linear-gradient(135deg, #1e3a8a 0%, #0284c7 100%)',
        borderRadius: '16px',
        padding: '1.75rem 2rem',
        color: '#ffffff',
        boxShadow: '0 8px 24px -4px rgba(2, 132, 199, 0.25)',
        marginBottom: '1.75rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '2.2rem' }}>🔍</span>
              <h1 style={{ margin: 0, fontSize: '1.8rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
                ค้นหารหัสหัตถการ ICD-9-CM (Procedure Lookup)
              </h1>
            </div>
            <p style={{ margin: 0, fontSize: '0.95rem', color: 'rgba(255,255,255,0.88)', maxWidth: '800px', lineHeight: 1.5 }}>
              ค้นหารหัสและชื่อหัตถการมาตรฐาน 16 หมวดหมู่ (ตามคู่มือ ICD-9-CM WHO/Wikipedia) พร้อมตรวจสอบเงื่อนไขกองทุนเบิกจ่ายเฉพาะทาง
              เช่น ผ่าตัดต้อกระจก, ส่องกล้องทางเดินอาหาร (Colonoscopy/EGD), ทันตกรรม ANC, วางแผนครอบครัว และ ODS
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(255,255,255,0.15)', padding: '0.35rem', borderRadius: '10px' }}>
            <button
              type="button"
              onClick={() => setActiveTab('catalog')}
              style={{
                background: activeTab === 'catalog' ? '#ffffff' : 'transparent',
                color: activeTab === 'catalog' ? '#0f172a' : '#ffffff',
                border: 'none',
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '0.9rem',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              🔎 ค้นหารหัสทั้งหมด
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('topUsed')}
              style={{
                background: activeTab === 'topUsed' ? '#ffffff' : 'transparent',
                color: activeTab === 'topUsed' ? '#0f172a' : '#ffffff',
                border: 'none',
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '0.9rem',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              ⭐ หัตถการใช้บ่อยใน รพ.
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('chapters')}
              style={{
                background: activeTab === 'chapters' ? '#ffffff' : 'transparent',
                color: activeTab === 'chapters' ? '#0f172a' : '#ffffff',
                border: 'none',
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '0.9rem',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              📚 16 หมวดหมู่หลัก
            </button>
          </div>
        </div>
      </div>

      {/* Preset Cards: Quick access to funds */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted, #64748b)', marginBottom: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          ⚡ กลุ่มหัตถการเบิกจ่ายยอดนิยม (Quick Presets)
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: '0.75rem'
        }}>
          {presets.map((preset) => {
            const isSelected = selectedFund === preset.fund;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handlePresetClick(preset)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.75rem 1rem',
                  background: isSelected ? 'var(--primary-light, #e0f2fe)' : 'var(--bg-surface, #ffffff)',
                  border: isSelected ? '2px solid #0284c7' : '1px solid var(--border-color, #e2e8f0)',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.15s ease',
                  boxShadow: isSelected ? '0 4px 12px rgba(2,132,199,0.15)' : '0 1px 3px rgba(0,0,0,0.05)'
                }}
              >
                <span style={{ fontSize: '1.5rem' }}>{preset.icon}</span>
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', color: isSelected ? '#0369a1' : 'var(--text-color, #1e293b)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                    {preset.name}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #64748b)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                    {preset.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Tab 1: Catalog Search */}
      {activeTab === 'catalog' && (
        <div>
          {/* Filter Bar */}
          <div style={{
            background: 'var(--bg-surface, #ffffff)',
            borderRadius: '14px',
            padding: '1.25rem',
            border: '1px solid var(--border-color, #e2e8f0)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            marginBottom: '1.25rem',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1rem',
            alignItems: 'flex-end'
          }}>
            {/* Search Input */}
            <div style={{ flex: '2 1 280px' }}>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-muted, #475569)', marginBottom: '0.35rem' }}>
                พิมพ์รหัสหรือชื่อหัตถการ (ICD-9 Code / Name)
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="เช่น 13.41, 45.23, phaco, colonoscopy, dental..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.65rem 1rem 0.65rem 2.5rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color, #cbd5e1)',
                    fontSize: '0.95rem',
                    boxSizing: 'border-box'
                  }}
                />
                <span style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>
                  🔎
                </span>
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    style={{
                      position: 'absolute',
                      right: '0.75rem',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      border: 'none',
                      background: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      fontSize: '0.9rem'
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Chapter Dropdown */}
            <div style={{ flex: '1.5 1 240px' }}>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-muted, #475569)', marginBottom: '0.35rem' }}>
                หมวดหมู่หลัก (16 Chapters)
              </label>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value === '' ? '' : Number(e.target.value))}
                style={{
                  width: '100%',
                  padding: '0.65rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  fontSize: '0.9rem',
                  background: 'var(--bg-surface, #ffffff)'
                }}
              >
                <option value="">ทุกหมวดหมู่ (All Chapters)</option>
                {chapters.map((chap) => (
                  <option key={chap.id} value={chap.id}>
                    Ch.{chap.id < 10 ? `0${chap.id}` : chap.id} ({chap.codeRange}) {chap.thaiTitle} - {chap.title}
                  </option>
                ))}
              </select>
            </div>

            {/* Fund Filter Dropdown */}
            <div style={{ flex: '1 1 180px' }}>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-muted, #475569)', marginBottom: '0.35rem' }}>
                กองทุนเฉพาะทาง
              </label>
              <select
                value={selectedFund}
                onChange={(e) => setSelectedFund(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.65rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  fontSize: '0.9rem',
                  background: 'var(--bg-surface, #ffffff)'
                }}
              >
                <option value="">ทุกกองทุน (ทั้งหมด)</option>
                <option value="cataract">👁️ กองทุนต้อกระจก</option>
                <option value="endoscopy">🔬 กองทุนส่องกล้อง GI</option>
                <option value="anc_dental">🦷 กองทุนทันตกรรม ANC</option>
                <option value="fp">💊 กองทุนวางแผนครอบครัว</option>
                <option value="ods">🏥 ผ่าตัดวันเดียวกลับ (ODS)</option>
              </select>
            </div>

            {/* Reset Button */}
            {(searchQuery || selectedCategory !== '' || selectedFund) && (
              <button
                type="button"
                onClick={handleResetFilters}
                style={{
                  padding: '0.65rem 1rem',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  background: '#f1f5f9',
                  color: '#475569',
                  fontWeight: 600,
                  fontSize: '0.88rem',
                  cursor: 'pointer'
                }}
              >
                ล้างตัวกรอง
              </button>
            )}
          </div>

          {/* Results Summary Bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', padding: '0 0.25rem' }}>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted, #64748b)' }}>
              {loading ? (
                <span>⏳ กำลังค้นหาข้อมูล...</span>
              ) : (
                <span>พบ <strong>{results.length}</strong> รายการ {totalCount > results.length ? `(จากทั้งหมด ${totalCount} รายการ)` : ''}</span>
              )}
            </div>
            {copiedCode && (
              <div style={{
                background: '#10b981',
                color: '#ffffff',
                padding: '0.25rem 0.75rem',
                borderRadius: '6px',
                fontSize: '0.82rem',
                fontWeight: 700,
                boxShadow: '0 2px 6px rgba(16,185,129,0.3)'
              }}>
                ✓ คัดลอกรหัส {copiedCode} สำเร็จ!
              </div>
            )}
          </div>

          {/* Table Container */}
          <div style={{
            background: 'var(--bg-surface, #ffffff)',
            borderRadius: '14px',
            border: '1px solid var(--border-color, #e2e8f0)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            overflow: 'hidden'
          }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    <th style={{ padding: '0.85rem 1rem', width: '120px', fontWeight: 700, color: '#475569' }}>รหัส ICD-9</th>
                    <th style={{ padding: '0.85rem 1rem', fontWeight: 700, color: '#475569' }}>ชื่อหัตถการ (Procedure Name)</th>
                    <th style={{ padding: '0.85rem 1rem', width: '220px', fontWeight: 700, color: '#475569' }}>หมวดหมู่ (Chapter)</th>
                    <th style={{ padding: '0.85rem 1rem', width: '260px', fontWeight: 700, color: '#475569' }}>กองทุนที่เกี่ยวข้อง</th>
                    <th style={{ padding: '0.85rem 1rem', width: '90px', textAlign: 'center', fontWeight: 700, color: '#475569' }}>คำสั่ง</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && results.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>
                        <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>⏳</div>
                        กำลังค้นหาข้อมูลรหัสหัตถการ...
                      </td>
                    </tr>
                  ) : results.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>
                        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔍</div>
                        ไม่พบรหัสหัตถการที่ตรงกับคำค้นหา
                        <div style={{ fontSize: '0.85rem', marginTop: '0.35rem', color: '#64748b' }}>
                          ลองเปลี่ยนคำค้นหา หรือเลือกล้างตัวกรอง
                        </div>
                      </td>
                    </tr>
                  ) : (
                    results.map((item) => {
                      const isCopied = copiedCode === item.code;
                      return (
                        <tr
                          key={item.code}
                          style={{
                            borderBottom: '1px solid #f1f5f9',
                            transition: 'background 0.12s ease',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                        >
                          <td style={{ padding: '0.85rem 1rem', whiteSpace: 'nowrap' }}>
                            <span style={{
                              display: 'inline-block',
                              background: '#eff6ff',
                              color: '#1d4ed8',
                              border: '1px solid #bfdbfe',
                              padding: '0.2rem 0.55rem',
                              borderRadius: '6px',
                              fontWeight: 800,
                              fontFamily: 'monospace',
                              fontSize: '0.95rem'
                            }}>
                              {item.code}
                            </span>
                          </td>
                          <td style={{ padding: '0.85rem 1rem' }}>
                            <div style={{ fontWeight: 600, color: '#1e293b' }}>{item.name}</div>
                          </td>
                          <td style={{ padding: '0.85rem 1rem' }}>
                            {item.chapter ? (
                              <div>
                                <span style={{
                                  display: 'inline-block',
                                  fontSize: '0.78rem',
                                  fontWeight: 700,
                                  background: '#f1f5f9',
                                  color: '#475569',
                                  padding: '0.15rem 0.45rem',
                                  borderRadius: '4px',
                                  marginBottom: '0.2rem'
                                }}>
                                  Ch.{item.chapter.id < 10 ? `0${item.chapter.id}` : item.chapter.id} ({item.chapter.codeRange})
                                </span>
                                <div style={{ fontSize: '0.82rem', color: '#64748b' }}>
                                  {item.chapter.thaiTitle}
                                </div>
                              </div>
                            ) : (
                              <span style={{ color: '#94a3b8', fontSize: '0.82rem' }}>-</span>
                            )}
                          </td>
                          <td style={{ padding: '0.85rem 1rem' }}>
                            {item.fundTags && item.fundTags.length > 0 ? (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                                {item.fundTags.map((tag) => (
                                  <span
                                    key={tag.fundId}
                                    title={tag.description}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      fontSize: '0.78rem',
                                      fontWeight: 700,
                                      background: tag.fundId === 'cataract' ? '#dbeafe' :
                                                  tag.fundId === 'endoscopy' ? '#e0e7ff' :
                                                  tag.fundId === 'anc_dental' ? '#fef3c7' :
                                                  tag.fundId === 'fp' ? '#fce7f3' : '#dcfce7',
                                      color: tag.fundId === 'cataract' ? '#1e40af' :
                                             tag.fundId === 'endoscopy' ? '#3730a3' :
                                             tag.fundId === 'anc_dental' ? '#92400e' :
                                             tag.fundId === 'fp' ? '#9d174d' : '#166534',
                                      border: '1px solid rgba(0,0,0,0.08)',
                                      padding: '0.15rem 0.5rem',
                                      borderRadius: '12px'
                                    }}
                                  >
                                    🏷️ {tag.fundName}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span style={{ color: '#cbd5e1', fontSize: '0.82rem' }}>หัตถการทั่วไป</span>
                            )}
                          </td>
                          <td style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => handleCopy(item.code)}
                              title="คลิกเพื่อคัดลอกรหัส ICD-9"
                              style={{
                                background: isCopied ? '#10b981' : '#f8fafc',
                                color: isCopied ? '#ffffff' : '#334155',
                                border: `1px solid ${isCopied ? '#10b981' : '#cbd5e1'}`,
                                borderRadius: '6px',
                                padding: '0.35rem 0.65rem',
                                fontSize: '0.8rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              {isCopied ? '✓ ก๊อปปี้แล้ว' : '📋 ก๊อปปี้'}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Main Tab 2: Top Used Procedures */}
      {activeTab === 'topUsed' && (
        <div>
          <div style={{
            background: 'var(--bg-surface, #ffffff)',
            borderRadius: '14px',
            padding: '1.25rem',
            border: '1px solid var(--border-color, #e2e8f0)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem'
          }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#1e293b' }}>
                ⭐ หัตถการ ICD-9 ที่มีการลงบันทึกบ่อยที่สุดในโรงพยาบาล
              </h2>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                รวบรวมจากตาราง doctor_operation (OPD/หัตถการแพทย์) และ iptoprt (IPD/การผ่าตัดผู้ป่วยใน)
              </p>
            </div>
            <div style={{ minWidth: '240px' }}>
              <input
                type="text"
                placeholder="กรองในรายการใช้บ่อย..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.55rem 0.85rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  fontSize: '0.9rem'
                }}
              />
            </div>
          </div>

          {/* Top Used Table */}
          <div style={{
            background: 'var(--bg-surface, #ffffff)',
            borderRadius: '14px',
            border: '1px solid var(--border-color, #e2e8f0)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            overflow: 'hidden'
          }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    <th style={{ padding: '0.85rem 1rem', width: '70px', textAlign: 'center', fontWeight: 700, color: '#475569' }}>อันดับ</th>
                    <th style={{ padding: '0.85rem 1rem', width: '120px', fontWeight: 700, color: '#475569' }}>รหัส ICD-9</th>
                    <th style={{ padding: '0.85rem 1rem', fontWeight: 700, color: '#475569' }}>ชื่อหัตถการ</th>
                    <th style={{ padding: '0.85rem 1rem', width: '200px', fontWeight: 700, color: '#475569' }}>หมวดหมู่</th>
                    <th style={{ padding: '0.85rem 1rem', width: '220px', fontWeight: 700, color: '#475569' }}>กองทุนที่เข้าข่าย</th>
                    <th style={{ padding: '0.85rem 1rem', width: '120px', textAlign: 'right', fontWeight: 700, color: '#475569' }}>จำนวนที่บันทึก</th>
                    <th style={{ padding: '0.85rem 1rem', width: '90px', textAlign: 'center', fontWeight: 700, color: '#475569' }}>คำสั่ง</th>
                  </tr>
                </thead>
                <tbody>
                  {topLoading ? (
                    <tr>
                      <td colSpan={7} style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>
                        <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>⏳</div>
                        กำลังประมวลผลหัตถการใช้บ่อยจากฐานข้อมูล...
                      </td>
                    </tr>
                  ) : filteredTopUsed.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>
                        ยังไม่มีข้อมูลสถิติการใช้หัตถการในระบบ
                      </td>
                    </tr>
                  ) : (
                    filteredTopUsed.map((item, idx) => {
                      const isCopied = copiedCode === item.code;
                      return (
                        <tr
                          key={item.code}
                          style={{
                            borderBottom: '1px solid #f1f5f9',
                            transition: 'background 0.12s ease',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                        >
                          <td style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: '26px',
                              height: '26px',
                              borderRadius: '50%',
                              background: idx < 3 ? '#fef08a' : '#f1f5f9',
                              color: idx < 3 ? '#854d0e' : '#64748b',
                              fontWeight: 800,
                              fontSize: '0.8rem'
                            }}>
                              {idx + 1}
                            </span>
                          </td>
                          <td style={{ padding: '0.85rem 1rem', whiteSpace: 'nowrap' }}>
                            <span style={{
                              display: 'inline-block',
                              background: '#eff6ff',
                              color: '#1d4ed8',
                              border: '1px solid #bfdbfe',
                              padding: '0.2rem 0.55rem',
                              borderRadius: '6px',
                              fontWeight: 800,
                              fontFamily: 'monospace',
                              fontSize: '0.95rem'
                            }}>
                              {item.code}
                            </span>
                          </td>
                          <td style={{ padding: '0.85rem 1rem' }}>
                            <div style={{ fontWeight: 600, color: '#1e293b' }}>{item.name}</div>
                          </td>
                          <td style={{ padding: '0.85rem 1rem' }}>
                            {item.chapter ? (
                              <span style={{ fontSize: '0.82rem', color: '#475569' }}>
                                {item.chapter.thaiTitle}
                              </span>
                            ) : (
                              <span style={{ color: '#94a3b8' }}>-</span>
                            )}
                          </td>
                          <td style={{ padding: '0.85rem 1rem' }}>
                            {item.fundTags && item.fundTags.length > 0 ? (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                                {item.fundTags.map((tag) => (
                                  <span
                                    key={tag.fundId}
                                    title={tag.description}
                                    style={{
                                      display: 'inline-block',
                                      fontSize: '0.75rem',
                                      fontWeight: 700,
                                      background: '#e0f2fe',
                                      color: '#0369a1',
                                      padding: '0.15rem 0.45rem',
                                      borderRadius: '10px'
                                    }}
                                  >
                                    🏷️ {tag.fundName}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span style={{ color: '#cbd5e1', fontSize: '0.82rem' }}>-</span>
                            )}
                          </td>
                          <td style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>
                            <span style={{ fontWeight: 700, color: '#047857', fontSize: '0.95rem' }}>
                              {(item.usageCount ?? 0).toLocaleString()}
                            </span>
                            <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginLeft: '0.25rem' }}>ครั้ง</span>
                          </td>
                          <td style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => handleCopy(item.code)}
                              style={{
                                background: isCopied ? '#10b981' : '#f8fafc',
                                color: isCopied ? '#ffffff' : '#334155',
                                border: `1px solid ${isCopied ? '#10b981' : '#cbd5e1'}`,
                                borderRadius: '6px',
                                padding: '0.35rem 0.65rem',
                                fontSize: '0.8rem',
                                fontWeight: 700,
                                cursor: 'pointer'
                              }}
                            >
                              {isCopied ? '✓' : '📋'}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Main Tab 3: 16 Chapters Guide */}
      {activeTab === 'chapters' && (
        <div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '1rem'
          }}>
            {chapters.map((chap) => (
              <div
                key={chap.id}
                style={{
                  background: 'var(--bg-surface, #ffffff)',
                  borderRadius: '12px',
                  border: '1px solid var(--border-color, #e2e8f0)',
                  padding: '1.25rem',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span style={{
                      background: '#e0f2fe',
                      color: '#0369a1',
                      fontWeight: 800,
                      fontSize: '0.8rem',
                      padding: '0.2rem 0.5rem',
                      borderRadius: '6px'
                    }}>
                      Chapter {chap.id < 10 ? `0${chap.id}` : chap.id}
                    </span>
                    <span style={{
                      fontFamily: 'monospace',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      color: '#64748b'
                    }}>
                      รหัส {chap.codeRange}
                    </span>
                  </div>
                  <h3 style={{ margin: '0.25rem 0', fontSize: '1.05rem', fontWeight: 700, color: '#1e293b' }}>
                    {chap.thaiTitle}
                  </h3>
                  <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>
                    {chap.title}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategory(chap.id);
                    setSelectedFund('');
                    setSearchQuery('');
                    setActiveTab('catalog');
                  }}
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    padding: '0.5rem',
                    color: '#0284c7',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    textAlign: 'center'
                  }}
                >
                  🔍 ดูรหัสทั้งหมดในหมวดนี้ →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Icd9LookupPage;
