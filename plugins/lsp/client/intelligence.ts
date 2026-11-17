import type { EditorView } from '@codemirror/view';
import type { PluginTheme } from '@getpaseo/plugin';
import { appendCode } from './tooltip-code.ts';
import { Completions } from './completion.ts';
import { nativeEditors, editorBuffers, type Binding } from './native.ts';
import { positionOffset, type Diagnostic, type EditorApi, type Signature } from '../shared/contracts.ts';

export type IntelligenceColors = Pick<PluginTheme['colors'], 'border' | 'surface0' | 'foreground' | 'accent'>;
type RecordState = { binding: Binding; doc: EditorView['state']['doc']; changed: number; checked: number; pending: boolean; error?: string; diagnostics: Diagnostic[] };

// Browser highlights style rendered text without adding a second CodeMirror runtime to the host state.
export class Intelligence {
  private records = new Map<EditorView, RecordState>();
  private id = `paseo-lsp-${Math.random().toString(36).slice(2)}`;
  private style = document.createElement('style');
  private tooltip = document.createElement('div');
  private stopped = false;
  private completions: Completions;
  private hoverTimer?: ReturnType<typeof setTimeout>;
  private frame = 0;
  private hoverRequest = 0;
  private signatureContext?: { binding: Binding; doc: EditorView['state']['doc']; head: number; changed: number; requested: boolean };
  private signaturePending = false;
  private workspaces = new Set<string>();
  private timer: ReturnType<typeof setInterval>;
  private observer: MutationObserver;
  constructor(private api: EditorApi, private hostId: string, private editorId: string, colors: IntelligenceColors, private notify: (message: string, error?: boolean) => void) {
    this.completions = new Completions(hostId, editorId, () => this.api, workspace => this.workspaces.add(workspace), (message, error) => this.notify(message, error));
    document.head.append(this.style);
    this.tooltip.id = this.id; this.tooltip.dataset.lspTooltip = ''; this.tooltip.setAttribute('role', 'tooltip');
    document.body.append(this.tooltip); this.update(api, colors, notify); this.hide();
    document.addEventListener('mousemove', this.mouse, true);
    document.addEventListener('keydown', this.key, true);
    document.addEventListener('scroll', this.scroll, true);
    this.observer = new MutationObserver(() => { if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint(); }); });
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.timer = setInterval(() => this.tick(), 250); this.tick();
  }
  update(api: EditorApi, colors: IntelligenceColors, notify: (message: string, error?: boolean) => void) {
    this.api = api; this.notify = notify;
    this.style.textContent = [1, 2, 3, 4].map(severity => `::highlight(${this.id}-${severity}) { text-decoration: underline wavy ${severity === 1 ? '#ed6666' : severity === 2 ? '#d6a642' : colors.accent}; text-underline-offset: 3px; }`).join('\n') + `
[data-testid="file-source-editor"] .cm-tooltip-autocomplete {background:${colors.surface0};color:${colors.foreground};border-color:${colors.border}}
[data-testid="file-source-editor"] .cm-tooltip-autocomplete > ul > li[aria-selected="true"] {background:${colors.accent};color:${colors.surface0}}
#${this.id} code {font:inherit}
#${this.id} .tok-keyword {color:color-mix(in srgb,#b06acb 75%,${colors.foreground})}
#${this.id} .tok-typeName, #${this.id} .tok-className {color:color-mix(in srgb,#399b93 75%,${colors.foreground})}
#${this.id} .tok-string, #${this.id} .tok-string2 {color:color-mix(in srgb,#b17d3d 75%,${colors.foreground})}
#${this.id} .tok-number, #${this.id} .tok-bool {color:color-mix(in srgb,#69983c 75%,${colors.foreground})}
#${this.id} .tok-comment {color:color-mix(in srgb,#808080 75%,${colors.foreground});font-style:italic}
#${this.id} .tok-operator {color:${colors.accent}}
#${this.id} .tok-variableName, #${this.id} .tok-function, #${this.id} .tok-variableName.tok-definition {color:color-mix(in srgb,#4d95cc 75%,${colors.foreground})}
`;
    this.tooltip.style.cssText = `display:none;position:fixed;z-index:100000;max-width:min(600px,calc(100vw - 16px));max-height:40vh;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;padding:8px;border:1px solid ${colors.border};border-radius:4px;background:${colors.surface0};color:${colors.foreground};font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;box-shadow:0 2px 10px #0004`;
  }
  private hide() { this.hoverRequest++; clearTimeout(this.hoverTimer); this.tooltip.style.display = 'none'; }
  private key = (event: KeyboardEvent) => {
    this.hide();
    if (event.ctrlKey && event.shiftKey && event.code === 'Space' && !event.altKey && !event.metaKey) {
      const binding = nativeEditors(this.hostId).find(item => item.element.contains(event.target as Node));
      if (binding) {
        event.preventDefault(); event.stopImmediatePropagation();
        this.signatureContext = { binding, doc: binding.view.state.doc, head: binding.view.state.selection.main.head, changed: 0, requested: false };
      }
    }
  };
  private scroll = (event: Event) => {
    if (event.target !== document && ![...this.records.values()].some(({ binding }) => event.target instanceof Node && (binding.element.contains(event.target) || event.target.contains(binding.element)))) return;
    this.hide(); this.paint();
  };
  private mouse = (event: MouseEvent) => {
    if (this.tooltip.contains(event.target as Node)) return;
    this.hide();
    const binding = nativeEditors(this.hostId).find(item => item.element.contains(event.target as Node));
    const record = binding && this.records.get(binding.view);
    if (!binding || !record || record.doc !== binding.view.state.doc) return;
    const offset = binding.view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (offset === null) return;
    const items = record.diagnostics.filter(item => { try { return positionOffset(record.doc.toString(), item.range.start) <= offset && positionOffset(record.doc.toString(), item.range.end) >= offset; } catch { return false; } });
    const request = this.hoverRequest;
    const doc = binding.view.state.doc;
    this.hoverTimer = setTimeout(() => {
      if (items.length) this.showTooltip(items.map(item => `${item.severity === 1 ? 'Error' : item.severity === 2 ? 'Warning' : 'Info'}${item.source ? ` (${item.source}${item.code !== undefined ? ` ${item.code}` : ''})` : ''}: ${item.message}`).join('\n\n'), event.clientX, event.clientY, binding);
      else void this.hover(binding, offset, doc, request, event.clientX, event.clientY);
    }, 250);
  };
  private showTooltip(text: string, x: number, y: number, binding: Binding) {
    this.tooltip.style.fontFamily = getComputedStyle(binding.view.contentDOM).fontFamily || 'monospace';
    this.tooltip.dataset.lspTooltip = ''; this.tooltip.textContent = text; this.tooltip.style.display = 'block';
    this.positionTooltip(x, y);
  }
  private positionTooltip(x: number, y: number) {
    this.tooltip.style.left = `${Math.max(8, Math.min(x, innerWidth - this.tooltip.offsetWidth - 8))}px`;
    this.tooltip.style.top = `${Math.max(8, Math.min(y + 18, innerHeight - this.tooltip.offsetHeight - 8))}px`;
  }
  private async hover(binding: Binding, offset: number, doc: EditorView['state']['doc'], request: number, x: number, y: number) {
    const siblings = nativeEditors(this.hostId, binding.pane.workspaceId), docs = siblings.map(item => item.view.state.doc);
    try {
      const line = doc.lineAt(offset);
      const response = await this.api.inspect({ kind: 'hover', workspaceId: binding.pane.workspaceId, editorId: this.editorId, path: binding.path, buffers: editorBuffers(binding, siblings), position: { line: line.number - 1, character: offset - line.from } });
      if (this.stopped || request !== this.hoverRequest || binding.view.state.doc !== doc || siblings.some((item, index) => item.view.state.doc !== docs[index])) return;
      if (response.hover) {
        this.showTooltip('', x, y, binding);
        for (const block of response.hover) {
          const element = document.createElement(block.language ? 'code' : 'div'); element.style.display = 'block'; element.style.marginBottom = '6px';
          if (block.language) appendCode(element, block.text, block.language); else element.textContent = block.text;
          this.tooltip.append(element);
        }
        this.positionTooltip(x, y);
      }
    } catch { /* Background mouseovers must not interrupt editing or produce repeated error toasts. */ }
  }
  private async signature(context: NonNullable<Intelligence['signatureContext']>) {
    this.signaturePending = true; context.requested = true;
    const request = ++this.hoverRequest;
    const { binding, doc, head } = context;
    const siblings = nativeEditors(this.hostId, binding.pane.workspaceId), docs = siblings.map(item => item.view.state.doc);
    try {
      const line = doc.lineAt(head);
      const response = await this.api.inspect({ kind: 'signature', workspaceId: binding.pane.workspaceId, editorId: this.editorId, path: binding.path, buffers: editorBuffers(binding, siblings), position: { line: line.number - 1, character: head - line.from } });
      if (this.stopped || request !== this.hoverRequest || !binding.view.hasFocus || doc !== binding.view.state.doc || head !== binding.view.state.selection.main.head || siblings.some((item, index) => item.view.state.doc !== docs[index])) return;
      const coords = binding.view.coordsAtPos(head);
      if (response.signature && coords) this.showSignature(response.signature, coords.left, coords.bottom, binding);
    } catch { /* Unsupported or unavailable signature help must not interrupt typing. */ }
    finally { this.signaturePending = false; }
  }
  private showSignature(signature: Signature, x: number, y: number, binding: Binding) {
    this.showTooltip('', x, y, binding);
    this.tooltip.dataset.lspTooltip = 'signature';
    const label = document.createElement('code');
    if (signature.parameter) {
      const [start, end] = signature.parameter;
      const active = document.createElement('strong'); appendCode(active, signature.label.slice(start, end), binding.path); active.dataset.activeParameter = ''; active.style.textDecoration = 'underline';
      appendCode(label, signature.label.slice(0, start), binding.path); label.append(active); appendCode(label, signature.label.slice(end), binding.path);
    } else appendCode(label, signature.label, binding.path);
    this.tooltip.append(label);
    if (signature.documentation) { const docs = document.createElement('div'); docs.style.marginTop = '6px'; docs.textContent = signature.documentation; this.tooltip.append(docs); }
    if (signature.count > 1) { const overload = document.createElement('div'); overload.textContent = `Overload ${signature.index + 1} of ${signature.count}`; this.tooltip.append(overload); }
    this.positionTooltip(x, y);
  }
  private tick() {
    if (this.stopped || document.hidden) return;
    const bindings = nativeEditors(this.hostId);
    this.completions.update(bindings);
    const focused = bindings.find(binding => binding.view.hasFocus);
    if (focused) {
      const doc = focused.view.state.doc, head = focused.view.state.selection.main.head;
      if (this.signatureContext?.binding.view !== focused.view || this.signatureContext.doc !== doc || this.signatureContext.head !== head) {
        this.hide(); this.signatureContext = { binding: focused, doc, head, changed: Date.now(), requested: false };
      }
      if (!this.signatureContext.requested && !this.signaturePending && Date.now() - this.signatureContext.changed >= 250) void this.signature(this.signatureContext);
    } else if (this.signatureContext) { this.signatureContext = undefined; this.hide(); }
    const views = new Set(bindings.map(binding => binding.view));
    for (const view of this.records.keys()) if (!views.has(view)) this.records.delete(view);
    for (const binding of bindings) {
      let record = this.records.get(binding.view);
      if (!record) { record = { binding, doc: binding.view.state.doc, changed: Date.now(), checked: 0, pending: false, diagnostics: [] }; this.records.set(binding.view, record); }
      record.binding = binding;
      if (record.doc !== binding.view.state.doc) { record.doc = binding.view.state.doc; record.changed = Date.now(); record.diagnostics = []; this.hide(); this.paint(); }
      if (record.pending || Date.now() - record.changed < 350 || Date.now() - record.checked < 1000 || !binding.element.getClientRects().length) continue;
      void this.check(record);
    }
    for (const workspace of this.workspaces) if (!bindings.some(binding => binding.pane.workspaceId === workspace)) {
      this.workspaces.delete(workspace); void this.api.release({ workspaceId: workspace, editorId: this.editorId }).catch(() => {});
    }
  }
  private async check(record: RecordState) {
    const { binding, doc } = record;
    const siblings = nativeEditors(this.hostId, binding.pane.workspaceId);
    const docs = siblings.map(item => item.view.state.doc);
    record.pending = true; record.checked = Date.now();
    try {
      this.workspaces.add(binding.pane.workspaceId);
      const response = await this.api.inspect({ kind: 'diagnostics', workspaceId: binding.pane.workspaceId, editorId: this.editorId, path: binding.path, buffers: editorBuffers(binding, siblings), position: { line: 0, character: 0 } });
      if (this.stopped || doc !== binding.view.state.doc || siblings.some((item, index) => item.view.state.doc !== docs[index])) return;
      record.diagnostics = response.diagnostics; this.paint(); record.error = '';
    } catch (error) {
      record.diagnostics = []; this.paint();
      const message = error instanceof Error ? error.message : String(error);
      if (!this.stopped && message !== record.error && !/No LSP covers|Missing .paseo\/lsp.json/.test(message)) this.notify(message, true);
      record.error = message;
    } finally { record.pending = false; }
  }
  private paint() {
    if (this.stopped || !CSS.highlights || typeof Highlight === 'undefined') return;
    const highlights = [new Highlight(), new Highlight(), new Highlight(), new Highlight()];
    for (const { binding, doc, diagnostics } of this.records.values()) {
      if (!diagnostics.length || !binding.element.isConnected || binding.view.state.doc !== doc || !binding.element.getClientRects().length) continue;
      const text = doc.toString();
      for (const diagnostic of diagnostics) {
        try {
          const from = positionOffset(text, diagnostic.range.start), to = positionOffset(text, diagnostic.range.end);
          for (const visible of binding.view.visibleRanges) {
            const start = Math.max(from, visible.from), end = Math.min(Math.max(from + 1, to), visible.to);
            if (start >= end) continue;
            const a = binding.view.domAtPos(start), b = binding.view.domAtPos(end);
            const range = document.createRange(); range.setStart(a.node, a.offset); range.setEnd(b.node, b.offset);
            highlights[diagnostic.severity - 1].add(range);
          }
        } catch { /* A server range may refer to text that has since changed. */ }
      }
    }
    highlights.forEach((highlight, index) => CSS.highlights.set(`${this.id}-${index + 1}`, highlight));
  }
  async dispose() {
    this.stopped = true; clearInterval(this.timer); this.observer.disconnect(); cancelAnimationFrame(this.frame); this.hide(); this.completions.dispose();
    document.removeEventListener('mousemove', this.mouse, true); document.removeEventListener('keydown', this.key, true); document.removeEventListener('scroll', this.scroll, true);
    this.style.remove(); this.tooltip.remove(); for (let i = 1; i <= 4; i++) CSS.highlights?.delete(`${this.id}-${i}`);
    await Promise.all([...this.workspaces].map(workspaceId => this.api.release({ workspaceId, editorId: this.editorId }).catch(() => {})));
  }
}
