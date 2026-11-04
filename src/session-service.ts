// Host-side owner of the session readers. Contract for #11, #12 and #13:
// - subscribe with onDidRead, or read `latest`; call refresh() after a setting change.
// - #12 registers its snapshot merge with addProcessor; processors run in registration order after every read.
import * as vscode from 'vscode';
import { readAllSessions, type AllSessions, type ReaderIndexes } from './readers/all-sessions';
import type { Env } from './readers/paths';
import { ScanIndex, type IndexData } from './readers/scan-index';
import type { SessionSummary } from './shared/session-model';

export type SessionProcessor = (all: AllSessions) => AllSessions | Promise<AllSessions>;

export class SessionService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<AllSessions>();
  readonly onDidRead = this.emitter.event;
  private readonly processors: SessionProcessor[] = [];
  private readonly indexes: Required<ReaderIndexes> = {
    chatSessions: new ScanIndex<SessionSummary>(),
    debugLogs: new ScanIndex<SessionSummary>(),
    traceDb: new ScanIndex<SessionSummary[]>(),
    cli: new ScanIndex<SessionSummary>(),
  };
  private last: AllSessions | undefined;
  private running: Promise<AllSessions> | undefined;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(
    private readonly env: Env,
    private readonly intervalMs = 5 * 60_000,
    private readonly firstDelayMs = 10_000
  ) {}

  get latest(): AllSessions | undefined {
    return this.last;
  }

  /** The four scan indexes as plain data, for #12 to keep between VS Code sessions. */
  exportIndexes(): Record<keyof ReaderIndexes, IndexData<unknown>> {
    return {
      chatSessions: this.indexes.chatSessions.toJSON(),
      debugLogs: this.indexes.debugLogs.toJSON(),
      traceDb: this.indexes.traceDb.toJSON(),
      cli: this.indexes.cli.toJSON(),
    };
  }

  /** Replaces the indexes with saved data; call before the first read. */
  restoreIndexes(data: Partial<Record<keyof ReaderIndexes, IndexData<unknown>>>): void {
    if (data.chatSessions) this.indexes.chatSessions = new ScanIndex<SessionSummary>(data.chatSessions as IndexData<SessionSummary>);
    if (data.debugLogs) this.indexes.debugLogs = new ScanIndex<SessionSummary>(data.debugLogs as IndexData<SessionSummary>);
    if (data.traceDb) this.indexes.traceDb = new ScanIndex<SessionSummary[]>(data.traceDb as IndexData<SessionSummary[]>);
    if (data.cli) this.indexes.cli = new ScanIndex<SessionSummary>(data.cli as IndexData<SessionSummary>);
  }

  addProcessor(processor: SessionProcessor): vscode.Disposable {
    this.processors.push(processor);
    return new vscode.Disposable(() => {
      const i = this.processors.indexOf(processor);
      if (i >= 0) this.processors.splice(i, 1);
    });
  }

  /** One read at a time: a call while a read runs gets that read's result. */
  refresh(): Promise<AllSessions> {
    this.running ??= this.read().finally(() => (this.running = undefined));
    return this.running;
  }

  /** First read shortly after startup, then on the interval. */
  start(): void {
    this.timers.push(setTimeout(() => void this.refresh(), this.firstDelayMs));
    this.timers.push(setInterval(() => void this.refresh(), this.intervalMs));
  }

  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.emitter.dispose();
  }

  private async read(): Promise<AllSessions> {
    let all = await readAllSessions(this.env, this.indexes);
    for (const p of this.processors) all = await p(all);
    this.last = all;
    this.emitter.fire(all);
    return all;
  }
}
