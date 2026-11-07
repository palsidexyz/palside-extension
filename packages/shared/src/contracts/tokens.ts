import Type, { type StaticDecode as Static } from 'typebox';
import { contractString, denseArray, safeInteger, strictObject } from './validation.ts';
import { tokenChains } from '../tokens.ts';
import { TOKEN_NAME_MAX, TOKEN_RESOLVE_LIMIT, TOKEN_SEARCH_LIMIT } from '../rules/tokens.ts';

export const tokenChain = Type.Enum(tokenChains);
/** Shape only; the directory validates the address family against the chain. */
export const tokenAddressText = contractString({ min: 32, max: 64, pattern: /^[0-9A-Za-z]+$/ });
const displayText = Type.Union([contractString({ min: 1, max: TOKEN_NAME_MAX, unit: 'codePoint' }), Type.Null()]);
/**
 * One directory entry. Missing names mean the chain has none or an operator hid it; clients then show the short address.
 * `logo` is the version to request from tokens.logo; `logoPending` means a download is still scheduled.
 */
export const tokenEntry = strictObject({
  chain: tokenChain, address: tokenAddressText, name: displayText, symbol: displayText,
  decimals: Type.Union([safeInteger({ minimum: 0, maximum: 255 }), Type.Null()]),
  logo: Type.Union([safeInteger({ minimum: 1 }), Type.Null()]), logoPending: Type.Boolean(),
});
/** A trading pool id: an EVM pool contract, a 32-byte Uniswap v4 pool id, or a Solana pool account. */
export const tokenPoolText = contractString({ min: 32, max: 66, pattern: /^[0-9A-Za-z]+$/ });
/** An address, with its chain when the page named one; or a pool on its chain, resolved to the one token it trades. */
export const tokenResolveInput = strictObject({
  items: denseArray(Type.Union([strictObject({ address: tokenAddressText, chain: Type.Optional(tokenChain) }), strictObject({ pool: tokenPoolText, chain: tokenChain })]), { minItems: 1, maxItems: TOKEN_RESOLVE_LIMIT }),
});
/**
 * `token`: exactly one chain holds this token. `choice`: several chains do, the person picks.
 * `missing`: no supported chain has a token here. `invalid`: the address does not fit the chain.
 * `unavailable`: a chain could not be read now; ask again later. A pool answers for its token; `missing` there also means
 * the pool holds no single token (two quote coins, or two tokens).
 */
const resolutionStatus = Type.Union([Type.Literal('token'), Type.Literal('choice'), Type.Literal('missing'), Type.Literal('invalid'), Type.Literal('unavailable')]);
export const tokenResolution = Type.Union([
  strictObject({ address: tokenAddressText, chain: Type.Optional(tokenChain), status: resolutionStatus, tokens: denseArray(tokenEntry, { maxItems: tokenChains.length }) }),
  strictObject({ pool: tokenPoolText, chain: tokenChain, status: resolutionStatus, tokens: denseArray(tokenEntry, { maxItems: 1 }) }),
]);
export const tokenResolveResult = strictObject({ items: denseArray(tokenResolution, { maxItems: TOKEN_RESOLVE_LIMIT }) });
export const tokenSearchQuery = strictObject({ q: contractString({ min: 1, max: 64, trim: true }) });
export const tokenSearchResult = strictObject({ rows: denseArray(tokenEntry, { maxItems: TOKEN_SEARCH_LIMIT }) });
export const tokenLogoParams = strictObject({ chain: tokenChain, address: tokenAddressText });
export const tokenLogoQuery = strictObject({ v: Type.Optional(Type.Decode(contractString({ min: 1, max: 15, pattern: /^[1-9]\d*$/ }), Number)) });

export type TokenEntry = Static<typeof tokenEntry>;
export type TokenResolution = Static<typeof tokenResolution>;
export type TokenResolveInput = Static<typeof tokenResolveInput>;
