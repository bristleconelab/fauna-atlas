// URL hash <-> view state, so every place and species has a link. Pure (test/state.test.ts).
// #at=22.52,69.61            a place (the life-here panel for that point)
// #sp=105847                 a species (WoRMS AphiaID)
// #at=..&sp=..               a species opened from a place (Back returns to the place)
// #sp=..&vs=..               two species side by side
// #tour=2                    a step of a guided tour
// #at=..&area=s4             the area around the point: s2/s4 = a larger/smaller square (s3, the default, is left out),
//                            g:KEN.30_1 = a GADM region, p:x,y;x,y;… = a drawn shape (one or more rings joined by |)

export type AreaRef =
  | { kind: 'square'; precision: 2 | 3 | 4 }
  | { kind: 'gadm'; id: string }
  | { kind: 'shape'; rings: [number, number][][] };
export interface ViewState { at?: { lat: number; lon: number }; area?: AreaRef; sp?: number; vs?: number; looked?: boolean | 'age'; tour?: number }

export function formatArea(a: AreaRef): string | null {
  if (a.kind === 'square') return a.precision === 3 ? null : `s${a.precision}`;
  if (a.kind === 'gadm') return `g:${a.id}`;
  return `p:${a.rings.map((r) => r.map(([x, y]) => `${+x.toFixed(3)},${+y.toFixed(3)}`).join(';')).join('|')}`;
}
export function parseArea(v: string | null): AreaRef | undefined {
  if (!v) return undefined;
  if (v === 's2' || v === 's4') return { kind: 'square', precision: v === 's2' ? 2 : 4 };
  if (/^g:[A-Z]{3}(\.\d+)*(_\d+)?$/.test(v)) return { kind: 'gadm', id: v.slice(2) };
  if (v.startsWith('p:')) {
    const rings = v.slice(2).split('|').map((r) => r.split(';').map((p) => p.split(',').map(Number) as [number, number]))
      .filter((r) => r.length >= 3 && r.length <= 400 && r.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 360 && Math.abs(y) <= 90));
    return rings.length ? { kind: 'shape', rings: rings.slice(0, 8) } : undefined;
  }
  return undefined;
}

export function parseHash(hash: string): ViewState {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const s: ViewState = {};
  const at = p.get('at');
  if (at) {
    const [lat, lon] = at.split(',').map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) s.at = { lat, lon };
  }
  if (s.at) { const area = parseArea(p.get('area')); if (area) s.area = area; }
  const sp = Number(p.get('sp'));
  if (Number.isInteger(sp) && sp > 0) s.sp = sp;
  const vs = Number(p.get('vs'));
  if (s.sp && Number.isInteger(vs) && vs > 0 && vs !== s.sp) s.vs = vs;
  if (p.get('layer') === 'looked') s.looked = true;
  if (p.get('layer') === 'age') s.looked = 'age';
  const tour = Number(p.get('tour'));
  if (Number.isInteger(tour) && tour >= 1 && tour <= 20) s.tour = tour;
  return s;
}

export function formatHash(s: ViewState): string {
  const parts: string[] = [];
  if (s.at) parts.push(`at=${s.at.lat.toFixed(2)},${s.at.lon.toFixed(2)}`);
  const area = s.at && s.area ? formatArea(s.area) : null;
  if (area) parts.push(`area=${encodeURIComponent(area).replace(/%2C/g, ',').replace(/%3B/g, ';').replace(/%3A/g, ':').replace(/%7C/g, '|')}`);
  if (s.sp) parts.push(`sp=${s.sp}`);
  if (s.sp && s.vs) parts.push(`vs=${s.vs}`);
  if (s.looked) parts.push(`layer=${s.looked === 'age' ? 'age' : 'looked'}`);
  if (s.tour) parts.push(`tour=${s.tour}`);
  return parts.length ? `#${parts.join('&')}` : '';
}
