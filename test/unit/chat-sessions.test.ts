import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readChatSessions } from '../../src/readers/chat-sessions';
import { ScanIndex } from '../../src/readers/scan-index';
import { Env } from '../../src/readers/paths';
import { SessionSummary } from '../../src/shared/session-model';

const fixtureRoot = path.resolve(__dirname, '..', '..', '..', 'test', 'fixtures', 'chat-sessions');
const env: Env = { home: fixtureRoot, platform: 'win32', appData: path.join(fixtureRoot, 'appdata') };

test('lists sessions with workspace, time range, turns, models, tokens and credits', async () => {
  const r = await readChatSessions(env);
  assert.equal(r.sessions.length, 3);
  const s1 = r.sessions.find((s) => s.id === 'sess-1')!;
  assert.equal(s1.workspace, 'c:/work/SENTINEL proj');
  assert.equal(s1.variant, 'Code');
  assert.equal(s1.turns, 2);
  assert.deepEqual(s1.models, ['copilot/claude-haiku-4.5', 'copilot/auto']);
  assert.deepEqual(s1.tokens, { input: 1050, output: 207, cached: undefined });
  assert.equal(s1.credits, 15.5);
  assert.equal(s1.toolCalls, 1);
  assert.equal(s1.start, new Date(1767026421052).toISOString());
  assert.equal(s1.end, new Date(1767026800000).toISOString());
  assert.equal(s1.title, 'SENTINEL_TITLE');
});

test('a truncated last line and an unknown record kind are counted, not thrown', async () => {
  const r = await readChatSessions(env);
  assert.equal(r.sessions.find((s) => s.id === 'sess-1')!.skipped, 2);
  assert.ok(r.skipped >= 2);
});

test('missing credit and token fields give undefined, not zero', async () => {
  const r = await readChatSessions(env);
  const s2 = r.sessions.find((s) => s.id === 'sess-2')!;
  assert.equal(s2.credits, undefined);
  assert.deepEqual(s2.tokens, { input: 40, output: 5, cached: undefined });
  assert.equal(s2.workspace, 'c:/work/multi.code-workspace');
  const s3 = r.sessions.find((s) => s.id === 'sess-3')!;
  assert.equal(s3.credits, undefined);
  assert.equal(s3.tokens, undefined);
  assert.equal(s3.detail, 'none');
});

test('no prompt, response or title sentinel text of a turn leaks except the stored title', async () => {
  const r = await readChatSessions(env);
  const json = JSON.stringify(r);
  assert.doesNotMatch(json, /SENTINEL_PROMPT|SENTINEL_RESPONSE/);
});

test('missing user data folders return an empty result', async () => {
  const r = await readChatSessions({ home: '/nonexistent', platform: 'win32', appData: '/nonexistent/app' });
  assert.deepEqual(r.sessions, []);
  assert.equal(r.skipped, 0);
  assert.ok(r.roots.length > 0);
});

test('a second scan of unchanged files reads no file content', async () => {
  const tmp = fs.mkdtempSync(path.join(process.env.TEST_TMP ?? os.tmpdir(), 'chat-'));
  try {
    fs.cpSync(path.join(fixtureRoot, 'appdata'), path.join(tmp, 'appdata'), { recursive: true });
    const e: Env = { home: tmp, platform: 'win32', appData: path.join(tmp, 'appdata') };
    const index = new ScanIndex<SessionSummary>();
    const first = await readChatSessions(e, index);
    assert.equal(first.sessions.length, 3);
    const reads: string[] = [];
    const real = fs.promises.readFile;
    (fs.promises as { readFile: unknown }).readFile = (p: unknown, ...rest: unknown[]) => {
      reads.push(String(p));
      return (real as (...a: unknown[]) => Promise<unknown>)(p, ...rest);
    };
    try {
      const second = await readChatSessions(e, index);
      assert.equal(second.sessions.length, 3);
      assert.deepEqual(reads.filter((p) => p.includes('chatSessions')), []);
    } finally {
      (fs.promises as { readFile: unknown }).readFile = real;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
