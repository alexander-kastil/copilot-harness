import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { AllSessions } from '../../src/readers/all-sessions';
import { AGENT_HOST_DEBUG_LOG, computeStatuses, FILE_DEBUG_LOG, needsAttention, TRACE_DB, writableSetting, type SettingsSnapshot } from '../../src/readers/source-status';
import type { ReadResult, SessionDetail, SessionSource, SessionSummary } from '../../src/shared/session-model';

const session = (source: SessionSource, id: string, detail: SessionDetail, end?: string): SessionSummary => ({
  source,
  id,
  file: `fixture/${id}`,
  turns: 1,
  models: [],
  tokens: undefined,
  credits: undefined,
  detail,
  provenance: {},
  skipped: 0,
  end,
});

const result = (source: SessionSource, sessions: SessionSummary[], extra: Partial<ReadResult> = {}): ReadResult => ({ source, sessions, roots: [], skipped: 0, ...extra });

const empty = (): AllSessions => ({
  chatSessions: result('chatSessions', []),
  debugLogs: result('debugLogs', []),
  traceDb: result('traceDb', []),
  cli: result('cli', []),
});

const allKnownOff: SettingsSnapshot = {
  [AGENT_HOST_DEBUG_LOG]: { known: true, value: false },
  [FILE_DEBUG_LOG]: { known: true, value: false },
  [TRACE_DB]: { known: true, value: false },
};

test('every source absent: all four listed, no error', () => {
  const s = computeStatuses(empty(), allKnownOff);
  assert.deepEqual(s.map((x) => [x.source, x.state]), [
    ['chatSessions', 'empty'],
    ['debugLogs', 'off'],
    ['traceDb', 'off'],
    ['cli', 'empty'],
  ]);
  assert.ok(s.every((x) => x.newest === undefined && x.sessions === 0 && x.reason === undefined));
  assert.equal(needsAttention(s), true);
});

test('setting on and nothing recorded yet is "on but empty"; either debug-log setting counts', () => {
  const s = computeStatuses(empty(), { ...allKnownOff, [FILE_DEBUG_LOG]: { known: true, value: true }, [TRACE_DB]: { known: true, value: true } });
  assert.equal(s[1].state, 'empty');
  assert.equal(s[2].state, 'empty');
  const host = computeStatuses(empty(), { ...allKnownOff, [AGENT_HOST_DEBUG_LOG]: { known: true, value: true } });
  assert.equal(host[1].state, 'empty');
});

test('sessions give "has data" with the newest record time; a debug log with detail none is not data', () => {
  const all = empty();
  all.chatSessions = result('chatSessions', [session('chatSessions', 'a', 'perTurn', '2026-11-01T10:00:00Z'), session('chatSessions', 'b', 'perTurn', '2026-11-03T10:00:00Z')]);
  all.debugLogs = result('debugLogs', [session('debugLogs', 'x', 'none', '2026-11-04T10:00:00Z')]);
  all.traceDb = result('traceDb', [session('traceDb', 't', 'perCall', '2026-11-02T10:00:00Z')], { newest: '2026-11-02T11:00:00Z' });
  const s = computeStatuses(all, allKnownOff);
  assert.equal(s[0].state, 'data');
  assert.equal(s[0].newest, '2026-11-03T10:00:00Z');
  assert.equal(s[0].sessions, 2);
  assert.equal(s[1].state, 'off');
  assert.equal(s[1].sessions, 0);
  assert.equal(s[1].newest, undefined);
  assert.equal(s[2].state, 'data');
  // an opt-in source's newest time comes from sessions with detail only, not from the reader's overall newest
  assert.equal(s[2].newest, '2026-11-02T10:00:00Z');
});

test('the card goes away once every opt-in source has data', () => {
  const all = empty();
  all.debugLogs = result('debugLogs', [session('debugLogs', 'x', 'perCall')]);
  all.traceDb = result('traceDb', [session('traceDb', 't', 'perCall')]);
  assert.equal(needsAttention(computeStatuses(all, allKnownOff)), false);
});

test('a setting this VS Code does not register is reported unknown and never counts as on', () => {
  const s = computeStatuses(empty(), { [FILE_DEBUG_LOG]: { known: true, value: false } });
  const host = s[1].settings.find((x) => x.key === AGENT_HOST_DEBUG_LOG)!;
  assert.equal(host.known, false);
  assert.equal(host.enabled, false);
  assert.equal(s[2].settings[0].known, false);
  // an unknown key with a stale true value is still not enabled
  const stale = computeStatuses(empty(), { [TRACE_DB]: { known: false, value: true } });
  assert.equal(stale[2].settings[0].enabled, false);
  assert.equal(stale[2].state, 'off');
});

test('a reader reason is carried to the card', () => {
  const all = empty();
  all.traceDb = result('traceDb', [], { reason: 'node:sqlite unavailable' });
  assert.equal(computeStatuses(all, allKnownOff)[2].reason, 'node:sqlite unavailable');
});

test('trace database setting is user-only and plain text; only the three named settings are writable', () => {
  const trace = computeStatuses(empty(), allKnownOff)[2].settings[0];
  assert.equal(trace.userOnly, true);
  assert.equal(trace.plainText, true);
  assert.ok(writableSetting(TRACE_DB) && writableSetting(FILE_DEBUG_LOG) && writableSetting(AGENT_HOST_DEBUG_LOG));
  assert.equal(writableSetting('github.copilot.chat.otel.captureContent'), undefined);
  assert.equal(writableSetting('editor.fontSize'), undefined);
});
