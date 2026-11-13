
export type Screen = 'chat' | 'welcome' | 'new-account' | 'confirm-phrase' | 'restore' | 'password' | 'nickname' | 'lobby' | 'recruitment' | 'join' | 'add-team' | 'former-teams' | 'team' | 'members' | 'requests' | 'team-profile' | 'settings' | 'search' | 'asset' | 'profile' | 'security' | 'privacy' | 'interaction' | 'sites' | 'site' | 'notifications' | 'favorites' | 'about' | 'delete-account' | 'report' | 'room' | 'room-people' | 'hot' | 'blocked' | 'wallet' | 'wallet-receive' | 'wallet-records' | 'wallet-settings' | 'wallet-packet';
/** Screens reachable before sign-in; anything else waits for an account. */
export const signedOutScreens: readonly Screen[] = ['welcome', 'new-account', 'confirm-phrase', 'restore'];
