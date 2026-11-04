export function monthlyAllocation(value, startDate, endDate, month) {
  const start = String(startDate || '').slice(0, 7);
  const end = String(endDate || '').slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(start) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(end) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return 0;
  if (month < start || month > end) return 0;
  const [startYear, startMonth] = start.split('-').map(Number);
  const [endYear, endMonth] = end.split('-').map(Number);
  const [year, currentMonth] = month.split('-').map(Number);
  const count = (endYear - startYear) * 12 + endMonth - startMonth + 1;
  const index = (year - startYear) * 12 + currentMonth - startMonth;
  if (count < 1 || index < 0 || index >= count) return 0;
  const cents = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) return 0;
  const base = Math.floor(cents / count);
  const remainder = cents - base * count;
  return (base + (index < remainder ? 1 : 0)) / 100;
}
