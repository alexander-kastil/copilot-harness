// Runs the four session readers (#8, #9, #10) side by side. Contract for #11, #12 and #13: consumers
// take an AllSessions record, never call the readers one by one. No vscode import.
import type { ReadResult, SessionSource, SessionSummary } from '../shared/session-model';
import type { Env } from './paths';
import type { ScanIndex } from './scan-index';
import { readChatSessions } from './chat-sessions';
import { readCliSessions } from './cli-sessions';
import { readDebugLogs } from './debug-logs';
import { readTraceDb } from './trace-db';

export const SESSION_SOURCES: readonly SessionSource[] = ['chatSessions', 'debugLogs', 'traceDb', 'cli'];

export type AllSessions = Record<SessionSource, ReadResult>;

export interface ReaderIndexes {
  chatSessions?: ScanIndex<SessionSummary>;
  debugLogs?: ScanIndex<SessionSummary>;
  traceDb?: ScanIndex<SessionSummary[]>;
  cli?: ScanIndex<SessionSummary>;
}

/** A reader that throws yields an empty result whose reason carries the error message. */
export async function readAllSessions(env: Env, indexes: ReaderIndexes = {}): Promise<AllSessions> {
  const guard = async (source: SessionSource, run: () => Promise<ReadResult>): Promise<ReadResult> => {
    try {
      return await run();
    } catch (err) {
      return { source, sessions: [], roots: [], skipped: 0, reason: err instanceof Error ? err.message : String(err) };
    }
  };
  const [chatSessions, debugLogs, traceDb, cli] = await Promise.all([
    guard('chatSessions', () => readChatSessions(env, indexes.chatSessions)),
    guard('debugLogs', () => readDebugLogs(env, indexes.debugLogs)),
    guard('traceDb', () => readTraceDb(env, indexes.traceDb)),
    guard('cli', () => readCliSessions(env, indexes.cli)),
  ]);
  return { chatSessions, debugLogs, traceDb, cli };
}
