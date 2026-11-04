// The one list of cards. A feature imports its card on its own line and adds it to the array on its own line.
import type { Card } from './types';
import { welcomeCard } from './welcome';
import { setupCard } from './setup';
import { creditsCard } from './credits';

export const cards: Card[] = [
  welcomeCard,
  setupCard,
  creditsCard,
];
