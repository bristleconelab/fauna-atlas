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

/** One tagged animal's journey as stored in data/tracks/<key>.json (scripts/fetch_tracks.py): pieces of
 *  [lon, lat, hours since the first fix], longitudes unwrapped across the antimeridian. */
export interface TagTrack { s: number; a: string; km: number; d: number; t0: number; t1: number; p: [number, number, number][][] }
export interface TagTracks { key: number; cap: number; animals: number; studies: { key: string; title: string; licence: string; url: string }[]; tracks: TagTrack[] }

/** The part of a journey travelled `hours` after tagging, and where the animal was then (between two fixes, on the
 *  straight piece joining them; null once its tag has gone silent for good or before it started). Pure. */
export function trackAtHours(tr: TagTrack, hours: number): { upto: [number, number][][]; head: [number, number] | null } {
  const upto: [number, number][][] = [];
  let head: [number, number] | null = null;
  for (const seg of tr.p) {
    if (!seg.length || seg[0][2] > hours) break;
    const part: [number, number][] = [];
    for (let i = 0; i < seg.length; i++) {
      const [x, y, t] = seg[i];
      if (t <= hours) { part.push([x, y]); head = [x, y]; continue; }
      const [px, py, pt] = seg[i - 1];
      const f = (hours - pt) / Math.max(1e-9, t - pt);
      head = [px + (x - px) * f, py + (y - py) * f];
      part.push(head);
      break;
    }
    if (part.length > 1) upto.push(part);
  }
  const last = tr.p.at(-1)?.at(-1);
  if (last && hours > last[2]) head = null; // the tag went quiet: no moving dot
  return { upto, head };
}
