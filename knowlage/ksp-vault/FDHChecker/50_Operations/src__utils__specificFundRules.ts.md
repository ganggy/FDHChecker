---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "operations"
source: "src/utils/specificFundRules.ts"
source_hash: "90c2fbd378258976d58a9adeac07a87ca65642957012f0156c10ac35ff894621"
managed_by: "sync-ksp-vault"
---
# specificFundRules.ts

> Source: `src/utils/specificFundRules.ts`
> SHA-256: `90c2fbd378258976d58a9adeac07a87ca65642957012f0156c10ac35ff894621`

````typescript
const VISIT_DIAGNOSIS_FIELDS = ['pdx', 'main_diag', 'diag_code', 'dx0', 'dx1', 'dx2', 'dx3', 'dx4', 'dx5'] as const;

const normalizeDiagnosis = (value: unknown) => String(value ?? '').trim().toUpperCase();

export const hasTraditionalMedicineDiagnosis = (visit: Record<string, unknown>) => (
    VISIT_DIAGNOSIS_FIELDS.some((field) => normalizeDiagnosis(visit[field]).startsWith('U'))
);

export const filterSpecificFundRows = <T extends Record<string, unknown>>(fundId: string, rows: T[]): T[] => (
    fundId === 'postnatal_care'
        ? rows.filter((row) => !hasTraditionalMedicineDiagnosis(row))
        : rows
);

````
