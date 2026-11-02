import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codeTokens } from '../client/tooltip-code.ts';

test('tooltip parsers tokenize Python and TypeScript, preserve offsets and leave unknown languages plain', () => {
  const python = 'def greet(name: str) -> str:\n    return "😀"\n';
  const tokens = codeTokens(python, 'python');
  assert.ok(tokens.some(token => token.classes.includes('tok-keyword') && python.slice(token.from, token.to) === 'def'));
  assert.ok(tokens.some(token => token.classes.includes('tok-string') && python.slice(token.from, token.to).includes('😀')));
  for (const [index, token] of tokens.entries()) { assert.ok(token.to <= python.length); if (index) assert.ok(tokens[index - 1].to <= token.from); }
  const ts = 'const x: number = 1;';
  assert.ok(codeTokens(ts, 'symbol.ts').some(token => token.classes.includes('tok-typeName') && ts.slice(token.from, token.to) === 'number'));
  assert.deepEqual(codeTokens('<img onerror=alert(1)>', 'unknown'), []);
});
