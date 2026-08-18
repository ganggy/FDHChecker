export type KidneyClaimTrackingStatus =
  | 'NO_REP'
  | 'WAITING_STM'
  | 'MATCHED'
  | 'AMOUNT_DIFFERENT'
  | 'REP_ERROR';

export interface KidneyTrackingVisit {
  vn?: string | null;
  hn?: string | null;
  serviceDate?: string | null;
  [key: string]: unknown;
}

export interface KidneyRepTrackingRow {
  id: number | string;
  vn?: string | null;
  hn?: string | null;
  service_date?: string | null;
  rep_no?: string | null;
  tran_id?: string | null;
  compensated?: number | string | null;
  errorcode?: string | null;
  verifycode?: string | null;
}

export interface KidneyStmTrackingRow {
  id: number | string;
  vn?: string | null;
  matched_visit_code?: string | null;
  hn?: string | null;
  service_date?: string | null;
  statement_no?: string | null;
  tran_id?: string | null;
  amount?: number | string | null;
  paid_amount?: number | string | null;
  errorcode?: string | null;
  verifycode?: string | null;
}

export interface KidneyRepStmSummary {
  totalVisits: number;
  repVisits: number;
  pendingRep: number;
  stmVisits: number;
  pendingStm: number;
  matchedVisits: number;
  differentVisits: number;
  errorVisits: number;
  repAmount: number;
  stmPaidAmount: number;
  amountDiff: number;
}

const textValue = (value: unknown) => String(value ?? '').trim();
const amountValue = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const dateValue = (value: unknown) => textValue(value).slice(0, 10);
const uniqueTexts = (values: unknown[]) => Array.from(new Set(values.map(textValue).filter(Boolean)));
const visitKey = (visit: KidneyTrackingVisit) => `${textValue(visit.vn)}|${textValue(visit.hn)}|${dateValue(visit.serviceDate)}`;

export const attachKidneyRepStmTracking = <T extends KidneyTrackingVisit>(
  visits: T[],
  repRows: KidneyRepTrackingRow[],
  stmRows: KidneyStmTrackingRow[],
) => {
  const visitByVn = new Map<string, string>();
  const visitByHnDate = new Map<string, string>();
  const visitKeys = new Set<string>();

  visits.forEach((visit) => {
    const key = visitKey(visit);
    visitKeys.add(key);
    const vn = textValue(visit.vn);
    const hnDate = `${textValue(visit.hn)}|${dateValue(visit.serviceDate)}`;
    if (vn) visitByVn.set(vn, key);
    if (textValue(visit.hn) && dateValue(visit.serviceDate) && !visitByHnDate.has(hnDate)) {
      visitByHnDate.set(hnDate, key);
    }
  });

  const repsByVisit = new Map<string, KidneyRepTrackingRow[]>();
  const stmsByVisit = new Map<string, KidneyStmTrackingRow[]>();
  const visitByTran = new Map<string, string>();
  const pushUnique = <R extends { id: number | string }>(map: Map<string, R[]>, key: string, row: R) => {
    const list = map.get(key) || [];
    if (!list.some((item) => String(item.id) === String(row.id))) list.push(row);
    map.set(key, list);
  };
  const fallbackKey = (hn: unknown, serviceDate: unknown) => visitByHnDate.get(`${textValue(hn)}|${dateValue(serviceDate)}`);

  repRows.forEach((row) => {
    const key = visitByVn.get(textValue(row.vn)) || fallbackKey(row.hn, row.service_date);
    if (!key || !visitKeys.has(key)) return;
    pushUnique(repsByVisit, key, row);
    const tranId = textValue(row.tran_id);
    if (tranId) visitByTran.set(tranId, key);
  });

  stmRows.forEach((row) => {
    const key = visitByVn.get(textValue(row.matched_visit_code))
      || visitByVn.get(textValue(row.vn))
      || visitByTran.get(textValue(row.tran_id))
      || fallbackKey(row.hn, row.service_date);
    if (!key || !visitKeys.has(key)) return;
    pushUnique(stmsByVisit, key, row);
  });

  const data = visits.map((visit) => {
    const key = visitKey(visit);
    const reps = repsByVisit.get(key) || [];
    const stms = stmsByVisit.get(key) || [];
    const repAmount = reps.reduce((sum, row) => sum + amountValue(row.compensated), 0);
    const stmAmount = stms.reduce((sum, row) => sum + amountValue(row.amount), 0);
    const stmPaidAmount = stms.reduce((sum, row) => sum + amountValue(row.paid_amount), 0);
    const amountDiff = Number((stmPaidAmount - repAmount).toFixed(2));
    const errors = uniqueTexts([
      ...reps.flatMap((row) => [row.errorcode, row.verifycode]),
      ...stms.flatMap((row) => [row.errorcode, row.verifycode]),
    ]);
    let claimTrackingStatus: KidneyClaimTrackingStatus = 'NO_REP';
    if (reps.length > 0 && errors.length > 0) claimTrackingStatus = 'REP_ERROR';
    else if (reps.length > 0 && stms.length === 0) claimTrackingStatus = 'WAITING_STM';
    else if (reps.length > 0 && stms.length > 0 && Math.abs(amountDiff) <= 0.01) claimTrackingStatus = 'MATCHED';
    else if (reps.length > 0 && stms.length > 0) claimTrackingStatus = 'AMOUNT_DIFFERENT';

    return {
      ...visit,
      claimTrackingStatus,
      repFound: reps.length > 0,
      repCount: reps.length,
      repAmount: Number(repAmount.toFixed(2)),
      repNos: uniqueTexts(reps.map((row) => row.rep_no)),
      stmFound: stms.length > 0,
      stmCount: stms.length,
      stmAmount: Number(stmAmount.toFixed(2)),
      stmPaidAmount: Number(stmPaidAmount.toFixed(2)),
      stmNos: uniqueTexts(stms.map((row) => row.statement_no)),
      repStmDiff: amountDiff,
      repStmErrors: errors,
    };
  });

  const summary: KidneyRepStmSummary = {
    totalVisits: data.length,
    repVisits: data.filter((row) => row.repFound).length,
    pendingRep: data.filter((row) => !row.repFound).length,
    stmVisits: data.filter((row) => row.stmFound).length,
    pendingStm: data.filter((row) => row.repFound && !row.stmFound).length,
    matchedVisits: data.filter((row) => row.claimTrackingStatus === 'MATCHED').length,
    differentVisits: data.filter((row) => row.claimTrackingStatus === 'AMOUNT_DIFFERENT').length,
    errorVisits: data.filter((row) => row.claimTrackingStatus === 'REP_ERROR').length,
    repAmount: Number(data.reduce((sum, row) => sum + row.repAmount, 0).toFixed(2)),
    stmPaidAmount: Number(data.reduce((sum, row) => sum + row.stmPaidAmount, 0).toFixed(2)),
    amountDiff: Number(data.reduce((sum, row) => sum + row.repStmDiff, 0).toFixed(2)),
  };

  return { data, summary };
};
