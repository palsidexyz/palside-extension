import { MIB, KIB } from '../units.ts';
/** Bytes; caps avatar uploads; docs/product/messages.md#输入与附件. */
export const AVATAR_BYTES = 5 * MIB;
/** Bytes; caps chat image uploads; docs/product/messages.md#输入与附件. */
export const IMAGE_BYTES = AVATAR_BYTES;
/** Bytes including encryption overhead; caps upload request bodies; docs/product/messages.md#输入与附件. */
export const UPLOAD_BYTES = AVATAR_BYTES + 4 * KIB;
/** Bytes per account per rolling day; caps uploads; docs/product/messages.md#输入与附件. */
export const UPLOAD_BYTES_PER_DAY = 50 * MIB;
/** Free-space ratio; refuses uploads below the storage reserve; docs/product/messages.md#输入与附件. */
export const UPLOAD_MIN_FREE_RATIO = 0.15;
/** Bytes; caps JSON request bodies; docs/product/messages.md#输入与附件. */
export const JSON_BODY_BYTES = 512_000;
/** Pixels; caps decoded still images; docs/product/messages.md#输入与附件. */
export const IMAGE_PIXEL_LIMIT = 100_000_000;
/** Pixels across frames; caps decoded animated images; docs/product/messages.md#输入与附件. */
export const IMAGE_ANIMATION_PIXEL_LIMIT = 1_000_000_000;
/** MIME types; allows supported image uploads; docs/product/messages.md#输入与附件. */
export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
/** Bytes; caps serialized image editing documents; docs/product/messages.md#截图图片粘贴与标注. */
export const IMAGE_DOCUMENT_BYTES = 256 * KIB;
