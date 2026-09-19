import dotenv from 'dotenv';
dotenv.config();

// ============================================================================
// FDH Checker Database Facade
// Re-exports from domain-aligned repositories and connection seams.
// Preserves 100% backward compatibility for existing routes, tests, and CLI scripts.
// ============================================================================

export * from './db/connection.js';
export * from './db/schema.js';
export * from './utils/dataNormalization.js';
export * from './repositories/system.repository.js';
export * from './repositories/receivables.repository.js';
export * from './repositories/clinicalRules.js';
export * from './repositories/claims.repository.js';
export * from './repositories/clinical.repository.js';
