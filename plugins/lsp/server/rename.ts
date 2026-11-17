import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { range, positionOffset, type RenameResult } from '../shared/contracts.ts';
import { contained, checkedText } from './files.ts';

const edit = z.object({ range, newText: z.string().max(2 * 1024 * 1024) }).strict();
const workspaceEdit = z.object({
  changes: z.record(z.string(), z.array(edit).max(10000)).optional(),
  documentChanges: z.array(z.object({ textDocument: z.object({ uri: z.string(), version: z.number().int().nullable() }), edits: z.array(edit).max(10000) }).strict()).optional(),
}).strict();
export async function renameFiles(root: string, value: unknown, buffers: { absolute: string; text: string }[], documents: Map<string, { version: number }>): Promise<RenameResult> {
  if (value === null) return { files: [] };
  const parsed = workspaceEdit.parse(value);
  if (parsed.changes && parsed.documentChanges) throw new Error('Ambiguous rename edits.');
  const entries = parsed.documentChanges ?? Object.entries(parsed.changes ?? {}).map(([uri, edits]) => ({ textDocument: { uri, version: null }, edits }));
  if (entries.length > 30) throw new Error('Rename exceeds the 30-file limit.');
  const files: RenameResult['files'] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const { textDocument, edits } of entries) {
    const file = await contained(root, fileURLToPath(textDocument.uri));
    if (seen.has(file.absolute)) throw new Error('Duplicate rename target.');
    seen.add(file.absolute);
    if (textDocument.version !== null && documents.get(textDocument.uri)?.version !== textDocument.version) throw new Error('Rename document version changed.');
    const text = checkedText(buffers.find(buffer => buffer.absolute === file.absolute)?.text ?? await readFile(file.absolute, 'utf8'));
    total += Buffer.byteLength(text) + edits.reduce((sum, edit) => sum + Buffer.byteLength(checkedText(edit.newText)), 0);
    if (total > 8 * 1024 * 1024) throw new Error('Rename exceeds the 8 MiB limit.');
    const sorted = edits.map(edit => ({ start: positionOffset(text, edit.range.start), end: positionOffset(text, edit.range.end), newText: edit.newText })).sort((a, b) => a.start - b.start);
    for (let i = 0; i < sorted.length; i++) if (sorted[i].end < sorted[i].start || (i > 0 && sorted[i].start <= sorted[i - 1].end)) throw new Error('Invalid or overlapping rename edits.');
    const chunks: string[] = [];
    let offset = 0;
    for (const edit of sorted) { chunks.push(text.slice(offset, edit.start), edit.newText); offset = edit.end; }
    chunks.push(text.slice(offset));
    checkedText(chunks.join(''));
    files.push({ path: file.path, text, edits });
  }
  return { files };
}
