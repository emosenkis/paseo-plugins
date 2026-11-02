import { z } from 'zod';
import type { Signature } from '../shared/contracts.ts';
const documentation = z.union([z.string().max(32_000), z.object({ value: z.string().max(32_000) })]);
export function hoverContent(value: unknown): { text: string; language?: string }[] | null {
  const entry = z.union([z.string().max(32_000), z.object({ value: z.string().max(32_000), language: z.string().max(80).optional(), kind: z.enum(['plaintext', 'markdown']).optional() })]);
  const hover = z.object({ contents: z.union([entry, z.array(entry).max(20)]) }).nullable().parse(value);
  if (!hover) return null;
  const entries = Array.isArray(hover.contents) ? hover.contents : [hover.contents];
  const blocks: { text: string; language?: string }[] = [];
  let remaining = 32_000;
  const add = (text: string, language?: string) => {
    text = text.trimEnd().slice(0, remaining);
    if (!text.trim() || blocks.length >= 128 || !remaining) return;
    blocks.push({ text, ...(language ? { language } : {}) }); remaining -= text.length;
  };
  for (const entry of entries) {
    const text = typeof entry === 'string' ? entry : entry.value;
    if (typeof entry !== 'string' && entry.language) { add(text, entry.language); continue; }
    if (typeof entry !== 'string' && entry.kind === 'plaintext') { add(text); continue; }
    let offset = 0;
    for (const match of text.matchAll(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)\r?\n([\s\S]*?)^ {0,3}\1[ \t]*(?:\r?\n|$)/gm)) {
      add(text.slice(offset, match.index).trim());
      add(match[3], match[2].trim().split(/\s+/)[0].slice(0, 80) || 'text');
      offset = match.index + match[0].length;
    }
    add(text.slice(offset).trim());
  }
  return blocks.length ? blocks : null;
}

export function signatureInfo(value: unknown): Signature | null {
  const index = z.number().int().min(0);
  const parameter = z.object({ label: z.union([z.string().max(8000), z.tuple([index, index])]), documentation: documentation.optional() });
  const entry = z.object({ label: z.string().max(8000), documentation: documentation.optional(), parameters: z.array(parameter).max(200).optional(), activeParameter: index.optional() });
  const response = z.object({ signatures: z.array(entry).max(100), activeSignature: index.optional(), activeParameter: index.optional() }).nullable().parse(value);
  if (!response?.signatures.length) return null;
  const active = Math.min(response.activeSignature ?? 0, response.signatures.length - 1);
  const selected = response.signatures[active];
  const selectedParameter = selected.parameters?.[selected.activeParameter ?? response.activeParameter ?? 0];
  let offsets: [number, number] | undefined;
  if (selectedParameter) {
    const label = selectedParameter.label;
    const start = typeof label === 'string' ? selected.label.indexOf(label) : label[0];
    const end = typeof label === 'string' ? start + label.length : label[1];
    if (start >= 0 && end >= start && end <= selected.label.length) offsets = [start, end];
  }
  const docs = [selected.documentation, selectedParameter?.documentation].filter(item => item !== undefined).map(item => typeof item === 'string' ? item : item.value).join('\n\n').slice(0, 32_000);
  return { label: selected.label, parameter: offsets, documentation: docs || undefined, index: active, count: response.signatures.length };
}
