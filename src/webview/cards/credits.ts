// Credits card (#13): what the local records explain of the quota used, with the source next to every figure.
import type { ToWebview } from '../../shared/messages';
import type { CreditsState } from '../../shared/credits';
import { post } from '../bridge';
import type { Card } from './types';

const SOURCE_TEXT: Record<string, string> = {
  chatSessions: 'chat session files',
  debugLogs: 'debug logs',
  traceDb: 'trace database',
  cli: 'Copilot CLI',
};
const CAUSE_TEXT: Record<string, string> = {
  'logging-off': 'no per-call record: debug logging and the trace database were off when it ran (capture is not retroactive)',
  'no-usage-record': 'no usage record in its source (a cloud agent or Agents window run is not recorded locally)',
};

let host: HTMLElement | undefined;
let state: CreditsState | undefined;
let draft = '';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

const fmt = (n: number | undefined) => (n === undefined ? 'n/a' : n.toFixed(2));
const date = (iso: string) => new Date(iso).toLocaleDateString();

function button(text: string, onClick: () => void, secondary = false): HTMLButtonElement {
  const b = el('button', secondary ? 'credits-btn credits-secondary' : 'credits-btn', text);
  b.addEventListener('click', onClick);
  return b;
}

function draw(): void {
  if (!host) return;
  host.replaceChildren();
  const s = state;
  if (!s) {
    host.append(el('p', undefined, 'Reading sessions...'));
    return;
  }
  const head = el('div', 'credits-headline');
  if (s.quota) {
    const share = s.explainedShare === undefined ? '' : ` (${Math.round(s.explainedShare * 100)}%)`;
    head.textContent = `Local records explain ${fmt(s.localCredits)} of ${fmt(s.quota.used)} credits${share}`;
  } else {
    head.textContent = `Local records show ${fmt(s.localCredits)} credits (unverified)`;
  }
  host.append(head);
  host.append(
    el(
      'div',
      'credits-meta',
      `${date(s.period.start)} to ${date(s.period.end)}. Quota used: ${
        s.quota ? `${fmt(s.quota.used)} from ${s.quota.source === 'github' ? 'GitHub (copilot_internal/user)' : 'your manual entry'}` : 'no reading, so the local total is unverified'
      }.`
    )
  );
  if (s.remainder !== undefined && s.remainder > 0) {
    host.append(el('div', 'credits-remainder', `Unexplained: ${fmt(s.remainder)} credits (quota reading, not in any local record).`));
  }

  const table = el('table', 'credits-table');
  const hr = table.insertRow();
  for (const h of ['Source', 'Sessions', 'With credits', 'Credits (source total)', 'Credits counted (best per session)']) {
    hr.append(el('th', undefined, h));
  }
  for (const p of s.perSource) {
    const r = table.insertRow();
    r.insertCell().textContent = SOURCE_TEXT[p.source] ?? p.source;
    r.insertCell().textContent = String(p.sessions);
    r.insertCell().textContent = String(p.withCredits);
    r.insertCell().textContent = fmt(p.credits);
    r.insertCell().textContent = fmt(s.bySourceInBest[p.source]);
  }
  host.append(table);
  host.append(
    el('div', 'credits-meta', 'A session in two sources is counted once, from the richest one: trace database, debug logs, CLI, then chat session files.')
  );

  if (s.noDetailCount > 0) {
    const box = el('div', 'credits-nodetail');
    box.append(el('strong', undefined, `${s.noDetailCount} of ${s.sessionCount} sessions have no credit figure`));
    for (const [cause, count] of Object.entries(s.noDetailByCause)) {
      box.append(el('div', 'credits-cause', `${count}: ${CAUSE_TEXT[cause] ?? cause}`));
    }
    const ul = el('ul', 'credits-list');
    for (const item of s.noDetail) {
      ul.append(el('li', undefined, `${item.id.slice(0, 8)} (${item.sources.map((x) => SOURCE_TEXT[x] ?? x).join(', ')})${item.workspace ? ` in ${item.workspace}` : ''}`));
    }
    box.append(ul);
    if (s.noDetailCount > s.noDetail.length) box.append(el('div', 'credits-meta', `Newest ${s.noDetail.length} shown.`));
    host.append(box);
  }

  const form = el('div', 'credits-form');
  const input = el('input', 'credits-input');
  input.type = 'number';
  input.min = '0';
  input.step = 'any';
  input.placeholder = 'Quota used (credits)';
  input.value = draft;
  input.addEventListener('input', () => (draft = input.value));
  form.append(
    input,
    button('Save quota used', () => {
      const used = parseFloat(draft);
      if (Number.isFinite(used) && used >= 0) {
        draft = '';
        post({ type: 'creditsManualQuota', used });
      }
    }),
    button(s.githubQuota.enabled ? 'Read quota from GitHub again' : 'Read quota from GitHub', () => post({ type: 'creditsReadGithub' }), true)
  );
  if (s.quota?.source === 'manual') form.append(button('Clear my entry', () => post({ type: 'creditsClearManual' }), true));
  host.append(form);
  if (s.githubQuota.note) host.append(el('div', 'credits-meta', s.githubQuota.note));
  host.append(
    el('div', 'credits-meta', 'The GitHub read uses your VS Code GitHub sign-in for one request and stores nothing. The entry above is the fallback.')
  );
}

export const creditsCard: Card = {
  id: 'credits',
  title: 'Credits',
  render(body) {
    host = body;
    draw();
  },
  onMessage(message: ToWebview) {
    if (message.type !== 'credits') return;
    state = message.state;
    draw();
  },
};
