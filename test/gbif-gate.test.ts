import { afterEach, describe, expect, it, vi } from 'vitest';
import { getJSON } from '../src/api';

// A fake GBIF: answers 429 (Retry-After: 1) to the first `fail` requests, 200 after; records how many were in flight.
function fakeGbif(fail: number) {
  let inFlight = 0, seen = 0;
  const log: { url: string; t: number; inFlight: number; status: number }[] = [];
  const t0 = Date.now();
  vi.stubGlobal('fetch', async (url: string) => {
    inFlight++;
    const status = seen++ < fail ? 429 : 200;
    log.push({ url, t: Date.now() - t0, inFlight, status });
    await new Promise((r) => setTimeout(r, 20));
    inFlight--;
    return new Response(status === 200 ? '{"count":1}' : '', { status, headers: status === 429 ? { 'retry-after': '1' } : {} });
  });
  return log;
}
const url = (i: string) => `https://api.gbif.org/v1/occurrence/search?test=${i}`;

describe('GBIF request gate', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps at most four requests in flight, waits out a 429 pause and drops to one at a time after it', async () => {
    const log = fakeGbif(1);
    const all = await Promise.all(Array.from({ length: 8 }, (_, i) => getJSON<{ count: number }>(url(`a${i}`), { noCache: true })));
    expect(all.every((r) => r.count === 1)).toBe(true);
    expect(Math.max(...log.map((x) => x.inFlight))).toBeLessThanOrEqual(4);
    const first429 = log.find((x) => x.status === 429)!;
    const after = log.filter((x) => x.t > first429.t + 50);
    expect(after.length).toBeGreaterThan(0);
    expect(Math.min(...after.map((x) => x.t))).toBeGreaterThanOrEqual(first429.t + 950); // Retry-After: 1
    expect(after[0].inFlight).toBe(1);
  }, 15000);

  it('sends the panel’s own requests before background ones that queued earlier', async () => {
    const log = fakeGbif(0);
    const jobs = [
      ...Array.from({ length: 6 }, (_, i) => getJSON(url(`low${i}`), { noCache: true, low: true })),
      ...Array.from({ length: 2 }, (_, i) => getJSON(url(`high${i}`), { noCache: true })),
    ];
    await Promise.all(jobs);
    const order = log.map((x) => x.url.split('test=')[1]);
    // the low ones that found a free slot went first; of those that had to queue, the high ones go out first
    const firstHigh = order.indexOf('high0');
    expect(order.slice(firstHigh, firstHigh + 2)).toEqual(['high0', 'high1']);
    expect(firstHigh).toBeLessThan(order.indexOf('low5'));
  }, 15000);
});
