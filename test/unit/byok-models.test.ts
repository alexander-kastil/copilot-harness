import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  formatModelId,
  getModelProviderId,
  listProviders,
  normalizeUserModels,
  parseConfigFile,
  parseHeadersJson,
  parseModelId,
  planOaiImport,
  providerSecretName,
} from '../../src/shared/byok-models';
import type { HFModelItem } from '../../src/shared/byok-types';

test('owned_by aliases normalise to owned_by', () => {
  assert.equal(getModelProviderId({ owned_by: ' zai ' }), 'zai');
  assert.equal(getModelProviderId({ provider: 'openai' }), 'openai');
  assert.equal(getModelProviderId({ provide: 'x' }), 'x');
  assert.equal(getModelProviderId(null), '');
  const out = normalizeUserModels([{ id: 'a', provider: 'p' }, 'junk', null]);
  assert.equal(out.length, 1);
  assert.equal(out[0].owned_by, 'p');
});

test('id::configId parsing and formatting round trip', () => {
  assert.deepEqual(parseModelId('glm-4.6'), { baseId: 'glm-4.6' });
  assert.deepEqual(parseModelId('glm-4.6::thinking'), { baseId: 'glm-4.6', configId: 'thinking' });
  assert.deepEqual(parseModelId('a::b::c'), { baseId: 'a', configId: 'b::c' });
  assert.equal(formatModelId({ id: 'a', configId: 'b' }), 'a::b');
  assert.equal(formatModelId({ id: 'a' }), 'a');
});

test('provider key secret names are lower case', () => {
  assert.equal(providerSecretName(' DeepSeek '), 'copilotHarness.byok.apiKey.deepseek');
});

test('headers JSON accepts string maps only', () => {
  assert.deepEqual(parseHeadersJson(''), { ok: true, value: undefined });
  assert.deepEqual(parseHeadersJson('{"a":"b"}'), { ok: true, value: { a: 'b' } });
  assert.equal(parseHeadersJson('{"a":1}').ok, false);
  assert.equal(parseHeadersJson('[]').ok, false);
  assert.equal(parseHeadersJson('{').ok, false);
});

test('providers are grouped case-insensitively and provider rows are not counted', () => {
  const models: HFModelItem[] = [
    { id: '__provider__zai', owned_by: 'zai', baseUrl: 'https://z', apiMode: 'anthropic' },
    { id: 'm1', owned_by: 'DeepSeek', baseUrl: 'https://d' },
    { id: 'm2', owned_by: 'deepseek' },
  ];
  const list = listProviders(models, 'https://global');
  assert.deepEqual(
    list.map((p) => [p.id, p.modelCount, p.baseUrl, p.apiMode]),
    [
      ['DeepSeek', 2, 'https://d', 'openai'],
      ['zai', 0, 'https://z', 'anthropic'],
    ],
  );
});

test('OAI Compatible import writes the global base URL, skips provider rows and duplicates', () => {
  const source = [
    { id: 'a', provider: 'deepseek' },
    { id: 'b', owned_by: 'deepinfra', baseUrl: 'https://own' },
    { id: '__provider__x', owned_by: 'x' },
    { id: 'c', owned_by: 'deepseek', configId: 'thinking' },
    { id: 'c', owned_by: 'deepseek', configId: 'thinking' },
    { id: 'dup', owned_by: 'deepseek' },
  ];
  const existing: HFModelItem[] = [{ id: 'dup', owned_by: 'deepseek' }];
  const plan = planOaiImport(source, 'https://api.deepseek.com', existing);
  assert.equal(plan.skippedProviderRows, 1);
  assert.deepEqual(plan.duplicates, ['c::thinking', 'dup']);
  assert.deepEqual(
    plan.toAdd.map((m) => [m.id, m.owned_by, m.baseUrl]),
    [
      ['a', 'deepseek', 'https://api.deepseek.com'],
      ['b', 'deepinfra', 'https://own'],
      ['c', 'deepseek', 'https://api.deepseek.com'],
    ],
  );
  assert.equal('provider' in plan.toAdd[0], false);
  assert.deepEqual(plan.providers, ['deepinfra', 'deepseek']);
});

test('config file parsing requires a models array', () => {
  assert.equal(parseConfigFile('nope').ok, false);
  assert.equal(parseConfigFile('{"models":1}').ok, false);
  const ok = parseConfigFile('{"models":[{"id":"a","owned_by":"p"}],"delay":5}');
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.delay, 5);
    assert.equal(ok.value.commitLanguage, 'English');
    assert.deepEqual(ok.value.providerKeys, {});
  }
});
