import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isVaultManagementQuestion } from './aiVaultAgent.js';
import { getKspVaultStatus, saveManagedVaultNote } from './kspVaultManager.js';

test('recognizes explicit requests to teach or update the Vault', () => {
  assert.equal(isVaultManagementQuestion('เพิ่มเงื่อนไขการเบิกนี้ลง vault'), true);
  assert.equal(isVaultManagementQuestion('จำไว้ว่า OPD ให้นับ distinct VN'), true);
  assert.equal(isVaultManagementQuestion('วันนี้คนไข้ OPD กี่คน'), false);
});

test('writes AI knowledge only in managed zone and preserves a revision', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fdh-ksp-vault-'));
  const previous = process.env.KSP_VAULT_PATH;
  process.env.KSP_VAULT_PATH = temporaryRoot;
  try {
    const first = await saveManagedVaultNote({
      title: 'กฎทดสอบ', content: 'เวอร์ชันแรก', category: 'claims', stableId: 'test-rule', actor: 'test',
    });
    const second = await saveManagedVaultNote({
      title: 'กฎทดสอบ', content: 'เวอร์ชันแก้ไข', category: 'claims', stableId: 'test-rule', actor: 'test',
    });
    assert.equal(first.relativePath, '70_AI_Managed/claims/test-rule.md');
    assert.equal(second.updated, true);
    const note = await fs.readFile(path.join(temporaryRoot, 'FDHChecker', second.relativePath), 'utf8');
    assert.match(note, /เวอร์ชันแก้ไข/);
    const revisions = await fs.readdir(path.join(temporaryRoot, 'FDHChecker', '_ksp', 'ai-revisions', 'claims', 'test-rule'));
    assert.equal(revisions.length, 1);
    assert.equal((await getKspVaultStatus()).aiChanges, 2);
  } finally {
    if (previous === undefined) delete process.env.KSP_VAULT_PATH;
    else process.env.KSP_VAULT_PATH = previous;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});
