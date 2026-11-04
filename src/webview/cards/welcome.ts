import type { Card } from './types';

export const welcomeCard: Card = {
  id: 'welcome',
  title: 'Welcome',
  render(body) {
    const p = document.createElement('p');
    p.textContent = 'Copilot Harness is set up. Features appear here as cards.';
    body.append(p);
  },
};
