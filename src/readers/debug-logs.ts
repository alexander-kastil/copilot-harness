// Reader for the Copilot Chat debug logs (#9): <workspaceStorage>/<hash>/GitHub.copilot-chat/debug-logs/<sid>/
// main.jsonl plus one <label>-<childSid>.jsonl per subagent run. Entry shape (confirmed in the Copilot
// Chat extension's ChatDebugFileLogger, 1.144): {v, ts, dur, sid, type, name, spanId, parentSpanId?, status, attrs}
// with type session_start | llm_request | tool_call | subagent | child_session_ref | hook | user_message | ...
// Only numbers, ids and model names are read; message, prompt and tool text is never kept.
// Pure Node, no vscode import.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Env, userDataDirs, workspaceStorageDir } from './paths';
import { ScanIndex } from './scan-index';
import { FigureName, ReadResult, SessionSource, SessionSummary, SubagentRun, TokenFigures } from '../shared/session-model';

const SOURCE: SessionSource = 'debugLogs';

interface Entry {
  ts?: number;
  dur?: number;
  type?: string;
  name?: string;
  spanId?: string;
  parentSpanId?: string;
  attrs?: Record<string, unknown>;
}

interface FileFigures {
  llmCalls: number;
  input?: number;
  output?: number;
  cached?: number;
  nanoAiu?: number;
  toolCalls: number;
  userMessages: number;
  models: Set<string>;
  firstTs?: number;
  lastTs?: number;
  skipped: number;
  parentSessionId?: string;
  label?: string;
  sid?: string;
  /** child_session_ref records found in this file: child session id to the span that started it. */
  childRefs: { childSessionId: string; parentSpanId?: string; label?: string; file?: string }[];
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function add(a: number | undefined, b: number | undefined): number | undefined {
  return b === undefined ? a : (a ?? 0) + b;
}

function readJsonl(file: string): FileFigures {
  const f: FileFigures = { llmCalls: 0, toolCalls: 0, userMessages: 0, models: new Set(), skipped: 0, childRefs: [] };
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    f.skipped++;
    return f;
  }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let e: Entry;
    try {
      e = JSON.parse(line) as Entry;
    } catch {
      f.skipped++;
      continue;
    }
    if (!e || typeof e !== 'object' || typeof e.type !== 'string') {
      f.skipped++;
      continue;
    }
    const ts = num(e.ts);
    if (ts !== undefined) {
      f.firstTs = f.firstTs === undefined ? ts : Math.min(f.firstTs, ts);
      const end = ts + (num(e.dur) ?? 0);
      f.lastTs = f.lastTs === undefined ? end : Math.max(f.lastTs, end);
    }
    const a = (e.attrs && typeof e.attrs === 'object' ? e.attrs : {}) as Record<string, unknown>;
    switch (e.type) {
      case 'session_start':
        if (typeof e.attrs?.parentSessionId === 'string') f.parentSessionId = e.attrs.parentSessionId;
        if (typeof e.attrs?.label === 'string') f.label = e.attrs.label;
        if (typeof (e as { sid?: unknown }).sid === 'string') f.sid = (e as { sid: string }).sid;
        break;
      case 'llm_request':
        f.llmCalls++;
        if (typeof a.model === 'string' && a.model !== 'unknown') f.models.add(a.model);
        f.input = add(f.input, num(a.inputTokens));
        f.output = add(f.output, num(a.outputTokens));
        f.cached = add(f.cached, num(a.cachedTokens));
        f.nanoAiu = add(f.nanoAiu, num(a.copilotUsageNanoAiu));
        break;
      case 'tool_call':
        f.toolCalls++;
        break;
      case 'user_message':
        f.userMessages++;
        break;
      case 'child_session_ref':
        if (typeof a.childSessionId === 'string') {
          f.childRefs.push({
            childSessionId: a.childSessionId,
            parentSpanId: typeof e.parentSpanId === 'string' ? e.parentSpanId : undefined,
            label: typeof a.label === 'string' ? a.label : undefined,
            file: typeof a.childLogFile === 'string' ? a.childLogFile : undefined,
          });
        }
        break;
      default:
        break;
    }
  }
  return f;
}

function iso(ms: number | undefined): string | undefined {
  return ms === undefined ? undefined : new Date(ms).toISOString();
}

function tokensOf(f: { input?: number; output?: number; cached?: number }): TokenFigures | undefined {
  if (f.input === undefined && f.output === undefined && f.cached === undefined) return undefined;
  return { input: f.input, output: f.output, cached: f.cached };
}

function workspaceOf(hashDir: string): string | undefined {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(hashDir, 'workspace.json'), 'utf8')) as { folder?: unknown; workspace?: unknown };
    const uri = typeof j.folder === 'string' ? j.folder : typeof j.workspace === 'string' ? j.workspace : undefined;
    if (!uri) return undefined;
    return uri.startsWith('file:') ? decodeURIComponent(uri.replace(/^file:\/\/\/?/, '')) : uri;
  } catch {
    return undefined;
  }
}

function summarizeSession(sessionDir: string, sid: string, variant: string, workspace: string | undefined): SessionSummary {
  const main = path.join(sessionDir, 'main.jsonl');
  const names = fs.readdirSync(sessionDir);
  const sidecars = names.filter((n) => /\.json$/.test(n)).length;
  const childFiles = names.filter((n) => n.endsWith('.jsonl') && n !== 'main.jsonl');
  const m = readJsonl(main);
  if (!fs.existsSync(main)) m.skipped = 0;
  let skipped = m.skipped;

  const subagents: SubagentRun[] = [];
  let input = m.input;
  let output = m.output;
  let cached = m.cached;
  let nano = m.nanoAiu;
  let calls = m.llmCalls;
  let toolCalls = m.toolCalls;
  const models = new Set(m.models);
  let firstTs = m.firstTs;
  let lastTs = m.lastTs;
  for (const cf of childFiles) {
    const c = readJsonl(path.join(sessionDir, cf));
    skipped += c.skipped;
    const ref = m.childRefs.find((r) => r.file === cf);
    const childSid = c.sid ?? ref?.childSessionId ?? cf.replace(/\.jsonl$/, '').slice(-36);
    const run: SubagentRun = {
      id: childSid,
      parentId: ref?.parentSpanId,
      name: c.label ?? ref?.label ?? cf.replace(/-[0-9a-f-]{36}\.jsonl$/, ''),
      model: c.models.size ? [...c.models][0] : undefined,
      start: iso(c.firstTs),
      end: iso(c.lastTs),
      tokens: tokensOf(c),
      toolCalls: c.toolCalls,
      nanoAiu: c.nanoAiu,
    };
    subagents.push(run);
    input = add(input, c.input);
    output = add(output, c.output);
    cached = add(cached, c.cached);
    nano = add(nano, c.nanoAiu);
    calls += c.llmCalls;
    toolCalls += c.toolCalls;
    c.models.forEach((x) => models.add(x));
    if (c.firstTs !== undefined) firstTs = firstTs === undefined ? c.firstTs : Math.min(firstTs, c.firstTs);
    if (c.lastTs !== undefined) lastTs = lastTs === undefined ? c.lastTs : Math.max(lastTs, c.lastTs);
  }

  const hasDetail = calls > 0;
  const tokens = tokensOf({ input, output, cached });
  const provenance: Partial<Record<FigureName, SessionSource>> = {};
  if (hasDetail) {
    provenance.toolCalls = SOURCE;
    if (models.size) provenance.models = SOURCE;
    if (tokens) provenance.tokens = SOURCE;
    if (cached !== undefined) provenance.cachedTokens = SOURCE;
    if (subagents.length) provenance.subagents = SOURCE;
  }
  const s: SessionSummary = {
    source: SOURCE,
    id: sid,
    file: sessionDir,
    workspace,
    variant,
    start: iso(firstTs),
    end: iso(lastTs),
    turns: m.userMessages,
    models: [...models],
    tokens: hasDetail ? tokens : undefined,
    // The unit of copilotUsageNanoAiu is unconfirmed, so credits stay undefined and the raw sum is in nanoAiu.
    credits: undefined,
    detail: hasDetail ? 'perCall' : 'none',
    provenance,
    skipped,
    sidecarFiles: sidecars,
  };
  if (hasDetail) {
    s.toolCalls = toolCalls;
    if (subagents.length) s.subagents = subagents;
    if (nano !== undefined) s.nanoAiu = nano;
  }
  return s;
}

/**
 * Reads every debug-log session folder of every VS Code variant. A session recorded before debug
 * logging was on has no llm_request entries and gets detail 'none' with no figures.
 */
export async function readDebugLogs(env: Env, index?: ScanIndex<SessionSummary>): Promise<ReadResult> {
  const result: ReadResult = { source: SOURCE, sessions: [], roots: [], skipped: 0 };
  const seen = new Set<string>();
  let newest = 0;
  for (const { variant, dir } of userDataDirs(env)) {
    const wsRoot = workspaceStorageDir(dir);
    result.roots.push(wsRoot);
    let hashes: string[];
    try {
      hashes = fs.readdirSync(wsRoot);
    } catch {
      continue;
    }
    for (const hash of hashes) {
      const logs = path.join(wsRoot, hash, 'GitHub.copilot-chat', 'debug-logs');
      let sids: string[];
      try {
        sids = fs.readdirSync(logs);
      } catch {
        continue;
      }
      let workspace: string | undefined;
      let wsRead = false;
      for (const sid of sids) {
        const sessionDir = path.join(logs, sid);
        try {
          if (!fs.statSync(sessionDir).isDirectory()) continue;
          let size = 0;
          let mtime = 0;
          for (const n of fs.readdirSync(sessionDir)) {
            if (!n.endsWith('.jsonl')) continue;
            const st = fs.statSync(path.join(sessionDir, n));
            size += st.size;
            mtime = Math.max(mtime, st.mtimeMs);
          }
          seen.add(sessionDir);
          let s = index?.get(sessionDir, size, mtime);
          if (!s) {
            if (!wsRead) {
              workspace = workspaceOf(path.join(wsRoot, hash));
              wsRead = true;
            }
            s = summarizeSession(sessionDir, sid, variant, workspace);
            index?.set(sessionDir, size, mtime, s);
          }
          result.sessions.push(s);
          result.skipped += s.skipped;
          if (s.end) newest = Math.max(newest, Date.parse(s.end));
        } catch {
          result.skipped++;
        }
      }
    }
  }
  index?.retain(seen);
  if (newest) result.newest = new Date(newest).toISOString();
  return result;
}
