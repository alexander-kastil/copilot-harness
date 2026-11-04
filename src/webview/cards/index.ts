// The one list of cards. A feature imports its card on its own line and adds it to the array on its own line.
import type { Card } from './types';
import { setupCard } from './setup';
import { creditsCard } from './credits';
import { snapshotsCard } from './snapshots';
import { skillsCard } from './skills';

export const cards: Card[] = [
  setupCard,
  creditsCard,
  snapshotsCard,
  skillsCard,
];
