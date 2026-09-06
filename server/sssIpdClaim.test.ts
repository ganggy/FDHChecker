import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAipnDocument, evaluateSssIpdCandidate } from './sssIpdClaim.js';

const valid = { cid:'1234567890123',pdx:'I10',clinic:'01',dischs:'1',discht:'1',hospmain:'11101',hipdata_code:'SSS',income:100,charge_total:100,doctor_license:'ว12345',missing_bill_group_count:0,missing_item_name_count:0,mixed_hn_count:0,missing_operation_time_count:0,operation_outside_admit_count:0,missing_operation_doctor_count:0,missing_tmt_count:0,missing_tmlt_count:0,service_outside_admit_count:0 };

test('AIPN candidate does not require NHSO close privilege or AuthCode',()=>assert.deepEqual(evaluateSssIpdCandidate(valid),[]));
test('AIPN candidate blocks mandatory admission and billing gaps',()=>{
  const issues=evaluateSssIpdCandidate({...valid,cid:'',pdx:'V123',income:0,dischs:'',missing_bill_group_count:1});
  assert.deepEqual(issues.filter((issue)=>issue.severity==='error').map((issue)=>issue.code),['AIPN-PAT01','AIPN-DX01','AIPN-ADM01','AIPN-CHG01','AIPN-CHG02','AIPN-CHG03']);
});
test('AIPN document contains required sections and HMAC end note',()=>{
  const document=buildAipnDocument({admission:{...valid,an:'690001',hn:'000001',title:'นาย',namepat:'ทดสอบ ระบบ',dob:'1980-01-01',sex:'1',marry:'1',changwat:'47',ampur:'01',nation:'99',admit_date:'2026-08-01',admit_time:'08:00:00',discharge_date:'2026-08-03',discharge_time:'10:00:00',ward:'01',birth_weight:0,pttype_eclaim_id:'10',auth_code:''},diagnoses:[{diagtype:'1',codeset:'IT',icd10:'I10',code_name:'Hypertension',doctor_license:'ว12345'}],operations:[],items:[{rxdate:'2026-08-01',income:'1',icode:'ITEM1',item_name:'ค่าห้อง',qty:1,unitprice:100,amount:100,discount:0,bill_group:'01',claim_cat:'D',claim_unit_price:100,claim_amount:100}],hcode:'11101',hospitalName:'โรงพยาบาลทดสอบ',generatedAt:new Date('2026-08-07T03:00:00Z')});
  assert.match(document,/<DocSysID version="2\.1">AIPN<\/DocSysID>/); assert.match(document,/<AuthCode><\/AuthCode>/); assert.match(document,/<IPADT>/); assert.match(document,/<IPDx Reccount="1">/); assert.match(document,/<BillItems Reccount="1">/); assert.match(document,/<\?EndNote HMAC="[a-f0-9]{32}"\?>$/);
});
