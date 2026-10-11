---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "src/utils/syphilisScreeningRules.ts"
source_hash: "da64c04fda862c3cb207ad7799b9b2ec84bee27bfa42f6649142330a82207e39"
managed_by: "sync-ksp-vault"
---
# syphilisScreeningRules.ts

> Source: `src/utils/syphilisScreeningRules.ts`
> SHA-256: `da64c04fda862c3cb207ad7799b9b2ec84bee27bfa42f6649142330a82207e39`

````typescript
export const SYPHILIS_SCREENING_ADP_CODES = ['36003', '36006'] as const;

// Short test names must be token-bound. Without the boundaries, RPR also matches
// unrelated words such as "Interpretation" and "chlorpromazine".
export const SYPHILIS_SCREENING_NAME_PATTERN =
    'TREPONEMA|TREPONEMAL|PALLIDUM|SYPHILIS|ซิฟิลิส|(^|[^A-Z0-9])(TPHA|TPPA|VDRL|RPR)([^A-Z0-9]|$)';

const screeningNameRegex = new RegExp(SYPHILIS_SCREENING_NAME_PATTERN, 'i');

export const isSyphilisScreeningName = (value: unknown) =>
    screeningNameRegex.test(String(value ?? '').trim());

export const isSyphilisScreeningAdpCode = (value: unknown) =>
    SYPHILIS_SCREENING_ADP_CODES.includes(String(value ?? '').trim() as (typeof SYPHILIS_SCREENING_ADP_CODES)[number]);


````
