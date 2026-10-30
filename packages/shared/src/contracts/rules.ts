// Plain values and checks shared by the schemas and by UI code that must not load the schema engine.
import { INVITE_PASSWORD_ALPHABET, INVITE_PASSWORD_LENGTH } from './limits.ts';

const graphemeSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
/** Length in user-perceived characters, including composed emoji. */
export function graphemeLength(value: string) {
  let count = 0;
  for (const part of graphemeSegmenter.segment(value)) { void part; count++; }
  return count;
}

export const presetTagIds = ['short-term', 'long-term', 'meme', 'on-chain', 'defi', 'nft', 'solana', 'base', 'newbie'] as const;
/** Custom profile tags are stored trimmed with inner whitespace collapsed. */
export const normalizeTagText = (value: string) => value.trim().replace(/\s+/g, ' ');

export const stances = ['bull', 'hold', 'bear'] as const;
export const ROOM_KEY_PATTERN = /^token:[A-Za-z ]{2,24}:[A-Za-z0-9]{20,64}$/;
export type RoomKey = string;
/** Shape check only; a room key never resolves to a page address. */
export function isRoomKey(value: unknown): value is RoomKey {
  return typeof value === 'string' && ROOM_KEY_PATTERN.test(value);
}
/** The room shared by every site displaying the resolved asset. */
export function roomKeyForAsset(asset: string): RoomKey | null {
  const key = `token:${asset}`;
  return isRoomKey(key) ? key : null;
}

export const INVITE_PASSWORD_PATTERN = new RegExp(`^[${INVITE_PASSWORD_ALPHABET}]{${INVITE_PASSWORD_LENGTH}}$`);
/** Uppercases and keeps only the password alphabet, up to the required length. */
export function normalizeInvitePassword(value: string) {
  return [...value.toUpperCase()].filter(character => INVITE_PASSWORD_ALPHABET.includes(character)).join('').slice(0, INVITE_PASSWORD_LENGTH);
}
export function isInvitePassword(value: unknown): value is string {
  return typeof value === 'string' && INVITE_PASSWORD_PATTERN.test(value);
}
