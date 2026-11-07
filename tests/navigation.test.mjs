import test from 'node:test';
import assert from 'node:assert/strict';
import { identifyPage, normalizeAddress, pageKey, parseInvitation, publicShareUrl, websiteUrl } from '../packages/shared/src/navigation.ts';

const address='0x39dbed3a2bd333467115de45665cc57f813c4571';
const hosts=['gmgn.ai','fomo.family','dexscreener.com','x.com','news.example.com'];
test('token URLs identify network and contract but strip referral and trade context',()=>{
  const gmgn=identifyPage(`https://gmgn.ai/robinhood/token/${address}?ref=private&session=secret`,hosts);
  const fomo=identifyPage(`https://fomo.family/tokens/robinhood/${address}?tradeId=someone`,hosts);
  assert.equal(gmgn.id,fomo.id);assert.equal(gmgn.chain,'Robinhood');assert.equal(fomo.address,address);
  assert.equal(new URL(gmgn.url).search,'');assert.equal(new URL(fomo.url).search,'');
  assert.equal(identifyPage(`https://gmgn.ai/base/token/${address}`,hosts).id===gmgn.id,false);
  // A contract with no chain in the URL is looked up by the server on every EVM chain; a named unsupported chain is not.
  assert.equal(identifyPage(`https://gmgn.ai/unknown/token/${address}`,hosts).kind,'address');
  assert.equal(identifyPage(`https://gmgn.ai/arb/token/${address}`,hosts).kind,'website');
});
test('pool IDs never masquerade as contracts; missing or unsupported pages fall back to site identity',()=>{
  for(const pool of [address,`0x${'1'.repeat(64)}`]) assert.equal(identifyPage(`https://dexscreener.com/robinhood/${pool}`,hosts).kind,'pool');
  assert.equal(identifyPage('https://fomo.family/token',hosts).kind,'website');
  assert.deepEqual(identifyPage('https://news.example.com/private/article?secret=yes#message',hosts),{kind:'website',site:'news.example.com',host:'news.example.com',url:'https://news.example.com',id:'website:news.example.com',disclosure:'site'});
});
test('selected hosts and browser boundaries are checked without a page-purpose blacklist',()=>{
  for(const url of ['https://gmgn.ai.evil.example/x','https://sub.gmgn.ai/','file:///tmp/private','chrome://settings','https://user:password@gmgn.ai/']) assert.equal(identifyPage(url,hosts),null);
  assert.equal(normalizeAddress('Solana','11111111111111111111111111111111'),'11111111111111111111111111111111');
  assert.equal(normalizeAddress('Solana','0'.repeat(32)),null);
});
test('navigation reuse ignores only known tracking and keeps pool/site/query differences',()=>{
  assert.equal(pageKey('https://gmgn.ai/robinhood/token/a?ref=x&utm_source=x'),pageKey('https://gmgn.ai/robinhood/token/a'));
  assert.notEqual(pageKey('https://fomo.family/tokens/base/a?pool=one'),pageKey('https://fomo.family/tokens/base/a?pool=two'));
  assert.equal(pageKey('javascript:alert(1)'),null);
  const invitation='a'.repeat(32);
  assert.equal(parseInvitation(`https://palside.example/invite/${invitation}`,'https://palside.example'),invitation);
  assert.equal(parseInvitation(`https://evil.example/invite/${invitation}`,'https://palside.example'),null);
});
test('explicit public sharing preserves harmless deep links but refuses credentials and nonpublic origins', () => {
  assert.equal(publicShareUrl('https://news.example.com/article?id=12&utm_source=chat'), 'https://news.example.com/article?id=12');
  for (const url of ['https://example.com/?access_token=secret','https://user:pass@example.com/a','file:///tmp/a','chrome://settings','https://example.com/#id_token=secret']) assert.equal(publicShareUrl(url),null);
});

test('public URL classification normalizes root dots and rejects local and reserved hosts', () => {
  for (const host of ['localhost', 'sub.localhost', 'box.local', 'printer.internal', 'office.intranet', 'router.lan', 'router.home', 'home.arpa', 'router.home.arpa']) {
    for (const spelling of [host, `${host.toUpperCase()}.`]) {
      const url = `https://${spelling}/page`;
      assert.equal(websiteUrl(url), null, url);
      assert.equal(publicShareUrl(url), null, url);
      assert.equal(identifyPage(url), null, url);
    }
  }
  for (const host of ['0.0.0.0', '10.0.0.1', '127.1', '0x7f000001', '169.254.1.1', '172.16.0.1', '192.168.0.1', '100.64.0.1', '192.0.0.1', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '[::1]', '[::ffff:8.8.8.8]']) {
    assert.equal(websiteUrl(`https://${host}/page`), null, host);
  }
  assert.equal(publicShareUrl('https://NEWS.Example.COM./account?id=12#section'), 'https://news.example.com/account?id=12#section');
  assert.equal(websiteUrl('https://8.8.8.8/page').hostname, '8.8.8.8');
  assert.equal(identifyPage(`https://GMGN.AI./base/token/${address}`, hosts).kind, 'asset');
});

test('query and hash parameters use the same credential-name boundary', () => {
  const names = ['access_token', 'refreshToken', 'id_token', 'auth', 'authorization', 'jwt', 'session', 'sessionId', 'api_key', 'apiKey', 'secret', 'client_secret', 'password', 'signature', 'credential', 'X-Amz-Credential', 'X-Amz-Signature', 'code', 'state', 'nonce', 'code_verifier', 'ticket', 'otp', 'SAMLResponse', 'RelayState', 'reset_token', 'magic_link'];
  for (const name of names) {
    for (const suffix of [`?${name}=secret`, `#${name}=secret`, `#/page?x=1&${name}=secret`, `#/page?${name.toUpperCase()}=secret&x=1`]) {
      for (const path of ['https://example.com/article', `https://gmgn.ai/base/token/${address}`]) {
        assert.equal(publicShareUrl(path + suffix), null, path + suffix);
      }
    }
  }
  for (const suffix of ['?%61ccess_token=secret', '#/page?%61ccess_token=secret', '#/page%3Fsignature%3Dsecret', '#/page?signature=secret&signature=other', '#/page?bad=%ZZ']) {
    assert.equal(publicShareUrl('https://example.com/' + suffix), null, suffix);
  }
});

test('the token parameter is a contract only on token sites and only with an address value', () => {
  const tokenRoute = `https://gmgn.ai/base/token/${address}`;
  for (const suffix of [`?token=${address}`, `#/page?x=1&token=${address}`, `#TOKEN=${address}`]) {
    for (const path of [tokenRoute, `https://dexscreener.com/base/${address}`, `https://pump.fun/coin/${address}`]) assert.equal(publicShareUrl(path + suffix), path + suffix);
    for (const path of ['https://example.com/token/coin', `https://x.com/base/token/${address}`, `https://sub.gmgn.ai/base/token/${address}`]) assert.equal(publicShareUrl(path + suffix), null, path + suffix);
  }
  for (const value of ['coin', 'secret-session']) assert.equal(publicShareUrl(`${tokenRoute}?token=${value}`), null, value);
  assert.equal(publicShareUrl(tokenRoute + '?access_token=secret&token=coin'), null);
  assert.equal(publicShareUrl(tokenRoute + '#/page?refresh_token=secret&token=coin'), null);
});

test('ordinary public parameters and page-purpose routes retain their identity', () => {
  for (const path of ['/account', '/portfolio', '/wallet', '/login', '/article']) {
    const url = `https://example.com${path}?author=alice&tokenSymbol=PALS&x=1&x=2#/page?x=3&ref=chapter`;
    assert.equal(publicShareUrl(url), url);
  }
  for (const anchor of ['token', 'password', 'signature']) {
    const url = `https://example.com/article#${anchor}`;
    assert.equal(publicShareUrl(url), url);
  }
});


test('terminal URLs keep only what names the token; a Solana account needs no chain, an EVM one never guesses',()=>{
  const mint='So11111111111111111111111111111111111111112';
  const cases=[
    [`https://neo.bullx.io/terminal?chainId=1399811149&address=${mint}&r=private`, 'asset','Solana'],
    [`https://neo.bullx.io/terminal?address=${mint}`, 'asset','Solana'],
    [`https://axiom.trade/meme/${mint}?chain=sol&wallet=private`, 'pool','Solana'],
    [`https://axiom.trade/meme/${mint}`, 'pool','Solana'],
    [`https://birdeye.so/token/${address}?chain=base`, 'asset','Base'],
    [`https://birdeye.so/solana/token/${mint}?entry_type=trending`, 'asset','Solana'],
    [`https://birdeyeterminal.com/base/token/${address}`, 'asset','Base'],
  ];
  for(const [url,kind,chain] of cases) {
    const result=identifyPage(url,[new URL(url).hostname]); assert.equal(result.kind,kind,url); assert.equal(result.chain,chain,url); assert.doesNotMatch(result.url,/private|entry_type|wallet/);
  }
  for(const url of [`https://axiom.trade/meme/${mint}?chain=sol&chain=base`,`https://neo.bullx.io/terminal?chainId=unknown&address=${address}`,`https://neo.bullx.io/terminal?chainId=1&chainId=1&address=${address}`,`https://neo.bullx.io/terminal?chainId=42161&address=${address}`]) assert.equal(identifyPage(url,[new URL(url).hostname]).kind,'website',url);
});

test('real token pages across terminals, launchpads, analytics and explorers (measured samples, AXIOM included)',()=>{
  const bonk='DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', pump='4ATfFBoNiRYjJKCs5bMB8BeNmokdxB4YXiTUt35tpump', aero='0x940181a94a35a4569e4529a3cdfb74e38fd98631', pool='84z9HjzVbeezN9qLowF8ojdEqKB7LcPx1tYzX7aTcgoE';
  const cases=[
    [`https://axiom.trade/token/4izrY1fKbZwYBxqN4aeJ4CRWBKEPB5MV4B4s2ECZpump?chain=sol&chains=sol,bnb`,'asset','Solana','https://axiom.trade/token/4izrY1fKbZwYBxqN4aeJ4CRWBKEPB5MV4B4s2ECZpump?chain=sol'],
    [`https://axiom.trade/token/0x5A64B1F03A8CB2AC6CA0BE5A7A5F7DFAA0B2EDC4?chain=robinhood&chains=sol,robinhood`,'asset','Robinhood','https://axiom.trade/token/0x5a64b1f03a8cb2ac6ca0be5a7a5f7dfaa0b2edc4?chain=robinhood'],
    [`https://axiom.trade/token/0x42620c8d4e6bd1ba7d7f2ad8bb4ef9fdc4d27777?chain=bnb`,'asset','BNB Chain'],
    [`https://axiom.trade/meme/${pool}?chain=sol`,'pool','Solana'],
    [`https://web3.okx.com/zh-hans/token/solana/${bonk}`,'asset','Solana'],
    [`https://web3.binance.com/en/token/sol/${bonk}`,'asset','Solana'],
    [`https://four.meme/zh-TW/token/0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82`,'asset','BNB Chain'],
    [`https://zora.co/coin/base:${aero}`,'asset','Base'],
    [`https://clanker.world/clanker/0x940181a94A35A4569E4529A3CDfB74e38FD98631`,'asset','Base',`https://clanker.world/clanker/${aero}`],
    [`https://pump.fun/coin/${pump}`,'asset','Solana'],
    [`https://bags.fm/${pump}`,'asset','Solana'],
    [`https://ave.ai/token/${bonk}-solana`,'asset','Solana'],
    [`https://www.defined.fi/token/sol/${pump}/${pool}`,'asset','Solana'],
    [`https://v2.bubblemaps.io/map?address=${bonk}&chain=solana`,'asset','Solana'],
    [`https://honeypot.is/base?address=${aero}`,'asset','Base'],
    [`https://basescan.org/token/${aero}`,'asset','Base'],
    [`https://robinhoodchain.blockscout.com/token/0x9242a998b2bd443d9e4eb484c618ee42c9c4ce39`,'asset','Robinhood'],
    [`https://arkm.com/explorer/token/${aero}`,'address',undefined],
    [`https://dexscreener.com/solana/${bonk}`,'pool','Solana'],
    [`https://dexscreener.com/robinhood/0x304b3198128ed6b1c52170937d116b23a40f41d8e0e74b0091a3dae124820a1a`,'pool','Robinhood'],
    [`https://www.geckoterminal.com/solana/pools/${pool}`,'pool','Solana'],
    [`https://www.dextools.io/app/solana/pair-explorer/${pool}`,'pool','Solana'],
    [`https://photon-sol.tinyastro.io/en/lp/${pool}`,'pool','Solana'],
  ];
  for(const [url,kind,chain,canonical] of cases){
    const result=identifyPage(url); assert.equal(result.kind,kind,url); assert.equal(result.chain,chain,url);
    if(canonical) assert.equal(result.url,canonical,url);
  }
  // Wallet and transaction pages, unsupported chains and non-crypto sites are never read for a token.
  for(const url of [`https://etherscan.io/address/${aero}`,`https://gmgn.ai/sol/address/${bonk}`,`https://solscan.io/tx/${bonk}`,`https://arbiscan.io/token/${aero}`,`https://x.com/a/status/1?ca=${bonk}`,`https://four.meme/token/${bonk}`,`https://gmgn.ai/base/token/${bonk}`]) assert.equal(identifyPage(url).kind,'website',url);
});
test('account pages and unknown routes follow website disclosure; sites on unsupported chains read no token',()=>{
  for(const path of ['/portfolio','/wallet/123','/account','/%61ccount','/#/messages/secret']) assert.equal(identifyPage(`https://neo.bullx.io${path}`,['neo.bullx.io']).kind,'website');
  const url='https://x.com/alice/status/123?lang=en&utm_source=friend#reply';
  assert.equal(identifyPage(url,['x.com']).url,'https://x.com');
  assert.equal(identifyPage(url,['x.com'],'page').url,'https://x.com/alice/status/123?lang=en#reply');
  assert.equal(identifyPage(url,[],'page'),null);
  assert.equal(identifyPage('https://pump.fun/coin/So11111111111111111111111111111111111111112',['pump.fun']).kind,'asset');
  assert.equal(identifyPage('https://sunpump.meme/token/So11111111111111111111111111111111111111112',['sunpump.meme']).kind,'website');
  assert.equal(identifyPage(`https://gmgn.ai:8443/base/token/${address}`,['gmgn.ai']),null);
});

test('localized invitation paths retain strict origin and code validation', () => {
  const code = 'a'.repeat(32), origin = 'https://palside.example';
  for (const path of [`/invite/${code}`, `/en/invite/${code}`, `/zh-CN/invite/${code}/`]) assert.equal(parseInvitation(`${origin}${path}?from=friend#join`, origin), code);
  for (const path of [`/fr/invite/${code}`, `/en/other/${code}`, `/en/invite/${code}/extra`, `/en/invite/short`]) assert.equal(parseInvitation(origin + path, origin), null);
  assert.equal(parseInvitation(`https://user@palside.example/en/invite/${code}`, origin), null);
  assert.equal(parseInvitation(`https://evil.example/zh-CN/invite/${code}`, origin), null);
});
