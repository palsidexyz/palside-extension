import assert from 'node:assert/strict';
import { writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromeArgument, chromePath } from './lib/chrome-discovery.mjs';
import { bounded, launchChrome, until } from './lib/headless-chrome.mjs';
import { websiteCleanup } from './lib/website-cleanup.mjs';
const browserPath = await chromePath({ chrome: chromeArgument(process.argv.slice(2)) });
const { createServer } = await import(pathToFileURL(createRequire(new URL('../apps/extension/package.json', import.meta.url)).resolve('vite')).href);
const repo = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const root = await mkdtemp(resolve(tmpdir(), 'palside-draft-recovery-'));
const run = resolve(root, 'evidence');
await mkdir(run);
const pause = ms => new Promise(r => setTimeout(r, ms));
let chrome, vite, stop;
const result = { run, cases: [], errors: [], browserStderr: '' };
const record = error => { result.errors.push(error instanceof Error ? error.stack ?? error.message : String(error)); };
const cleanup = websiteCleanup(() => ({ chrome, website: vite && { close: () => bounded(vite.close(), 'Vite shutdown') } }));
try {
  await writeFile(resolve(root, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Draft recovery verification</title><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/draft.tsx"></script></body></html>');
  await writeFile(resolve(root, 'draft.tsx'), `import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { IntegrationIntl } from '/@fs/${repo}/apps/extension/integration/intl.tsx';
import { usePalside } from '/@fs/${repo}/apps/extension/src/features/palside/app/use-palside.ts';
import { palsideFixtures, demoSites } from '/@fs/${repo}/apps/extension/integration/fixtures.ts';
const data = structuredClone(palsideFixtures);
data.messages = [];
const ref = {
  target: {
    kind: 'quote',
    exact: 'A public quote',
    prefix: '',
    suffix: ''
  },
  caption: 'A public quote',
  view: data.views[0]
};
const base = () => ({
  revision: 0,
  ready: true,
  authenticated: true,
  connection: {
    networkOnline: true,
    service: 'ready',
    messaging: 'ready',
    retrying: false
  },
  account: {
    id: data.self,
    nickname: 'Synthetic',
    avatarId: null,
    matrixId: '@synthetic:example.test',
    revision: 0
  },
  toggles: { share: false, interact: false },
  data,
  drafts: {
    night: {
      revision: 1,
      value: {
        text: 'base'
      },
      updatedAt: 0
    }
  },
  preferences: {
    web: { share: true, interact: true },
    current: 'night',
    notifications: 'all',
    notificationPreview: true,
    hiddenStickies: []
  },
  remoteTeams: [],
  lobbyTeams: [],
  config: {
    websiteUrl: 'https://example.test',
    signupDifficulty: 0
  },
  items: {
    danmaku: [],
    stances: [],
    stickies: []
  },
  invitations: {},
  pokes: []
});
let shared = base();
const publish = new Map();
const pending = [];
const commands = [];
let hold = false,
  failNext = false;
function broadcast() {
  for (const update of publish.values()) update(structuredClone(shared));
}
async function command(name, payload) {
  if (name === 'send') {
    window.sent = (window.sent ?? 0) + 1;
    return {
      eventId: 'synthetic-sent'
    };
  }
  if (name !== 'draft') return;
  const p = JSON.parse(JSON.stringify(payload));
  commands.push(p);
  if (hold) await new Promise((resolve, reject) => pending.push({
    resolve,
    reject
  }));
  if (failNext) {
    failNext = false;
    throw Error('Synthetic offline persistence failure');
  }
  const current = shared.drafts[p.teamId] ?? {
    revision: 0,
    value: {
      text: ''
    },
    updatedAt: 0
  };
  if (current.revision !== p.revision) throw Object.assign(Error('Synthetic draft conflict'), {
    text: {
      key: 'extension.runtime.draftChanged'
    }
  });
  const patch = {
    ...p.patch
  };
  for (const key of ["attachment", "replyTo", "ref", "mentions"]) if (patch[key] === null) patch[key] = undefined;
  const next = {
    revision: current.revision + 1,
    value: {
      ...current.value,
      ...patch
    },
    updatedAt: Date.now()
  };
  shared = {
    ...shared,
    drafts: {
      ...shared.drafts,
      [p.teamId]: next
    }
  };
  broadcast();
  return next;
}
function Panel({
  id
}) {
  const [state, setState] = useState(shared);
  publish.set(id, setState);
  const c = usePalside({
    data,
    sites: demoSites,
    live: {
      state,
      command,
      openPage: async () => {}
    },
    deliver: async () => {}
  });
  window.controllers ??= {};
  window.controllers[id] = c;
  return <section style={{
    width: 320,
    border: '1px solid',
    padding: 8
  }}><h2>Panel {id}</h2><textarea value={c.draft.text} onChange={e => c.updateDraft({
      text: e.target.value
    })} /><pre>{JSON.stringify({
        draft: c.draft,
        conflict: c.draftConflict
      })}</pre></section>;
}
window.qa = {
  get: () => ({
    shared,
    commands
  }),
  reset() {
    shared = base();
    commands.length = 0;
    hold = false;
    failNext = false;
    broadcast();
  },
  remote(patch) {
    const d = shared.drafts.night;
    shared = {
      ...shared,
      drafts: {
        ...shared.drafts,
        night: {
          ...d,
          revision: d.revision + 1,
          value: {
            ...d.value,
            ...patch
          }
        }
      }
    };
    broadcast();
  },
  hold(on) {
    hold = on;
  },
  release() {
    pending.shift()?.resolve();
  },
  fail() {
    failNext = true;
  },
  ref
};
createRoot(document.getElementById('root')).render(<IntegrationIntl><div style={{
    display: 'flex',
    gap: 12
  }}><Panel id="a" /><Panel id="b" /></div></IntegrationIntl>);`);
  vite = await createServer({
    root,
    configFile: false,
    server: {
      host: '127.0.0.1',
      port: 0,
      fs: {
        allow: [repo, root]
      }
    },
    resolve: {
      alias: {
        react: repo + '/node_modules/react',
        'react-dom': repo + '/node_modules/react-dom'
      }
    },
    optimizeDeps: {
      include: ['react', 'react-dom/client', 'react/jsx-dev-runtime']
    }
  });
  chrome = await launchChrome(browserPath);
  await vite.listen();
  const port = vite.httpServer.address().port;
  const { targetId } = await chrome.send('Target.createTarget', { url: 'about:blank', newWindow: true, width: 1000, height: 700 });
  const { sessionId } = await chrome.send('Target.attachToTarget', { targetId, flatten: true });
  stop = chrome.listen(message => {
    if (message.sessionId !== sessionId) return;
    if (message.method === 'Runtime.exceptionThrown') {
      record(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      record(`console.error: ${message.params.args.map(arg => arg.description ?? String(arg.value)).join(' ')}`);
    } else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      record(`browser error: ${message.params.entry.text}`);
    }
  });
  const cdp = (method, params = {}) => chrome.send(method, params, sessionId);
  const ev = async expression => {
    const r = await cdp('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result?.value;
  };
  await cdp('Runtime.enable');
  await cdp('Log.enable');
  const navigation = await cdp('Page.navigate', {
    url: 'http://127.0.0.1:' + port
  });
  assert.ok(!navigation.errorText, `Browser navigation failed: ${navigation.errorText}`);
  await until(() => ev('Boolean(window.controllers?.b)'), 'draft controllers');
  await ev("controllers.a.updateDraft({text:'from a'})");
  await pause(150);
  result.cases.push({
    name: 'normal write syncs both panels',
    state: await ev('({a:controllers.a.draft,b:controllers.b.draft,saved:qa.get().shared.drafts.night})')
  });
  // Pause local removal; the other panel wins the revision and adds a reference.
  await ev('qa.hold(true);controllers.a.updateDraft({ref:undefined,text:"local without ref"})');
  await pause(60);
  await ev('qa.remote({ref:qa.ref,text:"remote with ref"});qa.hold(false);qa.release()');
  await pause(150);
  result.cases.push({
    name: 'conflict preserves local cleared ref',
    state: await ev('({a:controllers.a.draft,conflict:controllers.a.draftConflict,b:controllers.b.draft})')
  });
  await ev('controllers.a.resolveDraftConflict(true)');
  await pause(150);
  result.cases.push({
    name: 'keep local after clearing ref',
    state: await ev('({a:controllers.a.draft,b:controllers.b.draft,saved:qa.get().shared.drafts.night,lastCommand:qa.get().commands.at(-1)})')
  });
  await ev('qa.fail();controllers.a.updateDraft({text:"offline local text"})');
  await pause(150);
  result.cases.push({
    name: 'failed persistence flush',
    state: await ev('(async()=>{try{return {resolved:await controllers.a.flushDraft(),draft:controllers.a.draft,conflict:controllers.a.draftConflict}}catch(e){return {rejected:true,error:e.message,draft:controllers.a.draft,conflict:controllers.a.draftConflict}}})()')
  });
  await ev('controllers.a.resolveDraftConflict(false)');
  await pause(100);
  result.cases.push({
    name: 'use remote after failure',
    state: await ev('({a:controllers.a.draft,b:controllers.b.draft,conflict:controllers.a.draftConflict})')
  });
  await ev('qa.hold(true);controllers.a.updateDraft({text:"queued first"});controllers.a.updateDraft({text:"queued second"})');
  await pause(60);
  await ev('qa.fail();qa.hold(false);qa.release()');
  await pause(150);
  result.cases.push({
    name: 'first queued write failure blocks following write',
    state: await ev('({a:controllers.a.draft,b:controllers.b.draft,conflict:controllers.a.draftConflict,lastCommands:qa.get().commands.slice(-2)})')
  });
  await ev('qa.hold(true);window.resolving=controllers.a.resolveDraftConflict(true);void 0');
  await pause(70);
  await ev('controllers.a.updateDraft({text:"typed while resolving"});qa.hold(false);qa.release()');
  await ev('window.resolving');
  await pause(100);
  result.cases.push({
    name: 'typing during conflict resolution survives',
    state: await ev('({a:controllers.a.draft,b:controllers.b.draft,conflict:controllers.a.draftConflict})')
  });
  await ev('controllers.a.resolveDraftConflict(true)');
  await pause(100);
  result.cases.push({
    name: 'explicit second resolution persists latest input',
    state: await ev('({a:controllers.a.draft,b:controllers.b.draft,conflict:controllers.a.draftConflict})')
  });
  await ev('qa.hold(true);controllers.a.updateDraft({text:"queued before send"})');
  await pause(70);
  await ev('window.sending=controllers.a.send();qa.fail();qa.hold(false);qa.release()');
  await ev('window.sending');
  await pause(100);
  result.cases.push({
    name: 'failed queued draft blocks send before conflict render',
    state: await ev('({sent:window.sent??0,a:controllers.a.draft,conflict:controllers.a.draftConflict})')
  });
  const [sync, conflict, keep, flush, remote, queue, typing, retry, sending] = result.cases.map(item => item.state);
  assert.equal(sync.a.text, 'from a');
  assert.deepEqual(sync.a, sync.b);
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.a.ref, undefined);
  assert.equal(keep.lastCommand.patch.ref, null);
  assert.equal(keep.a.ref ?? null, null);
  assert.deepEqual(keep.a, keep.b);
  assert.equal(flush.rejected, true);
  assert.equal(flush.draft.text, 'offline local text');
  assert.equal(remote.conflict, false);
  assert.deepEqual(remote.a, remote.b);
  assert.equal(queue.a.text, 'queued second');
  assert.ok(!queue.lastCommands.some(item => item.patch.text === 'queued second'));
  assert.equal(typing.a.text, 'typed while resolving');
  assert.equal(typing.conflict, true);
  assert.equal(retry.conflict, false);
  assert.deepEqual(retry.a, retry.b);
  assert.equal(sending.sent, 0);
  assert.equal(sending.conflict, true);
} catch (e) {
  record(e);
} finally {
  stop?.();
  await cleanup().catch(record);
  if (chrome) result.browserStderr = chrome.stderr;
  await writeFile(run + '/result.json', JSON.stringify(result, null, 2)).catch(record);
  if (result.errors.length) process.exitCode = 1;
  console.log(JSON.stringify({
    cases: result.cases.length,
    errors: result.errors,
    evidence: run
  }));
}
