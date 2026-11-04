import * as vscode from 'vscode';
import { LANGUAGES, LOG_LEVELS, type GlobalField } from '../../shared/byok-models';
import type { RetryConfig } from '../../shared/byok-types';
import { currentRetry, writeGlobal } from './ops';
import { askPassword, confirm, keyHint, notify, type MenuContext, type ValueItem } from './prompts';

async function askNumber(title: string, current: number, min: number, max?: number): Promise<number | undefined> {
  const text = await vscode.window.showInputBox({
    title,
    value: String(current),
    ignoreFocusOut: true,
    validateInput: (v) => {
      const n = Number(v.trim());
      if (!v.trim() || !Number.isInteger(n) || n < min || (max !== undefined && n > max)) {
        return `Enter a whole number from ${min}${max !== undefined ? ` to ${max}` : ''}.`;
      }
      return undefined;
    },
  });
  return text === undefined ? undefined : Number(text.trim());
}

async function askChoice(title: string, options: string[], current: string): Promise<string | undefined> {
  const items = options.map((o) => ({ label: o, description: o === current ? 'current' : undefined }));
  const picked = await vscode.window.showQuickPick(items, { title, ignoreFocusOut: true });
  return picked?.label;
}

export async function editGlobalSettings(ctx: MenuContext): Promise<void> {
  const store = ctx.store;
  for (;;) {
    const retry = currentRetry(store);
    const genericKey = await store.genericKey();
    const items: ValueItem<string>[] = [
      { label: '$(check) Done', value: 'done' },
      { label: 'Base URL', description: store.globalBaseUrl() || '(not set)', value: 'baseUrl' },
      { label: 'Generic API key', description: keyHint(genericKey), value: 'key' },
      { label: 'Delay between requests (ms)', description: String(store.setting('delay', 0)), value: 'delay' },
      { label: 'Read file lines', description: String(store.setting('readFileLines', 0)), value: 'readFileLines' },
      { label: 'Retry enabled', description: String(retry.enabled), value: 'retry.enabled' },
      { label: 'Retry attempts', description: String(retry.max_attempts), value: 'retry.max_attempts' },
      { label: 'Retry interval (ms)', description: String(retry.interval_ms), value: 'retry.interval_ms' },
      {
        label: 'Retry extra status codes',
        description: (retry.status_codes ?? []).join(', ') || 'none',
        value: 'retry.status_codes',
      },
      { label: 'Commit message language', description: store.setting('commitLanguage', 'English'), value: 'commitLanguage' },
      {
        label: 'Commit message prompt',
        description: store.setting('commitMessagePrompt', '') ? 'custom' : 'default',
        value: 'commitMessagePrompt',
      },
      { label: 'Log level', description: store.setting('logLevel', 'off'), value: 'logLevel' },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: 'Global settings',
      ignoreFocusOut: true,
      matchOnDescription: true,
    });
    if (!picked || picked.value === 'done') return;
    await editOne(ctx, picked.value, retry, genericKey);
  }
}

async function editOne(ctx: MenuContext, field: string, retry: RetryConfig, genericKey: string | undefined): Promise<void> {
  const store = ctx.store;
  const save = (name: GlobalField, value: unknown) => writeGlobal(store, name, value);
  switch (field) {
    case 'baseUrl': {
      const v = await vscode.window.showInputBox({
        title: 'Base URL',
        value: store.globalBaseUrl(),
        ignoreFocusOut: true,
        validateInput: (t) => (/^https?:\/\/\S+$/.test(t.trim()) ? undefined : 'Start with http:// or https://'),
      });
      if (v !== undefined) await save('baseUrl', v.trim());
      return;
    }
    case 'key': {
      const items: ValueItem<string>[] = [
        { label: '$(key) Set or rotate the generic key', value: 'set' },
        { label: '$(trash) Remove the generic key', value: 'remove' },
      ];
      const action = await vscode.window.showQuickPick(items, { title: 'Generic API key', placeHolder: keyHint(genericKey) });
      if (action?.value === 'set') {
        const key = await askPassword('Generic API key', `${keyHint(genericKey)} Enter the new key.`);
        if (key?.trim()) {
          await store.setGenericKey(key);
          notify('Generic key saved.');
        }
      } else if (action?.value === 'remove' && genericKey) {
        if (await confirm('Remove generic key', 'The stored key is deleted.', 'Remove key')) {
          await store.deleteGenericKey();
        }
      }
      return;
    }
    case 'delay':
    case 'readFileLines': {
      const n = await askNumber(field === 'delay' ? 'Delay in ms' : 'Read file lines', store.setting(field, 0), 0, field === 'delay' ? undefined : 10000);
      if (n !== undefined) await save(field, n);
      return;
    }
    case 'retry.enabled': {
      const v = await askChoice('Retry enabled', ['true', 'false'], String(retry.enabled));
      if (v) await save('retry.enabled', v === 'true');
      return;
    }
    case 'retry.max_attempts':
    case 'retry.interval_ms': {
      const key = field === 'retry.max_attempts' ? 'max_attempts' : 'interval_ms';
      const n = await askNumber(field, (retry[key] as number) ?? 1, 1);
      if (n !== undefined) await save(field, n);
      return;
    }
    case 'retry.status_codes': {
      const v = await vscode.window.showInputBox({
        title: 'Extra retry status codes',
        prompt: 'Comma separated, for example 408, 409',
        value: (retry.status_codes ?? []).join(', '),
        ignoreFocusOut: true,
        validateInput: (t) =>
          t
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .every((s) => /^\d{3}$/.test(s))
            ? undefined
            : 'Enter three digit codes separated by commas.',
      });
      if (v !== undefined) {
        const codes = v
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => n > 0);
        await save('retry.status_codes', codes);
      }
      return;
    }
    case 'commitLanguage': {
      const v = await askChoice('Commit message language', LANGUAGES, store.setting('commitLanguage', 'English'));
      if (v) await save('commitLanguage', v);
      return;
    }
    case 'commitMessagePrompt': {
      const v = await vscode.window.showInputBox({
        title: 'Commit message prompt',
        prompt: 'System prompt for commit messages. Empty uses the default.',
        value: store.setting('commitMessagePrompt', ''),
        ignoreFocusOut: true,
      });
      if (v !== undefined) await save('commitMessagePrompt', v);
      return;
    }
    case 'logLevel': {
      const v = await askChoice('Log level', LOG_LEVELS, store.setting('logLevel', 'off'));
      if (v) await save('logLevel', v);
      return;
    }
  }
}
