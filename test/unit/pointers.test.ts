import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { checkedDocs, closest, deadPointers, importsOf, pathCandidates, pointerTokens, type Roster } from '../../src/readers/pointers';

const roster: Roster = { skills: new Set(['deploy-site', 'plug:review']), agents: new Set(['docs-agent']) };

function repo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(process.env.TEST_TMP ?? os.tmpdir(), 'agentsmd-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

test('pointerTokens finds paths and names next to the word skill or agent, not fenced ones', () => {
  const t = pointerTokens('Use the `deploy-site` skill.\nAsk agent `docs-agent`.\nSee `docs/a.md`.\n```\nskill `fenced`\n```\nPlain `word`.');
  assert.deepEqual(t.map((x) => [x.kind, x.token, x.line]), [['skill', 'deploy-site', 0], ['agent', 'docs-agent', 1], ['path', 'docs/a.md', 2]]);
});

test('deadPointers reports a missing skill, agent and path, and keeps the existing ones', () => {
  const dir = repo({ 'docs/a.md': 'x' });
  try {
    const text = 'skill `deploy-sit`\nagent `docs-agnt`\n`docs/b.md`\n`docs/a.md`\nskill `deploy-site`\nskill `plug:review`\nagent `docs-agent`';
    const dead = deadPointers(text, dir, roster);
    assert.deepEqual(dead.map((d) => [d.kind, d.token]), [['skill', 'deploy-sit'], ['agent', 'docs-agnt'], ['path', 'docs/b.md']]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('closest and pathCandidates suggest the nearest names', () => {
  assert.deepEqual(closest('deploy-sit', roster.skills), ['deploy-site']);
  const dir = repo({ 'docs/guide.md': 'x', 'src/other.ts': 'y' });
  try {
    assert.equal(pathCandidates('old/guide.md', dir)[0], 'docs/guide.md');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('checkedDocs takes every AGENTS.md, nested ones included, and the markdown files they import, nothing else', () => {
  const dir = repo({ 'AGENTS.md': 'See @docs/rules.md and `@no`', 'docs/rules.md': '@more.md', 'docs/more.md': 'x', 'CLAUDE.md': 'x', 'sub/AGENTS.md': 'x' });
  try {
    assert.deepEqual(checkedDocs(dir).map((d) => path.relative(dir, d.file).replace(/\\/g, '/')), ['AGENTS.md', 'docs/rules.md', 'docs/more.md', 'sub/AGENTS.md']);
    assert.equal(checkedDocs(path.join(dir, 'sub')).length, 1);
    assert.deepEqual(importsOf('a @x.md\n```\n@y.md\n```'), ['x.md']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
