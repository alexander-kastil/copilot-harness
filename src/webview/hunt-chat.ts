// The chat column of the Plugin Hunter's New hunt tab, built like a traditional chat: the conversation in order with the
// newest message at the bottom, and the composer pinned under it. The card beside it is the artifact.
import type { HuntTurn } from '../shared/hunt';
import { post } from './bridge';
import { el, icon } from './dom';
import { confirmAt } from './hunt-confirm';
import { hunt, repaint, waitText, workingTurns, type HuntState } from './hunt-state';

/** The AI group of the page: the Copilot mark, then the actions that start Copilot. */
export const huntAi = (cls: string, ...items: (Node | null | undefined | false)[]): HTMLElement =>
  el(
    'span',
    { className: `ai-group${cls ? ` ${cls}` : ''}`, role: 'group', 'aria-label': 'Copilot' },
    el('span', { className: 'ai-mark', title: 'Copilot\nEach action in this box runs Copilot CLI in the background and counts against your Copilot credits.' }, icon('copilot')),
    ...(items.filter(Boolean) as Node[])
  );

/** One message of the conversation. */
export const turnRow = (t: HuntTurn & { wait?: boolean }): HTMLElement =>
  el(
    'div',
    { className: `hunt-msg ${t.role}${t.wait ? ' wait' : ''}` },
    el('span', { className: 'hunt-msg-who' }, t.role === 'owner' ? null : icon('copilot'), t.role === 'owner' ? 'You' : 'Copilot'),
    el('div', { className: 'hunt-msg-text' }, t.text)
  );

/** The page's Start over, for its header bar. */
export function startOver(): HTMLElement {
  const button = el(
    'button',
    {
      className: 'secondary hunt-clear',
      disabled: hunt.running || !hunt.chat.length,
      title: 'Start over\nClears the conversation, the chats in History too. The plugin cards stay.',
      onclick: () =>
        confirmAt(button, {
          title: 'Start the conversation over?',
          sub: 'Plugin Hunter',
          facts: [
            { glyph: 'comment-discussion', text: 'The messages above are cleared, and Copilot no longer sees them.' },
            { glyph: 'package', text: 'The plugin cards below stay as they are.' },
          ],
          action: 'Start over',
          actionGlyph: 'clear-all',
          onConfirm: () => {
            hunt.chat = [];
            hunt.notice = 'Conversation cleared. The cards stay.';
            post({ type: 'huntClear' });
            setTimeout(() => ((hunt.notice = ''), repaint()), 5000);
            repaint();
          },
        }),
    },
    icon('clear-all'),
    'Start over'
  );
  return button;
}

/** Sends a message; the first one of a conversation asks first, because it sends the inventory and counts against the credits. */
function send(anchor: HTMLElement, card?: string): void {
  const go = (remember: boolean) => post({ type: 'huntRun', prompt: hunt.prompt, ...(card ? { card } : {}), confirmed: true, ...(remember ? { remember: true } : {}) });
  if (!hunt.info?.ask) return go(false);
  const n = hunt.info.items;
  confirmAt(anchor, {
    title: 'Ask Copilot to hunt',
    sub: 'with Copilot CLI, in the background',
    facts: [
      { glyph: 'account', text: 'Runs copilot -s on your own Copilot login, so it counts against your Copilot credits.' },
      { glyph: 'list-unordered', text: `Sends your message, the conversation so far and the name, description and place of every skill and agent of yours, in Global and in every repo Copilot Harness knows (${n}), but no file contents.` },
      { glyph: 'package', text: 'Nothing is written until you press Create and agree.' },
    ],
    action: 'Ask Copilot',
    actionGlyph: 'telescope',
    remember: true,
    onConfirm: go,
  });
}

// One box for both ways to talk to Copilot. Hunt sends the message as it is: search, change the card, create the plugin. Go sends it
// as a change to the ticked elements of the card beside the chat. Both start with the question that counts against the credits.
function composer(working: HuntState['proposals'][number] | undefined): HTMLElement {
  const ticked = working ? working.assets.filter((a) => a.include).length : 0;
  const idle = () => hunt.running || !hunt.prompt.trim();
  const goBtn = el(
    'button',
    { className: 'secondary', title: ticked ? 'Go\nSends the message as a change to the ticked elements of the card on the right. Copilot answers in the conversation and changes the card. A rename is carried out when you press Create.' : 'Go\nTick an element of the card to change it.', onclick: () => send(goBtn, working!.id) },
    icon('send'),
    'Go'
  );
  const hunter: HTMLButtonElement = el('button', { className: 'primary', onclick: () => send(hunter) }, icon('telescope'), hunt.running ? 'Hunting...' : 'Hunt');
  const sync = () => {
    goBtn.disabled = idle() || !ticked;
    hunter.disabled = idle();
  };
  sync();
  const text = el('textarea', {
    className: 'hunt-ask-text chat-input-text',
    rows: 2,
    placeholder: hunt.running ? 'Copilot is answering. Your message is in the conversation above.' : 'Message Copilot, e.g. "search all angular skills" or "create the plugin". Go changes the ticked elements: "rename docker-images to hetzner-docker".',
    value: hunt.running ? '' : hunt.prompt,
    readonly: hunt.running,
    'aria-label': 'Message to Copilot',
    oninput: (e: Event) => {
      hunt.prompt = (e.target as HTMLTextAreaElement).value;
      sync();
    },
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!idle()) hunter.click();
      }
    },
  });
  return el(
    'div',
    { className: 'hunt-composer' },
    hunt.error ? el('div', { className: 'notice bad', role: 'alert' }, hunt.error) : null,
    el(
      'div',
      { className: 'chat-input', onclick: (e: Event) => e.target === e.currentTarget && text.focus() },
      text,
      el('div', { className: 'chat-input-bar' }, hunt.notice ? el('span', { className: 'hunt-note', role: 'status' }, icon('check'), hunt.notice) : null, el('span', { className: 'spacer' }), huntAi('', goBtn, hunter))
    )
  );
}

/** The column: its head, the conversation of the hunt in progress with the message being answered at its end, and the composer. */
export function chatColumn(split: ReturnType<typeof import('./hunt-state').splitCards>): HTMLElement {
  const turns: (HuntTurn & { wait?: boolean })[] = [
    ...workingTurns(split),
    ...(hunt.pending ? [{ role: 'owner' as const, text: hunt.pending, at: 0 }, { role: 'copilot' as const, text: waitText(), at: 0, wait: true }] : []),
  ];
  return el(
    'div',
    { className: 'hunt-col hunt-col-chat' },
    el('div', { className: 'hunt-col-head' }, icon('comment-discussion'), el('span', {}, 'Chat')),
    el(
      'div',
      { className: 'hunt-chat-log', role: 'log', 'aria-live': 'polite' },
      turns.length ? turns.map(turnRow) : el('div', { className: 'empty flush' }, 'Tell Copilot which skills and agents belong together. Its answers show up here and the plugin it proposes on the right.')
    ),
    composer(split.working)
  );
}
