import { cards } from './cards';
import { onMessage, post } from './bridge';
import { createOverview } from './overview';
import { createNav } from './nav';
import { createPaygPage } from './payg';
import { mountPages, registerPage } from './pages';
import { detectPlan } from './billing';
import { createSessionsPage } from './sessions';
import { createSessionPage } from './session-page';
import { createKindPage } from './kind-page';
import { createElementPage } from './element-page';
import { setNavData } from './harness-data';
import { createHuntPage } from './hunt';
import { createMarketPages } from './markets';
import { onPlan, setMarkets, setResult } from './market-data';

const root = document.getElementById('app')!;
const grid = document.createElement('div');
grid.className = 'cards';

for (const card of cards) {
  const el = document.createElement('section');
  el.className = 'card';
  el.dataset.card = card.id;
  const h2 = document.createElement('h2');
  h2.textContent = card.title;
  const body = document.createElement('div');
  el.append(h2, body);
  grid.append(el);
  card.render(body);
}

// The shell: the left nav column, then the main column that shows one page at a time.
const shell = document.createElement('div');
shell.className = 'shell';
const navHost = document.createElement('aside');
navHost.className = 'nav-host';
const pageHost = document.createElement('div');
pageHost.className = 'page-host';
shell.append(navHost, pageHost);
root.append(shell);
mountPages(pageHost);

// The overview page owns its layout; the registered cards render below its lists.
const overview = createOverview(grid);
registerPage('overview', overview.root);

const payg = createPaygPage('models');
registerPage('payg', payg.root);
const providersPage = createPaygPage('providers');
registerPage('providers', providersPage.root);

const sessionsPage = createSessionsPage();
registerPage('sessions', sessionsPage.root);
const sessionPage = createSessionPage();
registerPage('session', sessionPage.root);

const kindPage = createKindPage();
registerPage('kind', kindPage.root);
const elementPage = createElementPage();
registerPage('element', elementPage.root);
const huntPage = createHuntPage();
registerPage('hunt', huntPage.root);
const marketPages = createMarketPages();
registerPage('marketplaces', marketPages.health);
registerPage('marketplace', marketPages.market);

const nav = createNav(navHost, overview);

onMessage(message => {
  if (message.type === 'overview') overview.update(message.state);
  if (message.type === 'nav') {
    setNavData(message.state);
    nav.update(message.state);
  }
  if (message.type === 'elementUsage') elementPage.usage(message);
  if (message.type === 'elementDetail') elementPage.update(message.file, message.detail, message.error);
  if (message.type === 'payg') {
    payg.update(message.state);
    providersPage.update(message.state);
    overview.setPayg(message.state);
  }
  if (message.type === 'hunt' || message.type === 'huntRun' || message.type === 'huntCreate' || message.type === 'huntCreateAsk') huntPage.onMessage(message);
  if (message.type === 'markets') setMarkets(message.markets);
  if (message.type === 'marketsPlan') onPlan(message);
  if (message.type === 'marketsResult') setResult(message);
  if (message.type === 'credits') detectPlan(message.state.quota?.entitlement);
  if (message.type === 'sessions') sessionsPage.update(message.state);
  if (message.type === 'sessionDetail') sessionPage.update(message.id, message.detail, message.error);
  for (const card of cards) card.onMessage?.(message);
});

post({ type: 'ready' });
