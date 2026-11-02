import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { contained, checkedText } from '../server/files.ts';
import { Languages, targets } from '../server/languages.ts';
import { positionOffset, MAX_BYTES } from '../shared/contracts.ts';

const plugin = fileURLToPath(new URL('../', import.meta.url));
const config = { languages: { ts: 'typescript' }, initializationOptions: { tsserver: { useSyntaxServer: 'never' } }, command: process.execPath, args: [resolve(plugin, 'node_modules/typescript-language-server/lib/cli.mjs'), '--stdio'] };
async function writeConfig(root: string, servers: unknown) {
  await mkdir(join(root, '.paseo'), { recursive: true });
  await writeFile(join(root, '.paseo/lsp.json'), JSON.stringify({ servers }));
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'paseo-editor-'));
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }));
  await writeFile(join(root, 'symbol.ts'), 'export function greet(name: string) { return name; }\n');
  await writeFile(join(root, 'usage.ts'), 'import { greet } from "./symbol";\nexport const message = greet("world");\n');
  await writeConfig(root, { typescript: config });
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}
async function read(root: string, path: string) { return { text: await readFile(join(root, path), 'utf8') }; }
async function buffers(root: string) { return Promise.all(['symbol.ts', 'usage.ts'].map(async path => ({ path, text: (await read(root, path)).text }))); }

test('buffer/path boundaries reject external symlinks, invalid Unicode and excess text', async () => {
  const { root, cleanup } = await fixture();
  const external = await mkdtemp(join(tmpdir(), 'paseo-editor-external-'));
  try {
    await writeFile(join(external, 'secret.py'), 'secret');
    await symlink(join(external, 'secret.py'), join(root, 'secret.py'));
    await assert.rejects(contained(root, 'secret.py'), /inside this workspace/);
    await assert.rejects(contained(root, external), /inside this workspace/);
    assert.throws(() => checkedText('\0'), /Binary/);
    assert.throws(() => checkedText('\ud800'), /invalid Unicode/);
    assert.throws(() => checkedText('a'.repeat(MAX_BYTES + 1)), /2 MiB/);
  } finally { await cleanup(); await rm(external, { recursive: true, force: true }); }
});

test('coordinates count UTF-16 and support CRLF', () => {
  assert.equal(positionOffset('one\r\n😀call()\r\n', { line: 1, character: 2 }), 7);
  assert.throws(() => positionOffset('one\r\n', { line: 0, character: 4 }), /outside/);
});

test('LocationLinks use symbol ranges, deduplicate, and report external/truncated targets', async () => {
  const { root, cleanup } = await fixture();
  try {
    const range = { start: { line: 0, character: 16 }, end: { line: 0, character: 21 } };
    const link = { targetUri: pathToFileURL(join(root, 'symbol.ts')).href, targetRange: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } }, targetSelectionRange: range };
    assert.deepEqual(await targets(root, [link, link, { uri: 'https://example.com/file', range }]), { targets: [{ path: 'symbol.ts', range }], omitted: 1 });
    const many = Array.from({ length: 502 }, (_, line) => ({ uri: link.targetUri, range: { start: { line, character: 0 }, end: { line, character: 1 } } }));
    const result = await targets(root, many);
    assert.equal(result.targets.length, 500); assert.equal(result.omitted, 2);
    await assert.rejects(targets(root, [{ uri: link.targetUri, range: { start: { line: -1, character: 0 }, end: { line: 0, character: 0 } } }]));
  } finally { await cleanup(); }
});

test('persistent TypeScript session follows unsaved edits in multiple buffers and closes overlays', { timeout: 60_000 }, async () => {
  const { root, cleanup } = await fixture();
  const languages = new Languages();
  try {
    const starts = join(root, 'starts');
    const wrapper = join(root, 'wrapper.mjs');
    await writeFile(wrapper, `import {appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(starts)}, 'start\\n'); await import(${JSON.stringify(pathToFileURL(config.args[0]).href)});`);
    const server = { ...config, args: [wrapper, '--stdio'] };
    await writeConfig(root, { typescript: server });
    const open = await buffers(root);
    const definition = await languages.lookup(root, 'editor', 'usage.ts', open, { line: 1, character: 24 }, 'definition');
    assert.equal(definition.targets[0].path, 'symbol.ts');
    assert.deepEqual(definition.targets[0].range.start, { line: 0, character: 16 });
    open[0].text = '\n' + open[0].text.replaceAll('greet', 'welcome');
    open[1].text = open[1].text.replaceAll('greet', 'welcome');
    const unsaved = await languages.lookup(root, 'editor', 'usage.ts', open, { line: 1, character: 24 }, 'definition');
    assert.deepEqual(unsaved.targets[0].range.start, { line: 1, character: 16 });
    const usages = await languages.lookup(root, 'editor', 'symbol.ts', open, { line: 1, character: 17 }, 'references');
    assert.ok(usages.targets.some(target => target.path === 'usage.ts' && target.range.start.line === 1));
    assert.equal((await readFile(starts, 'utf8')).trim(), 'start');
    assert.ok((await read(root, 'symbol.ts')).text.includes('greet'));
    // Closing unsaved tabs must remove their overlays; reopening saved buffers resolves disk names again.
    const restored = await languages.lookup(root, 'editor', 'usage.ts', [(await buffers(root))[1]], { line: 1, character: 24 }, 'definition');
    assert.equal(restored.targets[0].range.start.line, 0);
    await languages.release(root, 'editor');
  } finally { await languages.dispose(); await cleanup(); }
});

test('missing executables, deadlines and plugin teardown terminate language sessions', async () => {
  const { root, cleanup } = await fixture();
  const languages = new Languages();
  try {
    const open = await buffers(root);
    await writeConfig(root, { typescript: { ...config, command: join(root, 'missing') } });
    await assert.rejects(languages.lookup(root, 'editor', 'usage.ts', open, { line: 0, character: 1 }, 'definition'), /Cannot start/);
    const pidPath = join(root, 'pid');
    const hung = { ...config, args: ['-e', 'require("fs").writeFileSync(process.argv[1],String(process.pid));process.on("SIGTERM",()=>{});setInterval(()=>{},1000)', pidPath] };
    await writeConfig(root, { typescript: hung });
    await assert.rejects(languages.lookup(root, 'editor', 'usage.ts', open, { line: 0, character: 1 }, 'definition', 200), /timed out/);
    const pid = Number(await readFile(pidPath, 'utf8'));
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.throws(() => process.kill(pid, 0));
    await languages.dispose();
    await assert.rejects(languages.lookup(root, 'editor', 'usage.ts', open, { line: 0, character: 1 }, 'definition'), /stopped/);
  } finally { await languages.dispose(); await cleanup(); }
});

test('basedpyright resolves Python definitions/usages and unsaved cross-file symbols', { timeout: 60_000 }, async () => {
  const { root, cleanup } = await fixture();
  const languages = new Languages();
  try {
    await writeFile(join(root, 'pyrightconfig.json'), JSON.stringify({ include: ['*.py'], typeCheckingMode: 'off' }));
    await writeFile(join(root, 'symbol.py'), 'def greet(name: str) -> str:\n    return name\n');
    await writeFile(join(root, 'usage.py'), 'from symbol import greet\nmessage = greet("world")\n');
    const config = { languages: { py: 'python', pyi: 'python' }, command: process.execPath, args: [resolve(plugin, 'node_modules/basedpyright/langserver.index.js'), '--stdio'] };
    await writeConfig(root, { python: config });
    const buffers = await Promise.all(['symbol.py', 'usage.py'].map(async path => ({ path, text: (await read(root, path)).text })));
    const definition = await languages.lookup(root, 'python', 'usage.py', buffers, { line: 1, character: 12 }, 'definition');
    assert.equal(definition.targets[0].path, 'symbol.py');
    assert.deepEqual(definition.targets[0].range.start, { line: 0, character: 4 });
    const usages = await languages.lookup(root, 'python', 'symbol.py', buffers, { line: 0, character: 5 }, 'references');
    assert.ok(usages.targets.some(target => target.path === 'usage.py' && target.range.start.line === 1));
    buffers[0].text = '\n' + buffers[0].text.replaceAll('greet', 'welcome');
    buffers[1].text = buffers[1].text.replaceAll('greet', 'welcome');
    const unsaved = await languages.lookup(root, 'python', 'usage.py', buffers, { line: 1, character: 12 }, 'definition');
    assert.deepEqual(unsaved.targets[0].range.start, { line: 1, character: 4 });
    assert.ok((await read(root, 'symbol.py')).text.includes('greet'));
  } finally { await languages.dispose(); await cleanup(); }
});
