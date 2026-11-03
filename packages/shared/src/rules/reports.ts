/** Member-facing report limits, shared by the extension, the business service and the operator console. */
/** Allowed reason codes; classifies reports; docs/product/moderation.md#举报与处理. */
export const REPORT_REASONS = ['spam', 'harassment', 'sexual', 'illegal', 'other'] as const;
/** Graphemes per report note; caps submitted evidence; docs/product/moderation.md#举报与处理. */
export const REPORT_NOTE_LIMIT = 1000;
/** UTF-16 code units; caps report target IDs; docs/product/moderation.md#举报与处理. */
export const REPORT_TARGET_LENGTH = 256;
/** UTF-16 code units; caps report snapshots; docs/product/moderation.md#举报与处理. */
export const REPORT_SNAPSHOT_LENGTH = 10_000;
