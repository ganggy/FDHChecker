---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "server/httpClient.ts"
source_hash: "d4c545f0c6013eca90c6d14dc05ef963876a6174bf16ec8f1b687d9c33ba5b25"
managed_by: "sync-ksp-vault"
---
# httpClient.ts

> Source: `server/httpClient.ts`
> SHA-256: `d4c545f0c6013eca90c6d14dc05ef963876a6174bf16ec8f1b687d9c33ba5b25`

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
