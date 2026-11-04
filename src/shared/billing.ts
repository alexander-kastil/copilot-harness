// The billing tiers of the session cost card: each Copilot plan with its monthly allowance of GitHub AI
// credits, and pay as you go. Figures: https://docs.github.com/en/copilot/get-started/plans (Pro 1,500,
// Pro+ 7,000, Business 1,900 and Enterprise 3,900 credits per user and month) and
// https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals (1 AI credit = $0.01).
// Copilot Free has an allowance of AI credits that the docs give no number for (they only say 2,000 code completions
// per month, which are not billed in credits), so its tier shows the session in credits, not a share. No vscode import.

export interface BillingPlan {
  id: string;
  label: string;
  /** Codicon name. */
  glyph: string;
  /** Monthly allowance in AI credits; 0 for Free (no published figure, shows credits) and pay as you go (shows dollars). */
  allowance: number;
  /** Shorter label of the switch button; the hover keeps the full name. */
  short?: string;
  /** Hover text for a tier without an allowance figure. */
  note?: string;
}

export const USD_PER_CREDIT = 0.01;

export const BILLING_PLANS: BillingPlan[] = [
  { id: 'free', label: 'Copilot Free', glyph: 'heart', allowance: 0, short: 'Free', note: 'GitHub publishes no AI-credit figure for Free: it has an allowance of AI credits and 2,000 code completions per month, which are not billed in credits. This shows the session in AI credits. Source: https://docs.github.com/en/copilot/concepts/billing/individual-plans' },
  { id: 'pro', label: 'Copilot Pro', glyph: 'account', allowance: 1500, short: 'Pro' },
  { id: 'pro-plus', label: 'Copilot Pro+', glyph: 'rocket', allowance: 7000, short: 'Pro+' },
  { id: 'business', label: 'Copilot Business', glyph: 'organization', allowance: 1900, short: 'Business' },
  { id: 'enterprise', label: 'Copilot Enterprise', glyph: 'briefcase', allowance: 3900, short: 'Enterprise' },
  { id: 'payg', label: 'Pay as you go', glyph: 'credit-card', allowance: 0, short: 'Pay as you go' },
];

export const DEFAULT_BILLING = 'payg';

export const planById = (id: string | undefined): BillingPlan | undefined => BILLING_PLANS.find((p) => p.id === id);

/** The plan whose monthly allowance equals the quota entitlement GitHub reported, when exactly one does. */
export function planForEntitlement(entitlement: number | undefined): string | undefined {
  if (!entitlement) return undefined;
  const hit = BILLING_PLANS.filter((p) => p.allowance === entitlement);
  return hit.length === 1 ? hit[0].id : undefined;
}

export const fmtUsd = (v: number): string => (v <= 0 ? '$0' : v < 0.01 ? '<$0.01' : v < 1000 ? `$${v.toFixed(2)}` : `$${Math.round(v).toLocaleString()}`);

/** A share of the allowance; a thin slice reads "<0.01%", never "0%" beside a nonzero amount. */
export function fmtShare(credits: number, allowance: number): string {
  const p = (credits / allowance) * 100;
  return p <= 0 ? '0%' : p < 0.01 ? '<0.01%' : `${p < 10 ? p.toFixed(2) : p < 100 ? p.toFixed(1) : Math.round(p)}%`;
}

/** The formatter of the cost card for a plan: shares of the allowance, or dollars on pay as you go. */
export function billingFormat(plan: BillingPlan): (credits: number) => string {
  if (plan.allowance) return (c) => fmtShare(c, plan.allowance);
  return plan.id === 'free' ? (c) => c.toFixed(2) : (c) => fmtUsd(c * USD_PER_CREDIT);
}
