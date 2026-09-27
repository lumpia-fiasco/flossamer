const DAY_MS = 86_400_000;

export const toMs = (iso: string) => Date.parse(iso);

export const daysBetween = (fromIso: string, toIso: string) =>
  (toMs(toIso) - toMs(fromIso)) / DAY_MS;

export const addDays = (iso: string, days: number) =>
  new Date(toMs(iso) + days * DAY_MS).toISOString();

/** YYYY-MM-DD, in UTC. */
export const isoDay = (iso: string) => iso.slice(0, 10);

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
