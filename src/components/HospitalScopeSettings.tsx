import { useEffect, useState } from 'react';

export function HospitalScopeSettings({ settings, onChange }: {
  settings: { uc_walkin_pttypes?: string[]; uc_walkin_icode?: string; pcu_village_ids?: string[] };
  onChange: (path: string[], value: unknown) => void;
}) {
  const [options, setOptions] = useState<{ villages: Array<{ village_id: string; village_moo: string; village_name: string; address_id: string }>; pttypes: Array<{ pttype: string; name: string }> }>({ villages: [], pttypes: [] });
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    fetch('/api/config/hospital-options').then(response => response.json()).then(result => {
      if (!result.success) throw new Error(result.error);
      if (active) setOptions(result);
    }).catch(() => { if (active) setError('อ่านรายการสิทธิ์/หมู่บ้านไม่ได้ กรุณาตรวจการเชื่อมต่อ HIS'); });
    return () => { active = false; };
  }, []);
  const toggle = (key: 'uc_walkin_pttypes' | 'pcu_village_ids', id: string, checked: boolean) => {
    const current = settings[key] || [];
    onChange([key], checked ? [...new Set([...current, id])] : current.filter(value => value !== id));
  };
  return <section className="settings-section hospital-scope-settings">
    <h3>ขอบเขตบริการของโรงพยาบาล</h3>
    {error && <p role="alert">{error}</p>}
    <p className="settings-section-description">เลือกสิทธิ์ UC นอก CUP ในจังหวัดสำหรับ WALKIN ตามรหัสของโรงพยาบาล เช่น 40/41 หรือ 50/51 แล้วบันทึกการตั้งค่า</p>
    <div className="hospital-scope-options">{options.pttypes.map(item => <label key={item.pttype}>
      <input type="checkbox" checked={(settings.uc_walkin_pttypes || []).includes(String(item.pttype))}
        onChange={event => toggle('uc_walkin_pttypes', String(item.pttype), event.target.checked)} /> {item.pttype} — {item.name}
    </label>)}</div>
    <div className="form-group"><label htmlFor="hospital-walkin-icode">รหัสรายการ WALKIN (icode จาก HIS)</label>
      <input id="hospital-walkin-icode" type="text" value={settings.uc_walkin_icode || ''} onChange={event => onChange(['uc_walkin_icode'], event.target.value.trim())} placeholder="ระบุ icode ของโรงพยาบาล" />
    </div>
    <p className="settings-section-description">หมู่บ้านในเขตรับผิดชอบ: เลือกจาก village เพื่อใช้ในรายงาน PCU</p>
    <div className="hospital-scope-options">{options.villages.map(item => <label key={item.village_id}>
      <input type="checkbox" checked={(settings.pcu_village_ids || []).includes(String(item.village_id))}
        onChange={event => toggle('pcu_village_ids', String(item.village_id), event.target.checked)} /> หมู่ {item.village_moo} {item.village_name} ({item.address_id})
    </label>)}</div>
  </section>;
}
