// Snapshot store (#12): keeps the numbers and structure of every session seen, so a session whose
// source Copilot pruned stays listed with its figures. Pure Node, no vscode import.
// A record is a SessionSummary without any text a user or model wrote (no title, no file content) plus
// firstSeen and lastSeen. Records are never deleted when a source disappears; only the size cap removes them.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AllSessions } from './all-sessions';
import type { ReadResult, SessionSource, SessionSummary } from '../shared/session-model';

export const STORE_VERSION = 1;

export interface SnapshotRecord {
  summary: SessionSummary;
  firstSeen: string;
  lastSeen: string;
}

export interface SnapshotStore {
  version: number;
  records: Record<string, SnapshotRecord>;
  /** Records removed by the size cap over the life of the store. */
  trimmedTotal: number;
  /** When the cap last removed records. */
  trimmedAt?: string;
}

export const emptyStore = (): SnapshotStore => ({ version: STORE_VERSION, records: {}, trimmedTotal: 0 });

export function recordKey(s: Pick<SessionSummary, 'source' | 'id' | 'variant'>): string {
  return `${s.source}|${s.variant ?? ''}|${s.id}`;
}

/** The summary as stored: titles are dropped because Copilot derives them from the conversation. */
export function stripped(s: SessionSummary): SessionSummary {
  const copy: SessionSummary = { ...s };
  delete copy.title;
  delete copy.fromSnapshot;
  return JSON.parse(JSON.stringify(copy)) as SessionSummary;
}

/** Creates or refreshes the record of every session in this read; returns whether anything changed. */
export function updateStore(store: SnapshotStore, all: AllSessions, now: string): boolean {
  let changed = false;
  for (const result of Object.values(all) as ReadResult[]) {
    for (const session of result.sessions) {
      if (session.fromSnapshot) continue;
      const key = recordKey(session);
      const summary = stripped(session);
      const old = store.records[key];
      if (old && JSON.stringify(old.summary) === JSON.stringify(summary)) continue;
      store.records[key] = { summary, firstSeen: old?.firstSeen ?? now, lastSeen: now };
      changed = true;
    }
  }
  return changed;
}

/** Adds a "from snapshot" session for every record whose source no longer lists it. */
export function mergeSnapshots(store: SnapshotStore, all: AllSessions): AllSessions {
  const out = { ...all } as AllSessions;
  const bySource = new Map<SessionSource, SessionSummary[]>();
  const live = new Set<string>();
  for (const result of Object.values(all) as ReadResult[]) for (const s of result.sessions) live.add(recordKey(s));
  for (const [key, rec] of Object.entries(store.records)) {
    if (live.has(key)) continue;
    const list = bySource.get(rec.summary.source) ?? [];
    list.push({ ...rec.summary, fromSnapshot: true });
    bySource.set(rec.summary.source, list);
  }
  for (const [source, list] of bySource) {
    const base = all[source];
    out[source] = { ...base, sessions: [...base.sessions, ...list] };
  }
  return out;
}

export function storeBytes(store: SnapshotStore): number {
  return Buffer.byteLength(JSON.stringify(store), 'utf8');
}

/** Removes the oldest records (by session end, else last seen) until the file fits; returns how many went. */
export function enforceCap(store: SnapshotStore, maxBytes: number, now: string): number {
  if (storeBytes(store) <= maxBytes) return 0;
  const order = Object.entries(store.records)
    .map(([key, r]) => ({ key, at: r.summary.end ?? r.summary.start ?? r.lastSeen }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  let removed = 0;
  for (const { key } of order) {
    if (storeBytes(store) <= maxBytes) break;
    delete store.records[key];
    removed++;
  }
  if (removed) {
    store.trimmedTotal += removed;
    store.trimmedAt = now;
  }
  return removed;
}

/** Any session in any source: the store is created only then. */
export function hasCopilotData(all: AllSessions): boolean {
  return (Object.values(all) as ReadResult[]).some((r) => r.sessions.some((s) => !s.fromSnapshot));
}

export function loadStore(file: string): SnapshotStore {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8')) as SnapshotStore;
    if (v && v.version === STORE_VERSION && typeof v.records === 'object' && v.records !== null) {
      return { version: STORE_VERSION, records: v.records, trimmedTotal: v.trimmedTotal ?? 0, trimmedAt: v.trimmedAt };
    }
  } catch {
    // missing or unreadable: start empty
  }
  return emptyStore();
}

/** Writes through a temporary file so a crash never leaves half a store. */
export function saveStore(file: string, store: SnapshotStore): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store), 'utf8');
  fs.renameSync(tmp, file);
}
