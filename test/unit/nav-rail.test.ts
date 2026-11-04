import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeEntry, railCount, railEntries, railFromSaved, revealEntry } from '../../src/shared/nav-rail';
import type { RailInput } from '../../src/shared/nav-rail';

const input: RailInput = {
  copilot: { label: 'Copilot', count: 7, groups: [{ id: 'global|skill', label: 'Skills', glyph: 'tools', count: 4 }, { id: 'global|plugin', label: 'Plugins', glyph: 'extensions', count: 3 }] },
  repos: { label: 'Repositories', count: 2, repos: [{ id: 'D:/shop-api', label: 'shop-api', count: 5 }, { id: 'D:/shop-web', label: 'shop-web', count: 0 }] },
};

test('the nav is expanded unless the stored state says collapsed', () => {
  assert.equal(railFromSaved(undefined), false);
  assert.equal(railFromSaved({}), false);
  assert.equal(railFromSaved({ navRail: false }), false);
  assert.equal(railFromSaved({ navRail: true }), true);
});

test('the rail has a button per region and group, in nav order, with the counts of the nav', () => {
  const rows = railEntries(input).map((e) => `${e.level}:${e.id}:${e.count}`);
  assert.deepEqual(rows, ['0:region:copilot:7', '1:global|skill:4', '1:global|plugin:3', '0:region:repos:2', '1:repo:D:/shop-api:5', '1:repo:D:/shop-web:0']);
});

test('a nav without the Copilot region has only the repositories', () => {
  const rows = railEntries({ ...input, copilot: undefined }).map((e) => e.id);
  assert.ok(!rows.some((id) => id.includes('copilot') || id.startsWith('global')));
});

test('only the group of the open page is active', () => {
  assert.deepEqual(railEntries({ ...input, active: 'global|skill' }).filter((e) => e.active).map((e) => e.id), ['global|skill']);
  assert.deepEqual(railEntries({ ...input, active: 'repo:D:/shop-web' }).filter((e) => e.active).map((e) => e.id), ['repo:D:/shop-web']);
  assert.deepEqual(railEntries(input).filter((e) => e.active), []);
});

test('the open page maps to its group', () => {
  assert.equal(activeEntry({ kind: 'skill', scope: 'global' }), 'global|skill');
  assert.equal(activeEntry({ kind: 'skill', scope: 'D:/shop-api' }), 'repo:D:/shop-api');
  assert.equal(activeEntry({ scope: 'D:/shop-web' }), 'repo:D:/shop-web');
  assert.equal(activeEntry({ repo: 'D:/shop-web' }), 'repo:D:/shop-web');
  assert.equal(activeEntry({}), undefined);
});

test('pressing a rail button opens its region and group and closes nothing', () => {
  const folds = { expanded: new Set(['global|agent']), openRepos: new Set(['D:/shop-web']), foldedGroups: new Set(['region|copilot', 'region|repos', 'global|skill|where']) };
  const skills = railEntries(input).find((e) => e.id === 'global|skill')!;
  assert.equal(revealEntry(skills, folds), 's|global|skill');
  assert.deepEqual([...folds.expanded].sort(), ['global|agent', 'global|skill']);
  assert.ok(!folds.foldedGroups.has('region|copilot'));
  assert.ok(folds.foldedGroups.has('region|repos') && folds.foldedGroups.has('global|skill|where'), 'other regions and groups keep their fold');
  const repo = railEntries(input).find((e) => e.id === 'repo:D:/shop-api')!;
  assert.equal(revealEntry(repo, folds), 'p|D:/shop-api');
  assert.deepEqual([...folds.openRepos].sort(), ['D:/shop-api', 'D:/shop-web']);
  assert.ok(!folds.foldedGroups.has('region|repos'));
  assert.equal(revealEntry(railEntries(input)[0], folds), 'r|copilot');
});

test('a count wider than two digits is capped for the rail', () => {
  assert.equal(railCount(0), '0');
  assert.equal(railCount(99), '99');
  assert.equal(railCount(100), '99+');
});
