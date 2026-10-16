import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';

export type HospitalDatabaseRequestContext = {
  hcode?: string | null;
  error?: Error;
};

const requests = new AsyncLocalStorage<HospitalDatabaseRequestContext>();

export function getHospitalDatabaseContext(): HospitalDatabaseRequestContext | undefined {
  return requests.getStore();
}

export function getCurrentFacilityHcode(): string | null {
  return requests.getStore()?.hcode || null;
}

export function setRequestFacilityHcode(hcode: string | null) {
  const context = requests.getStore();
  if (context) {
    context.hcode = hcode || null;
  }
}

export function runWithHospitalDatabaseContext<T>(
  context: HospitalDatabaseRequestContext,
  fn: () => T
): T {
  return requests.run(context, fn);
}

export function runWithFacilityHcode<T>(hcode: string | null, fn: () => T): T {
  const current = requests.getStore();
  return requests.run({ ...current, hcode: hcode || null }, fn);
}

export function recordHospitalDatabaseFailure(error: Error) {
  const context = requests.getStore();
  if (context && !context.error) context.error = error;
}

// Some legacy reports catch a SQL error and return an empty list. A failed HIS
// query must not become a successful clinical/claim report for this request.
export const hospitalDatabaseResponseGuard: RequestHandler = (req, res, next) => {
  const authUserHcode = (req as { authUser?: { hcode?: string | null } }).authUser?.hcode || null;
  requests.run({ hcode: authUserHcode }, () => {
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
