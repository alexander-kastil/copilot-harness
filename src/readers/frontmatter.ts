// Frontmatter of a markdown customization file. Returns key names and the name value only, never
// the body. A file that does not parse is reported, never thrown. No vscode import.
import * as fs from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

export interface Frontmatter {
  /** false when the block is unterminated or is not a YAML mapping. */
  ok: boolean;
  /** Whether the file starts with a frontmatter block at all. */
  present: boolean;
  keys: string[];
  name?: string;
}

const HEAD_BYTES = 64 * 1024;

export function parseFrontmatter(text: string): Frontmatter {
  const t = text.replace(/^﻿/, '');
  const lines = t.split(/\r?\n/);
  if (lines[0]?.trimEnd() !== '---') return { ok: true, present: false, keys: [] };
  const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === '---');
  if (end < 0) return { ok: false, present: true, keys: [] };
  const block = lines.slice(1, end).join('\n');
  if (!block.trim()) return { ok: true, present: true, keys: [] };
  try {
    const data: unknown = parseYaml(block);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, present: true, keys: [] };
    const rec = data as Record<string, unknown>;
    return { ok: true, present: true, keys: Object.keys(rec), name: typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : undefined };
  } catch {
    return { ok: false, present: true, keys: [] };
  }
}

/** Reads the head of a file and parses its frontmatter; undefined when the file cannot be read. */
export async function readFrontmatter(file: string): Promise<{ fm: Frontmatter; mtime: number } | undefined> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(file, 'r');
    const stat = await handle.stat();
    const buf = Buffer.alloc(Math.min(HEAD_BYTES, stat.size));
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return { fm: parseFrontmatter(buf.subarray(0, bytesRead).toString('utf8')), mtime: stat.mtimeMs };
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
