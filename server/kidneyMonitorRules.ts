export type DialysisVisitEvidence = {
  mainDepartment?: unknown;
  hasDialysisDiagnosis?: unknown;
  hasDialysisService?: unknown;
};

const isTruthyDatabaseFlag = (value: unknown): boolean => (
  value === true || Number(value) === 1
);

/**
 * A visit belongs in the dialysis monitor only when it was served by the
 * dialysis unit and has clinical/billing evidence of dialysis. Department
 * alone is not sufficient because HOSxP can contain visits assigned to the
 * dialysis unit for unrelated services.
 */
export const isDialysisMonitorVisit = (visit: DialysisVisitEvidence): boolean => (
  String(visit.mainDepartment ?? '').trim() === '060'
  && (
    isTruthyDatabaseFlag(visit.hasDialysisDiagnosis)
    || isTruthyDatabaseFlag(visit.hasDialysisService)
  )
);
