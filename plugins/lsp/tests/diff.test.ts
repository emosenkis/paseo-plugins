import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffBuffers } from '../server/diff.ts';
import { diffPoint, diffHighlights, diffDestination } from '../client/diff-point.ts';

test('diff coordinates use the new side, wrapped fragments and horizontal offsets', () => {
  const cell = (side: string) => ({ content: 'abc😀', lineNumber: 7, sourceIdentity: { side }, fragments: [
    { end: 3, graphemes: [{ start: 0, width: 10 }, { start: 1, width: 10 }, { start: 2, width: 10 }] },
    { end: 5, graphemes: [{ start: 3, width: 20 }] },
  ] });
  const model = { viewportWidth: 400, lineHeight: 20, files: [{ path: 'x.ts', top: 0, bodyTop: 20, bottom: 100, gutterWidth: 30 }], rows: [{ kind: 'line', path: 'x.ts', top: 20, height: 60, reviewHeight: 20, cells: [cell('old'), cell('new')] }] };
  assert.equal(diffPoint(model, 50, 25), undefined);
  assert.equal(diffPoint(model, 220, 25), undefined);
  assert.equal(diffPoint(model, 250, 10), undefined);
  assert.equal(diffPoint(model, 250, 65), undefined);
  assert.deepEqual(diffPoint(model, 248, 25), { path: 'x.ts', position: { line: 6, character: 1 }, diffLine: 'abc😀' });
  assert.equal(diffPoint(model, 238, 25, 20)?.position.character, 2);
  assert.equal(diffPoint(model, 238, 45)?.position.character, 3);
  assert.equal(diffPoint(model, 260, 45)?.position.character, 5);
  model.rows[0].cells = [cell('new')];
  assert.equal(diffPoint(model, 48, 25)?.position.character, 1);
});

test('diff buffers load complete files, prefer unsaved buffers and reject stale lines', async () => {
  const root = await mkdtemp(join(tmpdir(), 'paseo-diff-'));
  try {
    await writeFile(join(root, 'x.ts'), 'const a = 1;\r\nconst b = a;\r\n');
    const position = { line: 1, character: 10 };
    assert.deepEqual(await diffBuffers(root, 'x.ts', [], position, 'const b = a;'), [{ path: 'x.ts', text: 'const a = 1;\r\nconst b = a;\r\n' }]);
    await assert.rejects(diffBuffers(root, 'x.ts', [], position, 'old text'), /out of date/);
    const buffers = [{ path: 'x.ts', text: 'const a = 2;\nconst b = 2;' }];
    assert.equal(await diffBuffers(root, 'x.ts', buffers, position, 'const b = 2;'), buffers);
    await assert.rejects(diffBuffers(root, 'x.ts', buffers, position, 'const b = a;'), /out of date/);
    assert.equal(await diffBuffers(root, 'x.ts', buffers, position), buffers);
    await assert.rejects(diffBuffers(root, '../outside.ts', [], position, 'x'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('LSP occurrence boxes follow measured fragments, split columns and horizontal scrolling', () => {
  const cell = { content: '  caféName()', lineNumber: 4, sourceIdentity: { side: 'new' }, fragments: [
    { end: 6, graphemes: Array.from({ length: 6 }, (_, start) => ({ start, width: 7 })) },
    { end: 12, graphemes: Array.from({ length: 6 }, (_, i) => ({ start: i + 6, width: 7 })) },
  ] };
  const model = { viewportWidth: 400, lineHeight: 20, files: [{ path: 'x.ts', top: 0, bodyTop: 20, bottom: 100, gutterWidth: 30 }], rows: [{ kind: 'line', path: 'x.ts', top: 20, height: 40, reviewHeight: 0, cells: [null, cell] }] };
  const range = { start: { line: 3, character: 2 }, end: { line: 3, character: 10 } };
  assert.deepEqual(diffHighlights(model, 'x.ts', [range], 5), [{
    left: 238, top: 20, width: 162, height: 40,
    boxes: [{ left: 9, top: 0, width: 28 }, { left: -5, top: 20, width: 28 }],
  }]);
  assert.deepEqual(diffHighlights(model, 'x.ts', []), []);
  assert.deepEqual(diffHighlights(model, 'other.ts', [range]), []);
  assert.deepEqual(diffHighlights(model, 'x.ts', [{ start: { line: 7, character: 2 }, end: { line: 7, character: 10 } }]), []);
});

test('diff destinations require a matching new-side line and preserve wrapped UTF-16 positions', () => {
  const cell = { content: 'abc😀', lineNumber: 7, sourceIdentity: { side: 'new' }, fragments: [
    { end: 3, graphemes: [{ start: 0, width: 7 }, { start: 1, width: 7 }, { start: 2, width: 7 }] },
    { end: 5, graphemes: [{ start: 3, width: 14 }] },
  ] };
  const old = { ...cell, lineNumber: 8, sourceIdentity: { side: 'old' } };
  const model = { viewportWidth: 400, lineHeight: 20, files: [{ path: 'x.ts', top: 0, bodyTop: 20, bottom: 100, gutterWidth: 30 }], rows: [{ kind: 'line', path: 'x.ts', top: 20, height: 40, reviewHeight: 0, cells: [old, cell] }] };
  const target = (path: string, line: number, character: number) => ({ path, range: { start: { line, character }, end: { line, character } } });
  const result = diffDestination(model, target('x.ts', 6, 3));
  assert.equal(result?.index, 1); assert.equal(result?.part, 1);
  assert.equal(result?.top, 40); assert.equal(result?.x, 0);
  assert.equal(diffDestination(model, target('x.ts', 6, 5))?.x, 14);
  assert.equal(diffDestination(model, target('x.ts', 6, 6)), undefined);
  assert.equal(diffDestination(model, target('x.ts', 7, 1)), undefined);
  assert.equal(diffDestination(model, target('other.ts', 6, 1)), undefined);
});
