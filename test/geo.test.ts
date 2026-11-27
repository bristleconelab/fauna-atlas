import { describe, expect, it } from 'vitest';
import { bboxToWkt, formatLatLon, geohash, geohashBounds, greatCircle } from '../src/geo';

describe('geohash', () => {
  it('matches known reference hashes', () => {
    expect(geohash(-5.6, 42.6, 5)).toBe('ezs42'); // the Wikipedia example
    expect(geohash(0, 0, 3)).toBe('s00');
  });
  it('round-trips: a point lies inside its own cell, and a level-3 cell is 1.40625° square', () => {
    for (const [lon, lat] of [[69.6, 22.5], [-150.2, -60.1], [179.99, 89.9], [-180, -90]]) {
      const b = geohashBounds(geohash(lon, lat, 3));
      expect(lon).toBeGreaterThanOrEqual(b.west); expect(lon).toBeLessThanOrEqual(b.east);
      expect(lat).toBeGreaterThanOrEqual(b.south); expect(lat).toBeLessThanOrEqual(b.north);
      expect(b.east - b.west).toBeCloseTo(1.40625); expect(b.north - b.south).toBeCloseTo(1.40625);
    }
  });
  it('wraps longitude past the antimeridian', () => {
    expect(geohash(181, 10, 3)).toBe(geohash(-179, 10, 3));
  });
  it('rejects characters outside the alphabet', () => {
    expect(() => geohashBounds('a1')).toThrow();
  });
});

describe('helpers', () => {
  it('writes a closed WKT ring', () => {
    expect(bboxToWkt({ west: 1, south: 2, east: 3, north: 4 })).toBe('POLYGON((1 2,3 2,3 4,1 4,1 2))');
  });
  it('formats hemispheres', () => {
    expect(formatLatLon(-12.34, -45.67)).toBe('12.3° S, 45.7° W');
  });
  it('averages longitudes on the circle, so a range across 180° is centred near 180°, not 0°', () => {
    const c = rangeCentre([{ bbox: { west: 178, east: 179, south: 0, north: 1 } }, { bbox: { west: -179, east: -178, south: 0, north: 1 } }])!;
    expect(Math.abs(Math.abs(c.lon) - 180)).toBeLessThan(1);
    expect(c.lat).toBeCloseTo(0.5);
  });
});

describe('great circle', () => {
  it('passes through the right midpoint and crosses 180° without a jump', () => {
    const eq = greatCircle([0, 0], [90, 0], 2);
    expect(eq[1][0]).toBeCloseTo(45); expect(eq[1][1]).toBeCloseTo(0);
    const pac = greatCircle([170, 0], [-170, 0], 4);
    expect(pac.at(-1)![0]).toBeCloseTo(190);
    for (let i = 1; i < pac.length; i++) expect(Math.abs(pac[i][0] - pac[i - 1][0])).toBeLessThan(10);
    // north Atlantic route bends towards the pole
    expect(greatCircle([-74, 40], [0, 51], 2)[1][1]).toBeGreaterThan(45.5);
  });
});

import { ringsToWkt, simplifyRing, outerRings, ringsAreaKm2, ringSignedArea } from '../src/geo';
describe('shapes for GBIF', () => {
  const cw: [number, number][] = [[0, 0], [0, 1], [1, 1], [1, 0]];
  it('writes counter-clockwise closed polygons, one or several', () => {
    expect(ringsToWkt([cw])).toBe('POLYGON((1 0,1 1,0 1,0 0,1 0))');
    expect(ringsToWkt([cw, cw.map(([x, y]) => [x + 5, y] as [number, number])])).toBe('MULTIPOLYGON(((1 0,1 1,0 1,0 0,1 0)),((6 0,6 1,5 1,5 0,6 0)))');
    expect(ringsToWkt([[[0, 0], [1, 1]]])).toBeNull();
  });
  it('simplifies a dense ring to the corner budget and keeps its shape', () => {
    const circle = Array.from({ length: 2000 }, (_, i) => [Math.cos((i / 2000) * 2 * Math.PI), Math.sin((i / 2000) * 2 * Math.PI)] as [number, number]);
    const s = simplifyRing(circle, 60);
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.length).toBeGreaterThan(12);
    expect(Math.abs(ringSignedArea(s)) / Math.PI).toBeGreaterThan(0.95);
  });
  it('keeps the large parts of a multipolygon and drops specks', () => {
    const sq = (x: number, size: number) => [[x, 0], [x + size, 0], [x + size, size], [x, size], [x, 0]];
    const rings = outerRings({ type: 'MultiPolygon', coordinates: [[sq(0, 0.01)], [sq(10, 2)], [sq(20, 1)]] } as GeoJSON.MultiPolygon);
    expect(rings).toHaveLength(2);
    expect(Math.abs(ringSignedArea(rings[0]))).toBe(4);
  });
  it('measures area on the sphere: a 1° square at the equator is about 12,364 km²', () => {
    expect(ringsAreaKm2([[[0, 0], [1, 0], [1, 1], [0, 1]]])).toBeGreaterThan(12300);
    expect(ringsAreaKm2([[[0, 0], [1, 0], [1, 1], [0, 1]]])).toBeLessThan(12400);
  });
});

import { rangeCentre } from '../src/geo';
describe('range centre', () => {
  it('weights cells by area and wraps longitude', () => {
    const c = rangeCentre([{ bbox: { west: 170, east: 180, south: 0, north: 10 } }, { bbox: { west: -180, east: -170, south: 0, north: 10 } }])!;
    expect(Math.abs(Math.abs(c.lon) - 180)).toBeLessThan(1e-6);
    // a big equatorial cell outweighs a same-degree cell at 80° N
    const d = rangeCentre([{ bbox: { west: 0, east: 10, south: 0, north: 10 } }, { bbox: { west: 0, east: 10, south: 75, north: 85 } }])!;
    expect(d.lat).toBeLessThan(42.5);
  });
});
