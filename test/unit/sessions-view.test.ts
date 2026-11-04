import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AllSessions } from '../../src/readers/all-sessions';
import { analyzePrompt, modelsSeen, sessionDetail, sessionListRows } from '../../src/readers/session-view';
import type { SessionSource, SessionSummary } from '../../src/shared/session-model';
import { cacheShare, delegatedShare, durationOf, peakParallel, sessionLabel } from '../../src/shared/sessions';

const session = (source: SessionSource, id: string, extra: Partial<SessionSummary> = {}): SessionSummary => ({
  source,
  id,
  file: `/x/${id}`,
  turns: 2,
  models: [],
  tokens: undefined,
  credits: undefined,
  detail: 'totalsOnly',
  provenance: {},
  skipped: 0,
  ...extra,
});

const all = (by: Partial<Record<SessionSource, SessionSummary[]>>): AllSessions => {
  const read = (source: SessionSource) => ({ source, sessions: by[source] ?? [], roots: [], skipped: 0 });
  return { chatSessions: read('chatSessions'), debugLogs: read('debugLogs'), traceDb: read('traceDb'), cli: read('cli') };
};

test('one row per session id, with the branch and resumability of the CLI record', () => {
  const rows = sessionListRows(
    all({
      traceDb: [session('traceDb', 'a', { models: ['gpt-5'], credits: 3, start: '2026-11-04T10:00:00Z', end: '2026-11-04T10:05:00Z' })],
      cli: [session('cli', 'a', { branch: 'main', title: 'Fix it', subagents: [{ id: 's1' }] }), session('cli', 'b')],
    })
  );
  assert.equal(rows.length, 2);
  const a = rows.find((r) => r.id === 'a')!;
  assert.equal(a.branch, 'main');
  assert.equal(a.title, 'Fix it');
  assert.equal(a.resumable, true);
  assert.equal(a.credits, 3);
  assert.equal(a.subagents, 1);
  assert.deepEqual(modelsSeen(rows), ['gpt-5']);
});

test('a chat session cannot be resumed and an unknown id has no detail', () => {
  const data = all({ chatSessions: [session('chatSessions', 'c')] });
  assert.equal(sessionListRows(data)[0].resumable, false);
  assert.equal(sessionDetail(data, 'nope'), undefined);
  assert.deepEqual(sessionDetail(data, 'c')!.sources, ['Chat']);
});

test('detail carries the subagent runs with their figures', () => {
  const data = all({ cli: [session('cli', 'd', { subagents: [{ id: 'x', name: 'explore', credits: 1, start: '2026-11-04T10:00:00Z', end: '2026-11-04T10:01:00Z' }] })] });
  const d = sessionDetail(data, 'd')!;
  assert.equal(d.agents[0].name, 'explore');
  assert.equal(d.agents[0].credits, 1);
});

test('peak parallel counts overlapping runs and ignores runs without both times', () => {
  const t = (m: number) => new Date(Date.UTC(2026, 10, 4, 10, m)).toISOString();
  assert.equal(peakParallel([{ start: t(0), end: t(10) }, { start: t(5), end: t(15) }, { start: t(20), end: t(25) }, { start: t(1) }]), 2);
  assert.equal(peakParallel([]), 0);
});

test('shares are undefined when the source holds no figure', () => {
  assert.equal(delegatedShare(undefined, [{ credits: 1 }]), undefined);
  assert.equal(delegatedShare(4, [{ credits: 1 }, {}]), 0.25);
  assert.equal(cacheShare({ input: 100, output: 5, cached: undefined }), undefined);
  assert.equal(cacheShare({ input: 100, output: 5, cached: 40 }), 0.4);
  assert.equal(durationOf('2026-11-04T10:00:00Z', undefined), undefined);
});

test('a session without a title is named by its id', () => {
  assert.equal(sessionLabel({ id: '1234567890' }), 'Session 12345678');
  assert.equal(sessionLabel({ id: 'x', title: ' Fix ' }), 'Fix');
});

test('the analyze prompt has no quote, dollar, backtick or backslash', () => {
  const p = analyzePrompt('abc', 'a "b" $c `d` \\e', ['C:\\Users\\me\\.copilot\\session-state\\abc']);
  assert.ok(!/["'$`\\]/.test(p));
  assert.ok(p.includes('C:/Users/me/.copilot/session-state/abc'));
});
