import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { buildCatalog, descriptionOf, inventoryText, reconcile } from '../../src/readers/hunt-catalog';
import { applyProposal, parseTurn, proposalFrom, shortReply, unknownNames } from '../../src/readers/hunt';
import type { NavState } from '../../src/shared/nav';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hunt-cat-'));
  const write = (rel: string, text: string) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
  };
  const skill = (rel: string, name: string, body = 'Do it.') => write(`${rel}/${name}/SKILL.md`, `---\nname: ${name}\ndescription: Does ${name}\n---\n${body}\n`);
  const agent = (rel: string, name: string) => write(`${rel}/${name}.agent.md`, `---\nname: ${name}\ndescription: Agent ${name}\n---\nBody.\n`);
  const item = (name: string, file: string, extra: object = {}) => ({ name, file, status: 'ok' as const, readOnly: false, ...extra });
  const nav: NavState = {
    global: [
      { kind: 'skill', label: 'Orchestration skills', items: [item('alpha', skill('g/skills', 'alpha')), item('beta', skill('g/skills', 'beta')), item('shipped', skill('g/plugin/skills', 'shipped'), { readOnly: true, pluginId: 'kit@market' })] },
      { kind: 'deterministic', label: 'Deterministic skills', items: [item('gear', skill('g/skills', 'gear'))] },
      { kind: 'agent', label: 'Agents', items: [item('helper', agent('g/agents', 'helper'))] },
      { kind: 'subagent', label: 'Subagents', items: [item('helper', path.join(root, 'g/agents/helper.agent.md'))] },
      { kind: 'hook', label: 'Hooks', items: [item('hook1', path.join(root, 'g/hooks.json'))] },
    ],
    repos: [
      {
        path: path.join(root, 'r1'),
        name: 'r1',
        open: true,
        groups: [{ kind: 'skill', label: 'Orchestration skills', items: [item('alpha', skill('r1/.github/skills', 'alpha', 'Different.')), item('local', skill('r1/.github/skills', 'local'))] }],
        sessions: [],
      },
      { path: path.join(root, 'r2'), name: 'r2', open: false, groups: [{ kind: 'skill', label: 'Orchestration skills', items: [item('beta', skill('r2/.github/skills', 'beta', 'Changed.'))] }], sessions: [] },
    ],
    sessionsReady: true,
  };
  return { root, nav };
}

test('buildCatalog: skills and agents of Global and repos, copies compared, plugin copies only marked', () => {
  const { root, nav } = fixture();
  const cat = buildCatalog(nav);
  const by = (kind: string, name: string) => cat.find((c) => c.asset.kind === kind && c.asset.name === name)!;
  assert.deepEqual(cat.map((c) => `${c.asset.kind}:${c.asset.name}`), ['agent:helper', 'skill:alpha', 'skill:beta', 'skill:gear', 'skill:local']);
  // a deterministic skill is a skill; a subagent is its agent file, one element
  assert.equal(by('skill', 'gear').asset.kind, 'skill');
  assert.equal(cat.filter((c) => c.asset.name === 'helper').length, 1);
  // a plugin's own element is not offered
  assert.equal(cat.some((c) => c.asset.name === 'shipped'), false);
  const alpha = by('skill', 'alpha');
  assert.equal(alpha.description, 'Does alpha');
  assert.equal(alpha.asset.global?.path, path.join(root, 'g/skills/alpha'));
  assert.deepEqual(alpha.asset.repos.map((r) => [r.repo, r.same]), [['r1', false]]);
  // beta: global copy and a differing copy in r2
  assert.deepEqual(by('skill', 'beta').asset.repos.map((r) => [r.repo, r.same]), [['r2', false]]);
  // a repo-only element lists its copy as the first repo row and has no global copy
  const local = by('skill', 'local');
  assert.equal(local.asset.global, undefined);
  assert.deepEqual(local.asset.repos.map((r) => [r.repo, r.same]), [['r1', true]]);
  assert.equal(by('agent', 'helper').asset.global?.path, path.join(root, 'g/agents/helper.agent.md'));
});

test('buildCatalog: an element an installed plugin ships is marked inPlugin when the owner has a copy', () => {
  const { nav } = fixture();
  nav.repos[0].groups[0].items.push({ name: 'shipped', file: path.join(nav.repos[0].path, '.github/skills/shipped/SKILL.md'), status: 'ok', readOnly: false });
  fs.mkdirSync(path.join(nav.repos[0].path, '.github/skills/shipped'), { recursive: true });
  fs.writeFileSync(path.join(nav.repos[0].path, '.github/skills/shipped/SKILL.md'), '---\nname: shipped\ndescription: x\n---\n');
  const shipped = buildCatalog(nav).find((c) => c.asset.name === 'shipped')!;
  assert.equal(shipped.asset.inPlugin, 'kit');
});

test('inventoryText: one line per element with where it lives, open repos before others', () => {
  const { nav } = fixture();
  const lines = inventoryText(nav).split('\n');
  assert.ok(lines.includes('- skill alpha [global, r1]: Does alpha'));
  assert.ok(lines.includes('- skill beta [global, r2]: Does beta'));
  assert.ok(lines.includes('- agent helper [global]: Agent helper'));
  assert.equal(lines.length, buildCatalog(nav).length);
});

test('descriptionOf reads the frontmatter description and tolerates files without one', () => {
  const { root } = fixture();
  const plain = path.join(root, 'plain.md');
  fs.writeFileSync(plain, 'no frontmatter');
  assert.equal(descriptionOf(plain), '');
  assert.equal(descriptionOf(path.join(root, 'missing.md')), '');
});

test('reconcile re-reads paths and copies, keeps ticks where the path stays, and never re-reads a created card', () => {
  const { nav } = fixture();
  const cat = buildCatalog(nav);
  const card = proposalFrom({ name: 'My Plugin', description: 'd', category: '', assets: [{ kind: 'skill', name: 'alpha', why: 'w' }, { kind: 'skill', name: 'gone', why: '' }] }, 'p', cat, 'c1', 1);
  assert.equal(card.name, 'my-plugin');
  assert.deepEqual(card.assets.map((a) => a.name), ['alpha']);
  card.assets[0].global!.replace = true;
  card.assets[0].repos[0].replace = true;
  const same = reconcile([card], cat)[0];
  assert.equal(same.assets[0].global!.replace, true);
  assert.equal(same.assets[0].repos[0].replace, true);
  // the element vanished from the catalog: the card keeps it but it is unticked and has no copies
  const gone = reconcile([card], cat.filter((c) => c.asset.name !== 'alpha'))[0].assets[0];
  assert.equal(gone.include, false);
  assert.equal(gone.global, undefined);
  assert.deepEqual(gone.repos, []);
  assert.equal(reconcile([card], [], { c1: 'done' })[0], card);
});

test('parseTurn takes the JSON answer, or the text as the reply', () => {
  const t = parseTurn('noise {"reply":"Found 2.","proposal":{"name":"x","description":"d","category":"","assets":[{"kind":"skill","name":"alpha","why":"w","rename":"Alpha Two"}]},"create":true} tail');
  assert.equal(t.reply, 'Found 2.');
  assert.equal(t.create, true);
  assert.equal(t.proposal?.assets[0].rename, 'Alpha Two');
  assert.deepEqual(parseTurn('just words'), { reply: 'just words', create: false });
  assert.equal(shortReply('One. Two. Three.'), 'One. Two.');
});

test('applyProposal updates the card in place: ticks stay, a rename shows as `as`, unknown names are reported', () => {
  const { nav } = fixture();
  const cat = buildCatalog(nav);
  const first = applyProposal(undefined, { name: 'kit', description: 'd', category: '', assets: [{ kind: 'skill', name: 'alpha', why: '' }, { kind: 'skill', name: 'beta', why: '' }] }, 'p', cat, 'c1', 1);
  const sent = structuredClone(first);
  first.assets[1].include = false;
  first.name = 'owner-name';
  const next = applyProposal(first, { name: 'kit', description: 'd', category: '', assets: [{ kind: 'skill', name: 'alpha', why: '', rename: 'alpha-two' }, { kind: 'skill', name: 'beta', why: '' }, { kind: 'skill', name: 'nope', why: '' }] }, 'p', cat, 'c1', 2, sent);
  assert.equal(next.name, 'owner-name');
  assert.equal(next.assets[0].as, 'alpha-two');
  assert.equal(next.assets[1].include, false);
  assert.deepEqual(unknownNames({ name: '', description: '', category: '', assets: [{ kind: 'skill', name: 'nope', why: '' }] }, cat), ['nope']);
});
