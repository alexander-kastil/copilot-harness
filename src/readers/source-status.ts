// Which session data sources hold data (#11): a status per source from the reader results and the
// current setting values. Pure, no vscode import.
import type { ReadResult, SessionSource } from '../shared/session-model';
import type { SettingStatus, SourceState, SourceStatus } from '../shared/setup';
import type { AllSessions } from './all-sessions';

export const AGENT_HOST_DEBUG_LOG = 'chat.agentHost.agentDebugLog.enabled';
export const FILE_DEBUG_LOG = 'github.copilot.chat.agentDebugLog.fileLogging.enabled';
export const TRACE_DB = 'github.copilot.chat.otel.dbSpanExporter.enabled';

interface SettingDef {
  key: string;
  appliesTo: string;
  userOnly?: boolean;
  plainText?: boolean;
}

interface SourceDef {
  label: string;
  missing: string;
  settings: SettingDef[];
}

/** The only settings the setup check may write. Evidence for appliesTo: the setting descriptions of VS Code 1.144 and Copilot Chat 0.72. */
export const SOURCES: Record<SessionSource, SourceDef> = {
  chatSessions: {
    label: 'Chat sessions',
    missing: 'Sessions show title, turns and models only when VS Code has not stored more.',
    settings: [],
  },
  debugLogs: {
    label: 'Debug logs',
    missing: 'Without debug logs a session has no per-call tokens, tool counts or subagent runs. Capture is not retroactive.',
    settings: [
      { key: FILE_DEBUG_LOG, appliesTo: 'Copilot Chat sessions (local agent mode); writes JSONL files, takes effect after a window reload.' },
      { key: AGENT_HOST_DEBUG_LOG, appliesTo: 'Agent Host sessions only; takes effect at once and captures only sessions that run while it is on.' },
    ],
  },
  traceDb: {
    label: 'Trace database',
    missing: 'Without the trace database a session has no span-level token, cache and credit figures. Capture is not retroactive.',
    settings: [{ key: TRACE_DB, appliesTo: 'Copilot Chat sessions; stores OpenTelemetry spans in a local SQLite database. User settings only, takes effect after a window reload.', userOnly: true, plainText: true }],
  },
  cli: {
    label: 'Copilot CLI',
    missing: 'Copilot CLI sessions appear once the CLI has run; it writes ~/.copilot without any setting.',
    settings: [],
  },
};

/** The effective value of a setting, as the host read it. known is false when VS Code does not register the key. */
export interface SettingValue {
  known: boolean;
  value: boolean | undefined;
}

export type SettingsSnapshot = Record<string, SettingValue | undefined>;

export function newestOf(result: ReadResult): string | undefined {
  if (result.newest) return result.newest;
  let best: string | undefined;
  for (const s of result.sessions) {
    const t = s.end ?? s.start;
    if (t && (!best || t > best)) best = t;
  }
  return best;
}

function settingStatus(def: SettingDef, snapshot: SettingsSnapshot): SettingStatus {
  const v = snapshot[def.key];
  const out: SettingStatus = { key: def.key, known: v?.known === true, enabled: v?.known === true && v.value === true, appliesTo: def.appliesTo };
  if (def.userOnly) out.userOnly = true;
  if (def.plainText) out.plainText = true;
  return out;
}

export function sourceStatus(source: SessionSource, result: ReadResult, snapshot: SettingsSnapshot): SourceStatus {
  const def = SOURCES[source];
  const settings = def.settings.map((s) => settingStatus(s, snapshot));
  const optIn = settings.length > 0;
  // A debug log that holds only its session_start line gives detail 'none': that is no data for an opt-in source.
  const sessions = optIn ? result.sessions.filter((s) => s.detail !== 'none').length : result.sessions.length;
  let state: SourceState;
  if (sessions > 0) state = 'data';
  else if (!optIn) state = 'empty';
  else state = settings.some((s) => s.enabled) ? 'empty' : 'off';
  const out: SourceStatus = { source, label: def.label, state, optIn, sessions, settings, missing: def.missing };
  const newest = newestOf(optIn ? { ...result, newest: undefined, sessions: result.sessions.filter((s) => s.detail !== 'none') } : result);
  if (newest) out.newest = newest;
  if (result.reason) out.reason = result.reason;
  return out;
}

/** One status per source, in the order chat sessions, debug logs, trace database, CLI. */
export function computeStatuses(all: AllSessions, snapshot: SettingsSnapshot): SourceStatus[] {
  return (['chatSessions', 'debugLogs', 'traceDb', 'cli'] as const).map((s) => sourceStatus(s, all[s], snapshot));
}

/** The card shows while an opt-in source has no data; it goes away once data flows from all of them. */
export function needsAttention(statuses: SourceStatus[]): boolean {
  return statuses.some((s) => s.optIn && s.state !== 'data');
}

/** The settings the card may write, with the scopes each allows. Anything else is refused. */
export function writableSetting(key: string): SettingDef | undefined {
  for (const def of Object.values(SOURCES)) {
    const hit = def.settings.find((s) => s.key === key);
    if (hit) return hit;
  }
  return undefined;
}
