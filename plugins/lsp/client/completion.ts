import type { EditorView } from '@codemirror/view';
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import source from './completion-source.js';
import { editorBuffers, nativeEditors, type Binding } from './native.ts';
import { positionOffset, type EditorApi } from '../shared/contracts.ts';

type Host = { EditorState: typeof import('@codemirror/state').EditorState; StateEffect: typeof import('@codemirror/state').StateEffect; Compartment: typeof import('@codemirror/state').Compartment; Prec: typeof import('@codemirror/state').Prec };
type ViewModule = typeof import('@codemirror/view');
type LanguageModule = typeof import('@codemirror/language');
type Runtime = { state: Host; view: ViewModule; language: LanguageModule; completion: typeof import('@codemirror/autocomplete') };

import { moduleIds } from './metro.ts';

async function hostRuntime(view: EditorView): Promise<Runtime> {
  const requireHost = (globalThis as typeof globalThis & { __r?: (id: number) => unknown }).__r;
  if (!requireHost) throw new Error('Paseo\'s CodeMirror module loader is unavailable.');
  let state: Host | undefined, hostView: ViewModule | undefined, language: LanguageModule | undefined;
  for (const script of document.querySelectorAll<HTMLScriptElement>('script[src]')) {
    const url = new URL(script.src, document.baseURI);
    if (url.origin !== location.origin) continue;
    const text = await fetch(url.href).then(response => { if (!response.ok) throw new Error('Cannot read Paseo application bundle.'); return response.text(); });
    for (const id of moduleIds(text, 'EditorState')) {
      const candidate = requireHost(id) as Host;
      if (candidate?.EditorState === view.state.constructor) { state = candidate; break; }
    }
    for (const id of moduleIds(text, 'EditorView')) {
      const candidate = requireHost(id) as ViewModule;
      if (candidate?.EditorView === view.constructor) { hostView = candidate; break; }
    }
    for (const id of moduleIds(text, 'syntaxTree')) {
      const candidate = requireHost(id) as LanguageModule;
      if (typeof candidate?.syntaxTree === 'function' && candidate.indentUnit) { language = candidate; break; }
    }
    if (state && hostView && language) break;
  }
  if (!state || !hostView || !language) throw new Error('Cannot find the host CodeMirror modules.');
  const modules: Record<string, unknown> = { '@codemirror/state': state, '@codemirror/view': hostView, '@codemirror/language': language };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)((name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected CodeMirror dependency: ${name}`);
    return modules[name];
  }, module, module.exports);
  return { state, view: hostView, language, completion: module.exports as Runtime['completion'] };
}

export class Completions {
  private runtime?: Promise<Runtime>;
  private installed = new Map<EditorView, { reconfigure(extension: unknown): unknown }>();
  private stopped = false;
  private failed = false;
  constructor(private hostId: string, private editorId: string, private getApi: () => EditorApi, private used: (workspace: string) => void, private notify: (message: string, error?: boolean) => void) {}
  update(bindings: Binding[]) {
    const views = new Set(bindings.map(item => item.view));
    for (const [view, compartment] of this.installed) if (!views.has(view)) {
      try { const effect = compartment.reconfigure([]); if (effect) view.dispatch({ effects: effect as never }); } catch { /* The host may have destroyed the view. */ }
      this.installed.delete(view);
    }
    for (const binding of bindings) if (!this.installed.has(binding.view)) {
      // Reserve immediately to avoid parallel installs while the host bundle loads.
      const pending = { reconfigure: (_extension: unknown): unknown => undefined };
      this.installed.set(binding.view, pending);
      this.runtime ??= hostRuntime(binding.view);
      void this.runtime.then(runtime => {
        if (this.stopped || this.installed.get(binding.view) !== pending || !binding.element.isConnected) return;
        if (binding.view.state.constructor !== runtime.state.EditorState || binding.view.constructor !== runtime.view.EditorView) throw new Error('Editor uses a different CodeMirror runtime.');
        const compartment = new runtime.state.Compartment();
        const extension = [runtime.completion.autocompletion({ override: [context => this.complete(binding, context)] }), runtime.state.Prec.highest(runtime.view.keymap.of([{ key: 'Tab', run: runtime.completion.acceptCompletion }]))];
        binding.view.dispatch({ effects: runtime.state.StateEffect.appendConfig.of(compartment.of(extension)) });
        this.installed.set(binding.view, compartment);
      }).catch(error => { if (!this.stopped && !this.failed) { this.failed = true; this.notify(`LSP completion unavailable: ${String(error)}`, true); } });
    }
  }
  private async complete(binding: Binding, context: CompletionContext): Promise<CompletionResult | null> {
    const doc = binding.view.state.doc, head = context.pos, siblings = nativeEditors(this.hostId, binding.pane.workspaceId), docs = siblings.map(item => item.view.state.doc);
    try {
      const line = doc.lineAt(head); this.used(binding.pane.workspaceId);
      const response = await this.getApi().inspect({ kind: 'completion', workspaceId: binding.pane.workspaceId, editorId: this.editorId, path: binding.path, buffers: editorBuffers(binding, siblings), position: { line: line.number - 1, character: head - line.from } });
      if (this.stopped || context.aborted || binding.view.state.doc !== doc || siblings.some((item, index) => item.view.state.doc !== docs[index]) || !response.completions?.length) return null;
      const from = context.matchBefore(/[\w$]+/)?.from ?? head;
      return { from, filter: false, options: response.completions.map(item => ({ label: item.label, detail: item.detail, apply: (view: EditorView) => {
        if (view.state.doc !== doc) return;
        try {
          const start = item.range ? positionOffset(doc.toString(), item.range.start) : from;
          const end = item.range ? positionOffset(doc.toString(), item.range.end) : head;
          if (start > end || head < start || head > end) return;
          view.dispatch({ changes: { from: start, to: end, insert: item.insertText }, selection: { anchor: start + item.insertText.length }, scrollIntoView: true });
        } catch { /* Ignore invalid server ranges. */ }
      } })) };
    } catch { return null; }
  }
  dispose() {
    this.stopped = true;
    for (const [view, compartment] of this.installed) {
      try { const effect = compartment.reconfigure([]); if (effect) view.dispatch({ effects: effect as never }); } catch { /* The host may have destroyed the view. */ }
    }
    this.installed.clear();
  }
}
