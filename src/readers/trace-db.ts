// Reader for the Copilot Chat OpenTelemetry trace database (#9): <globalStorage>/github.copilot-chat/agent-traces.db.
// Schema confirmed in the Copilot Chat extension (1.144): tables spans, span_attributes, span_events and a
// sessions view; the extension itself opens it with node:sqlite, which loads in the VS Code 1.144 extension
// host (Node 24.22). Opened read-only. Only metadata and number columns of spans, plus the one numeric
// attribute copilot_chat.copilot_usage_nano_aiu, are selected: never name, status_message, span_events or any
// other span_attributes row, because those hold prompts, responses and tool results in plain text.
// Pure Node, no vscode import.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Env, globalStorageDir, userDataDirs } from './paths';
import { ScanIndex } from './scan-index';
import { FigureName, ReadResult, SessionSource, SessionSummary, SubagentRun, TokenFigures } from '../shared/session-model';

const SOURCE: SessionSource = 'traceDb';
const NANO_AIU_KEY = 'copilot_chat.copilot_usage_nano_aiu';

interface Stmt {
  all(...params: unknown[]): Record<string, unknown>[];
}
interface Db {
  prepare(sql: string): Stmt;
  close(): void;
}
type DbCtor = new (file: string, options?: { readOnly?: boolean }) => Db;

interface SpanRow {
  span_id: string;
  parent_span_id: string | null;
  operation_name: string | null;
  agent_name: string | null;
  session_id: string | null;
  request_model: string | null;
  response_model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_tokens: number | null;
  start_time_ms: number | null;
  end_time_ms: number | null;
}

function loadSqlite(): { ctor?: DbCtor; reason?: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('node:sqlite') as { DatabaseSync?: DbCtor };
    if (m.DatabaseSync) return { ctor: m.DatabaseSync };
    return { reason: 'node:sqlite has no DatabaseSync; this Node is too old (needs Node 22.5 or newer)' };
  } catch (e) {
    return { reason: `node:sqlite could not be loaded (${(e as Error).message}); the fallback package would be better-sqlite3` };
  }
}

function n(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function add(a: number | undefined, b: number | undefined): number | undefined {
  return b === undefined ? a : (a ?? 0) + b;
}
function iso(ms: number | undefined): string | undefined {
  return ms === undefined ? undefined : new Date(ms).toISOString();
}
function tokensOf(f: { input?: number; output?: number; cached?: number }): TokenFigures | undefined {
  return f.input === undefined && f.output === undefined && f.cached === undefined
    ? undefined
    : { input: f.input, output: f.output, cached: f.cached };
}

interface Acc {
  input?: number;
  output?: number;
  cached?: number;
  nano?: number;
  calls: number;
  tools: number;
  models: Set<string>;
  first?: number;
  last?: number;
}
function acc(): Acc {
  return { calls: 0, tools: 0, models: new Set() };
}
function touch(a: Acc, s: SpanRow): void {
  const st = n(s.start_time_ms);
  const en = n(s.end_time_ms);
  if (st !== undefined) a.first = a.first === undefined ? st : Math.min(a.first, st);
  if (en !== undefined) a.last = a.last === undefined ? en : Math.max(a.last, en);
}

function summarize(file: string, variant: string, rows: SpanRow[], nano: Map<string, number>): { sessions: SessionSummary[]; skipped: number } {
  let skipped = 0;
  const bySession = new Map<string, SpanRow[]>();
  for (const r of rows) {
    if (typeof r.span_id !== 'string') {
      skipped++;
      continue;
    }
    if (!r.session_id) continue; // same rule as the extension's own sessions view
    let l = bySession.get(r.session_id);
    if (!l) bySession.set(r.session_id, (l = []));
    l.push(r);
  }
  const sessions: SessionSummary[] = [];
  for (const [id, spans] of bySession) {
    const byId = new Map(spans.map((s) => [s.span_id, s]));
    const isSub = (s: SpanRow) => s.operation_name === 'invoke_agent' && !!s.parent_span_id;
    const subOf = (s: SpanRow): SpanRow | undefined => {
      let cur: SpanRow | undefined = s;
      for (let i = 0; cur && i < 64; i++) {
        if (isSub(cur)) return cur;
        cur = cur.parent_span_id ? byId.get(cur.parent_span_id) : undefined;
      }
      return undefined;
    };
    const total = acc();
    const subs = new Map<string, Acc>();
    let turns = 0;
    for (const s of spans) {
      touch(total, s);
      if (s.operation_name === 'invoke_agent' && !s.parent_span_id) turns++;
      const sub = subOf(s);
      const a = sub ? (subs.get(sub.span_id) ?? subs.set(sub.span_id, acc()).get(sub.span_id)!) : undefined;
      if (a) touch(a, s);
      if (s.operation_name === 'chat') {
        for (const t of a ? [total, a] : [total]) {
          t.calls++;
          t.input = add(t.input, n(s.input_tokens));
          t.output = add(t.output, n(s.output_tokens));
          t.cached = add(t.cached, n(s.cached_tokens));
          t.nano = add(t.nano, nano.get(s.span_id));
          const m = s.response_model ?? s.request_model;
          if (m) t.models.add(m);
        }
      } else if (s.operation_name === 'execute_tool') {
        total.tools++;
        if (a) a.tools++;
      }
    }
    const subagents: SubagentRun[] = [];
    for (const s of spans.filter(isSub)) {
      const a = subs.get(s.span_id) ?? acc();
      subagents.push({
        id: s.span_id,
        parentId: s.parent_span_id ?? undefined,
        name: s.agent_name ?? undefined,
        model: a.models.size ? [...a.models][0] : undefined,
        start: iso(n(s.start_time_ms)),
        end: iso(n(s.end_time_ms)),
        tokens: tokensOf(a),
        toolCalls: a.tools,
        nanoAiu: a.nano,
      });
    }
    const hasDetail = total.calls > 0;
    const tokens = tokensOf(total);
    const provenance: Partial<Record<FigureName, SessionSource>> = {};
    if (hasDetail) {
      provenance.toolCalls = SOURCE;
      if (total.models.size) provenance.models = SOURCE;
      if (tokens) provenance.tokens = SOURCE;
      if (total.cached !== undefined) provenance.cachedTokens = SOURCE;
      if (subagents.length) provenance.subagents = SOURCE;
    }
    const s: SessionSummary = {
      source: SOURCE,
      id,
      file,
      variant,
      start: iso(total.first),
      end: iso(total.last),
      turns,
      models: [...total.models],
      tokens: hasDetail ? tokens : undefined,
      // Unit of the nano AIU attribute is unconfirmed, so credits stay undefined and the raw sum is in nanoAiu.
      credits: undefined,
      detail: hasDetail ? 'perCall' : 'none',
      provenance,
      skipped: 0,
    };
    if (hasDetail) {
      s.toolCalls = total.tools;
      if (subagents.length) s.subagents = subagents;
      if (total.nano !== undefined) s.nanoAiu = total.nano;
    }
    sessions.push(s);
  }
  return { sessions, skipped };
}

/**
 * Reads agent-traces.db of every VS Code variant, read-only. Without node:sqlite it returns an empty
 * result with `reason`; the package to install in that case is better-sqlite3 (native binding).
 */
export async function readTraceDb(env: Env, index?: ScanIndex<SessionSummary[]>): Promise<ReadResult> {
  const result: ReadResult = { source: SOURCE, sessions: [], roots: [], skipped: 0 };
  const files: { variant: string; file: string }[] = [];
  for (const { variant, dir } of userDataDirs(env)) {
    const file = path.join(globalStorageDir(dir), 'github.copilot-chat', 'agent-traces.db');
    result.roots.push(file);
    if (fs.existsSync(file)) files.push({ variant, file });
  }
  if (!files.length) return result;
  const { ctor, reason } = loadSqlite();
  if (!ctor) {
    result.reason = reason;
    return result;
  }
  const seen = new Set<string>();
  let newest = 0;
  for (const { variant, file } of files) {
    try {
      // The WAL file carries recent writes, so its size and mtime join the cache key.
      let size = 0;
      let mtime = 0;
      for (const f of [file, `${file}-wal`]) {
        if (!fs.existsSync(f)) continue;
        const st = fs.statSync(f);
        size += st.size;
        mtime = Math.max(mtime, st.mtimeMs);
      }
      seen.add(file);
      let list = index?.get(file, size, mtime);
      if (!list) {
        const db = new ctor(file, { readOnly: true });
        try {
          const rows = db
            .prepare(
              `SELECT span_id, parent_span_id, operation_name, agent_name,
                      COALESCE(conversation_id, chat_session_id) AS session_id,
                      request_model, response_model, input_tokens, output_tokens, cached_tokens,
                      start_time_ms, end_time_ms FROM spans`,
            )
            .all() as unknown as SpanRow[];
          const nano = new Map<string, number>();
          for (const r of db.prepare('SELECT span_id, value FROM span_attributes WHERE key = ?').all(NANO_AIU_KEY)) {
            const v = Number(r.value);
            if (typeof r.span_id === 'string' && Number.isFinite(v)) nano.set(r.span_id, v);
          }
          const out = summarize(file, variant, rows, nano);
          result.skipped += out.skipped;
          list = out.sessions;
        } finally {
          db.close();
        }
        index?.set(file, size, mtime, list);
      }
      result.sessions.push(...list);
    } catch (e) {
      result.skipped++;
      result.reason = `agent-traces.db could not be read (${(e as Error).message})`;
    }
  }
  index?.retain(seen);
  for (const s of result.sessions) if (s.end) newest = Math.max(newest, Date.parse(s.end));
  if (newest) result.newest = new Date(newest).toISOString();
  return result;
}
