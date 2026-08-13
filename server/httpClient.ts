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
