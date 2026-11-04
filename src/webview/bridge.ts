import type { ToHost, ToWebview } from '../shared/messages';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void; getState(): unknown; setState(state: unknown): void };

const api = acquireVsCodeApi();

/** The panel's saved state (VS Code keeps it while the webview is reloaded); one object, keys added by features. */
export function savedState(): Record<string, unknown> {
  const s = api.getState();
  return s && typeof s === 'object' ? (s as Record<string, unknown>) : {};
}

export function saveState(patch: Record<string, unknown>): void {
  api.setState({ ...savedState(), ...patch });
}

export function post(message: ToHost): void {
  api.postMessage(message);
}

export function onMessage(handler: (message: ToWebview) => void): void {
  window.addEventListener('message', e => handler(e.data as ToWebview));
}
