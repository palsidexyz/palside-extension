import { graphemeLength } from '@palside/shared/contracts/rules';
import { shortAddress,type PageIdentity } from '@palside/shared/navigation';

export type TokenIdentity = Extract<PageIdentity, { kind: 'asset' }>;

/** Validates a display name already bound to a full contract, never a raw tab title. */
export function tokenName(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const name = value.trim().replace(/\s+/gu, ' ');
  if (!name || graphemeLength(name) > 64 || !/[\p{L}\p{N}]/u.test(name) || /[\u0000-\u001f\u007f‪-‮⁦-⁩<>↑↓▲▼↗↘⬆⬇]/u.test(name)) return;
  if (/^(?:[$€£¥]\s*)?[+-]?[\d,.]+\s*(?:%|[KMBT])?$/iu.test(name)) return;
  return name;
}

/** A token's display name: a valid known name, otherwise its short address. */
export function resolveTokenMetadata(identity: Pick<TokenIdentity, 'address'>, known?: { name?: string }): { name: string } {
  return { name: tokenName(known?.name) ?? shortAddress(identity.address) };
}
