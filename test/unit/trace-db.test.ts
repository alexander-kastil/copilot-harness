import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { readTraceDb } from '../../src/readers/trace-db';

const root = path.resolve(__dirname, '../../../test/fixtures/trace-db');
const env = { home: root, platform: 'win32' as const, appData: path.join(root, 'AppData') };

test('reads the fixture database read-only: totals, subagent, nano AIU, cached', async () => {
  const r = await readTraceDb(env);
  assert.equal(r.reason, undefined);
  assert.equal(r.sessions.length, 1);
  const s = r.sessions[0];
  assert.equal(s.source, 'traceDb');
  assert.equal(s.id, 'conv1');
  assert.equal(s.detail, 'perCall');
  assert.deepEqual(s.tokens, { input: 1300, output: 70, cached: 400 });
  assert.equal(s.credits, undefined);
  assert.equal(s.nanoAiu, 2500);
  assert.equal(s.toolCalls, 2);
  assert.equal(s.turns, 1);
  assert.deepEqual(s.models.sort(), ['gpt-5', 'gpt-5-mini']);
  assert.equal(s.subagents?.length, 1);
  const sub = s.subagents![0];
  assert.equal(sub.id, 'sa');
  assert.equal(sub.parentId, 'tl');
  assert.equal(sub.name, 'Explore');
  assert.deepEqual(sub.tokens, { input: 300, output: 20, cached: undefined });
  assert.equal(sub.nanoAiu, 500);
  assert.equal(sub.toolCalls, 1);
});

test('no prompt, response or tool text from content columns reaches the result', async () => {
  const r = await readTraceDb(env);
  assert.ok(!JSON.stringify(r).includes('SENTINEL'));
});

test('missing database returns an empty result without error', async () => {
  const r = await readTraceDb({ home: root, platform: 'win32', appData: path.join(root, 'nowhere') });
  assert.equal(r.sessions.length, 0);
  assert.equal(r.reason, undefined);
});
