import { cards } from './cards';
import { onMessage, post } from './bridge';

const root = document.getElementById('app')!;
const h1 = document.createElement('h1');
h1.textContent = 'Copilot Harness';
const grid = document.createElement('div');
grid.className = 'cards';
root.append(h1, grid);

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

onMessage(message => {
  for (const card of cards) card.onMessage?.(message);
});

post({ type: 'ready' });
