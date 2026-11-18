import Type from 'typebox';
import { contractString, strictObject, type Infer } from './validation.ts';

/** A website page without its locale; squad and invite IDs are folded to `*` before they leave the site. */
export const SITE_PATH = /^\/[a-z0-9\-/*]{0,95}$/;
/** The referring site's hostname only; never a full URL. */
export const SITE_SOURCE = /^[a-z0-9.-]{1,100}$/;
/** Each kind keeps at most this many distinct values per day; the rest fold into `SITE_OTHER`. */
export const SITE_VALUES_PER_DAY = 200;
export const SITE_OTHER = '*';

/** One page view from the website. `source` is sent only on the page a visit enters through. */
export const siteVisit = strictObject({
  path: contractString({ min: 1, max: 96, pattern: SITE_PATH }),
  source: Type.Optional(contractString({ min: 1, max: 100, pattern: SITE_SOURCE })),
  // Hashed together with the address into a daily visitor key, then discarded.
  agent: Type.Optional(contractString({ max: 300 })),
});
export type SiteVisit = Infer<typeof siteVisit>;
