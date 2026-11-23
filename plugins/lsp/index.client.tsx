import type { PluginClientContext, PluginSidebarItemProps } from '@getpaseo/plugin/client';
import { NativeInstaller, disposeNative } from './client/native-installer.tsx';
import { restart, approveDiffCommands } from './shared/contracts.ts';
import { ResultsPanel } from './client/results-panel.tsx';
import { RenamePanel } from './client/rename-panel.tsx';
import { confirmDiffCommands } from './client/web.ts';

export default function contribute(client: PluginClientContext) {
  const removeApproval = client.addCommandCenterItem({
    id: 'approve-diff-lsp', title: 'Approve LSP commands for diffs', icon: 'ShieldCheck', context: 'workspace',
    async onSelect({ workspace, rpc }) {
      const { snapshot } = await rpc(approveDiffCommands, { workspaceId: workspace.id });
      if (confirmDiffCommands(workspace.title ?? workspace.id, snapshot)) {
        await rpc(approveDiffCommands, { workspaceId: workspace.id, approved: snapshot });
      }
    },
  });
  const removeRestart = client.addCommandCenterItem({
    id: 'restart-lsp', title: 'Restart LSP servers', icon: 'RotateCw', context: 'workspace',
    async onSelect({ workspace, rpc }) { await rpc(restart, { workspaceId: workspace.id }); },
  });
  const removePanel = client.addWorkspacePanel({ id: 'navigation', title: 'Refs', icon: 'Search', context: 'workspace', locations: ['explorer'], Component: ResultsPanel });
  const removeRename = client.addWorkspacePanel({ id: 'rename-diff', title: 'Rename diff', icon: 'FileDiff', context: 'workspace', locations: ['workspace'], Component: RenamePanel });
  function Installer(props: PluginSidebarItemProps) {
    return <NativeInstaller {...props} openResults={workspaceId => client.openPanel('navigation', { workspaceId, location: 'explorer' })} openDiff={workspaceId => client.openPanel('rename-diff', { workspaceId, location: 'workspace' })} />;
  }
  const remove = client.addSidebarFooterItem({ id: 'native-navigation', title: 'Native code navigation', Component: Installer });
  return async () => { await disposeNative(); remove(); removePanel(); removeRename(); removeRestart(); removeApproval(); };
}
