import type { PluginServerContext } from '@getpaseo/plugin/server';
import { lookup, release, inspect, rename, restart } from './shared/contracts.ts';
import { diffBuffers } from './server/diff.ts';
import { Languages } from './server/languages.ts';

export default function contribute(server: PluginServerContext) {
  const languages = new Languages();
  server.handle(lookup, async ({ workspaceId, editorId, path, kind, position, buffers, diffLine }, { paseo }) => {
    const workspace = await paseo.workspaces.ref(workspaceId).refresh();
    if (!workspace) throw new Error('Workspace is unavailable.');
    return languages.lookup(workspace.workspaceDirectory, editorId, path, await diffBuffers(workspace.workspaceDirectory, path, buffers, position, diffLine), position, kind);
  });
  server.handle(inspect, async ({ workspaceId, editorId, path, buffers, position, kind, diffLine }, { paseo }) => {
    const workspace = await paseo.workspaces.ref(workspaceId).refresh();
    if (!workspace) throw new Error('Workspace is unavailable.');
    return languages.inspect(workspace.workspaceDirectory, editorId, path, await diffBuffers(workspace.workspaceDirectory, path, buffers, position, diffLine), position, kind);
  });
  server.handle(rename, async ({ workspaceId, editorId, path, buffers, position, newName }, { paseo }) => {
    const workspace = await paseo.workspaces.ref(workspaceId).refresh();
    if (!workspace) throw new Error('Workspace is unavailable.');
    return languages.rename(workspace.workspaceDirectory, editorId, path, buffers, position, newName);
  });
  server.handle(restart, async ({ workspaceId }, { paseo }) => {
    const workspace = await paseo.workspaces.ref(workspaceId).refresh();
    if (!workspace) throw new Error('Workspace is unavailable.');
    await languages.restart(workspace.workspaceDirectory);
    return {};
  });
  server.handle(release, async ({ workspaceId, editorId }, { paseo }) => {
    const workspace = await paseo.workspaces.ref(workspaceId).refresh();
    if (workspace) await languages.release(workspace.workspaceDirectory, editorId);
    return {};
  });
  return () => languages.dispose();
}
