import { cards } from './cards';
import { onMessage, post } from './bridge';
import { createOverview } from './overview';

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

// The overview page owns the layout; the registered cards render below its lists.
const overview = createOverview(grid);
root.append(overview.root);

onMessage(message => {
  if (message.type === 'overview') overview.update(message.state);
  for (const card of cards) card.onMessage?.(message);
});

post({ type: 'ready' });
