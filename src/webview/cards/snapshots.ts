// Snapshots card (#12): how many sessions the extension keeps its own copy of, the store size against
// its cap, and how many sessions are listed only from the copy.
import type { ToWebview } from '../../shared/messages';
import type { SnapshotsState } from '../../shared/snapshots';
import type { Card } from './types';

let host: HTMLElement | undefined;
let state: SnapshotsState | undefined;

const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(bytes < 1024 * 1024 ? 2 : 1);

function line(text: string, className?: string): HTMLParagraphElement {
  const p = document.createElement('p');
  if (className) p.className = className;
  p.textContent = text;
  return p;
}

function draw(): void {
  if (!host) return;
  host.replaceChildren();
  const s = state;
  if (!s) {
    host.append(line('Reading sessions...'));
    return;
  }
  if (!s.created) {
    host.append(line('No Copilot sessions found yet, so no snapshot store exists.'));
    return;
  }
  host.append(
    line(`${s.records} sessions kept as numbers only (no prompt or response text). Store ${mb(s.bytes)} of ${mb(s.maxBytes)} MB.`),
    line(`${s.fromSnapshot} sessions are listed only from a snapshot because Copilot no longer has their files.`, 'snapshots-meta')
  );
  if (s.trimmedTotal > 0) {
    const when = s.trimmedAt ? ` (last on ${new Date(s.trimmedAt).toLocaleDateString()})` : '';
    host.append(line(`The size cap removed the ${s.trimmedTotal} oldest records so far${when}. Raise copilotHarness.snapshots.maxMegabytes to keep more.`, 'snapshots-warn'));
  }
}

export const snapshotsCard: Card = {
  id: 'snapshots',
  title: 'Snapshots',
  render(body) {
    host = body;
    draw();
  },
  onMessage(message: ToWebview) {
    if (message.type === 'snapshots') {
      state = message.state;
      draw();
    }
  },
};
