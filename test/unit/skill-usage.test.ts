import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';
import type { AllSessions } from '../../src/readers/all-sessions';
import { readCliSessions } from '../../src/readers/cli-sessions';
import { Env } from '../../src/readers/paths';
import { skillUsage } from '../../src/readers/session-view';

const fixtureRoot = path.resolve(__dirname, '..', '..', '..', 'test', 'fixtures', 'cli-sessions');
const env: Env = { home: fixtureRoot, platform: 'win32' };

const empty = (source: 'chatSessions' | 'debugLogs' | 'traceDb') => ({ source, sessions: [], roots: [], skipped: 0 });

test('the CLI reader keeps the name and time of every skill.invoked event', async () => {
  const s = (await readCliSessions(env)).sessions.find((x) => x.id === 's1')!;
  assert.equal(s.skills, 1);
  assert.deepEqual(s.skillUses, [{ name: 's', at: '2026-09-20T10:00:06.000Z' }]);
});

test('skillUsage lists the sessions that called the skill, with calls per day over the last 7 days', async () => {
  const cli = await readCliSessions(env);
  const all: AllSessions = { chatSessions: empty('chatSessions'), debugLogs: empty('debugLogs'), traceDb: empty('traceDb'), cli };
  const now = Date.parse('2026-09-21T12:00:00');
  const r = skillUsage(all, 'S', now);
  assert.equal(r.sessions.length, 1);
  assert.equal(r.sessions[0].id, 's1');
  assert.equal(r.sessions[0].count, 1);
  assert.equal(r.sessions[0].last, '2026-09-20T10:00:06.000Z');
  assert.equal(r.days.length, 7);
  assert.equal(r.days.reduce((n, d) => n + d.n, 0), 1);
  assert.equal(skillUsage(all, 'other', now).sessions.length, 0);
});
