# Fauna Atlas

**Click anywhere on Earth, see which animals live there, and where nobody has looked yet.** An open, plain-language
atlas of animal life on a 3D globe: land, rivers and lakes, sea and air.

**Live: https://fauna.bristleconelab.org**

- Click any spot (or *Near me*): the panel lists the animals recorded within that 1.4° square (about 150 km across),
  with photos, everyday names and a filter by kind: mammals, birds, reptiles, frogs and salamanders, fish, sharks and
  rays, insects, spiders, crabs and woodlice, snails and squid, corals and jellyfish, starfish, worms. The mixed view
  leads with familiar animals that have a photo; insects and spiders take a turn less often, so they do not fill the
  first screen.
- **How well is this ground known?** Each square gets a Chao1 inventory-completeness estimate (Serengeti: 1,934
  species recorded, about 72 % of the ~2,670 that more looking would probably find) and the years of its first and last
  animal record.
- One search box for animals (an everyday name in any language Wikidata knows, or a scientific name) and places
  (countries, cities, parks, lakes, mountains, seas: "Tashkent", "Serengeti", "Toshkent").
- A species page shows where it has been recorded (GBIF hexagons), a photo, a Wikipedia summary in the reader's
  language, the Red List status, **from the deep sea to the mountains** (where along one vertical scale, from 11 km
  below the sea to 9 km above it, its records lie: the Alpine ibex mostly at 2,000–3,000 m), size, lifespan and a
  sound recording where Wikidata has them, records by month north and south of the equator, records by decade, and for
  the 109 sea animals in MiCO, their migration network.
- **Then and now** (records before 1990 and since 2010 on one map) and **side by side** (two species: records, height
  or depth, Red List, ranges in two colours).
- **Where people have looked**: GBIF record density of all animals, or green where someone recorded an animal in the
  last ten years and grey where only older records exist.
- A seven-stop tour, CSV download of any square's list, a ready citation, English and Uzbek interface.

Every place and species has its own link: [`#at=-2.33,34.83`](https://fauna.bristleconelab.org/#at=-2.33,34.83) (the
Serengeti), [`#sp=2441055`](https://fauna.bristleconelab.org/#sp=2441055) (Alpine ibex, GBIF key),
[`#sp=2435350&vs=5219404`](https://fauna.bristleconelab.org/#sp=2435350&vs=5219404) (elephant and lion).

## Why, and what already exists

GBIF holds about 2.8 billion animal records with a clean position (2026-11-26). The tools built on it answer
specialists: GBIF.org itself (maps and filters by taxon), iNaturalist Explore (recent observations with photos), Map of
Life (expert range maps and species lists per place). This atlas is a plain-language front door to the same open data,
with what those tools do not put up front: how complete a place's list probably is, how long ago anyone last looked,
where on the vertical a species lives, and the same view for any animal, from beetles to whales. It is the land and
air companion of [Ocean Life Atlas](https://oceanlife.bristleconelab.org), which goes deeper into the sea with OBIS
depth, temperature and tag tracks.

## How it works

The site is static: no server, everything is fetched live by the browser from open services that allow it.

| Question | Source |
|---|---|
| Which animals were recorded in this square | GBIF `occurrence/search` with `facet=speciesKey`, one request per kind of animal (class or phylum keys of the GBIF backbone), so the kind comes with the answer; animals only, clean coordinates, `occurrenceStatus=PRESENT` |
| Where a species has been recorded, where people looked | GBIF map API density tiles (hexagons); `year=` for then and now and for the last ten years |
| Height and depth | nine GBIF counts per species (`elevation` and `depth` ranges); the text gives the middle half of the records; depth starts at 0.5 m because many land datasets fill `depth = 0` |
| Months and decades | GBIF `month` facets north and south of the equator, `year` facet |
| Search | GBIF `species/search` and `species/suggest` (backbone, animals), Wikidata `wbsearchentities` mapped to GBIF keys through P846, Photon (OpenStreetMap) for places; ranked by exact name, then by GBIF record count (one facet request) |
| Name of a clicked point | Nominatim reverse geocoding (one request per click), Marine Regions at sea |
| Photos, names in the reader's language, Wikipedia, size, lifespan, sound | Wikidata through [QLever](https://qlever.dev) by GBIF id (P846), then by synonym keys, then by scientific name, following old names to the accepted taxon (P12765); else an openly licensed (CC0, CC BY, CC BY-SA) iNaturalist photo from GBIF |
| Red List | GBIF `species/{key}/iucnRedListCategory` |
| Sea migrations | MiCO (stored in `public/data/mico/`, matched by scientific name) |
| Inventory completeness | bias-corrected Chao1 from records per species (only when no kind of animal hits the 3,000-species facet limit, because the missing tail is the rare species Chao1 needs) |

GBIF throttles bursts (HTTP 429), so the site keeps at most four GBIF requests in flight and retries with longer pauses.

## Honest limits

- A species list is a record of what was found, not a census, and the effort behind it is wildly uneven: birds are
  recorded millions of times a year, most insects never. Record counts show where people looked and what they looked
  for.
- Squares are 1.4° on a side. GBIF coarsens the positions of species at risk from collectors and poachers; they appear
  as published.
- Heights are often the ground under a flying bird, and many records give no height at all; the vertical profile says
  how many records it rests on.
- "Then and now" mostly shows how recording changed (phone apps since about 2010), not only how animals moved.
- Interface text is in English and Uzbek; names and Wikipedia follow the chosen language where Wikidata has them.

## Data licences

| Data | Licence |
|---|---|
| GBIF records | per dataset: CC0, CC BY 4.0 or CC BY-NC 4.0; cite GBIF.org (date) GBIF Occurrence Search, https://www.gbif.org |
| GBIF Backbone Taxonomy | CC BY 4.0 |
| Wikidata | CC0 |
| Photos and sounds | each file's own licence (Wikimedia Commons, iNaturalist CC0/CC BY/CC BY-SA only), shown with it |
| Wikipedia summaries | CC BY-SA 4.0 |
| Places | © OpenStreetMap contributors, ODbL (Photon, Nominatim, OpenFreeMap); Marine Regions CC BY 4.0 |
| Imagery | NASA Blue Marble (public domain); Sentinel-2 cloudless 2016 by EOX, CC BY 4.0 |
| MiCO | CC0 1.0; Bentley et al. (2025) Nature Communications, https://doi.org/10.1038/s41467-025-59271-7 |

Code: MIT (see `LICENSE`).

## Development

```sh
npm install
npm run dev        # http://localhost:5173/ (scripts/screenshots.mjs expects port 5299)
npm test           # unit tests (groups, vertical profile, search merge, seasons, Chao1, traits, geohash, names)
npm run build      # typecheck + production build in dist/
npm run mico       # rebuild public/data/mico/ from the MiCO Zenodo archive
```

Pushes to `main` run the tests, build the site and publish it to Cloudflare Pages (project `fauna-atlas`), using the
`bristleconelab` organisation secret `CLOUDFLARE_API_TOKEN`.

## Related

[Ocean Life Atlas](https://oceanlife.bristleconelab.org), [Seafloor Atlas](https://seaflooratlas.org)
