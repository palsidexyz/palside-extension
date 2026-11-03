import { tokenPageUrl } from '@palside/shared/navigation';
import { siteById } from '@palside/shared/sites';

export const HOT_CHAIN_ORDER = [null, 'Robinhood', 'Solana', 'BNB Chain', 'Base', 'Ethereum'] as const;
const TOKEN_SITES = ['gmgn', 'fomo', 'bullx', 'birdeye'];
type Token = { chain: string; address: string };

export function tokenSites(token: Token) {
  return TOKEN_SITES.flatMap(id => {
    const site = siteById(id), url = tokenPageUrl(id, token.chain, token.address);
    return site && url ? [{ ...site, url }] : [];
  });
}

export function defaultTokenSite(token: Token, lastSite?: string | null, participantSite?: string | null) {
  const available = tokenSites(token);
  for (const id of [lastSite, participantSite, 'gmgn']) {
    const site = available.find(site => site.id === id);
    if (site) return site;
  }
}
