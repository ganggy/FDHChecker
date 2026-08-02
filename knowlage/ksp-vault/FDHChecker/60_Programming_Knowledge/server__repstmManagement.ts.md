---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/repstmManagement.ts"
source_hash: "0c5e54d590d267cb979816e065a44acaa89cf6ca42c10f9ec5d69c1dc959bc53"
managed_by: "sync-ksp-vault"
---
# repstmManagement.ts

> Source: `server/repstmManagement.ts`
> SHA-256: `0c5e54d590d267cb979816e065a44acaa89cf6ca42c10f9ec5d69c1dc959bc53`

````typescript
export type RepstmManageType = 'ALL' | 'REP' | 'STM' | 'INV';

export interface RepstmSearchFilters {
  dataType: RepstmManageType;
  query: string;
  page: number;
  pageSize: number;
  includeReplaced: boolean;
}

const boundedInteger = (value: unknown, fallback: number, minimum: number, maximum: number) => {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
};

export const normalizeRepstmSearchFilters = (input: Record<string, unknown>): RepstmSearchFilters => {
  const requestedType = String(input.dataType || 'ALL').trim().toUpperCase();
  const dataType: RepstmManageType = ['ALL', 'REP', 'STM', 'INV'].includes(requestedType)
    ? requestedType as RepstmManageType
    : 'ALL';
  return {
    dataType,
    query: String(input.query || input.q || '').trim().slice(0, 100),
    page: boundedInteger(input.page, 1, 1, 100000),
    pageSize: boundedInteger(input.pageSize, 50, 10, 100),
    includeReplaced: input.includeReplaced === true || String(input.includeReplaced || '').toLowerCase() === 'true',
  };
};

export const expectedRepstmBatchConfirmation = (batchId: number) => `DELETE BATCH #${batchId}`;

export const validateRepstmBatchDeletion = (batchIdValue: unknown, input: Record<string, unknown>) => {
  const batchId = Number(batchIdValue);
  const reason = String(input.reason || '').trim().slice(0, 500);
  if (!Number.isInteger(batchId) || batchId <= 0) return { valid: false as const, error: 'หมายเลข batch ไม่ถูกต้อง' };
  if (reason.length < 3) return { valid: false as const, error: 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร' };
  if (String(input.confirmation || '').trim().toUpperCase() !== expectedRepstmBatchConfirmation(batchId)) {
    return { valid: false as const, error: `กรุณาพิมพ์ ${expectedRepstmBatchConfirmation(batchId)} เพื่อยืนยัน` };
  }
  return { valid: true as const, batchId, reason };
};

````
