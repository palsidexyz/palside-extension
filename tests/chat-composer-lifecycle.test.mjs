import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { productionModules } from './helpers/production-module.mjs';
import * as model from '../apps/extension/src/domain/chat/model.ts';
import { ClientStorage } from '../apps/extension/src/runtime/storage/storage.ts';
import { indexedDb } from './helpers/indexed-db.mjs';
import { MessageError } from '../packages/i18n/src/core.ts';

const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const card = (id = 'a') => ({ kind: 'asset', assetId: id, view: { id, kind: 'website', url: `https://${id}.test`, name: id } });
const message = id => ({ id, teamId: 'team', author: 'self', text: id, status: 'sent' });
const load = productionModules({ message: key => key });
const liveActions = load('apps/extension/src/features/palside/chat/live-actions.ts').createLiveDraftActions;
const memoryActions = load('apps/extension/src/features/palside/chat/memory-actions.ts').createMemoryDraftActions;
const draftActions = load('apps/extension/src/features/palside/chat/use-drafts.ts').useDrafts;

// Execute the production declarations with deterministic React hooks and DOM boundaries.
function declarations(file, names) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return source.statements.filter(node => names.includes(node.name?.text) || ts.isVariableStatement(node) && node.declarationList.declarations.some(d => names.includes(d.name.getText(source))))
    .map(node => node.getText(source).replace(/^export /, '')).join('\n');
}
function host() {
  const slots = [], effects = [], timers = new Map();
  let cursor = 0, nextTimer = 0;
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, update => { slots[i].value = typeof update === 'function' ? update(slots[i].value) : update; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((dep, j) => !Object.is(dep, slots[i].deps[j]))) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++, old = slots[i]; if (!old || !deps || deps.some((dep, j) => !Object.is(dep, old.deps?.[j]))) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
    useLayoutEffect(fn, deps) { react.useEffect(fn, deps); },
  };
  return {
    react, timers,
    globals: { ...react, ...model, setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout(id) { timers.delete(id); } },
    render(fn) { cursor = 0; const result = fn(); for (const effect of effects.splice(0)) effect(); return result; },
    tick() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
function compile(source, name, globals) {
  const code = ts.transpileModule(`${source}\n${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'h', jsxFragmentFactory: 'Fragment' } }).outputText;
  return vm.runInNewContext(code, globals);
}
const composerFile = 'apps/extension/src/features/palside/chat/composer.tsx';
function linkFixture(initial = { text: 'https://a.test' }) {
  let draft = initial, h, hook;
  const requests = [], patches = [];
  const command = (_, payload) => { const request = deferred(); requests.push({ ...request, payload }); return request.promise; };
  function mount() { h = host(); hook = compile(declarations(composerFile, ['LINK', 'useLinkCard']), 'useLinkCard', h.globals); render(); }
  function update(patch) { patches.push(patch); draft = { ...draft, ...model.draftAttachmentPatch(draft, patch) }; }
  function render() { h.render(() => hook({ draft, current: 'team', data: { self: 'self' }, live: { command }, updateDraft: update })); }
  mount();
  return { requests, patches, render, update, get draft() { return draft; }, replace(value) { draft = value; render(); },
    remount() { h.unmount(); mount(); }, unmount() { h.unmount(); },
    async generate(id = 'a') { render(); h.tick(); requests.at(-1).resolve({ attachment: card(id) }); await settle(); render(); },
    tick() { h.tick(); },
  };
}

test('automatic-card provenance survives remount and removes only its generated attachment', async () => {
  const f = linkFixture(); await f.generate();
  assert.deepEqual(plain(f.draft.automaticCard), { url: 'https://a.test', assetId: 'a' });
  f.remount(); f.update({ text: '' }); f.render();
  assert.equal(f.draft.attachment, undefined);
  for (const replacement of [card('b'), card('a')]) {
    const manual = linkFixture(); await manual.generate();
    manual.update({ attachment: replacement }); manual.render(); manual.remount();
    manual.update({ text: '' }); manual.render();
    assert.deepEqual(manual.draft.attachment, replacement);
    assert.equal(manual.draft.automaticCard, undefined);
  }
  const mismatched = linkFixture({ text: '', attachment: card('b'), automaticCard: { url: 'https://a.test', assetId: 'a' } });
  assert.equal(mismatched.draft.attachment.assetId, 'b');
});

test('dismissed URLs persist for the draft across remounts and reset for a new draft', async () => {
  const f = linkFixture(); await f.generate();
  f.update({ attachment: undefined }); f.render(); f.remount(); f.tick();
  assert.equal(f.requests.length, 1);
  f.update({ text: 'https://b.test' }); await f.generate('b');
  f.update({ attachment: undefined }); f.render();
  assert.deepEqual(plain(f.draft.dismissedUrls), ['https://a.test', 'https://b.test']);
  f.update({ text: 'https://a.test' }); f.render(); f.tick();
  assert.equal(f.requests.length, 2);
  f.replace(model.emptyDraft); f.update({ text: 'https://a.test' }); await f.generate();
  assert.equal(f.requests.length, 3);
  assert.equal(f.draft.attachment.assetId, 'a');
});

test('late automatic lookups cannot replace a manual attachment or revive an unmounted draft', async () => {
  for (const interrupt of [f => { f.update({ attachment: card('b') }); f.render(); }, f => f.unmount(), f => f.replace(model.emptyDraft)]) {
    const f = linkFixture(); f.tick(); interrupt(f);
    f.requests[0].resolve({ attachment: card() }); await settle();
    assert.notEqual(f.draft.attachment?.assetId, 'a');
  }
});

function actionFixture(live = true) {
  const requests = [], navigation = [], notices = [];
  let active = true, confirmation;
  const state = {
    view: { current: 'team', data: { self: 'self', views: [] }, team: { id: 'team', name: 'Team', memberIds: [], joined: true }, teams: [], drafts: { team: { text: '' }, other: { text: 'other' } }, draft: { text: '' }, canWrite: true, disconnected: false, draftConflict: false, messages: [message('a'), message('b')],
      ownsScreen: () => active, setNotice: value => notices.push(value), setConfirmation: value => { confirmation = value; },
      setEditing(id) { state.view.editing = id; state.editSession.current = { id: state.editSession.current.id + 1, version: 0 }; },
      setEditText(text) { state.view.editText = text; state.editSession.current = { ...state.editSession.current, version: state.editSession.current.version + 1 }; },
      setMessages(update) { state.view.messages = update(state.view.messages); },
    },
    editSession: { current: { id: 0, version: 0 } }, editRevision: 0, setEditRevision(value) { state.editRevision = value; }, mounted: { current: true },
    draftVersions: { current: {} }, blockedDrafts: { current: new Set() }, draftConflicts: {}, draftRevisions: { current: {} }, draftQueue: { current: Promise.resolve() }, resolvingDrafts: { current: new Set() },
    setOptimisticDrafts() {}, setDraftConflicts() {}, setDrafts(update) { state.view.drafts = update(state.view.drafts); },
  };
  const command = (name, payload, retry) => { const pending = deferred(); requests.push({ name, payload, retry, ...pending }); return pending.promise; };
  if (live) state.view.live = { command, state: { drafts: { team: { revision: 3 } } } };
  const getActions = () => ({ guarded: command, go: to => navigation.push(to) });
  return { state, requests, navigation, notices, get confirmation() { return confirmation; },
    leave() { active = false; },
    actions() { return (live ? liveActions : memoryActions)(state, getActions); },
    edit(id) { draftActions(state, getActions).edit(state.view.messages.find(row => row.id === id)); },
  };
}

test('attachment completion writes the original account/team without navigating after departure', async () => {
  for (const outcome of [{ attached: true }, { requiresReplace: true, revision: 3 }]) {
    const f = actionFixture(); const attach = f.actions().attach;
    f.leave(); f.state.view.current = 'other';
    attach({ kind: 'image', src: 'data:original', name: 'image' });
    assert.equal(f.requests[0].payload.teamId, 'team');
    assert.equal(f.requests[0].payload.accountId, 'self');
    f.requests[0].resolve(outcome); await settle();
    assert.deepEqual(f.navigation, []); assert.equal(f.confirmation, undefined);
  }
  const f = actionFixture(); f.actions().attach(card()); f.requests[0].resolve({ attached: true }); await settle();
  assert.deepEqual(f.navigation, ['chat']);
});

test('confirmed attachment replacement cannot navigate after its context changes', async () => {
  const f = actionFixture(); f.actions().attach(card());
  f.requests[0].resolve({ requiresReplace: true, revision: 3 }); await settle();
  const completed = f.confirmation.confirm(); f.leave();
  assert.equal(f.requests[1].payload.revision, 3);
  f.requests[1].resolve({ attached: true }); await completed;
  assert.deepEqual(f.navigation, []);
});

test('memory attachments save to the initiating squad and respect screen ownership', () => {
  const f = actionFixture(false), attach = f.actions().attach;
  f.leave(); f.state.view.current = 'other';
  attach({ kind: 'image', src: 'data:original', name: 'image' });
  assert.equal(f.state.view.drafts.team.attachment.src, 'data:original');
  assert.equal(f.state.view.drafts.other.text, 'other');
  assert.deepEqual(f.navigation, []);
});

test('edit completion and retry belong to the submitted session and text version', async () => {
  for (const supersede of [f => f.edit('b'), f => f.edit('a'), f => f.state.view.setEditText('new text'), f => { f.state.mounted.current = false; }]) {
    const f = actionFixture(); f.edit('a'); f.actions().saveEdit(); supersede(f);
    const editing = f.state.view.editing;
    f.requests[0].retry(); assert.equal(f.requests.length, 1);
    f.requests[0].resolve({ done: true }); await settle();
    assert.equal(f.state.view.editing, editing);
  }
  const f = actionFixture(); f.edit('a'); f.actions().saveEdit(); f.requests[0].resolve({ done: true }); await settle();
  assert.equal(f.state.view.editing, undefined);
  const overlap = actionFixture(); overlap.edit('a'); overlap.actions().saveEdit(); overlap.edit('b'); overlap.actions().saveEdit();
  overlap.requests[0].resolve({ done: true }); await settle();
  assert.equal(overlap.state.view.editing, 'b');
  overlap.requests[1].resolve({ done: true }); await settle();
  assert.equal(overlap.state.view.editing, undefined);
});

test('edit actions reject recalled, missing and non-editable originals', () => {
  for (const live of [true, false]) for (const patch of [{ recalled: true }, { status: 'sending' }, { author: 'someone' }, { teamId: 'other' }]) {
    const f = actionFixture(live); f.edit('a'); Object.assign(f.state.view.messages[0], patch); f.actions().saveEdit();
    assert.equal(f.state.view.editing, undefined); assert.equal(f.requests.length, 0);
  }
  const f = actionFixture(); f.edit('a'); f.state.view.messages = []; f.actions().saveEdit();
  assert.equal(f.state.view.editing, undefined);
});

test('keep-local conflict resolution submits explicit empty values for every optional draft field', async () => {
  const f = actionFixture(); f.state.view.draft = { text: '@Alice' }; f.state.blockedDrafts.current.add('team');
  const result = f.actions().resolveDraftConflict(true); await settle();
  assert.deepEqual(plain(f.requests[0].payload.patch), { text: '@Alice', attachment: null, replyTo: null, replyRange: null, ref: null, mentions: [], automaticCard: null, dismissedUrls: [] });
  const remote = { mentions: [{ id: 'alice', label: 'Alice' }], automaticCard: { url: 'https://a.test', assetId: 'a' }, dismissedUrls: ['https://a.test'] };
  Object.assign(remote, f.requests[0].payload.patch);
  assert.deepEqual(plain(remote.mentions), []);
  f.requests[0].resolve({}); await result;
  assert.equal(f.state.blockedDrafts.current.has('team'), false);
});

function composerFixture(c, extras = {}) {
  const h = host();
  const tags = ['Spinner', 'VisuallyHidden', 'ArrowUp', 'Check', 'Gift', 'ImageIcon', 'Plus', 'Pencil', 'X', 'IconButton', 'ImageEditor', 'DraftConflict', 'AssetCard', 'ComposerRows', 'EditLine', 'ReplyLine', 'ReactionPicker', 'StateGlyph', 'CaptureTool', 'PageStrip', 'InteractToggle', 'ShareToggle', 'Action', 'PersonAvatar'];
  const globals = { ...h.globals, ...Object.fromEntries(tags.map(tag => [tag, tag])),
    h: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }), Fragment: 'fragment',
    useTranslations: () => key => key, useMention: () => ({ close() {}, detect() {}, keyDown() {} }), useLinkCard() {},
    assetView() {}, quotedText: () => '', s: {}, refStyles: {}, TEXT_MAX: 4000, IMAGE_LIMIT: {}, uiMessage: key => key, errorMessage: error => error.message,
    ...extras,
  };
  const Composer = compile(declarations(composerFile, ['Composer']), 'Composer', globals);
  return { render: () => h.render(() => Composer({ c, inputRef: { current: null }, onSend: async () => {} })), unmount: () => h.unmount() };
}
function nodes(tree) { return tree && typeof tree === 'object' ? [tree, ...tree.children.flatMap(nodes)] : []; }
function composerController(f) {
  return { ...f.state.view, ...f.actions(), people: [], currentMessages: f.state.view.messages, draft: { text: '' }, editSessionId: f.state.editSession.current.id, setEditing: f.state.view.setEditing };
}

test('composer ends editing when a recalled tombstone or loss of edit eligibility arrives', () => {
  for (const patch of [{ recalled: true }, { status: 'failed' }, { author: 'other' }]) {
    const f = actionFixture(); f.edit('a'); const c = composerController(f), component = composerFixture(c);
    component.render(); assert.equal(f.state.view.editing, 'a');
    Object.assign(c.currentMessages[0], patch); component.render();
    assert.equal(f.state.view.editing, undefined);
  }
  const f = actionFixture(); f.edit('a'); const c = composerController(f); c.canWrite = false; composerFixture(c).render();
  assert.equal(f.state.view.editing, undefined);
});

test('image preparation finishing after composer unmount saves through its original attachment action', async () => {
  const f = actionFixture(), prepared = deferred();
  const c = composerController(f);
  const component = composerFixture(c, { prepareImage: () => prepared.promise, readImage: async () => 'data:prepared', pastedImage: files => ({ file: files[0] }) });
  const input = nodes(component.render()).find(node => node.type === 'input' && node.props.type === 'file');
  input.props.onChange({ target: { files: [{}], value: 'image' } });
  f.leave(); component.unmount(); f.state.view.current = 'other';
  prepared.resolve({ blob: {}, name: 'prepared' }); await settle();
  assert.equal(f.requests[0].name, 'attach');
  assert.equal(f.requests[0].payload.teamId, 'team');
  assert.equal(f.requests[0].payload.attachment.src, 'data:prepared');
  f.requests[0].resolve({ attached: true }); await settle();
  assert.deepEqual(f.navigation, []);
});

function panelFixture() {
  const h = host();
  const data = { self: 'self', teams: [{ id: 'team', joined: true, memberIds: [], name: 'Team' }, { id: 'other', joined: true, memberIds: [], name: 'Other' }], people: [], messages: [], requests: [], views: [] };
  const adapterData = load('apps/extension/src/features/palside/app/live-data.ts').livePanelData({ data, scenario: 'normal', initialTeam: data.teams[0] });
  const source = declarations('apps/extension/src/features/palside/app/use-panel-state.ts', ['signedOutScreens', 'noTeam', 'usePanelState', 'useScreenOwnership', 'useAccessOwnership', 'activeHost']);
  const usePanelState = compile(source, 'usePanelState', {
    ...h.globals, useTranslations: () => key => key, useLocale: () => 'en', localeOrEnglish: value => value,
    useText: () => value => value, useTextState: () => h.react.useState(''), usePreferences: () => ({ values: {} }),
    useFormattedTeams: teams => teams, useFormattedMessages: messages => messages, useCurrentMessages: messages => messages,
    lobbyWithMembership: () => [], requestIsActive: () => false, walletDeadlines: () => undefined,
    defaultInteraction: {}, emptyFavorites: {}, uiMessage: key => key,
    document: { addEventListener() {}, removeEventListener() {} }, URL,
  });
  let state;
  const render = () => state = h.render(() => usePanelState({ data, adapter: { data: adapterData } }));
  render();
  return { data, adapterData, render, get state() { return state; }, unmount: () => h.unmount() };
}

test('panel screen ownership cannot revive after navigation, squad changes, account changes or unmount', () => {
  for (const leave of [
    f => { f.state.setScreen('settings'); f.state.setScreen('chat'); },
    f => { f.adapterData.localCurrent = 'other'; f.render(); f.adapterData.localCurrent = 'team'; },
    f => { f.data.self = 'someone'; f.render(); f.data.self = 'self'; },
  ]) {
    const f = panelFixture(), owns = f.state.view.ownsScreen;
    assert.equal(owns(), true); f.render(); assert.equal(owns(), true);
    leave(f); f.render(); assert.equal(owns(), false); assert.equal(f.state.view.ownsScreen(), true);
    f.unmount(); assert.equal(f.state.view.ownsScreen(), false);
  }
});

test('panel edit session advances for a restarted edit and submitted text changes', () => {
  const f = panelFixture();
  f.state.view.setEditing('a'); f.state.view.setEditText('first'); f.render();
  const session = f.state.editSession.current;
  assert.equal(f.state.view.editSessionId, session.id);
  f.state.view.setEditText('second'); f.render();
  assert.equal(f.state.editSession.current.id, session.id);
  assert.notEqual(f.state.editSession.current.version, session.version);
  f.state.view.setEditing('a'); f.render();
  assert.notEqual(f.state.editSession.current.id, session.id);
  f.unmount();
});

test('runtime draft metadata survives persistence and manual attachment replacement clears ownership', async t => {
  indexedDb(t);
  const storage = new ClientStorage('composer-lifecycle');
  const runtime = { storage, auth: { session: { account: { id: 'self' } }, scope: () => ({ wait: promise => promise }) }, state: { drafts: {}, remoteTeams: [{ id: 'team', joined: true }], data: { views: [] } }, emit() {} };
  const source = declarations('apps/extension/src/runtime/chat/command-handlers.ts', ['draftCommand', 'attachCommand']);
  const handlers = compile(source, '({ draftCommand, attachCommand })', { ...model, MessageError, uiMessage: key => ({ key }), text: value => typeof value === 'string' ? value : '', validateView: view => view });
  const parseCommand = load('apps/extension/src/runtime/transport/command-map.ts').parseCommand;
  const draft = { text: 'https://a.test', attachment: card(), automaticCard: { url: 'https://a.test', assetId: 'a' }, dismissedUrls: ['https://b.test'] };
  await handlers.draftCommand.call({ runtime }, parseCommand({ name: 'draft', payload: { accountId: 'self', teamId: 'team', revision: 0, patch: draft } }));
  assert.deepEqual(plain((await new ClientStorage('composer-lifecycle').get('self:draft:team')).value), draft);
  const replacement = { kind: 'image', src: 'data:replacement', name: 'replacement' };
  const target = { accountId: 'self', teamId: 'team', attachment: replacement };
  const confirmation = await handlers.attachCommand.call({ runtime }, { name: 'attach', payload: target });
  assert.equal(confirmation.requiresReplace, true);
  await handlers.attachCommand.call({ runtime }, { name: 'attach', payload: { ...target, replace: true, revision: confirmation.revision } });
  const saved = await storage.get('self:draft:team');
  assert.equal(saved.value.automaticCard, undefined);
  assert.deepEqual(plain(saved.value.dismissedUrls), ['https://b.test', 'https://a.test']);
  assert.deepEqual(plain(saved.value.attachment), replacement);
  await handlers.draftCommand.call({ runtime }, parseCommand({ name: 'draft', payload: { accountId: 'self', teamId: 'team', revision: saved.revision, patch: { text: '@Alice', mentions: [], attachment: null, replyTo: null, replyRange: null, ref: null, automaticCard: null, dismissedUrls: [] } } }));
  const kept = await storage.get('self:draft:team');
  assert.equal(kept.value.automaticCard, undefined);
  assert.deepEqual(plain(kept.value.mentions), []);
  assert.deepEqual(plain(kept.value.dismissedUrls), []);
  assert.equal(await storage.clearSentDraft('self', 'team', kept.revision, model.emptyDraft), true);
  assert.deepEqual(plain((await storage.get('self:draft:team')).value), { text: '' });
});

test('a delayed draft flush cannot open the image editor after navigation', async () => {
  const f = actionFixture(), flushed = deferred();
  f.state.draftQueue.current = flushed.promise;
  const c = composerController(f);
  c.draft = { text: '', attachment: { kind: 'image', src: 'data:image', name: 'image' } };
  c.drafts.team = c.draft;
  const component = composerFixture(c);
  nodes(component.render()).find(node => node.props.label === 'extension.composer.editImage').props.onClick();
  f.leave(); flushed.resolve(); await settle();
  assert.equal(nodes(component.render()).some(node => node.type === 'ImageEditor'), false);
  component.unmount();
});
