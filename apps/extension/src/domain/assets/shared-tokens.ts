import type { Message } from '../chat/model';
import type { Viewing } from './model';
import { viewAsset,type AssetKey } from '../annotations/social.ts';

export type SharedToken = {
  asset: AssetKey;
  view: Viewing;
  messages: number;
  lastAt: number;
  lastMessage: Message;
};
export type TokenOrder = 'recent' | 'discussed';

type TokensInput = {
  /** The current team's messages; counts include every author. */
  messages: readonly Message[];
  now: number;
};

function collectTokens({ messages, now }: TokensInput): SharedToken[] {
  const tokens = new Map<AssetKey, SharedToken>();
  for (const message of messages) {
    const at = message.timestamp;
    if (message.recalled || message.removedByOwner || message.status !== 'sent' || at === undefined || !Number.isFinite(at) || at > now || message.expiresAt !== undefined && message.expiresAt <= now) continue;
    const views = [message.attachment?.kind === 'asset' ? message.attachment.view : undefined, message.ref?.view];
    const counted = new Set<AssetKey>();
    for (const view of views) {
      const asset = viewAsset(view);
      if (!asset || !view || counted.has(asset)) continue;
      counted.add(asset);
      const token = tokens.get(asset);
      if (!token) {
        tokens.set(asset, { asset, view, messages: 1, lastAt: at, lastMessage: message });
        continue;
      }
      token.messages += 1;
      if (at > token.lastAt || at === token.lastAt && message.id > token.lastMessage.id) {
        token.lastAt = at;
        token.lastMessage = message;
        token.view = view;
      }
    }
  }
  return [...tokens.values()];
}

function orderTokens(tokens: SharedToken[], order: TokenOrder) {
  return tokens.sort((a, b) => (order === 'discussed' ? b.messages - a.messages : 0) || b.lastAt - a.lastAt || (a.asset < b.asset ? -1 : a.asset > b.asset ? 1 : 0));
}

/** One shared list of retained token cards and token references; ordinary webpages never enter it. */
export function sharedTokens(input: TokensInput & { order: TokenOrder }): SharedToken[] {
  return orderTokens(collectTokens(input), input.order);
}
