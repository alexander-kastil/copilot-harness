// Credit and token reconciliation (#13): what the local records explain of what the quota says was used.
// Pure functions, no vscode import, no message text. Every figure carries its source.
import type { FigureName, SessionDetail, SessionSource, SessionSummary } from './session-model';

/** One AI credit (AIC) is 1e9 nano AIU: Copilot Chat computes `total_nano_aiu / 1e9` and prints it as "AIC". */
export const NANO_AIU_PER_CREDIT = 1e9;

export type AllSessionsLike = Record<SessionSource, { sessions: SessionSummary[] }>;

export interface Period {
  /** Inclusive, ISO 8601. */
  start: string;
  /** Exclusive, ISO 8601. */
  end: string;
}

export interface QuotaReading {
  /** Credits used in the period. */
  used: number;
  /** 'github' = copilot_internal/user through the signed-in GitHub session; 'manual' = typed into the card. */
  source: 'github' | 'manual';
  /** Quota size, when the source gives one. */
  entitlement?: number;
  /** ISO 8601 time the reading was taken. */
  readAt?: string;
}

/**
 * Best-figure rule, applied per joined session and per figure (credits, tokens, cached tokens):
 * 1. Only sources that carry the figure (not undefined) compete.
 * 2. The source with the richer detail wins (perCall > perTurn > totalsOnly > none).
 * 3. Ties go by source priority: traceDb, debugLogs, cli, chatSessions.
 * Reason: Token Pie measured 13.56 credits in the trace database against 13.60 by quota and 6.15 in chat
 * sessions, so per-call sources are the most complete and chat-session credits the least.
 * The session is joined on its id across sources, so it is counted once.
 */
export const SOURCE_PRIORITY: readonly SessionSource[] = ['traceDb', 'debugLogs', 'cli', 'chatSessions'];
const DETAIL_RANK: Record<SessionDetail, number> = { perCall: 3, perTurn: 2, totalsOnly: 1, none: 0 };

export interface Figure<T> {
  value: T;
  source: SessionSource;
  /** Where the credit number came from: a credits field, or nanoAiu divided by 1e9. */
  via?: 'credits' | 'nanoAiu';
}

export type NoDetailCause = 'logging-off' | 'no-usage-record';

export interface ReconciledSession {
  id: string;
  sources: SessionSource[];
  credits?: Figure<number>;
  tokensInput?: Figure<number>;
  tokensOutput?: Figure<number>;
  cachedTokens?: Figure<number>;
  start?: string;
  end?: string;
  workspace?: string;
  /** True when no source gave a credit figure for the session. */
  noDetail: boolean;
  cause?: NoDetailCause;
}

export interface SourceTotal {
  source: SessionSource;
  sessions: number;
  /** Sessions in the period that carry a credit figure in this source. */
  withCredits: number;
  credits: number | undefined;
  input: number | undefined;
  output: number | undefined;
  cached: number | undefined;
}

export interface Reconciliation {
  period: Period;
  perSource: SourceTotal[];
  sessions: ReconciledSession[];
  /** Sum of the best per-session credit figures; sessions with no figure add nothing. */
  localCredits: number;
  /** Share of the best figure per source in localCredits. */
  bySourceInBest: Partial<Record<SessionSource, number>>;
  noDetailSessions: ReconciledSession[];
  /** Sessions without a usable time, left out of the period. */
  undated: number;
  quota?: QuotaReading;
  /** Without a quota reading the local total is shown, labelled unverified. */
  verified: boolean;
  /** localCredits / quota.used; can exceed 1 when local records overshoot. Undefined without a quota or with used 0. */
  explainedShare?: number;
  /** max(quota.used - localCredits, 0). */
  remainder?: number;
}

export function creditsOf(s: SessionSummary): Figure<number> | undefined {
  if (s.credits !== undefined) return { value: s.credits, source: s.source, via: 'credits' };
  if (s.nanoAiu !== undefined) return { value: s.nanoAiu / NANO_AIU_PER_CREDIT, source: s.source, via: 'nanoAiu' };
  return undefined;
}

function inPeriod(s: SessionSummary, p: Period): boolean | undefined {
  const t = s.end ?? s.start;
  if (!t) return undefined;
  const ms = Date.parse(t);
  if (Number.isNaN(ms)) return undefined;
  return ms >= Date.parse(p.start) && ms < Date.parse(p.end);
}

function rank(s: SessionSummary): number {
  return DETAIL_RANK[s.detail] * 10 + (SOURCE_PRIORITY.length - SOURCE_PRIORITY.indexOf(s.source));
}

function pick<T>(group: SessionSummary[], get: (s: SessionSummary) => Figure<T> | undefined): Figure<T> | undefined {
  let best: { f: Figure<T>; r: number } | undefined;
  for (const s of group) {
    const f = get(s);
    if (!f) continue;
    const r = rank(s);
    if (!best || r > best.r) best = { f, r };
  }
  return best?.f;
}

function sum(values: (number | undefined)[]): number | undefined {
  let t: number | undefined;
  for (const v of values) if (v !== undefined) t = (t ?? 0) + v;
  return t;
}

function causeOf(group: SessionSummary[]): NoDetailCause {
  // A VS Code session that only the chat-session files know has no per-call record: logging was off.
  // A CLI session without a usage record has nothing to explain it.
  return group.some((s) => s.source === 'chatSessions' || s.source === 'debugLogs') ? 'logging-off' : 'no-usage-record';
}

export function reconcile(all: AllSessionsLike, period: Period, quota?: QuotaReading): Reconciliation {
  const groups = new Map<string, SessionSummary[]>();
  let undated = 0;
  const perSource: SourceTotal[] = [];
  for (const source of SOURCE_PRIORITY) {
    const inP: SessionSummary[] = [];
    for (const s of all[source]?.sessions ?? []) {
      const ok = inPeriod(s, period);
      if (ok === undefined) {
        undated++;
        continue;
      }
      if (!ok) continue;
      inP.push(s);
      // The key carries the CLI's own namespace so a CLI id never joins a VS Code id by accident.
      const key = source === 'cli' ? `cli:${s.id}` : s.id;
      const g = groups.get(key);
      if (g) g.push(s);
      else groups.set(key, [s]);
    }
    const credits = inP.map((s) => creditsOf(s)?.value);
    perSource.push({
      source,
      sessions: inP.length,
      withCredits: credits.filter((c) => c !== undefined).length,
      credits: sum(credits),
      input: sum(inP.map((s) => s.tokens?.input)),
      output: sum(inP.map((s) => s.tokens?.output)),
      cached: sum(inP.map((s) => s.tokens?.cached)),
    });
  }

  const sessions: ReconciledSession[] = [];
  const bySourceInBest: Partial<Record<SessionSource, number>> = {};
  let localCredits = 0;
  for (const [key, group] of groups) {
    const credits = pick(group, creditsOf);
    const r: ReconciledSession = {
      id: key.startsWith('cli:') ? key.slice(4) : key,
      sources: SOURCE_PRIORITY.filter((src) => group.some((s) => s.source === src)),
      credits,
      tokensInput: pick(group, (s) => (s.tokens?.input !== undefined ? { value: s.tokens.input, source: s.source } : undefined)),
      tokensOutput: pick(group, (s) => (s.tokens?.output !== undefined ? { value: s.tokens.output, source: s.source } : undefined)),
      cachedTokens: pick(group, (s) => (s.tokens?.cached !== undefined ? { value: s.tokens.cached, source: s.source } : undefined)),
      start: group.map((s) => s.start).filter((x): x is string => !!x).sort()[0],
      end: group.map((s) => s.end).filter((x): x is string => !!x).sort().pop(),
      workspace: group.find((s) => s.workspace)?.workspace,
      noDetail: credits === undefined,
    };
    if (credits) {
      localCredits += credits.value;
      bySourceInBest[credits.source] = (bySourceInBest[credits.source] ?? 0) + credits.value;
    } else {
      r.cause = causeOf(group);
    }
    sessions.push(r);
  }

  const out: Reconciliation = {
    period,
    perSource,
    sessions,
    localCredits,
    bySourceInBest,
    noDetailSessions: sessions.filter((s) => s.noDetail),
    undated,
    quota,
    verified: quota !== undefined,
  };
  if (quota && quota.used > 0) out.explainedShare = localCredits / quota.used;
  if (quota) out.remainder = Math.max(quota.used - localCredits, 0);
  return out;
}

/** The figure names a reconciled session fills, for provenance display. */
export function figureSources(s: ReconciledSession): Partial<Record<FigureName, SessionSource>> {
  const p: Partial<Record<FigureName, SessionSource>> = {};
  if (s.credits) p.credits = s.credits.source;
  if (s.tokensInput || s.tokensOutput) p.tokens = (s.tokensInput ?? s.tokensOutput)!.source;
  if (s.cachedTokens) p.cachedTokens = s.cachedTokens.source;
  return p;
}

/** Billing period ending at the quota reset date (one calendar month back), or the current calendar month. */
export function periodFor(now: Date, resetDate?: string): Period {
  if (resetDate) {
    const end = new Date(resetDate);
    if (!Number.isNaN(end.getTime())) {
      const start = new Date(end);
      start.setUTCMonth(start.getUTCMonth() - 1);
      return { start: start.toISOString(), end: end.toISOString() };
    }
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

export interface QuotaSnapshotLike {
  entitlement?: number | string;
  percent_remaining?: number;
  overage_count?: number;
  unlimited?: boolean;
  reset_date?: string;
}

/**
 * Parses the copilot_internal/user response (as Copilot Chat reads it: quota_snapshots.premium_interactions,
 * quota_reset_date). used = entitlement * (100 - percent_remaining) / 100 + overage_count. The unit of the
 * entitlement (premium requests or credits) is not documented, so the caller labels the reading unverified.
 */
export function parseQuotaResponse(body: unknown): { reading: QuotaReading; resetDate?: string } | undefined {
  const b = body as { quota_snapshots?: { premium_interactions?: QuotaSnapshotLike }; quota_reset_date?: string } | undefined;
  const q = b?.quota_snapshots?.premium_interactions;
  if (!q || q.unlimited) return undefined;
  const ent = typeof q.entitlement === 'string' ? parseFloat(q.entitlement) : q.entitlement;
  if (ent === undefined || !Number.isFinite(ent) || typeof q.percent_remaining !== 'number') return undefined;
  const used = (ent * (100 - q.percent_remaining)) / 100 + (q.overage_count ?? 0);
  return {
    reading: { used, source: 'github', entitlement: ent, readAt: new Date().toISOString() },
    resetDate: q.reset_date ?? b?.quota_reset_date,
  };
}
