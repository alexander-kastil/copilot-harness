import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import Module = require('node:module');
import { panelHtml } from '../../src/panel-html';

test('panel module loads with a vscode stub and exports HarnessPanel', () => {
  const m = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
  const load = m._load;
  m._load = function (this: unknown, request: string, ...rest: unknown[]) {
    if (request === 'vscode') return { window: {}, Uri: {}, ViewColumn: {} };
    return load.call(this, request, ...rest);
  };
  try {
    const mod = require('../../src/panel');
    assert.equal(typeof mod.HarnessPanel.show, 'function');
  } finally {
    m._load = load;
  }
});

test('panel html allows only the nonce script and the cspSource stylesheet', () => {
  const html = panelHtml({ cspSource: 'vscode-resource:', nonce: 'abc', scriptUri: 'a.js', styleUri: 'a.css' });
  assert.match(html, /script-src 'nonce-abc'/);
  assert.match(html, /default-src 'none'/);
  assert.doesNotMatch(html, /unsafe-inline/);
  assert.match(html, /<script nonce="abc" src="a\.js">/);
});
