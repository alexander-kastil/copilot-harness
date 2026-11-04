import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { readDebugLogs } from '../../src/readers/debug-logs';
import { ScanIndex } from '../../src/readers/scan-index';
import { SessionSummary } from '../../src/shared/session-model';

const root = path.resolve(__dirname, '../../../test/fixtures/debug-logs');
const env = { home: root, platform: 'win32' as const, appData: path.join(root, 'AppData') };
// userDataDirs() joins the variant folder to appData, so the fixture holds AppData/Code directly.
const fixtureEnv = { ...env, appData: path.join(root, 'AppData') };

test('per-call tokens, subagent attached to parent, tool calls, truncated line skipped', async () => {
  const r = await readDebugLogs(fixtureEnv);
  const s = r.sessions.find((x) => x.id === 'sess-full')!;
  assert.equal(s.source, 'debugLogs');
  assert.equal(s.detail, 'perCall');
  assert.deepEqual(s.tokens, { input: 1000 + 1200 + 300, output: 50 + 70 + 20, cached: 400 + 600 });
  assert.equal(s.credits, undefined);
  assert.equal(s.nanoAiu, 2500);
  assert.equal(s.toolCalls, 2);
  assert.equal(s.turns, 1);
  assert.equal(s.sidecarFiles, 3);
  assert.deepEqual(s.models.sort(), ['gpt-5', 'gpt-5-mini']);
  assert.equal(s.subagents?.length, 1);
  const sub = s.subagents![0];
  assert.equal(sub.id, 'sub1');
  assert.equal(sub.parentId, 't1');
  assert.equal(sub.name, 'runSubagent-Explore');
  assert.deepEqual(sub.tokens, { input: 300, output: 20, cached: undefined });
  assert.equal(sub.toolCalls, 1);
  assert.equal(s.workspace, 'd:/git-classes/ai-103');
  assert.equal(s.skipped, 1);
  assert.equal(s.provenance.tokens, 'debugLogs');
  assert.equal(s.provenance.cachedTokens, 'debugLogs');
});

test('a session logged before logging was on has detail none and no zeros', async () => {
  const r = await readDebugLogs(fixtureEnv);
  const s = r.sessions.find((x) => x.id === 'sess-none')!;
  assert.equal(s.detail, 'none');
  assert.equal(s.tokens, undefined);
  assert.equal(s.credits, undefined);
  assert.equal(s.toolCalls, undefined);
  assert.deepEqual(s.provenance, {});
});

test('cached tokens stay undefined when no call carries them', async () => {
  const r = await readDebugLogs(fixtureEnv);
  const sub = r.sessions.find((x) => x.id === 'sess-full')!.subagents![0];
  assert.equal(sub.tokens?.cached, undefined);
});

test('no message text leaks, missing folder is empty, index is reused', async () => {
  const r = await readDebugLogs(fixtureEnv);
  assert.ok(!JSON.stringify(r).includes('SENTINEL'));
  const none = await readDebugLogs({ home: root, platform: 'win32', appData: path.join(root, 'nowhere') });
  assert.equal(none.sessions.length, 0);
  const idx = new ScanIndex<SessionSummary>();
  const a = await readDebugLogs(fixtureEnv, idx);
  const b = await readDebugLogs(fixtureEnv, idx);
  assert.equal(idx.size, 2);
  assert.strictEqual(a.sessions[0], b.sessions[0]);
});
