// shortcut: Metro's private module wrapper can change; use a host completion API when available.
export function moduleIds(script: string, name: string) {
  const ids: number[] = [];
  for (const match of script.matchAll(/__d\(function\(/g)) {
    const start = match.index, end = script.indexOf('__d(function(', start + 1);
    const chunk = script.slice(start, end < 0 ? undefined : end);
    if (!chunk.includes(`"${name}"`)) continue;
    const id = chunk.match(/\}\s*,\s*(\d+)\s*,\s*\[[\d,]*\]\s*\);\s*$/)?.[1];
    if (id) ids.push(Number(id));
  }
  return ids;
}

