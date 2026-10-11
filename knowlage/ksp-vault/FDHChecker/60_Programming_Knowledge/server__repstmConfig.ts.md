---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/repstmConfig.ts"
source_hash: "93ed5624d477daca132133bcd43a6131a42f144347109987e90fe0832c6c0a22"
managed_by: "sync-ksp-vault"
---
# repstmConfig.ts

> Source: `server/repstmConfig.ts`
> SHA-256: `93ed5624d477daca132133bcd43a6131a42f144347109987e90fe0832c6c0a22`

````typescript
export type RepstmDatabaseConfig = {
  host: string;
  port: number;
  database: string;
  user: string | undefined;
  password: string | undefined;
};

export function resolveRepstmDatabaseConfig(env: NodeJS.ProcessEnv): RepstmDatabaseConfig {
  return {
    host: env.REPSTM_HOST || env.HOSXP_HOST || '127.0.0.1',
    port: Number(env.REPSTM_PORT || 3306),
    database: env.REPSTM_DB || 'repstminv',
    user: env.REPSTM_USER || env.HOSXP_USER,
    password: env.REPSTM_PASSWORD || env.HOSXP_PASSWORD,
  };
}

````
