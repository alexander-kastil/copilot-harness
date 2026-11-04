import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCommitPrompt,
  buildPrPrompt,
  defaultCommitPrompt,
  hasAiCommitSettings,
  parsePrMessage,
  planMigration,
  providerIdFor,
  truncateDiff,
} from '../../src/shared/ai-commit';

test('commit prompt: gitmoji and plain guide, language, notes', () => {
  assert.match(defaultCommitPrompt('German', true), /<emoji> <type>/);
  assert.doesNotMatch(defaultCommitPrompt('German', false), /<emoji>/);
  assert.match(defaultCommitPrompt('German', false), /in German/);
  const p = buildCommitPrompt({ diff: 'diff --git a/x b/x\n+1', notes: 'fix login', language: 'English', gitmoji: false });
  assert.match(p.user, /^Notes from developer \(ignore if not relevant\): fix login\n\ndiff --git/);
});

test('commit prompt: a custom prompt replaces the guide and gets the language', () => {
  const p = buildCommitPrompt({ diff: 'd', language: 'French', gitmoji: true, customPrompt: 'Use Conventional Commits.' });
  assert.equal(p.system, 'Use Conventional Commits. Generate commit message in French.');
  assert.equal(p.user, 'd');
});

test('truncateDiff keeps whole files and names the rest', () => {
  const a = 'diff --git a/a.ts b/a.ts\n' + 'x'.repeat(50);
  const b = 'diff --git a/b.ts b/b.ts\n' + 'y'.repeat(50);
  const c = 'diff --git a/c.ts b/c.ts\n' + 'z'.repeat(50);
  const out = truncateDiff([a, b, c].join('\n'), 160);
  assert.ok(out.includes('a.ts') && out.includes('b.ts'));
  assert.match(out, /Not shown: c\.ts\]$/);
  assert.equal(truncateDiff('short', 120), 'short');
});

test('PR prompt lists branch, commits and diff; message splits title and body', () => {
  const p = buildPrPrompt({ branch: 'feat/x', base: 'origin/main', commits: ['add x\n\nbody'], diff: 'diff --git a/x b/x', language: 'English' });
  assert.match(p.system, /pull request titles/);
  assert.match(p.system, /in English\.$/);
  assert.match(p.user, /Branch feat\/x into origin\/main\./);
  assert.match(p.user, /Commits \(1\):\n- add x\n {2}body/);
  const m = parsePrMessage('<think>hm</think>\n```markdown\n# Add x\n\nSummary\n- one\n```');
  assert.equal(m.title, 'Add x');
  assert.equal(m.body, 'Summary\n- one');
  assert.equal(parsePrMessage('Title: Fix y').title, 'Fix y');
});

const owner = {
  AI_PROVIDER: 'openai',
  OPENAI_BASE_URL: 'https://api.deepinfra.com/v1/openai',
  OPENAI_MODEL: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  OPENAI_API_KEY: 'fake-key',
  OPENAI_TEMPERATURE: 0,
  AI_COMMIT_LANGUAGE: 'German',
  AI_COMMIT_SYSTEM_PROMPT: 'Conventional Commits only.',
};

test('migration maps provider, model, temperature, key, language and prompt', () => {
  assert.equal(providerIdFor('https://api.deepinfra.com/v1/openai', 'x'), 'deepinfra');
  assert.equal(providerIdFor('http://127.0.0.1:18765/v1', 'openai'), 'openai');
  assert.equal(providerIdFor('http://localhost:11434/v1', 'openai'), 'localhost');
  assert.ok(hasAiCommitSettings(owner));
  assert.ok(!hasAiCommitSettings({}));
  const plan = planMigration(owner, [])!;
  assert.equal(plan.provider.id, 'deepinfra');
  assert.equal(plan.provider.apiMode, 'openai');
  assert.equal(plan.model.id, 'meta-llama/Llama-3.3-70B-Instruct-Turbo');
  assert.equal(plan.model.baseUrl, 'https://api.deepinfra.com/v1/openai');
  assert.equal(plan.model.temperature, 0);
  assert.equal(plan.key, 'fake-key');
  assert.equal(plan.language, 'German');
  assert.equal(plan.prompt, 'Conventional Commits only.');
  assert.ok(plan.selectForCommit);
  assert.ok(!plan.summary.includes('fake-key'));
});

test('migration reuses a provider with the same URL and renames one with another URL', () => {
  const row = { id: 'm', owned_by: 'deepinfra', baseUrl: 'https://api.deepinfra.com/v1/openai' };
  assert.equal(planMigration(owner, [row])!.provider.id, 'deepinfra');
  assert.ok(planMigration(owner, [row])!.provider.reuse);
  const other = { id: 'm', owned_by: 'deepinfra', baseUrl: 'https://elsewhere.example/v1' };
  assert.equal(planMigration(owner, [other])!.provider.id, 'ai-commit-deepinfra');
});

test('migration of the Responses API, Claude and Gemini', () => {
  const r = planMigration({ AI_PROVIDER: 'openai', OPENAI_MODEL: 'o3', OPENAI_API_TYPE: 'response', OPENAI_REASONING_EFFORT: 'high' }, [])!;
  assert.equal(r.provider.apiMode, 'openai-responses');
  assert.equal(r.model.reasoning_effort, 'high');
  assert.equal(planMigration({ AI_PROVIDER: 'claude', CLAUDE_MODEL: 'claude-x' }, [])!.provider.apiMode, 'anthropic');
  const g = planMigration({ AI_PROVIDER: 'gemini', GEMINI_MODEL: 'gemini-x' }, [])!;
  assert.equal(g.selectForCommit, false);
  assert.equal(planMigration({ AI_PROVIDER: 'openai' }, []), undefined);
});
