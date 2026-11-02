import type { PluginServerContext } from '@getpaseo/plugin/server';
import { lookup, release, inspect } from './shared/contracts.ts';
import { Languages } from './server/languages.ts';

export default function contribute(server: PluginServerContext) {
  const languages = new Languages();
  server.handle(lookup, async ({ workspaceId, editorId, path, kind, position, buffers }, { paseo }) => {
    const workspace = await paseo.workspaces.ref(workspaceId).refresh();
    if (!workspace) throw new Error('Workspace is unavailable.');
    return languages.lookup(workspace.workspaceDirectory, editorId, path, buffers, position, kind);
  });
  server.handle(inspect, async ({ workspaceId, editorId, path, buffers, position, kind }, { paseo }) => {
    const workspace = await paseo.workspaces.ref(workspaceId).refresh();
    if (!workspace) throw new Error('Workspace is unavailable.');
    return languages.inspect(workspace.workspaceDirectory, editorId, path, buffers, position, kind);
  });
  server.handle(release, async ({ workspaceId, editorId }, { paseo }) => {
    const workspace = await paseo.workspaces.ref(workspaceId).refresh();
    if (workspace) await languages.release(workspace.workspaceDirectory, editorId);
    return {};
  });
  return () => languages.dispose();
}
