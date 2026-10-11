---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "operations"
source: "server/specificFundRules.ts"
source_hash: "f2e978dca94a9daca3cb10fdd38001c0925bc59d1ae1be1b6c93f954b5026765"
managed_by: "sync-ksp-vault"
---
# specificFundRules.ts

> Source: `server/specificFundRules.ts`
> SHA-256: `f2e978dca94a9daca3cb10fdd38001c0925bc59d1ae1be1b6c93f954b5026765`

````typescript
export const buildPostnatalTraditionalMedicineExclusionSql = (visitAlias: string) => `
  NOT EXISTS (
    SELECT 1
    FROM ovstdiag traditional_dx
    WHERE traditional_dx.vn = ${visitAlias}.vn
      AND UPPER(TRIM(COALESCE(traditional_dx.icd10, ''))) LIKE 'U%'
  )
`;

````
