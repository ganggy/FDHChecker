import type { HospitalConnection } from './hospitalDatabase.js';
export type AccountMapping = {pttype:string;paccount:string;name:string;register_name:string;type_name:string;paccount_year:string;status:string;id:number};
export async function loadPaccountMappings(c:HospitalConnection, kind:'opd'|'ipd', year:number) {
  const [raw]=await c.query(`SELECT m.*, r.paccount_register_name AS register_name, t.paccount_type_name AS type_name
    FROM paccount${kind} m LEFT JOIN paccount_register r ON r.paccount_register_id=m.paccount_register_id
    LEFT JOIN paccount_type t ON t.paccount_type_id=m.paccount_type_id`);
  const [masters]=await c.query('SELECT paccount, name FROM paccount');
  const known=new Set((masters as {paccount:string}[]).map(r=>String(r.paccount)));
  const candidates=(raw as AccountMapping[]).filter(r=>String(r.status||'').toUpperCase()!=='N' && Number(r.paccount_year||0)<=year);
  const grouped=new Map<string,AccountMapping[]>();
  for(const r of candidates){const key=String(r.pttype).trim();grouped.set(key,[...(grouped.get(key)||[]),r]);}
  const result=new Map<string,AccountMapping>();const issues:string[]=[];
  for(const [key,rows] of grouped){
    const newest=Math.max(...rows.map(r=>Number(r.paccount_year||0)));
    const latest=rows.filter(r=>Number(r.paccount_year||0)===newest);
    if(new Set(latest.map(r=>String(r.paccount))).size!==1){issues.push(`${kind} ${key}: มีบัญชีหลายรายการในปี ${newest}`);continue;}
    const selected=latest[0];
    if(!known.has(String(selected.paccount))){issues.push(`${kind} ${key}: ไม่พบบัญชี ${selected.paccount} ใน paccount`);continue;}
    if(!selected.register_name || !selected.type_name || ![kind,'all'].includes(selected.type_name.toLowerCase())) {issues.push(`${kind} ${key}: ประเภทบัญชี/ทะเบียนไม่ตรง`);continue;}
    result.set(key,selected);
  }
  // Explicit OPD-only evidence from the user-supplied mapping workbook.
  // Do not overwrite a database row (including invalid/conflicting mappings).
  if(kind==='opd') {
    for(const pttype of ['17','19']) {
      if(grouped.has(pttype)) continue;
      const master=(masters as {paccount:string;name:string}[]).find(r=>r.paccount==='1102050101.209');
      if(!master) {issues.push(`${kind} ${pttype}: บัญชีในไฟล์ไม่มีใน paccount`);continue;}
      result.set(pttype,{pttype,paccount:master.paccount,name:master.name,register_name:'อ้างอิงไฟล์ MAPPING (ยังไม่ระบุทะเบียน)',type_name:'OPD',paccount_year:'ไฟล์ MAPPING',status:'Y',id:0});
      issues.push(`OPD ${pttype}: ใช้บัญชี 1102050101.209 จากไฟล์ 1.1.3.สรุป MAPPING สิทธฺิการรักษา.XLS; ไม่แก้ตาราง HOSxP`);
    }
  }
  return {result,issues};
}
export function accountCategory(name:string) {
  if(/ปัญหา|สถานะ/.test(name)) return 'stateless' as const;
  if(/อปท|กทม|พัทยา/.test(name)) return 'local' as const;
  if(/กรมบัญชีกลาง/.test(name)) return 'csm' as const;
  if(/ต้นสังกัด/.test(name)) return 'agency' as const;
  if(/ประกันสังคม|ปกส/.test(name)) return 'sss' as const;
  if(/ต่างด้าว/.test(name)) return 'migrant' as const;
  if(/UC/i.test(name)) return 'uc' as const;
  return 'other' as const;
}
