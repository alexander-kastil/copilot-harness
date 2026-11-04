// Per-file cache keyed on size and mtime, modelled on Claude Harness's UsageIndex: a file whose
// size and mtime match its entry is not read again. A reader whose session spans several files
// keys on its main file and passes the summed size and the newest mtime. No vscode import.

export interface IndexEntry<T> {
  size: number;
  mtimeMs: number;
  value: T;
}

export type IndexData<T> = Record<string, IndexEntry<T>>;

export class ScanIndex<T> {
  private readonly entries: Map<string, IndexEntry<T>>;

  constructor(data?: IndexData<T>) {
    this.entries = new Map(Object.entries(data ?? {}));
  }

  /** The cached value when size and mtime match, otherwise undefined. */
  get(key: string, size: number, mtimeMs: number): T | undefined {
    const e = this.entries.get(key);
    return e && e.size === size && e.mtimeMs === mtimeMs ? e.value : undefined;
  }

  set(key: string, size: number, mtimeMs: number, value: T): void {
    this.entries.set(key, { size, mtimeMs, value });
  }

  /** Drops entries whose keys were not seen in the last scan. */
  retain(seen: ReadonlySet<string>): void {
    for (const key of [...this.entries.keys()]) {
      if (!seen.has(key)) this.entries.delete(key);
    }
  }

  get size(): number {
    return this.entries.size;
  }

  toJSON(): IndexData<T> {
    return Object.fromEntries(this.entries);
  }
}
