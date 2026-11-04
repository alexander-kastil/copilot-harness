import * as vscode from 'vscode';

export class VersionManager {
  private static _version: string | null = null;

  static getVersion(): string {
    if (this._version === null) {
      const extension = vscode.extensions.getExtension('integrations-at.copilot-harness');
      this._version = extension?.packageJSON?.version ?? 'unknown';
    }
    return this._version!;
  }

  static getUserAgent(): string {
    const vscodeVersion = vscode.version;
    return `copilot-harness/${this.getVersion()} VSCode/${vscodeVersion}`;
  }

  static getClientInfo(): { name: string; version: string; author: string } {
    return {
      name: 'copilot-harness',
      version: this.getVersion(),
      author: 'integrations-at',
    };
  }
}
