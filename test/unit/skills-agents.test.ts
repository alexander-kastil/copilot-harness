import { before, test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readHome, readWorkspace } from '../../src/readers/customizations';
import { agentsFileInfo, isAgentsFile } from '../../src/readers/element-view';
import { agentsReadBy, readOpenAi, skillInfo, skillLoaders, specProblems } from '../../src/readers/skill-facts';
import { readGlobalLock, readRepoLock, readSkillsState, skillsCommandLine, sourceOfSkill } from '../../src/readers/skill-locks';
import type { Env } from '../../src/readers/paths';

// Fixtures are written under out/test-tmp (inside the repo, never in a user folder); nothing here runs npx.
const repo = path.resolve(__dirname, '..', '..', '..');
const work = path.join(repo, 'out', 'test-tmp', 'skills-agents');
const home = path.join(work, 'home');
const proj = path.join(work, 'proj');
const env: Env = { home, platform: 'win32', appData: path.join(home, 'AppData', 'Roaming') };

const GOOD = '---\nname: good\ndescription: A good skill\nlicense: MIT\nmetadata:\n  author: me\n---\nBody\n';

const write = (file: string, text: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

before(() => {
  fs.rmSync(work, { recursive: true, force: true });
  // A repository: good in .agents and .claude, a skill named wrong, one without a description, one with a Codex file.
  write(path.join(proj, '.agents', 'skills', 'good', 'SKILL.md'), GOOD);
  write(path.join(proj, '.claude', 'skills', 'good', 'SKILL.md'), GOOD);
  write(path.join(proj, '.github', 'skills', 'Bad_Name', 'SKILL.md'), '---\nname: Bad_Name\ndescription: x\n---\n');
  write(path.join(proj, '.github', 'skills', 'nodesc', 'SKILL.md'), '---\nname: nodesc\n---\n');
  write(path.join(proj, '.agents', 'skills', 'codex', 'SKILL.md'), '---\nname: codex\ndescription: Has a Codex file\n---\n');
  write(path.join(proj, '.agents', 'skills', 'codex', 'agents', 'openai.yaml'), 'interface:\n  display_name: "Codex Skill"\npolicy:\n  allow_implicit_invocation: false\n');
  write(path.join(proj, 'skills-lock.json'), JSON.stringify({ version: 1, skills: { good: { source: 'acme/skills', sourceType: 'github', skillPath: 'good/SKILL.md', computedHash: 'abc' }, gone: { source: 'acme/skills', sourceType: 'github', computedHash: 'def' } } }));
  write(path.join(proj, 'AGENTS.md'), '# a\n');
  write(path.join(proj, 'AGENTS.override.md'), '# o\n');
  write(path.join(proj, 'AGENTS.local.md'), '# l\n');
  write(path.join(proj, 'api', 'AGENTS.override.md'), '# n\n');
  // A home: a global lock (version 3) with two skills, one on disk; Codex and Cline global AGENTS.md.
  write(path.join(home, '.agents', 'skills', 'here', 'SKILL.md'), '---\nname: here\ndescription: Installed globally\n---\n');
  write(path.join(home, '.agents', '.skill-lock.json'), JSON.stringify({ version: 3, skills: { here: { source: 'acme/globals', sourceType: 'github', sourceUrl: 'https://github.com/acme/globals.git', skillFolderHash: 'h1', updatedAt: '2026-01-02T00:00:00.000Z' }, away: { source: 'acme/globals', sourceType: 'github', skillFolderHash: 'h2' } } }));
  write(path.join(home, '.codex', 'AGENTS.md'), '# codex\n');
  write(path.join(home, '.agents', 'AGENTS.md'), '# cline\n');
});

test('who loads it: the agents that read the folder a skill sits in, per their docs', async () => {
  const at = (...p: string[]) => path.join(...p, 'x', 'SKILL.md');
  assert.deepEqual(skillLoaders(at(proj, '.agents', 'skills'), home).loadedBy, ['GitHub Copilot', 'Codex', 'Cursor', 'Gemini CLI', 'OpenCode']);
  assert.deepEqual(skillLoaders(at(proj, '.agents', 'skills'), home).notReadBy, ['Claude Code']);
  assert.deepEqual(skillLoaders(at(proj, '.claude', 'skills'), home).loadedBy, ['Claude Code', 'GitHub Copilot', 'Cursor', 'OpenCode']);
  assert.deepEqual(skillLoaders(at(home, '.claude', 'skills'), home).loadedBy, ['Claude Code', 'Cursor', 'OpenCode']);
  assert.deepEqual(skillLoaders(at(proj, '.github', 'skills'), home).loadedBy, ['GitHub Copilot']);
  assert.deepEqual(skillLoaders(at(home, '.copilot', 'skills'), home).loadedBy, ['GitHub Copilot']);
  assert.deepEqual(skillLoaders(at(home, '.agents', 'skills'), home).loadedBy, ['GitHub Copilot', 'Codex', 'Cursor', 'Gemini CLI', 'OpenCode']);
  // A skill copied to two folders is listed once, so the copy's readers count too: good is in .claude and .agents of the repository.
  assert.deepEqual((await skillInfo(path.join(proj, '.claude', 'skills', 'good', 'SKILL.md'), home, proj)).loadedBy, ['Claude Code', 'GitHub Copilot', 'Codex', 'Cursor', 'Gemini CLI', 'OpenCode']);
  assert.deepEqual((await skillInfo(path.join(proj, '.claude', 'skills', 'good', 'SKILL.md'), home, proj)).notReadBy, []);
  assert.deepEqual((await skillInfo(path.join(proj, '.github', 'skills', 'Bad_Name', 'SKILL.md'), home, proj)).loadedBy, ['GitHub Copilot']);
  // A plugin's folder is not one an agent is known to read by name: nothing is claimed.
  assert.deepEqual(skillLoaders(at(work, 'plugin', 'skills'), home), { loadedBy: [], notReadBy: [] });
});

test('spec check: name, description and the optional fields', () => {
  assert.deepEqual(specProblems('good', { name: 'good', description: 'ok', license: 'MIT', compatibility: 'x', metadata: { a: 'b' }, 'allowed-tools': 'Read Bash' }), []);
  assert.deepEqual(specProblems('good', { name: 'good', description: 'ok', 'allowed-tools': ['Read'] }), []);
  assert.deepEqual(specProblems('x', {}), ['name is required', 'description is required']);
  assert.ok(specProblems('Bad', { name: 'Bad', description: 'd' }).some((p) => /lowercase/.test(p)));
  assert.ok(specProblems('a--b', { name: 'a--b', description: 'd' }).some((p) => /single hyphens/.test(p)));
  assert.ok(specProblems('-a', { name: '-a', description: 'd' }).some((p) => /lowercase/.test(p)));
  assert.ok(specProblems('other', { name: 'good', description: 'd' }).some((p) => /must match the folder name/.test(p)));
  assert.ok(specProblems('a'.repeat(65), { name: 'a'.repeat(65), description: 'd' }).some((p) => /at most 64/.test(p)));
  assert.ok(specProblems('a', { name: 'a', description: 'd'.repeat(1025) }).some((p) => /at most 1024/.test(p)));
  assert.deepEqual(specProblems('a', { name: 'a', description: 'd'.repeat(1024) }), []);
  assert.ok(specProblems('a', { name: 'a', description: 'd', compatibility: 'c'.repeat(501) }).some((p) => /at most 500/.test(p)));
  assert.ok(specProblems('a', { name: 'a', description: 'd', metadata: { n: 1 } }).some((p) => /metadata/.test(p)));
  assert.ok(specProblems('a', { name: 'a', description: 'd', license: 3 }).some((p) => /license/.test(p)));
});

test('spec check: a skill that breaks the spec is reported like any file problem (status), and the page names why', async () => {
  const skills = (await readWorkspace({ workspaceFolders: [proj], parentLookup: false })).filter((i) => i.kind === 'skill' || i.kind === 'deterministic');
  const status = Object.fromEntries(skills.map((i) => [i.name, i.status]));
  assert.equal(status.good, 'ok');
  assert.equal(status.codex, 'ok');
  assert.equal(status.Bad_Name, 'invalid');
  assert.equal(status.nodesc, 'incomplete');
  const info = await skillInfo(path.join(proj, '.github', 'skills', 'Bad_Name', 'SKILL.md'), home, proj);
  assert.ok(info.problems.some((p) => /lowercase/.test(p)));
  assert.deepEqual((await skillInfo(path.join(proj, '.agents', 'skills', 'good', 'SKILL.md'), home, proj)).problems, []);
});

test('Codex file: agents/openai.yaml of a skill folder, with the implicit-invocation policy', async () => {
  const o = await readOpenAi(path.join(proj, '.agents', 'skills', 'codex', 'SKILL.md'));
  assert.ok(o);
  assert.equal(o.implicit, false);
  assert.deepEqual(o.fields, [
    { key: 'interface.display_name', value: 'Codex Skill' },
    { key: 'policy.allow_implicit_invocation', value: 'false' },
  ]);
  assert.equal(await readOpenAi(path.join(proj, '.agents', 'skills', 'good', 'SKILL.md')), undefined);
  assert.equal((await skillInfo(path.join(proj, '.agents', 'skills', 'codex', 'SKILL.md'), home, proj)).openai?.implicit, false);
  // implicit invocation is on unless the policy says false
  write(path.join(work, 'imp', 'SKILL.md'), '---\nname: imp\ndescription: d\n---\n');
  write(path.join(work, 'imp', 'agents', 'openai.yaml'), 'interface:\n  display_name: X\ndependencies:\n  tools:\n    - type: mcp\n      value: github\n');
  const imp = await readOpenAi(path.join(work, 'imp', 'SKILL.md'));
  assert.equal(imp?.implicit, true);
  assert.ok(imp?.fields.some((f) => f.key === 'dependencies.tools' && f.value.includes('github')));
});

test('locks: the global lock (version 3) and a repository lock (version 1), with what is on disk', async () => {
  const global = await readGlobalLock(home);
  assert.ok(global?.global);
  assert.deepEqual(global.skills.map((s) => [s.name, s.present, s.hash]), [['away', false, 'h2'], ['here', true, 'h1']]);
  assert.equal(global.skills[1].sourceUrl, 'https://github.com/acme/globals.git');
  const lock = await readRepoLock(proj);
  assert.deepEqual(lock?.skills.map((s) => [s.name, s.present, s.hash]), [['gone', false, 'def'], ['good', true, 'abc']]);
  // a lock of another version is ignored, as npx skills does
  write(path.join(work, 'old', 'skills-lock.json'), JSON.stringify({ version: 2, skills: { a: { source: 's', sourceType: 'github' } } }));
  assert.equal(await readRepoLock(path.join(work, 'old')), undefined);
  const state = await readSkillsState(home, [proj, path.join(work, 'old'), proj]);
  assert.deepEqual(state.locks.map((l) => l.global), [true, false]);
});

test('source of a skill: the npx source from the lock of its scope', async () => {
  const repoSource = await sourceOfSkill(path.join(proj, '.agents', 'skills', 'good', 'SKILL.md'), home, proj);
  assert.deepEqual([repoSource?.source, repoSource?.global, repoSource?.path, repoSource?.hash], ['acme/skills', false, proj, 'abc']);
  const globalSource = await sourceOfSkill(path.join(home, '.agents', 'skills', 'here', 'SKILL.md'), home, undefined);
  assert.deepEqual([globalSource?.source, globalSource?.global, globalSource?.path], ['acme/globals', true, home]);
  assert.equal(await sourceOfSkill(path.join(proj, '.agents', 'skills', 'codex', 'SKILL.md'), home, proj), undefined);
});

test('commands: check, update (global or project) and restore are fixed command lines; an unsafe name gives none', () => {
  assert.equal(skillsCommandLine('check', true), 'npx skills check');
  assert.equal(skillsCommandLine('update', true, 'here'), 'npx skills update here -g');
  assert.equal(skillsCommandLine('update', false, 'good'), 'npx skills update good -p');
  assert.equal(skillsCommandLine('update', false), 'npx skills update -p');
  assert.equal(skillsCommandLine('restore', false), 'npx skills experimental_install');
  assert.equal(skillsCommandLine('restore', true), undefined);
  assert.equal(skillsCommandLine('update', false, 'x; rm -rf'), undefined);
  assert.equal(skillsCommandLine('update', false, 'a b'), undefined);
});

test('AGENTS variants: AGENTS.override.md and AGENTS.local.md are listed, at the root and below; the global files too', async () => {
  const items = (await readWorkspace({ workspaceFolders: [proj], parentLookup: false })).filter((i) => i.kind === 'instruction');
  assert.deepEqual(items.map((i) => i.name).sort(), ['AGENTS.local.md', 'AGENTS.md', 'AGENTS.override.md', 'api/AGENTS.override.md']);
  const global = (await readHome(env)).filter((i) => i.kind === 'instruction');
  assert.deepEqual(global.map((i) => i.name).sort(), ['.agents/AGENTS.md', '.codex/AGENTS.md']);
  assert.ok(global.every((i) => i.scope === 'home'));
});

test('AGENTS variants: which agents read each file, per the vendor docs', () => {
  assert.ok(isAgentsFile(path.join(proj, 'AGENTS.override.md')) && isAgentsFile(path.join(proj, 'AGENTS.local.md')) && !isAgentsFile(path.join(proj, 'README.md')));
  assert.match(agentsReadBy(path.join(proj, 'AGENTS.md'), home) ?? '', /Codex.*Cursor.*OpenCode.*Claude Code reads it in place of CLAUDE\.md/);
  assert.match(agentsReadBy(path.join(proj, 'AGENTS.override.md'), home) ?? '', /^Codex.*Claude Code does not read it/);
  assert.match(agentsReadBy(path.join(proj, 'AGENTS.local.md'), home) ?? '', /No agent documents reading it/);
  assert.match(agentsReadBy(path.join(home, '.codex', 'AGENTS.md'), home) ?? '', /^Codex, as its global file/);
  assert.match(agentsReadBy(path.join(home, '.agents', 'AGENTS.md'), home) ?? '', /^Cline.*Only the Cline docs/);
  const settings = { useAgentsMdFile: { value: true, from: 'default' }, useNestedAgentsMdFiles: { value: false, from: 'default' } };
  const override = agentsFileInfo(path.join(proj, 'AGENTS.override.md'), proj, home, settings);
  assert.equal(override.loaded, false);
  assert.match(override.vscode, /AGENTS\.md only/);
  assert.ok(override.readBy);
  const globalInfo = agentsFileInfo(path.join(home, '.codex', 'AGENTS.md'), proj, home, settings);
  assert.equal(globalInfo.vscode, '');
  assert.equal(agentsFileInfo(path.join(proj, 'AGENTS.md'), proj, home, settings).loaded, true);
});
