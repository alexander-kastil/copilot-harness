// Host side of the snapshot store (#12): keeps the store in global storage, merges "from snapshot"
// sessions into every read through the session service, and keeps the reader scan indexes between
// VS Code sessions so the first full scan happens once. Nothing is written until Copilot data exists.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { HarnessPanel } from './panel';
import { hasCopilotData, loadStore, mergeSnapshots, saveStore, enforceCap, storeBytes, updateStore } from './readers/snapshot-store';
import type { SessionService } from './session-service';
import type { SnapshotsState } from './shared/snapshots';

export const MAX_MB_SETTING = 'copilotHarness.snapshots.maxMegabytes';
const DEFAULT_MB = 50;

interface IndexFile {
  version: string;
  indexes: ReturnType<SessionService['exportIndexes']>;
}

export function registerSnapshots(context: vscode.ExtensionContext, sessions: SessionService): void {
  const dir = context.globalStorageUri.fsPath;
  const storeFile = path.join(dir, 'snapshots.json');
  const indexFile = path.join(dir, 'scan-indexes.json');
  const extVersion = String(context.extension.packageJSON?.version ?? '0');
  const store = loadStore(storeFile);
  let fromSnapshot = 0;
  let lastIndexJson = '';

  try {
    const saved = JSON.parse(fs.readFileSync(indexFile, 'utf8')) as IndexFile;
    // The cached summaries have the shape the readers of that version produced: another version starts cold.
    if (saved.version === extVersion) {
      sessions.restoreIndexes(saved.indexes);
      lastIndexJson = fs.readFileSync(indexFile, 'utf8');
    }
  } catch {
    // no saved indexes yet
  }

  const maxBytes = (): number => {
    const mb = vscode.workspace.getConfiguration().get<number>(MAX_MB_SETTING, DEFAULT_MB);
    return Math.max(1, Number.isFinite(mb) ? mb : DEFAULT_MB) * 1024 * 1024;
  };
  const state = (): SnapshotsState => ({
    records: Object.keys(store.records).length,
    fromSnapshot,
    bytes: fs.existsSync(storeFile) ? storeBytes(store) : 0,
    maxBytes: maxBytes(),
    trimmedTotal: store.trimmedTotal,
    trimmedAt: store.trimmedAt,
    created: fs.existsSync(storeFile),
  });
  const post = () => HarnessPanel.post({ type: 'snapshots', state: state() });

  context.subscriptions.push(
    sessions.addProcessor((all) => {
      if (!hasCopilotData(all) && Object.keys(store.records).length === 0) return all;
      const now = new Date().toISOString();
      const changed = updateStore(store, all, now);
      const removed = enforceCap(store, maxBytes(), now);
      if (changed || removed > 0 || !fs.existsSync(storeFile)) {
        try {
          saveStore(storeFile, store);
        } catch {
          // a read-only storage folder must not break the session lists
        }
      }
      const merged = mergeSnapshots(store, all);
      fromSnapshot = Object.values(merged).reduce((n, r) => n + r.sessions.filter((s) => s.fromSnapshot).length, 0);
      return merged;
    }),
    sessions.onDidRead((all) => {
      post();
      if (!hasCopilotData(all)) return;
      // Titles are dropped from the cache: Copilot derives them from the conversation.
      const json = JSON.stringify({ version: extVersion, indexes: sessions.exportIndexes() } satisfies IndexFile, (k, v) =>
        k === 'title' ? undefined : v
      );
      if (json === lastIndexJson) return;
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(indexFile, json, 'utf8');
        lastIndexJson = json;
      } catch {
        // the cache is an optimisation only
      }
    }),
    HarnessPanel.onMessage((m) => {
      if (m.type === 'ready') post();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(MAX_MB_SETTING)) void sessions.refresh();
    })
  );
}
