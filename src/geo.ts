// Geohash cells and small geometry helpers. Pure, no DOM (test/geo.test.ts).
// A geohash-3 cell is 1.40625 deg on each side: the square the atlas uses for "life here".

const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Standard geohash (longitude bit first). Longitude is wrapped to [-180, 180), latitude clamped. */
export function geohash(lon: number, lat: number, precision: number): string {
  const wlon = ((((lon + 180) % 360) + 360) % 360) - 180;
  const clat = Math.max(-90, Math.min(90, lat));
  const lo = [-180, 180], la = [-90, 90];
  let even = true, bit = 0, ch = 0, out = '';
  while (out.length < precision) {
    const r = even ? lo : la, v = even ? wlon : clat, mid = (r[0] + r[1]) / 2;
    if (v >= mid) { ch = (ch << 1) | 1; r[0] = mid; } else { ch <<= 1; r[1] = mid; }
    even = !even;
    if (++bit === 5) { out += B32[ch]; bit = 0; ch = 0; }
  }
  return out;
}

export interface BBox { west: number; south: number; east: number; north: number }

/** Bounds of a geohash cell. Throws on characters outside the geohash alphabet. */
export function geohashBounds(hash: string): BBox {
  const lo = [-180, 180], la = [-90, 90];
  let even = true;
  for (const c of hash) {
    const v = B32.indexOf(c);
    if (v < 0) throw new Error(`not a geohash: ${hash}`);
    for (let b = 4; b >= 0; b--) {
      const r = even ? lo : la, mid = (r[0] + r[1]) / 2;
      if ((v >> b) & 1) r[0] = mid; else r[1] = mid;
      even = !even;
    }
  }
  return { west: lo[0], south: la[0], east: lo[1], north: la[1] };
}

/** WKT polygon for the OBIS API geometry parameter (counter-clockwise ring, closed). */
export function bboxToWkt(b: BBox): string {
  const f = (n: number) => +n.toFixed(5);
  const ring = [[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north], [b.west, b.south]];
  return `POLYGON((${ring.map(([x, y]) => `${f(x)} ${f(y)}`).join(',')}))`;
}

export function bboxRing(b: BBox): [number, number][] {
  return [[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north], [b.west, b.south]];
}

/** "22.5° N, 69.6° E" */
export function formatLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S', ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(1)}° ${ns}, ${Math.abs(lon).toFixed(1)}° ${ew}`;
}

/** Points along the great circle from a to b (lon/lat degrees), longitudes unwrapped so the line never jumps 360°. */
export function greatCircle(a: [number, number], b: [number, number], steps = 32): [number, number][] {
  const r = Math.PI / 180;
  const [l1, p1] = [a[0] * r, a[1] * r], [l2, p2] = [b[0] * r, b[1] * r];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d < 1e-9) return [a, b];
  const out: [number, number][] = [];
  let prev = a[0];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    let lon = Math.atan2(y, x) / r;
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    prev = lon;
    out.push([lon, Math.atan2(z, Math.sqrt(x * x + y * y)) / r]);
  }
  return out;
}

/** Area of a lon/lat box on a sphere of the Earth's mean radius, km². A geohash-3 square is ~24,600 km² at the
 *  equator and ~8,400 km² at 70°, which is why the "looked" layer shows records per area, not per square. */
export function cellAreaKm2(b: BBox): number {
  const R = 6371.0088, r = Math.PI / 180;
  return R * R * Math.abs((b.east - b.west) * r) * Math.abs(Math.sin(b.north * r) - Math.sin(b.south * r));
}

/** Bounds of points around their circular mean longitude, so a set across 180° gives one tight box
 *  (west may be below -180 or east above 180; MapLibre accepts that). */
export function frameOf(points: [number, number][]): { west: number; east: number; south: number; north: number; lon: number; lat: number; wide: boolean } | null {
  if (!points.length) return null;
  let sx = 0, sy = 0;
  for (const [x] of points) { sx += Math.cos((x * Math.PI) / 180); sy += Math.sin((x * Math.PI) / 180); }
  const c = (Math.atan2(sy, sx) * 180) / Math.PI;
  let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
  for (const [x, y] of points) {
    const rel = ((((x - c + 540) % 360) + 360) % 360) - 180;
    if (rel < w) w = rel; if (rel > e) e = rel;
    if (y < s) s = y; if (y > n) n = y;
  }
  s = Math.max(-80, s); n = Math.min(80, n);
  return { west: c + w, east: c + e, south: s, north: n, lon: c + (w + e) / 2, lat: (s + n) / 2, wide: e - w > 100 || n - s > 70 };
}

// ---------- shapes: drawn areas, regions and parks as GBIF geometry ----------
export type Ring = [number, number][];

/** Signed area of a ring in degree² (positive = counter-clockwise), shoelace formula. */
export function ringSignedArea(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return a / 2;
}

/** Ramer–Douglas–Peucker on a ring, tolerance raised until at most `max` corners remain (closing point excluded). */
export function simplifyRing(ring: Ring, max = 80): Ring {
  const open = ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring.slice();
  if (open.length <= max) return open;
  const dp = (pts: Ring, tol: number): Ring => {
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack: [number, number][] = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop()!;
      let best = -1, bi = -1;
      const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-12;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L;
        if (d > best) { best = d; bi = i; }
      }
      if (best > tol && bi > 0) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  };
  // split the closed ring at its farthest point from the start, so both halves are open polylines
  let far = 1, fd = -1;
  for (let i = 1; i < open.length; i++) { const d = Math.hypot(open[i][0] - open[0][0], open[i][1] - open[0][1]); if (d > fd) { fd = d; far = i; } }
  let tol = 0.001, out = open;
  for (let k = 0; k < 40; k++, tol *= 1.6) {
    const a = dp(open.slice(0, far + 1), tol), b = dp([...open.slice(far), open[0]], tol);
    out = [...a, ...b.slice(1, -1)];
    if (out.length <= max) break;
  }
  return out;
}

/** GBIF geometry for one or more outer rings: counter-clockwise, closed, 4 decimals (about 10 m). A ring with fewer
 *  than three distinct corners is dropped; null when nothing is left. */
export function ringsToWkt(rings: Ring[]): string | null {
  const f = (n: number) => +n.toFixed(4);
  const parts = rings.map((r) => {
    const open = r.length > 1 && r[0][0] === r.at(-1)![0] && r[0][1] === r.at(-1)![1] ? r.slice(0, -1) : r.slice();
    if (open.length < 3) return null;
    const ccw = ringSignedArea(open) < 0 ? open.slice().reverse() : open;
    return `((${[...ccw, ccw[0]].map(([x, y]) => `${f(x)} ${f(y)}`).join(',')}))`;
  }).filter((x): x is string => !!x);
  if (!parts.length) return null;
  return parts.length === 1 ? `POLYGON${parts[0]}` : `MULTIPOLYGON(${parts.join(',')})`;
}

/** Outer rings of a GeoJSON Polygon or MultiPolygon, largest first, the `keep` largest only, each simplified so the
 *  total stays near `budget` corners (GBIF reads the geometry from the URL). */
export function outerRings(g: GeoJSON.Geometry | null | undefined, keep = 6, budget = 160): Ring[] {
  if (!g) return [];
  const polys: Ring[] = g.type === 'Polygon' ? [g.coordinates[0] as Ring] : g.type === 'MultiPolygon' ? g.coordinates.map((p) => p[0] as Ring) : [];
  const sorted = polys.map((r) => ({ r, a: Math.abs(ringSignedArea(r)) })).sort((a, b) => b.a - a.a);
  const big = sorted[0]?.a ?? 0;
  const kept = sorted.filter((x) => x.a >= big * 0.02).slice(0, keep);
  const total = kept.reduce((s, x) => s + x.a, 0) || 1;
  return kept.map((x) => simplifyRing(x.r, Math.max(8, Math.round((budget * x.a) / total))));
}

/** Box around rings. */
export function ringsBox(rings: Ring[]): BBox | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const r of rings) for (const [x, y] of r) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return Number.isFinite(w) ? { west: w, south: s, east: e, north: n } : null;
}

/** Area of rings on the sphere, km² (each ring projected with an equal-area cylindrical projection). */
export function ringsAreaKm2(rings: Ring[]): number {
  const R = 6371.0088, r = Math.PI / 180;
  return rings.reduce((sum, ring) => sum + Math.abs(ringSignedArea(ring.map(([x, y]) => [x * r * R, Math.sin(y * r) * R]))), 0);
}

/** Centre of a range from its occupied cells, each weighted by its area (Mercator cells shrink towards the poles, so
 *  counting cells would pull the centre poleward); longitudes averaged on the circle. */
export function rangeCentre(cells: { bbox: BBox }[]): { lon: number; lat: number } | null {
  let sx = 0, sy = 0, sl = 0, w = 0;
  for (const c of cells) {
    const a = cellAreaKm2(c.bbox), lon = ((c.bbox.west + c.bbox.east) / 2) * (Math.PI / 180);
    sx += Math.cos(lon) * a; sy += Math.sin(lon) * a; sl += ((c.bbox.south + c.bbox.north) / 2) * a; w += a;
  }
  return w ? { lon: Math.atan2(sy, sx) * (180 / Math.PI), lat: sl / w } : null;
}
