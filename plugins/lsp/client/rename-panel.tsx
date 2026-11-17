import { useSyncExternalStore } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { PluginWorkspacePanelProps } from '@getpaseo/plugin/client';
import { getRenamePreview, subscribeRename } from './rename-preview.ts';
import { renameDiff } from './rename.ts';

export function RenamePanel({ host, workspaceId, theme, layout }: PluginWorkspacePanelProps) {
  const files = useSyncExternalStore(subscribeRename, () => getRenamePreview(host.id, workspaceId));
  const colors = theme.colors;
  return <ScrollView style={{ flex: 1, backgroundColor: colors.surface0 }} contentContainerStyle={{ padding: layout.compact ? 8 : 16 }}>
    <Text style={{ color: colors.foreground, fontSize: 18, marginBottom: 12 }}>Proposed rename</Text>
    {!files && <Text style={{ color: colors.foregroundMuted }}>No rename is awaiting confirmation.</Text>}
    {files?.map(file => <View key={file.path} style={{ marginBottom: 20 }}>
      <Text selectable style={{ color: colors.foreground, fontWeight: 'bold', marginBottom: 8 }}>{file.path}</Text>
      {renameDiff(file).map((hunk, index) => <View key={index} style={{ marginBottom: 12 }}>
        <Text selectable style={{ color: colors.foregroundMuted }}>Line {hunk.line}</Text>
        <Text selectable style={{ color: '#d86464', fontFamily: 'monospace' }}>{hunk.before.split('\n').map(line => `− ${line}`).join('\n')}</Text>
        <Text selectable style={{ color: '#42a96b', fontFamily: 'monospace' }}>{hunk.after.split('\n').map(line => `+ ${line}`).join('\n')}</Text>
      </View>)}
    </View>)}
  </ScrollView>;
}
