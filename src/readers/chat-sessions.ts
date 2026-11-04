// Reads the chat sessions VS Code writes under <user data>/User/workspaceStorage/<hash>/chatSessions/.
// Two file shapes exist on disk: .jsonl is a patch log (kind 0 = full snapshot, kind 1 = set the
// value at path k, kind 2 = append to the array at path k), .json is one full session object.
// Pure Node, no vscode import. Never keeps prompt, response or tool-result text: only counts,
// ids, model ids, timestamps and numeric figures leave this module.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Env, userDataDirs, workspaceStorageDir } from './paths';
import { ScanIndex } from './scan-index';
import { ReadResult, SessionSummary, TokenFigures } from '../shared/session-model';

type Json = unknown;
type Obj = Record<string, Json>;

function isObj(v: Json): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: Json): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function iso(ms: number | undefined): string | undefined {
  return ms === undefined || !Number.isFinite(new Date(ms).getTime()) ? undefined : new Date(ms).toISOString();
}

/** Applies one patch record to the state; returns the new state or throws on an unusable path. */
function applyPatch(state: Json, rec: Obj): Json {
  if (rec.kind === 0) return rec.v;
  if (!isObj(state) || !Array.isArray(rec.k) || rec.k.length === 0) throw new Error('patch');
  let target: Json = state;
  const keys = rec.k as (string | number)[];
  for (let i = 0; i < keys.length - 1; i++) {
    target = (target as Obj)[keys[i]];
    if (typeof target !== 'object' || target === null) throw new Error('path');
  }
  const last = keys[keys.length - 1];
  if (rec.kind === 1) {
    (target as Obj)[last] = rec.v;
  } else if (rec.kind === 2) {
    const arr = (target as Obj)[last];
    if (!Array.isArray(arr)) throw new Error('append');
    const items = Array.isArray(rec.v) ? rec.v : [];
    if (typeof rec.i === 'number') arr.splice(rec.i, 0, ...items);
    else arr.push(...items);
  } else {
    throw new Error('kind');
  }
  return state;
}

interface Parsed {
  state: Obj | undefined;
  skipped: number;
}

function parseFile(text: string, isJsonl: boolean): Parsed {
  if (!isJsonl) {
    try {
      const v = JSON.parse(text);
      return isObj(v) ? { state: v, skipped: 0 } : { state: undefined, skipped: 1 };
    } catch {
      return { state: undefined, skipped: 1 };
    }
  }
  let state: Json;
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const rec = JSON.parse(line);
      if (!isObj(rec)) throw new Error('shape');
      state = applyPatch(state, rec);
    } catch {
      skipped++;
    }
  }
  return { state: isObj(state) ? state : undefined, skipped };
}

/**
 * Token figures of one request. Fields confirmed on real files, in order of preference:
 * request.promptTokens/completionTokens, result.usage.promptTokens/completionTokens,
 * result.metadata.promptTokens/outputTokens. Cached tokens are not carried per request.
 */
function requestTokens(req: Obj): { input?: number; output?: number } {
  const result = isObj(req.result) ? req.result : {};
  const usage = isObj(result.usage) ? result.usage : {};
  const meta = isObj(result.metadata) ? result.metadata : {};
  const input = num(req.promptTokens) ?? num(usage.promptTokens) ?? num(meta.promptTokens);
  const output = num(req.completionTokens) ?? num(usage.completionTokens) ?? num(meta.outputTokens);
  return { input, output };
}

function summarize(
  state: Obj,
  file: string,
  fallbackId: string,
  variant: string,
  workspace: string | undefined,
  skipped: number,
): SessionSummary {
  const requests = Array.isArray(state.requests) ? state.requests.filter(isObj) : [];
  const models = new Set<string>();
  let input: number | undefined;
  let output: number | undefined;
  let credits: number | undefined;
  let toolCalls = 0;
  let sawTool = false;
  let lastMs = num(state.lastMessageDate);
  for (const req of requests) {
    if (typeof req.modelId === 'string') models.add(req.modelId);
    const t = requestTokens(req);
    if (t.input !== undefined) input = (input ?? 0) + t.input;
    if (t.output !== undefined) output = (output ?? 0) + t.output;
    const c = num(req.copilotCredits);
    if (c !== undefined) credits = (credits ?? 0) + c;
    if (Array.isArray(req.response)) {
      sawTool = true;
      for (const item of req.response) if (isObj(item) && item.kind === 'toolInvocationSerialized') toolCalls++;
    }
    const done = isObj(req.modelState) ? num(req.modelState.completedAt) : undefined;
    for (const ms of [done, num(req.timestamp)]) if (ms !== undefined && (lastMs === undefined || ms > lastMs)) lastMs = ms;
  }
  const hasTokens = input !== undefined || output !== undefined;
  const tokens: TokenFigures | undefined = hasTokens ? { input, output, cached: undefined } : undefined;
  const firstTs = requests.length ? num(requests[0].timestamp) : undefined;
  return {
    source: 'chatSessions',
    id: typeof state.sessionId === 'string' ? state.sessionId : fallbackId,
    file,
    workspace,
    variant,
    title: typeof state.customTitle === 'string' && state.customTitle ? state.customTitle : undefined,
    start: iso(num(state.creationDate) ?? firstTs),
    end: iso(lastMs),
    turns: requests.length,
    models: [...models],
    tokens,
    credits,
    toolCalls: sawTool ? toolCalls : undefined,
    detail: hasTokens || credits !== undefined ? 'perTurn' : 'none',
    provenance: {
      ...(hasTokens ? { tokens: 'chatSessions' as const } : {}),
      ...(credits !== undefined ? { credits: 'chatSessions' as const } : {}),
      ...(sawTool ? { toolCalls: 'chatSessions' as const } : {}),
      ...(models.size ? { models: 'chatSessions' as const } : {}),
    },
    skipped,
  };
}

/** Resolves a storage folder to its workspace folder through workspace.json ({folder} or {workspace}). */
export function workspaceOf(storageDir: string): string | undefined {
  try {
    const wj = JSON.parse(fs.readFileSync(path.join(storageDir, 'workspace.json'), 'utf8'));
    const uri = isObj(wj) ? (typeof wj.folder === 'string' ? wj.folder : typeof wj.workspace === 'string' ? wj.workspace : undefined) : undefined;
    if (!uri) return undefined;
    if (uri.startsWith('file://')) {
      let p = decodeURIComponent(uri.slice('file://'.length));
      if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
      return p;
    }
    return decodeURIComponent(uri);
  } catch {
    return undefined;
  }
}

export async function readChatSessions(env: Env, index?: ScanIndex<SessionSummary>): Promise<ReadResult> {
  const roots: string[] = [];
  const sessions: SessionSummary[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const { variant, dir } of userDataDirs(env)) {
    const wsRoot = workspaceStorageDir(dir);
    roots.push(wsRoot);
    let hashes: string[];
    try {
      hashes = await fs.promises.readdir(wsRoot);
    } catch {
      continue;
    }
    for (const hash of hashes) {
      const storage = path.join(wsRoot, hash);
      const chatDir = path.join(storage, 'chatSessions');
      let names: string[];
      try {
        names = await fs.promises.readdir(chatDir);
      } catch {
        continue;
      }
      const workspace = workspaceOf(storage);
      for (const name of names) {
        if (!name.endsWith('.jsonl') && !name.endsWith('.json')) continue;
        const file = path.join(chatDir, name);
        let st: fs.Stats;
        try {
          st = await fs.promises.stat(file);
        } catch {
          continue;
        }
        seen.add(file);
        const cached = index?.get(file, st.size, st.mtimeMs);
        if (cached) {
          sessions.push({ ...cached, workspace, variant });
          skipped += cached.skipped;
          continue;
        }
        let text: string;
        try {
          text = await fs.promises.readFile(file, 'utf8');
        } catch {
          skipped++;
          continue;
        }
        const { state, skipped: sk } = parseFile(text, name.endsWith('.jsonl'));
        if (!state) {
          skipped += sk;
          continue;
        }
        const summary = summarize(state, file, name.replace(/\.jsonl?$/, ''), variant, workspace, sk);
        index?.set(file, st.size, st.mtimeMs, summary);
        sessions.push(summary);
        skipped += sk;
      }
    }
  }
  index?.retain(seen);
  let newest: string | undefined;
  for (const s of sessions) if (s.end && (!newest || s.end > newest)) newest = s.end;
  return { source: 'chatSessions', sessions, roots, newest, skipped };
}
