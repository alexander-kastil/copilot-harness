import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { installPlugin, planCreate, retireCopies, unwritePlugin, writePlugin, type CliResult } from '../../src/readers/hunt-create';
import { layoutOf, readMarkets, sourceFor } from '../../src/readers/hunt-market';
import type { HuntAsset, HuntMarket, HuntProposal } from '../../src/shared/hunt';

function setup(catalog: object, where = path.join('.github', 'plugin', 'marketplace.json')) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hunt-create-'));
  const market = path.join(root, 'market');
  fs.mkdirSync(path.dirname(path.join(market, where)), { recursive: true });
  fs.writeFileSync(path.join(market, where), JSON.stringify(catalog, null, 2));
  const skill = path.join(root, 'global', 'skills', 'alpha');
  fs.mkdirSync(path.join(skill, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(skill, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: alpha\ndescription: Alpha\n---\nBody\n');
  fs.writeFileSync(path.join(skill, 'scripts', 'run.ps1'), 'echo hi');
  fs.writeFileSync(path.join(skill, 'node_modules', 'skipped.js'), 'x');
  const agent = path.join(root, 'global', 'agents', 'helper.agent.md');
  fs.mkdirSync(path.dirname(agent), { recursive: true });
  fs.writeFileSync(agent, '---\nname: helper\ndescription: Helps\n---\nHelp.\n');
  const repoCopy = path.join(root, 'repo', '.github', 'skills', 'alpha');
  fs.mkdirSync(repoCopy, { recursive: true });
  fs.writeFileSync(path.join(repoCopy, 'SKILL.md'), '---\nname: alpha\n---\nOther\n');
  const mk: HuntMarket = { name: 'mine', location: market, kind: 'local', owned: true, categorized: false, categories: [] };
  const a = (kind: 'skill' | 'agent', name: string, p: string, extra: Partial<HuntAsset> = {}): HuntAsset => ({ kind, name, include: true, why: '', global: { path: p, replace: false }, repos: [], ...extra });
  const card = (assets: HuntAsset[], extra: Partial<HuntProposal> = {}): HuntProposal => ({ id: 'c', prompt: '', created: 1, name: 'kit', description: 'A kit', category: '', assets, ...extra });
  return { root, market, mk, skill, agent, repoCopy, a, card, ctx: { root: path.join(root, 'copilot'), market: mk, backupRoot: path.join(root, 'backups') } };
}

const owner = { name: 'Owner', plugins: [{ name: 'old', source: './plugins/old', description: 'o' }] };

test('planCreate lists every file, the install target and the replaced copies', () => {
  const s = setup({ name: 'mine', owner: { name: 'Owner' }, plugins: [{ name: 'old', source: './plugins/old' }] });
  const asset = s.a('skill', 'alpha', s.skill, { repos: [{ repo: 'repo', path: s.repoCopy, same: false, replace: true }] });
  asset.global!.replace = true;
  const plan = planCreate(s.card([asset, s.a('agent', 'helper', s.agent)]), s.ctx);
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.source, './plugins/kit');
  assert.deepEqual(plan.files, [
    'plugins/kit/.github/plugin/plugin.json',
    'plugins/kit/skills/alpha/SKILL.md',
    'plugins/kit/skills/alpha/scripts/run.ps1',
    'plugins/kit/agents/helper.agent.md',
    'market/.github/plugin/marketplace.json (adds kit)',
  ]);
  assert.deepEqual(plan.retired, ['skill alpha in Global', 'skill alpha in repo']);
});

test('planCreate stops on a missing name, nothing ticked, a taken name, a bad rename and a gone element', () => {
  const s = setup(owner);
  assert.match(planCreate(s.card([s.a('skill', 'alpha', s.skill)], { name: '' }), s.ctx).problems.join(' '), /Give the plugin a name/);
  assert.match(planCreate(s.card([{ ...s.a('skill', 'alpha', s.skill), include: false }]), s.ctx).problems.join(' '), /Tick at least one/);
  assert.match(planCreate(s.card([s.a('skill', 'alpha', s.skill)], { name: 'old' }), s.ctx).problems.join(' '), /already has a plugin called old/);
  assert.match(planCreate(s.card([s.a('skill', 'alpha', s.skill, { as: 'Bad Name' })]), s.ctx).problems.join(' '), /not a valid name for alpha/);
  assert.match(planCreate(s.card([s.a('skill', 'alpha', path.join(s.root, 'nope'))]), s.ctx).problems.join(' '), /gone from disk/);
  assert.match(planCreate(s.card([s.a('skill', 'alpha', s.skill, { as: 'same' }), s.a('skill', 'beta', s.skill, { as: 'same' })]), s.ctx).problems.join(' '), /Two skills would be called same/);
  assert.match(planCreate(s.card([s.a('skill', 'alpha', s.skill)]), { ...s.ctx, market: { ...s.mk, owned: false } }).problems.join(' '), /not a marketplace folder of yours/);
});

test('planCreate on a marketplace with category folders needs a category and puts the plugin in it', () => {
  const s = setup({ name: 'mine', owner: { name: 'O' }, plugins: [{ name: 'a', source: './plugins/web/a' }, { name: 'b', source: './plugins/web/b' }] });
  const asset = s.a('skill', 'alpha', s.skill);
  assert.match(planCreate(s.card([asset]), s.ctx).problems.join(' '), /category folders/);
  const plan = planCreate(s.card([asset], { category: 'ops' }), s.ctx);
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.source, './plugins/ops/kit');
});

test('writePlugin writes the Copilot plugin: manifest, skills, agents, the catalog entry; a rename changes the name line', async () => {
  const s = setup({ name: 'mine', owner: { name: 'Owner', email: 'o@x.at' }, plugins: [{ name: 'old', source: './plugins/old', description: 'o' }] });
  const card = s.card([s.a('skill', 'alpha', s.skill, { as: 'alpha-two' }), s.a('agent', 'helper', s.agent)]);
  const plan = planCreate(card, s.ctx);
  await writePlugin(card, plan, s.mk);
  const dir = path.join(s.market, 'plugins', 'kit');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.github', 'plugin', 'plugin.json'), 'utf8'));
  assert.deepEqual(manifest, { name: 'kit', version: '0.1.0', description: 'A kit', author: { name: 'Owner', email: 'o@x.at' } });
  assert.match(fs.readFileSync(path.join(dir, 'skills', 'alpha-two', 'SKILL.md'), 'utf8'), /^---\nname: alpha-two\n/);
  assert.equal(fs.existsSync(path.join(dir, 'skills', 'alpha-two', 'scripts', 'run.ps1')), true);
  assert.equal(fs.existsSync(path.join(dir, 'skills', 'alpha-two', 'node_modules')), false);
  assert.match(fs.readFileSync(path.join(dir, 'agents', 'helper.agent.md'), 'utf8'), /name: helper/);
  const catalog = JSON.parse(fs.readFileSync(path.join(s.market, '.github', 'plugin', 'marketplace.json'), 'utf8'));
  assert.deepEqual(catalog.plugins.map((p: { name: string }) => p.name), ['old', 'kit']);
  assert.deepEqual(catalog.plugins[1], { name: 'kit', source: './plugins/kit', description: 'A kit' });
  // the source copy is untouched
  assert.match(fs.readFileSync(path.join(s.skill, 'SKILL.md'), 'utf8'), /name: alpha\n/);
  // undo puts the catalog back and removes the folder
  unwritePlugin(card, plan, s.mk);
  assert.equal(fs.existsSync(dir), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.market, '.github', 'plugin', 'marketplace.json'), 'utf8')).plugins.map((p: { name: string }) => p.name), ['old']);
});

test('writePlugin uses the catalog file the marketplace already has', async () => {
  const s = setup({ name: 'mine', owner: { name: 'O' }, plugins: [] }, path.join('.claude-plugin', 'marketplace.json'));
  const card = s.card([s.a('agent', 'helper', s.agent)]);
  const plan = planCreate(card, s.ctx);
  assert.ok(plan.files.includes('market/.claude-plugin/marketplace.json (adds kit)'));
  await writePlugin(card, plan, s.mk);
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.market, '.claude-plugin', 'marketplace.json'), 'utf8')).plugins[0].name, 'kit');
  assert.equal(fs.existsSync(path.join(s.market, '.github')), false);
});

test('retireCopies backs a copy up before it removes it', () => {
  const s = setup(owner);
  const asset = s.a('skill', 'alpha', s.skill);
  asset.global!.replace = true;
  const plan = planCreate(s.card([asset]), s.ctx);
  const backup = retireCopies(plan, s.ctx.backupRoot, 'stamp');
  assert.equal(fs.existsSync(s.skill), false);
  assert.equal(fs.existsSync(path.join(backup, path.relative(path.parse(s.skill).root, s.skill), 'SKILL.md')), true);
});

test('a copy inside the marketplace folder is kept, not replaced', () => {
  const s = setup(owner);
  const inside = path.join(s.market, 'plugins', 'old', 'skills', 'alpha');
  fs.mkdirSync(inside, { recursive: true });
  fs.writeFileSync(path.join(inside, 'SKILL.md'), '---\nname: alpha\n---\n');
  const asset = s.a('skill', 'alpha', s.skill, { repos: [{ repo: 'm', path: inside, same: false, replace: true }] });
  const plan = planCreate(s.card([asset]), s.ctx);
  assert.deepEqual(plan.retires, []);
  assert.match(plan.kept[0], /inside the marketplace folder/);
});

test('installPlugin refreshes the marketplace, installs, and checks copilot plugin list shows it', async () => {
  const s = setup(owner);
  const calls: string[] = [];
  const ok = (installed: boolean) => async (args: string[]): Promise<CliResult> => {
    calls.push(args.join(' '));
    if (args[1] === 'list') return { code: 0, out: JSON.stringify(installed ? [{ name: 'kit', marketplace: 'mine' }] : [{ name: 'other', marketplace: 'mine' }]) };
    return { code: 0, out: '' };
  };
  await installPlugin(s.card([]), s.mk, ok(true));
  assert.deepEqual(calls, ['plugin marketplace update mine', 'plugin install kit@mine', 'plugin list --json']);
  await assert.rejects(installPlugin(s.card([]), s.mk, ok(false)), /does not show the plugin/);
  await assert.rejects(installPlugin(s.card([]), s.mk, async () => ({ code: 1, out: 'boom\nPlugin not found' })), /Plugin not found/);
});

test('readMarkets: only a local folder with a marketplace.json is the owner\'s; the rest is listed with why not', () => {
  const s = setup({ name: 'mine', owner: { name: 'O' }, plugins: [{ name: 'a', source: './plugins/web/a' }, { name: 'b', source: './plugins/web/b' }] });
  const empty = path.join(s.root, 'empty');
  fs.mkdirSync(empty);
  const markets = readMarkets([
    { name: 'awesome-copilot', source: 'GitHub: github/awesome-copilot', isDefault: true },
    { name: 'empty', source: `Local: ${empty}` },
    { name: 'mine', source: `Local: ${s.market}` },
  ]);
  assert.deepEqual(markets.map((m) => [m.name, m.owned, m.kind]), [['mine', true, 'local'], ['awesome-copilot', false, 'github'], ['empty', false, 'local']]);
  assert.equal(markets[0].categorized, true);
  assert.deepEqual(markets[0].categories, ['web']);
  assert.match(markets[2].note ?? '', /no marketplace\.json/);
  assert.deepEqual(layoutOf([]), { categorized: false, root: 'plugins', categories: [] });
  assert.equal(sourceFor([{ name: 'x', source: './tools/x' }], 'kit', ''), './tools/kit');
});
