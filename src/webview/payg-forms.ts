// The forms of the PAYG models page: add and edit a provider, add models, edit a model. Each form works on a
// draft the page keeps, so a redraw after a host update never loses what was typed.
import { API_MODES, MODEL_FIELDS, validateFieldText, parseHeadersJson } from '../shared/byok-models';
import type { HFApiMode } from '../shared/byok-types';
import type { PaygFetched, PaygModel, PaygProvider, PaygToHost } from '../shared/payg';
import { el, icon } from './dom';
import { areaInput, btn, check, field, select, textInput } from './payg-ui';

export interface FormCtx {
  send(message: PaygToHost): void;
  redraw(): void;
  close(): void;
  /** Marks the model list as loading until the next state arrives. */
  startLoading(): void;
}

export interface ProviderDraft {
  id: string;
  baseUrl: string;
  apiMode: HFApiMode;
  headers: string;
  askKey: boolean;
}

export interface ModelsDraft {
  picked: Set<string>;
  manual: string;
  filter: string;
  contextLength: string;
  maxTokens: string;
  vision: boolean;
  displayName: string;
}

const URL_RE = /^https?:\/\/\S+$/;

/** A form: Enter in a text box saves it and Esc closes it, like the confirm cards of the panel. */
const formBox = (title: string, keys: { save(): void; cancel(): void }, ...children: (HTMLElement | null)[]): HTMLElement =>
  el(
    'div',
    {
      className: 'payg-form',
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          keys.cancel();
        } else if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type === 'text' && !e.target.dataset.nosubmit) {
          e.preventDefault();
          keys.save();
        }
      },
    },
    el('h3', {}, title),
    ...children
  );

function actions(error: HTMLElement, ...buttons: HTMLElement[]): HTMLElement {
  return el('div', { className: 'payg-actions' }, ...buttons, error);
}

function errorSlot(): { node: HTMLElement; show(text: string): void } {
  const node = el('span', { className: 'payg-error', role: 'alert' });
  return { node, show: (text) => (node.textContent = text) };
}

export function providerForm(ctx: FormCtx, existing: PaygProvider | undefined, d: ProviderDraft, taken: string[]): HTMLElement {
  const err = errorSlot();
  const adding = !existing;
  const id = adding ? textInput(d.id, (v) => (d.id = v), 'deepseek') : null;
  const headersHint = adding
    ? 'Optional JSON object, for example {"x-org": "acme"}'
    : `Now: ${existing!.headerNames.join(', ') || 'none'}. Leave empty to keep, enter {} to remove, or a JSON object to replace.`;
  const save = () => {
    if (adding) {
      const name = d.id.trim().toLowerCase();
      if (!name) return err.show('A provider ID is required.');
      if (name.includes('::')) return err.show('The provider ID cannot contain "::".');
      if (taken.includes(name)) return err.show('That provider already exists.');
    }
    if (!URL_RE.test(d.baseUrl.trim())) return err.show('The base URL must start with http:// or https://');
    if (d.headers.trim() && !parseHeadersJson(d.headers).ok) return err.show('Headers must be a JSON object of string values.');
    if (adding) {
      ctx.send({ type: 'paygAddProvider', id: d.id, baseUrl: d.baseUrl, apiMode: d.apiMode, headers: d.headers, askKey: d.askKey });
    } else {
      const text = d.headers.trim() === '{}' ? '' : d.headers;
      ctx.send({ type: 'paygEditProvider', id: existing!.id, baseUrl: d.baseUrl, apiMode: d.apiMode, ...(d.headers.trim() ? { headers: text } : {}) });
    }
    ctx.close();
  };
  return formBox(
    adding ? 'Add provider' : `Edit provider ${existing!.id}`,
    { save, cancel: ctx.close },
    id ? field('Provider ID', id, 'Stored in lower case, for example deepseek') : null,
    field('Base URL', textInput(d.baseUrl, (v) => (d.baseUrl = v), 'https://api.example.com'), 'The base URL of the API'),
    field('API mode', select([...API_MODES], d.apiMode, (v) => (d.apiMode = v as HFApiMode))),
    field('Headers', areaInput(d.headers, (v) => (d.headers = v), '{"x-org": "acme"}', 2), headersHint),
    adding ? check('Ask for the API key next (VS Code password box)', d.askKey, (v) => (d.askKey = v)) : null,
    actions(err.node, btn(adding ? 'Add provider' : 'Save', save, { glyph: 'check' }), btn('Cancel', ctx.close, { secondary: true }))
  );
}

export function addModelsForm(ctx: FormCtx, provider: PaygProvider, d: ModelsDraft, fetched: PaygFetched | undefined, loading: boolean): HTMLElement {
  const err = errorSlot();
  const list = fetched && fetched.provider.toLowerCase() === provider.id.toLowerCase() ? fetched : undefined;
  const choices = el('div', { className: 'payg-choices' });
  const drawChoices = () => {
    if (!list) return;
    const q = d.filter.trim().toLowerCase();
    const rows = list.models.filter((m) => !q || m.id.toLowerCase().includes(q));
    choices.replaceChildren(
      ...(rows.length
        ? rows.map((m) => {
            const box = el('input', { type: 'checkbox' });
            box.checked = d.picked.has(m.id);
            box.disabled = m.added;
            box.addEventListener('change', () => {
              if (box.checked) d.picked.add(m.id);
              else d.picked.delete(m.id);
              if (d.picked.size === 1 && m.contextLength && box.checked) d.contextLength = String(m.contextLength);
              ctx.redraw();
            });
            return el('label', { className: 'payg-choice' }, box, el('span', {}, m.id), m.added ? el('span', { className: 'payg-hint' }, 'already added') : null);
          })
        : [el('div', { className: 'payg-hint' }, 'No model matches.')])
    );
  };
  drawChoices();
  const load = el(
    'div',
    { className: 'payg-load' },
    btn(list ? 'Reload the model list' : 'Load the model list', () => {
      ctx.send({ type: 'paygFetchModels', provider: provider.id });
      ctx.startLoading();
    }, { secondary: true, glyph: 'cloud-download', disabled: loading }),
    loading ? el('span', { className: 'payg-hint' }, 'Loading the model list of the provider...') : null,
    list?.error ? el('span', { className: 'payg-error' }, `Model list unavailable: ${list.error}. Enter the model IDs below.`) : null
  );
  const save = () => {
    const ids = [...d.picked, ...d.manual.split(',').map((s) => s.trim()).filter(Boolean)];
    if (!ids.length) return err.show('Pick or enter at least one model ID.');
    const ctxLen = Number(d.contextLength);
    const max = Number(d.maxTokens);
    if (!Number.isInteger(ctxLen) || ctxLen < 1000 || ctxLen > 10_000_000) return err.show('Context length: a whole number from 1000 to 10000000.');
    if (!Number.isInteger(max) || max < 1 || max > 10_000_000) return err.show('Max output tokens: a whole number from 1 to 10000000.');
    ctx.send({ type: 'paygAddModels', provider: provider.id, ids, contextLength: d.contextLength, maxTokens: d.maxTokens, vision: d.vision, displayName: d.displayName });
    ctx.close();
  };
  // Enter in the filter box filters; it does not save the form.
  const filterBox = () => {
    const box = textInput(d.filter, (v) => { d.filter = v; drawChoices(); }, 'Type to filter');
    box.dataset.nosubmit = '1';
    return box;
  };
  return formBox(
    `Add models to ${provider.id}`,
    { save, cancel: ctx.close },
    load,
    list && !list.error ? field('Filter the list', filterBox()) : null,
    list && !list.error ? choices : null,
    field('Model IDs', textInput(d.manual, (v) => (d.manual = v), 'gpt-4o, deepseek-chat'), 'Several IDs separated with commas'),
    el('div', { className: 'payg-row' },
      field('Context length', textInput(d.contextLength, (v) => (d.contextLength = v)), 'Tokens'),
      field('Max output tokens', textInput(d.maxTokens, (v) => (d.maxTokens = v)))
    ),
    check('Supports image input (vision)', d.vision, (v) => (d.vision = v)),
    field('Display name', textInput(d.displayName, (v) => (d.displayName = v)), 'Optional, used when adding a single model'),
    actions(err.node, btn('Add models', save, { glyph: 'add' }), btn('Cancel', ctx.close, { secondary: true }))
  );
}

export function modelForm(ctx: FormCtx, model: PaygModel, d: Record<string, string>): HTMLElement {
  const err = errorSlot();
  const grid = el('div', { className: 'payg-grid' });
  for (const def of MODEL_FIELDS) {
    let control: HTMLElement;
    if (def.kind === 'enum') control = select(def.options ?? [], d[def.key] ?? '', (v) => (d[def.key] = v), '(not set)');
    else if (def.kind === 'boolean') control = select(['true', 'false'], d[def.key] ?? '', (v) => (d[def.key] = v), '(not set)');
    else if (def.kind === 'json') control = areaInput(d[def.key] ?? '', (v) => (d[def.key] = v), '(not set)', 2);
    else if (def.kind === 'headers') control = areaInput(d.headers ?? '', (v) => (d.headers = v), `Now: ${model.headerNames.join(', ') || 'none'}. Empty keeps, {} removes, a JSON object replaces.`, 2);
    else control = textInput(d[def.key] ?? '', (v) => (d[def.key] = v), '(not set)');
    grid.append(field(def.label, control));
  }
  const save = () => {
    const values: Record<string, string> = {};
    for (const def of MODEL_FIELDS) {
      const text = d[def.key] ?? '';
      if (def.kind === 'headers') {
        if (!text.trim()) continue;
        const problem = validateFieldText(def, text);
        if (problem) return err.show(`${def.label}: ${problem}`);
        values.headers = text;
        continue;
      }
      if (text.trim() === (model.values[def.key] ?? '').trim()) continue;
      const problem = validateFieldText(def, text);
      if (problem) return err.show(`${def.label}: ${problem}`);
      values[def.key] = text;
    }
    if (!Object.keys(values).length) return ctx.close();
    ctx.send({ type: 'paygSaveModel', model: { id: model.id, configId: model.configId }, values });
    ctx.close();
  };
  return formBox(
    `Edit model ${model.label}`,
    { save, cancel: ctx.close },
    el('div', { className: 'payg-hint' }, icon('info'), ' An empty field removes the value.'),
    grid,
    actions(err.node, btn('Save', save, { glyph: 'check' }), btn('Cancel', ctx.close, { secondary: true }))
  );
}
