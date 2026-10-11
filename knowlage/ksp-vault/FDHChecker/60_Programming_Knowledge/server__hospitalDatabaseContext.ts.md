---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/hospitalDatabaseContext.ts"
source_hash: "7d87f164b57b5f573963175bdb3c127bb8f34359bf70a8a9faa6f1fe633f461f"
managed_by: "sync-ksp-vault"
---
# hospitalDatabaseContext.ts

> Source: `server/hospitalDatabaseContext.ts`
> SHA-256: `7d87f164b57b5f573963175bdb3c127bb8f34359bf70a8a9faa6f1fe633f461f`

````typescript
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';

const requests = new AsyncLocalStorage<{ error?: Error }>();

export function recordHospitalDatabaseFailure(error: Error) {
  const context = requests.getStore();
  if (context && !context.error) context.error = error;
}

// Some legacy reports catch a SQL error and return an empty list. A failed HIS
// query must not become a successful clinical/claim report for this request.
export const hospitalDatabaseResponseGuard: RequestHandler = (_req, res, next) => {
  requests.run({}, () => {
    const send = res.send.bind(res);
    res.send = (body) => {
      const failure = requests.getStore()?.error;
      if (failure) {
        const unsupported = (failure as Error & { code?: string }).code === 'HIS_POSTGRES_UNSUPPORTED';
        res.status(unsupported ? 422 : 503);
        res.removeHeader('Content-Disposition');
        res.type('application/json');
        return send(JSON.stringify({ success: false, error: failure.message }));
      }
      return send(body);
    };
    next();
  });
};

````
