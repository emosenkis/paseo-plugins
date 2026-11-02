import type { PluginClientContext, PluginSidebarItemProps } from '@getpaseo/plugin/client';
import { NativeInstaller, disposeNative } from './client/native-installer.tsx';
import { ResultsPanel } from './client/results-panel.tsx';

export default function contribute(client: PluginClientContext) {
  const removePanel = client.addWorkspacePanel({ id: 'navigation', title: 'Refs', icon: 'Search', context: 'workspace', locations: ['explorer'], Component: ResultsPanel });
  function Installer(props: PluginSidebarItemProps) {
    return <NativeInstaller {...props} openResults={workspaceId => client.openPanel('navigation', { workspaceId, location: 'explorer' })} />;
  }
  const remove = client.addSidebarFooterItem({ id: 'native-navigation', title: 'Native code navigation', Component: Installer });
  return async () => { await disposeNative(); remove(); removePanel(); };
}
