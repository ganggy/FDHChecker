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
