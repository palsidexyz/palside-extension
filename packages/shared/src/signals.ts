/** Signal vocabulary shared by the extension's page layer and the website's demos. */
export const signalKinds = ['attention', 'danger', 'question', 'help', 'agree', 'disagree', 'watch', 'together'] as const;
export type SignalKind = typeof signalKinds[number];
export const signalEmotes = ['diamond-hands', 'paper-hands', 'copium', 'rekt', 'fomo', 'sold-early', 'quiet-win', 'bagholder', 'gm', 'dyor', 'no-fud', 'touch-grass', 'alpha', 'lurker', 'send-it', 'exit-liquidity', 'rugged', 'trapped', 'run', 'popcorn', 'im-fine', 'whale', 'shill', 'wen', 'gas', 'airdrop', 'gn'] as const;
export type SignalEmote = typeof signalEmotes[number];
export type WheelEntry = SignalKind | SignalEmote;
export const defaultWheel: readonly WheelEntry[] = ['danger', 'watch', 'together', 'agree', 'gm', 'attention', 'question', 'paper-hands'];
