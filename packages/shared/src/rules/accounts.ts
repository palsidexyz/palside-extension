import { DAY_MS, MINUTE_MS, SECOND_MS } from '../units.ts';
/** Milliseconds of account age; gates recruitment, reporting and danmaku pacing; docs/product/accounts.md#本机密码与设备. */
export const NEW_ACCOUNT_MS = DAY_MS;
/** Milliseconds between new-account sends; paces danmaku; docs/product/accounts.md#本机密码与设备. */
export const NEW_ACCOUNT_ROOM_SLOW_MS = 15_000;
/** Devices per account; caps active logins; docs/product/accounts.md#本机密码与设备. */
export const ACCOUNT_DEVICE_LIMIT = 10;
/** Registrations per rolling hour; triggers harder signup proof; docs/product/accounts.md#本机密码与设备. */
export const SIGNUP_SURGE_PER_HOUR = 300;
/** Proof bits; increases signup difficulty during surges or manual harder mode; docs/product/accounts.md#本机密码与设备. */
export const SIGNUP_SURGE_BITS = 2;
/** Hours; sizes the operator signup chart; docs/product/accounts.md#本机密码与设备. */
export const SIGNUP_CURVE_HOURS = 48;
/** Graphemes; caps account nicknames; docs/product/accounts.md#本机密码与设备. */
export const NICKNAME_LENGTH = 24;
/** Graphemes; caps account biographies; docs/product/accounts.md#本机密码与设备. */
export const BIO_LENGTH = 40;
/** Tags per account; caps profile tags; docs/product/accounts.md#本机密码与设备. */
export const TAG_COUNT = 5;
/** Graphemes per tag; caps profile tags; docs/product/accounts.md#本机密码与设备. */
export const TAG_LENGTH = 12;
/** Graphemes; caps device labels; docs/product/accounts.md#本机密码与设备. */
export const DEVICE_LABEL_LENGTH = 40;
/** Days of account age; qualifies squad activity scoring; docs/product/teams.md#荣誉等级与热度. */
export const TEAM_ACTIVITY_ACCOUNT_AGE_DAYS = 3;
/** Decimal digits; sizes the local unlock password; docs/product/accounts.md#本机密码与设备. */
export const PIN_LENGTH = 6;
/** Seconds without input; marks the account device idle; docs/product/sharing.md#成员在线状态. */
export const DEVICE_IDLE_SECONDS = 5 * MINUTE_MS / SECOND_MS;
/** Allowed operator registration modes; bounds manual signup intervention; docs/product/accounts.md#密钥账号. */
export const SIGNUP_MODES = ['normal', 'harder', 'paused'] as const;
/** Registration mode; defaults operator signup intervention; docs/product/accounts.md#密钥账号. */
export const SIGNUP_MODE_DEFAULT = 'normal';
