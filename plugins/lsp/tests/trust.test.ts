import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Languages } from '../server/languages.ts';

test('diff requests never launch unapproved commands, including after configuration changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'paseo-lsp-trust-'));
  const languages = new Languages();
  const trace = join(root, 'trace');
  const config = { servers: { python: { command: process.execPath, args: [fileURLToPath(new URL('./recording-server.mjs', import.meta.url)), trace], languages: { py: 'python' } } } };
  const save = () => writeFile(join(root, '.paseo/lsp.json'), JSON.stringify(config));
  const inspect = () => languages.inspect(root, 'diff-test', 'test.py', [{ path: 'test.py', text: 'x = 1\n' }], { line: 0, character: 0 }, 'hover', true);
  const lookup = () => languages.lookup(root, 'diff-test', 'test.py', [{ path: 'test.py', text: 'x = 1\n' }], { line: 0, character: 0 }, 'definition', 1000, true);
  try {
    await mkdir(join(root, '.paseo'));
    await writeFile(join(root, 'test.py'), 'x = 1\n');
    await save();
    const snapshot = await languages.approveDiffCommands(root);
    await assert.rejects(inspect(), /Approve LSP commands/);
    await assert.rejects(lookup(), /Approve LSP commands/);
    await assert.rejects(readFile(trace), { code: 'ENOENT' });
    await languages.approveDiffCommands(root, snapshot);
    await lookup();
    assert.match(await readFile(trace, 'utf8'), /initialize/);
    // Formatting-only edits keep approval; changed arguments must never start a new process.
    await writeFile(join(root, '.paseo/lsp.json'), JSON.stringify(config, null, 2));
    await lookup();
    const secondTrace = join(root, 'unapproved-trace');
    config.servers.python.args[1] = secondTrace;
    await save();
    await assert.rejects(inspect(), /Approve LSP commands/);
    await assert.rejects(lookup(), /Approve LSP commands/);
    await assert.rejects(readFile(secondTrace), { code: 'ENOENT' });
    await assert.rejects(languages.approveDiffCommands(root, snapshot), /changed during approval/);
    const changed = await languages.approveDiffCommands(root);
    await assert.rejects(inspect(), /Approve LSP commands/);
    await languages.approveDiffCommands(root, changed);
    await lookup();
    assert.match(await readFile(secondTrace, 'utf8'), /initialize/);
    const reloaded = new Languages();
    try {
      await assert.rejects(reloaded.lookup(root, 'diff-test', 'test.py', [{ path: 'test.py', text: 'x = 1\n' }], { line: 0, character: 0 }, 'definition', 1000, true), /Approve LSP commands/);
    } finally { await reloaded.dispose(); }
    config.servers.python.command = 'unapproved-nonexistent-command';
    await save();
    await assert.rejects(lookup(), /Approve LSP commands/);
  } finally { await languages.dispose(); await rm(root, { recursive: true, force: true }); }
});
