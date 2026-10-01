import { useEffect, useState } from 'react';

const fields = [
  ['hosxp_code', 'รหัสสิทธิ์ HIS'], ['hosxp_name', 'ชื่อสิทธิ์'], ['hipdata_code', 'HIPDATA'],
  ['finance_code', 'กลุ่มการเงิน'], ['finance_name', 'ชื่อกลุ่มการเงิน'],
  ['debtor_opd', 'บัญชีลูกหนี้ OPD'], ['debtor_ipd', 'บัญชีลูกหนี้ IPD'],
  ['revenue_opd', 'บัญชีรายได้ OPD'], ['revenue_ipd', 'บัญชีรายได้ IPD'],
  ['payment_type_code', 'รหัสชำระเงิน'], ['payment_type_name', 'ชื่อประเภทชำระเงิน'],
  ['grouper', 'Grouper'], ['rounding', 'ปัดเศษ Y/N'],
] as const;

export function ReceivableMappingSettings() {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    void fetch('/api/config/receivable-mappings').then(async response => {
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error('อ่าน mapping ไม่สำเร็จ');
      if (active) setRows(json.data);
    }).catch(error => { if (active) setMessage(String(error.message)); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);
  const save = async () => {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/config/receivable-mappings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: rows }) });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'บันทึกไม่สำเร็จ');
      setMessage('บันทึกแล้ว รายงานและการตัดลูกหนี้จะใช้ mapping นี้');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ'); }
    finally { setBusy(false); }
  };
  return <section className="settings-section">
    <h3>สิทธิ์และบัญชีลูกหนี้ของโรงพยาบาล</h3>
    <p>ตรวจรหัสสิทธิ์กับ HIS และรหัสบัญชีกับฝ่ายการเงินก่อนบันทึก ค่าเริ่มต้นต้องตรวจให้ตรงกับโรงพยาบาลนี้ ไม่ใช้รหัสสิทธิ์ของโรงพยาบาลอื่นแทน</p>
    <p role="status">{message}</p>
    <fieldset disabled={busy} style={{ border: 0, padding: 0, minWidth: 0 }}>
      <div style={{ overflowX: 'auto', maxHeight: 450 }}>
        <table><thead><tr>{fields.map(([key, label]) => <th key={key}>{label}</th>)}<th>จัดการ</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={index}>
            {fields.map(([key, label]) => <td key={key}><input aria-label={`${label} แถว ${index + 1}`} value={row[key] || ''} maxLength={200}
              style={{ width: key.includes('name') ? 220 : 160 }}
              onChange={event => setRows(previous => previous.map((item, i) => i === index ? { ...item, [key]: event.target.value } : item))} /></td>)}
            <td><button type="button" onClick={() => setRows(previous => previous.filter((_, i) => i !== index))}>ลบแถว</button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <button type="button" onClick={() => setRows(previous => [...previous, Object.fromEntries(fields.map(([key]) => [key, '']))])}>เพิ่มสิทธิ์</button>{' '}
      <button type="button" onClick={() => void save()}>บันทึก mapping</button>
    </fieldset>
  </section>;
}
