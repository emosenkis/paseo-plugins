import { nativePane, nativeEditors } from './native.ts';
import { setResults } from './results.ts';
import { appendCode } from './tooltip-code.ts';
import type { EditorApi, Target, Inspection } from '../shared/contracts.ts';
import type { IntelligenceColors } from './intelligence.ts';

import { diffPoint, diffHighlights, diffDestination, type DiffPoint, type Model } from './diff-point.ts';
type Hook = { memoizedState?: unknown; next?: Hook };
type Fiber = { memoizedState?: Hook; memoizedProps?: Record<string, unknown>; return?: Fiber };

// shortcut: the native canvas model lives in React hook refs; revisit when Paseo exposes a diff API.
function surface(element: HTMLElement) {
  const key = Object.keys(element).find(key => key.startsWith('__reactFiber$'));
  let fiber = key ? (element as unknown as Record<string, Fiber>)[key] : undefined;
  for (let depth = 0; fiber && depth < 150; depth++, fiber = fiber.return) {
    const refs: unknown[] = [];
    for (let hook = fiber.memoizedState; hook; hook = hook.next) {
      const value = hook.memoizedState;
      if (value && typeof value === 'object' && 'current' in value) refs.push(value.current);
    }
    const model = refs.find((value): value is Model => !!value && typeof value === 'object' && 'rows' in value && 'files' in value && 'viewportWidth' in value);
    if (model && fiber.memoizedProps?.mode && (fiber.memoizedProps.mode as { kind: string }).kind === 'working') {
      return { model, offsets: refs.find(value => value instanceof Map) as Map<string, number> | undefined, toggle: fiber.memoizedProps.onToggleFile as ((path: string) => void) | undefined };
    }
  }
}
export class DiffIntelligence {
  private tooltip = document.createElement('div');
  private highlight = document.createElement('div');
  private ranges: Target['range'][] = [];
  private selectionTimer: ReturnType<typeof setInterval>;
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private navigation = 0;
  private selected?: { element: HTMLElement; point: DiffPoint; model: Model; x: number; y: number };
  private sessions = new Set<string>();
  private editorId = 'diff-' + Math.random().toString(36).slice(2);
  private stopped = false;
  constructor(private api: EditorApi, private hostId: string, private colors: IntelligenceColors, private openResults: (workspace: string) => void, private notify: (message: string, error?: boolean) => void) {
    this.tooltip.setAttribute('role', 'tooltip'); this.tooltip.dataset.lspDiffTooltip = '';
    document.body.append(this.tooltip); this.hide();
    this.highlight.dataset.lspDiffSelection = ''; this.highlight.setAttribute('aria-hidden', 'true');
    this.selectionTimer = setInterval(() => {
      if (this.selected && (!this.selected.element.isConnected || surface(this.selected.element)?.model !== this.selected.model)) {
        this.selected = undefined; this.highlight.remove();
      }
    }, 250);
    document.addEventListener('mousemove', this.mouse, true);
    document.addEventListener('pointerdown', this.down, true);
    document.addEventListener('keydown', this.key, true);
    document.addEventListener('scroll', this.scroll, true);
  }
  update(api: EditorApi, colors: IntelligenceColors) { this.api = api; this.colors = colors; this.paintSelection(); }
  private hide = () => { this.generation++; clearTimeout(this.timer); this.tooltip.style.display = 'none'; };
  private scroll = () => { this.hide(); requestAnimationFrame(() => this.paintSelection()); };
  private paintSelection() {
    this.highlight.remove(); this.highlight.replaceChildren();
    const source = this.selected;
    if (this.stopped || !source || !source.element.isConnected) return;
    const current = surface(source.element);
    if (current?.model !== source.model) return;
    const geometries = diffHighlights(current.model, source.point.path, this.ranges, current.offsets?.get(source.point.path) ?? 0);
    const content = source.element.querySelector('[data-testid="git-diff-scroll"]')?.firstElementChild;
    if (!geometries.length || !content) return;
    this.highlight.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2';
    for (const geometry of geometries) {
      const clip = document.createElement('div');
      clip.style.cssText = `position:absolute;pointer-events:none;z-index:2;overflow:hidden;left:${geometry.left}px;top:${geometry.top}px;width:${geometry.width}px;height:${geometry.height}px`;
      for (const box of geometry.boxes) {
        const node = document.createElement('div');
        node.style.cssText = `position:absolute;pointer-events:none;border-radius:3px;background:color-mix(in srgb,${this.colors.accent} 20%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,${this.colors.accent} 30%,transparent);left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${source.model.lineHeight}px`;
        clip.append(node);
      }
      this.highlight.append(clip);
    }
    content.append(this.highlight);
  }
  private at(event: MouseEvent) {
    if (!(event.target instanceof Element)) return;
    const element = event.target.closest<HTMLElement>('[data-testid="git-diff-canvas-root"]');
    if (!element) return;
    const scroll = element.querySelector('[data-testid="git-diff-scroll"]');
    // Unwrapped diffs put a horizontal-scroll layer above the non-interactive canvas.
    const horizontal = event.target.closest('[data-testid^="diff-file-"][data-testid$="-horizontal-scroll"]');
    if (event.target !== scroll && event.target !== scroll?.firstElementChild && event.target !== horizontal && event.target.parentElement !== horizontal && !event.target.matches('[data-testid="git-diff-canvas"]')) return;
    const pane = nativePane(element), current = surface(element);
    if (!pane || pane.serverId !== this.hostId || !current) return;
    const bounds = element.getBoundingClientRect();
    const x = event.clientX - bounds.left, y = event.clientY - bounds.top + (scroll?.scrollTop ?? 0);
    const file = current.model.files.find(file => file.top <= y && y < file.bottom);
    const point = diffPoint(current.model, x, y, current.offsets?.get(file?.path ?? '') ?? 0);
    return point ? { element, point, model: current.model, x: event.clientX, y: event.clientY } : undefined;
  }
  private mouse = (event: MouseEvent) => {
    if (this.tooltip.contains(event.target as Node)) return;
    this.hide();
    const source = this.at(event); if (!source) return;
    const generation = this.generation;
    this.timer = setTimeout(() => { void this.inspect(source, 'hover', generation); }, 250);
  };
  private down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    this.hide(); this.selected = this.at(event); this.ranges = []; this.paintSelection();
    if (this.selected) void this.occurrences(this.selected);
    if (this.selected && event.button === 0 && (event.metaKey || event.ctrlKey)) {
      event.preventDefault(); event.stopImmediatePropagation(); void this.navigate(this.selected, 'definition');
    } else if (this.selected && event.button === 0) {
      const source = this.selected, generation = this.generation;
      this.timer = setTimeout(() => { void this.inspect(source, 'signature', generation); }, 500);
    }
  };
  private key = (event: KeyboardEvent) => {
    this.hide();
    if (event.key === 'Escape') { this.selected = undefined; this.highlight.remove(); }
    const source = this.selected;
    if (!source || !(event.target instanceof Node) || !source.element.contains(event.target)) return;
    if (event.key === 'F12' && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault(); event.stopImmediatePropagation(); void this.navigate(source, event.shiftKey ? 'references' : 'definition');
    } else if (event.ctrlKey && event.shiftKey && event.code === 'Space' && !event.altKey && !event.metaKey) {
      event.preventDefault(); event.stopImmediatePropagation(); void this.inspect(source, 'signature', this.generation);
    }
  };
  private input(source: NonNullable<DiffIntelligence['selected']>) {
    const pane = nativePane(source.element);
    if (!pane || pane.serverId !== this.hostId || !source.element.isConnected || surface(source.element)?.model !== source.model) throw new Error('Diff is no longer available.');
    this.sessions.add(pane.workspaceId);
    const buffers = new Map<string, string>();
    for (const binding of nativeEditors(this.hostId, pane.workspaceId)) {
      const text = binding.view.state.sliceDoc();
      if (buffers.has(binding.path) && buffers.get(binding.path) !== text) throw new Error('Reconcile differing native file buffers first.');
      buffers.set(binding.path, text);
    }
    return { pane, input: { ...source.point, workspaceId: pane.workspaceId, editorId: this.editorId, buffers: [...buffers].map(([path, text]) => ({ path, text })) } };
  }
  private async occurrences(source: NonNullable<DiffIntelligence['selected']>) {
    try {
      const { input } = this.input(source);
      const response = await this.api.inspect({ ...input, kind: 'highlights' });
      if (this.stopped || this.selected !== source || JSON.stringify(this.input(source).input.buffers) !== JSON.stringify(input.buffers)) return;
      this.ranges = response.highlights ?? []; this.paintSelection();
    } catch { /* Unsupported or stale symbol highlights must not interrupt diff review. */ }
  }
  private async inspect(source: NonNullable<DiffIntelligence['selected']>, kind: 'hover' | 'signature', generation: number) {
    try {
      const { input } = this.input(source);
      const response = await this.api.inspect({ ...input, kind });
      if (JSON.stringify(this.input(source).input.buffers) !== JSON.stringify(input.buffers)) return;
      if (this.stopped || generation !== this.generation || !source.element.isConnected) return;
      this.show(response, source);
    } catch { /* Background inspection must not interrupt diff review. */ }
  }
  private show(response: Inspection, source: NonNullable<DiffIntelligence['selected']>) {
    const blocks = response.hover ?? (response.signature ? [{ text: response.signature.label, language: source.point.path }, ...(response.signature.documentation ? [{ text: response.signature.documentation }] : [])] : []);
    if (!blocks.length) return;
    this.tooltip.replaceChildren();
    for (const block of blocks) {
      const node = document.createElement(block.language ? 'code' : 'div'); node.style.display = 'block';
      if (response.signature?.parameter && block.text === response.signature.label) {
        const [start, end] = response.signature.parameter;
        appendCode(node, block.text.slice(0, start), source.point.path);
        const active = document.createElement('strong'); active.dataset.activeParameter = '';
        appendCode(active, block.text.slice(start, end), source.point.path); node.append(active);
        appendCode(node, block.text.slice(end), source.point.path);
      } else if (block.language) appendCode(node, block.text, block.language); else node.textContent = block.text;
      this.tooltip.append(node);
    }
    this.tooltip.style.cssText = `position:fixed;z-index:100000;max-width:min(600px,calc(100vw - 16px));max-height:40vh;overflow:auto;white-space:pre-wrap;padding:8px;border:1px solid ${this.colors.border};background:${this.colors.surface0};color:${this.colors.foreground};font:13px/1.5 monospace`;
    this.tooltip.style.left = Math.max(8, Math.min(source.x, innerWidth - this.tooltip.offsetWidth - 8)) + 'px';
    this.tooltip.style.top = Math.max(8, Math.min(source.y + 18, innerHeight - this.tooltip.offsetHeight - 8)) + 'px';
  }
  private async openTarget(source: NonNullable<DiffIntelligence['selected']>, pane: NonNullable<ReturnType<typeof nativePane>>, target: Target) {
    if (this.stopped) return;
    const request = ++this.navigation;
    const fallback = () => pane.openFileInWorkspace({ location: { path: target.path, lineStart: target.range.start.line + 1, lineEnd: target.range.end.line + 1 }, disposition: 'main' });
    let current = source.element.isConnected ? surface(source.element) : undefined;
    const file = current?.model.files.find(file => file.path === target.path);
    const collapsedLine = file?.isCollapsed && file.file?.hunks.some(hunk => hunk.newStart <= target.range.start.line + 1 && target.range.start.line + 1 < hunk.newStart + hunk.newCount);
    if (!current || (!diffDestination(current.model, target) && !(collapsedLine && current.toggle))) { fallback(); return; }
    // Re-select the originating diff tab when a result is opened after an editor fallback.
    if (!source.element.getClientRects().length) {
      if (!pane.openTab) { fallback(); return; }
      pane.openTab(pane.target);
    }
    if (collapsedLine) current.toggle!(target.path);
    const deadline = Date.now() + 2000;
    while (!this.stopped && request === this.navigation && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
      if (!source.element.isConnected) break;
      current = surface(source.element);
      const destination = current && diffDestination(current.model, target);
      const scroll = source.element.querySelector<HTMLElement>('[data-testid="git-diff-scroll"]');
      if (!current || !destination || !scroll || !source.element.getClientRects().length) continue;
      const top = Math.min(Math.max(0, scroll.scrollHeight - scroll.clientHeight), Math.max(0, destination.top - scroll.clientHeight / 3));
      if (Math.abs(scroll.scrollTop - top) > 1) { scroll.scrollTop = top; continue; }
      // Offscreen rows acquire measured fragments after scrolling into the native render window.
      if (!destination.cell.fragments.length) continue;
      const columnWidth = current.model.viewportWidth / destination.row.cells!.length;
      const horizontal = source.element.querySelector<HTMLElement>(`[data-testid="diff-file-${destination.file.fileIndex ?? current.model.files.indexOf(destination.file)}-horizontal-scroll"]`);
      if (horizontal) horizontal.scrollLeft = Math.max(0, destination.x - (columnWidth - destination.file.gutterWidth - 8) / 2);
      const offset = horizontal?.scrollLeft ?? 0, bounds = source.element.getBoundingClientRect();
      this.hide();
      this.selected = {
        element: source.element, model: current.model,
        point: { path: target.path, position: target.range.start, diffLine: destination.cell.content },
        x: bounds.left + destination.index * columnWidth + destination.file.gutterWidth + 8 + destination.x - offset,
        y: bounds.top + destination.top - scroll.scrollTop,
      };
      this.ranges = [target.range]; this.paintSelection(); scroll.focus();
      void this.occurrences(this.selected);
      return;
    }
    if (!this.stopped && request === this.navigation) fallback();
  }
  private async navigate(source: NonNullable<DiffIntelligence['selected']>, kind: 'definition' | 'references') {
    const request = ++this.navigation;
    try {
      const { pane, input } = this.input(source);
      const response = await this.api.lookup({ ...input, kind });
      if (JSON.stringify(this.input(source).input.buffers) !== JSON.stringify(input.buffers)) throw new Error('Editor changed during lookup. Retry navigation.');
      if (this.stopped || request !== this.navigation || !source.element.isConnected) return;
      const open = (target: Target) => { void this.openTarget(source, pane, target).catch(error => { if (!this.stopped) this.notify(String(error), true); }); };
      setResults(this.hostId, pane.workspaceId, { title: kind === 'definition' ? 'Definitions' : 'References', source: `${input.path}:${input.position.line + 1}`, status: `${response.targets.length} result(s). ${response.omitted} targets omitted.`, targets: response.targets, open });
      if (response.targets.length === 1) open(response.targets[0]);
      else if (response.targets.length > 1) this.openResults(pane.workspaceId);
      else this.notify('No ' + kind + ' found.');
    } catch (error) { if (!this.stopped) this.notify(String(error), true); }
  }
  async dispose() {
    this.stopped = true; this.hide(); this.tooltip.remove(); this.highlight.remove(); clearInterval(this.selectionTimer);
    document.removeEventListener('mousemove', this.mouse, true); document.removeEventListener('pointerdown', this.down, true); document.removeEventListener('keydown', this.key, true); document.removeEventListener('scroll', this.scroll, true);
    await Promise.all([...this.sessions].map(workspaceId => this.api.release({ workspaceId, editorId: this.editorId }).catch(() => {})));
  }
}
