import { activeHospitalDatabaseConfig, type HospitalConnection } from './hospitalDatabase.js';

export async function readHospitalSchema(connection: HospitalConnection, tables: string[]) {
  const [rows] = await connection.query(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = ? AND table_name IN (${tables.map(() => '?').join(',')})`,
    [activeHospitalDatabaseConfig.type === 'postgresql' ? activeHospitalDatabaseConfig.schema : activeHospitalDatabaseConfig.database, ...tables],
  );
  const columns = new Set((rows as Record<string, unknown>[]).map(row => `${String(row.table_name).toLowerCase()}.${String(row.column_name).toLowerCase()}`));
  const tableNames = new Set((rows as Record<string, unknown>[]).map(row => String(row.table_name).toLowerCase()));
  return (table: string, ...names: string[]) => {
    const t = table.toLowerCase();
    if (!tableNames.has(t)) return false;
    if (names.length === 0) return true;
    return names.every(name => columns.has(`${t}.${name.toLowerCase()}`));
  };
}

