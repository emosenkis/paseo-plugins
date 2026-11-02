import { createElement, createContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { NativeNavigation, nativeEditors } from '../client/native.ts';
import { Intelligence } from '../client/intelligence.ts';
import { getResults, getHistory, subscribeResults } from '../client/results.ts';
import type { EditorApi } from '../shared/contracts.ts';

const workspaceId = new URL(location.href).searchParams.get('workspaceId');
if (!workspaceId) throw new Error('Missing workspaceId');
const hostId = 'native-browser-proof';
const base = 'plugins/lsp/tests/fixtures/';
let nextResponse: Awaited<ReturnType<EditorApi['lookup']>> | Error | undefined;
const openedPanels: string[] = [];
const notices: { message: string; error?: boolean }[] = [];
let inspectOverride: EditorApi['inspect'] | undefined;
const api: EditorApi = {
  inspect: input => inspectOverride ? inspectOverride(input) : call('inspect', input),
  lookup: input => {
    const response = nextResponse; nextResponse = undefined;
    return response instanceof Error ? Promise.reject(response) : response ? Promise.resolve(response) : call('lookup', input);
  }, release: input => call('release', input),
};
async function call(method: string, input: unknown) {
  const response = await fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, input }) });
  const body = await response.json(); if (!response.ok) throw new Error(body.error); return body;
}
const Pane = createContext<unknown>(null);
const opened: string[] = [];
function HostEditor({ path, line }: { path: string; line: number }) {
  const parent = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  useEffect(() => {
    let stopped = false;
    void fetch('/fixtures/' + path.split('/').at(-1)).then(response => response.text()).then(text => {
      if (stopped) return;
      const editor = new EditorView({ parent: parent.current!, state: EditorState.create({ doc: text }) }); view.current = editor;
      const row = editor.state.doc.line(Math.min(line, editor.state.doc.lines)); editor.dispatch({ selection: { anchor: row.from } });
    });
    return () => { stopped = true; view.current?.destroy(); };
  }, [path]);
  return createElement('div', { ref: parent, 'data-testid': 'file-source-editor', style: { height: '400px' } });
}
function NativeHost() {
  const [paths, setPaths] = useState([base + 'usage.py']);
  const [active, setActive] = useState(base + 'usage.py');
  const [line, setLine] = useState(1);
  function openFileInWorkspace(input: { location: { path: string; lineStart: number }; disposition: string }) {
    opened.push(input.location.path);
    setPaths(paths => paths.includes(input.location.path) ? paths : [...paths, input.location.path]); setActive(input.location.path); setLine(input.location.lineStart);
  }
  return createElement('div', null,
    createElement('nav', { 'aria-label': 'Native file tabs' }, paths.map(path => createElement('button', { key: path, onClick: () => setActive(path), 'aria-selected': active === path }, path))),
    paths.map(path => createElement(Pane.Provider, { key: path, value: { serverId: hostId, workspaceId, target: { kind: 'file', path }, openFileInWorkspace } },
      createElement('section', { style: { display: path === active ? 'block' : 'none' } }, createElement(HostEditor, { path, line })))),
  );
}
// Native-shaped host plus a DOM results consumer; production renders ResultsPanel through Paseo.
function Results() {
  const result = useSyncExternalStore(subscribeResults, () => getResults(hostId, workspaceId!));
  return createElement('aside', { 'data-navigation-results': '', 'aria-label': 'Navigation', style: { width: '320px' } },
    createElement('h2', null, 'Navigation'),
    createElement('div', { role: 'status' }, result?.status ?? 'No navigation yet'),
    result?.targets.map((target, index) => createElement('button', { key: index, onClick: () => result.open(target) }, `${target.path}:${target.range.start.line + 1}:${target.range.start.character + 1}`)));
}
const root = createRoot(document.getElementById('root')!);
root.render(createElement('div', { style: { display: 'flex' } }, createElement('main', { style: { flex: 1 } }, createElement(NativeHost)), createElement(Results)));
const adapter = new NativeNavigation(api, hostId, id => openedPanels.push(id), (message, error) => notices.push({ message, error }));
async function runChecks() {
  const assert = (value: unknown, detail: string) => { if (!value) throw new Error(detail); };
  const until = async (check: () => boolean, detail: string) => { const deadline = Date.now() + 15_000; while (!check()) { if (Date.now() > deadline) throw new Error(`Timed out: ${detail}`); await new Promise(resolve => setTimeout(resolve, 25)); } };
  const find = (suffix: string) => nativeEditors(hostId).find(binding => binding.path.endsWith(suffix));
  const status = () => document.querySelector('[data-navigation-results] [role=status]')?.textContent ?? '';
  const key = (view: EditorView, shift = false) => { const event = new KeyboardEvent('keydown', { key: 'F12', code: 'F12', keyCode: 123, shiftKey: shift, bubbles: true, cancelable: true }); view.contentDOM.dispatchEvent(event); return event.defaultPrevented; };
  const cursor = (view: EditorView, name: string) => { const offset = view.state.doc.toString().lastIndexOf(name); view.dispatch({ selection: { anchor: offset + 1 } }); view.focus(); };
  const selected = (suffix: string, word: string) => { const binding = find(suffix); return !!binding && binding.view.state.sliceDoc(binding.view.state.selection.main.from, binding.view.state.selection.main.to) === word; };
  const checks: string[] = [];
  await until(() => !!find('usage.py'), 'native editor mount');
  const usage = find('usage.py')!;
  cursor(usage.view, 'greet'); assert(key(usage.view), 'Native F12 not handled');
  await until(() => selected('symbol.py', 'greet'), 'native destination tab and selection');
  assert(opened.includes(base + 'symbol.py'), 'Did not use native openFileInWorkspace callback');
  checks.push('Python F12 opens a native tab and selects the symbol');
  const historyKey = (view: EditorView, key: string) => view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true }));
  const origin = usage.view.state.selection.main.head;
  assert(getHistory(hostId, workspaceId!)?.targets.length === 2, 'Missing origin/destination history');
  historyKey(find('symbol.py')!.view, 'ArrowLeft');
  await until(() => getHistory(hostId, workspaceId!)?.index === 0, 'history back');
  assert(usage.view.state.selection.main.head === origin, 'Back lost source caret');
  historyKey(usage.view, 'ArrowRight');
  await until(() => getHistory(hostId, workspaceId!)?.index === 1 && selected('symbol.py', 'greet'), 'history forward');
  checks.push('Alt+Left/Right restores source caret and destination selection');
  const side = (view: EditorView, button: number) => view.contentDOM.dispatchEvent(new MouseEvent('mousedown', { button, bubbles: true, cancelable: true }));
  side(find('symbol.py')!.view, 3);
  const release = () => { const event = new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true }); document.body.dispatchEvent(event); return event.defaultPrevented; };
  assert(release() && !release(), 'Side-button release outside the editor was not cancelled exactly once');
  await until(() => getHistory(hostId, workspaceId!)?.index === 0 && usage.view.state.selection.main.head === origin, 'mouse back');
  side(usage.view, 4);
  await until(() => getHistory(hostId, workspaceId!)?.index === 1 && selected('symbol.py', 'greet'), 'mouse forward');
  checks.push('mouse side buttons travel history');
  if (/Mac|iPhone|iPad/.test(navigator.platform)) {
    const minus = (view: EditorView, shiftKey: boolean) => view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: shiftKey ? '_' : '-', code: 'Minus', ctrlKey: true, shiftKey, bubbles: true, cancelable: true }));
    minus(find('symbol.py')!.view, false);
    await until(() => getHistory(hostId, workspaceId!)?.index === 0 && usage.view.state.selection.main.head === origin, 'Ctrl+- back');
    minus(usage.view, true);
    await until(() => getHistory(hostId, workspaceId!)?.index === 1 && selected('symbol.py', 'greet'), 'Ctrl+Shift+- forward');
    checks.push('Ctrl+- / Ctrl+Shift+- travel history on macOS');
  }

  const symbol = find('symbol.py')!;
  cursor(symbol.view, 'greet'); key(symbol.view, true);
  await until(() => status().includes('2 usage'), 'native Python usages');
  const result = [...document.querySelectorAll<HTMLButtonElement>('[data-navigation-results] button')].find(button => button.textContent?.endsWith('usage.py:2:11'))!;
  assert(result, 'Missing usage result'); result.click();
  await until(() => selected('usage.py', 'greet'), 'usage result native tab');
  checks.push('Shift+F12 and usage result use native tabs');
  const change = (view: EditorView, text: string) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  const symbolText = symbol.view.state.sliceDoc(), usageText = usage.view.state.sliceDoc();
  try {
    change(symbol.view, '\n' + symbolText.replaceAll('greet', 'welcome')); change(usage.view, usageText.replaceAll('greet', 'welcome'));
    cursor(usage.view, 'welcome'); key(usage.view);
    await until(() => selected('symbol.py', 'welcome'), 'unsaved native Python buffers');
    assert(symbol.view.state.doc.lineAt(symbol.view.state.selection.main.from).number === 2, 'Ignored unsaved target line');
    checks.push('unsaved Python symbols across native buffers');
  } finally { change(symbol.view, symbolText); change(usage.view, usageText); }
  const focusUsage = async () => { [...document.querySelectorAll<HTMLButtonElement>('nav button')].find(button => button.textContent === usage.path)!.click(); await until(() => usage.element.getClientRects().length > 0, 'native usage tab visibility'); };
  await focusUsage();
  const context = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  usage.view.contentDOM.dispatchEvent(context);
  assert(!context.defaultPrevented, 'Replaced native context menu');
  checks.push('native context menu is left untouched');
  await focusUsage(); symbol.view.dispatch({ selection: { anchor: 0 } }); cursor(usage.view, 'greet');
  const click = usage.view.coordsAtPos(usage.view.state.selection.main.head)!;
  usage.view.contentDOM.dispatchEvent(new MouseEvent('mousedown', { clientX: click.left, clientY: (click.top + click.bottom) / 2, metaKey: true, button: 0, bubbles: true, cancelable: true }));
  await until(() => selected('symbol.py', 'greet'), 'Cmd-click native definition');
  checks.push('Cmd-click on native editor');
  assert(openedPanels.length === 1 && openedPanels.every(id => id === workspaceId), 'Navigation did not open the workspace results panel');
  assert(!document.querySelector('[data-editor-navigation]'), 'Floating navigation popup remains');
  checks.push('only multiple results select the navigation panel');
  nextResponse = { targets: [], omitted: 0 };
  cursor(symbol.view, 'greet'); key(symbol.view, true);
  await until(() => status().includes('0 usage'), 'empty results in panel');
  nextResponse = new Error('Config probe error'); key(symbol.view, true);
  await until(() => status().includes('Config probe error'), 'errors in panel');
  assert(!document.querySelector('[data-navigation-results] button'), 'Old results survived a failed lookup');
  assert(openedPanels.length === 1, 'Empty results or errors selected navigation panel');
  assert(notices.at(-2)?.message.includes('No usages') && notices.at(-1)?.error, 'Missing empty/error butter bars');
  checks.push('empty results and errors show notices without selecting the panel');
  nextResponse = { targets: [{ path: symbol.path, range: { start: { line: 0, character: 4 }, end: { line: 0, character: 9 } } }], omitted: 0 };
  cursor(usage.view, 'greet'); key(usage.view, true);
  await until(() => selected('symbol.py', 'greet'), 'single usage opens directly');
  assert(openedPanels.length === 1, 'Single usage selected navigation panel');
  const alien = document.createElement('div'); alien.setAttribute('data-testid', 'file-source-editor'); document.body.append(alien);
  const standalone = new EditorView({ parent: alien, state: EditorState.create({ doc: 'greet()' }) });
  assert(!key(standalone), 'Intercepted editor without a matching host pane'); standalone.destroy(); alien.remove();
  checks.push('unrecognized editors are left untouched');
  await adapter.dispose(); assert(!key(usage.view), 'Listeners survived plugin cleanup');
  checks.push('cleanup removes injected listeners');
  return checks;
}
async function signatureChecks() {
  const binding = nativeEditors(hostId).find(item => item.path.endsWith('usage.py'))!;
  const original = binding.view.state.sliceDoc();
  // Paseo's automated webview runs in the background; simulate the document focus gate only.
  const focusDescriptor = Object.getOwnPropertyDescriptor(document, 'hasFocus');
  Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true });
  const intelligence = new Intelligence(api, hostId, 'signature-browser-proof', { surface0: '#17191e', foreground: '#e7e9ee', border: '#454b59', accent: '#8eb5ff' }, () => {});
  const until = async (check: () => boolean, detail: string) => { const end = Date.now() + 15_000; while (!check()) { if (Date.now() > end) throw new Error(detail); await new Promise(resolve => setTimeout(resolve, 50)); } };
  const active = () => document.querySelector('[data-active-parameter]')?.textContent ?? '';
  const tip = () => document.querySelector<HTMLElement>('[data-lsp-tooltip]')!;
  const invoke = () => binding.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  try {
    const text = 'def greet(name: str, count: int) -> str:\n    return name * count\nresult = greet("Ada", 2)\n';
    binding.view.dispatch({ changes: { from: 0, to: binding.view.state.doc.length, insert: text }, selection: { anchor: text.lastIndexOf(', 2') + 2 } }); binding.view.focus();
    await until(() => active().includes('count'), 'No active second parameter');
    if (!tip().querySelector('[data-active-parameter] [class*=tok-]')) throw new Error('Active signature argument not syntax highlighted');
    if (getComputedStyle(tip()).fontFamily !== getComputedStyle(binding.view.contentDOM).fontFamily) throw new Error('Signature font differs from editor');
    binding.view.dispatch({ selection: { anchor: text.lastIndexOf('greet(') + 6 } });
    await until(() => active().includes('name'), 'Signature did not update for first parameter');
    binding.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (tip().style.display !== 'none') throw new Error('Escape did not dismiss signature');
    await new Promise(resolve => setTimeout(resolve, 700));
    if (tip().style.display !== 'none') throw new Error('Dismissed signature reappeared');
    invoke(); await until(() => tip().style.display !== 'none' && active().includes('name'), 'Explicit signature invocation failed');
    let finish: ((value: Awaited<ReturnType<EditorApi['inspect']>>) => void) | undefined;
    inspectOverride = input => input.kind === 'signature' && !finish ? new Promise(resolve => { finish = resolve; }) : call('inspect', input);
    invoke(); await until(() => !!finish, 'No delayed signature request');
    binding.view.dispatch({ selection: { anchor: 0 } });
    finish!({ diagnostics: [], signature: { label: 'STALE', index: 0, count: 1 } });
    await new Promise(resolve => setTimeout(resolve, 700));
    if (tip().style.display !== 'none') throw new Error('Stale signature survived cursor movement');
    return ['automatic call signature and active argument', 'cursor changes update active argument', 'Escape dismisses without reopening', 'Ctrl+Shift+Space invokes signature', 'late signatures are discarded'];
  } finally { if (focusDescriptor) Object.defineProperty(document, 'hasFocus', focusDescriptor); else Reflect.deleteProperty(document, 'hasFocus'); inspectOverride = undefined; await intelligence.dispose(); binding.view.dispatch({ changes: { from: 0, to: binding.view.state.doc.length, insert: original }, selection: { anchor: 0 } }); }
}
async function hoverChecks() {
  const binding = nativeEditors(hostId).find(item => item.path.endsWith('usage.py'))!;
  const original = binding.view.state.sliceDoc();
  const intelligence = new Intelligence(api, hostId, 'hover-browser-proof', { surface0: '#17191e', foreground: '#e7e9ee', border: '#454b59', accent: '#8eb5ff' }, () => {});
  const until = async (check: () => boolean, detail: string) => { const end = Date.now() + 15_000; while (!check()) { if (Date.now() > end) throw new Error(detail); await new Promise(resolve => setTimeout(resolve, 50)); } };
  try {
    binding.view.dispatch({ changes: { from: 0, to: binding.view.state.doc.length, insert: 'value: int = 1\n' } });
    await new Promise(resolve => setTimeout(resolve, 750));
    const coords = binding.view.coordsAtPos(2)!;
    binding.view.contentDOM.dispatchEvent(new MouseEvent('mousemove', { clientX: coords.left, clientY: (coords.top + coords.bottom) / 2, bubbles: true }));
    await until(() => !!document.querySelector('[data-lsp-tooltip]')?.textContent?.includes('value'), 'No Python type hover');
    const tooltip = document.querySelector<HTMLElement>('[data-lsp-tooltip]')!;
    if (tooltip.querySelector('script, iframe, img')) throw new Error('Hover rendered server HTML');
    if (getComputedStyle(tooltip).fontFamily !== getComputedStyle(binding.view.contentDOM).fontFamily) throw new Error('Tooltip did not inherit editor font');
    const tokens = [...tooltip.querySelectorAll<HTMLElement>('[class*="tok-"]')];
    if (!tokens.some(token => getComputedStyle(token).color !== getComputedStyle(tooltip).color)) throw new Error('Python hover not syntax highlighted');
    intelligence.update(api, { surface0: '#fff', foreground: '#151515', border: '#ccc', accent: '#2255bb' }, () => {});
    binding.view.contentDOM.dispatchEvent(new MouseEvent('mousemove', { clientX: coords.left, clientY: (coords.top + coords.bottom) / 2, bubbles: true }));
    await until(() => tooltip.style.display !== 'none' && !!tooltip.querySelector('[class*="tok-"]'), 'Light theme tooltip failed');
    if (getComputedStyle(tooltip).color !== 'rgb(21, 21, 21)') throw new Error('Tooltip theme did not update');
    inspectOverride = async input => input.kind === 'hover' ? { diagnostics: [], hover: [{ text: '<img src=x onerror=alert(1)>', language: 'python' }] } : call('inspect', input);
    binding.view.contentDOM.dispatchEvent(new MouseEvent('mousemove', { clientX: coords.left, clientY: (coords.top + coords.bottom) / 2, bubbles: true }));
    await until(() => !!tooltip.textContent?.includes('<img'), 'Missing hostile hover probe');
    if (tooltip.querySelector('img')) throw new Error('Highlighted hover executed server markup');
    inspectOverride = undefined;
    binding.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (tooltip.style.display !== 'none') throw new Error('Escape did not dismiss hover');
    return ['Python hover shows type information', 'tooltip inherits monospace editor font', 'Python syntax highlighting', 'light theme highlighting', 'server HTML remains literal text', 'Escape dismisses hover'];
  } finally { inspectOverride = undefined; await intelligence.dispose(); binding.view.dispatch({ changes: { from: 0, to: binding.view.state.doc.length, insert: original } }); }
}
async function diagnosticsChecks() {
  const until = async (check: () => boolean, detail: string) => { const end = Date.now() + 15_000; while (!check()) { if (Date.now() > end) throw new Error(detail); await new Promise(resolve => setTimeout(resolve, 50)); } };
  let current = nativeEditors(hostId).find(binding => binding.path.endsWith('usage.py'));
  await until(() => !!(current = nativeEditors(hostId).find(binding => binding.path.endsWith('usage.py'))), 'Missing Python editor');
  const binding = current!;
  const original = binding.view.state.sliceDoc();
  const errors: string[] = [];
  const intelligence = new Intelligence(api, hostId, 'diagnostics-browser-proof', { surface0: '#17191e', foreground: '#e7e9ee', border: '#454b59', accent: '#8eb5ff' }, message => errors.push(message));
  const highlights = () => [...CSS.highlights.entries()].filter(([name]) => name.startsWith('paseo-lsp-'));
  const count = () => highlights().reduce((sum, [, highlight]) => sum + highlight.size, 0);
  try {
    binding.view.dispatch({ changes: { from: 0, to: binding.view.state.doc.length, insert: 'value: int = "wrong"\n' } });
    await until(() => count() > 0, 'No squiggle for unsaved Python type error: ' + errors.join(';'));
    const line = binding.view.state.doc.line(1);
    const coords = binding.view.coordsAtPos(line.to - 3)!;
    binding.view.contentDOM.dispatchEvent(new MouseEvent('mousemove', { clientX: coords.left, clientY: (coords.top + coords.bottom) / 2, bubbles: true }));
    await until(() => !!document.querySelector<HTMLElement>('[data-lsp-tooltip]')?.textContent?.includes('Error'), 'Missing diagnostic mouseover');
    const tooltip = document.querySelector<HTMLElement>('[data-lsp-tooltip]')!;
    if (tooltip.style.display === 'none') throw new Error('Diagnostic tooltip hidden');
    binding.view.dispatch({ changes: { from: 0, to: binding.view.state.doc.length, insert: 'value: int = 1\n' } });
    await until(() => count() === 0, 'Old squiggle survived correction');
    if (binding.view.state.sliceDoc() !== 'value: int = 1\n') throw new Error('Highlights modified native text');
    await intelligence.dispose();
    if (highlights().length || document.querySelector('[data-lsp-tooltip]')) throw new Error('Diagnostic UI survived cleanup');
    return ['unsaved Python diagnostics render squiggles', 'diagnostic mouseover', 'correction clears stale diagnostics', 'highlights preserve native text', 'diagnostic cleanup'];
  } finally {
    await intelligence.dispose(); binding.view.dispatch({ changes: { from: 0, to: binding.view.state.doc.length, insert: original } });
  }
}
Object.assign(window, { proof: { runChecks, diagnosticsChecks, hoverChecks, signatureChecks, dispose: async () => { await adapter.dispose(); root.unmount(); } } });
