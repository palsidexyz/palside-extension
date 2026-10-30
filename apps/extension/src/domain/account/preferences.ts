import type { Favorites,InteractionPrefs,WebFeatures } from '../annotations/interaction.ts';
/**
 * Kept per account on this device. `web`: 共享在看 and 网页互动 启用. `tokenOff`: 已授权网站 whose 代币数据 is off.
 * `restoreSites`: the 已授权网站 given back when 网页互动 was 禁用, asked for again when it is 启用.
 */
export type Preferences = { rooms?: { off?: boolean }; startedTeams?: string[]; hiddenStickies?: string[]; /** Read-only teams whose history the user removed from this device. */ forgottenTeams?: string[]; current: string; notificationPreview?: boolean; notifications: 'off' | 'mentions' | 'all'; web: WebFeatures; interaction?: InteractionPrefs; favorites?: Favorites; tokenOff?: string[]; restoreSites?: string[] };
/** 共享在看 lasts for this session; 网页互动 is saved per account on this device. Both default off. */
export type Toggles = WebFeatures;
