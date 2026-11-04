// One-time migration of the AI Commit (Sitoi.ai-commit) settings into a BYOK provider and model. The
// ai-commit.* settings are only read, never changed. The API key goes to SecretStorage and is never
// logged, shown or written to a settings file.
import * as vscode from 'vscode';
import { hasAiCommitSettings, planMigration, type AiCommitSettings } from '../../shared/ai-commit';
import { isProviderRow } from '../../shared/byok-models';
import type { HFModelItem } from '../../shared/byok-types';
import { ByokStore } from '../menu/store';
import { logger } from '../logger';

const DONE = 'copilotHarness.aiCommitMigrated';
const KEYS = [
  'AI_PROVIDER',
  'OPENAI_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'OPENAI_TEMPERATURE',
  'OPENAI_API_TYPE',
  'OPENAI_REASONING_EFFORT',
  'CLAUDE_API_KEY',
  'CLAUDE_MODEL',
  'CLAUDE_TEMPERATURE',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'GEMINI_TEMPERATURE',
  'AI_COMMIT_LANGUAGE',
  'AI_COMMIT_SYSTEM_PROMPT',
];

function readSettings(): AiCommitSettings {
  const config = vscode.workspace.getConfiguration();
  const out: AiCommitSettings = {};
  for (const k of KEYS) {
    const v = config.inspect<string | number>(`ai-commit.${k}`)?.globalValue;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export async function migrateAiCommit(context: vscode.ExtensionContext): Promise<void> {
  try {
    if (context.globalState.get<boolean>(DONE)) return;
    const settings = readSettings();
    if (!hasAiCommitSettings(settings)) return;
    const store = new ByokStore(context.secrets, () => undefined);
    const plan = planMigration(settings, store.models());
    await context.globalState.update(DONE, true);
    if (!plan) return;

    let models = store.models();
    const present = models.some((m) => m.owned_by.toLowerCase() === plan.provider.id && m.id === plan.model.id && !m.configId);
    if (!present) {
      // The provider's placeholder row goes away once it has a model, like when a model is added on the page.
      const row = (m: HFModelItem) => isProviderRow(m) && m.owned_by.toLowerCase() === plan.provider.id;
      models = [...models.filter((m) => !row(m)), plan.model as HFModelItem];
    }
    if (plan.selectForCommit) {
      models = models.map((m) => {
        const isNew = m.owned_by.toLowerCase() === plan.provider.id && m.id === plan.model.id && !m.configId;
        if (isNew) return { ...m, useForCommitGeneration: true };
        const { useForCommitGeneration: _drop, ...rest } = m;
        return m.useForCommitGeneration ? rest : m;
      });
    }
    await store.setModels(models);

    if (plan.key && !(await store.providerKey(plan.provider.id))) await store.setProviderKey(plan.provider.id, plan.key);

    const config = vscode.workspace.getConfiguration();
    const unset = (name: string) => config.inspect(`copilotHarness.byok.${name}`)?.globalValue === undefined;
    if (plan.language && unset('commitLanguage')) await store.setSetting('commitLanguage', plan.language);
    if (plan.prompt && unset('commitMessagePrompt')) await store.setSetting('commitMessagePrompt', plan.prompt);

    logger.info('aiCommit.migrated', { provider: plan.provider.id, model: plan.model.id });
    vscode.window.showInformationMessage(plan.summary);
  } catch (error) {
    logger.error('aiCommit.migrateError', { error: error instanceof Error ? error.message : String(error) });
  }
}
