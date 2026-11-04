import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AllSessions } from '../../src/readers/all-sessions';
import {
  emptyStore, enforceCap, hasCopilotData, loadStore, mergeSnapshots, saveStore, storeBytes, updateStore,
} from '../../src/readers/snapshot-store';
import type { SessionSource, SessionSummary } from '../../src/shared/session-model';

function session(id: string, over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    source: 'cli', id, file: `/x/${id}`, turns: 2, models: ['m'], tokens: { input: 10, output: 5, cached: undefined },
    credits: undefined, detail: 'totalsOnly', provenance: { tokens: 'cli' }, skipped: 0, ...over,
  };
}

function all(sessions: SessionSummary[]): AllSessions {
  const out = {} as AllSessions;
  for (const source of ['chatSessions', 'debugLogs', 'traceDb', 'cli'] as SessionSource[]) {
    out[source] = { source, sessions: sessions.filter((s) => s.source === source), roots: [], skipped: 0 };
  }
  return out;
}

test('create: a seen session gets a record with first and last seen', () => {
  const store = emptyStore();
  assert.equal(updateStore(store, all([session('a')]), '2026-11-01T00:00:00Z'), true);
  const rec = Object.values(store.records)[0];
  assert.equal(rec.firstSeen, '2026-11-01T00:00:00Z');
  assert.equal(rec.summary.id, 'a');
});

test('refresh: a live session updates its record without duplicating it', () => {
  const store = emptyStore();
  updateStore(store, all([session('a')]), '2026-11-01T00:00:00Z');
  assert.equal(updateStore(store, all([session('a')]), '2026-11-02T00:00:00Z'), false);
  assert.equal(updateStore(store, all([session('a', { turns: 5 })]), '2026-11-03T00:00:00Z'), true);
  const recs = Object.values(store.records);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].summary.turns, 5);
  assert.equal(recs[0].firstSeen, '2026-11-01T00:00:00Z');
  assert.equal(recs[0].lastSeen, '2026-11-03T00:00:00Z');
});

test('source gone: the session comes back with its figures marked from snapshot', () => {
  const store = emptyStore();
  updateStore(store, all([session('a'), session('b')]), '2026-11-01T00:00:00Z');
  const merged = mergeSnapshots(store, all([session('b')]));
  assert.equal(merged.cli.sessions.length, 2);
  const a = merged.cli.sessions.find((s) => s.id === 'a')!;
  assert.equal(a.fromSnapshot, true);
  assert.equal(a.tokens?.input, 10);
  assert.equal(a.tokens?.output, 5);
  assert.equal(a.tokens?.cached, undefined);
  assert.equal(a.credits, undefined);
  assert.equal(merged.cli.sessions.find((s) => s.id === 'b')!.fromSnapshot, undefined);
  // a merged read is not written back as a live record
  assert.equal(updateStore(store, merged, '2026-11-02T00:00:00Z'), false);
  assert.equal(Object.keys(store.records).length, 2);
});

test('same id in two sources and two variants stays two records', () => {
  const store = emptyStore();
  updateStore(store, all([session('a'), session('a', { source: 'chatSessions' }), session('a', { source: 'chatSessions', variant: 'Code' })]), 't');
  assert.equal(Object.keys(store.records).length, 3);
});

test('cap: the oldest records go first and the removal is counted', () => {
  const store = emptyStore();
  updateStore(store, all([
    session('old', { end: '2026-01-01T00:00:00Z' }),
    session('mid', { end: '2026-06-01T00:00:00Z' }),
    session('new', { end: '2026-11-01T00:00:00Z' }),
  ]), '2026-11-02T00:00:00Z');
  const one = storeBytes(store);
  const removed = enforceCap(store, Math.floor(one * 0.75), '2026-11-02T00:00:00Z');
  assert.ok(removed >= 1);
  assert.equal(store.trimmedTotal, removed);
  assert.equal(store.trimmedAt, '2026-11-02T00:00:00Z');
  const ids = Object.values(store.records).map((r) => r.summary.id);
  assert.ok(ids.includes('new'));
  assert.ok(!ids.includes('old'));
  assert.equal(enforceCap(store, 1e9, 't'), 0);
});

test('no message text: the snapshot file holds no sentinel text and no title', () => {
  const store = emptyStore();
  updateStore(store, all([session('a', { title: 'SENTINEL_TITLE', provenance: { tokens: 'cli' } })]), 't');
  const dir = fs.mkdtempSync(path.join(process.env.TEST_TMP ?? os.tmpdir(), 'snap-'));
  try {
    const file = path.join(dir, 'snapshots.json');
    saveStore(file, store);
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /SENTINEL_/);
    assert.equal(loadStore(file).records[Object.keys(store.records)[0]].summary.id, 'a');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('without Copilot data there is nothing to store; a missing file loads empty', () => {
  assert.equal(hasCopilotData(all([])), false);
  assert.equal(hasCopilotData(all([session('a')])), true);
  assert.equal(hasCopilotData(mergeSnapshots(updateAndStore(), all([]))), false);
  assert.deepEqual(loadStore('/nonexistent/snapshots.json'), emptyStore());
});

function updateAndStore() {
  const s = emptyStore();
  updateStore(s, all([session('a')]), 't');
  return s;
}
