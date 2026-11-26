// Simple silhouettes for each kind of animal, shown when a species has no photo. Drawn for this atlas (64 x 64 viewBox,
// filled shapes; insects and spiders also stroked for their legs) so a photo-less tile still says "this is a bird".
import type { GroupId } from './taxa';

const P: Record<GroupId, string> = {
  mammals: 'M9 31c1-4 5-7 10-7h21c3 0 5-2 7-5l2.6-5.2c.4-.8 1.6-.7 1.8.2l.8 3.6 3.3-1.4c.9-.4 1.7.6 1.2 1.4l-3.4 5.4c1.2 3.2-.1 6.4-3.3 7.8V51c0 1-.8 1.8-1.8 1.8h-1.6c-1 0-1.8-.8-1.8-1.8V41H24v10c0 1-.8 1.8-1.8 1.8h-1.6c-1 0-1.8-.8-1.8-1.8V39c-3-1.5-5-4.2-5.2-7.4l-3.2 2.2c-.8.5-1.8-.3-1.4-1.2z',
  birds: 'M4 30c6-1.5 12 0 17 4 3-8 11-14 22-15 4-.4 8 .2 11 1.5.8.3.7 1.4-.1 1.6-9 2.5-15 8-17 15 4 0 8 1 11 3 .7.4.5 1.5-.3 1.6-6 .5-12 .8-17 0-3-.4-6-1.6-8.5-3.4C17 34.6 11 32 4.4 31.3 3.6 31.2 3.3 30.2 4 30z',
  reptiles: 'M6 34.5c4-1.6 9-2 14-1.2l5.6-5.8c.6-.6 1.7-.2 1.7.7V31h9.4v-2.8c0-.9 1.1-1.3 1.7-.7l5.6 5.8c3.8.3 7 1.6 9 3.6l5.2.9c.9.2.9 1.5 0 1.7l-5.2.9c-2 2-5.2 3.3-9 3.6l-5.6 5.8c-.6.6-1.7.2-1.7-.7V47h-9.4v2.8c0 .9-1.1 1.3-1.7.7l-5.6-5.8c-5 .8-10 .4-14-1.2-1.6-.7-1.6-8.3 0-9z',
  amphibians: 'M32 17c8.3 0 14.5 5.2 14.5 12 0 2.8-1 5.2-2.8 7.2l7 6.2c.8.7.3 2-.8 1.9l-9.4-.8C38.2 44.9 35.2 46 32 46s-6.2-1.1-8.5-2.5l-9.4.8c-1.1.1-1.6-1.2-.8-1.9l7-6.2c-1.8-2-2.8-4.4-2.8-7.2C17.5 22.2 23.7 17 32 17zm-7.5 4a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4zm15 0a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4z',
  fish: 'M6 32c7-9 17-13 28-12 6 .5 11 3 15 6l9-7c1 0 1 1 1 1l-3 12 3 12s0 1-1 1l-9-7c-4 3-9 5.5-15 6-11 1-21-3-28-12zm13-2.5a2 2 0 1 0 .1 0z',
  sharks: 'M3 35c6-4 14-6 23-6.5l7-12c.6-1 2-.6 2 .5l-.6 11.5c5 .3 10 1.2 14 2.6l9-8c.7-.6 1.8 0 1.5.9l-3.4 9.5 3.4 9.5c.3.9-.8 1.5-1.5.9l-9-8c-6 2.2-14 3.2-22 3l-3 6.5c-.4.9-1.7.7-1.8-.3l-.4-6.6C14 39.6 8 38 3 35z',
  insects: 'M32 13c2.8 0 5 2 5 4.5h-10c0-2.5 2.2-4.5 5-4.5zm-8.6 7h17.2c3.2 3.2 5.4 8 5.4 13.8C46 42.7 39.7 50 32 50s-14-7.3-14-16.2c0-5.8 2.2-10.6 5.4-13.8zM18 26l-8-4m8 10H8m10 6l-8 5m36-17l8-4m-8 10h10m-10 6l8 5',
  spiders: 'M32 27a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zm0-9a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM26 30l-13-9-4 6m17 6H9l-3 5m20-2l-12 9-2 7m24-22l13-9 4 6m-17 6h17l3 5m-20-2l12 9 2 7',
  crustaceans: 'M32 26c8 0 14 4 14 10s-6 10-14 10-14-4-14-10 6-10 14-10zM14 14c4 1 7 4 7 8l-2 3c-3-1-6-3-7-6l-3 1c-.9.3-1.5-.8-.8-1.4zm36 0l5.8 4.6c.7.6.1 1.7-.8 1.4l-3-1c-1 3-4 5-7 6l-2-3c0-4 3-7 7-8zM18 38l-8 4m8 0l-7 7m35-11l8 4m-8 0l7 7M23 26l-3-5m21 5l3-5',
  molluscs: 'M34 10c12 1 21 11 20 23-1 11-10 19-21 19H12c-1.7 0-2.6-2-1.4-3.2l3.6-3.6C11 41 9 36.5 9.5 31.5 10.5 19 21 9 34 10zm-1 9c-7 0-12 5-12 11.5S26 42 32 42c5.5 0 9.5-4 9.5-9 0-4.5-3.5-8-8-8-3.8 0-6.5 2.8-6.5 6.2 0 2.8 2.2 4.8 4.8 4.8 2.2 0 3.7-1.6 3.7-3.5',
  corals: 'M30 58V40c-6-1-10-5-11-11l-5-3c-.8-.5-.5-1.7.4-1.8l3.6-.4-1-7c-.1-.9 1-1.4 1.6-.7L23 21c1 4 3.5 7 7 8V16l-3-5c-.4-.8.5-1.6 1.2-1.1L32 13l3.8-3.1c.7-.5 1.6.3 1.2 1.1l-3 5v18c4-1 7-4 8-8l1-8c.1-.9 1.3-1.1 1.6-.2l1.6 4.3 3.4-2c.8-.4 1.6.5 1.1 1.2L48 26c-1 7-6 12-14 13.5V58z',
  echinoderms: 'M32 5l6.5 17.5L57 23l-14.5 11.5L48 53 32 42.5 16 53l5.5-18.5L7 23l18.5-.5z',
  worms: 'M7 41c4.4-8.8 11-11 17.5-6.6s10.6 4.4 15-2.2 11-8.8 17.5-4.4c1.1.8.9 2.4-.3 2.7-4.4.8-6.6 3.3-8.8 6.6-5.5 7.7-13.2 8.8-19.8 4.4s-9.9-3.3-14.3 3.3c-.7 1.1-2.2 1.2-2.9.2-.4-1-.8-2.9-.1-4z',
  other: 'M22 56c-4-8-6-18-6-28 0-6 1-11 3-15 .5-1 2-1 2.3.1C23 17 26 19 32 19s9-2 10.7-5.9c.4-1.1 1.8-1.1 2.3-.1 2 4 3 9 3 15 0 10-2 20-6 28-.4.8-1.2 1.3-2 1.3H24c-.8 0-1.6-.5-2-1.3zm10-30a2.2 2.2 0 1 0 .1 0zm-6 9a2 2 0 1 0 .1 0zm12 2a2 2 0 1 0 .1 0zm-6 9a2 2 0 1 0 .1 0z',
};

/** Shapes that are lines (legs): drawn with a stroke as well as a fill. */
const STROKED = new Set<GroupId>(['crustaceans', 'insects', 'spiders']);
const EVENODD = new Set<GroupId>(['amphibians', 'molluscs', 'other']);

export function silhouette(group: GroupId, d = P[group]): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('silhouette');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  if (EVENODD.has(group)) path.setAttribute('fill-rule', 'evenodd');
  if (STROKED.has(group)) { path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '3'); path.setAttribute('stroke-linecap', 'round'); }
  svg.append(path);
  return svg;
}
