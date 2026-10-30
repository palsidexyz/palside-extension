import test from 'node:test';
import assert from 'node:assert/strict';
import { productionModules } from './helpers/production-module.mjs';

const Commands = productionModules()('apps/extension/src/runtime/composition/dispatch.ts').RuntimeCommands;

test('empty visibility deletes only its source and preserves the other panel visibility', async () => {
  const runtime = {
    initialise: async () => {}, auth: { session: { account: { id: 'alice' } }, scope: () => ({ check() {} }) },
    state: { remoteTeams: [] }, rooms: { dropPanel() {} }, timeline: { visiblePanels: new Map(), visibleMessages: new Set() },
  };
  const commands = new Commands(runtime);
  const visible = (sourceId, ids) => commands.execute({ name: 'visible', payload: { sourceId, ids } });
  await visible('first', ['one', 'shared']); await visible('second', ['two', 'shared']);
  await visible('first', []);
  assert.equal(runtime.timeline.visiblePanels.has('first'), false);
  assert.deepEqual([...runtime.timeline.visibleMessages].sort(), ['shared', 'two']);
  for (let i = 0; i < 100; i++) await visible(`unmounted-${i}`, []);
  assert.equal(runtime.timeline.visiblePanels.size, 1);
});

test('a closed panel drops every source it reported, even without an empty list', async () => {
  const runtime = {
    initialise: async () => {}, auth: { session: { account: { id: 'alice' } }, scope: () => ({ check() {} }) },
    state: { remoteTeams: [] }, rooms: { dropPanel() {} }, timeline: { visiblePanels: new Map(), visibleMessages: new Set() },
  };
  const commands = new Commands(runtime);
  const visible = (sourceId, ids) => commands.execute({ name: 'visible', payload: { sourceId, ids } });
  await visible('closed:chat-a', ['one']); await visible('closed:chat-b', ['two']); await visible('open:chat', ['three']);
  await commands.execute({ name: 'visible-drop', payload: { panel: 'closed' } });
  assert.deepEqual([...runtime.timeline.visiblePanels.keys()], ['open:chat']);
  assert.deepEqual([...runtime.timeline.visibleMessages], ['three']);
});
