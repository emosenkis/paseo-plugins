import { defineRpc, type RpcInput, type RpcOutput } from '@getpaseo/plugin';
import { z } from 'zod';

export const MAX_BYTES = 2 * 1024 * 1024;
const path = z.string().min(1).max(4096);
const workspace = z.object({ workspaceId: z.string().min(1) });
const file = workspace.extend({ path });
export const point = z.object({ line: z.number().int().min(0), character: z.number().int().min(0) });
export const range = z.object({ start: point, end: point });
export const target = z.object({ path: z.string(), range });
export type Target = z.output<typeof target>;
export const buffer = z.object({ path, text: z.string().max(MAX_BYTES) });
export const diagnostic = z.object({ range, message: z.string().max(8000), severity: z.number().int().min(1).max(4).default(1), source: z.string().max(200).optional(), code: z.union([z.string(), z.number()]).optional() });
export type Diagnostic = z.output<typeof diagnostic>;
export const signature = z.object({ label: z.string().max(8000), parameter: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional(), documentation: z.string().max(32_000).optional(), index: z.number().int().min(0), count: z.number().int().min(1).max(100) });
export type Signature = z.output<typeof signature>;
export const tooltipBlock = z.object({ text: z.string().max(32_000), language: z.string().max(80).optional() });
export const inspection = z.object({ diagnostics: z.array(diagnostic).max(1000), hover: z.array(tooltipBlock).max(128).nullable().optional(), signature: signature.nullable().optional() });
export type Inspection = z.output<typeof inspection>;
export const inspect = defineRpc({ name: 'editor.inspect', input: file.extend({ kind: z.enum(['diagnostics', 'hover', 'signature']).default('diagnostics'), editorId: z.string().min(1).max(100), position: point, buffers: z.array(buffer).min(1).max(30) }), output: inspection });
export const lookup = defineRpc({ name: 'editor.lookup', input: file.extend({ editorId: z.string().min(1).max(100), kind: z.enum(['definition', 'references']), position: point, buffers: z.array(buffer).min(1).max(30) }), output: z.object({ targets: z.array(target), omitted: z.number().int().min(0) }) });
export const release = defineRpc({ name: 'editor.release', input: workspace.extend({ editorId: z.string().min(1).max(100) }), output: z.object({}) });
export type EditorApi = {
  inspect(input: RpcInput<typeof inspect>): Promise<Inspection>;
  lookup(input: RpcInput<typeof lookup>): Promise<RpcOutput<typeof lookup>>;
  release(input: RpcInput<typeof release>): Promise<RpcOutput<typeof release>>;
};
export function positionOffset(text: string, position: z.output<typeof point>) {
  const lines = text.split('\n');
  const value = lines[position.line]?.replace(/\r$/, '');
  if (value === undefined || position.character > value.length) throw new Error('Position is outside the source buffer.');
  return lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.character;
}
