import { endpoint, jsonBody, jsonResponse, binaryResponse } from '../endpoint.ts';
import { tokenResolveInput, tokenResolveResult, tokenSearchQuery, tokenSearchResult, tokenLogoParams, tokenLogoQuery } from '../tokens.ts';
export const tokenEndpoints = [
  endpoint({ id: 'tokens.resolve', method: 'POST', path: '/tokens/resolve', rateLimits: ['tokenResolve'], body: jsonBody(tokenResolveInput), response: jsonResponse(tokenResolveResult), errors: ['TOKENS_UNAVAILABLE'] }),
  endpoint({ id: 'tokens.search', method: 'GET', path: '/tokens/search', rateLimits: ['tokenSearch'], query: tokenSearchQuery, response: jsonResponse(tokenSearchResult), errors: ['TOKENS_UNAVAILABLE'] }),
  // Public so a plain <img> can show it; serves only logos the directory already holds.
  endpoint({ id: 'tokens.logo', method: 'GET', path: '/tokens/logo/:chain/:address', auth: 'public', rateLimits: ['tokenLogo'], params: tokenLogoParams, query: tokenLogoQuery, response: binaryResponse, errors: ['MEDIA_UNAVAILABLE', 'TOKENS_UNAVAILABLE'] }),
] as const;
