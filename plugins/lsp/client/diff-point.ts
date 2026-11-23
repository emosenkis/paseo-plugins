import type { Target } from '../shared/contracts.ts';
type Cell = { content: string; lineNumber: number | null; sourceIdentity: { side: string }; fragments: { end: number; graphemes: { start: number; width: number }[] }[] };
export type Model = { viewportWidth: number; lineHeight: number; files: { path: string; top: number; bottom: number; bodyTop: number; gutterWidth: number; fileIndex?: number; isCollapsed?: boolean; file?: { hunks: { newStart: number; newCount: number }[] } }[]; rows: { kind: string; path: string; top: number; height: number; reviewHeight: number; cells?: (Cell | null)[] }[] };
export type DiffPoint = { path: string; position: Target['range']['start']; diffLine: string };
export function diffPoint(model: Model, x: number, y: number, horizontalOffset = 0): DiffPoint | undefined {
  const file = model.files.find(file => file.bodyTop <= y && y < file.bottom);
  const row = model.rows.find(row => row.kind === 'line' && row.top <= y && y < row.top + row.height - row.reviewHeight);
  if (!file || !row?.cells || row.path !== file.path || x < 0 || x >= model.viewportWidth) return;
  const width = model.viewportWidth / row.cells.length, index = Math.floor(x / width), cell = row.cells[index];
  if (!cell || cell.sourceIdentity.side !== 'new' || cell.lineNumber === null) return;
  const localX = x - index * width;
  if (localX < file.gutterWidth + 8) return;
  const fragment = cell.fragments[Math.floor((y - row.top) / model.lineHeight)];
  if (!fragment) return;
  const contentX = localX - file.gutterWidth - 8 + horizontalOffset;
  let advance = 0, character = fragment.end;
  for (const grapheme of fragment.graphemes) {
    if (contentX <= advance + grapheme.width / 2) { character = grapheme.start; break; }
    advance += grapheme.width;
  }
  return { path: file.path, position: { line: cell.lineNumber - 1, character }, diffLine: cell.content };
}

// Canvas text has no DOM ranges; map LSP occurrences through measured graphemes.
export function diffHighlights(model: Model, path: string, ranges: Target['range'][], horizontalOffset = 0) {
  const file = model.files.find(file => file.path === path);
  if (!file) return [];
  return model.rows.filter(row => row.path === path && row.cells).flatMap(row => row.cells!.flatMap((cell, index) => {
    if (!cell || cell.sourceIdentity.side !== 'new' || cell.lineNumber === null) return [];
    const line = cell.lineNumber - 1;
    const spans = ranges.filter(range => range.start.line <= line && range.end.line >= line).map(range => ({
      from: range.start.line === line ? range.start.character : 0,
      to: range.end.line === line ? range.end.character : cell.content.length,
    }));
    const boxes = cell.fragments.flatMap((fragment, part) => spans.flatMap(span => {
      let left = 0, width = 0;
      for (const grapheme of fragment.graphemes) {
        if (grapheme.start < span.from) left += grapheme.width;
        else if (grapheme.start < span.to) width += grapheme.width;
      }
      return width ? [{ left: left - horizontalOffset, top: part * model.lineHeight, width }] : [];
    }));
    const width = model.viewportWidth / row.cells!.length;
    return boxes.length ? [{ left: index * width + file.gutterWidth + 8, top: row.top, width: Math.max(0, width - file.gutterWidth - 8), height: row.height - row.reviewHeight, boxes }] : [];
  }));
}

export function diffDestination(model: Model, target: Target) {
  const file = model.files.find(file => file.path === target.path);
  const row = model.rows.find(row => row.path === target.path && row.cells?.some(cell => cell?.sourceIdentity.side === 'new' && cell.lineNumber === target.range.start.line + 1));
  if (!file || !row?.cells) return;
  const index = row.cells.findIndex(cell => cell?.sourceIdentity.side === 'new' && cell.lineNumber === target.range.start.line + 1);
  const cell = row.cells[index]!;
  if (target.range.start.character > cell.content.length) return;
  let part = cell.fragments.findIndex(fragment => target.range.start.character < fragment.end);
  if (part < 0) part = Math.max(0, cell.fragments.length - 1);
  const x = cell.fragments[part]?.graphemes.filter(grapheme => grapheme.start < target.range.start.character).reduce((sum, grapheme) => sum + grapheme.width, 0) ?? 0;
  return { file, row, cell, index, part, x, top: row.top + part * model.lineHeight };
}
