import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { MAX_BYTES } from '../shared/contracts.ts';

export async function contained(root: string, path: string) {
  const base = await realpath(root);
  const absolute = await realpath(resolve(base, path));
  const local = relative(base, absolute);
  if (!local || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) throw new Error('File must be inside this workspace. External symlinks are not supported.');
  if (!(await stat(absolute)).isFile()) throw new Error('Choose a regular file.');
  return { absolute, path: local.split(sep).join('/') };
}
export function checkedText(text: string) {
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new Error('Files are limited to 2 MiB.');
  if (Buffer.from(text, 'utf8').toString('utf8') !== text) throw new Error('Text contains an invalid Unicode surrogate.');
  if (text.includes('\0')) throw new Error('Binary files are not supported.');
  return text;
}
