import type { RenameResult } from '../shared/contracts.ts';

const plans = new Map<string, RenameResult['files']>();
const listeners = new Set<() => void>();
const key = (host: string, workspace: string) => JSON.stringify([host, workspace]);
export function setRenamePreview(host: string, workspace: string, files?: RenameResult['files']) {
  if (files) plans.set(key(host, workspace), files); else plans.delete(key(host, workspace));
  for (const listener of listeners) listener();
}
export function subscribeRename(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function getRenamePreview(host: string, workspace: string) { return plans.get(key(host, workspace)); }
