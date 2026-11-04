// Reads the Copilot CLI session folders under ~/.copilot/session-state/<id>/: workspace.yaml,
// events.jsonl and the rewind-snapshots folder (counted only). Pure Node, no vscode import.
// Keeps no message text: only ids, counts, model names, timestamps and numeric figures leave here.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { parse as parseYaml } from 'yaml';
import { Env, copilotHome } from './paths';
import { ScanIndex } from './scan-index';
import { ReadResult, SessionSummary, SubagentRun, TokenFigures, UsageSnapshot } from '../shared/session-model';

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

/** Event types seen on real files plus the documented ones; anything else is counted as skipped. */
const KNOWN_TYPES = new Set([
  'session.start', 'session.resume', 'session.shutdown', 'session.usage_checkpoint', 'session.usage_record',
  'session.error', 'session.warning', 'session.info', 'session.model_change', 'session.mode_changed',
  'session.permissions_changed', 'session.plan_changed', 'session.task_complete', 'session.compaction_start',
  'session.compaction_complete', 'session.binary_asset', 'user.message', 'system.message', 'system.notification',
  'assistant.turn_start', 'assistant.turn_end', 'assistant.message', 'assistant.reasoning',
  'tool.execution_start', 'tool.execution_complete', 'external_tool.requested', 'external_tool.completed',
  'hook.start', 'hook.end', 'permission.requested', 'permission.completed', 'subagent.started',
  'subagent.completed', 'subagent.failed', 'subagent.configured', 'subagent.selected', 'subagent.deselected',
  'skill.invoked', 'skill.context_delivered_ref', 'abort',
]);

function tokenCount(details: Obj, key: string): number | undefined {
  const d = details[key];
  return isObj(d) ? num(d.tokenCount) : undefined;
}

/** One session.shutdown or session.usage_checkpoint record, kept as written and never summed. */
function snapshotOf(type: string, ts: string | undefined, data: Obj): UsageSnapshot {
  const raw: Record<string, number | string | boolean | null> = {};
  for (const k of [
    'totalNanoAiu', 'totalPremiumRequests', 'totalApiDurationMs', 'currentTokens', 'systemTokens',
    'conversationTokens', 'toolDefinitionsTokens', 'sessionStartTime', 'eventsFileSizeBytes',
  ]) {
    const n = num(data[k]);
    if (n !== undefined) raw[k] = n;
  }
  const shutdownType = str(data.shutdownType);
  if (shutdownType) raw.shutdownType = shutdownType;
  if (isObj(data.codeChanges)) {
    const a = num(data.codeChanges.linesAdded);
    const r = num(data.codeChanges.linesRemoved);
    if (a !== undefined) raw.linesAdded = a;
    if (r !== undefined) raw.linesRemoved = r;
  }
  if (isObj(data.modelMetrics)) {
    for (const [model, m] of Object.entries(data.modelMetrics)) {
      if (!isObj(m)) continue;
      const usage = isObj(m.usage) ? m.usage : {};
      const requests = isObj(m.requests) ? m.requests : {};
      for (const [k, v] of Object.entries({
        inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens, reasoningTokens: usage.reasoningTokens,
        totalNanoAiu: m.totalNanoAiu, requestCount: requests.count, requestCost: requests.cost,
      })) {
        const n = num(v);
        if (n !== undefined) raw[`model:${model}:${k}`] = n;
      }
    }
  }
  let tokens: TokenFigures | undefined;
  if (isObj(data.tokenDetails)) {
    const input = tokenCount(data.tokenDetails, 'input');
    const output = tokenCount(data.tokenDetails, 'output');
    const cached = tokenCount(data.tokenDetails, 'cache_read');
    if (input !== undefined || output !== undefined || cached !== undefined) tokens = { input, output, cached };
  }
  return {
    eventType: type,
    timestamp: ts,
    model: str(data.currentModel),
    tokens,
    // totalNanoAiu is kept raw; its unit is not mapped to credits here (decided by #13).
    credits: undefined,
    raw,
  };
}

async function countEntries(dir: string): Promise<number | undefined> {
  try {
    return (await fs.promises.readdir(dir)).length;
  } catch {
    return undefined;
  }
}

async function readSession(
  dir: string,
  id: string,
  eventsFile: string,
  yamlFile: string,
): Promise<SessionSummary> {
  let meta: Obj = {};
  try {
    const y = parseYaml(await fs.promises.readFile(yamlFile, 'utf8'));
    if (isObj(y)) meta = y;
  } catch {
    // missing or malformed workspace.yaml: the session still lists from its events
  }
  let skipped = 0;
  let start = str(meta.created_at);
  let end = str(meta.updated_at);
  let turns = 0;
  let toolCalls = 0;
  let skills = 0;
  const models = new Set<string>();
  const snapshots: UsageSnapshot[] = [];
  const subagents = new Map<string, SubagentRun>();
  let sawEvents = false;

  try {
    const rl = readline.createInterface({ input: fs.createReadStream(eventsFile, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (line.trim() === '') continue;
      let ev: unknown;
      try {
        ev = JSON.parse(line);
      } catch {
        skipped++;
        continue;
      }
      if (!isObj(ev) || typeof ev.type !== 'string') {
        skipped++;
        continue;
      }
      sawEvents = true;
      const type = ev.type;
      const ts = str(ev.timestamp);
      const data = isObj(ev.data) ? ev.data : {};
      if (!KNOWN_TYPES.has(type)) {
        skipped++;
        continue;
      }
      if (ts && (!end || ts > end)) end = ts;
      switch (type) {
        case 'session.start': {
          const st = str(data.startTime);
          if (st) start = st;
          const m = str(data.selectedModel);
          if (m) models.add(m);
          break;
        }
        case 'session.model_change': {
          const m = str(data.newModel);
          if (m) models.add(m);
          break;
        }
        case 'user.message':
          turns++;
          break;
        case 'assistant.turn_start': {
          const m = str(data.model);
          if (m) models.add(m);
          break;
        }
        case 'tool.execution_start':
          toolCalls++;
          break;
        case 'skill.invoked':
          skills++;
          break;
        case 'subagent.started': {
          const sid = str(data.toolCallId) ?? str(ev.id) ?? String(subagents.size);
          const m = str(data.model);
          if (m) models.add(m);
          subagents.set(sid, {
            id: sid,
            parentId: str(data.parentId),
            name: str(data.agentName),
            model: m,
            start: ts,
          });
          break;
        }
        case 'subagent.completed':
        case 'subagent.failed': {
          const sid = str(data.toolCallId) ?? str(ev.id) ?? String(subagents.size);
          const run = subagents.get(sid) ?? { id: sid, name: str(data.agentName) };
          run.end = ts;
          run.model = run.model ?? str(data.model);
          run.toolCalls = num(data.totalToolCalls);
          subagents.set(sid, run);
          break;
        }
        case 'session.shutdown':
        case 'session.usage_checkpoint':
          snapshots.push(snapshotOf(type, ts, data));
          break;
        default:
          break;
      }
    }
  } catch {
    skipped++;
  }

  const snapDir = path.join(dir, 'rewind-snapshots');
  const snapCount = (await countEntries(path.join(snapDir, 'backups'))) ?? (await countEntries(snapDir));
  const cwd = str(meta.cwd);
  // subagent.completed carries only totalTokens (no input/output split), so no TokenFigures are reported.
  const runs = [...subagents.values()];
  return {
    source: 'cli',
    id: str(meta.id) ?? id,
    file: eventsFile,
    workspace: cwd,
    repository: str(meta.repository),
    branch: str(meta.branch),
    title: meta.user_named === true ? str(meta.name) : undefined,
    start,
    end,
    turns,
    models: [...models],
    tokens: undefined,
    credits: undefined,
    toolCalls: sawEvents ? toolCalls : undefined,
    subagents: sawEvents ? runs : undefined,
    skills: sawEvents ? skills : undefined,
    usageSnapshots: snapshots,
    detail: snapshots.length ? 'totalsOnly' : 'none',
    provenance: {
      ...(sawEvents ? { toolCalls: 'cli' as const, subagents: 'cli' as const, skills: 'cli' as const } : {}),
      ...(models.size ? { models: 'cli' as const } : {}),
    },
    skipped,
    snapshotDir: snapCount === undefined ? undefined : { path: snapDir, count: snapCount },
  };
}

export async function readCliSessions(env: Env, index?: ScanIndex<SessionSummary>): Promise<ReadResult> {
  const root = path.join(copilotHome(env), 'session-state');
  const sessions: SessionSummary[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let ids: string[];
  try {
    ids = await fs.promises.readdir(root);
  } catch {
    return { source: 'cli', sessions, roots: [root], skipped };
  }
  for (const id of ids) {
    const dir = path.join(root, id);
    const eventsFile = path.join(dir, 'events.jsonl');
    const yamlFile = path.join(dir, 'workspace.yaml');
    let size = 0;
    let mtimeMs = 0;
    let found = false;
    for (const f of [eventsFile, yamlFile]) {
      try {
        const st = await fs.promises.stat(f);
        size += st.size;
        mtimeMs = Math.max(mtimeMs, st.mtimeMs);
        found = true;
      } catch {
        // one of the two files may be absent
      }
    }
    if (!found) continue;
    seen.add(eventsFile);
    const cached = index?.get(eventsFile, size, mtimeMs);
    if (cached) {
      sessions.push(cached);
      skipped += cached.skipped;
      continue;
    }
    const s = await readSession(dir, id, eventsFile, yamlFile);
    index?.set(eventsFile, size, mtimeMs, s);
    sessions.push(s);
    skipped += s.skipped;
  }
  index?.retain(seen);
  let newest: string | undefined;
  for (const s of sessions) if (s.end && (!newest || s.end > newest)) newest = s.end;
  return { source: 'cli', sessions, roots: [root], newest, skipped };
}
