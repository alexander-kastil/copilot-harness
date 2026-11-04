// The Plugin Hunter page's state, its saves and its repaint, shared by the page and its card, chat and picker views.
import type { HuntCreateAsk, HuntInfo, HuntProposal, HuntTurn } from '../shared/hunt';
import { post } from './bridge';

export interface HuntState {
  info?: HuntInfo;
  proposals: HuntProposal[];
  chat: HuntTurn[];
  /** What Create said for each card that was created: those cards are done. */
  created: Record<string, string>;
  /** The message being answered, shown in the chat until Copilot's reply arrives. */
  pending: string;
  picked?: string;
  prompt: string;
  running: boolean;
  /** When the running turn started, for the elapsed time shown while Copilot works. */
  startedAt: number;
  error: string;
  /** A short confirmation of an action, shown by the message box. */
  notice: string;
  menu: boolean;
  /** The card whose "add" picker is open, with its search. */
  adding?: string;
  addQuery: string;
  /** What the last Create of each card said. */
  results: Record<string, { state: string; text?: string } | undefined>;
  /** The page's tab, and the History items that are open (collapsed by default), by card id. */
  tab: 'new' | 'history';
  open: Record<string, boolean>;
  /** After the next paint: a card to bring into view or to focus, the picker or the search to focus, the newest reply to show. */
  reveal?: string;
  focusName?: string;
  focusMenu: boolean;
  focusAdder: boolean;
  showReply: boolean;
  /** The question before Create, while its card is open. */
  createAsk?: HuntCreateAsk;
}

export const hunt: HuntState = {
  proposals: [],
  chat: [],
  created: {},
  pending: '',
  prompt: '',
  running: false,
  startedAt: 0,
  error: '',
  notice: '',
  menu: false,
  addQuery: '',
  results: {},
  tab: 'new',
  open: {},
  focusMenu: false,
  focusAdder: false,
  showReply: false,
};

let root: HTMLElement | undefined;
let painter: (() => void) | undefined;

/** Set once by the page: its root (for queries) and the function that draws it again. */
export function bindPage(page: HTMLElement, paint: () => void): void {
  root = page;
  painter = paint;
}

export const page = (): HTMLElement => root ?? document.body;

/** What the waiting reply says: that Copilot is still at it, and for how long. */
export const waitText = (): string => {
  const s = Math.max(0, Math.floor((Date.now() - hunt.startedAt) / 1000));
  return `Copilot is working on it, ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} so far. A search over many skills can take a couple of minutes.`;
};

let ticker: ReturnType<typeof setInterval> | undefined;
/** Starts or stops the once-a-second update of the waiting reply; it changes that one text, so the page does not repaint. */
export const tickWait = (on: boolean): void => {
  if (ticker) clearInterval(ticker);
  ticker = undefined;
  if (!on) return;
  ticker = setInterval(() => {
    const text = page().querySelector('.hunt-msg.wait .hunt-msg-text');
    if (text) text.textContent = waitText();
  }, 1000);
};

let saveTimer: ReturnType<typeof setTimeout> | undefined;
export const saveNow = (): void => {
  if (saveTimer) clearTimeout(saveTimer);
  post({ type: 'huntSave', proposals: hunt.proposals, ...(hunt.picked ? { market: hunt.picked } : {}) });
};
export const saveSoon = (): void => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
};

const cardNode = (id: string) => page().querySelector<HTMLElement>(`[data-card="${id}"]`);

// After a paint: the card to focus or bring into view (in whichever column or page scrolls it), the adder to focus.
const afterPaint = (): void => {
  if (hunt.focusName) {
    const input = cardNode(hunt.focusName)?.querySelector<HTMLInputElement>('.hunt-title');
    input?.focus();
    input?.scrollIntoView({ block: 'nearest' });
  } else if (hunt.reveal) cardNode(hunt.reveal)?.scrollIntoView({ block: 'nearest' });
  hunt.focusName = hunt.reveal = undefined;
  if (hunt.focusAdder) {
    page().querySelector<HTMLInputElement>('.hunt-adder input')?.focus();
    hunt.focusAdder = false;
  }
  if (hunt.focusMenu) {
    const items = [...page().querySelectorAll<HTMLElement>('.hunt-market')];
    (items.find((i) => i.classList.contains('on')) ?? items[0])?.focus();
    hunt.focusMenu = false;
  }
};

// A repaint that stays where the owner had scrolled: the page, the card column and the chat. The chat is a traditional one: it
// follows the newest message while it is at the bottom or a reply just arrived.
const SCROLLERS = ['.main-body', '.hunt-col-find'];
export const repaint = (): void => {
  if (!painter || !root || root.hidden) return;
  const tops = SCROLLERS.map((q) => root!.querySelector(q)?.scrollTop ?? 0);
  const log = root.querySelector('.hunt-chat-log');
  const follow = !log || log.scrollHeight - log.scrollTop - log.clientHeight < 24;
  const logTop = log?.scrollTop ?? 0;
  painter();
  SCROLLERS.forEach((q, i) => {
    const node = root!.querySelector(q);
    if (node) node.scrollTop = tops[i];
  });
  const next = root.querySelector('.hunt-chat-log');
  if (next) next.scrollTop = follow || hunt.showReply ? next.scrollHeight : logTop;
  hunt.showReply = false;
  afterPaint();
};

/** A card Create has made a plugin of. */
export const isDone = (p: HuntProposal): boolean => !!(hunt.created[p.id] || hunt.results[p.id]?.state === 'done');

/** The cards, newest first: the one being worked on (the newest not yet created) and the rest, which are the History. */
export const splitCards = (): { all: HuntProposal[]; working?: HuntProposal; history: HuntProposal[] } => {
  const all = [...hunt.proposals].sort((a, b) => b.created - a.created);
  const working = all.find((p) => !isDone(p));
  return { all, working, history: all.filter((p) => p !== working) };
};

/** The card a turn belongs to: the one it names; a turn from before that field is the newest card made at or before it; '' is the working one. */
const cardOfTurn = (t: HuntTurn, all: HuntProposal[]): string => (t.card !== undefined ? t.card : (all.find((p) => p.created <= t.at) ?? { id: '' }).id);

/** The turns of one card, oldest first. */
export const turnsOf = (p: HuntProposal, all: HuntProposal[]): HuntTurn[] => hunt.chat.filter((t) => cardOfTurn(t, all) === p.id);

/** The turns of the hunt in progress: those of its card and those that came before any card or name a card that is gone. */
export const workingTurns = ({ all, working }: { all: HuntProposal[]; working?: HuntProposal }): HuntTurn[] =>
  hunt.chat.filter((t) => (working ? cardOfTurn(t, all) === working.id : false) || !all.some((p) => p.id === cardOfTurn(t, all)));

/** New plugin: an empty card, on top and in focus, without asking Copilot. */
export const newCard = (): void => {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  hunt.proposals = [{ id, prompt: '', created: Date.now(), name: '', description: '', category: '', assets: [] }, ...hunt.proposals];
  hunt.focusName = id;
  saveNow();
  repaint();
};

/** New hunt: an empty card and an empty chat, as the chip's name says; a card nothing is on yet already is that. */
export const newHunt = (): void => {
  hunt.tab = 'new';
  const { working } = splitCards();
  if (working && !working.name.trim() && !working.assets.length) {
    hunt.focusName = working.id;
    return repaint();
  }
  hunt.prompt = '';
  newCard();
};

export const marketOf = () => hunt.info?.markets.find((k) => k.name === hunt.picked);
