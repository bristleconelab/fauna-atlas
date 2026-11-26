// Records per decade from year counts. Pure (test/fauna.test.ts).

/** Records per decade, from the first decade with data. */
export function decadeCounts(years: { year: number; records: number }[]): { decade: number; records: number }[] {
  const by = new Map<number, number>();
  for (const y of years) if (y.year >= 1800 && y.year <= 2100) by.set(Math.floor(y.year / 10) * 10, (by.get(Math.floor(y.year / 10) * 10) ?? 0) + y.records);
  if (!by.size) return [];
  let first = Infinity, last = -Infinity;
  for (const k of by.keys()) { if (k < first) first = k; if (k > last) last = k; }
  const out: { decade: number; records: number }[] = [];
  for (let d = first; d <= last; d += 10) out.push({ decade: d, records: by.get(d) ?? 0 });
  return out;
}
