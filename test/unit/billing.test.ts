import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { BILLING_PLANS, billingFormat, fmtShare, planById, planForEntitlement } from '../../src/shared/billing';

test('the plans carry the documented monthly allowances of AI credits', () => {
  const by = Object.fromEntries(BILLING_PLANS.map((p) => [p.id, p.allowance]));
  assert.deepEqual(by, { free: 0, pro: 1500, 'pro-plus': 7000, business: 1900, enterprise: 3900, payg: 0 });
});

test('a quota entitlement picks the plan with that allowance, else none', () => {
  assert.equal(planForEntitlement(1500), 'pro');
  assert.equal(planForEntitlement(7000), 'pro-plus');
  assert.equal(planForEntitlement(300), undefined);
  assert.equal(planForEntitlement(undefined), undefined);
});

test('a plan shows a share of its allowance and pay as you go shows dollars', () => {
  assert.equal(billingFormat(planById('pro')!)(15), '1.00%');
  assert.equal(billingFormat(planById('payg')!)(250), '$2.50');
  assert.equal(fmtShare(0.0001, 1500), '<0.01%');
  assert.equal(fmtShare(0, 1500), '0%');
});
