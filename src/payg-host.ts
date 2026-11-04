// Host side of the PAYG models page: builds PaygState from the copilotHarness.byok settings and the
// key secrets, posts it on `ready` and whenever either changes, and runs the page's messages through
// the same writes the Manage BYOK Models menu uses. A key is typed in VS Code's password box, so it never
// passes through the webview, and no key value is ever posted.
import * as vscode from 'vscode';
import { ByokStore } from './byok/menu/store';
import { applyImport, applyOaiImport, buildExport, createModels, createProvider, currentRetry, deleteModel, deleteProvider, readImportFile, readOaiSettings, updateModel, updateProvider, writeExportFile, writeGlobal } from './byok/menu/ops';
import { checkKey, askPassword } from './byok/menu/prompts';
import { askKeysOnce } from './byok/menu/transfer';
import { GENERIC_KEY_SECRET, GLOBAL_FIELDS, listProviders, MODEL_FIELDS, parseConfigFile, parseFieldText, parseGlobalText, parseHeadersJson, planOaiImport, sameModel, type GlobalField } from './shared/byok-models';
import type { HFModelItem } from './shared/byok-types';
import { buildPaygState, type PaygFetched, type PaygNotice, type PaygState, type PaygToHost } from './shared/payg';
import { HarnessPanel } from './panel';

const SECRET_PREFIX = 'copilotHarness.byok.apiKey';
const URL_RE = /^https?:\/\/\S+$/;

interface Pending {
  kind: 'importFile' | 'importOai';
  message: string;
  apply: () => Promise<string>;
}

const wholeIn = (text: string, min: number, max: number): number | undefined => {
  const n = Number(text.trim());
  return text.trim() && Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};

export function registerPayg(context: vscode.ExtensionContext): void {
  // The picker refresh after a write is driven by the settings and secrets events in registerByok.
  const store = new ByokStore(context.secrets, () => undefined);
  let fetched: PaygFetched | undefined;
  let pending: Pending | undefined;
  let notice: PaygNotice | undefined;
  let noticeId = 0;

  const say = (level: PaygNotice['level'], text: string) => {
    notice = { id: ++noticeId, level, text };
  };

  const state = async (): Promise<PaygState> => {
    const models = store.models();
    const providerKeys: string[] = [];
    for (const p of listProviders(models, '')) if (await store.providerKey(p.id)) providerKeys.push(p.id);
    const base = buildPaygState({
      models,
      baseUrl: store.globalBaseUrl(),
      settings: {
        delay: store.setting('delay', 0),
        readFileLines: store.setting('readFileLines', 0),
        retry: currentRetry(store),
        commitLanguage: store.setting('commitLanguage', 'English'),
        commitMessagePrompt: store.setting('commitMessagePrompt', ''),
        logLevel: store.setting('logLevel', 'off'),
      },
      providerKeys,
      genericKey: !!(await store.genericKey()),
    });
    return { ...base, fetched, pending: pending && { kind: pending.kind, message: pending.message }, notice };
  };

  const post = async (): Promise<void> => {
    HarnessPanel.post({ type: 'payg', state: await state() });
  };

  const provider = (id: string) => listProviders(store.models(), store.globalBaseUrl()).find((p) => p.id.toLowerCase() === id.toLowerCase());

  const handle = async (m: PaygToHost): Promise<void> => {
    switch (m.type) {
      case 'paygAddProvider': {
        const id = m.id.trim().toLowerCase();
        if (!id) return say('error', 'A provider ID is required.');
        if (id.includes('::')) return say('error', 'The provider ID cannot contain "::".');
        if (provider(id)) return say('error', `Provider ${id} already exists.`);
        if (!URL_RE.test(m.baseUrl.trim())) return say('error', 'The base URL must start with http:// or https://');
        const headers = parseHeadersJson(m.headers);
        if (!headers.ok) return say('error', 'Headers must be a JSON object of string values.');
        await createProvider(store, { id, baseUrl: m.baseUrl.trim(), apiMode: m.apiMode, headers: headers.value });
        say('info', `Provider ${id} added.`);
        if (m.askKey) {
          const key = (await askPassword(`API key for ${id}`, 'Checked against the provider model list. Leave empty to skip.'))?.trim();
          if (key) {
            await store.setProviderKey(id, key);
            const check = await checkKey(m.baseUrl.trim(), m.apiMode, headers.value, key);
            say(check.ok ? 'info' : 'error', check.ok ? `Provider ${id} added, key saved and accepted.` : `Provider ${id} added and key saved, but the key check failed: ${check.error}`);
          }
        }
        return;
      }
      case 'paygEditProvider': {
        const p = provider(m.id);
        if (!p) return say('error', `Provider ${m.id} no longer exists.`);
        if (!URL_RE.test(m.baseUrl.trim())) return say('error', 'The base URL must start with http:// or https://');
        const patch: Partial<HFModelItem> = { baseUrl: m.baseUrl.trim(), apiMode: m.apiMode };
        if (m.headers !== undefined) {
          const headers = parseHeadersJson(m.headers);
          if (!headers.ok) return say('error', 'Headers must be a JSON object of string values.');
          patch.headers = headers.value;
        }
        await updateProvider(store, p.id, patch);
        return say('info', `Provider ${p.id} saved.`);
      }
      case 'paygRemoveProvider': {
        const p = provider(m.id);
        if (!p) return;
        await deleteProvider(store, p.id);
        return say('info', `Provider ${p.id} removed.`);
      }
      case 'paygSetKey': {
        const p = provider(m.provider);
        if (!p) return;
        const key = (await askPassword(`API key for ${p.id}`, 'Enter the new key.'))?.trim();
        if (!key) return;
        await store.setProviderKey(p.id, key);
        return say('info', `Key for ${p.id} saved.`);
      }
      case 'paygRemoveKey': {
        const p = provider(m.provider);
        if (!p) return;
        await store.deleteProviderKey(p.id);
        return say('info', `Key for ${p.id} removed.`);
      }
      case 'paygFetchModels': {
        const p = provider(m.provider);
        if (!p) return;
        const key = (await store.keyFor(p.id)) ?? '';
        const owned = store.models().find((x) => x.owned_by.toLowerCase() === p.id.toLowerCase());
        const result = await checkKey(p.baseUrl, p.apiMode, owned?.headers ?? p.headers, key);
        const existing = store.models();
        fetched = result.ok
          ? { provider: p.id, models: result.models.map((x) => ({ id: x.id, contextLength: x.context_length, added: existing.some((e) => sameModel(e, { id: x.id })) })) }
          : { provider: p.id, models: [], error: result.error };
        return;
      }
      case 'paygAddModels': {
        const p = provider(m.provider);
        if (!p) return say('error', `Provider ${m.provider} no longer exists.`);
        const ids = [...new Set(m.ids.map((s) => s.trim()).filter(Boolean))];
        if (!ids.length) return say('error', 'Pick or enter at least one model ID.');
        const contextLength = wholeIn(m.contextLength, 1000, 10_000_000);
        const maxTokens = wholeIn(m.maxTokens, 1, 10_000_000);
        if (contextLength === undefined) return say('error', 'Context length: enter a whole number from 1000 to 10000000.');
        if (maxTokens === undefined) return say('error', 'Max output tokens: enter a whole number from 1 to 10000000.');
        const { added, skipped } = await createModels(store, p, ids, { contextLength, maxTokens, vision: m.vision, displayName: m.displayName });
        fetched = undefined;
        return say('info', `${added.length} model(s) added to ${p.id}.${skipped.length ? ` Already present: ${skipped.join(', ')}.` : ''}`);
      }
      case 'paygSaveModel': {
        let current = store.models().find((x) => sameModel(x, m.model));
        if (!current) return say('error', 'The model no longer exists.');
        for (const [key, text] of Object.entries(m.values)) {
          const def = MODEL_FIELDS.find((d) => d.key === key);
          if (!def) continue;
          const parsed = parseFieldText(def, text);
          if (!parsed.ok) return say('error', `${def.label}: ${parsed.error}`);
          const result = await updateModel(store, current, def.key, parsed);
          if (!result.ok) return say('error', result.error);
          current = result.model;
        }
        return say('info', `Model ${current.configId ? `${current.id}::${current.configId}` : current.id} saved.`);
      }
      case 'paygRemoveModel': {
        await deleteModel(store, m.model);
        return say('info', `Model ${m.model.configId ? `${m.model.id}::${m.model.configId}` : m.model.id} removed.`);
      }
      case 'paygSaveGlobal': {
        const writes: [GlobalField, unknown][] = [];
        for (const [field, text] of Object.entries(m.values)) {
          if (!(GLOBAL_FIELDS as readonly string[]).includes(field)) continue;
          const parsed = parseGlobalText(field as GlobalField, text);
          if (!parsed.ok) return say('error', `${field}: ${parsed.error}`);
          writes.push([field as GlobalField, parsed.value]);
        }
        for (const [field, value] of writes) await writeGlobal(store, field, value);
        return say('info', 'Global settings saved.');
      }
      case 'paygSetGenericKey': {
        const key = (await askPassword('Generic API key', 'Used by every provider without its own key. Enter the new key.'))?.trim();
        if (!key) return;
        await store.setGenericKey(key);
        return say('info', 'Generic key saved.');
      }
      case 'paygRemoveGenericKey':
        await store.deleteGenericKey();
        return say('info', 'Generic key removed.');
      case 'paygImportOai': {
        const { models, baseUrl } = readOaiSettings();
        if (!Array.isArray(models) || models.length === 0) return say('error', 'No oaicopilot.models found in your settings.');
        const plan = planOaiImport(models, baseUrl, store.models());
        if (plan.toAdd.length === 0) return say('info', `Nothing to import. ${plan.duplicates.length} already exist.`);
        const note = plan.duplicates.length ? `, ${plan.duplicates.length} already present are skipped` : '';
        pending = {
          kind: 'importOai',
          message: `Imports ${plan.toAdd.length} model(s) from ${plan.providers.length} provider(s)${note}. Then VS Code asks for each provider's key.`,
          apply: async () => {
            await applyOaiImport(store, plan.toAdd);
            await askKeysOnce({ store }, plan.providers);
            return `${plan.toAdd.length} model(s) imported.`;
          },
        };
        return;
      }
      case 'paygImportFile': {
        const text = await readImportFile();
        if (text === undefined) return;
        const parsed = parseConfigFile(text);
        if (!parsed.ok) return say('error', parsed.error);
        const data = parsed.value;
        pending = {
          kind: 'importFile',
          message: `Replaces the BYOK models (${data.models.length}) and settings with the file's content.`,
          apply: async () => {
            await applyImport(store, data);
            return 'Configuration imported.';
          },
        };
        return;
      }
      case 'paygImportApply': {
        const run = pending;
        pending = undefined;
        if (run) say('info', await run.apply());
        return;
      }
      case 'paygImportCancel':
        pending = undefined;
        return;
      case 'paygExport': {
        const uri = await writeExportFile(await buildExport(store));
        if (uri) say('info', `Configuration exported to ${uri.fsPath}`);
        return;
      }
      case 'paygReloadWindow':
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
        return;
    }
  };

  context.subscriptions.push(
    HarnessPanel.onMessage((m) => {
      if (m.type === 'ready') {
        void post();
        return;
      }
      if (!m.type.startsWith('payg')) return;
      const message = m as PaygToHost;
      void (async () => {
        notice = undefined;
        try {
          await handle(message);
        } catch (err) {
          say('error', err instanceof Error ? err.message : String(err));
        }
        await post();
      })();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('copilotHarness.byok')) void post();
    }),
    context.secrets.onDidChange((e) => {
      if (e.key === GENERIC_KEY_SECRET || e.key.startsWith(SECRET_PREFIX)) void post();
    })
  );
}
