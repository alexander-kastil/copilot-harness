// Pointer check for AGENTS.md (ported from Claude Harness): a path, skill or agent named in backticks that
// does not exist. Pure: no vscode import. The roster comes in as sets of names.
import * as fs from 'node:fs';
import * as path from 'node:path';

export type PointerKind = 'path' | 'skill' | 'agent';

export interface PointerToken {
  line: number;
  start: number;
  end: number;
  token: string;
  kind: PointerKind;
}

export interface Roster {
  skills: Set<string>;
  agents: Set<string>;
}

export interface CheckedDoc {
  file: string;
  kinds: PointerKind[];
}

export const AGENTS_DOC_NAME = 'AGENTS.md';

const ALL_KINDS: PointerKind[] = ['path', 'skill', 'agent'];
const WALK_SKIP = new Set(['node_modules', '.git', '__pycache__', '.venv', 'bin', 'obj', 'dist', 'out', '.angular', 'worktrees']);
const SKIP_POINTERS = new Set(['tasks/todo.md', 'tasks/lessons.md']);
const IMPORT = /(^|\s)@((?:~[\\/]|\.{1,2}[\\/]|[A-Za-z]:[\\/]|\/)?[^\s`'"()<>,;]+)/g;

const readText = (file: string): string => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};

/** The `@path` imports of a markdown text, outside code fences and backticks. */
export function importsOf(text: string): string[] {
  const out: string[] = [];
  let fence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    for (const m of line.replace(/`[^`]*`/g, ' ').matchAll(IMPORT)) out.push(m[2].replace(/[.:!?]+$/, ''));
  }
  return out;
}

function importedFiles(file: string, depth = 0, seen = new Set<string>()): string[] {
  const out: string[] = [];
  const key = path.resolve(file).toLowerCase();
  if (depth >= 5 || seen.has(key)) return out;
  seen.add(key);
  for (const ref of importsOf(readText(file))) {
    const target = /^~[\\/]/.test(ref) ? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', ref.slice(2)) : path.isAbsolute(ref) ? ref : path.resolve(path.dirname(file), ref);
    if (!/\.md$/i.test(target) || !fs.existsSync(target) || !fs.statSync(target).isFile()) continue;
    out.push(target, ...importedFiles(target, depth + 1, seen));
  }
  return out;
}

/** The docs a repo check reads: every AGENTS.md of the repo (root and nested) and every markdown file they import (to depth 5). */
export function checkedDocs(repo: string): CheckedDoc[] {
  const roots = repoFiles(repo)
    .files.filter((f) => f === AGENTS_DOC_NAME || f.endsWith(`/${AGENTS_DOC_NAME}`))
    .map((f) => path.join(repo, f));
  const seen = new Set<string>();
  return roots
    .flatMap((r) => [r, ...importedFiles(r)])
    .filter((f) => {
      const k = path.resolve(f).toLowerCase();
      return !seen.has(k) && !!seen.add(k);
    })
    .map((file) => ({ file, kinds: ALL_KINDS }));
}

const isPathToken = (p: string) =>
  !SKIP_POINTERS.has(p) &&
  !p.endsWith('-') &&
  !/^(~|https?:|\$|-|@|<|\{|\/)/.test(p) &&
  !/[*<>{}|()"'=,]/.test(p) &&
  !p.replace(/^[A-Za-z]:[\\/]/, '').includes(':') &&
  (/^[A-Za-z]:[\\/]/.test(p) || p.includes('/'));

const wordsIn = (text: string) => text.replace(/`[^`]*`/g, ' ').split(/[^A-Za-z0-9'-]+/).filter(Boolean).length;

const wordAt = (text: string, re: RegExp, fromEnd: boolean) => {
  const hits = [...text.matchAll(re)];
  if (!hits.length) return Infinity;
  const gap = fromEnd ? wordsIn(text.slice(hits[hits.length - 1].index! + hits[hits.length - 1][0].length)) : wordsIn(text.slice(0, hits[0].index!));
  return gap <= 1 ? gap : Infinity;
};

/** Backticked paths, and backticked names that sit right next to the word skill or agent. */
export function pointerTokens(text: string): PointerToken[] {
  const out: PointerToken[] = [];
  let fence = false;
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    for (const m of line.matchAll(/`([^`\s]+)`/g)) {
      const token = m[1].replace(/[.,:;)]+$/, '');
      const start = m.index! + 1;
      const item = (kind: PointerKind) => out.push({ line: i, start, end: start + token.length, token, kind });
      if (/[\\/]/.test(token)) {
        if (isPathToken(token)) item('path');
        continue;
      }
      if (!/^[a-z0-9][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*)?$/.test(token)) continue;
      const before = line.slice(Math.max(0, m.index! - 40), m.index!).toLowerCase();
      const after = line.slice(m.index! + m[0].length, m.index! + m[0].length + 30).toLowerCase();
      if (/\b(?:leaf|leaves|references?|sections?)\b[^a-z]*$/.test(before.replace(/`[^`]*`/g, ' '))) continue;
      const agent = Math.min(wordAt(before, /\b(?:sub)?agents?\b/g, true), wordAt(after, /\b(?:sub)?agents?\b/g, false));
      const skill = Math.min(wordAt(before, /\bskills?\b/g, true), wordAt(after, /\bskills?\b/g, false));
      if (agent === Infinity && skill === Infinity) continue;
      item(agent <= skill ? 'agent' : 'skill');
    }
  });
  return out;
}

const walkCache = new Map<string, { at: number; files: string[] }>();

/** Relative paths (forward slashes) of the files below a folder, cached for 30 seconds. */
export function repoFiles(dir: string, cap = 20000): { files: string[] } {
  const hit = walkCache.get(dir);
  if (hit && Date.now() - hit.at < 30000) return hit;
  const files: string[] = [];
  const walk = (abs: string, rel: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (files.length >= cap) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!WALK_SKIP.has(e.name)) walk(path.join(abs, e.name), r);
      } else files.push(r);
    }
  };
  walk(dir, '');
  const result = { at: Date.now(), files };
  walkCache.set(dir, result);
  return result;
}

const suffixHit = (token: string, dirs: string[]) => {
  const t = token.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  return dirs.some((dir) => repoFiles(dir).files.some((f) => f === t || f.endsWith(`/${t}`) || f.startsWith(`${t}/`) || f.includes(`/${t}/`)));
};

/** The tokens that name something that does not exist: a path outside the repo files, a skill or agent outside the roster. */
export function deadPointers(text: string, baseDir: string, roster: Roster, kinds: PointerKind[] = ALL_KINDS, also: string[] = []): PointerToken[] {
  return pointerTokens(text).filter((t) => {
    if (!kinds.includes(t.kind)) return false;
    if (t.kind === 'path') {
      if (/^[A-Za-z]:[\\/]/.test(t.token)) return !fs.existsSync(t.token);
      return !fs.existsSync(path.join(baseDir, t.token.replace(/^\.\//, ''))) && !suffixHit(t.token, [baseDir, ...also]);
    }
    const set = t.kind === 'skill' ? roster.skills : roster.agents;
    return !set.has(t.token) && !(t.kind === 'agent' && roster.skills.has(t.token)) && !(t.kind === 'skill' && roster.agents.has(t.token));
  });
}

export function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

export function closest(name: string, pool: Iterable<string>, n = 3): string[] {
  const limit = Math.max(3, Math.floor(name.length / 3));
  return [...new Set(pool)]
    .map((p) => ({ p, d: editDistance(name.toLowerCase(), p.toLowerCase()) }))
    .filter((x) => x.d <= limit && x.p !== name)
    .sort((a, b) => a.d - b.d || a.p.localeCompare(b.p))
    .slice(0, n)
    .map((x) => x.p);
}

export function pathCandidates(token: string, baseDir: string, n = 3): string[] {
  const base = path.posix.basename(token.replace(/\\/g, '/').replace(/\/$/, ''));
  const { files } = repoFiles(baseDir);
  const dirs = new Set(files.flatMap((f) => f.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))));
  const pool = [...files, ...[...dirs].map((d) => `${d}/`)];
  const same = pool.filter((p) => path.posix.basename(p.replace(/\/$/, '')) === base);
  return (same.length ? same : closest(token, pool, n)).slice(0, n);
}
