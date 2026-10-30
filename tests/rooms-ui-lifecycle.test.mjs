import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const root = 'apps/extension/src/features/palside/';
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const drain = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const nodes = (tree, check) => !tree || typeof tree !== 'object' ? [] : [...(check(tree) ? [tree] : []), ...(tree.props?.children ?? []).flat(Infinity).flatMap(child => nodes(child, check))];
const find = (tree, type) => nodes(tree, node => node.type === type || node.type?.name === type)[0];
const button = (tree, text) => nodes(tree, node => node.props?.children?.includes(text))[0];

// Execute complete feature modules with the same hook/host boundary used by composer tests.
function fixture() {
  let running;
  const react = {
    useState(initial) {
      const host = running, index = host.index++;
      if (!(index in host.slots)) host.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [host.slots[index], value => { const next = typeof value === 'function' ? value(host.slots[index]) : value; if (!Object.is(next, host.slots[index])) { host.slots[index] = next; host.dirty = true; } }];
    },
    useRef(initial) { const host = running, index = host.index++; return host.slots[index] ??= { current: initial }; },
    useEffect(effect, deps) {
      const host = running, index = host.index++, previous = host.slots[index];
      if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) {
        host.effects.push(() => { previous?.cleanup?.(); host.slots[index] = { deps, cleanup: effect() }; });
      }
    },
    useSyncExternalStore(subscribe, snapshot) {
      const host = running;
      react.useEffect(() => subscribe(() => { host.dirty = true; }), [subscribe]);
      return snapshot();
    },
    useId: () => 'id',
  };
  react.useLayoutEffect = react.useEffect;
  const social = {}, frames = [], modules = new Map();
  const jsx = (type, props, key) => ({ type, key, props: { ...props, children: [props?.children].flat(Infinity).filter(child => child != null && child !== false) } });
  const stubs = {
    useTranslations: () => key => key, useLocale: () => 'en', useReducedMotion: () => true,
    motion: { span: 'motion.span' }, useSocialUi: () => social, setSocialUi: patch => Object.assign(social, patch),
    message: key => key, errorMessage: error => error.message, characterLength: text => [...text].length,
    ROOM_TEXT_MAX: 200, TEAM_MEMBER_LIMIT: 30, viewAsset: view => view?.id,
    capability: () => ({ state: 'on' }), accountLabel: id => id,
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const extra = file === 'rooms/danmaku-view.tsx' ? '\nexport { LineMenu, RoomBar, InviteChoices, showPerson };' : '';
    const source = ts.transpileModule(readFileSync(root + file, 'utf8') + extra, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const exports = {};
    modules.set(file, exports);
    const require = name => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      if (name === './rooms' || name === '../rooms/rooms') return load('rooms/rooms.ts');
      return new Proxy({ __esModule: true, default: new Proxy({}, { get: (_, key) => key }) }, { get: (target, key) => key in target ? target[key] : stubs[key] ?? key });
    };
    vm.runInNewContext(`(function(require, exports) { ${source}\n})`, { console, Map, Set, WeakMap, Date, JSON, setInterval, clearInterval, requestAnimationFrame: callback => frames.push(callback), document: { querySelector: () => ({ focus() {} }) } })(require, exports);
    return exports;
  }
  function mount(component) {
    const host = { slots: [], effects: [], dirty: true, index: 0 };
    return {
      render(props) {
        let tree, count = 0;
        do {
          assert.ok(count++ < 20, 'render settles'); host.dirty = false; host.index = 0; running = host;
          tree = component(props); running = undefined;
          for (const effect of host.effects.splice(0)) effect();
        } while (host.dirty);
        return tree;
      },
      unmount() { for (const slot of host.slots) slot?.cleanup?.(); },
    };
  }
  return { load, mount, social, frames };
}
function controller() {
  const calls = [], pending = [];
  const rooms = { summaries: {}, blocked: [], invites: [], avatars: {} };
  const c = {
    data: { self: 'self', views: [{ id: 'Ethereum:token', name: 'Token', url: 'https://example.test/token' }] },
    people: [], teams: [], team: { joined: true }, current: 'team', screen: 'chat', draft: { text: '' }, canWrite: true, web: { interact: true },
    setPersonId() {}, ownsScreen: () => true, setNotice: notice => calls.push(['notice', notice]), updateDraft: draft => calls.push(['draft', draft]),
    go: screen => { calls.push(['go', screen]); c.screen = screen; },
    live: { state: { authenticated: true, account: { id: 'self' }, preferences: {}, rooms, remoteTeams: [] }, command: (name, payload) => { calls.push([name, payload]); const job = deferred(); pending.push({ name, ...job }); return job.promise; } },
  };
  c.run = (name, payload) => c.live.command(name, payload);
  return { c, rooms, calls, pending, take: name => pending.findLast(item => item.name === name) };
}

test('opening waits for the requested pinned snapshot; departure and replacement invalidate delayed results', async () => {
  const f = fixture(), { c, rooms, calls, take } = controller(), api = f.load('rooms/rooms.ts');
  const view = f.mount(f.load('rooms/danmaku-view.tsx').DanmakuView);
  view.render({ c });
  api.openRoom(c, 'token:Ethereum:a');
  let tree = view.render({ c });
  assert.equal(c.screen, 'room');
  assert.equal(find(tree, 'RoomHead').props.roomKey, 'token:Ethereum:a');
  take('room-open').resolve(); await drain(); view.render({ c });
  assert.equal(c.screen, 'room', 'command completion alone is not a snapshot');
  rooms.pinned = 'token:Ethereum:old'; view.render({ c });
  assert.equal(find(view.render({ c }), 'RoomHead').props.roomKey, 'token:Ethereum:a');
  rooms.pinned = 'token:Ethereum:a'; view.render({ c });
  api.openRoom(c, 'token:Ethereum:b'); const b = take('room-open');
  api.openRoom(c, 'token:Ethereum:c'); b.reject(new Error('late')); await drain();
  tree = view.render({ c }); assert.equal(find(tree, 'InlineFeedback'), undefined);
  assert.equal(find(tree, 'RoomHead').props.roomKey, 'token:Ethereum:c');
  c.go('hot'); view.render({ c }); take('room-open').reject(new Error('late')); await drain();
  rooms.pinned = 'token:Ethereum:c'; assert.equal(view.render({ c }), null); assert.equal(c.screen, 'hot');
  assert.equal(calls.some(call => call[0] === 'go' && call[1] === 'chat'), false);
  view.unmount();
});

test('opening failure shows existing feedback and retry; panel unmount cancels completion', async () => {
  const f = fixture(), { c, take } = controller(), api = f.load('rooms/rooms.ts');
  const view = f.mount(f.load('rooms/danmaku-view.tsx').DanmakuView);
  view.render({ c }); api.openRoom(c, 'token:Ethereum:a'); view.render({ c });
  take('room-open').reject(new Error('offline')); await drain();
  const feedback = find(view.render({ c }), 'InlineFeedback'); assert.ok(feedback);
  feedback.props.action.onClick(); assert.equal(find(view.render({ c }), 'InlineFeedback'), undefined);
  view.unmount(); take('room-open').reject(new Error('closed')); await drain();
  assert.equal(f.mount(api.useRoomOpening).render(c), undefined);
});

for (const kind of ['people', 'summary', 'blocks', 'invites', 'hot']) test(`${kind} read exposes failure/retry, ignores late results, and keeps snapshot data`, async () => {
  const f = fixture(), { c, rooms, calls, take } = controller(), { useRoomRead } = f.load('rooms/rooms.ts');
  const name = { people: 'room-people', summary: 'room-summary', blocks: 'room-blocks', invites: 'invite-list', hot: 'room-hot' }[kind];
  const verified = { people: [{ id: 'friend' }], key: 'a' }; rooms.people = verified;
  const hook = f.mount(({ key }) => useRoomRead(c, kind, key));
  assert.equal(hook.render({ key: 'a' }).status, 'loading');
  if (take('room-watch')) { take('room-watch').resolve(); await drain(); }
  take(name).reject(new Error('failed')); await drain();
  let read = hook.render({ key: 'a' }); assert.equal(read.status, 'error'); assert.equal(rooms.people, verified);
  read.retry(); assert.equal(hook.render({ key: 'a' }).status, 'loading');
  if (take('room-watch')) { take('room-watch').resolve(); await drain(); }
  take(name).resolve({}); if (kind === 'hot') rooms.hot = { a: { top: [], rising: [] } }; await drain();
  assert.equal(hook.render({ key: 'a' }).status, 'success');
  const before = calls.length; hook.render({ key: 'a' }); assert.equal(calls.length, before, 'unrelated render does not resubscribe');
  hook.render({ key: 'b' }); const old = take(name);
  c.data = { ...c.data, self: 'other' }; hook.render({ key: 'c' });
  old.reject(new Error('late response')); await drain(); assert.equal(hook.render({ key: 'c' }).status, 'loading');
  hook.unmount();
});

test('people, blocks, invites and Hot show retry without replacing verified rows', () => {
  const f = fixture(), { c, rooms } = controller(), api = f.load('rooms/rooms.ts');
  let retries = 0; api.useRoomRead = () => ({ status: 'error', retry: () => retries++ });
  rooms.pinned = 'token:Ethereum:token';
  rooms.people = { key: rooms.pinned, people: [{ id: 'friend', nickname: 'Friend' }], count: 1 };
  rooms.blocked = rooms.people.people;
  rooms.invites = [{ id: 'invite' }];
  rooms.hot = { '': { rising: [{ key: 'room' }], top: [] } };
  for (const [file, name] of [['rooms/danmaku-view.tsx', 'RoomPeople'], ['rooms/danmaku-view.tsx', 'BlockedPeople'], ['teams/invites.tsx', 'ReceivedInvites'], ['rooms/hot.tsx', 'Hot']]) {
    const tree = f.mount(f.load(file)[name]).render({ c });
    const feedback = find(tree, 'InlineFeedback'); assert.ok(feedback, name); feedback.props.action.onClick();
    assert.ok(nodes(tree, node => node.type !== 'InlineFeedback').length > 2, `${name} keeps content`);
  }
  assert.equal(retries, 4);
});

test('room quote completion closes only its originating navigation and keeps the original reference payload', async () => {
  for (const leave of ['none', 'new-room', 'same-room-reopened', 'hot', 'unmount']) {
    const f = fixture(), { c, rooms, calls, take } = controller(), api = f.load('rooms/rooms.ts');
    c.screen = 'room'; rooms.pinned = 'token:Ethereum:token'; rooms.current = { key: rooms.pinned, profile: null };
    const owner = f.mount(api.useRoomOpening); owner.render(c);
    const menu = f.mount(f.load('rooms/danmaku-view.tsx').LineMenu);
    const message = { id: 'line', text: 'whole line', author: { id: 'friend', nickname: 'Friend' }, createdAt: 123 };
    button(menu.render({ c, message, name: 'Friend', self: false }), 'extension.sticky.quote').props.onClick();
    assert.deepEqual(plain(calls.find(call => call[0] === 'attach-ref')), ['attach-ref', { teamId: 'team', url: 'https://example.test/token', target: { kind: 'danmaku', id: 'line', author: 'friend', name: 'Friend', at: 123 }, caption: 'whole line' }]);
    if (leave === 'new-room') { api.openRoom(c, 'token:Ethereum:new'); rooms.pinned = 'token:Ethereum:new'; owner.render(c); }
    if (leave === 'same-room-reopened') { api.openRoom(c, rooms.pinned); owner.render(c); }
    if (leave === 'hot') { c.go('hot'); owner.render(c); }
    if (leave === 'unmount') owner.unmount();
    take('attach-ref').resolve({}); await drain();
    assert.equal(calls.some(call => call[0] === 'room-close'), leave === 'none', leave);
    menu.unmount(); if (leave !== 'unmount') owner.unmount();
  }
});

test('room drafts survive screen/room visits, clear after successful send, and isolate accounts and panel mounts', async () => {
  const f = fixture(), { c, take } = controller(), api = f.load('rooms/rooms.ts'), { RoomBar } = f.load('rooms/danmaku-view.tsx');
  const owner = f.mount(api.useRoomDrafts); let drafts = owner.render('self');
  const room = { key: 'room-a', slowUntil: 0 };
  let bar = f.mount(RoomBar);
  find(bar.render({ c, room, drafts }), 'input').props.onChange({ target: { value: 'keep me' } });
  bar.unmount();
  assert.equal(owner.render('self'), drafts);
  bar = f.mount(RoomBar); let tree = bar.render({ c, room, drafts }); assert.equal(find(tree, 'input').props.value, 'keep me');
  find(tree, 'input').props.onKeyDown({ nativeEvent: {}, key: 'Enter', preventDefault() {} });
  take('room-send').resolve(undefined); await drain(); assert.equal(find(bar.render({ c, room, drafts }), 'input').props.value, 'keep me');
  find(bar.render({ c, room, drafts }), 'input').props.onKeyDown({ nativeEvent: {}, key: 'Enter', preventDefault() {} });
  bar.unmount(); bar = f.mount(RoomBar); tree = bar.render({ c, room, drafts });
  assert.equal(nodes(tree, node => node.props?.label === 'extension.copy.sendMessage')[0].props.disabled, true, 'pending send survives remount');
  take('room-send').resolve({ id: 'sent' }); await drain(); assert.equal(find(bar.render({ c, room, drafts }), 'input').props.value, '');
  find(bar.render({ c, room, drafts }), 'input').props.onChange({ target: { value: 'private' } });
  const other = f.mount(RoomBar); assert.equal(find(other.render({ c, room: { ...room, key: 'room-b' }, drafts }), 'input').props.value, ''); other.unmount();
  drafts = owner.render(''); assert.equal(drafts.values.size, 0);
  drafts = owner.render('self'); assert.equal(drafts.values.size, 0);
  assert.equal(f.mount(api.useRoomDrafts).render('self').values.size, 0);
  bar.unmount(); owner.unmount();
});

test('invitation openings reset picks and send requires a current eligible option in the handler and button', async () => {
  const f = fixture(), { c, rooms, calls, take } = controller(), { InviteSheet, InviteChoices } = f.load('rooms/danmaku-view.tsx');
  rooms.people = { people: [{ id: 'friend', nickname: 'Friend' }] };
  c.teams = [{ id: 'team', joined: true, owner: 'self', name: 'Squad', memberIds: ['self'] }];
  f.social.invite = 'friend'; const sheet = f.mount(InviteSheet); assert.equal(sheet.render({ c }).type, InviteChoices);
  let choices = f.mount(InviteChoices); choices.render({ c, id: 'friend' });
  take('invite-options').resolve({ accepts: true, teams: [{ teamId: 'team', state: 'can' }] }); await drain();
  let tree = choices.render({ c, id: 'friend' }); find(tree, 'button').props.onClick();
  tree = choices.render({ c, id: 'friend' }); const send = button(tree, 'extension.invite.send'); assert.equal(send.props.disabled, false);
  c.teams = [{ ...c.teams[0], memberIds: Array.from({ length: 30 }, (_, i) => String(i)) }];
  tree = choices.render({ c, id: 'friend' }); assert.equal(button(tree, 'extension.invite.send').props.disabled, true);
  send.props.onClick(); assert.equal(calls.some(call => call[0] === 'invite-send'), false, 'retained handler also rejects invalid selection');
  take('invite-options').reject(new Error('offline')); await drain(); tree = choices.render({ c, id: 'friend' }); assert.ok(find(tree, 'InlineFeedback'));
  f.social.invite = undefined; assert.equal(sheet.render({ c }).props.id, undefined);
  assert.equal(choices.render({ c, id: undefined }).props.open, false);
  f.social.invite = 'friend'; tree = choices.render({ c, id: 'friend' }); assert.equal(button(tree, 'extension.invite.send').props.disabled, true);
  take('invite-options').resolve({ accepts: true, teams: [{ teamId: 'team', state: 'full' }] }); await drain(); tree = choices.render({ c, id: 'friend' }); assert.equal(button(tree, 'extension.invite.send').props.disabled, true);
  choices.unmount(); sheet.unmount();
});

test('a public-room teammate opens the room card with invitation, block and report actions', () => {
  const f = fixture(), { c, rooms } = controller(), api = f.load('rooms/danmaku-view.tsx');
  const person = { id: 'friend', name: 'Friend', mate: true }; c.people = [person]; c.teams = [{ joined: true, memberIds: ['friend'] }];
  rooms.people = { people: [{ id: 'friend', nickname: 'Friend' }] };
  api.showPerson(c, person, 'message'); assert.equal(f.social.roomPerson, 'friend');
  const tree = f.mount(api.RoomPersonSheet).render({ c });
  for (const key of ['extension.invite.action', 'extension.room.block', 'extension.copy.report']) assert.ok(button(tree, key));
});


test('closed invitation sheets and invitation inboxes remain empty without a live account', () => {
  const f = fixture(), { c } = controller(); c.live = undefined;
  const sheet = f.mount(f.load('rooms/danmaku-view.tsx').InviteChoices);
  assert.equal(sheet.render({ c }).props.open, false); sheet.unmount();
  const inbox = f.mount(f.load('teams/invites.tsx').ReceivedInvites);
  assert.equal(inbox.render({ c }), null); inbox.unmount();
});
