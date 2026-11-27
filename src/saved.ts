// Animals the reader saved, kept in their own browser only (localStorage); nothing leaves the page.
export interface SavedSpecies { id: number; name: string; sci: string }
const KEY = 'saved';

export function savedList(): SavedSpecies[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => Number.isInteger(x?.id) && typeof x.name === 'string').slice(0, 500) : [];
  } catch { return []; }
}
export const isSaved = (id: number) => savedList().some((x) => x.id === id);
function write(list: SavedSpecies[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full or blocked */ }
  window.dispatchEvent(new CustomEvent('saved-change'));
}
/** Save or unsave; true when it is saved afterwards. */
export function toggleSaved(s: SavedSpecies): boolean {
  const list = savedList();
  const i = list.findIndex((x) => x.id === s.id);
  if (i >= 0) { list.splice(i, 1); write(list); return false; }
  write([s, ...list]);
  return true;
}
export function removeSaved(id: number) { write(savedList().filter((x) => x.id !== id)); }
