// Development-only local HTTP harness; the installed plugin uses Paseo RPC directly.
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { fileURLToPath, URL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';

const workspaceId = process.argv[2];
if (!workspaceId) throw new Error('Usage: npm run browser-harness -- <workspace-id>');
const bundle = await build({ entryPoints: [fileURLToPath(new URL('./browser-entry.ts', import.meta.url))], bundle: true, platform: 'browser', format: 'esm', target: 'es2022', write: false });
const client = new DaemonClient({ url: 'ws://127.0.0.1:6767/ws', clientId: 'lsp-browser-proof', clientType: 'cli', reconnect: { enabled: false } });
await client.connect();
const methods: Record<string, string> = { lookup: 'editor.lookup', inspect: 'editor.inspect', release: 'editor.release' };
const server = createServer(async (request, response) => {
  try {
    if (/^\/fixtures\/(symbol|usage)\.(py|ts)$/.test(request.url ?? '')) { response.setHeader('Content-Type', 'text/plain'); response.end(await readFile(new URL('./fixtures/' + request.url!.split('/').at(-1), import.meta.url))); return; }
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text); return; }
    if (request.url?.startsWith('/?') || request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><head><title>LSP browser proof</title></head><body style="margin:0"><div id="root" style="height:100vh"></div><script type="module" src="/bundle.js"></script></body></html>'); return; }
    if (request.url !== '/rpc' || request.method !== 'POST') { response.writeHead(404).end(); return; }
    const address = server.address();
    if (!address || typeof address === 'string' || request.headers.origin !== `http://127.0.0.1:${address.port}`) { response.writeHead(403).end(); return; }
    let size = 0; const chunks = [];
    for await (const chunk of request) { size += chunk.length; if (size > 10 * 1024 * 1024) throw new Error('Request too large'); chunks.push(chunk); }
    const { method, input } = JSON.parse(Buffer.concat(chunks).toString());
    if (!Object.hasOwn(methods, method) || input.workspaceId !== workspaceId) throw new Error('Invalid proof RPC');
    const result = await client.invokePluginRpc('lsp', methods[method], input);
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(result));
  } catch (error) { response.writeHead(400, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); }
});
server.listen(0, '127.0.0.1', () => { const address = server.address(); if (address && typeof address !== 'string') console.log(`http://127.0.0.1:${address.port}/?workspaceId=${encodeURIComponent(workspaceId)}`); });
async function stop() { server.close(); await client.close(); }
process.once('SIGTERM', () => { void stop(); }); process.once('SIGINT', () => { void stop(); });
