import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readCliSessions } from '../../src/readers/cli-sessions';
import { ScanIndex } from '../../src/readers/scan-index';
import { Env } from '../../src/readers/paths';
import { SessionSummary } from '../../src/shared/session-model';

const fixtureRoot = path.resolve(__dirname, '..', '..', '..', 'test', 'fixtures', 'cli-sessions');
const env: Env = { home: fixtureRoot, platform: 'win32' };

test('lists a CLI session with repository, branch, start, end, models and counts', async () => {
  const r = await readCliSessions(env);
  assert.equal(r.sessions.length, 3);
  const s = r.sessions.find((x) => x.id === 's1')!;
  assert.equal(s.workspace, 'D:\\work\\proj');
  assert.equal(s.repository, 'owner/proj');
  assert.equal(s.branch, 'main');
  assert.equal(s.start, '2026-09-20T10:00:00.000Z');
  assert.equal(s.end, '2026-09-21T10:05:00.000Z');
  assert.equal(s.turns, 1);
  assert.deepEqual([...s.models].sort(), ['claude-haiku-4.5', 'gpt-5-mini']);
  assert.equal(s.toolCalls, 1);
  assert.equal(s.skills, 1);
  assert.equal(s.subagents?.length, 1);
  assert.equal(s.subagents?.[0].name, 'explore');
  assert.equal(s.subagents?.[0].toolCalls, 3);
  assert.deepEqual(s.snapshotDir, {
    path: path.join(fixtureRoot, '.copilot', 'session-state', 's1', 'rewind-snapshots'),
    count: 2,
  });
});

test('a resumed session keeps every shutdown and checkpoint as a separate raw record', async () => {
  const s = (await readCliSessions(env)).sessions.find((x) => x.id === 's1')!;
  assert.deepEqual(
    s.usageSnapshots?.map((u) => u.eventType),
    ['session.usage_checkpoint', 'session.shutdown', 'session.shutdown'],
  );
  assert.equal(s.usageSnapshots?.[1].raw.totalNanoAiu, 2000);
  assert.equal(s.usageSnapshots?.[2].raw.totalNanoAiu, 2000);
  assert.deepEqual(s.usageSnapshots?.[1].tokens, { input: 100, output: 20, cached: 50 });
  assert.equal(s.usageSnapshots?.[2].tokens?.input, 100);
  assert.equal(s.tokens, undefined);
  assert.equal(s.credits, undefined);
});

test('an unknown event type and a truncated last line are counted and skipped', async () => {
  const r = await readCliSessions(env);
  assert.equal(r.sessions.find((x) => x.id === 's1')!.skipped, 2);
  assert.equal(r.skipped, 2);
});

test('a session without events lists from workspace.yaml; the title is the name or summary, first line only', async () => {
  const r = await readCliSessions(env);
  const s2 = r.sessions.find((x) => x.id === 's2')!;
  assert.equal(s2.title, 'Named by user');
  assert.equal(s2.toolCalls, undefined);
  assert.equal(s2.detail, 'none');
  assert.equal(r.sessions.find((x) => x.id === 's1')!.title, 'Auto name');
  assert.equal(r.sessions.find((x) => x.id === 's3')!.title, 'Older summary line');
});

test('no message text reaches the result', async () => {
  assert.doesNotMatch(JSON.stringify(await readCliSessions(env)), /SENTINEL_/);
});

test('without a .copilot folder the result is empty and has no error', async () => {
  const r = await readCliSessions({ home: path.join(fixtureRoot, 'none'), platform: 'win32' });
  assert.deepEqual(r.sessions, []);
  assert.equal(r.skipped, 0);
});

test('a cached entry without a title gets it back from workspace.yaml', async () => {
  const first = new ScanIndex<SessionSummary>();
  await readCliSessions(env, first);
  // What the persisted index holds: every entry with its title stripped.
  const stripped = JSON.parse(JSON.stringify(first.toJSON(), (k, v) => (k === 'title' ? undefined : v)));
  const restored = new ScanIndex<SessionSummary>(stripped);
  assert.ok(!JSON.stringify(stripped).includes('"title"'));
  const r = await readCliSessions(env, restored);
  assert.equal(r.sessions.find((x) => x.id === 's1')!.title, 'Auto name');
  assert.equal(r.sessions.find((x) => x.id === 's2')!.title, 'Named by user');
  assert.equal(r.sessions.find((x) => x.id === 's3')!.title, 'Older summary line');
});

test('a second scan of unchanged sessions does not read events.jsonl', async () => {
  const tmp = fs.mkdtempSync(path.join(process.env.TEST_TMP ?? os.tmpdir(), 'cli-'));
  try {
    fs.cpSync(path.join(fixtureRoot, '.copilot'), path.join(tmp, '.copilot'), { recursive: true });
    const e: Env = { home: tmp, platform: 'win32' };
    const index = new ScanIndex<SessionSummary>();
    await readCliSessions(e, index);
    const opened: string[] = [];
    const rawFs = require('node:fs') as { createReadStream: unknown };
    const real = rawFs.createReadStream;
    rawFs.createReadStream = (p: unknown, ...rest: unknown[]) => {
      opened.push(String(p));
      return (real as (...a: unknown[]) => unknown)(p, ...rest);
    };
    try {
      const second = await readCliSessions(e, index);
      assert.equal(second.sessions.length, 3);
      assert.deepEqual(opened, []);
    } finally {
      rawFs.createReadStream = real;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
