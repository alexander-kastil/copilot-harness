// The billing tier of the session cost card: the user's own pick is saved in the panel state (like Claude
// Harness's saved `billing`), else the plan GitHub's quota reading points to, else pay as you go.
import { DEFAULT_BILLING, planById, planForEntitlement, type BillingPlan } from '../shared/billing';
import { saveState, savedState } from './bridge';

const KEY = 'billing';

let picked: string | undefined = planById(String(savedState()[KEY]))?.id;
let detected: string | undefined;

/** The plan the switch shows. */
export const currentPlan = (): BillingPlan => planById(picked) ?? planById(detected) ?? planById(DEFAULT_BILLING)!;

export function pickPlan(id: string): void {
  picked = id;
  saveState({ [KEY]: id });
}

/** Called with the entitlement of the last GitHub quota reading, when the credits card has one. */
export function detectPlan(entitlement: number | undefined): void {
  detected = planForEntitlement(entitlement);
}
