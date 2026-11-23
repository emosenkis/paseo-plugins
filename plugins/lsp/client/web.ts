import { Platform } from 'react-native';

export function confirmDiffCommands(workspace: string, snapshot: string) {
  if (Platform.OS !== 'web') return false;
  return window.confirm(`Allow working-diff language support in ${workspace}?\n\nThese configured programs will run on the daemon host with access to its files and credentials. Only approve commands you trust. Approval expires when the plugin reloads or the configuration changes.\n\n${JSON.stringify(JSON.parse(snapshot), null, 2)}`);
}
