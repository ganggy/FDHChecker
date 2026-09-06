import sqlParser from 'node-sql-parser';

const parser = new sqlParser.Parser();
// The legacy repository uses MySQL SQL. Transform parsed expressions, never user values
// or SQL fragments with string replacement. Unsupported statements fail closed.
type Ast = Record<string, any>;
const raw = (value: string) => ({ type: 'default', value });
const render = (node: Ast) => parser.exprToSQL(node as never, { database: 'Postgresql' });
const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

export class UnsupportedPostgresQueryError extends Error {
  code = 'HIS_POSTGRES_UNSUPPORTED';
  constructor(reason: string) {
    super(`PostgreSQL: ${reason} — ไม่ได้ดำเนินคำสั่งนี้`);
    this.name = 'UnsupportedPostgresQueryError';
  }
}

// Assign parameter identities before parsing; traversal order is not parameter order.
function bindParameters(sql: string, values: unknown[]) {
  let output = '', index = 0;
  const parameters: unknown[] = [];
  for (let i = 0; i < sql.length;) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const delimiter = ch;
      output += ch; i++;
      while (i < sql.length) {
        const c = sql[i++]; output += c;
        if (c === '\\' && i < sql.length) { output += sql[i++]; continue; }
        if (c === delimiter) {
          if (sql[i] === delimiter) { output += sql[i++]; continue; }
          break;
        }
      }
    } else if (sql.startsWith('--', i) || ch === '#') {
      const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end;
      output += ' ';
    } else if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      if (end < 0 || sql[i + 2] === '!') throw new UnsupportedPostgresQueryError('ไม่รองรับ executable SQL comments');
      i = end + 2; output += ' ';
    } else if (ch === '?') {
      if (sql[i + 1] === '?') throw new UnsupportedPostgresQueryError('ไม่รองรับ identifier placeholders');
      if (index >= values.length) throw new UnsupportedPostgresQueryError('จำนวน parameter ไม่ตรงกัน');
      const value = values[index++];
      const items = Array.isArray(value) ? value : [value];
      if (!items.length || items.some(Array.isArray)) throw new UnsupportedPostgresQueryError('ไม่รองรับรายการ parameter ว่างหรือซ้อนกัน');
      const bound = items.map((item) => { const n = parameters.push(item); return `:fdh_param_${n}`; }).join(', ');
      // The MySQL grammar accepts a function (but not a named parameter) after REGEXP.
      output += /\b(?:REGEXP|RLIKE)\s*$/i.test(output) ? `CONCAT(${bound})` : bound;
      i++;
    } else { output += ch; i++; }
  }
  if (index !== values.length) throw new UnsupportedPostgresQueryError('จำนวน parameter ไม่ตรงกัน');
  return { output, parameters };
}

const dateTokens: Record<string, string> = {
  Y: 'YYYY', y: 'YY', m: 'MM', c: 'FMMM', d: 'DD', e: 'FMDD', H: 'HH24', h: 'HH12',
  I: 'HH12', i: 'MI', s: 'SS', S: 'SS', f: 'US', p: 'AM', T: 'HH24:MI:SS',
};
function dateFormat(value: string) {
  let result = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '%') {
      const token = value[++i];
      if (token === '%') { result += '"%"'; continue; }
      if (!dateTokens[token]) throw new UnsupportedPostgresQueryError('รูปแบบวันที่นี้ยังไม่รองรับ');
      result += dateTokens[token];
    } else {
      result += `"${value[i].replace(/"/g, '\\"')}"`;
    }
  }
  return result;
}

// Add only joined dimension keys, never arbitrary detail columns or ANY_VALUE.
// PostgreSQL itself still requires these to be declared primary keys before it
// permits the dependent projected columns. Missing constraints fail explicitly.
function expandHospitalGroupKeys(select: Ast) {
  if (!select.groupby?.columns?.length) return;
  const primaryKeys: Record<string, string> = {
    ovst: 'vn', patient: 'hn', pttype: 'pttype', vn_stat: 'vn', ovstist: 'ovstist',
    kskdepartment: 'depcode', ipt: 'an', an_stat: 'an', ward: 'ward',
  };
  const from: Ast[] = select.from || [];
  const groups: Ast[] = select.groupby.columns;
  const determined = new Set<string>();
  const alias = (table: Ast) => String(table.as || table.table || '').toLowerCase();
  for (const table of from) {
    const key = primaryKeys[String(table.table).toLowerCase()];
    if (key && groups.some((group) => group.type === 'column_ref' && String(group.table || '').toLowerCase() === alias(table) && String(group.column).toLowerCase() === key)) determined.add(alias(table));
  }
  const equatesKey = (node: Ast | null, target: string, key: string): boolean => {
    if (!node || node.type !== 'binary_expr') return false;
    if (node.operator === 'AND') return equatesKey(node.left, target, key) || equatesKey(node.right, target, key);
    if (node.operator !== '=') return false;
    return [[node.left, node.right], [node.right, node.left]].some(([own, other]) =>
      own?.type === 'column_ref' && String(own.table).toLowerCase() === target && String(own.column).toLowerCase() === key &&
      other?.type === 'column_ref' && determined.has(String(other.table).toLowerCase()));
  };
  for (let pass = 0; pass < from.length; pass++) {
    for (const table of from) {
      const name = alias(table), key = primaryKeys[String(table.table).toLowerCase()];
      if (!key || determined.has(name) || !equatesKey(table.on, name, key)) continue;
      determined.add(name);
      groups.push({ type: 'column_ref', table: name, column: key });
    }
  }
}

export function compilePostgresQuery(sql: string, values: unknown[] = []) {
  const showTables = /^\s*SHOW\s+TABLES\s+LIKE\s+(.+?)\s*;?\s*$/i.exec(sql);
  if (showTables) return compilePostgresQuery(`SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE ${showTables[1]}`, values);
  const showColumns = /^\s*SHOW\s+COLUMNS\s+FROM\s+`?([a-z_][a-z0-9_]*)`?(?:\s+LIKE\s+(.+?))?\s*;?\s*$/i.exec(sql);
  if (showColumns) return compilePostgresQuery(`SELECT column_name AS Field, data_type AS Type FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?${showColumns[2] ? ` AND column_name LIKE ${showColumns[2]}` : ''}`, [showColumns[1].toLowerCase(), ...values]);
  const { output, parameters } = bindParameters(sql, values);
  let ast: Ast;
  try { ast = parser.astify(output, { database: 'MySQL' }) as Ast; }
  catch { throw new UnsupportedPostgresQueryError('รูปแบบ SQL นี้ยังไม่ผ่านตัวแปลง'); }
  if (Array.isArray(ast)) {
    if (ast.length !== 1) throw new UnsupportedPostgresQueryError('อนุญาตครั้งละหนึ่งคำสั่ง');
    ast = ast[0];
  }
  if (ast.type !== 'select') throw new UnsupportedPostgresQueryError('การเชื่อมต่อ HIS PostgreSQL รองรับการอ่านข้อมูลเท่านั้น');

  const transform = (node: any): any => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(transform);
    if (node.type === 'param') {
      if (!/^fdh_param_\d+$/.test(node.value)) throw new UnsupportedPostgresQueryError('parameter ไม่ถูกต้อง');
      return raw(`$${node.value.slice('fdh_param_'.length)}`);
    }
    if (node.type === 'select') {
      if (node.into?.expr || node.into?.type || node.locking_read) throw new UnsupportedPostgresQueryError('ไม่รองรับ SELECT INTO หรือการล็อกแถว');
      expandHospitalGroupKeys(node);
      for (const column of node.columns || []) {
        if (!column.as && column.expr?.type === 'column_ref' && /[A-Z]/.test(column.expr.column)) column.as = column.expr.column;
      }
    }
    if (node.type === 'column_ref') {
      if (typeof node.column === 'string') node.column = node.column.toLowerCase();
      if (node.table) node.table = node.table.toLowerCase();
    }
    if (node.table && typeof node.table === 'string' && node.type !== 'column_ref') {
      node.table = node.table.toLowerCase();
      if (node.db && node.db.toLowerCase() !== 'information_schema') throw new UnsupportedPostgresQueryError('ไม่รองรับ JOIN ข้ามฐานข้อมูล');
      if (node.db) node.db = node.db.toLowerCase();
      if (node.as) node.as = node.as.toLowerCase();
    }
    const transformed: Ast = Object.fromEntries(Object.entries(node).map(([key, child]) => [key, transform(child)]));
    if (transformed.type === 'select' && transformed.limit?.seperator === ',') {
      transformed.limit = { seperator: 'offset', value: [transformed.limit.value[1], transformed.limit.value[0]] };
    }
    if (transformed.type === 'binary_expr') {
      if (['REGEXP', 'RLIKE', 'NOT REGEXP'].includes(transformed.operator)) {
        // HOSxP's existing utf8mb4_unicode_ci matching is case insensitive.
        transformed.operator = transformed.operator === 'NOT REGEXP' ? '!~*' : '~*';
      }
      if (transformed.operator === 'LIKE') transformed.operator = 'ILIKE';
      if (transformed.operator === 'NOT LIKE') transformed.operator = 'NOT ILIKE';
      if (transformed.operator === '<=>') transformed.operator = 'IS NOT DISTINCT FROM';
    }
    if (transformed.type === 'interval') {
      const unit = String(transformed.unit).toLowerCase();
      if (!['year', 'month', 'week', 'day', 'hour', 'minute', 'second'].includes(unit)) throw new UnsupportedPostgresQueryError('หน่วยช่วงเวลาไม่รองรับ');
      return raw(`(${render(transformed.expr)} * INTERVAL '1 ${unit}')`);
    }
    if (transformed.type === 'cast') {
      for (const target of transformed.target || []) {
        if (['CHAR', 'SIGNED', 'UNSIGNED', 'DATETIME'].includes(target.dataType)) {
          target.dataType = ({ CHAR: 'TEXT', SIGNED: 'BIGINT', UNSIGNED: 'BIGINT', DATETIME: 'TIMESTAMP' } as Record<string, string>)[target.dataType];
          delete target.length;
        }
      }
    }
    if (transformed.type === 'aggr_func' && transformed.name === 'GROUP_CONCAT') {
      const args = transformed.args;
      if (args.limit) throw new UnsupportedPostgresQueryError('GROUP_CONCAT LIMIT ยังไม่รองรับ');
      const expression = render(args.expr);
      const orders: Ast[] = args.orderby || [];
      const separator = args.separator ? render(args.separator.value) : "','";
      if (args.distinct && orders.some((item) => render(item.expr) !== expression)) {
        // PostgreSQL disallows DISTINCT string_agg ordered by a different expression.
        // Aggregate the value and sort keys together, then deduplicate and order them.
        const keys = orders.map((item) => render(item.expr));
        const sorting = orders.map((item, index) => `(item->${index + 1}) ${item.type || 'ASC'}`).join(', ');
        return raw(`(SELECT STRING_AGG(item->>0, ${separator} ORDER BY ${sorting}) FROM
          (SELECT DISTINCT ON (item->>0) item FROM JSONB_ARRAY_ELEMENTS(JSONB_AGG(JSONB_BUILD_ARRAY((${expression})::text, ${keys.join(', ')}))) AS entries(item)
          WHERE item->>0 IS NOT NULL ORDER BY item->>0, ${sorting}) AS deduplicated)`);
      }
      const ordering = (args.orderby || []).map((item: Ast) => {
        const sort = render(item.expr);
        return `${args.distinct ? `(${sort})::text` : sort} ${item.type || 'ASC'}`;
      });
      return raw(`STRING_AGG(${args.distinct ? 'DISTINCT ' : ''}(${expression})::text, ${separator}${ordering.length ? ` ORDER BY ${ordering.join(', ')}` : ''})`);
    }
    if (transformed.type === 'function') {
      const name = transformed.name.name.map((part: Ast) => part.value).join('.').toUpperCase();
      const args: Ast[] = transformed.args?.value || [];
      const rendered = args.map(render);
      if (name === 'IFNULL') return raw(`COALESCE(${rendered.join(', ')})`);
      if (name === 'CONCAT') {
        const strings = rendered.map((arg) => `(${arg})::text`);
        return raw(`(CASE WHEN ${strings.map((arg) => `${arg} IS NULL`).join(' OR ')} THEN NULL ELSE CONCAT(${strings.join(', ')}) END)`);
      }
      if (name === 'LENGTH') return raw(`OCTET_LENGTH((${rendered[0]})::text)`);
      if (name === 'LPAD' || name === 'RPAD') return raw(`${name}((${rendered[0]})::text, ${rendered[1]}, ${rendered[2]})`);
      if (name === 'IF') return raw(`(CASE WHEN ${rendered[0]} THEN ${rendered[1]} ELSE ${rendered[2]} END)`);
      if (name === 'CURDATE') return raw('CURRENT_DATE');
      if (name === 'DATABASE') return raw('CURRENT_SCHEMA()');
      if (name === 'DATE_FORMAT' || name === 'TIME_FORMAT') {
        if (args[1]?.type !== 'single_quote_string') throw new UnsupportedPostgresQueryError('รูปแบบวันที่ต้องเป็นค่าคงที่');
        const timeOnly = name === 'TIME_FORMAT' || !/%[Yymcde]/.test(args[1].value);
        const input = timeOnly ? `(${rendered[0]})::time` : `(${rendered[0]})::timestamp`;
        return raw(`TO_CHAR(${input}, ${quote(dateFormat(args[1].value))})`);
      }
      if (name === 'DATE_ADD' || name === 'DATE_SUB') return raw(`(${rendered[0]} ${name === 'DATE_ADD' ? '+' : '-'} ${rendered[1]})`);
      if (name === 'TIMESTAMP') return raw(args.length === 2 ? `((${rendered[0]})::date + (${rendered[1]})::time)` : `(${rendered[0]})::timestamp`);
      if (name === 'DATEDIFF') return raw(`((${rendered[0]})::date - (${rendered[1]})::date)`);
      if (['YEAR', 'MONTH', 'DAY', 'DAYOFMONTH', 'HOUR', 'MINUTE', 'SECOND'].includes(name)) {
        return raw(`EXTRACT(${name === 'DAYOFMONTH' ? 'DAY' : name} FROM ${rendered[0]})::integer`);
      }
      if (name === 'TIMESTAMPDIFF') {
        const unit = String(args[0]?.value).toUpperCase();
        const age = `AGE((${rendered[2]})::timestamp, (${rendered[1]})::timestamp)`;
        if (unit === 'YEAR') return raw(`EXTRACT(YEAR FROM ${age})::integer`);
        if (unit === 'MONTH') return raw(`(EXTRACT(YEAR FROM ${age}) * 12 + EXTRACT(MONTH FROM ${age}))::integer`);
        const divisor = ({ WEEK: 604800, DAY: 86400, HOUR: 3600, MINUTE: 60, SECOND: 1 } as Record<string, number>)[unit];
        if (!divisor) throw new UnsupportedPostgresQueryError('หน่วย TIMESTAMPDIFF ยังไม่รองรับ');
        return raw(`TRUNC(EXTRACT(EPOCH FROM ((${rendered[2]})::timestamp - (${rendered[1]})::timestamp)) / ${divisor})::bigint`);
      }
      if (name === 'ROUND' && args.length === 2) return raw(`ROUND((${rendered[0]})::numeric, ${rendered[1]})`);
      if (name === 'SUBSTRING_INDEX') {
        if (args[2]?.type !== 'number' || args[2].value !== 1) throw new UnsupportedPostgresQueryError('SUBSTRING_INDEX รองรับเฉพาะส่วนแรก');
        return raw(`SPLIT_PART(${rendered[0]}, ${rendered[1]}, 1)`);
      }
      if (['GET_LOCK', 'RELEASE_LOCK', 'SLEEP', 'BENCHMARK', 'LOAD_FILE', 'LAST_INSERT_ID', 'FOUND_ROWS', 'FIND_IN_SET'].includes(name)) {
        throw new UnsupportedPostgresQueryError(`ยังไม่รองรับฟังก์ชัน ${name}`);
      }
    }
    return transformed;
  };
  try { return { text: parser.sqlify(transform(ast) as never, { database: 'Postgresql' }), values: parameters }; }
  catch (error) {
    if (error instanceof UnsupportedPostgresQueryError) throw error;
    throw new UnsupportedPostgresQueryError('ไม่สามารถแปลง SQL นี้ได้');
  }
}
