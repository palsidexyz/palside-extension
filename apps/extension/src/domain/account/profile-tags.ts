import type { ProfileTag } from '@palside/shared/contracts/profiles';
export const tagKey = (tag: ProfileTag): string => 'preset' in tag ? `preset:${tag.preset}` : `text:${tag.text.toLowerCase()}`;
export const hasTag = (tags: ProfileTag[], tag: ProfileTag): boolean => tags.some(item => tagKey(item) === tagKey(tag));
export const tagLabel = (tag: ProfileTag, t: (key: string) => string): string => 'preset' in tag ? t(`extension.member.tagPresets.${tag.preset}`) : tag.text;
