import businessRules from '../config/business_rules.json';
import { SYPHILIS_SCREENING_NAME_PATTERN, SYPHILIS_SCREENING_ADP_CODES } from '../../src/utils/syphilisScreeningRules.js';
import { PALLIATIVE_DIAGNOSIS_GROUPS } from '../../src/config/palliativeDiagnosisCatalog.js';

export const ANEMIA_CBC_REGEX = 'CBC|COMPLETE BLOOD COUNT|FULL BLOOD COUNT|CBC WITHOUT SMEAR|CBC NO SMEAR|CBC W/O SMEAR|CBC W/O DIFF|ซีบีซี|ความสมบูรณ์ของเม็ดเลือด|เม็ดเลือดสมบูรณ์';
export const ANEMIA_HBHCT_REGEX = 'HB/HCT|HBHCT|HB HCT|HB-HCT|HB|HGB|HEMOGLOBIN|HCT|HEMATOCRIT|ฮีโมโกลบิน|ฮีมาโตคริต|ความเข้มข้นเลือด';
export const SYPHILIS_SCREENING_REGEX = SYPHILIS_SCREENING_NAME_PATTERN;
export const HEP_C_SCREENING_REGEX = 'ANTI[- ]?HCV|HCV[ -]?(AB|ANTIBODY)|HEPATITIS C.*(AB|ANTIBODY)|ไวรัสตับอักเสบซี';
export const HEP_B_SCREENING_REGEX = 'HBS[- ]?AG|HBsAg|HEPATITIS B SURFACE ANTIGEN|HEPATITIS B ANTIGEN|ไวรัสตับอักเสบบี';
export const MENTAL_HEALTH_COUNSELLING_REGEX = 'MENTAL|COUNSELL?ING|ST[- ]?5|9Q|สุขภาพจิต|ปรึกษา.*สุขภาพจิต|ความเครียด|ซึมเศร้า';
export const GENDER_AFFIRMING_HORMONE_REGEX = 'GENDER|HORMONE|ESTRADIOL|ESTROGEN|TESTOSTERONE|เพศสภาพ|ฮอร์โมน';
export const LATENT_TB_SCREENING_REGEX = 'IGRA|INTERFERON|QUANTIFERON|T[- ]?SPOT|LATENT TB|วัณโรคระยะแฝง';
export const OSTEOPOROSIS_SCREENING_REGEX = 'FRAX|DXA|DEXA|BMD|BONE DENS|OSTEOPOROSIS|กระดูกพรุน|มวลกระดูก';
export const TDAS_SCREENING_REGEX = 'TDAS|AUTIS|ออทิส|ออทิสติก';
export const TELEMED_ADP_CODE = String((businessRules as any)?.adp_codes?.telmed || 'TELMED').trim().toUpperCase();
export const TELEMED_EXPORT_CODE = String((businessRules as any)?.project_codes?.ovstist_tele || '5').trim();
export const ANC_DENTAL_EXAM_PROCEDURE_CODES = ((businessRules as any)?.adp_codes?.anc_dental_exam_procedures || ['2330011', '2330010']) as string[];
export const ANC_DENTAL_CLEAN_PROCEDURE_CODES = ((businessRules as any)?.adp_codes?.anc_dental_clean_procedures || ['2387010']) as string[];
export const ANC_DENTAL_EXAM_ICD9 = String((businessRules as any)?.adp_codes?.anc_dental_exam_icd9 || '8931').replace(/\./g, '').trim();
export const ANC_DENTAL_CLEAN_ICD9 = String((businessRules as any)?.adp_codes?.anc_dental_clean_icd9 || '9654').replace(/\./g, '').trim();
export const toSqlCodeList = (codes: string[]) => codes.map((code) => `'${String(code).replace(/'/g, "''")}'`).join(', ');
export const SYPHILIS_SCREENING_ADP_CODES_SQL = toSqlCodeList([...SYPHILIS_SCREENING_ADP_CODES]);
export const ANC_DENTAL_EXAM_PROCEDURE_CODES_SQL = toSqlCodeList(ANC_DENTAL_EXAM_PROCEDURE_CODES);
export const ANC_DENTAL_CLEAN_PROCEDURE_CODES_SQL = toSqlCodeList(ANC_DENTAL_CLEAN_PROCEDURE_CODES);

export const buildAnemiaLabExistsSql = (alias: string, labKind: 'cbc' | 'hbhct' | 'any' = 'any') => {
  const regex = labKind === 'cbc'
    ? ANEMIA_CBC_REGEX
    : labKind === 'hbhct'
      ? ANEMIA_HBHCT_REGEX
      : `${ANEMIA_CBC_REGEX}|${ANEMIA_HBHCT_REGEX}`;

  return `
  (
    EXISTS (
      SELECT 1
      FROM opitemrece oo
      LEFT JOIN nondrugitems ndi ON ndi.icode = oo.icode
      LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
      WHERE oo.vn = ${alias}.vn
        AND (
          UPPER(COALESCE(ndi.name, sd.name, oo.icode)) REGEXP '${regex}'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM lab_head h
      JOIN lab_order lo ON h.lab_order_number = lo.lab_order_number
      JOIN lab_items li ON lo.lab_items_code = li.lab_items_code
      WHERE h.vn = ${alias}.vn
        AND lo.lab_order_result IS NOT NULL
        AND lo.lab_order_result <> ''
        AND (
          UPPER(COALESCE(li.lab_items_name, '')) REGEXP '${regex}'
        )
    )
  )
`;
};

export const buildAnemiaCbcExistsSql = (alias: string) => buildAnemiaLabExistsSql(alias, 'cbc');
export const buildAnemiaHbHctExistsSql = (alias: string) => buildAnemiaLabExistsSql(alias, 'hbhct');

export const buildAnemiaFallbackSql = (alias: string, labKind: 'cbc' | 'hbhct' | 'any' = 'hbhct') => `
  EXISTS (
    SELECT 1
    FROM ovstdiag dx
    WHERE dx.vn = ${alias}.vn
      AND REPLACE(UPPER(dx.icd10), '.', '') IN ('Z130', 'Z138')
  )
  AND ${buildAnemiaLabExistsSql(alias, labKind)}
`;

export const buildAnemiaAgeBandSql = (visitAlias: string) => `
  CASE
    WHEN v.age_y BETWEEN 13 AND 24 THEN '13-24 ปี'
    WHEN TIMESTAMPDIFF(MONTH, pt.birthday, ${visitAlias}.vstdate) BETWEEN 6 AND 12 THEN '6-12 เดือน'
    WHEN v.age_y BETWEEN 3 AND 6 THEN '3-6 ปี'
    ELSE NULL
  END
`;

export const buildAnemiaAgeEligibleSql = (visitAlias: string) => `
  (
    v.age_y BETWEEN 13 AND 24
    OR TIMESTAMPDIFF(MONTH, pt.birthday, ${visitAlias}.vstdate) BETWEEN 6 AND 12
    OR v.age_y BETWEEN 3 AND 6
  )
`;

export const buildFpgLabExistsSql = (alias: string) => `
  (
    EXISTS (
      SELECT 1
      FROM opitemrece oo
      LEFT JOIN nondrugitems ndi ON ndi.icode = oo.icode
      LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
      WHERE oo.vn = ${alias}.vn
        AND UPPER(COALESCE(ndi.name, sd.name, oo.icode)) REGEXP '(^|[^A-Z])(FPG|FBS)([^A-Z]|$)|FASTING PLASMA GLUCOSE|FASTING BLOOD SUGAR|GLUCOSE FASTING'
    )
    OR EXISTS (
      SELECT 1
      FROM lab_head h
      JOIN lab_order lo ON h.lab_order_number = lo.lab_order_number
      JOIN lab_items li ON lo.lab_items_code = li.lab_items_code
      WHERE h.vn = ${alias}.vn
        AND lo.lab_order_result IS NOT NULL
        AND lo.lab_order_result <> ''
        AND UPPER(COALESCE(li.lab_items_name, '')) REGEXP '(^|[^A-Z])(FPG|FBS)([^A-Z]|$)|FASTING PLASMA GLUCOSE|FASTING BLOOD SUGAR|GLUCOSE FASTING'
    )
  )
`;

export const buildServiceOrLabNameExistsSql = (alias: string, regex: string) => `
  (
    EXISTS (
      SELECT 1
      FROM opitemrece oo
      LEFT JOIN nondrugitems ndi ON ndi.icode = oo.icode
      LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
      WHERE oo.vn = ${alias}.vn
        AND UPPER(COALESCE(ndi.name, sd.name, oo.icode)) REGEXP '${regex}'
    )
    OR EXISTS (
      SELECT 1
      FROM lab_head h
      JOIN lab_order lo ON h.lab_order_number = lo.lab_order_number
      JOIN lab_items li ON lo.lab_items_code = li.lab_items_code
      WHERE h.vn = ${alias}.vn
        AND lo.lab_order_result IS NOT NULL
        AND lo.lab_order_result <> ''
        AND UPPER(COALESCE(li.lab_items_name, '')) REGEXP '${regex}'
    )
  )
`;

export const buildTelemedExistsSql = (visitAlias: string, ovstistAlias: string) => `
  (
    EXISTS (
      SELECT 1
      FROM opitemrece oo
      JOIN s_drugitems d ON d.icode = oo.icode
      WHERE oo.vn = ${visitAlias}.vn
        AND UPPER(COALESCE(d.nhso_adp_code, '')) = '${TELEMED_ADP_CODE}'
      LIMIT 1
    )
    OR COALESCE(${ovstistAlias}.export_code, '') = '${TELEMED_EXPORT_CODE}'
  )
`;

export const buildPregLabExistsSql = (alias: string) => `
  (
    EXISTS (
      SELECT 1
      FROM opitemrece oo
      LEFT JOIN nondrugitems ndi ON ndi.icode = oo.icode
      LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
      WHERE oo.vn = ${alias}.vn
        AND (
          UPPER(COALESCE(ndi.name, sd.name, oo.icode)) REGEXP '(^|[^A-Z])(UPT|URINE PREGNANCY TEST|PREG TEST|PREGNANCY TEST|HCG|BETA HCG)([^A-Z]|$)'
          OR COALESCE(sd.nhso_adp_code, '') = '31101'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM lab_head h
      JOIN lab_order lo ON h.lab_order_number = lo.lab_order_number
      JOIN lab_items li ON lo.lab_items_code = li.lab_items_code
      WHERE h.vn = ${alias}.vn
        AND lo.lab_order_result IS NOT NULL
        AND lo.lab_order_result <> ''
        AND UPPER(COALESCE(li.lab_items_name, '')) REGEXP '(^|[^A-Z])(UPT|URINE PREGNANCY TEST|PREG TEST|PREGNANCY TEST|HCG|BETA HCG)([^A-Z]|$)'
    )
  )
`;

export const buildPostIronMedExistsSql = (alias: string) => `
  EXISTS (
    SELECT 1
    FROM opitemrece oo
    LEFT JOIN drugitems di ON di.icode = oo.icode
    LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
    WHERE oo.vn = ${alias}.vn
      AND UPPER(CONCAT_WS(' ', COALESCE(di.name, ''), COALESCE(sd.name, ''))) REGEXP 'FERROUS|TRIFERDINE|FEROFOLIC|FOLIC|IRON'
  )
`;

export const buildFerrokidMedExistsSql = (alias: string) => `
  EXISTS (
    SELECT 1
    FROM opitemrece oo
    LEFT JOIN drugitems di ON di.icode = oo.icode
    LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
    WHERE oo.vn = ${alias}.vn
      AND UPPER(CONCAT_WS(' ', COALESCE(di.name, ''), COALESCE(sd.name, ''))) REGEXP 'FERROKID|FERRO KID|FERRO-KID|KID.*IRON|IRON.*KID'
  )
`;

export const UPT_DX_CODES = ['Z320', 'Z321'];
export const FPG_DX_CODES = ['Z131', 'Z133', 'Z136'];
export const CHOL_DX_CODES = ['Z136'];
export const ANEMIA_DX_CODES = ['Z130', 'Z138'];
export const IRON_DX_CODES = ['Z130'];
export const POSTNATAL_CARE_DX_CODES = ['Z390', 'Z391', 'Z392'];
export const POSTNATAL_SUPPLEMENT_DX_CODES = ['Z391', 'Z392'];
export const PILL_DX_CODES = ['Z304'];
export const PALLIATIVE_SERVICE_DX_CODES = ['Z515', 'Z718'];
export const PALLIATIVE_ELIGIBLE_DX_CODES = PALLIATIVE_DIAGNOSIS_GROUPS
  .filter((group) => group.id !== 'palliative-service')
  .flatMap((group) => group.codes)
  .map((code) => code.replace(/\./g, '').toUpperCase());
export const PALLIATIVE_ELIGIBLE_DX_CODES_SQL = toSqlCodeList(PALLIATIVE_ELIGIBLE_DX_CODES);

export const ANC_LAB_1_REGEX = {
  cbc: 'CBC|COMPLETE BLOOD COUNT',
  dcip: '(^|[^A-Z])DCIP([^A-Z]|$)',
  abo: 'ABO|ABO/RH|BLOOD GROUP|CELL GROUPING',
  rh: '(^|[^A-Z])RH([^A-Z]|$)|RH GROUP|GROUPING TUBE METHOD',
  hbsag: 'HBS[- ]?AG|HEPATITIS B SURFACE ANTIGEN|HBSAG',
  syphilis: SYPHILIS_SCREENING_REGEX,
  hiv: 'ANTI-?HIV|HIV-AB|HIV AB|HIV.*RAPID|RAPID.*HIV',
};

export const ANC_LAB_2_REGEX = {
  hiv: 'ANTI-?HIV|HIV-AB|HIV AB|HIV.*RAPID|RAPID.*HIV',
  syphilis: SYPHILIS_SCREENING_REGEX,
  cbc: 'CBC|COMPLETE BLOOD COUNT',
};


export const buildAncLab1CompleteSql = (alias: string) => `
  ${buildServiceOrLabNameExistsSql(alias, ANC_LAB_1_REGEX.cbc)}
  AND ${buildServiceOrLabNameExistsSql(alias, ANC_LAB_1_REGEX.dcip)}
  AND ${buildServiceOrLabNameExistsSql(alias, ANC_LAB_1_REGEX.abo)}
  AND ${buildServiceOrLabNameExistsSql(alias, ANC_LAB_1_REGEX.rh)}
  AND ${buildServiceOrLabNameExistsSql(alias, ANC_LAB_1_REGEX.hbsag)}
  AND ${buildServiceOrLabNameExistsSql(alias, ANC_LAB_1_REGEX.syphilis)}
  AND ${buildServiceOrLabNameExistsSql(alias, ANC_LAB_1_REGEX.hiv)}
`;

export const buildAncLab1IdentifySql = (alias: string) => `
  ${buildAncLab1CompleteSql(alias)}
`;

export const buildAncLab2CompleteSql = (alias: string) => `
  ${buildServiceOrLabNameExistsSql(alias, ANC_LAB_2_REGEX.hiv)}
  AND ${buildServiceOrLabNameExistsSql(alias, ANC_LAB_2_REGEX.syphilis)}
  AND ${buildServiceOrLabNameExistsSql(alias, ANC_LAB_2_REGEX.cbc)}
`;

export const buildAncLab2IdentifySql = (alias: string) => `
  ${buildServiceOrLabNameExistsSql(alias, ANC_LAB_2_REGEX.hiv)}
  AND ${buildServiceOrLabNameExistsSql(alias, ANC_LAB_2_REGEX.syphilis)}
`;

export const buildDxInSql = (expr: string, codes: string[]) =>
  `REPLACE(UPPER(COALESCE(${expr}, '')), '.', '') IN (${codes.map(code => `'${code}'`).join(',')})`;

export const buildVisitDiagnosisExistsSql = (alias: string, codes: string[]) => `
  EXISTS (
    SELECT 1
    FROM ovstdiag dx
    WHERE dx.vn = ${alias}.vn
      AND REPLACE(UPPER(dx.icd10), '.', '') IN (${codes.map(code => `'${code}'`).join(',')})
  )
`;

export const buildDiagnosisMatchSql = (alias: string, vnStatAlias: string, codes: string[]) => `
  (
    ${buildVisitDiagnosisExistsSql(alias, codes)}
    OR ${buildDxInSql(`${vnStatAlias}.pdx`, codes)}
    OR ${buildDxInSql(`${vnStatAlias}.dx0`, codes)}
    OR ${buildDxInSql(`${vnStatAlias}.dx1`, codes)}
    OR ${buildDxInSql(`${vnStatAlias}.dx2`, codes)}
    OR ${buildDxInSql(`${vnStatAlias}.dx3`, codes)}
    OR ${buildDxInSql(`${vnStatAlias}.dx4`, codes)}
    OR ${buildDxInSql(`${vnStatAlias}.dx5`, codes)}
  )
`;

export const buildCholNamedLabExistsSql = (alias: string, nameRegex: string) => `
  (
    EXISTS (
      SELECT 1
      FROM opitemrece oo
      LEFT JOIN nondrugitems ndi ON ndi.icode = oo.icode
      LEFT JOIN s_drugitems sd ON sd.icode = oo.icode
      WHERE oo.vn = ${alias}.vn
        AND UPPER(COALESCE(ndi.name, sd.name, oo.icode)) REGEXP '${nameRegex}'
    )
    OR EXISTS (
      SELECT 1
      FROM lab_head h
      JOIN lab_order lo ON h.lab_order_number = lo.lab_order_number
      JOIN lab_items li ON lo.lab_items_code = li.lab_items_code
      WHERE h.vn = ${alias}.vn
        AND lo.lab_order_result IS NOT NULL
        AND lo.lab_order_result <> ''
        AND UPPER(COALESCE(li.lab_items_name, '')) REGEXP '${nameRegex}'
    )
  )
`;

// PPFS 2568 requires evidence for both Total Cholesterol and HDL, not either one.
export const buildCholLabExistsSql = (alias: string) => `
  (
    ${buildCholNamedLabExistsSql(alias, 'TOTAL.*CHOLESTEROL|CHOLESTEROL.*TOTAL|^CHOLESTEROL$')}
    AND ${buildCholNamedLabExistsSql(alias, 'HDL|HIGH[[:space:]_-]*DENSITY[[:space:]_-]*LIPOPROTEIN')}
  )
`;

