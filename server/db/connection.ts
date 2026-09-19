import mysql from 'mysql2/promise';
import { hospitalPool, type HospitalConnection } from '../hospitalDatabase.js';
import { resolveRepstmDatabaseConfig } from '../repstmConfig.js';
import dotenv from 'dotenv';

dotenv.config();

// Pool for hospital database (MySQL or PostgreSQL via adapter)
export const pool = hospitalPool;

// Pool for REP/STM local storage database
export const repstmConfig = resolveRepstmDatabaseConfig(process.env);
export const repstmPool = mysql.createPool({
  ...repstmConfig,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  charset: 'utf8mb4',
});

export const repstmDatabaseName = process.env.REPSTM_DB || 'repstminv';

/**
 * Returns a connection to the primary hospital database.
 */
export const getUTFConnection = async (): Promise<HospitalConnection> => {
  return pool.getConnection();
};

/**
 * Returns a connection to the REP/STM MySQL database configured for UTF-8.
 */
export const getRepstmConnection = async () => {
  const connection = await repstmPool.getConnection();
  await connection.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci');
  return connection;
};

/**
 * Safely closes all database connection pools.
 */
export const closeDatabasePools = async () => {
  await Promise.allSettled([pool.end(), repstmPool.end()]);
};
