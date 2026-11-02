import { appendFileSync } from 'node:fs';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';
const trace = process.argv[2];
const record = value => appendFileSync(trace, JSON.stringify({ pid: process.pid, ...value }) + '\n');
const connection = createMessageConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));
let options;
const documents = new Set();
connection.onRequest('initialize', params => {
  options = params.initializationOptions;
  record({ event: 'initialize', cwd: process.cwd(), params });
  return { capabilities: { definitionProvider: true, referencesProvider: true, ...(options?.pull ? { diagnosticProvider: {} } : {}) } };
});
const publish = params => connection.sendNotification('textDocument/publishDiagnostics', { uri: params.textDocument.uri, version: params.textDocument.version + (options?.versionOffset ?? 0), diagnostics: options?.diagnostics ?? [] });
connection.onNotification('textDocument/didOpen', params => { documents.add(params.textDocument.uri); if (!options?.pull) publish(params); });
connection.onNotification('textDocument/didChange', params => { if (!options?.pull) publish(params); });
connection.onRequest('textDocument/diagnostic', () => ({ kind: 'full', items: options?.diagnostics ?? [] }));
connection.onNotification('textDocument/didClose', params => documents.delete(params.textDocument.uri));
connection.onRequest('textDocument/definition', params => {
  record({ event: 'query', documents: [...documents] });
  return { uri: options?.target ?? params.textDocument.uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } };
});
connection.listen();
