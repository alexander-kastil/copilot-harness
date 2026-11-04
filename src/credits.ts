// Host side of credit reconciliation (#13). Quota sources, in order: a reading from GitHub through the
// signed-in vscode.authentication session (only after the user pressed the card's button once), else the
// number the user typed into the card. No token is stored anywhere: the session token lives only in a local
// variable for one request, so there is nothing to put in SecretStorage, and nothing is logged.
import * as vscode from 'vscode';
import { HarnessPanel } from './panel';
import type { AllSessions } from './readers/all-sessions';
import type { SessionService } from './session-service';
import { toCreditsState, type CreditsState } from './shared/credits';
import { fetchGithubQuota } from './shared/quota-fetch';
import { periodFor, reconcile, type QuotaReading } from './shared/reconcile';

const MANUAL_KEY = 'copilotHarness.credits.manual';
const GITHUB_ON_KEY = 'copilotHarness.credits.githubQuota';
const SCOPES = ['user:email'];
const CACHE_MS = 60_000;

interface Manual {
  used: number;
  enteredAt: string;
}

export function registerCredits(context: vscode.ExtensionContext, sessions: SessionService): void {
  let github: { reading: QuotaReading; resetDate?: string; at: number } | undefined;
  let note: string | undefined;

  const readGithub = async (interactive: boolean): Promise<void> => {
    if (!interactive && Date.now() - (github?.at ?? 0) < CACHE_MS) return;
    const session = await vscode.authentication.getSession('github', SCOPES, interactive ? { createIfNone: true } : { silent: true });
    if (!session) {
      note = 'Not signed in to GitHub in VS Code.';
      github = undefined;
      return;
    }
    const r = await fetchGithubQuota(session.accessToken);
    if (r.reading) {
      github = { reading: r.reading, resetDate: r.resetDate, at: Date.now() };
      note = undefined;
    } else {
      github = undefined;
      note = r.note;
    }
  };

  const manual = (): Manual | undefined => context.globalState.get<Manual>(MANUAL_KEY);

  const build = (all: AllSessions): CreditsState => {
    const enabled = context.globalState.get<boolean>(GITHUB_ON_KEY) === true;
    const now = new Date();
    let period = periodFor(now, enabled ? github?.resetDate : undefined);
    let quota: QuotaReading | undefined = enabled ? github?.reading : undefined;
    if (!quota) {
      const m = manual();
      // A typed number is valid for the calendar month it was typed in.
      if (m && Date.parse(m.enteredAt) >= Date.parse(period.start) && Date.parse(m.enteredAt) < Date.parse(period.end)) {
        quota = { used: m.used, source: 'manual', readAt: m.enteredAt };
      }
    }
    if (!quota) period = periodFor(now);
    return toCreditsState(reconcile(all, period, quota), { enabled, note });
  };

  const post = (all: AllSessions | undefined) => {
    if (all) HarnessPanel.post({ type: 'credits', state: build(all) });
  };

  const refreshAndPost = async () => {
    if (context.globalState.get<boolean>(GITHUB_ON_KEY) === true) await readGithub(false).catch(() => undefined);
    post(sessions.latest);
  };

  context.subscriptions.push(
    sessions.onDidRead(() => void refreshAndPost()),
    HarnessPanel.onMessage((m) => {
      if (m.type === 'ready') {
        if (!sessions.latest) void sessions.refresh();
        void refreshAndPost();
      } else if (m.type === 'creditsManualQuota') {
        if (Number.isFinite(m.used) && m.used >= 0) {
          void context.globalState.update(MANUAL_KEY, { used: m.used, enteredAt: new Date().toISOString() } satisfies Manual).then(() => post(sessions.latest));
        }
      } else if (m.type === 'creditsClearManual') {
        void context.globalState.update(MANUAL_KEY, undefined).then(() => post(sessions.latest));
      } else if (m.type === 'creditsReadGithub') {
        void (async () => {
          await context.globalState.update(GITHUB_ON_KEY, true);
          await readGithub(true).catch((e) => {
            note = e instanceof Error ? e.message : 'Sign-in was cancelled.';
          });
          post(sessions.latest);
        })();
      }
    })
  );
}
