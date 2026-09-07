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
