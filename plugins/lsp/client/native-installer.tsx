import { useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import { useRpc, type PluginSidebarItemProps } from '@getpaseo/plugin/client';
import { useToast } from '@getpaseo/plugin/client/react-native';
import { lookup, release, inspect } from '../shared/contracts.ts';
import { Intelligence } from './intelligence.ts';
import { NativeNavigation } from './native.ts';

const adapters = new Map<string, { navigation: NativeNavigation; intelligence: Intelligence }>();
export function NativeInstaller({ host, theme, openResults }: PluginSidebarItemProps & { openResults(workspaceId: string): void }) {
  const toast = useToast();
  const notify = useMemo(() => (message: string, error = false) => { if (error) toast.error(message); else toast.show(message); }, [toast]);
  const find = useRpc(lookup), close = useRpc(release), analyze = useRpc(inspect);
  const api = useMemo(() => ({ lookup: find, release: close, inspect: analyze }), [find, close, analyze]);
  const current = useRef<{ navigation: NativeNavigation; intelligence: Intelligence } | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const adapter = { navigation: new NativeNavigation(api, host.id, openResults, notify), intelligence: new Intelligence(api, host.id, `assist-${Date.now()}-${Math.random().toString(36).slice(2)}`, theme.colors, notify) }; adapters.set(host.id, adapter); current.current = adapter;
    return () => { if (adapters.get(host.id) === adapter) adapters.delete(host.id); current.current = null; void Promise.all([adapter.navigation.dispose(), adapter.intelligence.dispose()]); };
  }, [host.id]);
  useEffect(() => { current.current?.navigation.update(api, notify); current.current?.intelligence.update(api, theme.colors, notify); }, [api, notify, theme]);
  return null;
}
export async function disposeNative() { const all = [...adapters.values()]; adapters.clear(); await Promise.all(all.flatMap(adapter => [adapter.navigation.dispose(), adapter.intelligence.dispose()])); }
