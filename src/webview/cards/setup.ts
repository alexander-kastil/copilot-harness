// Setup check card (#11): which session data sources hold data, and the buttons that switch on the
// opt-in ones. All questions are asked here in the card, never in a dialog or a notification.
import type { ToWebview } from '../../shared/messages';
import type { SetupState, SettingStatus, SourceState, SourceStatus } from '../../shared/setup';
import { post } from '../bridge';
import type { Card } from './types';

const STATE_TEXT: Record<SourceState, string> = { off: 'Off', empty: 'On but empty', data: 'Has data' };
const SOURCE_TEXT: Record<string, string> = {
  chatSessions: 'VS Code chat session files',
  debugLogs: 'Copilot Chat debug log files',
  traceDb: 'Copilot Chat trace database',
  cli: 'Copilot CLI session folders',
};

let host: HTMLElement | undefined;
let state: SetupState | undefined;
const scopeChoice = new Map<string, 'user' | 'workspace'>();
/** The plain-text setting whose warning is open and waits for its second confirmation. */
let confirming: string | undefined;
const results = new Map<string, { ok: boolean; message: string }>();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(text: string, onClick: () => void, secondary = false): HTMLButtonElement {
  const b = el('button', secondary ? 'setup-btn setup-secondary' : 'setup-btn', text);
  b.addEventListener('click', onClick);
  return b;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function settingRow(s: SettingStatus, workspaceOpen: boolean): HTMLElement {
  const row = el('div', 'setup-setting');
  row.dataset.setting = s.key;
  row.append(el('code', 'setup-key', s.key), el('div', 'setup-applies', s.appliesTo));
  const result = results.get(s.key);
  if (!s.known) {
    row.append(el('div', 'setup-unavailable', 'Not available in this version of VS Code.'));
  } else if (s.enabled) {
    row.append(el('div', 'setup-on', 'Turned on.'));
  } else if (confirming === s.key) {
    const warn = el('div', 'setup-warning');
    warn.append(
      el('strong', undefined, 'Plain text warning. '),
      document.createTextNode(
        'The trace database stores your prompts and responses in plain text on this machine. Turning off content capture is reported not to stop that. Only turn it on if you accept that.'
      )
    );
    const actions = el('div', 'setup-actions');
    actions.append(
      button('Yes, store prompts and responses in plain text', () => {
        confirming = undefined;
        post({ type: 'setupEnable', key: s.key, scope: 'user', confirmed: true });
      }),
      button('Cancel', () => {
        confirming = undefined;
        render();
      }, true)
    );
    row.append(warn, actions);
  } else {
    const actions = el('div', 'setup-actions');
    let select: HTMLSelectElement | undefined;
    if (!s.userOnly) {
      select = el('select', 'setup-scope');
      select.append(new Option('User settings', 'user'), new Option('Workspace settings', 'workspace'));
      select.disabled = !workspaceOpen;
      select.title = workspaceOpen ? 'Where the setting is written' : 'No folder is open, so only user settings are available';
      select.value = workspaceOpen ? scopeChoice.get(s.key) ?? 'user' : 'user';
      select.addEventListener('change', () => scopeChoice.set(s.key, select!.value as 'user' | 'workspace'));
      actions.append(select);
    } else actions.append(el('span', 'setup-scope-fixed', 'User settings only'));
    actions.append(
      button(s.plainText ? 'Turn on...' : 'Turn on', () => {
        results.delete(s.key);
        if (s.plainText) {
          confirming = s.key;
          render();
        } else post({ type: 'setupEnable', key: s.key, scope: select?.value === 'workspace' ? 'workspace' : 'user' });
      })
    );
    row.append(actions);
  }
  if (result) row.append(el('div', result.ok ? 'setup-result' : 'setup-result setup-error', result.message));
  return row;
}

function sourceBlock(s: SourceStatus, workspaceOpen: boolean): HTMLElement {
  const block = el('div', 'setup-source');
  block.dataset.source = s.source;
  const head = el('div', 'setup-head');
  head.append(el('span', 'setup-label', s.label), el('span', `setup-state setup-state-${s.state}`, STATE_TEXT[s.state]));
  block.append(head);
  const where = SOURCE_TEXT[s.source] ?? s.source;
  block.append(
    el('div', 'setup-figures', s.sessions > 0 ? `${s.sessions} session${s.sessions === 1 ? '' : 's'}, newest record ${s.newest ? formatTime(s.newest) : 'time unknown'} (source: ${where})` : `No sessions found (source: ${where})`)
  );
  if (s.reason) block.append(el('div', 'setup-reason', `Reader note: ${s.reason}`));
  if (s.state !== 'data') block.append(el('div', 'setup-missing', s.missing));
  for (const setting of s.settings) block.append(settingRow(setting, workspaceOpen));
  return block;
}

function render(): void {
  if (!host) return;
  const section = host.parentElement;
  host.textContent = '';
  if (!state) {
    host.append(el('p', undefined, 'Checking the session data sources...'));
    return;
  }
  const attention = state.statuses.some((s) => s.optIn && s.state !== 'data');
  // The card is a question to the user: it goes away once data flows, or when they said not to ask again.
  if (section) section.hidden = state.dismissed || !attention;
  for (const s of state.statuses) host.append(sourceBlock(s, state.workspaceOpen));
  const foot = el('div', 'setup-actions');
  foot.append(
    button('Check again', () => post({ type: 'setupRecheck' }), true),
    button("Don't ask again", () => post({ type: 'setupDismiss' }), true)
  );
  host.append(foot);
}

export const setupCard: Card = {
  id: 'setup',
  title: 'Session data sources',
  render(body) {
    host = body;
    body.classList.add('setup');
    render();
  },
  onMessage(message: ToWebview) {
    if (message.type === 'setup') {
      state = message.state;
      render();
    } else if (message.type === 'setupResult') {
      results.set(message.key, { ok: message.ok, message: message.message });
      render();
    }
  },
};
