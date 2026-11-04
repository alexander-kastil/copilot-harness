import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { AllSessions } from '../../src/readers/all-sessions';
import { computeOverview, folderOf, mergeSessions, repositoryFolders } from '../../src/readers/overview';
import type { CustomizationItem } from '../../src/shared/customizations';
import type { ReadResult, SessionDetail, SessionSource, SessionSummary } from '../../src/shared/session-model';

const NOW = Date.parse('2026-11-04T12:00:00Z');
const H = 3_600_000;
const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * H).toISOString();

const session = (source: SessionSource, id: string, detail: SessionDetail, extra: Partial<SessionSummary> = {}): SessionSummary => ({
  source,
  id,
  file: `fixture/${id}`,
  turns: 2,
  models: [],
  tokens: undefined,
  credits: undefined,
  detail,
  provenance: {},
  skipped: 0,
  ...extra,
});

const result = (source: SessionSource, sessions: SessionSummary[]): ReadResult => ({ source, sessions, roots: [], skipped: 0 });
const all = (parts: Partial<Record<SessionSource, SessionSummary[]>>): AllSessions => ({
  chatSessions: result('chatSessions', parts.chatSessions ?? []),
  debugLogs: result('debugLogs', parts.debugLogs ?? []),
  traceDb: result('traceDb', parts.traceDb ?? []),
  cli: result('cli', parts.cli ?? []),
});

const item = (kind: CustomizationItem['kind'], name: string, scope: CustomizationItem['scope'], file: string, mtime: number | undefined, pluginId?: string): CustomizationItem => ({
  kind,
  name,
  scope,
  file,
  mtime,
  readOnly: scope === 'plugin',
  status: 'ok',
  ...(pluginId ? { pluginId } : {}),
});

const APP = process.platform === 'win32' ? 'C:\\work\\app' : '/work/app';
const LIB = process.platform === 'win32' ? 'C:\\work\\lib' : '/work/lib';
const uri = (p: string) => (process.platform === 'win32' ? `file:///${p.replace(/\\/g, '/')}` : `file://${p}`);

test('folderOf reads file URIs and plain paths, nothing else', () => {
  assert.equal(folderOf(uri(APP)), APP);
  assert.equal(folderOf(APP), APP);
  assert.equal(folderOf('vscode-remote://ssh-remote+x/home/a'), undefined);
  assert.equal(folderOf(undefined), undefined);
});

test('a session in two sources is one row from the richest source, filled in from the other', () => {
  const merged = mergeSessions(
    all({
      chatSessions: [session('chatSessions', 's1', 'perTurn', { title: 'Stored title', workspace: uri(APP), start: iso(3), end: iso(2), models: ['m1'] })],
      traceDb: [session('traceDb', 's1', 'perCall', { nanoAiu: 2.5e9, tokens: { input: 100, output: 50, cached: undefined }, start: iso(3), end: iso(2) })],
    })
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, 'traceDb');
  assert.equal(merged[0].title, 'Stored title');
  assert.equal(merged[0].workspace, uri(APP));
  assert.deepEqual(merged[0].models, ['m1']);
});

test('session rows: newest first, credits and tokens blank when undefined, never 0', () => {
  const state = computeOverview({
    all: all({
      chatSessions: [session('chatSessions', 'old', 'perTurn', { start: iso(30), end: iso(29) })],
      cli: [session('cli', 'new', 'totalsOnly', { start: iso(2), end: iso(1), credits: 0 })],
      traceDb: [session('traceDb', 'mid', 'perCall', { nanoAiu: 1.5e9, tokens: { input: 10, output: undefined, cached: undefined }, start: iso(5), end: iso(4) })],
    }),
    sessionsReady: true,
    globalItems: [],
    openFolders: [],
    repoItems: {},
    now: NOW,
  });
  assert.deepEqual(state.sessions.map((s) => s.id), ['new', 'mid', 'old']);
  const [n, m, o] = state.sessions;
  assert.equal(n.credits, 0, 'a source that says 0 stays 0');
  assert.equal(m.credits, 1.5);
  assert.equal(m.tokens, 10);
  assert.equal(o.credits, undefined);
  assert.equal(o.tokens, undefined);
  assert.equal(state.sessionsReady, true);
});

test('tiles count global items per kind; the header counts follow', () => {
  const state = computeOverview({
    all: all({}),
    sessionsReady: false,
    globalItems: [item('skill', 'a', 'home', '/h/a', 1), item('skill', 'b', 'plugin', '/p/b', 2, 'p@m'), item('mcp', 'x', 'userProfile', '/u/mcp.json', 3)],
    openFolders: [APP],
    repoItems: { [APP]: [item('agent', 'coder', 'workspace', `${APP}/.github/agents/coder.agent.md`, 4)] },
    now: NOW,
  });
  const by = Object.fromEntries(state.tiles.map((t) => [t.kind, t.count]));
  assert.deepEqual(by, { instruction: 0, prompt: 0, agent: 0, skill: 2, hook: 0, mcp: 1, plugin: 0 });
  assert.equal(state.globalAssets, 3);
  assert.equal(state.repositories, 1);
  assert.equal(state.sessionsReady, false);
});

test('repositories: open folders plus folders the sessions name, with 7-day figures and the last session', () => {
  const a = all({
    chatSessions: [
      session('chatSessions', 'r1', 'perTurn', { workspace: uri(LIB), start: iso(10), end: iso(9), nanoAiu: 2e9 }),
      session('chatSessions', 'r2', 'perTurn', { workspace: uri(LIB), start: iso(24 * 9), end: iso(24 * 9 - 1), credits: 5 }),
      session('chatSessions', 'r3', 'perTurn', { workspace: uri(LIB), start: iso(8), end: iso(7) }),
    ],
  });
  assert.deepEqual(repositoryFolders(a, [APP]), [APP, LIB]);
  const state = computeOverview({
    all: a,
    sessionsReady: true,
    globalItems: [],
    openFolders: [APP],
    repoItems: {
      [APP]: [item('instruction', 'AGENTS.md', 'workspace', `${APP}/AGENTS.md`, 5), item('skill', 's', 'workspace', `${APP}/.github/skills/s/SKILL.md`, 6)],
      [LIB]: [],
    },
    now: NOW,
  });
  const [open, lib] = state.repos;
  assert.equal(open.name, 'app');
  assert.equal(open.open, true);
  assert.deepEqual(open.counts, { instruction: 1, skill: 1 });
  assert.equal(open.sessions7d, 0);
  assert.equal(open.credits7d, undefined);
  assert.equal(open.lastSession, undefined);
  assert.equal(lib.open, false);
  assert.equal(lib.sessions7d, 2);
  assert.equal(lib.credits7d, 2, 'only sessions in the last 7 days with a figure count');
  assert.equal(lib.lastSession, iso(7));
});

test('recently changed: newest first over every scope, items without a time left out', () => {
  const state = computeOverview({
    all: all({}),
    sessionsReady: true,
    globalItems: [item('skill', 'old', 'home', '/h/old', 1000), item('agent', 'p-agent', 'plugin', '/p/a', 3000, 'p@m'), item('hook', 'nodate', 'copilotHome', '/c/h', undefined)],
    openFolders: [APP],
    repoItems: { [APP]: [item('prompt', 'plan', 'workspace', `${APP}/.github/prompts/plan.prompt.md`, 2000)] },
    now: NOW,
  });
  assert.deepEqual(state.changed.map((c) => c.name), ['p-agent', 'plan', 'old']);
  assert.deepEqual(state.changed.map((c) => c.scopeLabel), ['p@m', 'app', 'Home']);
});

test('nothing at all gives an empty page without error', () => {
  const state = computeOverview({ all: all({}), sessionsReady: true, globalItems: [], openFolders: [], repoItems: {}, now: NOW });
  assert.deepEqual([state.sessions, state.repos, state.changed], [[], [], []]);
  assert.equal(state.tiles.length, 7);
});
