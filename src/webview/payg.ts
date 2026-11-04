// The PAYG pages: the Models page ('payg', models per provider) and the Providers page ('providers':
// providers, global settings, import and export). Registered by main.ts. Everything the Manage BYOK Models
// menu does has a control on one of them; a destructive action asks in a confirm card, and a key is typed
// in VS Code's password box, never here.
import { LANGUAGES, LOG_LEVELS, type GlobalField } from '../shared/byok-models';
import type { PaygModel, PaygProvider, PaygState, PaygToHost } from '../shared/payg';
import { post } from './bridge';
import { el, icon, plural, tag } from './dom';
import { addModelsForm, modelForm, providerForm, type FormCtx, type ModelsDraft, type ProviderDraft } from './payg-forms';
import { areaInput, btn, field, keyText, rowBtn, section, select, textInput } from './payg-ui';
import { showPage } from './pages';
import { gridTable, type Column } from './tables';

export interface PaygPage {
  root: HTMLElement;
  update(state: PaygState): void;
}

type View =
  | { k: 'none' }
  | { k: 'addProvider'; d: ProviderDraft }
  | { k: 'editProvider'; id: string; d: ProviderDraft }
  | { k: 'addModels'; provider: string; d: ModelsDraft }
  | { k: 'editModel'; id: string; configId?: string; d: Record<string, string> };

interface Confirm {
  title: string;
  message: string;
  action: string;
  run(): void;
}

const emptyState = (): PaygState => ({
  models: 0,
  providers: [],
  items: [],
  global: { genericKey: false, values: { baseUrl: '', delay: '0', readFileLines: '0', 'retry.enabled': 'true', 'retry.max_attempts': '3', 'retry.interval_ms': '1000', 'retry.status_codes': '', commitLanguage: 'English', commitMessagePrompt: '', logLevel: 'off' } },
});

const GLOBAL_LABEL: Record<GlobalField, string> = {
  baseUrl: 'Base URL',
  delay: 'Delay between requests (ms)',
  readFileLines: 'Read file lines',
  'retry.enabled': 'Retry enabled',
  'retry.max_attempts': 'Retry attempts',
  'retry.interval_ms': 'Retry interval (ms)',
  'retry.status_codes': 'Retry extra status codes',
  commitLanguage: 'Commit message language',
  commitMessagePrompt: 'Commit message prompt',
  logLevel: 'Log level',
};

const sameModel = (m: PaygModel, ref: { id: string; configId?: string }) => m.id === ref.id && (m.configId ?? '') === (ref.configId ?? '');

export function createPaygPage(kind: 'models' | 'providers'): PaygPage {
  const root = el('section', { className: 'main payg' });
  let state: PaygState = emptyState();
  let view: View = { k: 'none' };
  let confirm: Confirm | undefined;
  let dismissed = 0;
  let loading = false;
  let draft: Record<string, string> = { ...state.global.values };
  let draftDirty = false;
  let saving = false;

  const send = (m: PaygToHost) => post(m);
  const ctx: FormCtx = {
    send,
    redraw: () => draw(),
    close: () => {
      view = { k: 'none' };
      draw();
    },
    startLoading: () => {
      loading = true;
      draw();
    },
  };
  const ask = (title: string, message: string, action: string, run: () => void) => {
    confirm = { title, message, action, run };
    draw();
  };
  const open = (next: View) => {
    view = next;
    confirm = undefined;
    draw();
  };

  const providerDraft = (p?: PaygProvider): ProviderDraft => ({ id: '', baseUrl: p?.baseUrl ?? state.global.values.baseUrl, apiMode: p?.apiMode ?? 'openai', headers: '', askKey: true });
  const modelsDraft = (): ModelsDraft => ({ picked: new Set(), manual: '', filter: '', contextLength: '128000', maxTokens: '4096', vision: false, displayName: '' });

  const providerColumns = (): Column<PaygProvider>[] => [
    { head: 'Provider', track: 'minmax(90px, 1.2fr)', cls: 'at-name', cell: (p) => [icon('server-environment'), el('span', { className: 'at-label' }, p.id)], title: (p) => p.id },
    { head: 'API mode', track: '112px', muted: true, wide: true, cell: (p) => tag(p.apiMode) },
    { head: 'Base URL', track: 'minmax(120px, 2fr)', muted: true, cell: (p) => p.baseUrl || '(not set)', title: (p) => p.baseUrl },
    { head: 'Models', track: '56px', num: true, cell: (p) => String(p.modelCount) },
    { head: 'API key', track: '92px', cell: (p) => tag(keyText(p.key), p.key === 'generic' ? 'This provider uses the generic key' : undefined) },
    { head: 'Headers', track: 'minmax(60px, 0.8fr)', muted: true, wide: true, cell: (p) => p.headerNames.join(', ') || 'none', title: (p) => p.headerNames.join(', ') },
    {
      head: '',
      track: '140px',
      cls: 'payg-actcell',
      cell: (p) =>
        el(
          'span',
          { className: 'payg-acts' },
          rowBtn('key', 'Set or rotate the key', () => send({ type: 'paygSetKey', provider: p.id })),
          p.key === 'own' ? rowBtn('debug-disconnect', 'Remove the key', () => ask(`Remove key for ${p.id}`, 'The stored key is deleted.', 'Remove key', () => send({ type: 'paygRemoveKey', provider: p.id })), true) : null,
          rowBtn('edit', 'Edit provider', () => open({ k: 'editProvider', id: p.id, d: { ...providerDraft(p), id: p.id } })),
          rowBtn('trash', 'Remove provider', () => ask(`Remove provider ${p.id}`, `Deletes ${plural(p.modelCount, 'model')} and the stored key.`, 'Remove provider', () => send({ type: 'paygRemoveProvider', id: p.id })), true)
        ),
    },
  ];

  const modelColumns = (): Column<PaygModel>[] => [
    { head: 'Model', track: 'minmax(120px, 2fr)', cls: 'at-name', cell: (m) => [icon('symbol-event'), el('span', { className: 'at-label' }, m.label)], title: (m) => (m.displayName ? `${m.label} (${m.displayName})` : m.label) },
    { head: 'Context', track: '76px', num: true, wide: true, cell: (m) => String(m.contextLength) },
    { head: 'Output', track: '64px', num: true, wide: true, cell: (m) => String(m.maxOutput) },
    { head: 'Vision', track: '52px', muted: true, wide: true, cell: (m) => (m.vision ? 'yes' : 'no') },
    {
      head: '',
      track: '64px',
      cls: 'payg-actcell',
      cell: (m) =>
        el(
          'span',
          { className: 'payg-acts' },
          rowBtn('edit', 'Edit model', () => open({ k: 'editModel', id: m.id, configId: m.configId, d: { ...m.values } })),
          rowBtn('trash', 'Remove model', () => ask(`Remove model ${m.label}`, 'The model disappears from the picker.', 'Remove model', () => send({ type: 'paygRemoveModel', model: { id: m.id, configId: m.configId } })), true)
        ),
    },
  ];

  const globalSection = (): HTMLElement => {
    const row = (f: GlobalField): HTMLElement => {
      const set = (v: string) => {
        draft[f] = v;
        draftDirty = true;
      };
      const value = draft[f] ?? '';
      if (f === 'retry.enabled') return field(GLOBAL_LABEL[f], select(['true', 'false'], value, set));
      if (f === 'commitLanguage') return field(GLOBAL_LABEL[f], select(LANGUAGES, value, set));
      if (f === 'logLevel') return field(GLOBAL_LABEL[f], select(LOG_LEVELS, value, set));
      if (f === 'commitMessagePrompt') return field(GLOBAL_LABEL[f], areaInput(value, set, '', 3), 'System prompt for commit messages. Empty uses the default.');
      if (f === 'retry.status_codes') return field(GLOBAL_LABEL[f], textInput(value, set, '408, 409'), 'Comma separated three digit codes');
      return field(GLOBAL_LABEL[f], textInput(value, set));
    };
    const fields: GlobalField[] = ['baseUrl', 'delay', 'readFileLines', 'retry.enabled', 'retry.max_attempts', 'retry.interval_ms', 'retry.status_codes', 'commitLanguage', 'logLevel', 'commitMessagePrompt'];
    const changed = () => Object.fromEntries(fields.filter((f) => (draft[f] ?? '') !== (state.global.values[f] ?? '')).map((f) => [f, draft[f] ?? '']));
    return section(
      'Global settings',
      el(
        'div',
        { className: 'payg-keyrow' },
        icon('key'),
        el('span', {}, 'Generic API key'),
        tag(state.global.genericKey ? 'key set' : 'no key'),
        el('span', { className: 'payg-hint' }, 'Used by every provider without its own key'),
        el(
          'span',
          { className: 'payg-acts' },
          rowBtn('key', 'Set or rotate the generic key', () => send({ type: 'paygSetGenericKey' })),
          state.global.genericKey ? rowBtn('debug-disconnect', 'Remove the generic key', () => ask('Remove generic key', 'The stored key is deleted.', 'Remove key', () => send({ type: 'paygRemoveGenericKey' })), true) : null
        )
      ),
      el('div', { className: 'payg-grid' }, ...fields.map(row)),
      el(
        'div',
        { className: 'payg-actions' },
        btn(
          'Save settings',
          () => {
            const values = changed();
            if (!Object.keys(values).length) return;
            draftDirty = false;
            saving = true;
            send({ type: 'paygSaveGlobal', values });
          },
          { glyph: 'save' }
        ),
        btn('Reset', () => {
          draft = { ...state.global.values };
          draftDirty = false;
          draw();
        }, { secondary: true })
      )
    );
  };

  const confirmCard = (c: Confirm): HTMLElement =>
    el(
      'div',
      { className: 'payg-confirm', role: 'alertdialog', 'aria-label': c.title },
      el('div', { className: 'payg-confirm-text' }, el('strong', {}, c.title), el('span', {}, c.message)),
      el('div', { className: 'payg-actions' }, btn(c.action, () => {
        confirm = undefined;
        c.run();
        draw();
      }, { danger: true }), btn('Cancel', () => {
        confirm = undefined;
        draw();
      }, { secondary: true }))
    );

  const activeForm = (): HTMLElement | null => {
    const onModels = view.k === 'addModels' || view.k === 'editModel';
    if (view.k !== 'none' && onModels !== (kind === 'models')) return null;
    if (view.k === 'addProvider') return providerForm(ctx, undefined, view.d, state.providers.map((p) => p.id.toLowerCase()));
    if (view.k === 'editProvider') {
      const id = view.id;
      const p = state.providers.find((x) => x.id === id);
      return p ? providerForm(ctx, p, view.d, []) : null;
    }
    if (view.k === 'addModels') {
      const id = view.provider;
      const p = state.providers.find((x) => x.id === id);
      return p ? addModelsForm(ctx, p, view.d, state.fetched, loading) : null;
    }
    if (view.k === 'editModel') {
      const ref = { id: view.id, configId: view.configId };
      const m = state.items.find((x) => sameModel(x, ref));
      return m ? modelForm(ctx, m, view.d) : null;
    }
    return null;
  };

  const draw = () => {
    const form = activeForm();
    if (!form && view.k !== 'none') view = { k: 'none' };
    const n = state.notice && state.notice.id > dismissed ? state.notice : undefined;
    const head = el(
      'header',
      { className: 'main-head' },
      btn('Overview', () => showPage('overview'), { secondary: true, glyph: 'arrow-left', title: 'Back to the overview' }),
      el('span', { className: 'big' }, icon('credit-card')),
      el('div', { className: 'title' }, el('h1', {}, kind === 'models' ? 'PAYG models' : 'Providers'), el('div', { className: 'path meta' }, `${plural(state.models, 'model')} · ${plural(state.providers.length, 'provider')} · bring your own key`)),
      kind === 'models'
        ? btn('Providers', () => showPage('providers'), { secondary: true, glyph: 'server-environment', title: 'Open the providers page' })
        : btn('PAYG models', () => showPage('payg'), { secondary: true, glyph: 'credit-card', title: 'Open the PAYG models page' })
    );
    const providers = section(
      'Providers',
      el('div', { className: 'payg-actions' }, btn('Add provider', () => open({ k: 'addProvider', d: providerDraft() }), { glyph: 'add' })),
      state.providers.length ? gridTable(providerColumns(), state.providers, 'Providers') : el('div', { className: 'empty flush' }, 'No providers yet. Add a provider first, then its models.')
    );
    const known = new Set(state.providers.map((p) => p.id));
    const groups: [string, PaygModel[]][] = [
      ...state.providers.map((p): [string, PaygModel[]] => [p.id, state.items.filter((m) => m.provider === p.id)]),
      ...[...new Set(state.items.map((m) => m.provider).filter((id) => !known.has(id)))].map((id): [string, PaygModel[]] => [id, state.items.filter((m) => m.provider === id)]),
    ];
    const models = groups.length
      ? el(
          'div',
          { className: 'payg-groups' },
          ...groups.map(([id, items]) =>
            section(
              `${id} · ${plural(items.length, 'model')}`,
              known.has(id) ? el('div', { className: 'payg-actions' }, btn('Add models', () => open({ k: 'addModels', provider: id, d: modelsDraft() }), { glyph: 'add' })) : null,
              items.length ? gridTable(modelColumns(), items, `Models of ${id}`) : el('div', { className: 'empty flush' }, 'No models yet.')
            )
          )
        )
      : section('Models', el('div', { className: 'empty flush' }, 'No providers yet. Add a provider on the Providers page, then its models here.'));
    const transfer = section(
      'Import and export',
      el(
        'div',
        { className: 'payg-actions' },
        btn('Import from OAI Compatible', () => send({ type: 'paygImportOai' }), { secondary: true, glyph: 'cloud-download', title: 'Reads oaicopilot.models and oaicopilot.baseUrl' }),
        btn('Import from file', () => send({ type: 'paygImportFile' }), { secondary: true, glyph: 'folder-opened', title: 'A file written by Export to file' }),
        btn('Export to file', () => ask('Export to file', 'The file contains your API keys in plain text.', 'Choose file', () => send({ type: 'paygExport' })), { secondary: true, glyph: 'save' }),
        btn('Reload window', () => ask('Reload window', 'Use this if the model picker does not show your changes.', 'Reload window', () => send({ type: 'paygReloadWindow' })), { secondary: true, glyph: 'refresh' })
      )
    );
    root.replaceChildren(
      head,
      el(
        'div',
        { className: 'main-body' },
        n ? el('div', { className: `payg-notice ${n.level}`, role: n.level === 'error' ? 'alert' : 'status' }, icon(n.level === 'error' ? 'error' : 'info'), el('span', {}, n.text), rowBtn('close', 'Dismiss', () => { dismissed = n.id; draw(); })) : null,
        state.pending && kind === 'providers'
          ? el('div', { className: 'payg-confirm', role: 'alertdialog' }, el('div', { className: 'payg-confirm-text' }, el('strong', {}, state.pending.kind === 'importFile' ? 'Import from file' : 'Import from OAI Compatible'), el('span', {}, state.pending.message)), el('div', { className: 'payg-actions' }, btn(state.pending.kind === 'importFile' ? 'Replace' : 'Import', () => send({ type: 'paygImportApply' }), { danger: state.pending.kind === 'importFile' }), btn('Cancel', () => send({ type: 'paygImportCancel' }), { secondary: true })))
          : null,
        confirm ? confirmCard(confirm) : null,
        form,
        ...(kind === 'models' ? [models] : [providers, globalSection(), transfer])
      )
    );
  };

  draw();
  return {
    root,
    update(next) {
      state = next;
      loading = false;
      // A rejected save keeps what was typed; any other update refreshes the form unless the person is still typing.
      if (saving && next.notice?.level === 'error') draftDirty = true;
      saving = false;
      if (!draftDirty) draft = { ...next.global.values };
      draw();
    },
  };
}
