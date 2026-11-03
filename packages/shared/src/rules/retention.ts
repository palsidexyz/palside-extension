/** Days selectable by squad owners; limits finite message retention; docs/product/privacy.md#期限与清理. */
export const TEAM_RETENTION_DAYS = [1, 7, 30] as const;
/** Null means permanent; defaults squad message retention; docs/product/privacy.md#期限与清理. */
export const TEAM_RETENTION_DEFAULT = null;
/** Days; caps chat images, left squads and send recovery; docs/product/privacy.md#期限与清理. */
export const TEAM_RETENTION_CAP_DAYS = 30;
