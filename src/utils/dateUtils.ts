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
