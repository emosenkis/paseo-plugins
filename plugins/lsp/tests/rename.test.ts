import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Languages } from '../server/languages.ts';
import { renameFiles } from '../server/rename.ts';
import { renameChanges, renameDiff } from '../client/rename.ts';
import { EditorState } from '@codemirror/state';

const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } };
test('rename validates snapshots and produces reversible CodeMirror changes', () => {
  const file = { path: 'a.ts', text: 'greet()', edits: [{ range, newText: 'welcome' }] };
  assert.throws(() => renameChanges(file, 'changed()'), /changed/);
  assert.throws(() => renameChanges({ ...file, edits: [...file.edits, ...file.edits] }, file.text), /overlapping/);
  let state = EditorState.create({ doc: file.text });
  const transaction = state.update({ changes: renameChanges(file, file.text), userEvent: 'input.rename' });
  const inverse = transaction.changes.invert(state.doc);
  state = transaction.state;
  assert.equal(state.doc.toString(), 'welcome()');
  state = state.update({ changes: inverse }).state;
  assert.equal(state.doc.toString(), file.text);
});

test('rename diff shows all edits with original lines and replacement text', () => {
  const files = { path: 'a.ts', text: 'greet(greet)\nother\ngreet()', edits: [
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, newText: 'hello' },
    { range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } }, newText: 'hello' },
    { range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } }, newText: 'hello' },
  ] };
  assert.deepEqual(renameDiff(files), [
    { line: 1, before: 'greet(greet)', after: 'hello(hello)' },
    { line: 3, before: 'greet()', after: 'hello()' },
  ]);
  assert.deepEqual(renameDiff({ path: 'b.ts', text: '\nx', edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'a' }] }), [{ line: 1, before: '', after: 'a' }]);
});

test('rename rejects external, overlapping, resource-operation and version-mismatched edits', async () => {
  const root = await mkdtemp('/tmp/paseo-rename-validation-');
  try {
    await writeFile(root + '/a.ts', 'greet()');
    const uri = pathToFileURL(root + '/a.ts').href, edit = { range, newText: 'hello' };
    await assert.rejects(renameFiles(root, { changes: { [uri]: [edit, edit] } }, [], new Map()), /overlapping/);
    await assert.rejects(renameFiles(root, { changes: { [pathToFileURL('/etc/hosts').href]: [edit] } }, [], new Map()), /inside/);
    await assert.rejects(renameFiles(root, { documentChanges: [{ kind: 'delete', uri }] }, [], new Map()));
    await assert.rejects(renameFiles(root, { documentChanges: [{ textDocument: { uri, version: 2 }, edits: [edit] }] }, [], new Map([[uri, { version: 1 }]])), /version/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const python of [false, true]) test(`real ${python ? 'Python' : 'TypeScript'} rename includes unsaved cross-file references`, async () => {
  const root = await mkdtemp('/tmp/paseo-rename-language-');
  const languages = new Languages();
  const ext = python ? 'py' : 'ts';
  const buffers = [
    { path: 'symbol.' + ext, text: python ? 'def greet(name: str) -> str:\n    return name\n' : 'export function greet(name: string) { return name; }\n' },
    { path: 'usage.' + ext, text: python ? 'from symbol import greet\nmessage = greet("world")\n' : 'import { greet } from "./symbol";\nexport const message = greet("world");\n' },
  ];
  try {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(root + '/.paseo');
    const modules = fileURLToPath(new URL('../node_modules/', import.meta.url));
    await writeFile(root + '/.paseo/lsp.json', JSON.stringify({ servers: { test: { command: process.execPath, args: [resolve(modules, python ? 'basedpyright/langserver.index.js' : 'typescript-language-server/lib/cli.mjs'), '--stdio'], languages: { [ext]: python ? 'python' : 'typescript' }, initializationOptions: { tsserver: { useSyntaxServer: 'never' } } } } }));
    await writeFile(root + (python ? '/pyrightconfig.json' : '/tsconfig.json'), JSON.stringify({ include: [python ? '*.py' : '*.ts'] }));
    for (const buffer of buffers) await writeFile(root + '/' + buffer.path, buffer.text);
    buffers[1].text += python ? 'another = greet("unsaved")\n' : 'const another = greet("unsaved");\n';
    const position = { line: 0, character: python ? 5 : 18 };
    const prepared = await languages.rename(root, 'rename-test', buffers[0].path, buffers, position);
    assert.equal(prepared.placeholder, 'greet');
    const result = await languages.rename(root, 'rename-test', buffers[0].path, buffers, position, 'welcome');
    assert.equal(result.files.length, 2);
    const usage = result.files.find(file => file.path === buffers[1].path)!;
    assert.equal(usage.text, buffers[1].text);
    assert.equal(usage.edits.length, 3);
    for (const file of result.files) assert.ok(renameChanges(file, file.text).every(change => change.insert === 'welcome'));
  } finally { await languages.dispose(); await rm(root, { recursive: true, force: true }); }
});
