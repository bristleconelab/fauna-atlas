#!/usr/bin/env python3
"""Photos of the animals with pages, served from the site itself: public/data/photos/<gbif key>.webp, 320 px wide.

Wikimedia's thumbnails took ~1.3 s each from Central Asia (measured 2026-11-26), after a ~3 s Wikidata lookup; a
file on the site's own CDN arrives in ~0.2 s with no lookup. Source: the photo each page already credits
(data/pages/species.json: the Commons thumbnail or the iNaturalist photo, open licences only); the credit and
licence travel with it in known.json, which pages/build.ts writes. Existing files are kept, so a rerun only fetches
new species. Needs Pillow: uv run --with pillow python -I scripts/fetch_photos.py

usage: python3 -I scripts/fetch_photos.py [--data data/pages/species.json] [--out public/data/photos]
"""
import argparse
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request

from PIL import Image

UA = 'fauna-atlas-photos/1.0 (+https://github.com/bristleconelab/fauna-atlas)'
WIDTH = 320
QUALITY = 70


def fetch(url):
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(min(60, 3 * (attempt + 1)))
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            time.sleep(min(60, 3 * (attempt + 1)))
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default='data/pages/species.json')
    ap.add_argument('--out', default='public/data/photos')
    a = ap.parse_args()
    rows = json.load(open(a.data, encoding='utf-8'))['rows']
    os.makedirs(a.out, exist_ok=True)
    made = kept = missing = 0
    for i, r in enumerate(rows):
        path = os.path.join(a.out, f"{r['key']}.webp")
        if os.path.exists(path):
            kept += 1
            continue
        url = (r.get('photo') or {}).get('thumb')
        body = fetch(url) if url else None
        if not body:
            missing += 1
            continue
        try:
            im = Image.open(io.BytesIO(body)).convert('RGB')
        except Exception:
            missing += 1
            continue
        if im.width > WIDTH:
            im = im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)
        tmp = path + '.tmp'
        im.save(tmp, 'WEBP', quality=QUALITY, method=6)
        os.replace(tmp, path)
        made += 1
        time.sleep(0.2)  # polite to upload.wikimedia.org
        if (i + 1) % 250 == 0:
            print(f'{i + 1}/{len(rows)}: {made} new, {kept} kept, {missing} without a photo', flush=True)
    print(f'done: {made} new, {kept} kept, {missing} without a photo -> {a.out}', flush=True)


if __name__ == '__main__':
    sys.exit(main())
