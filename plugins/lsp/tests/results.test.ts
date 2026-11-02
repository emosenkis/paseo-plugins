import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendHistory, getHistory, setHistory, clearResults, getResults, setResults, subscribeResults } from '../client/results.ts';

test('navigation panels isolate hosts/workspaces, retain results and release subscriptions on cleanup', () => {
  let notifications = 0;
  const unsubscribe = subscribeResults(() => notifications++);
  const first = { title: 'Usages: a.py:1', status: '0 usage result(s).', targets: [], open() {} };
  const second = { ...first, title: 'Definition: b.py:2' };
  try {
    setResults('host-a', 'workspace-a', first);
    setResults('host-a', 'workspace-b', second);
    setResults('host-b', 'workspace-a', second);
    assert.equal(getResults('host-a', 'workspace-a'), first);
    assert.equal(getResults('host-a', 'workspace-b'), second);
    assert.equal(getResults('host-a', 'missing'), undefined);
    clearResults('host-a');
    assert.equal(getResults('host-a', 'workspace-a'), undefined);
    assert.equal(getResults('host-a', 'workspace-b'), undefined);
    assert.equal(getResults('host-b', 'workspace-a'), second);
    assert.equal(notifications, 4);
    unsubscribe();
    clearResults('host-b');
    assert.equal(notifications, 4);
  } finally { unsubscribe(); clearResults('host-a'); clearResults('host-b'); }
});


test('history retains origins, deduplicates adjacent locations and replaces the forward trail', () => {
  const target = (path: string) => ({ path, range: { start: { line: 2, character: 3 }, end: { line: 2, character: 8 } } });
  const a = target('a.ts'), b = target('b.ts'), c = target('c.ts'), d = target('d.ts');
  const open = () => {};
  let history = appendHistory(undefined, a, b, open);
  assert.deepEqual(history.targets, [a, b]);
  history = appendHistory(history, b, c, open);
  assert.deepEqual(history.targets, [a, b, c]);
  history = appendHistory({ ...history, index: 0 }, a, d, open);
  assert.deepEqual(history.targets, [a, d]);
  assert.equal(history.index, 1);
  assert.equal(appendHistory(history, d, d, open).targets.length, 2);
  setHistory('history-host', 'one', history);
  assert.equal(getHistory('history-host', 'one'), history);
  assert.equal(getHistory('history-host', 'two'), undefined);
  clearResults('history-host');
  assert.equal(getHistory('history-host', 'one'), undefined);
});
