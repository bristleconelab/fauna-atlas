#!/usr/bin/env python3
"""Real journeys of tagged animals for the species with pages: public/data/tracks/<gbif key>.json.

A migration is a path, not a straight line between two places. GBIF publishes GPS and satellite-tag studies (Movebank
exports, BirdMap's storks and cranes, sea turtle and shark programmes) as occurrence rows with basisOfRecord
MACHINE_OBSERVATION and the tagged animal in organismID. For each species this script
  1. finds its machine-observation datasets (one facet request),
  2. keeps those that look like tag studies (most rows name an animal, several fixes per animal: camera traps and
     sound recorders do not),
  3. reads whole studies, page by page, up to MAX_ROWS rows per species (a study cut short would drop fixes at random),
  4. builds one path per animal with the same cleaning as Ocean Life Atlas (src/tracks.ts there): location errors that
     need an impossible speed are dropped, a silence of more than 20 days starts a new piece, moves under 5 km do not
     add to the distance,
  5. thins each path to at most MAX_POINTS fixes (shape kept by Douglas-Peucker) and writes the longest MAX_TRACKS.
GBIF limits the request rate per user agent: one process, Retry-After honoured. Run on a server (hours).

usage: python3 -I scripts/fetch_tracks.py --data data/pages/species.json --out public/data/tracks --cache /tmp/tracks-cache
"""
import argparse
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_pages_data import CLEAN, Fetcher  # noqa: E402

MAX_ROWS = 9900         # rows read per species at most (33 GBIF pages): past offset 10,000 GBIF pages slow to minutes
                        # each (a King Eider study hung there for half an hour), and GBIF limits deep paging itself
MAX_TRACKS = 40         # animals written per species (the longest paths)
MAX_POINTS = 400        # fixes per animal after thinning
MIN_FIXES = 5
MAX_GAP_DAYS = 20
FIX_ERROR_KM = 5
DAY = 86400.0
# fastest believable travel, km per day (as in Ocean Life Atlas): faster is a location error
# average km per day over a whole track, at most, for land mammals: a fox or a boar does not cover 48 km every day
# for seven years; that is many animals, or many places, under one ID. Whales, seals and sea cows are not held to it.
LAND_MAMMAL_MEAN_KM_PER_DAY = 25
MARINE_MAMMALS = {'Cetacea', 'Sirenia'}
MARINE_MAMMAL_FAMILIES = {'Phocidae', 'Otariidae', 'Odobenidae'}
CAP = {'birds': 1200, 'fish': 300, 'sharks': 300, 'mammals': 300, 'reptiles': 200, 'insects': 400, 'default': 400}
GROUP_BY_CLASS = {212: 'birds', 359: 'mammals', 121: 'sharks', 120: 'sharks', 216: 'insects',
                  11592253: 'reptiles', 11418114: 'reptiles', 11493978: 'reptiles'}


def haversine(lon1, lat1, lon2, lat2):
    r = math.pi / 180
    a = math.sin((lat2 - lat1) * r / 2) ** 2 + math.cos(lat1 * r) * math.cos(lat2 * r) * math.sin((lon2 - lon1) * r / 2) ** 2
    return 2 * 6371 * math.asin(min(1, math.sqrt(a)))


def speed(a, b):
    d = max(0, haversine(a[1], a[2], b[1], b[2]) - FIX_ERROR_KM)
    return d / max(abs(b[0] - a[0]) / DAY, 1 / 1440)


def clean_fixes(p, cap):
    """Ocean Life Atlas cleanFixes: lone spikes out, the best of the first five fixes as the start, then anything
    still too fast to reach from the last good fix. Fixes are (t seconds, lon, lat), time-ordered."""
    n0 = len(p)
    for _ in range(3):
        out, changed = [], False
        for i, f in enumerate(p):
            prev = out[-1] if out else None
            nxt = p[i + 1] if i + 1 < len(p) else None
            nxt2 = p[i + 2] if i + 2 < len(p) else None
            prev2 = out[-2] if len(out) > 1 else None
            in_bad = speed(prev, f) > cap if prev else False
            out_bad = speed(f, nxt) > cap if nxt else False
            if prev and nxt:
                spike = in_bad and out_bad and speed(prev, nxt) <= cap
            elif not prev and nxt and nxt2:
                spike = out_bad and speed(nxt, nxt2) <= cap and speed(f, nxt2) > cap
            elif not nxt and prev and prev2:
                spike = in_bad and speed(prev2, prev) <= cap and speed(prev2, f) > cap
            else:
                spike = False
            if spike:
                changed = True
                continue
            out.append(f)
        p = out
        if not changed:
            break

    def chain(s):
        kept = []
        for f in p[s:]:
            if kept and speed(kept[-1], f) > cap:
                continue
            kept.append(f)
        return kept
    kept = chain(0)
    for s in range(1, min(5, len(p))):
        c = chain(s)
        if len(c) > len(kept):
            kept = c
    return kept, n0 - len(kept)


def unwrap(seg):
    """Longitudes continuous across the antimeridian (179 -> 181, not -179), so a line does not cross the globe."""
    out = []
    for t, lon, lat in seg:
        if out:
            prev = out[-1][1]
            while lon - prev > 180:
                lon -= 360
            while lon - prev < -180:
                lon += 360
        out.append((t, lon, lat))
    return out


def rdp(points, eps):
    """Douglas-Peucker on (t, lon, lat), distance in degrees: keeps the shape with fewer fixes."""
    if len(points) < 3:
        return points
    stack, keep = [(0, len(points) - 1)], {0, len(points) - 1}
    while stack:
        a, b = stack.pop()
        (_, x1, y1), (_, x2, y2) = points[a], points[b]
        dx, dy = x2 - x1, y2 - y1
        norm = math.hypot(dx, dy) or 1e-12
        best, at = -1, None
        for i in range(a + 1, b):
            _, x, y = points[i]
            d = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / norm if (dx or dy) else math.hypot(x - x1, y - y1)
            if d > best:
                best, at = d, i
        if at is not None and best > eps:
            keep.add(at)
            stack += [(a, at), (at, b)]
    return [points[i] for i in sorted(keep)]


def thin(seg, max_points):
    eps = 0.01
    out = rdp(seg, eps)
    while len(out) > max_points:
        eps *= 2
        out = rdp(seg, eps)
    return out


def build_tracks(rows, cap):
    groups = {}
    for r in rows:
        t = parse_time(r.get('eventDate'))
        lon, lat = r.get('decimalLongitude'), r.get('decimalLatitude')
        if t is None or lon is None or lat is None or not r.get('organismID'):
            continue
        groups.setdefault((r['datasetKey'], r['organismID']), []).append((t, lon, lat))
    tracks = []
    for (dataset, animal), raw in groups.items():
        if len(raw) < MIN_FIXES:
            continue
        raw.sort()
        kept, dropped = clean_fixes(raw, cap)
        if len(kept) < MIN_FIXES:
            continue
        segs, cur, km = [], [kept[0]], 0.0
        for a, b in zip(kept, kept[1:]):
            if (b[0] - a[0]) / DAY > MAX_GAP_DAYS:
                segs.append(cur)
                cur = [b]
                continue
            d = haversine(a[1], a[2], b[1], b[2])
            km += d if d > FIX_ERROR_KM else 0
            cur.append(b)
        segs.append(cur)
        segs = [s for s in segs if len(s) >= 2]
        if not segs:
            continue
        tracks.append({'dataset': dataset, 'animal': str(animal)[:60], 'km': round(km), 'start': kept[0][0], 'end': kept[-1][0],
                       'dropped': dropped, 'segs': [unwrap(s) for s in segs]})
    tracks.sort(key=lambda x: -x['km'])
    return tracks


def parse_time(s):
    """Seconds since 1970 (UTC) from a GBIF eventDate: "2016-01-14T08:00Z", "...T08:00:00+02:00", "2016-01-14", or the
    start of a range "a/b". A time without a zone is taken as UTC."""
    from datetime import datetime, timezone
    if not s:
        return None
    first = s.split('/')[0].strip().replace(' ', 'T').replace('Z', '+00:00')
    try:
        d = datetime.fromisoformat(first)
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.timestamp()


def tag_studies(f, key):
    """Machine-observation datasets of a species that look like tag studies: (datasetKey, rows), most rows first."""
    r = f.gbif('occurrence/search', {**CLEAN, 'taxonKey': key, 'basisOfRecord': 'MACHINE_OBSERVATION', 'limit': 0,
                                     'facet': 'datasetKey', 'facetLimit': 20}) or {}
    out = []
    for c in (r.get('facets') or [{}])[0].get('counts', []):
        if c['count'] < 30:
            continue
        probe = f.gbif('occurrence/search', {**CLEAN, 'taxonKey': key, 'datasetKey': c['name'], 'basisOfRecord': 'MACHINE_OBSERVATION', 'limit': 50}) or {}
        rows = probe.get('results', [])
        named = [x.get('organismID') for x in rows if x.get('organismID')]
        # a tag study: nearly every row names an animal, and each animal sends several fixes. Monitoring schemes that
        # put a count or a site number in organismID ("1": Japan's Monitoring Sites 1000 camera traps) are not one:
        # their "animal 1" jumps between cameras across the country.
        counts_only = all(str(x).isdigit() and int(x) <= 20 for x in named)
        if rows and len(named) >= 0.8 * len(rows) and len(set(named)) <= len(rows) / 3 and not counts_only:
            out.append((c['name'], c['count']))
    return out


def study_rows(f, key, dataset, total):
    rows, offset = [], 0
    while offset < total and offset < MAX_ROWS:
        page = f.gbif('occurrence/search', {**CLEAN, 'taxonKey': key, 'datasetKey': dataset, 'basisOfRecord': 'MACHINE_OBSERVATION',
                                            'limit': 300, 'offset': offset}) or {}
        res = page.get('results', [])
        rows += [{'datasetKey': dataset, 'organismID': x.get('organismID'), 'eventDate': x.get('eventDate'),
                  'decimalLongitude': x.get('decimalLongitude'), 'decimalLatitude': x.get('decimalLatitude')} for x in res]
        if len(res) < 300 or page.get('endOfRecords'):
            break
        offset += 300
    return rows


def dataset_meta(f, key):
    d = f.gbif(f'dataset/{key}') or {}
    lic = d.get('license') or ''
    name = 'CC0' if 'publicdomain' in lic else 'CC BY-NC' if '-nc' in lic else 'CC BY' if 'licenses/by' in lic else 'see GBIF'
    return {'key': key, 'title': (d.get('title') or key)[:160], 'licence': name, 'url': f'https://www.gbif.org/dataset/{key}'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--cache', required=True)
    a = ap.parse_args()
    f = Fetcher(a.cache)
    os.makedirs(a.out, exist_ok=True)
    rows_in = json.load(open(a.data, encoding='utf-8'))['rows']
    index = {}
    for i, sp in enumerate(rows_in):
        key = sp['key']
        studies = tag_studies(f, key)
        if studies:
            cap = CAP.get(GROUP_BY_CLASS.get(sp.get('classKey'), 'default'), CAP['default'])
            rows, used = [], []
            for ds, n in studies:
                if len(rows) + n > MAX_ROWS:
                    continue  # whole studies only
                rows += study_rows(f, key, ds, n)
                used.append(ds)
            every = build_tracks(rows, cap)
            land_mammal = sp.get('classKey') == 359 and sp.get('order') not in MARINE_MAMMALS and sp.get('family') not in MARINE_MAMMAL_FAMILIES
            if land_mammal:
                every = [t for t in every if t['km'] / max(1, (t['end'] - t['start']) / DAY) <= LAND_MAMMAL_MEAN_KM_PER_DAY]
            every = [t for t in every if t['km'] >= 1]  # tags that never left their spot draw nothing
            tracks = every[:MAX_TRACKS]
            if tracks:
                metas = {d: dataset_meta(f, d) for d in {t['dataset'] for t in tracks}}
                ds_list = list(metas)
                out = {'key': key, 'cap': cap, 'studies': [metas[d] for d in ds_list], 'animals': len(every),
                       'tracks': [{'s': ds_list.index(t['dataset']), 'a': t['animal'], 'km': t['km'], 'd': t['dropped'],
                                   't0': int(t['start']), 't1': int(t['end']),
                                   # [lon, lat, hours since the first fix], 3 decimals ~ 100 m
                                   'p': [[[round(x, 3), round(y, 3), round((tt - t['start']) / 3600)] for tt, x, y in thin(seg, MAX_POINTS)]
                                         for seg in t['segs']]} for t in tracks]}
                tmp = os.path.join(a.out, f'{key}.json.tmp')
                with open(tmp, 'w') as fh:
                    json.dump(out, fh, separators=(',', ':'))
                os.replace(tmp, os.path.join(a.out, f'{key}.json'))
                index[key] = len(tracks)
        if (i + 1) % 100 == 0:
            print(f'{i + 1}/{len(rows_in)} species, {len(index)} with tracks', flush=True)
    with open(os.path.join(a.out, 'index.json'), 'w') as fh:
        json.dump(index, fh, separators=(',', ':'))
    print(f'done: {len(index)} species with tracks -> {a.out}', flush=True)


if __name__ == '__main__':
    sys.exit(main())
