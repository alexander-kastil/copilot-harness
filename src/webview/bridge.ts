import type { ToHost, ToWebview } from '../shared/messages';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const api = acquireVsCodeApi();

export function post(message: ToHost): void {
  api.postMessage(message);
}

export function onMessage(handler: (message: ToWebview) => void): void {
  window.addEventListener('message', e => handler(e.data as ToWebview));
}
