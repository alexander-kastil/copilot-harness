// The Plugin Hunter's confirm cards, in the panel's own confirm card (the .ai-confirm of askAi in session-ui.ts): a card
// that floats under the button that asked, says what will happen, and closes on Esc, Cancel or a click outside.
import { el, icon } from './dom';

export interface ConfirmFact {
  glyph: string;
  text: string | Node;
}

export interface ConfirmOptions {
  title: string;
  sub?: string;
  facts: ConfirmFact[];
  action: string;
  actionGlyph?: string;
  /** Adds the Don't ask again switch; the answer reaches onConfirm. */
  remember?: boolean;
  onConfirm(remember: boolean): void;
}

/** Opens the card under `anchor`; one card at a time. */
export function confirmAt(anchor: HTMLElement, o: ConfirmOptions): void {
  document.querySelector('body > .ai-confirm.float')?.remove();
  const again = o.remember ? (el('input', { type: 'checkbox', id: 'hunt-skip', role: 'switch' }) as HTMLInputElement) : undefined;
  const close = () => {
    document.removeEventListener('mousedown', outside, true);
    card.remove();
    anchor.focus();
  };
  const outside = (e: Event) => {
    if (!card.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const go = el(
    'button',
    {
      className: 'payg-btn',
      onclick: () => {
        const keep = !!again?.checked;
        close();
        o.onConfirm(keep);
      },
    },
    icon(o.actionGlyph ?? 'check'),
    o.action
  );
  const card = el(
    'div',
    {
      className: 'ai-confirm float hunt-confirm',
      role: 'alertdialog',
      'aria-label': o.title,
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      },
    },
    el('div', { className: 'ai-confirm-text' }, el('b', {}, o.title), o.sub ? el('span', { className: 'hunt-confirm-sub' }, o.sub) : null),
    el('ul', { className: 'hunt-confirm-facts' }, o.facts.map((f) => el('li', {}, icon(f.glyph), el('span', {}, f.text)))),
    again ? el('label', { className: 'ai-confirm-skip' }, again, "Don't ask again") : null,
    el('div', { className: 'ai-confirm-actions' }, go, el('button', { className: 'payg-btn secondary', onclick: close }, 'Cancel'))
  );
  document.body.append(card);
  const at = anchor.getBoundingClientRect();
  const width = Math.min(460, window.innerWidth - 16);
  card.style.width = `${width}px`;
  card.style.left = `${Math.max(8, Math.min(at.right - width, window.innerWidth - width - 8))}px`;
  card.style.top = `${Math.max(8, Math.min(at.bottom + 6, window.innerHeight - card.offsetHeight - 8))}px`;
  document.addEventListener('mousedown', outside, true);
  go.focus();
}
