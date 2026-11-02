import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Languages } from '../server/languages.ts';

for (const extension of ['py', 'ts']) test(`${extension} diagnostics, hover and signature help follow unsaved buffers`, { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'paseo-diagnostics-'));
  const languages = new Languages();
  const path = `example.${extension}`;
  const python = extension === 'py';
  try {
    await mkdir(join(root, '.paseo'));
    const cli = fileURLToPath(new URL(python ? '../node_modules/basedpyright/langserver.index.js' : '../node_modules/typescript-language-server/lib/cli.mjs', import.meta.url));
    await writeFile(join(root, '.paseo/lsp.json'), JSON.stringify({ servers: { test: { command: process.execPath, args: [cli, '--stdio'], languages: { [extension]: python ? 'python' : 'typescript' }, initializationOptions: { tsserver: { useSyntaxServer: 'never' } } } } }));
    await writeFile(join(root, path), python ? 'value: int = 1\n' : 'const value: number = 1;\n');
    const buffers = [{ path, text: python ? 'value: int = "wrong"\n' : 'const value: number = "wrong";\n' }];
    const inspect = () => languages.inspect(root, 'diagnostics', path, buffers, { line: 0, character: 0 });
    let response;
    const deadline = Date.now() + 15_000;
    do {
      response = await inspect();
      if (response.diagnostics.some(item => item.severity === 1)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.ok(response.diagnostics.some(item => item.severity === 1 && item.range.start.line === 0), JSON.stringify(response));
    const hover = await languages.inspect(root, 'diagnostics', path, buffers, { line: 0, character: python ? 2 : 8 }, 'hover');
    assert.ok(hover.hover?.some(block => block.text.includes(python ? 'value' : 'number')), JSON.stringify(hover));
    buffers[0].text = python ? 'value: int = 1\n' : 'const value: number = 1;\n';
    assert.equal((await inspect()).diagnostics.length, 0, 'Kept diagnostics for an older document version');
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal((await inspect()).diagnostics.length, 0);
    buffers[0].text = python
      ? 'def greet(name: str, count: int) -> str:\n    return name * count\nresult = greet("Ada", 2)\n'
      : 'function greet(name: string, count: number): string { return name.repeat(count); }\nconst result = greet("Ada", 2);\n';
    const callLine = python ? 2 : 1;
    const call = buffers[0].text.split('\n')[callLine];
    const signature = (await languages.inspect(root, 'diagnostics', path, buffers, { line: callLine, character: call.indexOf(', 2') + 2 }, 'signature')).signature;
    assert.ok(signature, 'No signature help');
    assert.ok(signature.label.includes('count'), JSON.stringify(signature));
    assert.ok(signature.parameter, 'Missing active parameter');
    assert.ok(signature.label.slice(...signature.parameter).includes('count'), JSON.stringify(signature));
  } finally { await languages.dispose(); await rm(root, { recursive: true, force: true }); }
});

test('pull diagnostics work and pushed diagnostics with old versions are ignored', async () => {
  const root = await mkdtemp(join(tmpdir(), 'paseo-diagnostic-protocol-'));
  const languages = new Languages();
  const item = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'test warning', severity: 2 };
  const buffers = [{ path: 'example.py', text: 'x = 1\n' }];
  try {
    await mkdir(join(root, '.paseo')); await writeFile(join(root, 'example.py'), buffers[0].text);
    const save = (initializationOptions: unknown) => writeFile(join(root, '.paseo/lsp.json'), JSON.stringify({ servers: { test: { command: process.execPath, args: [fileURLToPath(new URL('./recording-server.mjs', import.meta.url)), join(root, 'trace')], languages: { py: 'python' }, initializationOptions } } }));
    const inspect = () => languages.inspect(root, 'test', 'example.py', buffers, { line: 0, character: 0 });
    await save({ pull: true, diagnostics: [item] });
    assert.equal((await inspect()).diagnostics[0].message, item.message);
    await save({ versionOffset: -1, diagnostics: [item] });
    await inspect(); await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal((await inspect()).diagnostics.length, 0);
    await save({ diagnostics: [item] });
    await inspect(); await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal((await inspect()).diagnostics[0].severity, 2);
    buffers[0].text = 'x = 2\n';
    await inspect(); await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal((await inspect()).diagnostics[0].severity, 2);
  } finally { await languages.dispose(); await rm(root, { recursive: true, force: true }); }
});
