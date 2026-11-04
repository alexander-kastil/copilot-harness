import type { ToWebview } from '../../shared/messages';

/** One card of the panel. A feature adds its own file under cards/ and one line in cards/index.ts. */
export interface Card {
  id: string;
  title: string;
  /** Fills the card body; called once when the card is created. */
  render(body: HTMLElement): void;
  /** Optional: receives every host message after the card is mounted. */
  onMessage?(message: ToWebview): void;
}
