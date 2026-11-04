import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseQuotaResponse, periodFor, reconcile, type AllSessionsLike } from '../../src/shared/reconcile';
import type { SessionSource, SessionSummary } from '../../src/shared/session-model';

function s(source: SessionSource, id: string, extra: Partial<SessionSummary> = {}): SessionSummary {
  return {
    source,
    id,
    file: 'f',
    turns: 1,
    models: [],
    tokens: undefined,
    credits: undefined,
    detail: 'none',
    provenance: {},
    skipped: 0,
    start: '2026-11-02T10:00:00.000Z',
    end: '2026-11-02T10:30:00.000Z',
    ...extra,
  };
}
function all(p: Partial<Record<SessionSource, SessionSummary[]>>): AllSessionsLike {
  return {
    chatSessions: { sessions: p.chatSessions ?? [] },
    debugLogs: { sessions: p.debugLogs ?? [] },
    traceDb: { sessions: p.traceDb ?? [] },
    cli: { sessions: p.cli ?? [] },
  };
}
const period = periodFor(new Date('2026-11-04T00:00:00Z'));

// Token Pie: one agent-mode workload, 13.5631 credits in the trace database, 13.6000 by quota delta,
// 6.1461 in chatSessions.copilotCredits.
const chat = s('chatSessions', 'A', { credits: 6.1461, detail: 'perTurn' });
const trace = s('traceDb', 'A', { nanoAiu: 13.5631e9, detail: 'perCall' });
const quota = { used: 13.6, source: 'manual' as const };

test('chat sessions alone explain about 45 percent', () => {
  const r = reconcile(all({ chatSessions: [chat] }), period, quota);
  assert.ok(Math.abs(r.explainedShare! - 0.4519) < 0.001);
  assert.ok(Math.abs(r.remainder! - 7.4539) < 1e-9);
  assert.equal(r.sessions[0].credits?.source, 'chatSessions');
  assert.equal(r.verified, true);
});

test('with the trace database about 100 percent, and the session is counted once', () => {
  const r = reconcile(all({ chatSessions: [chat], traceDb: [trace] }), period, quota);
  assert.equal(r.sessions.length, 1);
  assert.deepEqual(r.sessions[0].sources, ['traceDb', 'chatSessions']);
  assert.equal(r.sessions[0].credits?.source, 'traceDb');
  assert.equal(r.sessions[0].credits?.via, 'nanoAiu');
  assert.ok(Math.abs(r.localCredits - 13.5631) < 1e-9);
  assert.ok(r.explainedShare! > 0.99 && r.explainedShare! < 1);
  // per-source sums keep both figures; only the best one enters the total
  assert.ok(Math.abs(r.perSource.find((x) => x.source === 'chatSessions')!.credits! - 6.1461) < 1e-9);
  assert.ok(Math.abs(r.perSource.find((x) => x.source === 'traceDb')!.credits! - 13.5631) < 1e-9);
});

test('a source without the figure never wins; cached stays undefined when nobody carries it', () => {
  const d = s('debugLogs', 'B', { detail: 'perCall', tokens: { input: 10, output: 2, cached: undefined } });
  const c = s('chatSessions', 'B', { detail: 'perTurn', credits: 1.5, tokens: { input: 9, output: 3, cached: undefined } });
  const r = reconcile(all({ chatSessions: [c], debugLogs: [d] }), period);
  const b = r.sessions[0];
  assert.equal(b.credits?.source, 'chatSessions');
  assert.equal(b.tokensInput?.source, 'debugLogs');
  assert.equal(b.cachedTokens, undefined);
});

test('no quota reading: local total is unverified, no share, no error', () => {
  const r = reconcile(all({ chatSessions: [chat] }), period);
  assert.equal(r.verified, false);
  assert.equal(r.explainedShare, undefined);
  assert.equal(r.remainder, undefined);
  assert.equal(r.localCredits, 6.1461);
});

test('sessions with no credit figure are listed with a cause; CLI ids never join VS Code ids', () => {
  const r = reconcile(
    all({ chatSessions: [s('chatSessions', 'X')], cli: [s('cli', 'X'), s('cli', 'Y', { credits: 2, detail: 'totalsOnly' })] }),
    period,
    quota,
  );
  assert.equal(r.sessions.length, 3);
  const causes = Object.fromEntries(r.noDetailSessions.map((x) => [x.sources[0], x.cause]));
  assert.equal(causes.chatSessions, 'logging-off');
  assert.equal(causes.cli, 'no-usage-record');
  assert.equal(r.localCredits, 2);
});

test('period filter and undated sessions', () => {
  const old = s('chatSessions', 'O', { credits: 5, end: '2026-09-01T00:00:00Z', start: '2026-09-01T00:00:00Z' });
  const none = s('chatSessions', 'N', { credits: 5, end: undefined, start: undefined });
  const r = reconcile(all({ chatSessions: [old, none, chat] }), period);
  assert.equal(r.sessions.length, 1);
  assert.equal(r.undated, 1);
});

test('parseQuotaResponse follows the copilot_internal/user shape and refuses unlimited or missing quotas', () => {
  const ok = parseQuotaResponse({
    quota_reset_date: '2026-12-01',
    quota_snapshots: { premium_interactions: { entitlement: '300', percent_remaining: 95.5, overage_count: 0 } },
  })!;
  assert.ok(Math.abs(ok.reading.used - 13.5) < 1e-9);
  assert.equal(ok.reading.source, 'github');
  assert.equal(ok.resetDate, '2026-12-01');
  assert.equal(parseQuotaResponse({ quota_snapshots: { premium_interactions: { unlimited: true } } }), undefined);
  assert.equal(parseQuotaResponse({}), undefined);
  assert.equal(parseQuotaResponse(null), undefined);
});

test('periodFor ends at the reset date and starts a month earlier', () => {
  const p = periodFor(new Date('2026-11-04T00:00:00Z'), '2026-12-01T00:00:00Z');
  assert.equal(p.start, '2026-11-01T00:00:00.000Z');
  assert.equal(p.end, '2026-12-01T00:00:00.000Z');
});
