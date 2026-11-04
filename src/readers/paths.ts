// Where Copilot keeps its data. Pure: every function takes an Env, so tests pass a fixture home.
// No vscode import.
import * as os from 'node:os';
import * as path from 'node:path';

export interface Env {
  home: string;
  platform: NodeJS.Platform;
  /** %APPDATA% on Windows; defaults to <home>/AppData/Roaming. */
  appData?: string;
  /** $XDG_CONFIG_HOME on Linux; defaults to <home>/.config. */
  xdgConfig?: string;
}

export function currentEnv(): Env {
  return {
    home: os.homedir(),
    platform: process.platform,
    appData: process.env.APPDATA,
    xdgConfig: process.env.XDG_CONFIG_HOME,
  };
}

/** User-data folder names of the VS Code variants whose Copilot data the readers look for. */
export const VSCODE_VARIANTS = ['Code', 'Code - Insiders', 'VSCodium', 'Cursor'] as const;

export interface UserDataDir {
  variant: string;
  dir: string;
}

/** Candidate user-data folders, existing or not; callers check existence. */
export function userDataDirs(env: Env): UserDataDir[] {
  const base =
    env.platform === 'win32'
      ? env.appData ?? path.join(env.home, 'AppData', 'Roaming')
      : env.platform === 'darwin'
        ? path.join(env.home, 'Library', 'Application Support')
        : env.xdgConfig ?? path.join(env.home, '.config');
  return VSCODE_VARIANTS.map((variant) => ({ variant, dir: path.join(base, variant) }));
}

export function userDir(userDataDir: string): string {
  return path.join(userDataDir, 'User');
}

export function workspaceStorageDir(userDataDir: string): string {
  return path.join(userDataDir, 'User', 'workspaceStorage');
}

export function globalStorageDir(userDataDir: string): string {
  return path.join(userDataDir, 'User', 'globalStorage');
}

/** The Copilot CLI and plugin home, ~/.copilot. */
export function copilotHome(env: Env): string {
  return path.join(env.home, '.copilot');
}
