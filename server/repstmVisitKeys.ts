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
