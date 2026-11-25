import React, { useEffect, useMemo, useRef, useState } from 'react';
import './FDHImportStatusPage.css';

interface ImportResultItem {
  transaction_uid: string;
  request_payload: Record<string, unknown>;
  response_payload: Record<string, unknown>;
  response_status?: number;
  response_message?: string;
  response_message_th?: string;
}

interface ImportLogItem {
  id: number | string;
  transaction_uid: string;
  hcode: string;
  environment: string;
  response_status?: number;
  response_message?: string;
  response_message_th?: string;
  imported_at: string;
  source?: 'track_trans' | 'reservation' | string;
}

interface FdhApiSettings {
  environment?: 'prd' | 'uat';
  hcode?: string;
  tokenUrl?: string;
  apiBaseUrl?: string;
  upload16Url?: string;
  preScreenUrl?: string;
  username?: string;
}

export const FDHImportStatusPage: React.FC = () => {
  const [jwtToken, setJwtToken] = useState('');
  const [transactionUidText, setTransactionUidText] = useState('');
  const [hcode, setHcode] = useState('');
  const [environment, setEnvironment] = useState<'prd' | 'uat'>('prd');
  const [loading, setLoading] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [results, setResults] = useState<ImportResultItem[]>([]);
  const [logs, setLogs] = useState<ImportLogItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [requestingToken, setRequestingToken] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [fdhSettings, setFdhSettings] = useState<FdhApiSettings | null>(null);

  // Date-range import state
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 8) + '01';
  const [dateRangeStart, setDateRangeStart] = useState(firstOfMonth);
  const [dateRangeEnd, setDateRangeEnd] = useState(today);
  const [dateRangeScope, setDateRangeScope] = useState<'uc' | 'all'>('uc');
  const [dateRangeImporting, setDateRangeImporting] = useState(false);
  const cancelDateImportRef = useRef(false);
  const abortDateImportRef = useRef<AbortController | null>(null);
  const [dateImportProgress, setDateImportProgress] = useState<{
    phase: 'listing' | 'running' | 'done' | 'stopped';
    total: number;
    processed: number;
    found: number;
    notFound: number;
    skipped: number;
    errors: number;
    currentBatch: number;
    totalBatches: number;
    currentItems: Array<{ vn: string; an: string; vstdate: string; hipdataCode: string }>;
    startedAt: number;
    etaSeconds: number | null;
    recentFeed: Array<{
      vn: string;
      vstdate: string;
      hipdataCode: string;
      found: boolean;
      httpStatus: number;
      message: string;
    }>;
  } | null>(null);
  const [dateRangeResult, setDateRangeResult] = useState<{
    done: boolean;
    success?: boolean;
    summary?: { total: number; updated: number; skipped: number; errors: number; errorMessages: string[] };
    error?: string;
  }>({ done: false });

  const transactionUids = useMemo(
    () => transactionUidText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    [transactionUidText]
  );

  const effectiveHcode = (hcode || fdhSettings?.hcode || '').trim();

  const fetchSettingsAndLogs = async () => {
    try {
      setLogsLoading(true);
      const [settingsRes, logsRes] = await Promise.all([
        fetch('/api/config/fdh-api-settings'),
        fetch('/api/fdh/import-status/logs'),
      ]);

      const settingsJson = await settingsRes.json();
      const logsJson = await logsRes.json();

      if (settingsJson?.data) {
        setFdhSettings(settingsJson.data || null);
        setHcode(settingsJson.data.hcode || '');
        setEnvironment(settingsJson.data.environment || 'prd');
      }

      if (logsJson?.success) {
        setLogs(logsJson.data || []);
      }
    } catch {
      // Keep page usable even if settings/logs fail
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    void fetchSettingsAndLogs();
  }, []);

  const handleImportStatus = async () => {
    if (!jwtToken.trim()) {
      setError('กรุณากรอก JWT token จาก FDH ก่อน');
      return;
    }

    if (!effectiveHcode) {
      setError('กรุณากรอก HCODE');
      return;
    }

    if (transactionUids.length === 0) {
      setError('กรุณากรอก transaction_uid อย่างน้อย 1 รายการ');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/fdh/import-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jwtToken: jwtToken.trim(),
          hcode: effectiveHcode,
          environment,
          transactionUids,
        }),
      });

      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.error || 'ไม่สามารถนำเข้าสถานะจาก FDH ได้');
      }

      setResults(json.data || []);
      await fetchSettingsAndLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการนำเข้าสถานะ');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestToken = async () => {
    try {
      setRequestingToken(true);
      setError(null);
      setConnectionMessage(null);
      const response = await fetch('/api/fdh/request-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment })
      });

      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.error || 'ไม่สามารถขอ token อัตโนมัติได้');
      }

      setJwtToken(json.token || '');
      setConnectionMessage('เชื่อมต่อ FDH token endpoint สำเร็จ และเติม token ให้แล้ว');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการขอ token');
    } finally {
      setRequestingToken(false);
    }
  };

  const handleTestConnection = async () => {
    try {
      setTestingConnection(true);
      setError(null);
      setConnectionMessage(null);
      const response = await fetch('/api/fdh/request-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment, hcode })
      });

      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.error || 'ทดสอบการเชื่อมต่อ FDH ไม่สำเร็จ');
      }

      if (typeof json.token === 'string' && json.token.trim()) {
        setJwtToken(json.token.trim());
      }

      setConnectionMessage(`ทดสอบการเชื่อมต่อสำเร็จ (${environment.toUpperCase()}) สำหรับ HCODE ${effectiveHcode || '-'}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการทดสอบการเชื่อมต่อ');
    } finally {
      setTestingConnection(false);
    }
  };

  const handleStopDateRangeImport = () => {
    cancelDateImportRef.current = true;
    abortDateImportRef.current?.abort();
  };

  const handleDateRangeImport = async () => {
    if (!dateRangeStart || !dateRangeEnd) {
      setDateRangeResult({ done: true, success: false, error: 'กรุณาระบุช่วงวันที่' });
      return;
    }

    cancelDateImportRef.current = false;
    const controller = new AbortController();
    abortDateImportRef.current = controller;
    const startedAt = Date.now();
    const CHUNK_SIZE = 10;
    let hadAnyProcessed = false;

    try {
      setDateRangeImporting(true);
      setResults([]);
      setDateRangeResult({ done: false });
      setDateImportProgress({
        phase: 'listing',
        total: 0,
        processed: 0,
        found: 0,
        notFound: 0,
        skipped: 0,
        errors: 0,
        currentBatch: 0,
        totalBatches: 0,
        currentItems: [],
        startedAt,
        etaSeconds: null,
        recentFeed: [],
      });

      const candRes = await fetch(
        `/api/fdh/import-status/candidates?startDate=${encodeURIComponent(dateRangeStart)}&endDate=${encodeURIComponent(dateRangeEnd)}&scope=${dateRangeScope}`,
        { signal: controller.signal }
      );
      const candJson = await candRes.json();
      if (!candRes.ok || !candJson?.success) {
        throw new Error(candJson?.error || 'ไม่สามารถดึงรายชื่อเคสในช่วงวันที่ได้');
      }

      const items: Array<{ vn: string; an: string; vstdate: string; hipdataCode: string; pttypeName: string }> =
        Array.isArray(candJson.items) ? candJson.items : [];
      const total = items.length;
      const totalBatches = Math.ceil(total / CHUNK_SIZE);

      if (total === 0) {
        setDateImportProgress((prev) => (prev ? { ...prev, phase: 'done', total: 0 } : prev));
        setDateRangeResult({
          done: true,
          success: true,
          summary: { total: 0, updated: 0, skipped: 0, errors: 0, errorMessages: [] },
        });
        return;
      }

      let processed = 0;
      let found = 0;
      let notFound = 0;
      let skipped = 0;
      let errors = 0;
      const allErrorMessages: string[] = [];
      let latestResults: ImportResultItem[] = [];
      let recentFeed: Array<{
        vn: string;
        vstdate: string;
        hipdataCode: string;
        found: boolean;
        httpStatus: number;
        message: string;
      }> = [];

      for (let i = 0; i < total; i += CHUNK_SIZE) {
        if (cancelDateImportRef.current) break;

        const chunk = items.slice(i, i + CHUNK_SIZE);
        const batchNum = Math.floor(i / CHUNK_SIZE) + 1;

        setDateImportProgress((prev) =>
          prev
            ? {
                ...prev,
                phase: 'running',
                total,
                totalBatches,
                currentBatch: batchNum,
                currentItems: chunk,
              }
            : prev
        );

        const trackRes = await fetch('/api/fdh/track-vns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vns: chunk.map((c) => c.vn) }),
          signal: controller.signal,
        });
        const trackJson = await trackRes.json();
        if (!trackRes.ok || !trackJson?.success) {
          throw new Error(trackJson?.error || 'เกิดข้อผิดพลาดระหว่างดึงสถานะ FDH');
        }

        const s = trackJson.summary || {};
        const resultsArr: Array<{
          vn: string;
          found?: boolean;
          message: string;
          httpStatus: number;
        }> = Array.isArray(s.results) ? s.results : [];

        const itemMap = new Map(chunk.map((c) => [c.vn, c]));
        let batchFound = 0;
        let batchNotFound = 0;
        const batchResultItems: ImportResultItem[] = [];
        const newFeedItems = resultsArr.map((r) => {
          const meta = itemMap.get(r.vn);
          const isFound = Boolean(r.found);
          if (isFound) batchFound += 1;
          else if (r.httpStatus === 200 || r.httpStatus === 404) batchNotFound += 1;
          batchResultItems.push({
            transaction_uid: `VN ${r.vn}${meta?.an ? ` (AN ${meta.an})` : ''}`,
            request_payload: { vn: r.vn, vstdate: meta?.vstdate || '' },
            response_payload: { found: isFound, httpStatus: r.httpStatus },
            response_status: r.httpStatus,
            response_message: [meta?.vstdate, meta?.hipdataCode].filter(Boolean).join(' · ') || 'track_trans',
            response_message_th: r.message || '-',
          });
          return {
            vn: r.vn,
            vstdate: meta?.vstdate || '',
            hipdataCode: meta?.hipdataCode || '',
            found: isFound,
            httpStatus: r.httpStatus,
            message: r.message || '-',
          };
        });

        processed += chunk.length;
        if (processed > 0) hadAnyProcessed = true;
        found += batchFound;
        notFound += batchNotFound;
        skipped += Number(s.skipped || 0);
        errors += Number(s.errors || 0);
        if (Array.isArray(s.errorMessages)) {
          for (const em of s.errorMessages) {
            if (allErrorMessages.length < 10) allErrorMessages.push(String(em));
          }
        }
        latestResults = [...batchResultItems.reverse(), ...latestResults].slice(0, 200);
        setResults(latestResults);
        recentFeed = [...newFeedItems.reverse(), ...recentFeed].slice(0, 15);

        const elapsedSec = (Date.now() - startedAt) / 1000;
        const rate = processed > 0 ? processed / Math.max(elapsedSec, 0.2) : 0;
        const etaSeconds = rate > 0 && processed < total ? Math.max(1, Math.round((total - processed) / rate)) : 0;

        setDateImportProgress({
          phase: processed >= total ? 'done' : 'running',
          total,
          processed,
          found,
          notFound,
          skipped,
          errors,
          currentBatch: batchNum,
          totalBatches,
          currentItems: processed >= total ? [] : chunk,
          startedAt,
          etaSeconds,
          recentFeed,
        });
      }

      const wasStopped = cancelDateImportRef.current;
      if (wasStopped) {
        setDateImportProgress((prev) => (prev ? { ...prev, phase: 'stopped', currentItems: [], etaSeconds: 0 } : prev));
      }

      setDateRangeResult({
        done: true,
        success: true,
        summary: {
          total,
          updated: found + notFound,
          skipped,
          errors,
          errorMessages: allErrorMessages,
        },
      });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError' || cancelDateImportRef.current) {
        setDateImportProgress((prev) => (prev ? { ...prev, phase: 'stopped', currentItems: [], etaSeconds: 0 } : prev));
      } else {
        setDateRangeResult({ done: true, success: false, error: err instanceof Error ? err.message : 'เกิดข้อผิดพลาด' });
      }
    } finally {
      abortDateImportRef.current = null;
      setDateRangeImporting(false);
      if (hadAnyProcessed) {
        void fetchSettingsAndLogs();
      }
    }
  };

  const maskedToken = useMemo(() => {
    if (!jwtToken.trim()) return 'ยังไม่มี token';
    if (jwtToken.length <= 18) return jwtToken;
    return `${jwtToken.slice(0, 12)}...${jwtToken.slice(-6)}`;
  }, [jwtToken]);

  const settingsSummary = useMemo(() => ({
    hcode: hcode || fdhSettings?.hcode || '-',
    user: fdhSettings?.username || '-',
    tokenUrl: fdhSettings?.tokenUrl || 'https://fdh.moph.go.th/token?Action=get_moph_access_token',
    upload16Url: fdhSettings?.upload16Url || 'https://fdh.moph.go.th/api/v2/data_hub/16_files',
    preScreenUrl: fdhSettings?.preScreenUrl || 'https://fdh.moph.go.th/api/v1/auth/open_api/fda/file',
    apiBaseUrl: fdhSettings?.apiBaseUrl || 'https://fdh.moph.go.th'
  }), [fdhSettings, hcode]);

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">📥 นำเข้าสถานะจาก FDH</h1>
        <p className="page-subtitle">
          ดึงสถานะการเบิกจาก FDH ตามช่วงวันที่ (<code>track_trans</code>) หรือดึงรายรายการด้วย <code>transaction_uid</code> ผ่าน <code>/api/v2/reservation/get</code>
        </p>
      </div>

      {/* Date-range import section (primary) */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">🔽 นำเข้าสถานะ FDH ตามช่วงวันที่ (track_trans)</div>
        </div>
        <div className="card-body">
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            <span>ℹ️</span>
            <span>
              ดึงสถานะการเบิกจาก FDH (<code>track_trans</code>) สำหรับทุก VN ในช่วงวันที่ที่เลือก — ใช้ username/password จากการตั้งค่า FDH API โดยไม่ต้องป้อน token
            </span>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">วันที่เริ่มต้น</label>
              <input
                type="date"
                className="form-control"
                value={dateRangeStart}
                onChange={(e) => setDateRangeStart(e.target.value)}
                disabled={dateRangeImporting}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">วันที่สิ้นสุด</label>
              <input
                type="date"
                className="form-control"
                value={dateRangeEnd}
                onChange={(e) => setDateRangeEnd(e.target.value)}
                disabled={dateRangeImporting}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">ขอบเขตสิทธิ</label>
              <select
                className="form-control"
                value={dateRangeScope}
                onChange={(e) => setDateRangeScope(e.target.value as 'uc' | 'all')}
                disabled={dateRangeImporting}
              >
                <option value="uc">เฉพาะสิทธิ UC / WEL (แนะนำ)</option>
                <option value="all">ทุกสิทธิในวันรับบริการ</option>
              </select>
            </div>
            <button
              className="btn btn-primary"
              onClick={handleDateRangeImport}
              disabled={dateRangeImporting}
              style={{ minWidth: 170 }}
            >
              {dateRangeImporting ? '⟳ กำลังนำเข้า...' : '🔽 นำเข้าสถานะ FDH'}
            </button>
            {dateRangeImporting && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleStopDateRangeImport}
                style={{ minWidth: 120 }}
              >
                ⏹️ หยุดนำเข้า
              </button>
            )}
          </div>

          {dateImportProgress && (() => {
            const pct = dateImportProgress.total > 0
              ? Math.min(100, Math.round((dateImportProgress.processed / dateImportProgress.total) * 100))
              : 0;
            const radius = 34;
            const circumference = 2 * Math.PI * radius;
            const dashOffset = circumference - (pct / 100) * circumference;
            const phaseLabel =
              dateImportProgress.phase === 'listing'
                ? 'กำลังรวบรวมรายชื่อเคสจาก HOSxP...'
                : dateImportProgress.phase === 'done'
                  ? 'นำเข้าสถานะ FDH ครบถ้วนแล้ว'
                  : dateImportProgress.phase === 'stopped'
                    ? 'หยุดการนำเข้าชั่วคราว (บันทึกส่วนที่ดึงไปแล้วลงฐานข้อมูลแล้ว)'
                    : `กำลังตรวจสอบชุดที่ ${dateImportProgress.currentBatch}/${dateImportProgress.totalBatches} (${dateImportProgress.processed.toLocaleString()} / ${dateImportProgress.total.toLocaleString()} เคส)`;
            return (
              <div className="fdh-progress-panel" style={{ marginBottom: 14 }}>
                <div className="fdh-progress-hero">
                  <div className="fdh-ring-wrap">
                    <svg className="fdh-ring-svg" viewBox="0 0 84 84">
                      <circle className="fdh-ring-bg" cx="42" cy="42" r={radius} />
                      <circle
                        className={`fdh-ring-fill ${dateImportProgress.phase === 'done' ? 'is-done' : dateImportProgress.phase === 'stopped' ? 'is-stopped' : ''}`}
                        cx="42"
                        cy="42"
                        r={radius}
                        strokeDasharray={circumference}
                        strokeDashoffset={dashOffset}
                      />
                    </svg>
                    <div className="fdh-ring-text">
                      <span>{pct}%</span>
                      <span className="fdh-ring-sub">{dateImportProgress.processed}/{dateImportProgress.total}</span>
                    </div>
                  </div>

                  <div className="fdh-progress-meta">
                    <div className="fdh-progress-title-row">
                      <div className="fdh-progress-title">
                        {(dateImportProgress.phase === 'listing' || dateImportProgress.phase === 'running') && (
                          <span className="fdh-pulse-dot" />
                        )}
                        <span>{phaseLabel}</span>
                      </div>
                      {dateImportProgress.phase === 'running' && dateImportProgress.etaSeconds != null && dateImportProgress.etaSeconds > 0 && (
                        <span className="badge badge-info">เหลืออีก ~{dateImportProgress.etaSeconds} วินาที</span>
                      )}
                    </div>

                    <div className="fdh-bar-track">
                      <div
                        className={`fdh-bar-fill ${dateImportProgress.phase === 'done' ? 'is-done' : dateImportProgress.phase === 'stopped' ? 'is-stopped' : ''}`}
                        style={{ width: `${dateImportProgress.phase === 'listing' ? 8 : pct}%` }}
                      />
                    </div>

                    {dateImportProgress.currentItems.length > 0 && (
                      <div className="fdh-current-strip">
                        <span>🔎 กำลังดึง VN:</span>
                        {dateImportProgress.currentItems.slice(0, 5).map((item) => (
                          <span key={item.vn} className="fdh-vn-chip">
                            {item.vn} ({item.vstdate})
                          </span>
                        ))}
                        {dateImportProgress.currentItems.length > 5 && (
                          <span>+{dateImportProgress.currentItems.length - 5} รายการ</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="fdh-stat-grid">
                  <div className="fdh-stat-box">
                    <div className="fdh-stat-label">✅ พบสถานะใน FDH</div>
                    <div className="fdh-stat-val is-green">{dateImportProgress.found.toLocaleString()}</div>
                  </div>
                  <div className="fdh-stat-box">
                    <div className="fdh-stat-label">⏳ ยังไม่พบใน FDH</div>
                    <div className="fdh-stat-val is-amber">{dateImportProgress.notFound.toLocaleString()}</div>
                  </div>
                  <div className="fdh-stat-box">
                    <div className="fdh-stat-label">⏭️ ข้าม</div>
                    <div className="fdh-stat-val">{dateImportProgress.skipped.toLocaleString()}</div>
                  </div>
                  <div className="fdh-stat-box">
                    <div className="fdh-stat-label">❌ ผิดพลาด</div>
                    <div className="fdh-stat-val is-red">{dateImportProgress.errors.toLocaleString()}</div>
                  </div>
                </div>

                {dateImportProgress.recentFeed.length > 0 && (
                  <div className="fdh-live-feed">
                    <div className="fdh-feed-head">รายการที่ตรวจสอบล่าสุด ({dateImportProgress.recentFeed.length} รายการล่าสุด)</div>
                    {dateImportProgress.recentFeed.map((item, idx) => (
                      <div key={`${item.vn}-${idx}`} className="fdh-feed-row">
                        <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{item.vn}</span>
                        <span style={{ color: '#64748b' }}>{item.vstdate || '-'}</span>
                        <span>
                          <span className={`badge ${item.found ? 'badge-success' : item.httpStatus === 404 || item.httpStatus === 200 ? 'badge-warning' : 'badge-danger'}`}>
                            {item.hipdataCode || item.httpStatus || '-'}
                          </span>
                        </span>
                        <span style={{ color: item.found ? '#047857' : '#334155' }}>{item.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {dateRangeResult.done && dateRangeResult.success && dateRangeResult.summary && (
            <div className="alert alert-success">
              <span>✅</span>
              <span>
                นำเข้าสำเร็จ — ทั้งหมด <strong>{dateRangeResult.summary.total}</strong> รายการ,
                อัปเดต <strong>{dateRangeResult.summary.updated}</strong>,
                ข้าม <strong>{dateRangeResult.summary.skipped}</strong>,
                ผิดพลาด <strong>{dateRangeResult.summary.errors}</strong>
              </span>
            </div>
          )}

          {dateRangeResult.done && !dateRangeResult.success && (
            <div className="alert alert-danger">
              <span>⚠️</span>
              <span>{dateRangeResult.error || 'เกิดข้อผิดพลาด'}</span>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">ผลการนำเข้าสถานะล่าสุด</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="badge badge-primary">{results.length} รายการ</span>
            {results.length > 0 && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setResults([])}>
                ล้างผลลัพธ์
              </button>
            )}
          </div>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {results.length > 0 ? (
            <div className="modal-table-wrap">
              <table className="data-table long-id-table long-id-table--fdh-import-result">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>VN / Transaction UID</th>
                    <th>HTTP/Status</th>
                    <th>Message</th>
                    <th>Message TH</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((item, index) => (
                    <tr key={`${item.transaction_uid}-${index}`}>
                      <td className="table-index-cell">{index + 1}</td>
                      <td className="table-cell-nowrap workflow-id-cell">{item.transaction_uid}</td>
                      <td>
                        <span className={`badge ${item.response_status === 200 ? 'badge-success' : item.response_status ? 'badge-warning' : 'badge-danger'}`}>
                          {item.response_status || '-'}
                        </span>
                      </td>
                      <td className="long-message-cell">{item.response_message || '-'}</td>
                      <td className="long-message-cell">{item.response_message_th || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
              ยังไม่มีผลลัพธ์จากการนำเข้าในรอบนี้ (กด "นำเข้าสถานะ FDH" ด้านบนหรือดึงรายรายการด้านล่างเพื่อดูผลล่าสุด)
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">ประวัติการนำเข้าสถานะ</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="badge badge-info">{logsLoading ? 'กำลังโหลด...' : `${logs.length} รายการ`}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void fetchSettingsAndLogs()} disabled={logsLoading}>
              🔄 รีเฟรช
            </button>
          </div>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {logs.length > 0 ? (
            <div className="modal-table-wrap">
              <table className="data-table long-id-table long-id-table--fdh-import-history">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>VN / Transaction UID</th>
                    <th>ช่องทาง</th>
                    <th>HCODE</th>
                    <th>ENV</th>
                    <th>Status</th>
                    <th>Message TH</th>
                    <th>Imported At</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((item, index) => (
                    <tr key={item.id}>
                      <td className="table-index-cell">{index + 1}</td>
                      <td className="table-cell-nowrap workflow-id-cell">{item.transaction_uid}</td>
                      <td>
                        <span className={`badge ${item.source === 'track_trans' ? 'badge-info' : 'badge-secondary'}`}>
                          {item.source === 'track_trans' ? 'track_trans' : 'reservation'}
                        </span>
                      </td>
                      <td className="table-cell-nowrap workflow-code-cell">{item.hcode || '-'}</td>
                      <td><span className="badge badge-primary">{(item.environment || 'prd').toUpperCase()}</span></td>
                      <td><span className={`badge ${item.response_status === 200 ? 'badge-success' : 'badge-warning'}`}>{item.response_status || '-'}</span></td>
                      <td className="long-message-cell">{item.response_message_th || item.response_message || '-'}</td>
                      <td className="table-cell-nowrap workflow-code-cell">{item.imported_at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
              ยังไม่มีประวัติการนำเข้าสถานะ
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">นำเข้าสถานะรายรายการด้วย Transaction UID (/api/v2/reservation/get)</div>
        </div>
        <div className="card-body">
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            <span>ℹ️</span>
            <span>
              หน้านี้ออกแบบให้เข้ากับ flow ของโปรแกรม FDH เดิมของโรงพยาบาล โดยแยกส่วน Token, HCODE และรายการ <code>transaction_uid</code> สำหรับนำเข้าสถานะแบบรอบเดียวหลายรายการ
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginBottom: 16 }}>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>ค่าที่จะใช้เชื่อมต่อ FDH</div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.8 }}>
                <div>Hospital Code: <strong>{settingsSummary.hcode}</strong></div>
                <div>User: <strong>{settingsSummary.user}</strong></div>
                <div>Environment: <strong>{environment.toUpperCase()}</strong></div>
                <div>Token ปัจจุบัน: <strong>{maskedToken}</strong></div>
              </div>
            </div>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>ปลายทาง API</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.8, wordBreak: 'break-word' }}>
                <div>URL Token: <strong>{settingsSummary.tokenUrl}</strong></div>
                <div>URL ส่ง 16 แฟ้ม: <strong>{settingsSummary.upload16Url}</strong></div>
                <div>URL PreScreen: <strong>{settingsSummary.preScreenUrl}</strong></div>
                <div>URL สำรองแจ้ง: <strong>{settingsSummary.apiBaseUrl}</strong></div>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 12 }}>
            <div className="form-group">
              <label className="form-label">Environment</label>
              <select className="form-control" value={environment} onChange={(e) => setEnvironment(e.target.value as 'prd' | 'uat')}>
                <option value="prd">Production</option>
                <option value="uat">UAT</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">HCODE</label>
              <input className="form-control" value={effectiveHcode} readOnly placeholder="ดึงจากฐานข้อมูลอัตโนมัติ" />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 12 }}>
            <label className="form-label">JWT Token</label>
            <textarea
              className="form-control"
              rows={4}
              value={jwtToken}
              onChange={(e) => setJwtToken(e.target.value)}
              placeholder="วาง Bearer JWT token จาก FDH ที่นี่"
              style={{ fontFamily: 'monospace' }}
            />
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
              <button className="btn btn-secondary" onClick={handleTestConnection} disabled={requestingToken || testingConnection}>
                {testingConnection ? 'กำลังทดสอบ...' : 'ทดสอบการเชื่อมต่อ'}
              </button>
              <button className="btn btn-secondary" onClick={handleRequestToken} disabled={requestingToken}>
                {requestingToken ? 'กำลังขอ token...' : 'ขอ token อัตโนมัติ'}
              </button>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
                ปุ่มทั้งสองจะใช้ username/password จากหน้า Settings เพื่อทดลองเชื่อมต่อและขอ token ให้ก่อน
              </span>
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 16 }}>
            <label className="form-label">Transaction UID</label>
            <textarea
              className="form-control"
              rows={6}
              value={transactionUidText}
              onChange={(e) => setTransactionUidText(e.target.value)}
              placeholder="ใส่ transaction_uid ทีละบรรทัด"
              style={{ fontFamily: 'monospace' }}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
              พบ {transactionUids.length.toLocaleString()} รายการที่จะนำเข้าสถานะ
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={handleImportStatus} disabled={loading}>
              {loading ? 'กำลังนำเข้าสถานะ...' : 'ดึงสถานะจาก FDH'}
            </button>
            <button className="btn btn-secondary" onClick={() => setResults([])} disabled={loading}>
              ล้างผลลัพธ์
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {connectionMessage && (
        <div className="alert alert-success" style={{ marginBottom: 16 }}>
          <span>✅</span>
          <span>{connectionMessage}</span>
        </div>
      )}
    </div>
  );
};
