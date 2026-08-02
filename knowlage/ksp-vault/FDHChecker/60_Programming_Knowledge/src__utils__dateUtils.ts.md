---
ksp_schema: 1
project: FDHChecker
type: "source-snapshot"
category: "programming"
source: "src/utils/dateUtils.ts"
source_hash: "caba3338935ee8fd591924d511289136be445736de6ff1971b3e3eb0a3eced6d"
managed_by: "sync-ksp-vault"
---
# dateUtils.ts

> Source: `src/utils/dateUtils.ts`
> SHA-256: `caba3338935ee8fd591924d511289136be445736de6ff1971b3e3eb0a3eced6d`

````typescript
export const formatLocalDateInput = (date: Date = new Date()): string => {
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
};

export const formatLocalDateStamp = (): string => formatLocalDateInput(new Date());

export const formatLocalDateDaysAgo = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return formatLocalDateInput(date);
};

````
