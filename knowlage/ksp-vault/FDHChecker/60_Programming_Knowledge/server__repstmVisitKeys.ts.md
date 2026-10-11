---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/repstmVisitKeys.ts"
source_hash: "a0c8380478a8ebecb376f5bd3b4dba321dbc0f48e17c44ebe193b917ba9bfdaa"
managed_by: "sync-ksp-vault"
---
# repstmVisitKeys.ts

> Source: `server/repstmVisitKeys.ts`
> SHA-256: `a0c8380478a8ebecb376f5bd3b4dba321dbc0f48e17c44ebe193b917ba9bfdaa`

````typescript
export type StatementVisitIdentity = {
  vn?: unknown;
  an?: unknown;
  matched_visit_code?: unknown;
  tran_id?: unknown;
};

const normalizeVisitKey = (value: unknown) => String(value ?? '').trim();

/**
 * Prefer explicit VN/AN and a REP transaction match. Some legacy STM files put
 * a statement or REP number in matched_visit_code even though vn/an is correct.
 */
export const resolveStatementVisitKeys = (
  row: StatementVisitIdentity,
  transactionToVisit: ReadonlyMap<string, string> = new Map(),
) => {
  const transactionId = normalizeVisitKey(row.tran_id);
  const directKeys = [
    normalizeVisitKey(row.vn),
    normalizeVisitKey(row.an),
    transactionId ? normalizeVisitKey(transactionToVisit.get(transactionId)) : '',
  ].filter(Boolean);

  if (directKeys.length > 0) return Array.from(new Set(directKeys));

  const fallback = normalizeVisitKey(row.matched_visit_code);
  return fallback ? [fallback] : [];
};

````
