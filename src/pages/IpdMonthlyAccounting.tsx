import {useState} from 'react';
import * as XLSX from 'xlsx';
type Raw = {month:string;payer:string;discharged:number;days:number;weight:number;charge:number;missing_weight:number};
const payers = ['UCS','OFC','LGO','SSS'];
export function IpdMonthlyAccounting() {
  const [year,setYear]=useState(new Date().getFullYear()+543+(new Date().getMonth()>=9?1:0));
  const [grid,setGrid]=useState<(string|number)[][]>([]);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const headers=['เดือน','DCH','ADM','วันนอน','SumAdjRW',...payers.map(p=>`${p} AdjRW`),...payers.map(p=>`${p} จำนวน`),...payers.map(p=>`${p} CMI`),...payers.map(p=>`${p} ค่าใช้จ่ายเฉลี่ย`),'สิทธิอื่น จำนวน','ขาด AdjRW'];
  async function load() {
    setBusy(true);setError('');setGrid([]);
    try {
      const response=await fetch(`/api/accounting/ipd-monthly?year=${year}`);const j=await response.json();
      if(!response.ok||!j.success) throw new Error(j.error);
      const rows:Raw[]=j.data.rows;
      const months=Array.from({length:12},(_,i)=>`${year-544+Math.floor((i+9)/12)}-${String((i+9)%12+1).padStart(2,'0')}`);
      const build=(month:string,subset:Raw[],adm:number) => {
        const sum=(items:Raw[],key:keyof Raw)=>items.reduce((s,r)=>s+Number(r[key]||0),0);
        const groups=payers.map(p=>subset.filter(r=>p==='LGO'?['LGO','BKK','PTY'].includes(r.payer):p==='SSS'?['SSS','SSI'].includes(r.payer):r.payer===p));
        const average=(g:Raw[],key:keyof Raw)=>sum(g,'discharged')?sum(g,key)/sum(g,'discharged'):0;
        return [month,sum(subset,'discharged'),adm,sum(subset,'days'),sum(subset,'weight'),...groups.map(g=>sum(g,'weight')),...groups.map(g=>sum(g,'discharged')),...groups.map(g=>average(g,'weight')),...groups.map(g=>average(g,'charge')),sum(subset,'discharged')-groups.reduce((s,g)=>s+sum(g,'discharged'),0),sum(subset,'missing_weight')];
      };
      setGrid([...months.map(m=>build(m,rows.filter(r=>r.month===m),Number(j.data.admissions.find((a:{month:string})=>a.month===m)?.admitted||0))),build('สะสม',rows,j.data.admissions.reduce((s:number,a:{admitted:number})=>s+Number(a.admitted),0))]);
    } catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <section className="revenue-budget-card"><h2>รายงาน IPD รายเดือน แยกสิทธิ / CMI</h2><div className="revenue-budget-controls"><label>ปีงบประมาณ<input type="number" value={year} onChange={e=>{setYear(Number(e.target.value));setGrid([]);}}/></label><button onClick={()=>void load()} disabled={busy}>{busy?'กำลังอ่านข้อมูล':'ดึงรายงาน IPD'}</button><button disabled={!grid.length} onClick={()=>{const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([headers,...grid]),'IPD CMI');XLSX.writeFile(w,`ipd-cmi-${year}.xlsx`);}}>ส่งออก Excel</button></div>{error&&<p role="alert">{error}</p>}<div className="revenue-budget-table-wrap"><table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{grid.map(r=><tr key={r[0]}>{r.map((v,i)=><td key={i}>{typeof v==='number'?v.toLocaleString('th-TH',{maximumFractionDigits:i>=13&&i<=16?4: i>=17&&i<=20?2:4}):v}</td>)}</tr>)}</tbody></table></div><p>CMI = SumAdjRW ÷ จำนวนจำหน่ายของสิทธินั้น ค่าใช้จ่ายเฉลี่ย = ยอดค่ารักษา ÷ จำนวนจำหน่าย แถวสะสมคำนวณใหม่จากยอดรวมทั้งปี วันนอนรวมของผู้จำหน่ายใช้ an_stat.admdate; ADM นับตามวันรับไว้</p></section>;
}
