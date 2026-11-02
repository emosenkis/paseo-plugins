import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hoverContent, signatureInfo } from '../server/details.ts';

test('hover normalizes LSP content forms without rendering HTML', () => {
  assert.equal(hoverContent(null), null);
  assert.equal(hoverContent({ contents: '' }), null);
  assert.deepEqual(hoverContent({ contents: { kind: 'markdown', value: '```python\n(value) x: int\n```\nDocs' } }), [{ text: '(value) x: int', language: 'python' }, { text: 'Docs' }]);
  assert.deepEqual(hoverContent({ contents: [{ language: 'typescript', value: 'const x: number' }, 'Docs'] }), [{ text: 'const x: number', language: 'typescript' }, { text: 'Docs' }]);
  assert.deepEqual(hoverContent({ contents: '<script>alert(1)</script>' }), [{ text: '<script>alert(1)</script>' }]);
  assert.deepEqual(hoverContent({ contents: { kind: 'plaintext', value: '```python\nnot code\n```' } }), [{ text: '```python\nnot code\n```' }]);
  assert.throws(() => hoverContent({ contents: { value: 42 } }));
});

test('signature help selects overloads and active parameters using UTF-16 offsets or labels', () => {
  assert.equal(signatureInfo(null), null);
  assert.equal(signatureInfo({ signatures: [] }), null);
  const value = signatureInfo({ activeSignature: 1, activeParameter: 0, signatures: [{ label: 'other()' }, { label: 'greet(name: str, count: int)', activeParameter: 1, documentation: { kind: 'plaintext', value: 'Repeat a greeting.' }, parameters: [{ label: 'name: str' }, { label: [17, 27], documentation: 'How many' }] }] });
  assert.deepEqual(value, { label: 'greet(name: str, count: int)', parameter: [17, 27], documentation: 'Repeat a greeting.\n\nHow many', index: 1, count: 2 });
  const label = 'fn(😀: str, count: int)';
  const from = label.indexOf('count'), to = label.length - 1;
  assert.deepEqual(signatureInfo({ signatures: [{ label, parameters: [{ label: [from, to] }] }] })?.parameter, [from, to]);
  assert.deepEqual(signatureInfo({ signatures: [{ label, parameters: [{ label: 'count: int' }] }] })?.parameter, [from, to]);
  assert.equal(signatureInfo({ signatures: [{ label, parameters: [{ label: [99, 100] }] }] })?.parameter, undefined);
});
