import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { fetchGithubQuota, QUOTA_URL } from '../../src/shared/quota-fetch';

const body = { quota_reset_date: '2026-12-01', quota_snapshots: { premium_interactions: { entitlement: 300, percent_remaining: 90 } } };

test('sends the token only in the Authorization header and never returns it', async () => {
  let seen: { url: string; headers: Record<string, string> } | undefined;
  const r = await fetchGithubQuota('SENTINEL_TOKEN', async (url, init) => {
    seen = { url, headers: init.headers };
    return { ok: true, status: 200, json: async () => body };
  });
  assert.equal(seen?.url, QUOTA_URL);
  assert.equal(seen?.headers.Authorization, 'token SENTINEL_TOKEN');
  assert.equal(r.reading?.used, 30);
  assert.equal(r.resetDate, '2026-12-01');
  assert.ok(!JSON.stringify(r).includes('SENTINEL_TOKEN'));
});

test('HTTP errors, odd shapes and network failures become a note, not an exception', async () => {
  const bad = await fetchGithubQuota('SENTINEL_TOKEN', async () => ({ ok: false, status: 401, json: async () => ({}) }));
  assert.equal(bad.reading, undefined);
  assert.ok(bad.note && !bad.note.includes('SENTINEL_TOKEN'));
  const odd = await fetchGithubQuota('t', async () => ({ ok: true, status: 200, json: async () => ({}) }));
  assert.ok(odd.note);
  const off = await fetchGithubQuota('SENTINEL_TOKEN', async () => {
    throw new Error('boom SENTINEL_TOKEN');
  });
  assert.ok(off.note && !off.note.includes('SENTINEL_TOKEN'));
});
