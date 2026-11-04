// Small controls of the PAYG models page. No state of their own.
import { el, icon } from './dom';

export interface BtnOpts {
  secondary?: boolean;
  danger?: boolean;
  glyph?: string;
  title?: string;
  disabled?: boolean;
}

export function btn(label: string, onclick: () => void, o: BtnOpts = {}): HTMLElement {
  const cls = `payg-btn${o.secondary ? ' secondary' : ''}${o.danger ? ' danger' : ''}`;
  return el('button', { className: cls, type: 'button', title: o.title ?? label, disabled: o.disabled, onclick }, o.glyph ? icon(o.glyph) : null, label ? el('span', {}, label) : null);
}

/** An icon-only or text action in a list row. */
export function rowBtn(glyph: string, title: string, onclick: () => void, danger = false): HTMLElement {
  return el('button', { className: `payg-icon${danger ? ' danger' : ''}`, type: 'button', title, 'aria-label': title, onclick }, icon(glyph));
}

export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return el('label', { className: 'payg-field' }, el('span', { className: 'payg-label' }, label), control, hint ? el('span', { className: 'payg-hint' }, hint) : null);
}

export function textInput(value: string, onInput: (v: string) => void, placeholder = ''): HTMLInputElement {
  const input = el('input', { type: 'text', className: 'payg-input', placeholder, spellcheck: 'false' });
  input.value = value;
  input.addEventListener('input', () => onInput(input.value));
  return input;
}

export function areaInput(value: string, onInput: (v: string) => void, placeholder = '', rows = 3): HTMLTextAreaElement {
  const area = el('textarea', { className: 'payg-input', placeholder, rows, spellcheck: 'false' });
  area.value = value;
  area.addEventListener('input', () => onInput(area.value));
  return area;
}

/** A drop-down; `blank` adds a first option with an empty value. */
export function select(options: string[], value: string, onChange: (v: string) => void, blank?: string): HTMLSelectElement {
  const s = el('select', { className: 'payg-input' });
  if (blank !== undefined) s.append(el('option', { value: '' }, blank));
  for (const o of options) s.append(el('option', { value: o }, o));
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

export function check(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const box = el('input', { type: 'checkbox' });
  box.checked = value;
  box.addEventListener('change', () => onChange(box.checked));
  return el('label', { className: 'payg-check' }, box, el('span', {}, label));
}

export function section(title: string, ...children: (HTMLElement | null)[]): HTMLElement {
  return el('section', { className: 'payg-section' }, el('h2', {}, title), ...children);
}

export const keyText = (source: 'own' | 'generic' | 'none'): string => (source === 'own' ? 'key set' : source === 'generic' ? 'generic key' : 'no key');
