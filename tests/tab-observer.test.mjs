import test from 'node:test';
import assert from 'node:assert/strict';
import { createTabObserver } from '../apps/extension/src/runtime/browser/tab-observer.ts';
const delay = () => new Promise(resolve => setTimeout(resolve, 25));
function fixture() {
  const calls = { reads: 0, clears: 0, published: [], activity: 0 };
  const state = { policy: { key: 'account:team' }, page: { tabId: 1, windowId: 1, url: 'https://x.com/post/private?tracking=secret' } };
  const host = { policy: () => state.policy, activePage: async () => { calls.reads++; return state.page; }, clear: async () => { calls.clears++; }, publish: async identity => calls.published.push(identity), activity: async () => { calls.activity++; } };
  const observer = createTabObserver(host, 5);
  return { calls, state, observer, host };
}
test('observer never reads tabs when disabled; website sharing strips title, path and query', async () => {
  const { calls, state, observer } = fixture();
  const policy = state.policy; state.policy = undefined; await observer.refresh(true); await delay();
  assert.equal(calls.reads,0); assert.equal(calls.activity,0);
  state.policy = policy; await observer.refresh(true); await delay();
  assert.equal(calls.published.length,1); assert.equal(calls.published[0].url,'https://x.com'); assert.equal(calls.activity,1);
  observer.dispose();
});
test('pause, closed sidepanel and stale Chrome responses cannot publish a previous page', async () => {
  const { calls, state, observer, host } = fixture();
  let resolve; host.activePage = () => new Promise(done => { resolve = done; });
  const first = observer.refresh(true); state.policy = undefined; await observer.refresh();
  resolve(state.page); await first; await delay(); assert.equal(calls.published.length,0);
  observer.dispose();
});
test('fast navigation publishes only the final active tab and rechecks it after settling', async () => {
  const { calls, state, observer } = fixture();
  await observer.refresh(true);
  state.page = { ...state.page, tabId:2, url:'https://neo.bullx.io/terminal?chainId=1399811149&address=So11111111111111111111111111111111111111112&ref=secret' };
  await observer.refresh(true); await delay();
  assert.equal(calls.published.length,1); assert.equal(calls.published[0].kind,'asset'); assert.equal(new URL(calls.published[0].url).searchParams.has('ref'),false);
  await observer.refresh(); state.page = undefined; await delay(); assert.equal(calls.published.length,1);
  observer.dispose();
});
test('account pages share only site identity on every public host; non-public pages and account changes are rejected', async () => {
  const { calls, state, observer } = fixture();
  for(const url of ['https://x.com/messages/123','https://neo.bullx.io/portfolio','https://news.example.org/private/article?secret=yes','chrome://settings']) {
    state.page.url=url; await observer.refresh(true); await delay();
  }
  state.page.url='https://x.com'; await observer.refresh(); state.policy.key='other-account'; await delay();
  assert.equal(calls.published.length,3); assert.equal(calls.activity,3); assert.deepEqual(calls.published.map(page=>page.url),['https://x.com','https://neo.bullx.io','https://news.example.org']); observer.dispose();
});

test('duplicate completion notifications preserve a pending timer and published object', async () => {
  const { calls, observer } = fixture();
  await observer.refresh(true); const clears=calls.clears;
  await observer.refresh(false,true);await observer.refresh(false,true);await delay();
  assert.equal(calls.published.length,1);assert.equal(calls.clears,clears);
  await observer.refresh(false,true);await delay();assert.equal(calls.published.length,1);assert.equal(calls.clears,clears);observer.dispose();
});
test('a policy change within the same context preserves sharing, but turning it off clears immediately',async()=>{
  const {calls,state,observer}=fixture();state.policy.context='same-team';await observer.refresh(true);await delay();
  const clears=calls.clears;state.policy={...state.policy,key:'changed'};
  await observer.refresh(false,true);await delay();assert.equal(calls.clears,clears);assert.equal(calls.published.length,1);
  state.policy=undefined;await observer.refresh(false,true);assert.ok(calls.clears>clears);observer.dispose();
});
test('device coordination failure exposes a recoverable result and cannot publish',async()=>{
  const {calls,host,observer}=fixture();let failures=0;host.activity=async()=>{throw Error('offline');};host.failed=async()=>{failures++;};
  await observer.refresh(true);await delay();assert.equal(failures,1);assert.equal(calls.published.length,0);observer.dispose();
});
test('page loading keeps preparation active and completion starts only one stable observation',async()=>{
  const {calls,state,observer,host}=fixture();const progress=[];host.clear=async preparing=>{calls.clears++;progress.push(preparing);};
  state.page.loading=true;await observer.refresh();await delay();assert.equal(calls.published.length,0);assert.equal(progress.at(-1),true);
  state.page.loading=false;await observer.refresh(false,true);await observer.refresh(false,true);await delay();assert.equal(calls.published.length,1);observer.dispose();
});
test('a transient loading state after completion recovers without another Chrome update event',async()=>{
  const {calls,state,observer}=fixture();
  await observer.refresh(true);state.page.loading=true;await delay();
  assert.equal(calls.published.length,0);
  state.page.loading=false;await delay();
  assert.equal(calls.published.length,1);assert.equal(calls.activity,1);observer.dispose();
});
test('loading checks are bounded and pause cancels a pending recheck',async t=>{
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const {calls,state,observer,host}=fixture();let failed=0;host.failed=async()=>{failed++;};
  t.after(()=>observer.dispose());
  const tick=async ms=>{t.mock.timers.tick(ms);await new Promise(resolve=>setImmediate(resolve));};
  state.page.loading=true;await observer.refresh(true);
  // Advance each scheduled retry after its asynchronous page read has completed.
  // A wall-clock sleep can expire before all twelve retries on a busy machine.
  for(let check=0;check<12;check++)await tick(5);
  assert.equal(calls.published.length,0);assert.equal(failed,1);const reads=calls.reads;
  assert.equal(reads,13);
  await tick(100);assert.equal(calls.reads,reads);
  await observer.refresh();state.policy=undefined;await observer.refresh();state.page.loading=false;
  await tick(100);assert.equal(calls.published.length,0);
});
