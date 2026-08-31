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

