/**
 * The Chrome Web Store assigns the published ID and rejects a manifest `key`, so store builds carry none.
 * Local and unpacked builds set this public key, copied from the store item's package page, to share that ID.
 */
export const EXTENSION_PUBLIC_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA22Ckjl8RPEWqMd5fMHSOppo6AtbaVb8vcKH5LldpNMuudQsp8oXD5zKRRUWtEm0XVOgBUudXv9PCG5eKO5IpSEBW6gV/00qdNIpG53VbRRaAfD24TKC4NmtSvBMS+5pZwLN57GyepB1kcfDR3JWCdS92if9J5P68dIcIL9NP5kTHAykfHElUAUbtPGIkiXXg4tPWpnxHYZsdpJb/LSM9m6xAa6Ox3ot0XvZsXxwjIDvcUyyocFykuGlki0Y9zhkVCtcfQeRaz08L5y+Fb18OX41UbaIQl//en45spbHHJGH+/SQvplAcODJpMHd5myccgnM9KOWU7zD7Phchqb5SywIDAQAB';
export const EXTENSION_ID = 'jbkkcbbgodaciapahochndmkbapolocj';
export const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;

/** Store builds talk only to these public origins; both are fixed at build time. */
export const RELEASE_WEBSITE_ORIGIN = 'https://palside.xyz';
export const RELEASE_API_ORIGIN = 'https://api.palside.xyz';
