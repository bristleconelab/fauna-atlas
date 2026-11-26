// Put the current page counts into the README ("2,999 animals and 250 countries and territories"), from
// data/pages/*.json through the same model the pages are built with. Run after a data refresh: node scripts/readme_counts.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { model } from '../pages/build.ts';

const rows = (f: string) => JSON.parse(readFileSync(f, 'utf8')).rows;
const m = model(rows('data/pages/species.json'), rows('data/pages/places.json'));
const fmt = (n: number) => n.toLocaleString('en-US');
const readme = readFileSync('README.md', 'utf8');
const next = readme.replace(/[\d,]+ animals and [\d,]+ countries and territories/, `${fmt(m.species.length)} animals and ${fmt(m.places.length)} countries and territories`);
if (next === readme && !readme.includes(`${fmt(m.species.length)} animals and ${fmt(m.places.length)} countries and territories`)) {
  console.error('README: no "<n> animals and <n> countries and territories" phrase to update');
  process.exit(1);
}
writeFileSync('README.md', next);
console.log(`README: ${fmt(m.species.length)} animals, ${fmt(m.places.length)} countries and territories`);
