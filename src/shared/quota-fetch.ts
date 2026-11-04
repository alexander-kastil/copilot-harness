// The one network call of #13: GitHub's copilot_internal/user, the endpoint Copilot Chat itself reads its quota
// from (quota_snapshots.premium_interactions). Undocumented, so any failure becomes a note, never an error.
// The access token is passed in per call, goes only into the Authorization header, and is never returned,
// logged or stored. No vscode import; fetch is injected for tests.
import { parseQuotaResponse, type QuotaReading } from './reconcile';

export const QUOTA_URL = 'https://api.github.com/copilot_internal/user';

export interface QuotaFetchResult {
  reading?: QuotaReading;
  resetDate?: string;
  /** Why there is no reading; never contains the token or a response body. */
  note?: string;
}

type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function fetchGithubQuota(token: string, fetchFn: FetchLike = fetch as unknown as FetchLike): Promise<QuotaFetchResult> {
  try {
    const res = await fetchFn(QUOTA_URL, {
      headers: { Authorization: `token ${token}`, 'X-GitHub-Api-Version': '2025-04-01', Accept: 'application/json' },
    });
    if (!res.ok) return { note: `GitHub answered ${res.status} for the quota request.` };
    const parsed = parseQuotaResponse(await res.json());
    if (!parsed) return { note: 'The quota response had no premium quota (unlimited plan or a changed response shape).' };
    return { reading: parsed.reading, resetDate: parsed.resetDate };
  } catch {
    return { note: 'The quota request failed (offline or blocked).' };
  }
}
