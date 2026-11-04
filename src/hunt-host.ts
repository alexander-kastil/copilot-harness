// Host side of the Plugin Hunter: reads the marketplaces and the catalog, runs Copilot CLI for each turn of the conversation,
// keeps the cards and the chat, and creates the plugin in a marketplace folder of the owner's.
import * as path from 'node:path';
import * as vscode from 'vscode';
import { navListing } from './nav-host';
import { HarnessPanel } from './panel';
import { applyProposal, chatPrompt, parseTurn, shortReply, unknownNames } from './readers/hunt';
import { buildCatalog, inventoryText, keyOf, reconcile, samePath } from './readers/hunt-catalog';
import { backupStamp, copilotRoot, installPlugin, planCreate, retireCopies, runCopilot, unwritePlugin, writePlugin } from './readers/hunt-create';
import { readMarkets, type ListedMarket } from './readers/hunt-market';
import type { HuntInfo, HuntProposal, HuntTurn } from './shared/hunt';

const PROPOSALS = 'copilotHarness.huntProposals';
const MARKET = 'copilotHarness.huntMarket';
const REMEMBERED = 'copilotHarness.huntRemembered';
const CHAT = 'copilotHarness.huntChat';
// The card the conversation builds: the one a proposal updates.
const CURRENT = 'copilotHarness.huntCurrent';
// The text each created card shows, by card id.
const CREATED = 'copilotHarness.huntCreated';
// Turns sent back to Copilot with each message.
const HISTORY = 20;
// Flags of a Copilot CLI call that only answers: no tool, no MCP server, no update check.
const ANSWER_FLAGS = ['-s', '--available-tools=', '--disable-builtin-mcps', '--no-auto-update'];

/** A Copilot failure in the owner's words, not the raw error line. */
const friendly = (error: string): string => {
  const code = /\b([45]\d\d)\b/.exec(error)?.[1];
  if (/rate limit|overloaded|unavailable|api error/i.test(error) || code) return `Copilot is busy or unavailable right now${code ? ` (error ${code})` : ''}. Your message is still in the box: try again.`;
  if (/ENOENT|not recognized|not found/i.test(error)) return 'Copilot CLI is not installed or not on the PATH. Your message is still in the box.';
  return `Copilot could not answer: ${error.split('\n').filter(Boolean)[0]?.slice(0, 160) ?? 'no answer'} Your message is still in the box.`;
};

export function registerHunt(context: vscode.ExtensionContext): void {
  const state = context.globalState;
  let busy = false;
  const stored = () => state.get<HuntProposal[]>(PROPOSALS, []);
  const post = HarnessPanel.post;

  const listMarkets = async () => {
    const r = await runCopilot(['plugin', 'marketplace', 'list', '--json'], { timeout: 60000 });
    try {
      return readMarkets(JSON.parse(r.out.slice(r.out.indexOf('['))) as ListedMarket[]);
    } catch {
      return [];
    }
  };

  const info = async (): Promise<HuntInfo> => {
    const nav = navListing();
    const markets = await listMarkets();
    const last = state.get<string>(MARKET);
    const picked = markets.find((m) => m.owned && m.name === last)?.name ?? markets.find((m) => m.owned)?.name;
    const catalog = nav ? buildCatalog(nav) : [];
    const created = state.get<Record<string, string>>(CREATED, {});
    const proposals = reconcile(stored(), catalog, created).sort((a, b) => b.created - a.created);
    const chat = state.get<HuntTurn[]>(CHAT, []);
    return { markets, picked, catalog, proposals, chat, created, ask: !chat.length && !state.get<boolean>(REMEMBERED), items: catalog.length };
  };

  const postInfo = async () => post({ type: 'hunt', info: await info() });

  const run = async (prompt: string, cardId: string | undefined, confirmed: boolean, remember: boolean): Promise<void> => {
    if (!prompt.trim()) return void post({ type: 'huntRun', state: 'error', error: 'Write a message first.' });
    if (busy) return;
    const nav = navListing();
    if (!nav) return void post({ type: 'huntRun', state: 'error', error: 'The harness is still being read. Your message is still in the box.' });
    const chat = state.get<HuntTurn[]>(CHAT, []);
    // Asked once per conversation: the card says every message of it counts against the plan.
    if (!chat.length && !confirmed && !state.get<boolean>(REMEMBERED)) return void post({ type: 'huntRun', state: 'error', error: 'Confirm the first message.' });
    if (remember) await state.update(REMEMBERED, true);
    busy = true;
    post({ type: 'huntRun', state: 'running' });
    let createId: string | undefined;
    let touched: string | undefined;
    let latest: HuntInfo | undefined;
    try {
      const catalog = buildCatalog(nav);
      const inventory = inventoryText(nav);
      // A comment typed on a card is about that card, whichever one the conversation was building.
      const currentId = cardId && stored().some((p) => p.id === cardId) ? cardId : state.get<string>(CURRENT);
      const sent = reconcile(stored(), catalog).find((p) => p.id === currentId);
      const result = await runCopilot(ANSWER_FLAGS, { timeout: 300000, cwd: copilotRoot(), input: chatPrompt(prompt, inventory, sent, chat.slice(-HISTORY), !!cardId && !!sent) });
      if (result.code !== 0 || !result.out) return void post({ type: 'huntRun', state: 'error', error: friendly(result.out || `exit ${result.code}`) });
      const turn = parseTurn(result.out);
      let reply = shortReply(turn.reply) || 'Done.';
      // Edits made on the card while Copilot was answering are the card as it is now.
      const live = reconcile(stored(), catalog).find((p) => p.id === currentId);
      if (turn.proposal) {
        const left = unknownNames(turn.proposal, catalog);
        if (left.length) reply += ` Left out ${left.length} not in your inventory.`;
        const card = applyProposal(live, turn.proposal, chat.find((t) => t.role === 'owner')?.text ?? prompt, catalog, live?.id ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, Date.now(), sent);
        // A proposal with nothing in it never empties a card, and never makes an empty one.
        // Copilot is shown the ticked elements only: the unticked ones of the card stay on it.
        if (live && cardId) card.assets.push(...live.assets.filter((a) => !a.include && !card.assets.some((c) => keyOf(c) === keyOf(a))));
        if (card.assets.length) {
          const cards = stored();
          await state.update(PROPOSALS, live ? cards.map((c) => (c.id === card.id ? card : c)) : [card, ...cards]);
          await state.update(CURRENT, card.id);
          touched = card.id;
        } else reply += live ? ' The card was left as it is.' : '';
      }
      const now = Date.now();
      const belongs = touched ?? live?.id ?? '';
      await state.update(CHAT, [...chat, { role: 'owner', text: prompt, at: now, card: belongs }, { role: 'copilot', text: reply, at: now, card: belongs }]);
      if (turn.create) createId = touched ?? state.get<string>(CURRENT);
      // The page gets the new card first, so that "done" can bring it and the reply into view.
      latest = await info();
      post({ type: 'hunt', info: latest });
      post({ type: 'huntRun', state: 'done', card: touched });
    } catch (e) {
      post({ type: 'huntRun', state: 'error', error: friendly((e as Error).message) });
    } finally {
      busy = false;
    }
    // "Create the plugin": the card's own Create question, for the marketplace picked on the page.
    if (createId && latest?.proposals.some((p) => p.id === createId)) {
      if (latest.picked) await create(createId, latest.picked, false);
      else post({ type: 'huntCreate', id: createId, state: 'error', text: 'Pick a marketplace of yours first.' });
    }
  };

  const create = async (id: string, marketName: string, confirmed: boolean): Promise<void> => {
    const say = (s: 'running' | 'done' | 'error', text?: string) => post({ type: 'huntCreate', id, state: s, text });
    const nav = navListing();
    const proposal = nav ? reconcile(stored(), buildCatalog(nav)).find((p) => p.id === id) : undefined;
    const market = (await listMarkets()).find((m) => m.name === marketName);
    if (!proposal || !market) return say('error', 'The card or the marketplace is gone.');
    const made = state.get<Record<string, string>>(CREATED, {})[id];
    if (made) return say('done', made);
    if (busy) return;
    const root = copilotRoot();
    const backupRoot = path.join(root, 'hunt-backups');
    const plan = planCreate(proposal, { root, market, backupRoot });
    if (plan.problems.length) return say('error', plan.problems.join(' '));
    if (!confirmed) return post({ type: 'huntCreateAsk', ask: { id, name: proposal.name, market: market.name, location: path.resolve(market.location), files: plan.files, replaced: plan.retired, kept: plan.kept } });
    busy = true;
    say('running');
    const key = `${proposal.name}@${market.name}`;
    try {
      await writePlugin(proposal, plan, market);
    } catch (e) {
      busy = false;
      return say('error', `Nothing was created: ${(e as Error).message}`);
    }
    try {
      await installPlugin(proposal, market);
    } catch (e) {
      busy = false;
      let undone = 'The plugin folder and its marketplace entry were removed again; no copy was replaced.';
      try {
        unwritePlugin(proposal, plan, market);
      } catch {
        undone = 'The plugin folder and its marketplace entry are written; no copy was replaced.';
      }
      return say('error', `${(e as Error).message} ${undone}`);
    }
    try {
      const backup = plan.retires.length ? retireCopies(plan, backupRoot, backupStamp()) : undefined;
      const text = `Created and installed ${key}.${backup ? ` Replaced ${plan.retires.length} ${plan.retires.length === 1 ? 'copy' : 'copies'} with the plugin's version, each backed up first in ${path.relative(root, backup)}.` : ''}`;
      await state.update(CREATED, { ...state.get<Record<string, string>>(CREATED, {}), [id]: text });
      // The next proposal of the conversation is a new plugin, not a change to this one.
      if (state.get<string>(CURRENT) === id) await state.update(CURRENT, undefined);
      say('done', text);
    } catch (e) {
      say('error', `${key} is installed, but replacing the copies failed: ${(e as Error).message}`);
    } finally {
      busy = false;
      void postInfo();
    }
  };

  // Compare: a repo copy opens next to the base copy in the diff editor. Only copies the catalog lists are opened.
  const compare = (file: string, kind: 'skill' | 'agent'): void => {
    const nav = navListing();
    const hit = nav ? buildCatalog(nav).find((c) => c.asset.kind === kind && c.asset.repos.some((r) => samePath(r.path, file))) : undefined;
    const base = hit?.asset.global?.path ?? hit?.asset.repos[0]?.path;
    if (!hit || !base || samePath(base, file)) return void vscode.window.showInformationMessage('There is no other copy to compare with.');
    const f = (p: string) => vscode.Uri.file(kind === 'skill' ? path.join(p, 'SKILL.md') : p);
    void vscode.commands.executeCommand('vscode.diff', f(base), f(file), `${hit.asset.name}: ${hit.asset.global ? 'global' : 'first'} copy and repo copy`);
  };

  context.subscriptions.push(
    HarnessPanel.onMessage((h) => {
      switch (h.type) {
        case 'huntInfo':
          void postInfo();
          break;
        case 'huntSave':
          void state.update(PROPOSALS, h.proposals);
          if (h.market) void state.update(MARKET, h.market);
          break;
        case 'huntRun':
          void run(h.prompt, h.card, !!h.confirmed, !!h.remember);
          break;
        case 'huntClear':
          void state.update(CHAT, []);
          void state.update(CURRENT, undefined);
          break;
        case 'huntCreate':
          void create(h.id, h.market, !!h.confirmed);
          break;
        case 'huntMerge':
          compare(h.path, h.kind);
          break;
      }
    })
  );
}
