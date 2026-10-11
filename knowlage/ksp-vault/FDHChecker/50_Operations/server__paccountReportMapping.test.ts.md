---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "operations"
source: "server/paccountReportMapping.test.ts"
source_hash: "27c3662f8ab7adc4972cf03c2e516b8897fac92b02de973cb49a123248c359d5"
managed_by: "sync-ksp-vault"
---
# paccountReportMapping.test.ts

> Source: `server/paccountReportMapping.test.ts`
> SHA-256: `27c3662f8ab7adc4972cf03c2e516b8897fac92b02de973cb49a123248c359d5`

````typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import {accountCategory} from './paccountReportMapping.js';
test('accounting category follows account purpose instead of patient right',()=>{
  assert.equal(accountCategory('ลูกหนี้ค่ารักษา-ชำระเงิน IP'),'other');
  assert.equal(accountCategory('ลูกหนี้ค่ารักษา เบิกจ่ายตรง อปท. IP'),'local');
  assert.equal(accountCategory('ลูกหนี้ค่ารักษาบุคคลที่มีปัญหาฯเบิกส่วนกลางIP'),'stateless');
  assert.equal(accountCategory('ลูกหนี้ค่ารักษา UC-IP'),'uc');
});

````
