// Names of kinds of animal and Red List categories in the reader's language. Separate from taxa.ts, which stays
// free of the interface language so the static-page build can use it in Node.
import { t } from './i18n';
import { GROUPS, IUCN_EN, type GroupId } from './taxa';

export const GROUP_LABEL = Object.fromEntries(GROUPS.map((g) => [g.id, t(g.label)])) as Record<GroupId, string>;
export const IUCN_LABEL: Record<string, string> = Object.fromEntries(Object.entries(IUCN_EN).map(([k, v]) => [k, t(v)]));
