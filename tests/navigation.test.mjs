import test from 'node:test';
import assert from 'node:assert/strict';
import { identifyPage, normalizeAddress, pageKey, parseInvitation, publicShareUrl, websiteUrl } from '../packages/shared/src/navigation.ts';

const address='0x39dbed3a2bd333467115de45665cc57f813c4571';
const hosts=['gmgn.ai','fomo.family','dexscreener.com','x.com','news.example.com'];
test('GMGN/FOMO routes identify network and contract but strip referral and trade context',()=>{
  const gmgn=identifyPage(`https://gmgn.ai/robinhood/token/${address}?ref=private&session=secret`,hosts);
  const fomo=identifyPage(`https://fomo.family/tokens/robinhood/${address}?tradeId=someone`,hosts);
  assert.equal(gmgn.id,fomo.id);assert.equal(gmgn.chain,'Robinhood');assert.equal(fomo.address,address);
  assert.equal(new URL(gmgn.url).search,'');assert.equal(new URL(fomo.url).search,'');
  assert.equal(identifyPage(`https://gmgn.ai/base/token/${address}`,hosts).id===gmgn.id,false);
  assert.equal(identifyPage(`https://gmgn.ai/unknown/token/${address}`,hosts).kind,'website');
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
  const names = ['access_token', 'refreshToken', 'id_token', 'auth', 'authorization', 'jwt', 'session', 'sessionId', 'api_key', 'apiKey', 'secret', 'client_secret', 'password', 'signature', 'credential', 'X-Amz-Credential', 'X-Amz-Signature'];
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

test('only catalog token routes allow the token parameter in query and fragments', () => {
  const tokenRoute = `https://gmgn.ai/base/token/${address}`;
  for (const suffix of [`?token=${address}`, `#/page?x=1&token=${address}`, `#TOKEN=${address}`]) {
    assert.equal(publicShareUrl(tokenRoute + suffix), tokenRoute + suffix);
    for (const path of ['https://example.com/token/coin', 'https://gmgn.ai/account', `https://dexscreener.com/base/${address}`, `https://sub.gmgn.ai/base/token/${address}`, `https://pump.fun/coin/${address}`]) {
      assert.equal(publicShareUrl(path + suffix), null, path + suffix);
    }
  }
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


test('terminal URLs retain only explicit asset identity and never guess a network',()=>{
  const mint='So11111111111111111111111111111111111111112';
  const cases=[
    [`https://neo.bullx.io/terminal?chainId=1399811149&address=${mint}&r=private`, 'asset','Solana'],
    [`https://axiom.trade/meme/${mint}?chain=sol&wallet=private`, 'pool','Solana'],
    [`https://birdeye.so/token/${address}?chain=base`, 'asset','Base'],
    [`https://birdeye.so/solana/token/${mint}?entry_type=trending`, 'asset','Solana'],
    [`https://birdeye.so/base/token/${address}`, 'asset','Base'],
  ];
  for(const [url,kind,chain] of cases) {
    const result=identifyPage(url,[new URL(url).hostname]); assert.equal(result.kind,kind); assert.equal(result.chain,chain); assert.doesNotMatch(result.url,/private/);
  }
  for(const url of [`https://axiom.trade/meme/${mint}`,`https://axiom.trade/meme/${mint}?chain=sol&chain=base`,`https://neo.bullx.io/terminal?address=${mint}`,`https://neo.bullx.io/terminal?chainId=unknown&address=${mint}`]) assert.equal(identifyPage(url,[new URL(url).hostname]).kind,'website');
});
test('account pages and unknown routes follow website disclosure; unsupported hosts have no token adapter',()=>{
  for(const path of ['/portfolio','/wallet/123','/account','/%61ccount','/#/messages/secret']) assert.equal(identifyPage(`https://neo.bullx.io${path}`,['neo.bullx.io']).kind,'website');
  const url='https://x.com/alice/status/123?lang=en&utm_source=friend#reply';
  assert.equal(identifyPage(url,['x.com']).url,'https://x.com');
  assert.equal(identifyPage(url,['x.com'],'page').url,'https://x.com/alice/status/123?lang=en#reply');
  assert.equal(identifyPage(url,[],'page'),null);
  assert.equal(identifyPage('https://pump.fun/coin/So11111111111111111111111111111111111111112',['pump.fun']).kind,'website');
  assert.equal(identifyPage(`https://gmgn.ai:8443/base/token/${address}`,['gmgn.ai']),null);
});

test('localized invitation paths retain strict origin and code validation', () => {
  const code = 'a'.repeat(32), origin = 'https://palside.example';
  for (const path of [`/invite/${code}`, `/en/invite/${code}`, `/zh-CN/invite/${code}/`]) assert.equal(parseInvitation(`${origin}${path}?from=friend#join`, origin), code);
  for (const path of [`/fr/invite/${code}`, `/en/other/${code}`, `/en/invite/${code}/extra`, `/en/invite/short`]) assert.equal(parseInvitation(origin + path, origin), null);
  assert.equal(parseInvitation(`https://user@palside.example/en/invite/${code}`, origin), null);
  assert.equal(parseInvitation(`https://evil.example/zh-CN/invite/${code}`, origin), null);
});
