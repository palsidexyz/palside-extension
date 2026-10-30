const repository = 'https://github.com/palsidexyz/palside-extension';

/** Public project links only. Service origins, extension trust and contract addresses have separate configuration. */
export const PUBLIC_LINKS = {
  website: 'https://palside.xyz',
  repository,
  issues: `${repository}/issues`,
  x: 'https://x.com/palside_xyz',
  contactEmail: 'palside@pm.me',
  // Replace the reserved placeholder and enable availability only after the listing is published.
  chromeStore: 'https://example.invalid/palside/chrome',
  chromeStoreAvailable: false,
} as const;
