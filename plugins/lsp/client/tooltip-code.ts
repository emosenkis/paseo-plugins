import { parser as python } from '@lezer/python';
import { parser as javascript } from '@lezer/javascript';
import { classHighlighter, highlightTree } from '@lezer/highlight';

const typescript = javascript.configure({ dialect: 'ts jsx' });
export function codeTokens(text: string, language: string) {
  const name = language.toLowerCase().split('.').at(-1)!;
  const parser = /^(py|pyi|python)$/.test(name) ? python : /^(ts|tsx|mts|cts|typescript|typescriptreact)$/.test(name) ? typescript : /^(js|jsx|mjs|cjs|javascript|javascriptreact)$/.test(name) ? javascript.configure({ dialect: 'jsx' }) : undefined;
  const tokens: { from: number; to: number; classes: string }[] = [];
  if (parser) highlightTree(parser.parse(text), classHighlighter, (from, to, classes) => tokens.push({ from, to, classes }));
  return tokens;
}

export function appendCode(parent: HTMLElement, text: string, language: string) {
  let position = 0;
  for (const token of codeTokens(text, language)) {
    parent.append(text.slice(position, token.from));
    const span = document.createElement('span'); span.className = token.classes; span.textContent = text.slice(token.from, token.to); parent.append(span);
    position = token.to;
  }
  parent.append(text.slice(position));
}
