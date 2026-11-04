// State of the credits card (#13), built from a Reconciliation. Serializable, no vscode import, no
// message text: sessions appear only as ids, workspace folders and a cause code.
import type { SessionSource } from './session-model';
import type { NoDetailCause, Period, QuotaReading, Reconciliation, SourceTotal } from './reconcile';

export interface NoDetailItem {
  id: string;
  cause: NoDetailCause;
  workspace?: string;
  sources: SessionSource[];
}

export interface CreditsState {
  period: Period;
  /** 'unverified' while there is no quota reading: the local total is shown with that label. */
  verified: boolean;
  quota?: QuotaReading;
  localCredits: number;
  /** Source of every contribution to localCredits. */
  bySourceInBest: Partial<Record<SessionSource, number>>;
  perSource: SourceTotal[];
  explainedShare?: number;
  remainder?: number;
  sessionCount: number;
  noDetailCount: number;
  noDetailByCause: Partial<Record<NoDetailCause, number>>;
  /** At most 15 sessions, newest first. */
  noDetail: NoDetailItem[];
  undated: number;
  /** Whether the GitHub quota read is switched on, and why it has no reading (not signed in, request failed, ...). */
  githubQuota: { enabled: boolean; note?: string };
}

const SHOWN = 15;

export function toCreditsState(rec: Reconciliation, githubQuota: CreditsState['githubQuota']): CreditsState {
  const byCause: Partial<Record<NoDetailCause, number>> = {};
  for (const s of rec.noDetailSessions) if (s.cause) byCause[s.cause] = (byCause[s.cause] ?? 0) + 1;
  const newest = [...rec.noDetailSessions].sort((a, b) => (b.end ?? b.start ?? '').localeCompare(a.end ?? a.start ?? ''));
  return {
    period: rec.period,
    verified: rec.verified,
    quota: rec.quota,
    localCredits: rec.localCredits,
    bySourceInBest: rec.bySourceInBest,
    perSource: rec.perSource,
    explainedShare: rec.explainedShare,
    remainder: rec.remainder,
    sessionCount: rec.sessions.length,
    noDetailCount: rec.noDetailSessions.length,
    noDetailByCause: byCause,
    noDetail: newest.slice(0, SHOWN).map((s) => ({ id: s.id, cause: s.cause ?? 'no-usage-record', workspace: s.workspace, sources: s.sources })),
    undated: rec.undated,
    githubQuota,
  };
}
