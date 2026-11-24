import { useState, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { PluginWorkspacePanelProps } from '@getpaseo/plugin/client';
import type { Target } from '../shared/contracts.ts';
import { getResults, getHistory, subscribeResults } from './results.ts';

export function ResultsPanel({ host, workspaceId, theme, layout }: PluginWorkspacePanelProps) {
  const result = useSyncExternalStore(subscribeResults, () => getResults(host.id, workspaceId));
  const history = useSyncExternalStore(subscribeResults, () => getHistory(host.id, workspaceId));
  const colors = theme.colors;
  const [showHistory, setShowHistory] = useState(false);
  const [selection, setSelection] = useState<{ result: typeof result; target: Target }>();
  return <View style={{ flex: 1, backgroundColor: colors.surface0, padding: layout.compact ? 8 : 12 }}>
    {result && <Text style={{ color: colors.foreground, marginBottom: 8, fontWeight: '600' }} selectable>{result.title}</Text>}
    {result?.source && <Text selectable style={{ color: colors.foregroundMuted, marginBottom: 8 }}>From {result.source}</Text>}
    <Text accessibilityLiveRegion="polite" style={{ color: colors.foregroundMuted, marginBottom: 8 }} selectable>
      {result?.status ?? 'Use F12 for definition or Shift+F12 for references in a file editor.'}
    </Text>
    <ScrollView style={{ flex: 1 }}>
      {result?.targets.map((target, index) => <Pressable key={index} accessibilityRole="button"
        accessibilityLabel={`${target.path}, line ${target.range.start.line + 1}, column ${target.range.start.character + 1}`}
        accessibilityState={{ selected: selection?.result === result && selection.target === target }}
        onPress={() => { setSelection({ result, target }); result.open(target); }}
        style={({ pressed }) => ({ padding: 8, marginBottom: 4, borderWidth: 1, borderColor: colors.border, borderRadius: 4, backgroundColor: pressed || (selection?.result === result && selection.target === target) ? colors.surface2 : colors.surface1 })}>
        <Text style={{ color: colors.foreground }}>{target.path}</Text>
        <Text style={{ color: colors.foregroundMuted }}>Line {target.range.start.line + 1}, column {target.range.start.character + 1}</Text>
      </Pressable>)}
    </ScrollView>
    <View style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 8, marginTop: 8 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {([-1, 1] as const).map(direction => {
          const index = (history?.index ?? -1) + direction;
          const disabled = !history || index < 0 || index >= history.targets.length;
          return <Pressable key={direction} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
            accessibilityLabel={direction < 0 ? 'Back' : 'Forward'}
            onPress={() => history?.open(index)} style={{ padding: 6, opacity: disabled ? 0.4 : 1 }}>
            <Text style={{ color: colors.foreground }}>{direction < 0 ? '← Back' : 'Forward →'}</Text>
          </Pressable>;
        })}
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: showHistory }}
          onPress={() => setShowHistory(!showHistory)} style={{ padding: 6 }}>
          <Text style={{ color: colors.foreground }}>{showHistory ? 'Hide' : 'Show'} jump history ({history?.targets.length ?? 0})</Text>
        </Pressable>
      </View>
      {showHistory && <ScrollView style={{ maxHeight: 180 }}>
        <Text style={{ color: colors.foregroundMuted, padding: 8 }}>Visited locations · {(history?.index ?? -1) + 1} of {history?.targets.length ?? 0}</Text>
        {history?.targets.map((target, index) => <Pressable key={index} accessibilityRole="button"
          accessibilityState={{ selected: index === history.index }} onPress={() => history.open(index)}
          style={{ padding: 8, marginBottom: 4, borderRadius: 4, backgroundColor: index === history.index ? colors.surface2 : colors.surface1 }}>
          <Text style={{ color: colors.foreground }}>{index + 1}. {index === history.index ? 'Current · ' : ''}{target.path}</Text>
          <Text style={{ color: colors.foregroundMuted }}>Line {target.range.start.line + 1}, column {target.range.start.character + 1}</Text>
        </Pressable>)}
      </ScrollView>}
    </View>
  </View>;
}
