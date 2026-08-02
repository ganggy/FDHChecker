---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/httpClient.ts"
source_hash: "443b65a4b21842a29b20927340a368604f7d8315f223e887c23efca2ba38b46e"
managed_by: "sync-ksp-vault"
---
# httpClient.ts

> Source: `server/httpClient.ts`
> SHA-256: `443b65a4b21842a29b20927340a368604f7d8315f223e887c23efca2ba38b46e`

````typescript
export const boundedInteger = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
};

export const outboundHttpTimeoutMs = boundedInteger(
  process.env.OUTBOUND_HTTP_TIMEOUT_MS,
  90_000,
  5_000,
  300_000,
);

export const fetchWithTimeout = (
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = outboundHttpTimeoutMs,
) => fetch(input, {
  ...init,
  signal: init.signal || AbortSignal.timeout(boundedInteger(timeoutMs, outboundHttpTimeoutMs, 1, 300_000)),
});

````
