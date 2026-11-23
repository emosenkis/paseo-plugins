import { readFile, stat } from 'node:fs/promises';
import { contained, checkedText } from './files.ts';
import { MAX_BYTES, type Target } from '../shared/contracts.ts';

// A canvas diff contains hunks, not a complete document. Never send it as an overlay.
export async function diffBuffers(root: string, path: string, buffers: { path: string; text: string }[], position: Target['range']['start'], diffLine?: string) {
  if (diffLine === undefined) return buffers;
  let active = buffers.find(buffer => buffer.path === path);
  if (!active) {
    const file = await contained(root, path);
    if ((await stat(file.absolute)).size > MAX_BYTES) throw new Error('Files are limited to 2 MiB.');
    active = { path, text: checkedText(await readFile(file.absolute, 'utf8')) };
    buffers = [...buffers, active];
  }
  if (active.text.split(/\r?\n/)[position.line] !== diffLine) throw new Error('Diff is out of date with the workspace file. Refresh the diff first.');
  return buffers;
}
