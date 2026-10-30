import { productionModules } from './helpers/production-module.mjs';
import * as contractLimits from '../packages/shared/src/contracts/limits.ts';
import * as contractCommon from '../packages/shared/src/contracts/common.ts';
import { languageGlobals } from './helpers/language-host.mjs';
import { renderMessage } from '../packages/i18n/src/core.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionScope } from '../apps/extension/src/runtime/account/session.ts';
import { sharingWork } from '../apps/extension/src/runtime/viewing/sharing-work.ts';
import { trustedDeviceMessages } from '../apps/extension/src/runtime/viewing/viewing-targets.ts';
import { teamSendGuard } from '../apps/extension/src/runtime/account/crypto-identity.ts';
import { encryptedCrypto } from './helpers/encrypted-room.mjs';
import { startedTeams } from '../apps/extension/src/runtime/teams/onboarding.ts';
import { defaultWebFeatures, interactionAllows, readFavorites, readHosts, readInteraction, readWebFeatures } from '../apps/extension/src/domain/annotations/interaction.ts';

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));
const context = { ...languageGlobals, ...contractLimits, ...contractCommon, defaultWebFeatures, interactionAllows, readFavorites, readHosts, readInteraction, readWebFeatures, startedTeams, sharingWork, clearTimeout, URL, trustedDeviceMessages, teamSendGuard };
const load = productionModules(context);
const { SharingRuntime } = load('apps/extension/src/runtime/viewing/sharing.ts');
const { RuntimeCommands } = load('apps/extension/src/runtime/composition/dispatch.ts');
function fixture() {
  const value = new SharingRuntime(undefined);
  value.execute = RuntimeCommands.prototype.execute;
  value.runtime = value; value.auth = value; value.sharing = value; value.dispatch = value;
  value.scope = () => sessionScope(() => true, () => Error('session changed'));
  const requests=[]; const stored=new Map(); const snapshots=[];
  value.state={account:{}, toggles:{share:true,interact:false}, preferences:{current:'team',web:{share:true,interact:true},tokenOff:['x.com'],notifications:'off'}, remoteTeams:[{id:'team',joined:true,people:[{id:'self',matrixId:'@self'}],memberIds:['self']}],data:{teams:[]}};
  value.requireConnection=()=>{};
  value.initialise=async()=>{};value.preferencesQueue=Promise.resolve();value.togglesQueue=Promise.resolve();value.persistedInteract=false;
  value.pageObservation=0;value.viewingSequence=0;value.viewingOrder=1;
  value.session={account:{id:'self'},matrix:{}}; value.emit=()=>snapshots.push(structuredClone(value.state));
  value.expireViewing=()=>value.emit();value.mayObserve=()=>value.state.preferences.web.share&&value.state.toggles.share;value.foreground=async()=>true;value.clearRemoteViewing=async()=>{};
  value.storage={get:async key=>stored.get(key),put:async(key,_id,_kind,data)=>stored.set(key,data),remove:async key=>stored.delete(key)};
  value.api={request:async(path,body)=>{requests.push({path,...body});return {selected:true,expiresAt:Date.now()+30000};}};
  value.client={getCrypto:()=>({...encryptedCrypto(),getUserDeviceInfo:async()=>new Map([['@self',new Map([['OTHER',{}]])]]),encryptToDeviceMessages:async()=>({batch:[]})})};
  value.page={id:'page',url:'https://x.com',kind:'website'};value.pageSince=Date.now()-2000;value.selectedDevice=true;
  return {value,requests,stored,snapshots};
}
test('publishing remains pending until acknowledged, then commits the shared object',async()=>{
  const {value}=fixture();const ack=deferred();value.api.request=()=>ack.promise;
  const publishing=value.publishViewing();await tick();
  assert.equal(value.ownViewing,undefined);
  ack.resolve({selected:true,expiresAt:Date.now()+30000});await publishing;
  assert.equal(value.ownViewing.view.id,'page');
});
test('switching 共享在看 off during encryption prevents the old page being sent',async()=>{
  const {value,requests}=fixture();const crypto=deferred();
  value.client.getCrypto=()=>({...encryptedCrypto(),getUserDeviceInfo:async()=>new Map([['@self',new Map([['OTHER',{}]])]]),encryptToDeviceMessages:()=>crypto.promise});
  const publishing=value.publishViewing();await tick();
  assert.deepEqual(plain(await value.execute({name:'toggle',payload:{share:false}})),{share:false,interact:false});
  crypto.resolve({batch:[]});await publishing;
  assert.equal(requests.filter(call=>call.path==='/viewing').length,0);assert.equal(value.ownViewing,undefined);assert.equal(value.page,undefined);
});
test('failed publication keeps an unexpired acknowledged renewal',async()=>{
  const {value}=fixture();value.ownViewing={view:value.page,expiresAt:Date.now()+30000,teamId:'team'};
  value.api.request=async()=>{throw Error('ack missing');};await value.publishViewing();
  assert.equal(value.ownViewing.view.id,'page');
});
test('stalled crypto work times out, late completion stays discarded and a fresh attempt can succeed',async()=>{
  const work=deferred();await assert.rejects(sharingWork(work.promise,5),error => /稍后重试/.test(renderMessage('zh-CN', error.text)));work.resolve('late');
  assert.equal(await sharingWork(Promise.resolve('fresh'),5),'fresh');
});

test('preference persistence captures each revision and never rewinds newer in-memory intent',async()=>{
  const {value}=fixture();const first=deferred();const writes=[];value.preferencesQueue=Promise.resolve();
  value.storage.put=async(_key,_account,_kind,preferences)=>{writes.push(preferences);if(writes.length===1)await first.promise;};
  value.state.preferences={tokenOff:['x.com']};const old=value.savePreferences();await tick();
  value.state.preferences={tokenOff:[]};const latest=value.savePreferences();await tick();
  assert.deepEqual(value.state.preferences.tokenOff,[]);assert.equal(writes.length,1);
  first.resolve();await Promise.all([old,latest]);assert.deepEqual(writes.map(p=>p.tokenOff),[['x.com'],[]]);assert.deepEqual(value.persistedPreferences.tokenOff,[]);
});

test('禁用 共享在看 clears local and remote viewing before any queued disk write completes',async()=>{
  const {value}=fixture();value.initialise=async()=>{};value.preferencesQueue=Promise.resolve();value.togglesQueue=Promise.resolve();value.persistedInteract=false;
  const disk=deferred();value.storage.put=()=>disk.promise;let cleared=0;value.clearRemoteViewing=async()=>{cleared++;};
  const save=value.execute({name:'preferences',payload:{accountId:'self',web:{share:false,interact:true}}});await tick();
  assert.equal(value.page,undefined);assert.equal(cleared,1);assert.equal(value.state.preferences.web.share,false);
  assert.deepEqual(plain(value.state.toggles),{share:false,interact:false},'禁用 also switches the composer button off');
  disk.resolve();await save;
});

const save = (value, patch) => value.execute({ name: 'preferences', payload: { accountId: 'self', ...patch } });
const toggle = (value, payload) => value.execute({ name: 'toggle', payload });

test('token-data preference commands invalidate pending metadata while message and draft snapshots stay frozen', async () => {
  const { value } = fixture(); const read = deferred();
  const url = 'https://gmgn.ai/eth/token/0x0000000000000000000000000000000000000001';
  const target = { tabId: 1, windowId: 10 };
  value.tokenPage = async () => ({ name: 'FROZEN' });
  const frozen = await value.prepareView(url, undefined, target);
  const attachment = { kind: 'asset', assetId: frozen.id, view: frozen };
  value.state.data.messages = [{ id: 'message', teamId: 'team', author: 'self', text: '', time: '12:00', status: 'sent', timestamp: Date.now(), attachment }];
  value.state.drafts = { team: { text: '', attachment: structuredClone(attachment) } };
  const messages = plain(value.state.data.messages), drafts = plain(value.state.drafts);
  value.tokenPage = () => read.promise;
  const pending = value.prepareView(url, undefined, target);
  await save(value, { tokenOff: ['gmgn.ai'] });
  await save(value, { tokenOff: [] });
  read.resolve({ name: 'STALE' });
  assert.notEqual((await pending).name, 'STALE');
  assert.deepEqual(plain(value.state.data.messages), messages);
  assert.deepEqual(plain(value.state.drafts), drafts);
  value.tokenPage = async () => ({ name: 'FRESH' });
  assert.equal((await value.prepareView(url, undefined, target)).name, 'FRESH');
});

test('concurrent preference saves apply in order over the latest preferences and wait for their own ordered writes', async () => {
  const { value, stored } = fixture(); const disk = deferred(); const writes = []; const put = value.storage.put;
  value.storage.put = async (...args) => { writes.push(structuredClone(args[3])); if (writes.length === 1) await disk.promise; return put(...args); };
  let settled = false;
  const first = save(value, { tokenOff: ['EXAMPLE.COM.'] }).then(() => { settled = true; }); await tick();
  const second = save(value, { tokenOff: ['example.com', 'other.com'] });
  const other = save(value, { restoreSites: ['other.com'] }); await tick();
  assert.equal(settled, false); assert.equal(writes.length, 1);
  assert.deepEqual(plain(value.state.preferences.tokenOff), ['example.com', 'other.com']);
  assert.deepEqual(plain(value.state.preferences.restoreSites), ['other.com']);
  assert.deepEqual(plain(value.state.preferences.web), { share: true, interact: true });
  disk.resolve(); await Promise.all([first, second, other]);
  assert.equal(writes.length, 3);
  assert.deepEqual(plain(writes.map(row => row.tokenOff)), [['example.com'], ['example.com', 'other.com'], ['example.com', 'other.com']]);
  assert.deepEqual(plain(stored.get('self:preferences')), plain(value.state.preferences));
});

test('latest failed preference write rolls back to the last committed value without resurrecting revoked viewing', async () => {
  const { value } = fixture();
  value.clearRemoteViewing = async () => {};
  await save(value, { web: { share: true, interact: false } });
  value.storage.put = async () => { throw Error('disk full'); };
  await assert.rejects(save(value, { web: { share: false, interact: false } }), /disk full/);
  assert.deepEqual(plain(value.state.preferences.web), { share: true, interact: false });
  assert.equal(value.state.toggles.share, false, 'the switch stays off');
  assert.equal(value.page, undefined); assert.equal(value.ownViewing, undefined);
});

test('older failed write cannot rewind a newer intent and later writes remain usable', async () => {
  const { value, stored } = fixture(); const first = deferred(); const put = value.storage.put; let count = 0;
  value.storage.put = async (...args) => { if (++count === 1) await first.promise; return put(...args); };
  const older = assert.rejects(save(value, { tokenOff: ['example.com'] }), /disk full/); await tick();
  const newer = save(value, { tokenOff: ['example.com', 'x.com'] }); await tick();
  first.reject(Error('disk full')); await Promise.all([older, newer]);
  assert.deepEqual(plain(value.state.preferences.tokenOff), ['example.com', 'x.com']);
  assert.deepEqual(plain(stored.get('self:preferences').tokenOff), plain(value.state.preferences.tokenOff));
});

test('failed newest write retains the earlier successful update even when both were submitted together', async () => {
  const { value } = fixture(); const disk = deferred(); let writes = 0;
  value.storage.put = async () => { if (++writes === 1) await disk.promise; else throw Error('disk full'); };
  const earlier = save(value, { tokenOff: ['example.com'] }); await tick();
  const latest = assert.rejects(save(value, { tokenOff: [] }), /disk full/); await tick();
  disk.resolve(); await Promise.all([earlier, latest]);
  assert.deepEqual(plain(value.state.preferences.tokenOff), ['example.com']);
});

test('queued preference writes from an old session cannot overwrite the replacement account or its state', async () => {
  const { value, stored } = fixture(); const queue = deferred();
  value.preferencesQueue = queue.promise;
  value.scope = () => { const session = value.session; return sessionScope(() => value.session === session, () => Error('session changed')); };
  const pending = assert.rejects(save(value, { tokenOff: ['example.com'] }), /session changed/); await tick();
  value.session = { account: { id: 'replacement' } };
  const replacement = { current: 'new', web: { share: true, interact: true }, notifications: 'off' };
  value.state.preferences = replacement;
  queue.resolve(); await pending;
  assert.equal(stored.size, 0); assert.equal(value.state.preferences, replacement);
});

test('preference and switch commands validate account and every field before mutating state', async () => {
  const { value, stored } = fixture(); const before = plain(value.state.preferences); const toggles = plain(value.state.toggles);
  for (const patch of [{ accountId: 'other', tokenOff: [] }, { siteRules: {} }, { allowedSites: [] }, { notificationPreview: 'yes' }, { sitesChosen: true },
    ...[undefined, null, {}, { share: true }, { share: 'yes', interact: false }, { share: true, interact: false, extra: true }].map(web => ({ web })),
    ...['https://x.com', '*.x.com', 'printer.local', ''].map(host => ({ tokenOff: [host] })), { tokenOff: 'x.com' }, { restoreSites: ['x.com', 'bad host'] }]) {
    await assert.rejects(value.execute({ name: 'preferences', payload: { accountId: 'self', ...patch } }), error => !['ReferenceError', 'TypeError'].includes(error?.name), JSON.stringify(patch));
  }
  for (const payload of [{ share: 'yes' }, { interact: 1 }]) await assert.rejects(toggle(value, payload), error => !['ReferenceError', 'TypeError'].includes(error?.name), JSON.stringify(payload));
  assert.deepEqual(plain(value.state.preferences), before); assert.deepEqual(plain(value.state.toggles), toggles); assert.equal(stored.size, 0);
  await save(value, { notificationPreview: false, hiddenStickies: ['saved'] });
  assert.equal(stored.get('self:preferences').notificationPreview, false);
  assert.deepEqual(plain(stored.get('self:preferences').hiddenStickies), ['saved']);
});

test('one command sets several token-data hosts, normalised and deduplicated', async () => {
  const { value, stored } = fixture();
  await save(value, { tokenOff: ['gmgn.ai', 'Axiom.Trade', 'axiom.trade.'] });
  assert.deepEqual(plain(value.state.preferences.tokenOff), ['gmgn.ai', 'axiom.trade']);
  assert.deepEqual(plain(stored.get('self:preferences').tokenOff), plain(value.state.preferences.tokenOff));
});

test('switching 共享在看 off clears local and remote viewing at once', async () => {
  const { value } = fixture();
  let cleared = 0; value.clearRemoteViewing = async () => { cleared++; };
  await toggle(value, { share: false });
  assert.equal(value.page, undefined); assert.equal(cleared, 1);
  assert.equal(value.state.notice, undefined);
});

test('a switch turns on only while its feature is 启用; interaction also needs one 互动选项', async () => {
  const { value } = fixture();
  assert.deepEqual(plain(await toggle(value, { interact: true })), { share: true, interact: true });
  await save(value, { interaction: { signal: false, sticky: false } });
  assert.equal(value.state.toggles.interact, false, 'turning every 互动选项 off switches 网页互动 off');
  assert.deepEqual(plain(await toggle(value, { interact: true })), { share: true, interact: false });
  await save(value, { web: { share: false, interact: true } });
  assert.deepEqual(plain(await toggle(value, { share: true })), { share: false, interact: false });
});

test('Chrome revoking the tabs permission switches sharing off with a notice, once', async () => {
  const { value } = fixture();
  await toggle(value, { share: false, revoked: true });
  assert.equal(value.state.toggles.share, false); assert.equal(value.page, undefined);
  assert.equal(value.state.notice.key, 'extension.share.revoked');
  value.state.notice = undefined;
  await toggle(value, { share: false, revoked: true });
  assert.equal(value.state.notice, undefined, 'already off: nothing to report');
});


test('网页互动 persists per account while 共享在看 is never persisted', async () => {
  const { value, stored } = fixture();
  await toggle(value, { interact: true });
  assert.deepEqual(plain(stored.get('self:toggles')), { interact: true });
  value.state.toggles = { share: false, interact: false }; await value.restoreToggles();
  assert.deepEqual(plain(value.state.toggles), { share: false, interact: true });
  value.session = { account: { id: 'other' } }; value.state.toggles = { share: false, interact: false }; await value.restoreToggles();
  assert.deepEqual(plain(value.state.toggles), { share: false, interact: false });
  await toggle(value, { share: true }); assert.equal(stored.has('other:toggles'), false);
});

test('persisted interaction turns off when disabled and failed switch writes roll back', async () => {
  const { value, stored } = fixture(); await toggle(value, { interact: true });
  await save(value, { web: { share: true, interact: false } });
  assert.deepEqual(plain(stored.get('self:toggles')), { interact: false });
  await save(value, { web: { share: true, interact: true } });
  value.storage.put = async () => { throw Error('disk full'); };
  await assert.rejects(toggle(value, { interact: true }), /disk full/); assert.equal(value.state.toggles.interact, false);
});

test('queued interaction toggles keep newest intent and cannot write into a replacement account', async () => {
  const { value, stored } = fixture(), gate = deferred(); let writes = 0; const put = value.storage.put;
  value.storage.put = async (...args) => { if (++writes === 1) await gate.promise; return put(...args); };
  const on = toggle(value, { interact: true }); await tick(); const off = toggle(value, { interact: false }); await tick();
  gate.resolve(); await Promise.all([on, off]); assert.deepEqual(plain(stored.get('self:toggles')), { interact: false });
  value.scope = () => { const session = value.session; return sessionScope(() => session === value.session, () => Error('session changed')); };
  const queued = deferred(); value.togglesQueue = queued.promise;
  const pending = assert.rejects(toggle(value, { interact: true }), /session changed/); await tick(); value.session = { account: { id: 'new' } }; value.state.toggles = { share: false, interact: false };
  queued.resolve(); await pending; assert.equal(stored.has('new:toggles'), false); assert.equal(value.state.toggles.interact, false);
});
