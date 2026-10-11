---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/hospitalSchema.ts"
source_hash: "d82284bf05c156e97f39b92382dd7176dd7dbe23fc48b2db8a4685a9a235002b"
managed_by: "sync-ksp-vault"
---
# hospitalSchema.ts

> Source: `server/hospitalSchema.ts`
> SHA-256: `d82284bf05c156e97f39b92382dd7176dd7dbe23fc48b2db8a4685a9a235002b`

````typescript
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


````
