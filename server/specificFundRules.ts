export const buildPostnatalTraditionalMedicineExclusionSql = (visitAlias: string) => `
  NOT EXISTS (
    SELECT 1
    FROM ovstdiag traditional_dx
    WHERE traditional_dx.vn = ${visitAlias}.vn
      AND UPPER(TRIM(COALESCE(traditional_dx.icd10, ''))) LIKE 'U%'
  )
`;
