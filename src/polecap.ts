// Pole caps for the Blue Marble on the globe. Web Mercator tiles end at 85.05°; MapLibre's globe stretches the top
// (bottom) pixel row of the edge tiles to the pole, and the varied colours of that row drew a pinwheel there. Edge
// tiles pass through this protocol, which fades their last rows into one colour per pole, so each cap is plain.
import * as maplibregl from 'maplibre-gl';

/** Mean colour of the Blue Marble's 85° rows (measured 2026-11-26 on the zoom-2 edge tiles): Arctic sea, Antarctic ice. */
export const CAP = { north: [13, 36, 77], south: [233, 234, 234] } as const;
const PREFIX = 'polecap://';
/** Rows faded into the cap colour at zoom 0, out of 256: about 1.5° of latitude next to 85° (Mercator has ~8 rows a
 *  degree there at zoom 0, twice as many each zoom up), so the fade is scaled by 2^z to keep the same width. */
const FADE = 12;
export const fadeRows = (z: number, height = 256) => Math.min(height, Math.round((FADE * 2 ** z * height) / 256));

/** Weight of the cap colour for pixel row `row` of a tile `size` rows high, at the `edge` the pole is on. Pure. */
export function capWeight(row: number, size: number, edge: 'top' | 'bottom', fade = FADE): number {
  const d = edge === 'top' ? row : size - 1 - row;
  return d >= fade ? 0 : 1 - d / fade;
}

/** Tile URL template routed through the protocol ({z}/{y}/{x} stay for MapLibre to fill in). */
export const capped = (template: string) => PREFIX + template;

export function registerPoleCaps() {
  maplibregl.addProtocol('polecap', async (params, abort) => {
    const url = params.url.slice(PREFIX.length);
    const res = await fetch(url, { signal: abort.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const m = /\/(\d+)\/(\d+)\/(\d+)\.(?:jpe?g|png)$/.exec(url); // .../{z}/{y}/{x}.jpeg
    const z = Number(m?.[1]), y = Number(m?.[2]);
    const edge = !m ? null : y === 0 ? 'top' : y === 2 ** z - 1 ? 'bottom' : null;
    if (!edge) return { data: await res.arrayBuffer() };
    const bmp = await createImageBitmap(await res.blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d')!;
    g.drawImage(bmp, 0, 0);
    const fade = fadeRows(z, bmp.height);
    const rows = edge === 'top' ? [0, fade] : [bmp.height - fade, bmp.height];
    const img = g.getImageData(0, rows[0], bmp.width, rows[1] - rows[0]);
    const cap = edge === 'top' ? CAP.north : CAP.south;
    for (let r = 0; r < rows[1] - rows[0]; r++) {
      const w = capWeight(rows[0] + r, bmp.height, edge, fade);
      for (let i = r * bmp.width * 4, e = i + bmp.width * 4; i < e; i += 4) {
        for (let k = 0; k < 3; k++) img.data[i + k] = Math.round(img.data[i + k] * (1 - w) + cap[k] * w);
      }
    }
    g.putImageData(img, 0, rows[0]);
    return { data: await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer() };
  });
}
