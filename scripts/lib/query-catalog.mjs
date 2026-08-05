import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const TABLE_TERMS = {
  patient: ['ผู้ป่วย', 'คนไข้', 'HN', 'CID', 'ข้อมูลประชากร'],
  ovst: ['OPD', 'ผู้ป่วยนอก', 'visit', 'รับบริการ'],
  vn_stat: ['สถิติ OPD', 'วินิจฉัยหลัก', 'ค่าใช้จ่าย'],
  ipt: ['IPD', 'ผู้ป่วยใน', 'admit', 'AN'],
  an_stat: ['สถิติ IPD', 'วินิจฉัยผู้ป่วยใน'],
  ovstdiag: ['วินิจฉัย', 'ICD10', 'diagnosis'],
  opdscreen: ['คัดกรอง', 'อาการ', 'ความดัน', 'น้ำหนัก'],
  opitemrece: ['ยา', 'บริการ', 'ค่าใช้จ่าย', 'รายการเบิก'],
  drugitems: ['ยา', 'drug'],
  s_drugitems: ['ยา', 'รหัสเบิก', 'ADP'],
  nondrugitems: ['บริการ', 'หัตถการ', 'ADP'],
  income: ['หมวดค่าใช้จ่าย', 'รายได้'],
  lab_head: ['ผลแล็บ', 'ห้องปฏิบัติการ'],
  lab_order: ['ผลแล็บ', 'รายการตรวจ'],
  lab_items: ['ชื่อแล็บ', 'ค่าปกติ'],
  oapp: ['นัดหมาย', 'วันนัด', 'นัดซ้ำ'],
  clinic: ['คลินิก', 'นัดหมาย'],
  kskdepartment: ['แผนก', 'หน่วยงาน'],
  pttype: ['สิทธิ', 'สิทธิการรักษา'],
  ward: ['หอผู้ป่วย', 'ward'],
  doctor: ['แพทย์', 'ผู้ตรวจ'],
  doctor_operation: ['หัตถการ', 'ICD9'],
  icd101: ['ICD10', 'ชื่อโรค'],
  icd9cm1: ['ICD9', 'ชื่อหัตถการ'],
  authenhos: ['authen', 'ยืนยันสิทธิ'],
  visit_pttype: ['สิทธิ visit', 'auth code'],
  nhso_confirm_privilege: ['สปสช.', 'ยืนยันสิทธิ'],
  fdh_claim_status: ['FDH', 'สถานะเคลม', 'ข้อผิดพลาด', 'ส่งเบิก'],
};

const normalizeSql = (sql) => sql
  .replace(/\r\n/g, '\n')
  .replace(/[ \t]+/g, ' ')
  .replace(/\s*\n\s*/g, '\n')
  .trim()
  .replace(/;+$/, '');

const sqlTables = (sql) => Array.from(new Set(
  [...sql.matchAll(/\b(?:from|join)\s+(?:`?[a-z0-9_]+`?\.)?`?([a-z][a-z0-9_]*)`?/gi)]
    .map((match) => match[1].toLowerCase())
    .filter((table) => table !== 'select'),
));

const enclosingFunctionName = (node) => {
  let current = node.parent;
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) return current.name.text;
    if (ts.isMethodDeclaration(current) && current.name) return current.name.getText();
    current = current.parent;
  }
  return 'module-query';
};

const literalSql = (node) => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return '';
};

export const extractQueriesFromSource = (sourceText, relativeFile, allowedTables) => {
  const sourceFile = ts.createSourceFile(relativeFile, sourceText, ts.ScriptTarget.Latest, true);
  const results = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ['query', 'execute'].includes(node.expression.name.text)
      && node.arguments.length
    ) {
      const sql = normalizeSql(literalSql(node.arguments[0]));
      if (/^(?:select|with)\b/i.test(sql) && !/\b(?:insert|update|delete|replace|drop|alter|create|truncate|call|set|use)\b/i.test(sql)) {
        const tables = sqlTables(sql);
        if (tables.length && tables.every((table) => allowedTables.has(table))) {
          results.push({
            sql,
            tables,
            source: relativeFile,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            functionName: enclosingFunctionName(node),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return results;
};

export const readAllowedTables = (catalogSource) => {
  const match = catalogSource.match(/AI_ALLOWED_HOSXP_TABLES\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  if (!match) throw new Error('อ่าน AI_ALLOWED_HOSXP_TABLES ไม่สำเร็จ');
  return new Set([...match[1].matchAll(/['"]([a-z][a-z0-9_]*)['"]/gi)].map((item) => item[1].toLowerCase()));
};

const walkTypeScript = async (directory) => {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ['dist', 'node_modules'].includes(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkTypeScript(full));
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(full);
  }
  return files;
};

const queryTerms = (query) => Array.from(new Set([
  ...query.tables.flatMap((table) => TABLE_TERMS[table] || []),
  query.functionName.replace(/([a-z])([A-Z])/g, '$1 $2'),
]));

export const buildQueryCatalog = async (projectRoot) => {
  const catalogPath = path.join(projectRoot, 'server', 'aiHosxpCatalog.ts');
  const allowedTables = readAllowedTables(await fs.readFile(catalogPath, 'utf8'));
  const files = await walkTypeScript(path.join(projectRoot, 'server'));
  const queries = [];
  for (const file of files) {
    const relative = path.relative(projectRoot, file).split(path.sep).join('/');
    queries.push(...extractQueriesFromSource(await fs.readFile(file, 'utf8'), relative, allowedTables));
  }
  const unique = new Map();
  for (const query of queries) {
    const key = crypto.createHash('sha256').update(query.sql).digest('hex');
    if (!unique.has(key)) unique.set(key, { ...query, id: key.slice(0, 12), terms: queryTerms(query) });
  }
  return [...unique.values()].sort((a, b) => a.source.localeCompare(b.source) || a.line - b.line);
};

export const renderQueryCatalog = (queries) => [
  '# FDHChecker Read-only Query Catalog',
  '',
  '> รูปแบบ SELECT ที่สกัดจากระบบ FDHChecker อัตโนมัติ ใช้เป็นตัวอย่างวางแผนรายงานเท่านั้น',
  '> ต้องตรวจ allowlist, ใช้ parameter และผ่าน Read-only SQL Validator ก่อนรันทุกครั้ง',
  '> ห้ามนำ Query ในเอกสารนี้ไปใช้แก้ไขข้อมูล และห้ามเติมข้อมูลผู้ป่วยจากการคาดเดา',
  '',
  `จำนวนรูปแบบ Query ที่ผ่านการตรวจ: ${queries.length}`,
  '',
  ...queries.flatMap((query, index) => [
    `## ${index + 1}. ${query.functionName} — ${query.terms.slice(0, 8).join(' / ')}`,
    '',
    `- Source: \`${query.source}:${query.line}\``,
    `- Tables: ${query.tables.map((table) => `\`${table}\``).join(', ')}`,
    `- Search terms: ${query.terms.join(', ')}`,
    `- Query ID: \`${query.id}\``,
    '',
    '```sql',
    query.sql,
    '```',
    '',
  ]),
].join('\n');
