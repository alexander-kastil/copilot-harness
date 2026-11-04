import * as vscode from 'vscode';
import { GENERIC_KEY_SECRET, normalizeUserModels, providerSecretName } from '../../shared/byok-models';
import type { HFModelItem } from '../../shared/byok-types';

const MODELS = 'copilotHarness.byok.models';
const BASE_URL = 'copilotHarness.byok.baseUrl';

export class ByokStore {
  constructor(
    readonly secrets: vscode.SecretStorage,
    private readonly changed: () => void,
  ) {}

  models(): HFModelItem[] {
    return normalizeUserModels(vscode.workspace.getConfiguration().get<unknown>(MODELS, []));
  }

  async setModels(models: HFModelItem[]): Promise<void> {
    await vscode.workspace.getConfiguration().update(MODELS, models, vscode.ConfigurationTarget.Global);
    this.changed();
  }

  globalBaseUrl(): string {
    return vscode.workspace.getConfiguration().get<string>(BASE_URL, '');
  }

  async setSetting(name: string, value: unknown): Promise<void> {
    await vscode.workspace.getConfiguration().update(`copilotHarness.byok.${name}`, value, vscode.ConfigurationTarget.Global);
    this.changed();
  }

  setting<T>(name: string, fallback: T): T {
    return vscode.workspace.getConfiguration().get<T>(`copilotHarness.byok.${name}`, fallback);
  }

  async providerKey(provider: string): Promise<string | undefined> {
    return this.secrets.get(providerSecretName(provider));
  }

  async genericKey(): Promise<string | undefined> {
    return this.secrets.get(GENERIC_KEY_SECRET);
  }

  async keyFor(provider: string): Promise<string | undefined> {
    return (await this.providerKey(provider)) ?? (await this.genericKey());
  }

  async setProviderKey(provider: string, key: string): Promise<void> {
    await this.secrets.store(providerSecretName(provider), key.trim());
    this.changed();
  }

  async deleteProviderKey(provider: string): Promise<void> {
    await this.secrets.delete(providerSecretName(provider));
    this.changed();
  }

  async setGenericKey(key: string): Promise<void> {
    await this.secrets.store(GENERIC_KEY_SECRET, key.trim());
    this.changed();
  }

  async deleteGenericKey(): Promise<void> {
    await this.secrets.delete(GENERIC_KEY_SECRET);
    this.changed();
  }
}
