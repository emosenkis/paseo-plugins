import { useSyncExternalStore } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { PluginWorkspacePanelProps } from '@getpaseo/plugin/client';
import { getResults, getHistory, subscribeResults } from './results.ts';

export function ResultsPanel({ host, workspaceId, theme, layout }: PluginWorkspacePanelProps) {
  const result = useSyncExternalStore(subscribeResults, () => getResults(host.id, workspaceId));
  const history = useSyncExternalStore(subscribeResults, () => getHistory(host.id, workspaceId));
  const colors = theme.colors;
  return <View style={{ flex: 1, backgroundColor: colors.surface0, padding: layout.compact ? 8 : 12 }}>
    {history && <View style={{ marginBottom: 12 }}>
      <Text style={{ color: colors.foreground, marginBottom: 8 }}>Jump history</Text>
      <View style={{ flexDirection: 'row', gap: 12, marginBottom: 8 }}>
        {([-1, 1] as const).map(direction => {
          const index = history.index + direction, disabled = index < 0 || index >= history.targets.length;
          return <Pressable key={direction} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
            onPress={() => history.open(index)} style={{ padding: 6, opacity: disabled ? 0.4 : 1 }}>
            <Text style={{ color: colors.foreground }}>{direction < 0 ? '← Back (Alt+Left)' : 'Forward (Alt+Right) →'}</Text>
          </Pressable>;
        })}
      </View>
    </View>}
    {result && <Text style={{ color: colors.foreground, marginBottom: 8 }} selectable>{result.title}</Text>}
    <Text accessibilityLiveRegion="polite" style={{ color: colors.foregroundMuted, marginBottom: 8 }} selectable>
      {result?.status ?? 'Use F12 for definition or Shift+F12 for usages in a file editor.'}
    </Text>
    <ScrollView style={{ flex: 1 }}>
      {history?.targets.map((target, index) => <Pressable key={`history-${index}`} accessibilityRole="button"
        accessibilityState={{ selected: index === history.index }} onPress={() => history.open(index)}
        style={{ padding: 8, marginBottom: 4, borderRadius: 4, backgroundColor: index === history.index ? colors.surface2 : colors.surface1 }}>
        <Text style={{ color: colors.foreground }}>{index === history.index ? '● ' : ''}{target.path}:{target.range.start.line + 1}:{target.range.start.character + 1}</Text>
      </Pressable>)}
      {result?.targets.map((target, index) => <Pressable key={index} accessibilityRole="button"
        accessibilityLabel={`${target.path}, line ${target.range.start.line + 1}, column ${target.range.start.character + 1}`}
        onPress={() => result.open(target)}
        style={({ pressed }) => ({ padding: 8, marginBottom: 4, borderWidth: 1, borderColor: colors.border, borderRadius: 4, backgroundColor: pressed ? colors.surface2 : colors.surface1 })}>
        <Text style={{ color: colors.foreground }}>{target.path}</Text>
        <Text style={{ color: colors.foregroundMuted }}>Line {target.range.start.line + 1}, column {target.range.start.character + 1}</Text>
      </Pressable>)}
    </ScrollView>
  </View>;
}
