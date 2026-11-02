import { open, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import { z } from 'zod';
import { contained } from './files.ts';

export const CONFIG_FILE = '.paseo/lsp.json';
export const profile = z.object({
  path: z.string().min(1).default('.'),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  languages: z.record(z.string().regex(/^[a-z0-9]+$/), z.string().min(1)).refine(value => Object.keys(value).length > 0, 'Map at least one file extension to a language ID.'),
  initializationOptions: z.record(z.string(), z.unknown()).optional(),
}).strict();
export type Profile = z.output<typeof profile>;
export type ScopedServer = Profile & { name: string; root: string; scope: string };
const schema = z.object({ servers: z.record(z.string().min(1), profile) }).strict();

export async function readConfig(workspaceRoot: string): Promise<ScopedServer[]> {
  try {
    const root = await realpath(workspaceRoot);
    const file = await contained(root, CONFIG_FILE);
    const handle = await open(file.absolute, 'r');
    let text: string;
    try {
      const data = Buffer.alloc(256 * 1024 + 1);
      let length = 0;
      while (length < data.length) {
        const chunk = await handle.read(data, length, data.length - length, length);
        if (!chunk.bytesRead) break;
        length += chunk.bytesRead;
      }
      if (length > 256 * 1024) throw new Error('Config exceeds 256 KiB.');
      text = new TextDecoder('utf8', { fatal: true }).decode(data.subarray(0, length));
    } finally { await handle.close(); }
    const config = schema.parse(JSON.parse(text));
    const servers: ScopedServer[] = [];
    for (const [name, entry] of Object.entries(config.servers)) {
      if (isAbsolute(entry.path) || win32.isAbsolute(entry.path)) throw new Error(`Server "${name}" path must be workspace-relative.`);
      const directory = await realpath(resolve(root, entry.path.replace(/\\/g, '/')));
      const local = relative(root, directory);
      if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) throw new Error(`Server "${name}" path must stay inside the workspace.`);
      if (!(await stat(directory)).isDirectory()) throw new Error(`Server "${name}" path must be a directory.`);
      const scope = local.split(sep).join('/');
      for (const previous of servers) {
        if (previous.scope === scope && Object.keys(entry.languages).some(extension => extension in previous.languages)) throw new Error(`Servers "${previous.name}" and "${name}" overlap at the same path "${scope || '.'}". Use different scopes or extensions.`);
      }
      servers.push({ ...entry, name, root: directory, scope });
    }
    return servers;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Missing ${CONFIG_FILE} or a configured scope directory. Create the config and check its paths.`);
    throw new Error(`Invalid ${CONFIG_FILE}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function selectServer(servers: ScopedServer[], file: string): ScopedServer | undefined {
  const extension = extname(file).slice(1).toLowerCase();
  return servers.filter(server => extension in server.languages && (!server.scope || file.startsWith(server.scope + '/')))
    .sort((a, b) => b.scope.length - a.scope.length)[0];
}
