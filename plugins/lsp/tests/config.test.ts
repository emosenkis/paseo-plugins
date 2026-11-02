import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readConfig, selectServer } from '../server/config.ts';
import { Languages } from '../server/languages.ts';

const base = { command: process.execPath, languages: { py: 'python' } };
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'paseo-lsp-config-')));
  await mkdir(join(root, '.paseo'));
  for (const directory of ['backend/nested', 'backend-other']) await mkdir(join(root, directory), { recursive: true });
  const paths = ['main.py', 'backend/main.py', 'backend/nested/main.py', 'backend-other/main.py'];
  for (const path of paths) await writeFile(join(root, path), 'x = 1\n');
  return { root, paths, save: (servers: unknown) => writeFile(join(root, '.paseo/lsp.json'), JSON.stringify({ servers })), cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('workspace root is default, deepest matching directory wins, boundaries and canonical ties are enforced', async () => {
  const f = await fixture();
  try {
    await f.save({ nested: { ...base, path: 'backend/nested' }, root: base, backend: { ...base, path: 'backend' } });
    const servers = await readConfig(f.root);
    for (const [file, expected] of [['main.py', 'root'], ['backend/a.PY', 'backend'], ['backend/nested/a.py', 'nested'], ['backend-other/a.py', 'root']]) assert.equal(selectServer(servers, file)?.name, expected);
    assert.equal(servers.find(s => s.name === 'root')?.root, f.root);
    assert.equal(selectServer(servers, 'a.ts'), undefined);
    await f.save({ root: base, duplicate: { ...base, path: 'backend/..' } });
    await assert.rejects(readConfig(f.root), /overlap at the same path/);
    await f.save({ root: base, ts: { ...base, languages: { ts: 'typescript' } } });
    assert.equal((await readConfig(f.root)).length, 2);
  } finally { await f.cleanup(); }
});

test('config rejects malformed data and scopes outside the workspace or pointing at files', async () => {
  const f = await fixture();
  const outside = await mkdtemp(join(tmpdir(), 'paseo-outside-'));
  try {
    await assert.rejects(readConfig(f.root), /Missing/);
    for (const path of ['main.py', '../', outside, 'C:\\outside']) {
      await f.save({ bad: { ...base, path } });
      await assert.rejects(readConfig(f.root), /directory|inside|relative/);
    }
    await symlink(outside, join(f.root, 'escape'));
    await f.save({ bad: { ...base, path: 'escape' } });
    await assert.rejects(readConfig(f.root), /inside/);
    await f.save({ bad: { ...base, typo: true } });
    await assert.rejects(readConfig(f.root), /Invalid/);
    await writeFile(join(f.root, '.paseo/lsp.json'), '{');
    await assert.rejects(readConfig(f.root), /Invalid/);
  } finally { await f.cleanup(); await rm(outside, { recursive: true, force: true }); }
});

test('scoped process CWD/root, buffer isolation, workspace targets and saved config reload work end to end', async () => {
  const f = await fixture();
  const languages = new Languages();
  const trace = join(f.root, 'trace');
  const server = { ...base, args: [fileURLToPath(new URL('./recording-server.mjs', import.meta.url)), trace] };
  const rootServer = { ...server, initializationOptions: { target: pathToFileURL(join(f.root, 'main.py')).href } };
  const scoped = { ...rootServer, path: 'backend' };
  const buffers = f.paths.map(path => ({ path, text: 'unsaved = 1\n' }));
  const lookup = (path: string) => languages.lookup(f.root, 'editor', path, buffers, { line: 0, character: 1 }, 'definition');
  const events = async () => (await readFile(trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  try {
    await f.save({ root: rootServer, scoped, nested: { ...server, path: 'backend/nested' } });
    assert.equal((await lookup('backend/main.py')).targets[0].path, 'main.py');
    await lookup('backend/main.py');
    let log = await events();
    assert.equal(log.filter(e => e.event === 'initialize').length, 1);
    const initialized = log[0];
    assert.equal(initialized.cwd, join(f.root, 'backend'));
    assert.equal(initialized.params.rootUri, pathToFileURL(join(f.root, 'backend')).href);
    assert.equal(initialized.params.workspaceFolders[0].uri, initialized.params.rootUri);
    assert.deepEqual(log.at(-1).documents, [pathToFileURL(join(f.root, 'backend/main.py')).href]);
    await lookup('main.py');
    assert.deepEqual((await events()).at(-1).documents.sort(), ['main.py', 'backend-other/main.py'].map(p => pathToFileURL(join(f.root, p)).href).sort());
    // Removing overrides must close old processes and route their files/buffers to the root profile.
    await f.save({ root: rootServer });
    await lookup('backend/main.py');
    log = await events();
    assert.equal(log.filter(e => e.event === 'initialize').length, 3);
    assert.throws(() => process.kill(initialized.pid, 0));
    assert.equal(log.filter(e => e.event === 'initialize').at(-1).cwd, f.root);
    assert.equal(log.at(-1).documents.length, 4);
    const pid = log.at(-1).pid;
    await writeFile(join(f.root, '.paseo/lsp.json'), '{');
    await assert.rejects(lookup('main.py'), /Invalid/);
    assert.throws(() => process.kill(pid, 0));
    await f.save({ root: rootServer });
    await lookup('main.py');
    const restoredPid = (await events()).at(-1).pid;
    await rm(join(f.root, '.paseo/lsp.json'));
    await assert.rejects(lookup('main.py'), /Missing/);
    assert.throws(() => process.kill(restoredPid, 0));
  } finally { await languages.dispose(); await f.cleanup(); }
});
