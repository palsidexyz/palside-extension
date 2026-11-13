import { productionModules } from './helpers/production-module.mjs';
import * as contractLimits0 from '../packages/shared/src/rules/teams.ts';
import * as contractLimits1 from '../packages/shared/src/rules/retention.ts';
import * as contractLimits2 from '../packages/shared/src/rules/accounts.ts';
import * as contractLimits3 from '../packages/shared/src/rules/messages.ts';
import * as contractLimits4 from '../packages/shared/src/rules/media.ts';
import * as contractLimits5 from '../packages/shared/src/rules/rooms.ts';
import * as contractLimits6 from '../packages/shared/src/rules/interactions.ts';
import * as contractLimits7 from '../packages/shared/src/rules/admin.ts';
const contractLimits = { ...contractLimits0, ...contractLimits1, ...contractLimits2, ...contractLimits3, ...contractLimits4, ...contractLimits5, ...contractLimits6, ...contractLimits7 };
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
import { TokenProfiles } from '../apps/extension/src/runtime/viewing/token-profiles.ts';
import { readFavorites, readSiteInteractions } from '../apps/extension/src/domain/annotations/interaction.ts';

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));
const context = { ...languageGlobals, ...contractLimits, ...contractCommon, readFavorites, readSiteInteractions, startedTeams, sharingWork, clearTimeout, URL, trustedDeviceMessages, teamSendGuard };
const load = productionModules(context);
const { SharingRuntime } = load('apps/extension/src/runtime/viewing/sharing.ts');
const { RuntimeCommands } = load('apps/extension/src/runtime/composition/dispatch.ts');
function fixture() {
  const value = new SharingRuntime(undefined);
  value.execute = RuntimeCommands.prototype.execute;
  value.runtime = value; value.auth = value; value.sharing = value; value.dispatch = value; value.tokens = new TokenProfiles();
  value.scope = () => sessionScope(() => true, () => Error('session changed'));
  const requests=[]; const stored=new Map(); const snapshots=[];
  value.state={account:{}, preferences:{current:'team',share:true,siteInteraction:{'x.com':{on:true}},notifications:'off'}, remoteTeams:[{id:'team',joined:true,people:[{id:'self',matrixId:'@self'}],memberIds:['self']}],data:{teams:[]}};
  value.requireConnection=()=>{}; value.preloadHistory=async()=>{}; value.signals={ serviceNow: () => Date.now(), toLocal: time => time };
  value.initialise=async()=>{};value.preferencesQueue=Promise.resolve();
  value.rooms={preferencesChanged:async()=>{}};
  value.pageObservation=0;value.viewingSequence=0;value.viewingOrder=1;
  value.session={account:{id:'self'},matrix:{}}; value.emit=()=>snapshots.push(structuredClone(value.state));
  value.expireViewing=()=>value.emit();value.mayObserve=()=>Boolean(value.state.preferences.share);value.foreground=async()=>true;value.clearRemoteViewing=async()=>{};
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
  assert.deepEqual(plain(await value.execute({name:'toggle',payload:{share:false}})),{share:false});
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
  value.state.preferences={forgottenTeams:['x.com']};const old=value.savePreferences();await tick();
  value.state.preferences={forgottenTeams:[]};const latest=value.savePreferences();await tick();
  assert.deepEqual(value.state.preferences.forgottenTeams,[]);assert.equal(writes.length,1);
  first.resolve();await Promise.all([old,latest]);assert.deepEqual(writes.map(p=>p.forgottenTeams),[['x.com'],[]]);assert.deepEqual(value.persistedPreferences.forgottenTeams,[]);
});

test('turning 网页互动 off for a site leaves independent shared viewing active',async()=>{
  const {value}=fixture();value.initialise=async()=>{};value.preferencesQueue=Promise.resolve();
  const disk=deferred();value.storage.put=()=>disk.promise;let cleared=0;value.clearRemoteViewing=async()=>{cleared++;};
  const pending=save(value, { siteInteraction: { 'x.com': { on: false } } });await tick();
  assert.equal(value.page.id,'page');assert.equal(cleared,0);assert.equal(value.state.preferences.siteInteraction['x.com'].on,false);
  disk.resolve();await pending;
});

const save = (value, patch) => value.execute({ name: 'preferences', payload: { accountId: 'self', ...patch } });
const toggle = (value, payload) => value.execute({ name: 'toggle', payload });

test('concurrent preference saves apply in order over the latest preferences and wait for their own ordered writes', async () => {
  const { value, stored } = fixture(); const disk = deferred(); const writes = []; const put = value.storage.put;
  value.storage.put = async (...args) => { writes.push(structuredClone(args[3])); if (writes.length === 1) await disk.promise; return put(...args); };
  let settled = false;
  const first = save(value, { forgottenTeams: ['example.com'] }).then(() => { settled = true; }); await tick();
  const second = save(value, { forgottenTeams: ['example.com', 'other.com'] });
  await tick();
  assert.equal(settled, false); assert.equal(writes.length, 1);
  assert.deepEqual(plain(value.state.preferences.forgottenTeams), ['example.com', 'other.com']);
  disk.resolve(); await Promise.all([first, second]);
  assert.equal(writes.length, 2);
  assert.deepEqual(plain(writes.map(row => row.forgottenTeams)), [['example.com'], ['example.com', 'other.com']]);
  assert.deepEqual(plain(stored.get('self:preferences')), plain(value.state.preferences));
});

test('latest failed preference write rolls back to the last committed value without resurrecting revoked viewing', async () => {
  const { value } = fixture();
  value.clearRemoteViewing = async () => {};
  await save(value, { siteInteraction: { 'x.com': { signal: false } } });
  value.storage.put = async () => { throw Error('disk full'); };
  await assert.rejects(save(value, { siteInteraction: { 'x.com': { danmaku: false } } }), /disk full/);
  assert.deepEqual(plain(value.state.preferences.siteInteraction), { 'x.com': { on: true, danmaku: true, signal: false, chart: true } });
  assert.equal(value.state.preferences.share, true);
});

test('older failed write cannot rewind a newer intent and later writes remain usable', async () => {
  const { value, stored } = fixture(); const first = deferred(); const put = value.storage.put; let count = 0;
  value.storage.put = async (...args) => { if (++count === 1) await first.promise; return put(...args); };
  const older = assert.rejects(save(value, { forgottenTeams: ['example.com'] }), /disk full/); await tick();
  const newer = save(value, { forgottenTeams: ['example.com', 'x.com'] }); await tick();
  first.reject(Error('disk full')); await Promise.all([older, newer]);
  assert.deepEqual(plain(value.state.preferences.forgottenTeams), ['example.com', 'x.com']);
  assert.deepEqual(plain(stored.get('self:preferences').forgottenTeams), plain(value.state.preferences.forgottenTeams));
});

test('failed newest write retains the earlier successful update even when both were submitted together', async () => {
  const { value } = fixture(); const disk = deferred(); let writes = 0;
  value.storage.put = async () => { if (++writes === 1) await disk.promise; else throw Error('disk full'); };
  const earlier = save(value, { forgottenTeams: ['example.com'] }); await tick();
  const latest = assert.rejects(save(value, { forgottenTeams: [] }), /disk full/); await tick();
  disk.resolve(); await Promise.all([earlier, latest]);
  assert.deepEqual(plain(value.state.preferences.forgottenTeams), ['example.com']);
});

test('queued preference writes from an old session cannot overwrite the replacement account or its state', async () => {
  const { value, stored } = fixture(); const queue = deferred();
  value.preferencesQueue = queue.promise;
  value.scope = () => { const session = value.session; return sessionScope(() => value.session === session, () => Error('session changed')); };
  const pending = assert.rejects(save(value, { forgottenTeams: ['example.com'] }), /session changed/); await tick();
  value.session = { account: { id: 'replacement' } };
  const replacement = { current: 'new', share: true, siteInteraction: { 'x.com': { on: false } }, notifications: 'off' };
  value.state.preferences = replacement;
  queue.resolve(); await pending;
  assert.equal(stored.size, 0); assert.equal(value.state.preferences, replacement);
});

test('preference and switch commands validate account and every field before mutating state', async () => {
  const { value, stored } = fixture(); const before = plain(value.state.preferences);
  for (const patch of [{ accountId: 'other', forgottenTeams: [] }, { siteRules: {} }, { allowedSites: [] }, { notificationPreview: 'yes' }, { sitesChosen: true },
    ...[undefined, null, [], { 'https://x.com': { on: true } }, { 'x.com': { signal: 'yes' } }, { 'x.com': { on: true, extra: true } }].map(siteInteraction => ({ siteInteraction })),
    { tokenOff: ['x.com'] }, { forgottenTeams: 'x' }]) {
    await assert.rejects(value.execute({ name: 'preferences', payload: { accountId: 'self', ...patch } }), error => !['ReferenceError', 'TypeError'].includes(error?.name), JSON.stringify(patch));
  }
  for (const payload of [{ share: 'yes' }, { interact: 1 }]) await assert.rejects(toggle(value, payload), error => !['ReferenceError', 'TypeError'].includes(error?.name), JSON.stringify(payload));
  assert.deepEqual(plain(value.state.preferences), before); assert.equal(stored.size, 0);
  await save(value, { notificationPreview: false, forgottenTeams: ['saved'] });
  assert.equal(stored.get('self:preferences').notificationPreview, false);
  assert.deepEqual(plain(stored.get('self:preferences').forgottenTeams), ['saved']);
});

test('switching 共享在看 off clears local and remote viewing at once', async () => {
  const { value } = fixture();
  let cleared = 0; value.clearRemoteViewing = async () => { cleared++; };
  await toggle(value, { share: false });
  assert.equal(value.page, undefined); assert.equal(cleared, 1);
  assert.equal(value.state.notice, undefined);
});

test('共享在看 can turn on independently of a site 网页互动 setting', async () => {
  const { value } = fixture();
  await save(value, { siteInteraction: { 'x.com': { on: false } } });
  assert.deepEqual(plain(await toggle(value, { share: true })), { share: true });
});

test('Chrome revoking the tabs permission switches sharing off with a notice, once', async () => {
  const { value } = fixture();
  await toggle(value, { share: false, revoked: true });
  assert.equal(value.state.preferences.share, false); assert.equal(value.page, undefined);
  assert.equal(value.state.notice.key, 'extension.share.revoked');
  value.state.notice = undefined;
  await toggle(value, { share: false, revoked: true });
  assert.equal(value.state.notice, undefined, 'already off: nothing to report');
});
