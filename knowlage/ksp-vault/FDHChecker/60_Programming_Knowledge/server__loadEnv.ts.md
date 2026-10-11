---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/loadEnv.ts"
source_hash: "4c7ca3bb0fd7700e5380681a762c1505e3b88defa380fa69a323b9593978a29a"
managed_by: "sync-ksp-vault"
---
# loadEnv.ts

> Source: `server/loadEnv.ts`
> SHA-256: `4c7ca3bb0fd7700e5380681a762c1505e3b88defa380fa69a323b9593978a29a`

````typescript
import dotenv from 'dotenv';

dotenv.config();

const isTestProcess = process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT);
if (process.env.NODE_ENV !== 'production' && !isTestProcess) {
  dotenv.config({ path: '.env.local', override: true });
}

````
