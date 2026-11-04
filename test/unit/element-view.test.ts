import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { agentsMdInfo, editPrompt, readElement, splitMarkdown, tryCommand } from '../../src/readers/element-view';

test('agentsMdInfo: the root file follows chat.useAgentsMdFile, a nested file also chat.useNestedAgentsMdFiles', () => {
  const s = (a: boolean, n: boolean) => ({ useAgentsMdFile: { value: a, from: 'default' }, useNestedAgentsMdFiles: { value: n, from: 'user settings' } });
  const root = agentsMdInfo(path.join('r', 'AGENTS.md'), 'r', s(true, false));
  assert.equal(root.loaded, true);
  assert.equal(root.appliesTo, 'The whole repository');
  assert.equal(agentsMdInfo(path.join('r', 'AGENTS.md'), 'r', s(false, true)).loaded, false);
  const nested = agentsMdInfo(path.join('r', 'api', 'AGENTS.md'), 'r', s(true, false));
  assert.equal(nested.loaded, false);
  assert.match(nested.vscode, /useNestedAgentsMdFiles is off \(user settings\)/);
  assert.match(nested.appliesTo, /^api\/ and below/);
  assert.equal(agentsMdInfo(path.join('r', 'api', 'AGENTS.md'), 'r', s(true, true)).loaded, true);
});

test('splitMarkdown separates the frontmatter fields from the body', () => {
  const r = splitMarkdown('---\nname: a\ntools: [x, y]\n---\n# Title\ntext');
  assert.deepEqual(r.fields, [{ key: 'name', value: 'a' }, { key: 'tools', value: 'x, y' }]);
  assert.equal(r.body, '# Title\ntext');
  assert.equal(r.invalid, false);
});

test('splitMarkdown flags an unterminated block and keeps the text', () => {
  const r = splitMarkdown('---\nname: a\nbody');
  assert.equal(r.invalid, true);
  assert.deepEqual(r.fields, []);
});

test('readElement reads tools and applyTo, and never opens a .env file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'element-view-'));
  try {
    const md = path.join(dir, 'a.instructions.md');
    fs.writeFileSync(md, '---\napplyTo: "**/*.ts, **/*.tsx"\ntools: [read, edit]\n---\nBody');
    const d = await readElement(md, true);
    assert.deepEqual(d.applyTo, ['**/*.ts', '**/*.tsx']);
    assert.deepEqual(d.tools, ['read', 'edit']);
    assert.equal(d.body, 'Body');
    const env = path.join(dir, '.env');
    fs.writeFileSync(env, 'SECRET=1');
    const e = await readElement(env, false);
    assert.equal(e.body, '');
    assert.equal((await readElement(dir, false)).folder, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tryCommand starts agents and skills only, and refuses a name with shell characters', () => {
  assert.equal(tryCommand('agent', 'reviewer'), 'copilot --agent reviewer');
  assert.equal(tryCommand('skill', 'deploy'), 'copilot -i "/deploy"');
  assert.equal(tryCommand('prompt', 'x'), undefined);
  assert.equal(tryCommand('agent', 'a; rm -rf'), undefined);
  assert.match(editPrompt('agents', 'a', 'C:\\x\\a.md'), /Read C:\\x\\a\.md/);
});
