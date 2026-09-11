import test from 'node:test';
import assert from 'node:assert/strict';
import {accountCategory} from './paccountReportMapping.js';
test('accounting category follows account purpose instead of patient right',()=>{
  assert.equal(accountCategory('ลูกหนี้ค่ารักษา-ชำระเงิน IP'),'other');
  assert.equal(accountCategory('ลูกหนี้ค่ารักษา เบิกจ่ายตรง อปท. IP'),'local');
  assert.equal(accountCategory('ลูกหนี้ค่ารักษาบุคคลที่มีปัญหาฯเบิกส่วนกลางIP'),'stateless');
  assert.equal(accountCategory('ลูกหนี้ค่ารักษา UC-IP'),'uc');
});
