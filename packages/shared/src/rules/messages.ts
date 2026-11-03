/** Graphemes per message; caps chat input; docs/product/messages.md#输入与附件. */
export const CHAT_TEXT_MAX = 4000;
/** Messages per burst; paces squad sends; docs/product/messages.md#输入与附件. */
export const CHAT_SEND_BURST = 10;
/** Messages per minute; replenishes chat send budget; docs/product/messages.md#输入与附件. */
export const CHAT_SEND_PER_MINUTE = 60;
/** UTF-16 code units; caps protocol identifiers; docs/product/messages.md#输入与附件. */
export const IDENTIFIER_LENGTH = 100;
/** UTF-16 code units; caps Matrix event IDs; docs/product/messages.md#输入与附件. */
export const EVENT_ID_LENGTH = 255;
/** Event IDs per request; caps read acknowledgements; docs/product/messages.md#输入与附件. */
export const READ_IDS_LIMIT = 500;
/** UTF-16 code units; caps encrypted Matrix messages; docs/product/messages.md#输入与附件. */
export const CHAT_CIPHERTEXT_LENGTH = 500_000;
