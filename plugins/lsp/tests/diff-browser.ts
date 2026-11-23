import { createElement, createContext, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { getResults } from '../client/results.ts';
import { DiffIntelligence } from '../client/diff.ts';
import type { EditorApi, Target } from '../shared/contracts.ts';

const calls: string[] = [], opened: unknown[] = [];
const cell = (side: string) => ({ content: 'const message = greet("hi");', lineNumber: 2, sourceIdentity: { side }, fragments: [{ end: 28, graphemes: Array.from({ length: 28 }, (_, start) => ({ start, width: 10 })) }] });
const model = { viewportWidth: 800, lineHeight: 20, files: [{ path: 'usage.ts', top: 0, bodyTop: 20, bottom: 60, gutterWidth: 30, fileIndex: 0, isCollapsed: false, file: { hunks: [{ newStart: 2, newCount: 1 }] } }], rows: [{ kind: 'line', path: 'usage.ts', top: 20, height: 20, reviewHeight: 0, cells: [cell('old'), cell('new')] }] };
const rows = model.rows;
const Pane = createContext<unknown>(null);
function Surface(_props: { mode: { kind: string }; onToggleFile(path: string): void }) {
  useRef(model); useRef(new Map());
  return createElement('div', { 'data-testid': 'git-diff-canvas-root' },
    createElement('div', { 'data-testid': 'git-diff-scroll', tabIndex: 0 },
      createElement('div', { style: { position: 'relative', height: 100 } },
        createElement('canvas', { 'data-testid': 'git-diff-canvas', width: 800, height: 100, style: { position: 'absolute', pointerEvents: 'none' } }),
        createElement('div', { 'data-testid': 'diff-file-0-horizontal-scroll', style: { position: 'absolute', inset: 0, overflowX: 'auto', pointerEvents: 'auto' } },
          createElement('div', { style: { width: 900, height: 100 } })))));
}
createRoot(document.getElementById('root')!).render(createElement(Pane.Provider, { value: { serverId: 'proof', workspaceId: 'workspace', target: { kind: 'working_diff' }, openTab: () => { document.querySelector<HTMLElement>('[data-testid="git-diff-canvas-root"]')!.style.display = ''; }, openFileInWorkspace: (input: unknown) => opened.push(input) } }, createElement(Surface, { mode: { kind: 'working' }, onToggleFile: () => { model.files[0].isCollapsed = false; model.rows = rows; } })));
const target: Target = { path: 'symbol.ts', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } } };
let targets = [target];
const api: EditorApi = {
  inspect: async input => {
    calls.push(input.kind);
    if (input.path !== 'usage.ts' || input.position.line !== 1 || input.diffLine !== cell('new').content) throw new Error('Wrong diff coordinates');
    return input.kind === 'highlights' ? { diagnostics: [], highlights: [{ start: { line: 1, character: 0 }, end: { line: 1, character: 5 } }, { start: { line: 1, character: 16 }, end: { line: 1, character: 21 } }] } : input.kind === 'hover' ? { diagnostics: [], hover: [{ text: 'const message: string', language: 'typescript' }] } : { diagnostics: [], signature: { label: 'greet(name: string): string', parameter: [6, 18], index: 0, count: 1 } };
  },
  lookup: async input => { calls.push(input.kind); return { targets, omitted: 0 }; },
  release: async () => ({}), rename: async () => { throw new Error('Unexpected rename'); },
};
const adapter = new DiffIntelligence(api, 'proof', { surface0: '#222', foreground: '#fff', border: '#555', accent: '#acf' }, () => {}, message => { throw new Error(message); });
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
async function run() {
  await pause(200);
  const canvas = document.querySelector('canvas')!, scroll = canvas.closest<HTMLElement>('[data-testid="git-diff-scroll"]')!;
  const bounds = canvas.getBoundingClientRect();
  const hit = (x: number) => document.elementFromPoint(bounds.left + x, bounds.top + 25)!;
  const mouse = (x: number) => hit(x).dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: bounds.left + x, clientY: bounds.top + 25 }));
  assert(hit(450).parentElement?.dataset.testid === 'diff-file-0-horizontal-scroll', 'Fixture must hit the unwrapped diff horizontal-scroll spacer');
  mouse(50); await pause(350); assert(calls.length === 0, 'Old side inspected');
  mouse(450); await pause(350); assert(document.querySelector('[data-lsp-diff-tooltip]')?.textContent?.includes('message: string'), 'Hover missing');
  hit(450).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: bounds.left + 450, clientY: bounds.top + 25 }));
  await pause(50);
  const highlight = document.querySelector<HTMLElement>('[data-lsp-diff-selection]');
  assert(highlight?.querySelectorAll('[style*="border-radius"]').length === 2 && highlight.style.pointerEvents === 'none', 'Selected symbol highlight missing or intercepts clicks');
  assert((highlight!.firstElementChild!.firstElementChild as HTMLElement).style.width === '50px', 'Highlight must cover the clicked identifier');
  scroll.focus(); await pause(600); assert(document.querySelector('[data-active-parameter]'), 'Signature missing');
  scroll.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', bubbles: true, cancelable: true }));
  await pause(50); assert(opened.length === 1, 'Definition missing');
  scroll.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', shiftKey: true, bubbles: true, cancelable: true }));
  await pause(50); assert(calls.includes('references'), 'References missing');
  const inDiff: Target = { path: 'usage.ts', range: { start: { line: 1, character: 16 }, end: { line: 1, character: 21 } } };
  targets = [inDiff];
  scroll.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', bubbles: true, cancelable: true }));
  await pause(150);
  assert(opened.length === 2, 'An available diff line opened an editor');
  assert(document.activeElement === scroll, 'In-diff jump did not focus the diff');
  const selectedBox = document.querySelector('[data-lsp-diff-selection] [style*="border-radius"]') as HTMLElement | null;
  assert(selectedBox, 'In-diff destination lost its highlight');
  model.rows = []; model.files[0].isCollapsed = true;
  getResults('proof', 'workspace')!.open(inDiff); await pause(150);
  assert(!model.files[0].isCollapsed && opened.length === 2, 'Collapsed target did not expand in the diff');
  // The results panel must use the same routing, including editor fallback.
  getResults('proof', 'workspace')!.open(target); await pause(50);
  assert(opened.length === 3, 'Missing-line result did not fall back to editor');
  canvas.closest<HTMLElement>('[data-testid="git-diff-canvas-root"]')!.style.display = 'none';
  getResults('proof', 'workspace')!.open(inDiff); await pause(150);
  assert(opened.length === 3 && document.activeElement === scroll, 'Result click ignored an available diff line');
  scroll.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert(!document.querySelector('[data-lsp-diff-selection]'), 'Escape did not clear selection highlight');
  await adapter.dispose(); assert(!document.querySelector('[data-lsp-diff-tooltip]'), 'Tooltip leaked');
  return { passed: true, calls };
}
Object.assign(window, { proof: { run } });
