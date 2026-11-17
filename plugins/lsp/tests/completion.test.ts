import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moduleIds } from '../client/metro.ts';

test('finds Metro module IDs from named exports without assuming their IDs', () => {
  const script = '__d(function(g,r){Object.defineProperty(g,"EditorState",{})},987,[1,2]);\n__d(function(g,r){Object.defineProperty(g,"EditorView",{})},42,[987]);\n__d(function(g,r){},3,[]);\n';
  assert.deepEqual(moduleIds(script, 'EditorState'), [987]);
  assert.deepEqual(moduleIds(script, 'EditorView'), [42]);
  assert.deepEqual(moduleIds(script, 'syntaxTree'), []);
});
