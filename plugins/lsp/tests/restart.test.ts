import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Languages } from '../server/languages.ts';

test('restart replaces all workspace sessions and leaves other workspaces running', async () => {
  const roots = await Promise.all([1, 2].map(() => mkdtemp(join(tmpdir(), 'paseo-restart-'))));
  const languages = new Languages();
  try {
    for (const root of roots) {
      await mkdir(join(root, '.paseo'));
      await writeFile(join(root, 'test.py'), 'x = 1\n');
      await writeFile(join(root, '.paseo/lsp.json'), JSON.stringify({ servers: { test: {
        command: process.execPath,
        args: [fileURLToPath(new URL('./recording-server.mjs', import.meta.url)), join(root, 'trace')],
        languages: { py: 'python' },
      } } }));
    }
    const query = (root: string, editor: string) => languages.lookup(root, editor, 'test.py', [{ path: 'test.py', text: 'x = 2\n' }], { line: 0, character: 0 }, 'definition');
    const pids = async (root: string) => (await readFile(join(root, 'trace'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)).filter(item => item.event === 'initialize').map(item => item.pid);
    await query(roots[0], 'a'); await query(roots[0], 'b'); await query(roots[1], 'a');
    const before = await pids(roots[0]);
    await languages.restart(roots[0]);
    for (const pid of before) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    await query(roots[0], 'a'); await query(roots[0], 'b'); await query(roots[1], 'a');
    const after = await pids(roots[0]);
    assert.equal(after.length, 4);
    assert.ok(after.slice(2).every(pid => !before.includes(pid)));
    assert.equal((await pids(roots[1])).length, 1);
    await languages.restart(roots[0]); await languages.restart(roots[0]);
  } finally { await languages.dispose(); await Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))); }
});
