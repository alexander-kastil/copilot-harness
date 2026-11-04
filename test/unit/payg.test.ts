import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  addModelsTo,
  buildProviderRow,
  globalWrite,
  listProviders,
  MODEL_FIELDS,
  parseFieldText,
  parseGlobalText,
  patchProvider,
  withModelField,
} from '../../src/shared/byok-models';
import type { HFModelItem } from '../../src/shared/byok-types';
import { buildPaygState, countModels, type PaygInput } from '../../src/shared/payg';

const row = buildProviderRow({ id: 'deepseek', baseUrl: 'https://api.deepseek.com', apiMode: 'openai', headers: { Authorization: 'Bearer secret-token' } });
const chat: HFModelItem = { id: 'deepseek-chat', owned_by: 'deepseek', baseUrl: 'https://api.deepseek.com', context_length: 64000, max_tokens: 8000, vision: true };
const claude: HFModelItem = { id: 'claude-x', configId: 'think', owned_by: 'anthropic', baseUrl: 'https://api.anthropic.com', apiMode: 'anthropic', displayName: 'Claude X' };

const input = (over: Partial<PaygInput> = {}): PaygInput => ({
  models: [row, chat, claude],
  baseUrl: 'https://global.example.com',
  settings: { delay: 5, readFileLines: 0, retry: { enabled: false }, commitLanguage: 'German', commitMessagePrompt: '', logLevel: 'info' },
  providerKeys: ['deepseek'],
  genericKey: false,
  ...over,
});

test('countModels leaves the provider rows out', () => {
  assert.equal(countModels([row, chat, claude]), 2);
  assert.equal(countModels([row]), 0);
  assert.equal(countModels([]), 0);
});

test('the state counts models and lists providers with their key source', () => {
  const s = buildPaygState(input());
  assert.equal(s.models, 2);
  assert.deepEqual(s.providers.map((p) => [p.id, p.modelCount, p.key]), [['anthropic', 1, 'none'], ['deepseek', 1, 'own']]);
  assert.equal(buildPaygState(input({ genericKey: true })).providers.find((p) => p.id === 'anthropic')?.key, 'generic');
});

test('the state never carries a key or a header value', () => {
  const text = JSON.stringify(buildPaygState(input({ genericKey: true })));
  assert.ok(!text.includes('secret-token'));
  const deepseek = buildPaygState(input()).providers.find((p) => p.id === 'deepseek');
  assert.deepEqual(deepseek?.headerNames, ['Authorization']);
});

test('a model shows its figures and the text of its fields', () => {
  const m = buildPaygState(input()).items.find((x) => x.id === 'deepseek-chat')!;
  assert.equal(m.contextLength, 64000);
  assert.equal(m.maxOutput, 8000);
  assert.equal(m.vision, true);
  assert.equal(m.values.context_length, '64000');
  assert.equal(m.values.temperature, '');
  assert.ok(!('headers' in m.values));
  const c = buildPaygState(input()).items.find((x) => x.id === 'claude-x')!;
  assert.equal(c.label, 'claude-x::think');
  assert.equal(c.displayName, 'Claude X');
  assert.equal(c.contextLength, 128000);
  assert.equal(c.maxOutput, 4096);
});

test('the global settings fill the defaults of the retry object', () => {
  const g = buildPaygState(input()).global.values;
  assert.equal(g.baseUrl, 'https://global.example.com');
  assert.equal(g['retry.enabled'], 'false');
  assert.equal(g['retry.max_attempts'], '3');
  assert.equal(g['retry.interval_ms'], '1000');
  assert.equal(g.delay, '5');
  assert.equal(g.commitLanguage, 'German');
});

test('an empty configuration gives an empty state', () => {
  const s = buildPaygState(input({ models: [], providerKeys: [] }));
  assert.equal(s.models, 0);
  assert.deepEqual(s.providers, []);
  assert.deepEqual(s.items, []);
});

test('field texts validate and parse like the menu', () => {
  const def = (key: string) => MODEL_FIELDS.find((d) => d.key === key)!;
  assert.equal(parseFieldText(def('context_length'), '10').ok, false);
  assert.deepEqual(parseFieldText(def('context_length'), '64000'), { ok: true, unset: false, value: 64000 });
  assert.deepEqual(parseFieldText(def('vision'), 'true'), { ok: true, unset: false, value: true });
  assert.deepEqual(parseFieldText(def('temperature'), ' '), { ok: true, unset: true });
  assert.equal(parseFieldText(def('temperature'), '3').ok, false);
  assert.equal(parseFieldText(def('apiMode'), 'nope').ok, false);
  assert.equal(parseFieldText(def('id'), '').ok, false);
  assert.deepEqual(parseFieldText(def('extra'), '{"a":1}'), { ok: true, unset: false, value: { a: 1 } });
  assert.equal(parseFieldText(def('extra'), '[1]').ok, false);
  assert.equal(parseFieldText(def('headers'), '{"a":1}').ok, false);
});

test('setting a field, unsetting it and clearing headers', () => {
  const def = (key: string) => MODEL_FIELDS.find((d) => d.key === key)!;
  const set = withModelField(chat, 'temperature', parseFieldText(def('temperature'), '0.5'));
  assert.equal(set.temperature, 0.5);
  assert.equal('temperature' in withModelField(set, 'temperature', { ok: true, unset: true }), false);
  const cleared = withModelField({ ...chat, headers: { a: 'b' } }, 'headers', parseFieldText(def('headers'), '{}'));
  assert.equal('headers' in cleared, false);
});

test('a provider patch reaches every row of the provider and an undefined value removes a field', () => {
  const models = patchProvider([row, chat, claude], 'DeepSeek', { baseUrl: 'https://new.example.com', headers: undefined });
  assert.equal(models[0].baseUrl, 'https://new.example.com');
  assert.equal(models[1].baseUrl, 'https://new.example.com');
  assert.equal('headers' in models[0], false);
  assert.equal(models[2].baseUrl, 'https://api.anthropic.com');
});

test('adding models drops the placeholder row and skips known ids', () => {
  const provider = listProviders([row, chat], '').find((p) => p.id === 'deepseek')!;
  const r = addModelsTo([row, chat], provider, ['deepseek-chat', 'deepseek-coder'], { contextLength: 32000, maxTokens: 2000, vision: false, displayName: 'ignored' });
  assert.deepEqual(r.added, ['deepseek-coder']);
  assert.deepEqual(r.skipped, ['deepseek-chat']);
  assert.equal(r.models.some((m) => m.id.startsWith('__provider__')), false);
  const added = r.models.find((m) => m.id === 'deepseek-coder')!;
  assert.equal(added.context_length, 32000);
  assert.equal(added.displayName, undefined);
  assert.deepEqual(added.headers, { Authorization: 'Bearer secret-token' });
});

test('global texts parse and the retry fields merge into the retry object', () => {
  assert.deepEqual(parseGlobalText('delay', '250'), { ok: true, value: 250 });
  assert.equal(parseGlobalText('delay', '-1').ok, false);
  assert.equal(parseGlobalText('baseUrl', 'ftp://x').ok, false);
  assert.deepEqual(parseGlobalText('retry.status_codes', '408, 409'), { ok: true, value: [408, 409] });
  assert.equal(parseGlobalText('retry.status_codes', '40').ok, false);
  assert.equal(parseGlobalText('commitLanguage', 'Klingon').ok, false);
  assert.deepEqual(parseGlobalText('logLevel', 'debug'), { ok: true, value: 'debug' });
  assert.deepEqual(globalWrite('retry.max_attempts', 7, { enabled: false }), {
    name: 'retry',
    value: { enabled: false, max_attempts: 7, interval_ms: 1000, status_codes: [] },
  });
  assert.deepEqual(globalWrite('delay', 3, {}), { name: 'delay', value: 3 });
});
