import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout, clearTimeout, setInterval, clearInterval } from 'node:timers';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter, ResponseError, ErrorCodes } from 'vscode-jsonrpc/node';
import { z } from 'zod';
import { buffer, point, range, type Target, positionOffset, diagnostic, type Inspection } from '../shared/contracts.ts';
import { readConfig, selectServer, CONFIG_FILE, type ScopedServer } from './config.ts';
import { extname } from 'node:path';
import { hoverContent, signatureInfo } from './details.ts';
import { contained, checkedText } from './files.ts';

const provider = z.union([z.boolean(), z.record(z.string(), z.unknown())]);
const initialization = z.object({ capabilities: z.object({ positionEncoding: z.string().optional(), definitionProvider: provider.optional(), referencesProvider: provider.optional(), diagnosticProvider: provider.optional(), hoverProvider: provider.optional(), signatureHelpProvider: provider.optional() }) });
const location = z.object({ uri: z.string(), range });
const link = z.object({ targetUri: z.string(), targetRange: range, targetSelectionRange: range });
const locations = z.union([z.null(), location, z.array(z.union([location, link]))]);
export async function targets(root: string, value: unknown) {
  const parsed = locations.parse(value);
  const entries = parsed === null ? [] : Array.isArray(parsed) ? parsed : [parsed];
  const results: Target[] = [];
  const seen = new Set<string>();
  let omitted = 0;
  for (const entry of entries) {
    const uri = 'uri' in entry ? entry.uri : entry.targetUri;
    const selection = 'range' in entry ? entry.range : entry.targetSelectionRange;
    let file;
    try { if (!uri.startsWith('file:')) throw new Error('Not a workspace file'); file = await contained(root, fileURLToPath(uri)); }
    catch { omitted++; continue; }
    const item = { path: file.path, range: selection };
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    if (results.length >= 500) omitted++;
    else results.push(item);
  }
  return { targets: results, omitted };
}

class Session {
  child: ChildProcessWithoutNullStreams;
  connection: ReturnType<typeof createMessageConnection>;
  ready: Promise<z.output<typeof initialization>['capabilities']>;
  lastUsed = Date.now();
  private diagnostics = new Map<string, { version?: number; items: Inspection["diagnostics"] }>();
  private documents = new Map<string, { text: string; version: number }>();
  private queue: Promise<unknown> = Promise.resolve();
  private failure: Promise<never>;
  private reject!: (error: Error) => void;
  private closing?: Promise<void>;
  private stderr = '';
  readonly root: string;
  constructor(workspaceRoot: string, config: ScopedServer) {
    this.root = workspaceRoot;
    const root = config.root;
    this.child = spawn(config.command, config.args, { cwd: root, stdio: 'pipe', shell: false, detached: process.platform !== 'win32' });
    this.connection = createMessageConnection(new StreamMessageReader(this.child.stdout), new StreamMessageWriter(this.child.stdin));
    this.failure = new Promise((_, reject) => { this.reject = reject; });
    void this.failure.catch(() => {});
    const fail = (message: string) => this.reject(new Error(`${message}${this.stderr ? `\n${this.stderr}` : ''}`));
    this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + String(chunk)).slice(-2000); });
    this.child.once('error', error => fail(`Cannot start ${config.command}: ${error.message}. Install it on the daemon host or update .paseo/lsp.json.`));
    this.child.once('exit', (code, signal) => fail(`Language server exited (${code ?? signal}).`));
    this.connection.onClose(() => fail('Language server connection closed.'));
    this.connection.onError(([error]) => fail(error.message));
    this.connection.onNotification('textDocument/publishDiagnostics', (params: unknown) => {
      const report = z.object({ uri: z.string(), version: z.number().int().optional(), diagnostics: z.array(diagnostic).max(1000) }).safeParse(params);
      if (report.success && this.documents.has(report.data.uri)) this.diagnostics.set(report.data.uri, { version: report.data.version, items: report.data.diagnostics });
    });
    this.connection.onRequest((method, params: unknown) => {
      if (method === 'workspace/configuration') return z.object({ items: z.array(z.unknown()) }).parse(params).items.map(() => null);
      if (method === 'workspace/workspaceFolders') return [{ uri: pathToFileURL(root).href, name: root }];
      if (method === 'workspace/diagnostic/refresh') return null;
      if (method === 'window/workDoneProgress/create') return null;
      if (method === 'workspace/applyEdit') return { applied: false, failureReason: 'Language-server edits are not applied by this editor.' };
      throw new ResponseError(ErrorCodes.MethodNotFound, `Unsupported client request: ${method}`);
    });
    this.connection.listen();
    const connection = this.connection;
    this.ready = (async () => {
      const response = initialization.parse(await connection.sendRequest('initialize', {
        processId: process.pid, rootUri: pathToFileURL(root).href,
        workspaceFolders: [{ uri: pathToFileURL(root).href, name: root }],
        capabilities: { general: { positionEncodings: ['utf-16'] }, workspace: { configuration: true, workspaceFolders: true }, window: { workDoneProgress: true }, textDocument: { definition: { linkSupport: true }, references: {}, hover: { contentFormat: ['markdown', 'plaintext'] }, signatureHelp: { contextSupport: true, signatureInformation: { documentationFormat: ['plaintext', 'markdown'], parameterInformation: { labelOffsetSupport: true }, activeParameterSupport: true } }, publishDiagnostics: { versionSupport: true }, diagnostic: { dynamicRegistration: false } } },
        initializationOptions: config.initializationOptions,
      }));
      if (response.capabilities.positionEncoding && response.capabilities.positionEncoding !== 'utf-16') throw new Error('Language server selected an unsupported position encoding. UTF-16 is required.');
      await connection.sendNotification('initialized', {});
      return response.capabilities;
    })();
    void this.ready.catch(() => {});
  }
  query(files: { absolute: string; text: string; languageId: string }[], absolute: string, position: z.output<typeof point>, kind: 'definition' | 'references' | 'diagnostics' | 'hover' | 'signature', timeoutMs: number) {
    const work = this.queue.catch(() => {}).then(async () => {
      if (this.closing) throw new Error('Language server session closed. Retry navigation.');
      this.lastUsed = Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Language server navigation timed out. Retry to start a new session.')), timeoutMs); });
      try {
        return await Promise.race([this.failure, timeout, (async () => {
          const capabilities = await this.ready;
          if ((kind === 'definition' || kind === 'references') && !(kind === 'definition' ? capabilities.definitionProvider : capabilities.referencesProvider)) throw new Error(`Language server does not support ${kind}.`);
          const uris = new Set(files.map(file => pathToFileURL(file.absolute).href));
          for (const uri of this.documents.keys()) if (!uris.has(uri)) {
            await this.connection.sendNotification('textDocument/didClose', { textDocument: { uri } });
            this.documents.delete(uri); this.diagnostics.delete(uri);
          }
          for (const file of files) {
            const uri = pathToFileURL(file.absolute).href;
            const old = this.documents.get(uri);
            if (!old) {
              await this.connection.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: file.languageId, version: 1, text: file.text } });
              this.documents.set(uri, { text: file.text, version: 1 });
            } else if (old.text !== file.text) {
              this.diagnostics.delete(uri);
              await this.connection.sendNotification('textDocument/didChange', { textDocument: { uri, version: old.version + 1 }, contentChanges: [{ text: file.text }] });
              this.documents.set(uri, { text: file.text, version: old.version + 1 });
            }
          }
          if (kind === 'signature') return { diagnostics: [], signature: capabilities.signatureHelpProvider ? signatureInfo(await this.connection.sendRequest('textDocument/signatureHelp', { textDocument: { uri: pathToFileURL(absolute).href }, position, context: { triggerKind: 1, isRetrigger: false } })) : null };
          if (kind === 'hover') return { diagnostics: [], hover: capabilities.hoverProvider ? hoverContent(await this.connection.sendRequest('textDocument/hover', { textDocument: { uri: pathToFileURL(absolute).href }, position })) : null };
          if (kind === 'diagnostics') {
            const uri = pathToFileURL(absolute).href;
            if (capabilities.diagnosticProvider) {
              const report = z.discriminatedUnion('kind', [z.object({ kind: z.literal('full'), items: z.array(diagnostic).max(1000) }), z.object({ kind: z.literal('unchanged') })]).parse(await this.connection.sendRequest('textDocument/diagnostic', { textDocument: { uri } }));
              if (report.kind === 'full') this.diagnostics.set(uri, { version: this.documents.get(uri)?.version, items: report.items });
            }
            const report = this.diagnostics.get(uri);
            const current = this.documents.get(uri);
            return { diagnostics: report && (report.version === undefined || report.version === current?.version) ? report.items : [] };
          }
          const result = await this.connection.sendRequest(kind === 'definition' ? 'textDocument/definition' : 'textDocument/references', { textDocument: { uri: pathToFileURL(absolute).href }, position, ...(kind === 'references' ? { context: { includeDeclaration: false } } : {}) });
          return await targets(this.root, result);
        })()]);
      } catch (error) { await this.dispose(); throw error; }
      finally { clearTimeout(timer); this.lastUsed = Date.now(); }
    });
    this.queue = work;
    return work;
  }
  dispose() {
    return this.closing ??= (async () => {
      this.reject(new Error('Editor language session stopped.'));
      this.connection.dispose();
      const pid = this.child.pid;
      const signal = (force: boolean) => {
        if (!pid) return;
        try {
          if (process.platform === 'win32') this.child.kill(force ? 'SIGKILL' : 'SIGTERM');
          else process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM');
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      };
      signal(false);
      // Await the group kill even if its parent exits first: language servers can spawn children.
      await new Promise<void>(resolve => setTimeout(resolve, 300));
      signal(true);
    })();
  }
}

export class Languages {
  private sessions = new Map<string, Session>();
  private stopped = false;
  private configs = new Map<string, string>();
  private sweep = setInterval(() => {
    for (const [key, session] of this.sessions) if (Date.now() - session.lastUsed > 5 * 60_000) { this.sessions.delete(key); void session.dispose().catch(console.error); }
  }, 30_000);
  async lookup(root: string, editorId: string, path: string, buffers: z.output<typeof buffer>[], position: z.output<typeof point>, kind: 'definition' | 'references', timeoutMs = 30_000) {
    return await this.request(root, editorId, path, buffers, position, kind, timeoutMs) as { targets: Target[]; omitted: number };
  }
  async inspect(root: string, editorId: string, path: string, buffers: z.output<typeof buffer>[], position: z.output<typeof point>, kind: 'diagnostics' | 'hover' | 'signature' = 'diagnostics') {
    return await this.request(root, editorId, path, buffers, position, kind, 30_000) as Inspection;
  }
  private async request(root: string, editorId: string, path: string, buffers: z.output<typeof buffer>[], position: z.output<typeof point>, kind: 'definition' | 'references' | 'diagnostics' | 'hover' | 'signature', timeoutMs: number): Promise<{ targets: Target[]; omitted: number } | Inspection> {
    if (this.stopped) throw new Error('Editor plugin stopped.');
    root = await realpath(root);
    let servers: ScopedServer[];
    try { servers = await readConfig(root); }
    catch (error) { await this.reconcile(root, []); throw error; }
    await this.reconcile(root, servers);
    const file = await contained(root, path);
    const config = selectServer(servers, file.path);
    if (!config) throw new Error(`No LSP covers "${file.path}". Configure it in ${CONFIG_FILE}.`);
    let total = 0;
    const files = [];
    for (const buffer of buffers) {
      if (!(extname(buffer.path).slice(1).toLowerCase() in config.languages)) continue;
      const resolved = await contained(root, buffer.path);
      if (selectServer(servers, resolved.path) !== config) continue;
      total += Buffer.byteLength(checkedText(buffer.text));
      if (total > 8 * 1024 * 1024) throw new Error('Open buffers exceed the 8 MiB navigation limit. Close some files.');
      const languageId = config.languages[extname(resolved.path).slice(1).toLowerCase()];
      files.push({ ...resolved, text: buffer.text, languageId });
    }
    const active = files.find(item => item.absolute === file.absolute);
    if (!active) throw new Error('Active editor buffer was not supplied for this language server.');
    positionOffset(active.text, position);
    if (this.stopped) throw new Error('Editor plugin stopped.');
    // Another lookup can reload config while buffer paths are being resolved.
    if (this.configs.get(root) !== JSON.stringify(servers)) return this.request(root, editorId, path, buffers, position, kind, timeoutMs);
    const key = JSON.stringify([root, editorId, config]);
    let session = this.sessions.get(key);
    if (!session) {
      if (this.sessions.size >= 16) throw new Error('Too many editor language sessions. Close another editor and retry.');
      session = new Session(root, config); this.sessions.set(key, session);
    }
    try { return await session.query(files, file.absolute, position, kind, timeoutMs); }
    catch (error) { if (this.sessions.get(key) === session) this.sessions.delete(key); throw error; }
  }
  private async reconcile(root: string, servers: ScopedServer[]) {
    const signature = JSON.stringify(servers);
    if (this.configs.get(root) === signature) return;
    this.configs.set(root, signature);
    const closing = [];
    for (const [key, session] of this.sessions) {
      if (session.root === root) { this.sessions.delete(key); closing.push(session.dispose()); }
    }
    await Promise.all(closing);
  }
  async release(root: string, editorId: string) {
    root = await realpath(root);
    const closing = [];
    for (const [key, session] of this.sessions) {
      const [sessionRoot, sessionEditor] = JSON.parse(key);
      if (sessionRoot === root && sessionEditor === editorId) { this.sessions.delete(key); closing.push(session.dispose()); }
    }
    await Promise.all(closing);
  }
  async dispose() { this.stopped = true; this.configs.clear(); clearInterval(this.sweep); const sessions = [...this.sessions.values()]; this.sessions.clear(); await Promise.all(sessions.map(session => session.dispose())); }
}
