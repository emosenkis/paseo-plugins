import { useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import { useRpc, type PluginSidebarItemProps } from '@getpaseo/plugin/client';
import { useToast } from '@getpaseo/plugin/client/react-native';
import { lookup, release, inspect, rename } from '../shared/contracts.ts';
import { Intelligence } from './intelligence.ts';
import { NativeNavigation } from './native.ts';

const adapters = new Map<string, { navigation: NativeNavigation; intelligence: Intelligence }>();
export function NativeInstaller({ host, theme, openResults, openDiff }: PluginSidebarItemProps & { openResults(workspaceId: string): void; openDiff(workspaceId: string): void }) {
  const toast = useToast();
  const notify = useMemo(() => (message: string, error = false) => { if (error) toast.error(message); else toast.show(message); }, [toast]);
  const find = useRpc(lookup), close = useRpc(release), analyze = useRpc(inspect), changeName = useRpc(rename);
  const api = useMemo(() => ({ lookup: find, release: close, inspect: analyze, rename: changeName }), [find, close, analyze, changeName]);
  const current = useRef<{ navigation: NativeNavigation; intelligence: Intelligence } | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const adapter = { navigation: new NativeNavigation(api, host.id, openResults, notify, openDiff), intelligence: new Intelligence(api, host.id, `assist-${Date.now()}-${Math.random().toString(36).slice(2)}`, theme.colors, notify) }; adapter.navigation.colors = theme.colors; adapters.set(host.id, adapter); current.current = adapter;
    return () => { if (adapters.get(host.id) === adapter) adapters.delete(host.id); current.current = null; void Promise.all([adapter.navigation.dispose(), adapter.intelligence.dispose()]); };
  }, [host.id]);
  useEffect(() => { if (current.current) current.current.navigation.colors = theme.colors; current.current?.navigation.update(api, notify); current.current?.intelligence.update(api, theme.colors, notify); }, [api, notify, theme]);
  return null;
}
export async function disposeNative() { const all = [...adapters.values()]; adapters.clear(); await Promise.all(all.flatMap(adapter => [adapter.navigation.dispose(), adapter.intelligence.dispose()])); }
