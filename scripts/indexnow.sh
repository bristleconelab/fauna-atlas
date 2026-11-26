#!/usr/bin/env bash
# Tell IndexNow search engines (Bing, Yandex, Seznam, Naver, Yep) that sitemap URLs changed.
# The key file is public/9e54b9bbd0582b2413b4f6d48cc4a911.txt (served at the site root).
#
# usage:
#   scripts/indexnow.sh                     every URL of the live sitemap (by hand, after a deploy that changed pages)
#   scripts/indexnow.sh --since YYYY-MM-DD  only URLs of the local dist/sitemap.xml whose <lastmod> is on or after the
#                                           date (the deploy workflow passes today's date after a Cloudflare deploy);
#                                           nothing to send -> exit 0
# DRY_RUN=1 prints the URL list instead of sending it.
# dist/sitemap.xml (after npm run build) lists the home page, the index pages and every species and country page.
set -euo pipefail
KEY=9e54b9bbd0582b2413b4f6d48cc4a911
HOST=fauna.bristleconelab.org
cd "$(dirname "$0")/.."

if [ "${1:-}" = "--since" ]; then
  SINCE=${2:?--since needs a date YYYY-MM-DD}
  [[ "$SINCE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "bad date: $SINCE" >&2; exit 2; }
  URLS=$(python3 -I - "$SINCE" dist/sitemap.xml <<'PY'
import json, re, sys
since, path = sys.argv[1], sys.argv[2]
xml = open(path, encoding="utf-8").read()
pairs = re.findall(r"<loc>([^<]+)</loc>\s*<lastmod>([^<]+)</lastmod>", xml)
print(json.dumps([loc for loc, mod in pairs if mod[:10] >= since]))
PY
)
  if [ "$URLS" = "[]" ]; then echo "IndexNow: no sitemap URL with lastmod >= $SINCE; nothing sent"; exit 0; fi
else
  URLS=$(curl -s "https://$HOST/sitemap.xml" | grep -o '<loc>[^<]*' | sed 's/<loc>//' | python3 -c 'import json,sys;print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')
  [ "$URLS" != "[]" ] || { echo "sitemap not live yet"; exit 1; }
fi

# the list goes through a file, not the command line: 3,000+ URLs exceed Linux's argument limit
BODY=$(mktemp)
trap 'rm -f "$BODY"' EXIT
printf '%s' "$URLS" | python3 -I -c 'import json,sys; u=json.load(sys.stdin); json.dump({"host":sys.argv[1],"key":sys.argv[2],"keyLocation":f"https://{sys.argv[1]}/{sys.argv[2]}.txt","urlList":u}, open(sys.argv[3],"w")); print(f"IndexNow: {len(u)} URL(s)")' "$HOST" "$KEY" "$BODY"
if [ -n "${DRY_RUN:-}" ]; then cat "$BODY"; exit 0; fi   # DRY_RUN=1: print the request, send nothing
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H 'Content-Type: application/json; charset=utf-8' \
  --data-binary @"$BODY" https://api.indexnow.org/indexnow)
echo "IndexNow HTTP $CODE"
# 200 OK, 202 Accepted (key validation pending); anything else is a failure
[ "$CODE" = 200 ] || [ "$CODE" = 202 ]
