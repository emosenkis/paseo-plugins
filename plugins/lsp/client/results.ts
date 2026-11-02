import type { Target } from '../shared/contracts.ts';

export type NavigationResults = { title: string; status: string; targets: Target[]; open(target: Target): void };
export type NavigationHistory = { targets: Target[]; index: number; open(index: number): void };
const histories = new Map<string, NavigationHistory>();
export function getHistory(hostId: string, workspaceId: string) { return histories.get(key(hostId, workspaceId)); }
export function setHistory(hostId: string, workspaceId: string, value: NavigationHistory) {
  histories.set(key(hostId, workspaceId), value);
  for (const listener of listeners) listener();
}
export function appendHistory(history: NavigationHistory | undefined, source: Target, target: Target, open: NavigationHistory['open']): NavigationHistory {
  const targets = history ? history.targets.slice(0, history.index + 1) : [];
  for (const entry of [source, target]) {
    if (JSON.stringify(targets.at(-1)) !== JSON.stringify(entry)) targets.push(entry);
  }
  return { targets, index: targets.length - 1, open };
}
const results = new Map<string, NavigationResults>();
const listeners = new Set<() => void>();
const key = (hostId: string, workspaceId: string) => JSON.stringify([hostId, workspaceId]);
export function getResults(hostId: string, workspaceId: string) { return results.get(key(hostId, workspaceId)); }
export function subscribeResults(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function setResults(hostId: string, workspaceId: string, value: NavigationResults) {
  results.set(key(hostId, workspaceId), value);
  for (const listener of listeners) listener();
}
export function clearResults(hostId: string) {
  for (const entry of histories.keys()) if (JSON.parse(entry)[0] === hostId) histories.delete(entry);
  for (const entry of results.keys()) if (JSON.parse(entry)[0] === hostId) results.delete(entry);
  for (const listener of listeners) listener();
}
