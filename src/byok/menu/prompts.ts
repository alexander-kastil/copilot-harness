import * as vscode from 'vscode';
import type { HFApiMode, HFModelItem } from '../../shared/byok-types';
import { fetchModels } from '../provide-model';
import type { ByokStore } from './store';

export interface MenuContext {
  store: ByokStore;
}

export interface ValueItem<T> extends vscode.QuickPickItem {
  value: T;
}

export async function confirm(title: string, message: string, action: string): Promise<boolean> {
  const items: ValueItem<boolean>[] = [
    { label: `$(check) ${action}`, description: message, value: true },
    { label: '$(close) Cancel', value: false },
  ];
  const picked = await vscode.window.showQuickPick(items, { title, ignoreFocusOut: true, placeHolder: message });
  return picked?.value === true;
}

export async function askPassword(title: string, prompt: string): Promise<string | undefined> {
  return vscode.window.showInputBox({ title, prompt, password: true, ignoreFocusOut: true });
}

export function keyHint(key: string | undefined): string {
  if (!key) {
    return 'No key stored.';
  }
  return `A key is stored (ends in ${key.slice(-4)}).`;
}

export function headerNames(headers: Record<string, string> | undefined): string {
  const names = Object.keys(headers ?? {});
  return names.length ? names.join(', ') : 'none';
}

export async function checkKey(
  baseUrl: string,
  apiMode: HFApiMode,
  headers: Record<string, string> | undefined,
  key: string,
): Promise<{ ok: true; models: HFModelItem[] } | { ok: false; error: string }> {
  try {
    const { models } = await fetchModels(baseUrl, key, apiMode, headers);
    return { ok: true, models };
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    return { ok: false, error: text.split('\n')[0].replace(key, '***') };
  }
}

export function notify(message: string): void {
  void vscode.window.showInformationMessage(message);
}
