// Commit and pull request message building and the AI Commit (Sitoi.ai-commit) settings migration plan.
// Pure: no vscode import, no key is ever logged or returned in a message.
import { LANGUAGES } from './byok-models';
import type { HFApiMode, HFModelItem } from './byok-types';

/** Characters of diff sent to the model; whole files are kept, the rest is listed by name. */
export const DIFF_CHAR_LIMIT = 24000;

const TYPES: [string, string, string, string][] = [
  ['feat', '✨', 'New feature', 'user, payment'],
  ['fix', '🐛', 'Bug fix', 'auth, data'],
  ['docs', '📝', 'Documentation', 'README, API'],
  ['style', '💄', 'Code style', 'formatting'],
  ['refactor', '♻️', 'Code refactoring', 'utils, helpers'],
  ['perf', '⚡️', 'Performance', 'query, cache'],
  ['test', '✅', 'Testing', 'unit, e2e'],
  ['build', '📦', 'Build system', 'webpack, npm'],
  ['ci', '👷', 'CI config', 'Travis, Jenkins'],
  ['chore', '🔧', 'Other changes', 'scripts, config'],
  ['i18n', '🌐', 'Internationalization', 'locale, translation'],
];

/** The built-in commit message system prompt, with or without a gitmoji in front of each type. */
export function defaultCommitPrompt(language: string, gitmoji: boolean): string {
  const lead = gitmoji ? '<emoji> ' : '';
  const table = gitmoji
    ? ['| Type | Emoji | Description | Example Scopes |', '| --- | --- | --- | --- |', ...TYPES.map((t) => `| ${t[0]} | ${t[1]} | ${t[2]} | ${t[3]} |`)]
    : ['| Type | Description | Example Scopes |', '| --- | --- | --- |', ...TYPES.map((t) => `| ${t[0]} | ${t[2]} | ${t[3]} |`)];
  const example = gitmoji
    ? '♻️ refactor(server): optimize server port configuration'
    : 'refactor(server): optimize server port configuration';
  return [
    '# Git Commit Message Guide',
    '',
    'You act as a git commit message generator. For a git diff, output ONLY the commit message itself: no explanations, no questions, no comments, no backticks.',
    '',
    '## Output Format',
    '',
    `${lead}<type>(<scope>): <subject>`,
    '  <body>',
    '',
    'For changes of several types, repeat the block once per type.',
    '',
    '## Type Reference',
    '',
    ...table,
    '',
    '## Writing Rules',
    '',
    '- Scope in English; subject in imperative mood, no capital letter, no period, at most 50 characters',
    '- Body: bullet points with "-", at most 72 characters per line, explain what and why',
    `- Write the subject and body in ${language}`,
    '',
    '## Example',
    '',
    example,
    '',
    '- rename port variable to uppercase to follow the constant naming convention',
    '- add environment variable port support for flexible deployment',
    '',
    `Remember: all output must be in ${language} and contain nothing but the commit message.`,
  ].join('\n');
}

export interface CommitPromptInput {
  diff: string;
  /** What the developer already typed in the commit box. */
  notes?: string;
  language: string;
  gitmoji: boolean;
  /** The user's own system prompt; replaces the built-in one. */
  customPrompt?: string;
}

/** The system prompt and the user prompt of a commit message request. */
export function buildCommitPrompt(i: CommitPromptInput): { system: string; user: string } {
  const custom = i.customPrompt?.trim();
  const system = custom ? `${custom} Generate commit message in ${i.language}.` : defaultCommitPrompt(i.language, i.gitmoji);
  const parts: string[] = [];
  if (i.notes?.trim()) parts.push(`Notes from developer (ignore if not relevant): ${i.notes.trim()}`);
  parts.push(truncateDiff(i.diff));
  return { system, user: parts.join('\n\n') };
}

/** Cuts a diff at a file boundary once it passes the limit and lists the files that were left out. */
export function truncateDiff(diff: string, limit = DIFF_CHAR_LIMIT): string {
  if (diff.length <= limit) return diff;
  const files = diff.split(/(?=^diff --git )/m);
  let out = '';
  const omitted: string[] = [];
  for (const f of files) {
    if (!omitted.length && out.length + f.length <= limit) {
      out += f;
      continue;
    }
    const name = /^diff --git a\/(\S+)/.exec(f)?.[1];
    if (!out && !omitted.length) {
      out = f.slice(0, limit);
      omitted.push('(rest of the first file)');
    } else omitted.push(name ?? '(unnamed)');
  }
  return `${out.trimEnd()}\n\n[Diff truncated due to size. Not shown: ${omitted.join(', ')}]`;
}

export const DEFAULT_PR_PROMPT =
  'You write pull request titles and descriptions from the commits and the diff of a branch. ' +
  'Output the title on the first line, an empty line, then the description in Markdown: a short summary, then a bullet list of the notable changes, then anything a reviewer should check. ' +
  'The title is at most 72 characters, imperative mood, no period. No preamble and no backticks around the whole answer.';

export interface PrPromptInput {
  branch: string;
  base: string;
  /** Commit subjects with bodies, oldest first. */
  commits: string[];
  diff: string;
  language: string;
  customPrompt?: string;
}

export function buildPrPrompt(i: PrPromptInput): { system: string; user: string } {
  const custom = i.customPrompt?.trim();
  const system = `${custom || DEFAULT_PR_PROMPT} Write the pull request in ${i.language}.`;
  const user = [
    `Branch ${i.branch} into ${i.base}.`,
    '',
    `Commits (${i.commits.length}):`,
    ...i.commits.map((c) => `- ${c.replace(/\n+/g, '\n  ')}`),
    '',
    'Diff:',
    truncateDiff(i.diff),
  ].join('\n');
  return { system, user };
}

/** Splits a model answer into a title and a description: the first non empty line is the title. */
export function parsePrMessage(raw: string): { title: string; body: string } {
  const text = raw
    .replace(/<think>.*?<\/think>/gs, '')
    .trim()
    .replace(/^```[^\n]*\n?|```$/g, '')
    .trim();
  const lines = text.split(/\r?\n/);
  const title = (lines.shift() ?? '').replace(/^#+\s*/, '').replace(/^title:\s*/i, '').trim();
  return { title, body: lines.join('\n').trim() };
}

/** The settings of the AI Commit extension that exist in the user settings, by name without the prefix. */
export type AiCommitSettings = Record<string, string | number | undefined>;

export interface MigrationPlan {
  provider: { id: string; baseUrl: string; apiMode: HFApiMode; reuse: boolean };
  model: Partial<HFModelItem> & { id: string };
  /** True when the model can be used for commit messages (the Gemini API mode cannot). */
  selectForCommit: boolean;
  /** The key to move into SecretStorage; never shown. */
  key?: string;
  language?: string;
  prompt?: string;
  /** Text for the notification: names only, never a key. */
  summary: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The provider id for a base URL: its host without a leading api. or www., first label. */
export function providerIdFor(baseUrl: string, fallback: string): string {
  try {
    const host = new URL(baseUrl).hostname.replace(/^(api|www)\./, '');
    if (/^[\d.:[\]]+$/.test(host)) return fallback;
    const id = host.split('.')[0].toLowerCase().replace(/[^a-z0-9-]/g, '');
    return id || fallback;
  } catch {
    return fallback;
  }
}

/** True when the settings hold anything for the migration to move. */
export function hasAiCommitSettings(s: AiCommitSettings): boolean {
  return Object.values(s).some((v) => v !== undefined && v !== '');
}

/** Maps the ai-commit.* settings to a BYOK provider, model, key, language and prompt; undefined when there is no model to create. */
export function planMigration(s: AiCommitSettings, existing: HFModelItem[]): MigrationPlan | undefined {
  const kind = str(s.AI_PROVIDER) || 'openai';
  const prefix = kind === 'claude' ? 'CLAUDE' : kind === 'gemini' ? 'GEMINI' : 'OPENAI';
  const modelId = str(s[`${prefix}_MODEL`]);
  if (!modelId) return undefined;
  const responses = kind === 'openai' && str(s.OPENAI_API_TYPE) === 'response';
  const apiMode: HFApiMode = kind === 'claude' ? 'anthropic' : kind === 'gemini' ? 'gemini' : responses ? 'openai-responses' : 'openai';
  const baseUrl =
    kind === 'openai'
      ? str(s.OPENAI_BASE_URL) || 'https://api.openai.com/v1'
      : kind === 'claude'
        ? 'https://api.anthropic.com'
        : 'https://generativelanguage.googleapis.com';
  const wanted = providerIdFor(baseUrl, kind);
  const sameUrl = existing.find((m) => m.owned_by.toLowerCase() === wanted && (m.baseUrl ?? '') === baseUrl);
  const taken = existing.some((m) => m.owned_by.toLowerCase() === wanted);
  const id = sameUrl || !taken ? wanted : `ai-commit-${wanted}`;

  const temperature = s[`${prefix}_TEMPERATURE`];
  const effort = str(s.OPENAI_REASONING_EFFORT);
  const model: MigrationPlan['model'] = {
    id: modelId,
    owned_by: id,
    baseUrl,
    apiMode,
    context_length: 128000,
    max_tokens: 4096,
    ...(typeof temperature === 'number' ? { temperature } : {}),
    ...(responses && effort ? { reasoning_effort: effort } : {}),
  };
  const language = str(s.AI_COMMIT_LANGUAGE);
  const prompt = typeof s.AI_COMMIT_SYSTEM_PROMPT === 'string' ? s.AI_COMMIT_SYSTEM_PROMPT : '';
  const key = str(s[`${prefix}_API_KEY`]);
  const selectForCommit = apiMode !== 'gemini';
  const bits = [`provider ${id}`, `model ${modelId}`];
  if (key) bits.push('API key');
  if (typeof temperature === 'number') bits.push(`temperature ${temperature}`);
  if (LANGUAGES.includes(language)) bits.push(`language ${language}`);
  if (prompt.trim()) bits.push('system prompt');
  return {
    provider: { id, baseUrl, apiMode, reuse: !!sameUrl },
    model,
    selectForCommit,
    ...(key ? { key } : {}),
    ...(LANGUAGES.includes(language) ? { language } : {}),
    ...(prompt.trim() ? { prompt } : {}),
    summary: `Migrated from AI Commit: ${bits.join(', ')}.${selectForCommit ? ' Selected for commit messages.' : ' Gemini cannot write commit messages, so it was not selected.'}`,
  };
}
