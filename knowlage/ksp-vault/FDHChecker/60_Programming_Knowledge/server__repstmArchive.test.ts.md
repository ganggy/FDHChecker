---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/repstmArchive.test.ts"
source_hash: "f013269ee120e40f4aaace3049ac3ed61a7c3b6847750a3fb1f1e5d7b74100a0"
managed_by: "sync-ksp-vault"
---
# repstmArchive.test.ts

> Source: `server/repstmArchive.test.ts`
> SHA-256: `f013269ee120e40f4aaace3049ac3ed61a7c3b6847750a3fb1f1e5d7b74100a0`

````typescript
import assert from 'node:assert';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { analyzeRepstmArchive } from './repstmArchive.js';

test('reads COCD STM ZIP and preserves identifiers with leading zeroes', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <STMSTM>
    <stmAccountID>COCD</stmAccountID><hcode id="EA0011101">11101</hcode><hname>Test Hospital</hname>
    <AccPeriod>260502</AccPeriod><STMdoc>11101_COCDSTM_20260502</STMdoc><amount>3295.0000</amount>
    <STMdat code="HD" name="Kidney"><Dat><Tcount>1</Tcount></Dat></STMdat>
    <TBills code="HD"><TBill><sys>HD</sys><station>01</station><hreg>10710</hreg><hn>0014302</hn>
      <namepat>Patient One</namepat><invno>863059381</invno><dttran>2026-05-18T14:11:00</dttran>
      <amount>3295.0000</amount><paid>0.0000</paid><ExtP code="N">0.0000</ExtP><rid>1295</rid><cstat/><HDflag>COC</HDflag>
    </TBill></TBills>
  </STMSTM>`;
  const zip = new AdmZip();
  zip.addFile('11101_COCDSTM_20260502.xml', Buffer.from(xml, 'utf8'));

  const result = analyzeRepstmArchive(zip.toBuffer(), 'sample.zip');
  assert.equal(result.datasets.length, 1);
  assert.equal(result.datasets[0].detectedType, 'STM');
  assert.equal(result.datasets[0].importerId, 'cocd-statement');
  assert.equal(result.datasets[0].rows[0].HN, '0014302');
  assert.equal(result.datasets[0].rows[0].paid_amount, '3295.0000');
  assert.equal(result.datasets[0].rows[0].source_paid, '0.0000');
});

test('rejects ZIP files without supported statement detail XML', () => {
  const zip = new AdmZip();
  zip.addFile('readme.xml', Buffer.from('<OTHER><value>1</value></OTHER>', 'utf8'));
  assert.throws(() => analyzeRepstmArchive(zip.toBuffer(), 'unsupported.zip'), /ไม่พบ XML รายละเอียด STM/);
});

````
