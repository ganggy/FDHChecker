---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "operations"
source: "server/kidneyMonitorRules.ts"
source_hash: "61927dee778ec11ee34d9a860447d5e9971a5e73363df967565f113c6b5688b0"
managed_by: "sync-ksp-vault"
---
# kidneyMonitorRules.ts

> Source: `server/kidneyMonitorRules.ts`
> SHA-256: `61927dee778ec11ee34d9a860447d5e9971a5e73363df967565f113c6b5688b0`

````typescript
export type DialysisVisitEvidence = {
  hn?: unknown;
  vn?: unknown;
  patientName?: unknown;
  serviceDate?: unknown;
  hipdata_code?: unknown;
  pttypeName?: unknown;
  mainDepartment?: unknown;
  hasDialysisDiagnosis?: unknown;
  hasDialysisService?: unknown;
};

export type KidneyTrackingRight = 'civilServant' | 'socialSecurity' | 'nhso' | 'localGovernment' | 'other';

export type KidneyTrackingSummary = {
  totalSessions: number;
  totalPatients: number;
  byRight: Record<KidneyTrackingRight, { sessions: number; patients: number }>;
};

export type KidneyTrackingIssueKind = 'RIGHT_CHANGED' | 'MISSING_EVIDENCE' | 'UNKNOWN_RIGHT' | 'MISSING_HN';

export type KidneyTrackingIssue = {
  kind: KidneyTrackingIssueKind;
  hn: string;
  patientName: string;
  visits: Array<{
    vn: string;
    serviceDate: string;
    right: KidneyTrackingRight;
    hipdataCode: string;
    pttypeName: string;
  }>;
};

export type KidneyTrackingIssueSummary = {
  total: number;
  rightChanged: number;
  missingEvidence: number;
  unknownRight: number;
  missingHn: number;
  issues: KidneyTrackingIssue[];
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

/**
 * The service-visit scope used by the kidney monitor page. Every visit whose
 * main department is the dialysis unit must remain visible; diagnosis and
 * billing evidence are validation flags, not conditions for dropping a visit.
 */
export const isKidneyUnitServiceVisit = (visit: DialysisVisitEvidence): boolean => (
  String(visit.mainDepartment ?? '').trim() === '060'
);

export const getKidneyTrackingRight = (visit: DialysisVisitEvidence): KidneyTrackingRight => {
  const code = String(visit.hipdata_code ?? '').trim().toUpperCase();
  const rightName = String(visit.pttypeName ?? '').trim().toLowerCase();

  if (code === 'LGO' || /อปท|ท้องถิ่น/.test(rightName)) return 'localGovernment';
  if (code === 'OFC' || /ข้าราชการ|ส่วนราชการ|cscd|เบิกหน่วยงาน/.test(rightName)) return 'civilServant';
  if (code === 'SSS' || /ประกันสังคม/.test(rightName)) return 'socialSecurity';
  if (['UCS', 'UC', 'WEL'].includes(code) || /บัตรทอง|สุขภาพ|ผู้สูงอายุ|ผู้พิการ|ผู้มีรายได้น้อย|ทหารผ่านศึก|อสม/.test(rightName)) {
    return 'nhso';
  }
  return 'other';
};

export const summarizeKidneyTrackingVisits = (visits: DialysisVisitEvidence[]): KidneyTrackingSummary => {
  const patientSets: Record<KidneyTrackingRight, Set<string>> = {
    civilServant: new Set<string>(),
    socialSecurity: new Set<string>(),
    nhso: new Set<string>(),
    localGovernment: new Set<string>(),
    other: new Set<string>(),
  };
  const sessionCounts: Record<KidneyTrackingRight, number> = {
    civilServant: 0,
    socialSecurity: 0,
    nhso: 0,
    localGovernment: 0,
    other: 0,
  };
  const allPatients = new Set<string>();

  visits.forEach((visit) => {
    const right = getKidneyTrackingRight(visit);
    const hn = String(visit.hn ?? '').trim();
    sessionCounts[right] += 1;
    if (hn) {
      patientSets[right].add(hn);
      allPatients.add(hn);
    }
  });

  return {
    totalSessions: visits.length,
    totalPatients: allPatients.size,
    byRight: {
      civilServant: { sessions: sessionCounts.civilServant, patients: patientSets.civilServant.size },
      socialSecurity: { sessions: sessionCounts.socialSecurity, patients: patientSets.socialSecurity.size },
      nhso: { sessions: sessionCounts.nhso, patients: patientSets.nhso.size },
      localGovernment: { sessions: sessionCounts.localGovernment, patients: patientSets.localGovernment.size },
      other: { sessions: sessionCounts.other, patients: patientSets.other.size },
    },
  };
};

const toIssueVisit = (visit: DialysisVisitEvidence): KidneyTrackingIssue['visits'][number] => ({
  vn: String(visit.vn ?? '').trim(),
  serviceDate: String(visit.serviceDate ?? '').trim(),
  right: getKidneyTrackingRight(visit),
  hipdataCode: String(visit.hipdata_code ?? '').trim(),
  pttypeName: String(visit.pttypeName ?? '').trim(),
});

export const findKidneyTrackingIssues = (visits: DialysisVisitEvidence[]): KidneyTrackingIssueSummary => {
  const issues: KidneyTrackingIssue[] = [];
  const visitsByHn = new Map<string, DialysisVisitEvidence[]>();

  visits.forEach((visit) => {
    const hn = String(visit.hn ?? '').trim();
    const patientName = String(visit.patientName ?? '').trim();
    if (!hn) {
      issues.push({ kind: 'MISSING_HN', hn: '-', patientName, visits: [toIssueVisit(visit)] });
    } else {
      const patientVisits = visitsByHn.get(hn) || [];
      patientVisits.push(visit);
      visitsByHn.set(hn, patientVisits);
    }

    if (!isDialysisMonitorVisit(visit)) {
      issues.push({ kind: 'MISSING_EVIDENCE', hn: hn || '-', patientName, visits: [toIssueVisit(visit)] });
    }
    if (getKidneyTrackingRight(visit) === 'other') {
      issues.push({ kind: 'UNKNOWN_RIGHT', hn: hn || '-', patientName, visits: [toIssueVisit(visit)] });
    }
  });

  visitsByHn.forEach((patientVisits, hn) => {
    const rights = new Set(patientVisits.map(getKidneyTrackingRight));
    if (rights.size > 1) {
      issues.push({
        kind: 'RIGHT_CHANGED',
        hn,
        patientName: String(patientVisits.find((visit) => String(visit.patientName ?? '').trim())?.patientName ?? '').trim(),
        visits: patientVisits.map(toIssueVisit).sort((a, b) => a.serviceDate.localeCompare(b.serviceDate)),
      });
    }
  });

  return {
    total: issues.length,
    rightChanged: issues.filter((issue) => issue.kind === 'RIGHT_CHANGED').length,
    missingEvidence: issues.filter((issue) => issue.kind === 'MISSING_EVIDENCE').length,
    unknownRight: issues.filter((issue) => issue.kind === 'UNKNOWN_RIGHT').length,
    missingHn: issues.filter((issue) => issue.kind === 'MISSING_HN').length,
    issues,
  };
};

````
