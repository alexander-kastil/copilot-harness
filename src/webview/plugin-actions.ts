// The Plugin box of a plugin's page: turn it on or off, sync it from its marketplace, uninstall it. Each asks first.
import type { ElementEntry } from '../shared/element';
import { cmd, cmdBox } from './cmd-bar';
import { pluginOf } from './market-data';
import { syncPlugin, togglePlugin, uninstallPlugin } from './market-ui';

export function pluginBox(e: ElementEntry): HTMLElement | null {
  if (e.kind !== 'plugin' || !e.pluginId) return null;
  const hit = pluginOf(e.pluginId);
  if (!hit) return null;
  const { market, plugin } = hit;
  return cmdBox(
    'Plugin',
    cmd(plugin.enabled ? 'circle-slash' : 'pass', plugin.enabled ? 'Disable' : 'Enable', `${plugin.enabled ? 'Disable' : 'Enable'}\n${plugin.enabled ? 'Stops' : 'Starts'} loading ${plugin.name} in Copilot. Sets ${plugin.key} under enabledPlugins.`, (ev) => togglePlugin(ev.currentTarget as HTMLElement, market, plugin)),
    plugin.ahead ? cmd('sync', 'Sync plugin', `Sync plugin\nRefresh ${market.name} and update ${plugin.name} from ${plugin.installed} to ${plugin.source}.`, (ev) => syncPlugin(ev.currentTarget as HTMLElement, market, plugin)) : null,
    cmd('trash', 'Uninstall', `Uninstall\nRuns copilot plugin uninstall ${plugin.key}.`, (ev) => uninstallPlugin(ev.currentTarget as HTMLElement, market, plugin))
  );
}
