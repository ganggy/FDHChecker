import type { HospitalConnection } from './hospitalDatabase.js';
import { readHospitalSchema } from './hospitalSchema.js';

// Identifiers below are application constants; encounter values are always bound.
export async function readVisitItems(connection: HospitalConnection, vn: string, an?: string): Promise<Record<string, unknown>[]> {
  const has = await readHospitalSchema(connection, ['opitemrece', 'drugitems', 'nondrugitems', 's_drugitems', 'income']);
  const aliases: Record<string, string> = { drugitems: 'di', nondrugitems: 'nd', s_drugitems: 'sd', income: 'inc' };
  const joined = Object.keys(aliases).filter(table => has(table, table === 'income' ? 'income' : 'icode') && (table !== 'income' || has('opitemrece', 'income')));
  const col = (table: string, name: string) => joined.includes(table) && has(table, name) ? `${aliases[table]}.${name}` : "''";
  const joins = joined.map(table => {
    const key = table === 'income' ? 'income' : 'icode';
    return `LEFT JOIN ${table} ${aliases[table]} ON ${aliases[table]}.${key} = o.${key}`;
  }).join('\n');
  const name = `COALESCE(NULLIF(${col('s_drugitems', 'name')}, ''), NULLIF(${col('drugitems', 'name')}, ''), NULLIF(${col('nondrugitems', 'name')}, ''), o.icode)`;
  const fields = ['vn', 'hn', 'an', 'icode', 'qty', 'unitprice', 'sum_price', 'discount', 'vstdate', 'income']
    .filter(field => has('opitemrece', field)).map(field => `o.${field}`).join(', ');
  if (!has('opitemrece', 'icode', an ? 'an' : 'vn')) throw new Error('ไม่พบโครงสร้างรายการบริการที่จำเป็นใน opitemrece');
  const [rows] = await connection.query(`SELECT ${fields}, ${name} AS item_name,
    ${col('income', 'name')} AS income_name,
    ${col('s_drugitems', 'nhso_adp_code')} AS nhso_adp_code,
    ${col('s_drugitems', 'tmlt_code')} AS tmlt_code,
    ${col('s_drugitems', 'ttmt_code')} AS ttmt_code,
    ${col('s_drugitems', 'strength')} AS s_strength,
    ${col('s_drugitems', 'units')} AS s_units,
    ${joined.includes('drugitems') ? 'CASE WHEN di.icode IS NOT NULL THEN 1 ELSE 0 END' : '0'} AS is_drug
    FROM opitemrece o ${joins} WHERE o.${an ? 'an' : 'vn'} = ? ORDER BY o.icode`, [an || vn]);
  return (rows as Record<string, unknown>[]).map(row => ({
    ...row, drugName: row.item_name, incomeName: row.income_name,
    unitPrice: Number(row.unitprice || 0), price: Number(row.sum_price ?? Number(row.qty || 0) * Number(row.unitprice || 0)),
    item_type: Number(row.is_drug) ? 'ยา' : 'เวชภัณฑ์/ค่าบริการ', itemType: Number(row.is_drug) ? 'ยา' : 'เวชภัณฑ์/ค่าบริการ',
    adp_code: row.nhso_adp_code, nhso_code: row.ttmt_code,
    has_adp_mapping: row.nhso_adp_code ? 1 : 0, has_nhso_adp: row.nhso_adp_code ? 1 : 0,
    has_tmlt: row.tmlt_code ? 1 : 0, has_ttmt: row.ttmt_code ? 1 : 0,
    adp_name: row.item_name, adp_price: Number(row.unitprice || 0), can_claim: row.nhso_adp_code ? 1 : 0,
  }));
}

export async function readVisitClinical(connection: HospitalConnection, vn: string, an?: string) {
  const has = await readHospitalSchema(connection, ['opdscreen', 'ovstdiag', 'iptdiag', 'vn_stat', 'an_stat', 'icd101', 'icd9cm1',
    'doctor_operation', 'er_regist_oper', 'er_oper_code', 'dtmain', 'dttm', 'view_procedure_opd', 'iptoprt',
    'health_med_service', 'health_med_service_operation', 'health_med_operation_item']);
  const warnings: string[] = [];
  const query = async (sql: string, value: string) => {
    const [rows] = await connection.query(sql, [value]);
    return rows as Record<string, unknown>[];
  };
  const clinical = has('opdscreen', 'vn', 'cc', 'hpi') && vn
    ? (await query('SELECT cc, hpi FROM opdscreen WHERE vn = ? LIMIT 1', vn))[0] || { cc: '', hpi: '' }
    : { cc: '', hpi: '' };
  const table = an ? 'iptdiag' : 'ovstdiag';
  const key = an ? 'an' : 'vn';
  let diagnoses: Record<string, unknown>[] = [];
  if (has(table, key, 'icd10')) {
    const dictionary = has('icd101', 'code', 'name');
    diagnoses = await query(`SELECT d.icd10 AS code, ${dictionary ? 'i.name' : "''"} AS name,
      ${has(table, 'diagtype') ? 'd.diagtype' : "''"} AS type, 'Diag' AS category FROM ${table} d
      ${dictionary ? 'LEFT JOIN icd101 i ON i.code = d.icd10' : ''} WHERE d.${key} = ?`, an || vn);
  } else warnings.push('ไม่พบตารางวินิจฉัยของประเภทบริการนี้');
  if (!diagnoses.length) {
    const stats = an ? 'an_stat' : 'vn_stat';
    const columns = ['pdx', 'dx0', 'dx1', 'dx2', 'dx3', 'dx4', 'dx5'].filter(column => has(stats, column));
    if (columns.length && has(stats, key)) {
      const summary = (await query(`SELECT ${columns.join(',')} FROM ${stats} WHERE ${key} = ? LIMIT 1`, an || vn))[0];
      if (summary) {
        const seen = new Set<string>();
        diagnoses = columns.flatMap(column => {
          const code = String(summary[column] || '').trim();
          if (!code || seen.has(code)) return [];
          seen.add(code);
          return [{ code, name: '', type: column === 'pdx' ? '1' : '2', category: 'Diag', source: stats }];
        });
        if (diagnoses.length) warnings.push(`แสดงรหัสจาก ${stats} เนื่องจากไม่พบรายการวินิจฉัยใน ${table}`);
      }
    }
  }
  const procedures: Record<string, unknown>[] = [];
  const add = async (source: string, available: boolean, sql: string, value = an || vn) => {
    if (!available) { warnings.push(`ไม่มีโครงสร้างข้อมูล ${source} ในฐานข้อมูลนี้`); return; }
    // Unexpected database errors are surfaced, never converted to a successful empty result.
    procedures.push(...await query(sql, value));
  };
  const icd9 = has('icd9cm1', 'code', 'name');
  if (an) {
    await add('หัตถการ IPD', has('iptoprt', 'an', 'icd9'), `SELECT p.icd9 AS code,
      ${icd9 ? 'i.name' : "''"} AS name, 'ผู้ป่วยใน' AS type FROM iptoprt p
      ${icd9 ? 'LEFT JOIN icd9cm1 i ON i.code = p.icd9' : ''} WHERE p.an = ?`);
  } else {
    await add('หัตถการแพทย์', has('doctor_operation', 'vn', 'icd9'), `SELECT p.icd9 AS code,
      ${icd9 ? 'i.name' : "''"} AS name, 'แพทย์' AS type FROM doctor_operation p
      ${icd9 ? 'LEFT JOIN icd9cm1 i ON i.code = p.icd9' : ''} WHERE p.vn = ?`);
    const er = has('er_oper_code', 'er_oper_code', 'name');
    await add('หัตถการ ER', has('er_regist_oper', 'vn', 'er_oper_code'), `SELECT p.er_oper_code AS code,
      ${er ? 'e.name' : "''"} AS name, 'ER' AS type FROM er_regist_oper p
      ${er ? 'LEFT JOIN er_oper_code e ON e.er_oper_code = p.er_oper_code' : ''} WHERE p.vn = ?`);
    const dental = has('dttm', 'code') && has('dtmain', 'tmcode');
    const dentalFields = (names: string[]) => names.filter(name => has('dttm', name) && dental).map(name => `NULLIF(t.${name}, '')`);
    const codes = [...dentalFields(['icd10tm_operation_code', 'icd9cm']), ...(has('dtmain', 'icd9') ? ["NULLIF(p.icd9, '')"] : []), "NULLIF(p.tmcode, '')", "''"];
    await add('หัตถการทันตกรรม', has('dtmain', 'vn', 'tmcode'), `SELECT COALESCE(${codes.join(',')}) AS code,
      COALESCE(${[...dentalFields(['thai_name', 'name']), "'หัตถการทันตกรรม'"].join(',')}) AS name, 'Dental' AS type
      FROM dtmain p ${dental ? 'LEFT JOIN dttm t ON t.code = p.tmcode' : ''} WHERE p.vn = ?`);
    await add('หัตถการ OPD/43 แฟ้ม', has('view_procedure_opd', 'vn', 'code', 'name'),
      "SELECT code, name, 'OPD/43 แฟ้ม' AS type FROM view_procedure_opd WHERE vn = ?");
    const thai = has('health_med_service', 'vn', 'health_med_service_id')
      && has('health_med_service_operation', 'health_med_service_id', 'health_med_operation_item_id')
      && has('health_med_operation_item', 'health_med_operation_item_id', 'icd10tm', 'health_med_operation_item_name');
    await add('หัตถการแพทย์แผนไทย', thai, `SELECT ${has('health_med_service_operation', 'health_med_organ_id') ? "CASE WHEN REPLACE(i.icd10tm, '-', '') = '9007811' AND o.health_med_organ_id = 39 THEN '8727811' WHEN REPLACE(i.icd10tm, '-', '') = '9007811' AND o.health_med_organ_id = 40 THEN '8737811' WHEN REPLACE(i.icd10tm, '-', '') = '9007811' AND o.health_med_organ_id = 41 THEN '8747811' ELSE i.icd10tm END" : 'i.icd10tm'} AS code, i.health_med_operation_item_name AS name,
      'แพทย์แผนไทย' AS type FROM health_med_service s
      JOIN health_med_service_operation o ON o.health_med_service_id = s.health_med_service_id
      JOIN health_med_operation_item i ON i.health_med_operation_item_id = o.health_med_operation_item_id WHERE s.vn = ?`);
  }
  const unique = new Map<string, Record<string, unknown>>();
  for (const row of procedures) {
    const code = String(row.code || '').replace(/[.\s-]/g, '').toUpperCase();
    const id = code || String(row.name || '');
    if (!id) continue;
    const previous = unique.get(id);
    unique.set(id, { ...row, category: 'Procedure', type: previous ? [...new Set([previous.type, row.type])].join(', ') : row.type });
  }
  return { clinical, diagnoses, procedures: [...unique.values()], warnings };
}
