import { CHAT_TEXT_MAX } from '@palside/shared/rules/messages';

const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
export function truncateChatText(value: string, maximum = CHAT_TEXT_MAX) {
  let count = 0;
  for (const part of segmenter.segment(value)) if (count++ === maximum) return value.slice(0, part.index);
  return value;
}
