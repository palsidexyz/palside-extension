import { DAY_MS, HOUR_MS, MINUTE_MS } from '../units.ts';
/** Addresses per request; caps one directory lookup; docs/product/navigation.md#代币目录. */
export const TOKEN_RESOLVE_LIMIT = 20;
/** Code points; caps directory names and symbols; docs/product/navigation.md#代币目录. */
export const TOKEN_NAME_MAX = 40;
/** Results; caps directory search; docs/product/navigation.md#代币目录. */
export const TOKEN_SEARCH_LIMIT = 20;
/** Uncached addresses per account each hour; limits chain reads; docs/product/navigation.md#代币目录. */
export const TOKEN_LOOKUP_HOURLY = 300;
/** Milliseconds; rechecks an address read as not a token; docs/product/navigation.md#代币目录. */
export const TOKEN_MISSING_RECHECK_MS = 10 * MINUTE_MS;
/** Milliseconds without lookups before a directory entry is deleted; docs/product/navigation.md#代币目录. */
export const TOKEN_RETENTION_MS = 90 * DAY_MS;
/** Pixels; logo edge after server resizing; docs/product/navigation.md#代币目录. */
export const TOKEN_LOGO_PIXELS = 128;
/** Bytes; caps a downloaded logo source or metadata file; docs/product/navigation.md#代币目录. */
export const TOKEN_LOGO_SOURCE_BYTES = 2 * 1024 * 1024;
/** Milliseconds after each failed logo download before the next attempt; docs/product/navigation.md#代币目录. */
export const TOKEN_LOGO_RETRY_MS = [HOUR_MS, 6 * HOUR_MS, 24 * HOUR_MS] as const;
