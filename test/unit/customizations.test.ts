import { before, test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CustomizationItem } from '../../src/shared/customizations';
import { parentFolders, readCopilotHome, readCustomizations, readHome, readUserProfile, readWorkspace } from '../../src/readers/customizations';
import { readInstalledPlugins } from '../../src/readers/customization-plugins';
import { parseFrontmatter } from '../../src/readers/frontmatter';
import type { Env } from '../../src/readers/paths';

// out/test/unit -> repo root. The fixtures stay in test/fixtures; a .git marker cannot be committed,
// so the tree is copied under out/ and the marker is created there.
const repo = path.resolve(__dirname, '..', '..', '..');
const source = path.join(repo, 'test', 'fixtures', 'customizations');
const work = path.join(repo, 'out', 'test-tmp', 'customizations');
const mono = path.join(work, 'mono');
const app = path.join(mono, 'packages', 'app');
const home = path.join(work, 'home');
const env: Env = { home, platform: 'win32', appData: path.join(home, 'AppData', 'Roaming') };

before(() => {
  fs.rmSync(work, { recursive: true, force: true });
  fs.cpSync(source, work, { recursive: true });
  fs.mkdirSync(path.join(mono, '.git'));
});

const pick = (items: CustomizationItem[], kind: string) => items.filter((i) => i.kind === kind).map((i) => `${i.name}:${i.status}`).sort();

test('workspace scope: one item per customization with kind, scope and status', async () => {
  const items = await readWorkspace({ workspaceFolders: [app], parentLookup: false });
  assert.equal(items.length, 36);
  assert.ok(items.every((i) => (i.scope === 'workspace' || i.scope === 'plugin') && !i.inParent));
  // General instructions: always-on files and rules without paths; stack-specific: applyTo files and the folders the setting names.
  assert.deepEqual(pick(items, 'instruction'), ['.copilot-instructions.md:ok', 'AGENTS.md:ok', 'a11y:ok', 'all:ok', 'r:ok', 'src/api/AGENTS.md:ok']);
  assert.deepEqual(pick(items, 'stack'), ['TypeScript:ok', 'py:ok']);
  assert.deepEqual(pick(items, 'agent'), ['Coder:ok', 'Hooked:ok', 'PlugAgent:ok', 'Quiet:ok', 'broken:invalid']);
  assert.deepEqual(pick(items, 'subagent'), ['Coder:ok', 'Hooked:ok', 'PlugAgent:ok']);
  assert.deepEqual(pick(items, 'plugin'), ['plug:ok']);
  assert.deepEqual(pick(items, 'deterministic'), ['det:ok']);
  assert.deepEqual(pick(items, 'agentic'), ['triage:ok']);
  assert.deepEqual(pick(items, 'ci'), ['ci.yml:ok']);
  assert.deepEqual(pick(items, 'env'), ['.devcontainer/devcontainer.json:ok', 'copilot-setup-steps.yml:ok']);
  assert.deepEqual(pick(items, 'governance'), ['CODEOWNERS:ok']);
  assert.deepEqual(pick(items, 'prompt'), ['open:invalid', 'plan:ok']);
  assert.deepEqual(pick(items, 'skill'), ['halfdet:ok', 'noname:incomplete', 's1:ok']);
  assert.deepEqual(pick(items, 'hook'), ['Hooked hooks:ok', 'broken.json:invalid', 'guard.json:ok', 'scanner:ok', 'settings.json hooks:ok']);
  assert.deepEqual(pick(items, 'mcp'), ['alpha:ok', 'beta:ok', 'pm:ok']);
  const coder = items.find((i) => i.name === 'Coder')!;
  assert.deepEqual(coder.keys, ['name', 'description', 'tools', 'model']);
  assert.equal(typeof coder.mtime, 'number');
});

test('malformed frontmatter yields an item with a status, never an exception', async () => {
  assert.equal(parseFrontmatter('---\nname: [x\n---\n').ok, false);
  assert.equal(parseFrontmatter('---\nname: x\n').ok, false);
  assert.equal(parseFrontmatter('---\n- a\n- b\n---\n').ok, false);
  assert.deepEqual(parseFrontmatter('no frontmatter'), { ok: true, present: false, keys: [] });
  const items = await readWorkspace({ workspaceFolders: [app, path.join(work, 'does-not-exist')], parentLookup: true });
  assert.ok(items.some((i) => i.name === 'broken' && i.kind === 'agent' && i.status === 'invalid'));
});

test('parent lookup off: only the workspace folder is read', async () => {
  const items = await readWorkspace({ workspaceFolders: [app], parentLookup: false });
  assert.ok(!items.some((i) => i.name === 'rootskill' || /[\\/]\.github[\\/]copilot-instructions\.md$/.test(i.file)));
});

test('parent lookup on: customizations up to the repo root are added and marked', async () => {
  assert.deepEqual(await parentFolders(app), [path.join(mono, 'packages'), mono]);
  assert.deepEqual(await parentFolders(mono), []);
  const items = await readWorkspace({ workspaceFolders: [app], parentLookup: true });
  assert.equal(items.length, 39);
  const parents = items.filter((i) => i.inParent).map((i) => i.name).sort();
  assert.deepEqual(parents, ['copilot-instructions.md', 'root', 'rootskill']);
  assert.ok(items.filter((i) => !i.inParent).length === 36);
});

test('parent lookup stops at the first folder with .git', async () => {
  const chain = await parentFolders(path.join(work, 'home', '.copilot'));
  assert.equal(chain[chain.length - 1], repo);
  assert.ok(!chain.includes(path.dirname(repo)));
});

test('two workspace folders of one repo do not duplicate the parent items', async () => {
  const other = path.join(mono, 'packages', 'lib');
  fs.mkdirSync(other, { recursive: true });
  const items = await readWorkspace({ workspaceFolders: [app, other], parentLookup: true });
  assert.equal(items.filter((i) => i.name === 'rootskill').length, 1);
});

test('user profile scope: prompts and mcp.json of the variant and its profiles', async () => {
  const items = await readUserProfile(env);
  assert.equal(items.length, 5);
  assert.ok(items.every((i) => i.scope === 'userProfile'));
  assert.deepEqual(pick(items, 'agent'), ['UserAgent:ok']);
  assert.deepEqual(pick(items, 'mcp'), ['epsilon:ok']);
  assert.deepEqual(items.filter((i) => i.kind === 'prompt').map((i) => i.origin).sort(), ['Code', 'Code/work']);
});

test('copilot home and home scopes', async () => {
  const c = await readCopilotHome(env);
  assert.deepEqual(c.map((i) => `${i.kind}:${i.name}`).sort(), ['instruction:h', 'mcp:gamma', 'skill:hs']);
  assert.ok(c.every((i) => i.scope === 'copilotHome'));
  const h = await readHome(env);
  assert.deepEqual(h.map((i) => i.name).sort(), ['as', 'cs']);
  assert.ok(h.every((i) => i.scope === 'home'));
});

test('installed plugin items are read-only and name their plugin; disabled state follows settings.json', async () => {
  const items = await readInstalledPlugins(env);
  assert.equal(items.length, 10);
  assert.ok(items.every((i) => i.scope === 'plugin' && i.readOnly && i.pluginId));
  const p1 = items.filter((i) => i.pluginId === 'p1@mk');
  assert.deepEqual(p1.map((i) => `${i.kind}:${i.name}`).sort(), ['agent:pa', 'hook:hooks.json', 'mcp:delta', 'plugin:p1', 'skill:ps']);
  assert.ok(p1.every((i) => i.status === 'ok'));
  const p2 = items.filter((i) => i.pluginId === 'p2@mk');
  assert.equal(p2.length, 2);
  assert.ok(p2.every((i) => i.status === 'disabled'));
  assert.deepEqual(items.filter((i) => i.pluginId === 'direct@_direct').map((i) => `${i.kind}:${i.name}`).sort(), ['plugin:direct', 'skill:ds']);
  const unlisted = items.filter((i) => i.pluginId === 'unlisted@mk');
  assert.deepEqual(unlisted.map((i) => `${i.kind}:${i.status}`), ['plugin:invalid']);
});

test('the whole inventory is the union of the scopes', async () => {
  const inv = await readCustomizations(env, { workspaceFolders: [app], parentLookup: false });
  assert.equal(inv.items.length, 36 + 5 + 3 + 2 + 10 + 2);
});

test('a missing home and no workspace give an empty inventory without error', async () => {
  const inv = await readCustomizations({ home: path.join(work, 'nope'), platform: 'win32' }, { workspaceFolders: [], parentLookup: true });
  assert.deepEqual(inv.items, []);
});

test('no file text reaches the items', async () => {
  const inv = await readCustomizations(env, { workspaceFolders: [app], parentLookup: true });
  assert.ok(!JSON.stringify(inv).includes('SENTINEL'));
});

test('Copilot Memory: one item per repository with a GitHub remote, its switch and its settings page; the local store when present', async () => {
  const repoDir = path.join(work, 'memrepo');
  fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, '.vscode'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, '.git', 'config'), '[core]\n\turl = nope\n[remote "upstream"]\n\turl = https://example.com/x/y.git\n[remote "origin"]\n\turl = git@github.com:acme/shop.git\n');
  fs.writeFileSync(path.join(repoDir, '.vscode', 'settings.json'), '{ // on\n "chat.copilot.memory.enabled": true }\n');
  fs.writeFileSync(path.join(repoDir, '.github', 'copilot-memories.jsonl'), 'SENTINEL_MEMORY\n');
  const items = (await readWorkspace({ workspaceFolders: [repoDir], parentLookup: false })).filter((i) => i.kind === 'memory');
  assert.deepEqual(items.map((i) => i.name).sort(), ['acme/shop: memory on', 'copilot-memories.jsonl']);
  assert.equal(items.find((i) => i.url)?.url, 'https://github.com/acme/shop/settings/copilot/memory');
  assert.ok(!JSON.stringify(items).includes('SENTINEL'));
});

test('a skill installed in two skill folders is listed once, from the first folder', async () => {
  const dupDir = path.join(work, 'dupskill');
  for (const folder of [['.claude', 'skills'], ['.agents', 'skills']]) {
    fs.mkdirSync(path.join(dupDir, ...folder, 'twin'), { recursive: true });
    fs.writeFileSync(path.join(dupDir, ...folder, 'twin', 'SKILL.md'), '---\nname: twin\ndescription: Same skill\n---\nBody\n');
  }
  fs.mkdirSync(path.join(dupDir, '.agents', 'skills', 'solo'), { recursive: true });
  fs.writeFileSync(path.join(dupDir, '.agents', 'skills', 'solo', 'SKILL.md'), '---\nname: solo\ndescription: Only here\n---\nBody\n');
  const skills = (await readWorkspace({ workspaceFolders: [dupDir], parentLookup: false })).filter((i) => i.kind === 'skill');
  assert.deepEqual(skills.map((i) => i.name).sort(), ['solo', 'twin']);
  assert.ok(skills.find((i) => i.name === 'twin')!.file.includes('.claude'));

  // The home scope: npx skills add -g copies a skill to ~/.claude/skills and ~/.agents/skills.
  const dupHome = path.join(work, 'duphome');
  for (const folder of [['.claude', 'skills'], ['.agents', 'skills']]) {
    fs.mkdirSync(path.join(dupHome, ...folder, 'twin'), { recursive: true });
    fs.writeFileSync(path.join(dupHome, ...folder, 'twin', 'SKILL.md'), '---\nname: twin\ndescription: Same skill\n---\nBody\n');
  }
  const homeSkills = (await readHome({ ...env, home: dupHome })).filter((i) => i.kind === 'skill');
  assert.deepEqual(homeSkills.map((i) => i.name), ['twin']);
  assert.ok(homeSkills[0].file.includes('.claude'));
});
