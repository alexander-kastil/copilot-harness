import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import type { ToHost, ToWebview } from './shared/messages';
import { panelHtml } from './panel-html';

/** The singleton Copilot Harness panel. */
export class HarnessPanel {
  private static current: HarnessPanel | undefined;

  static show(context: vscode.ExtensionContext): void {
    if (HarnessPanel.current) {
      HarnessPanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel('copilotHarness.panel', 'Copilot Harness', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    });
    HarnessPanel.current = new HarnessPanel(context, panel);
  }

  static post(message: ToWebview): void {
    HarnessPanel.current?.post(message);
  }

  private static readonly listeners = new Set<(message: ToHost) => void>();

  /**
   * Features receive every webview message here, `ready` included (sent each time the page loads),
   * so a feature answers `ready` by posting its current state.
   */
  static onMessage(listener: (message: ToHost) => void): vscode.Disposable {
    HarnessPanel.listeners.add(listener);
    return new vscode.Disposable(() => HarnessPanel.listeners.delete(listener));
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel
  ) {
    panel.webview.html = this.html();
    panel.onDidDispose(() => {
      HarnessPanel.current = undefined;
    });
    panel.webview.onDidReceiveMessage((m: ToHost) => this.onMessage(m));
  }

  private onMessage(message: ToHost): void {
    if (message.type === 'ready') {
      this.post({ type: 'init', version: String(this.context.extension.packageJSON.version) });
    }
    for (const listener of HarnessPanel.listeners) listener(message);
  }

  private post(message: ToWebview): void {
    void this.panel.webview.postMessage(message);
  }

  private html(): string {
    const web = this.panel.webview;
    const media = (...p: string[]) => web.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', ...p)).toString();
    return panelHtml({
      cspSource: web.cspSource,
      nonce: crypto.randomBytes(16).toString('base64'),
      scriptUri: media('webview', 'panel.js'),
      styleUri: media('panel.css'),
    });
  }
}
