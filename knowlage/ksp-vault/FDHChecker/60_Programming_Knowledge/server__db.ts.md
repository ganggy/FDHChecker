---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/db.ts"
source_hash: "4d9b1401bd27842b053d6a0fa7aa3d16f43517967d3ab044a117dafbd2f2a1a8"
managed_by: "sync-ksp-vault"
---
# db.ts

> Source: `server/db.ts`
> SHA-256: `4d9b1401bd27842b053d6a0fa7aa3d16f43517967d3ab044a117dafbd2f2a1a8`

````typescript
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

````
