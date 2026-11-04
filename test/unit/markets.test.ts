import { before, test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { catalogFile, compareVersions, planRename, readMarkets, renameCatalog, renameInSettings } from '../../src/readers/markets';
import { readInstalledPlugins } from '../../src/readers/customization-plugins';
import type { Env } from '../../src/readers/paths';

// out/test/unit -> repo root. Everything is built under out/test-tmp/markets: a Copilot home with a local marketplace of two
// plugins (alpha is installed as a copy at 0.9.0 while its source says 1.1.0, beta runs live), a github marketplace and VS Code's list.
const repo = path.resolve(__dirname, '..', '..', '..');
const work = path.join(repo, 'out', 'test-tmp', 'markets');
const home = path.join(work, 'home');
const mk = path.join(work, 'mk');
const env: Env = { home, platform: 'win32', appData: path.join(home, 'AppData', 'Roaming') };
const copilot = path.join(home, '.copilot');

const put = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

before(() => {
  fs.rmSync(work, { recursive: true, force: true });
  put(path.join(mk, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'scratch-market', plugins: [{ name: 'alpha', source: './plugins/alpha', description: 'Alpha plugin', version: '1.1.0' }, { name: 'beta', source: './plugins/beta' }, { name: 'gamma', source: './plugins/gamma', version: '2.0.0' }] }, null, 2));
  put(path.join(mk, 'plugins', 'alpha', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'alpha', version: '1.1.0' }));
  put(path.join(mk, 'plugins', 'beta', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'beta', version: '1.0.0', description: 'Beta from its manifest' }));
  put(path.join(mk, 'plugins', 'beta', 'skills', 'yo', 'SKILL.md'), '---\nname: yo\ndescription: say yo\n---\nyo\n');
  put(path.join(copilot, 'installed-plugins', 'scratch-market', 'alpha', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'alpha', version: '0.9.0' }));
  put(
    path.join(copilot, 'config.json'),
    `// User settings belong in settings.json.\n${JSON.stringify({ installedPlugins: [{ name: 'alpha', marketplace: 'scratch-market', version: '0.9.0', enabled: true, cache_path: path.join(copilot, 'installed-plugins', 'scratch-market', 'alpha') }] })}`
  );
  put(
    path.join(copilot, 'settings.json'),
    `// User settings\n${JSON.stringify({
      enabledPlugins: { 'alpha@scratch-market': true, 'beta@scratch-market': true, 'tool@hosted': false },
      extraKnownMarketplaces: { 'scratch-market': { source: { source: 'directory', path: mk } }, hosted: { source: { source: 'github', repo: 'acme/hosted' } } },
    })}`
  );
});

test('compareVersions orders dotted versions', () => {
  assert.ok(compareVersions('1.1.0', '0.9.0') > 0);
  assert.ok(compareVersions('1.0.0', '1.0.0') === 0);
  assert.ok(compareVersions('v0.2', '0.10') < 0);
});

test('readMarkets lists the local marketplace first, then github ones and the built-in', () => {
  const list = readMarkets(env);
  assert.deepEqual(list.map((m) => m.name), ['scratch-market', 'awesome-copilot', 'hosted']);
  const [local, builtin, hosted] = list;
  assert.equal(local.kind, 'directory');
  assert.equal(local.source, mk);
  assert.equal(builtin.builtin, true);
  assert.equal(builtin.source, 'github/awesome-copilot');
  assert.deepEqual(hosted.where, ['Copilot CLI']);
});

test('a copied plugin whose source is newer is ahead; a live plugin is installed at the source version and never ahead', () => {
  const local = readMarkets(env)[0];
  assert.deepEqual(local.plugins.map((p) => p.name), ['alpha', 'beta', 'gamma']);
  const [alpha, beta, gamma] = local.plugins;
  assert.deepEqual([alpha.installed, alpha.source, alpha.ahead, alpha.enabled, alpha.live], ['0.9.0', '1.1.0', true, true, undefined]);
  assert.deepEqual([beta.installed, beta.source, beta.ahead, beta.enabled, beta.live], ['1.0.0', '1.0.0', false, true, true]);
  assert.equal(beta.description, 'Beta from its manifest');
  assert.equal(alpha.description, 'Alpha plugin');
  assert.deepEqual([gamma.installed, gamma.source, gamma.ahead, gamma.enabled], [undefined, '2.0.0', false, false]);
});

test('a disabled plugin of a marketplace with no catalog on disk is listed from enabledPlugins', () => {
  const hosted = readMarkets(env)[2];
  assert.equal(hosted.location, '');
  assert.deepEqual(hosted.plugins.map((p) => [p.name, p.installed, p.enabled]), [['tool', undefined, false]]);
});

test('VS Code marketplaces join the list, and one both tools know shows both', () => {
  const vsHome = path.join(home, '.vscode', 'agent-plugins');
  put(path.join(vsHome, 'installed.json'), JSON.stringify({ version: 1, installed: [{ pluginUri: `file:///${path.join(vsHome, 'github.com', 'acme', 'extras', 'plugins', 'delta').replace(/\\/g, '/')}`, relativePath: 'github.com/acme/extras/plugins/delta', marketplace: 'acme/extras' }] }));
  const list = readMarkets(env, ['acme/hosted', 'acme/extras']);
  const hosted = list.find((m) => m.name === 'hosted')!;
  assert.deepEqual(hosted.where, ['Copilot CLI', 'VS Code']);
  const extras = list.find((m) => m.name === 'extras')!;
  assert.deepEqual(extras.where, ['VS Code']);
  assert.deepEqual(extras.plugins.map((p) => [p.name, p.installed !== undefined, p.enabled]), [['delta', false, true]]);
});

test('catalogFile finds the first catalog in Copilot CLI order', () => {
  assert.equal(catalogFile(mk), path.join(mk, '.claude-plugin', 'marketplace.json'));
  assert.equal(catalogFile(path.join(work, 'nowhere')), undefined);
});

test('the Plugins kind lists a live plugin too', async () => {
  const items = await readInstalledPlugins(env);
  const beta = items.filter((i) => i.pluginId === 'beta@scratch-market');
  assert.ok(beta.some((i) => i.kind === 'plugin'));
  assert.ok(beta.some((i) => i.kind === 'skill' && i.name === 'yo'));
});

test('renameInSettings moves the marketplace entry and its plugin keys, keeping the comment line', () => {
  const edit = renameInSettings(path.join(copilot, 'settings.json'), 'scratch-market', 'renamed')!;
  assert.ok(edit.after.startsWith('// User settings'));
  assert.ok(edit.after.includes('"alpha@renamed": true'));
  assert.ok(!edit.after.includes('@scratch-market'));
  assert.ok(edit.after.includes('"renamed"'));
  assert.equal(renameInSettings(path.join(copilot, 'settings.json'), 'unknown', 'x'), undefined);
});

test('renameCatalog rewrites the name of the catalog', () => {
  const edit = renameCatalog(mk, 'renamed')!;
  assert.equal(JSON.parse(edit.after).name, 'renamed');
});

test('planRename writes nothing, lists the files and the commands, and refuses a bad or taken name and a hosted marketplace', () => {
  const list = readMarkets(env);
  const ok = planRename(env, list, 'scratch-market', 'renamed');
  assert.equal(ok.error, undefined);
  assert.equal(ok.edits.length, 2);
  assert.deepEqual(ok.commands, ['copilot plugin marketplace remove scratch-market --force', `copilot plugin marketplace add "${mk}"`, 'copilot plugin install alpha@renamed', 'copilot plugin install beta@renamed']);
  assert.match(planRename(env, list, 'scratch-market', 'Bad Name').error ?? '', /lowercase/);
  assert.match(planRename(env, list, 'scratch-market', 'hosted').error ?? '', /already exists/);
  assert.match(planRename(env, list, 'hosted', 'other').error ?? '', /github marketplace/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(mk, '.claude-plugin', 'marketplace.json'), 'utf8')).name, 'scratch-market');
});
