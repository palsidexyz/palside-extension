import test from 'node:test';
import assert from 'node:assert/strict';
import { createTabObserver } from '../apps/extension/src/runtime/browser/tab-observer.ts';
const delay = () => new Promise(resolve => setTimeout(resolve, 25));
function fixture() {
  const calls = { reads: 0, clears: 0, published: [], activity: 0 };
  const state = { policy: { key: 'account:team' }, page: { tabId: 1, windowId: 1, url: 'https://x.com/post/1?utm_source=secret' } };
  const host = { policy: () => state.policy, activePage: async () => { calls.reads++; return state.page; }, clear: async () => { calls.clears++; }, publish: async identity => calls.published.push(identity), activity: async () => { calls.activity++; } };
  const observer = createTabObserver(host, 5);
  return { calls, state, observer, host };
}
test('observer never reads tabs when disabled; a website shares its page without tracking', async () => {
  const { calls, state, observer } = fixture();
  const policy = state.policy; state.policy = undefined; await observer.refresh(true); await delay();
  assert.equal(calls.reads,0); assert.equal(calls.activity,0);
  state.policy = policy; await observer.refresh(true); await delay();
  assert.equal(calls.published.length,1); assert.equal(calls.published[0].url,'https://x.com/post/1'); assert.equal(calls.activity,1);
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
test('a link with credentials shares its site only; non-public pages and account changes are rejected', async () => {
  const { calls, state, observer } = fixture();
  for(const url of ['https://x.com/home','https://neo.bullx.io/portfolio','https://news.example.org/private/article?secret=yes','chrome://settings']) {
    state.page.url=url; await observer.refresh(true); await delay();
  }
  state.page.url='https://x.com'; await observer.refresh(); state.policy.key='other-account'; await delay();
  assert.equal(calls.published.length,3); assert.equal(calls.activity,3); assert.deepEqual(calls.published.map(page=>page.url),['https://x.com/home','https://neo.bullx.io/portfolio','https://news.example.org']); observer.dispose();
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
test('a title that changes while the page loads belongs to the new page; the address standing in for one does not',async()=>{
  const {state,observer,host}=fixture();const sent=[];host.publish=async(identity,page)=>{sent.push(page.title);};
  state.page={...state.page,loading:true,title:'Previous page'};await observer.refresh();await delay();
  assert.deepEqual(sent,[undefined]);
  state.page={...state.page,loading:true,title:'x.com/post/1'};await observer.refresh();await delay();
  assert.deepEqual(sent,[undefined]);
  state.page={...state.page,loading:true,title:'Real title'};await observer.refresh();await delay();
  assert.deepEqual(sent,[undefined,'Real title']);observer.dispose();
});
test('an icon that reaches Chrome after the title is republished, and an unchanged one is not',async()=>{
  const {state,observer,host}=fixture();const sent=[];host.publish=async(identity,page)=>{sent.push(page.favicon);};
  state.page={...state.page,title:'Page'};await observer.refresh();await delay();
  await observer.refresh();await delay();
  assert.deepEqual(sent,[undefined]);
  state.page={...state.page,favicon:'data:image/webp;base64,AA'};await observer.refresh();await delay();
  await observer.refresh();await delay();
  assert.deepEqual(sent,[undefined,'data:image/webp;base64,AA']);observer.dispose();
});
test('a loading page publishes at once without its possibly stale title, then republishes once the title arrives',async()=>{
  const {calls,state,observer,host}=fixture();const sent=[];host.publish=async(identity,page)=>{calls.published.push(identity);sent.push(page.title);};
  state.page={...state.page,loading:true,title:'Previous page'};await observer.refresh();await delay();
  assert.equal(calls.published.length,1);assert.equal(sent[0],undefined);
  state.page={...state.page,loading:false,title:'Real title'};await observer.refresh();await observer.refresh();await delay();
  assert.equal(calls.published.length,2);assert.equal(sent[1],'Real title');observer.dispose();
});
test('a replay re-sends the same page to a new runtime without clearing it',async()=>{
  const {calls,observer}=fixture();await observer.refresh(true);await delay();const clears=calls.clears;
  await observer.replay();await delay();
  assert.equal(calls.published.length,2);assert.equal(calls.clears,clears);observer.dispose();
});
