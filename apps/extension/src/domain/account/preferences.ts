import type { Favorites,SiteInteractions } from '../annotations/interaction.ts';
/**
 * Kept per account on this device. `share`: 共享在看 is on (it stays on across browser restarts until pressed off).
 * `siteInteraction`: 网页互动 per site. `toured`: the first-run tour has been shown.
 */
export type Preferences = { /** off: 参与弹幕 switched off; site: the site tokens last opened on; noticed: the one-time 弹幕 disclosure was shown. */ rooms?: { off?: boolean; site?: string; noticed?: boolean }; startedTeams?: string[]; hiddenStickies?: string[]; /** Read-only teams whose history the user removed from this device. */ forgottenTeams?: string[]; current: string; notificationPreview?: boolean; notifications: 'off' | 'mentions' | 'all'; share?: boolean; siteInteraction?: SiteInteractions; favorites?: Favorites; toured?: boolean };
