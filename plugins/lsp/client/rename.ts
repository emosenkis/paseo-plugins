import type { IntelligenceColors } from './intelligence.ts';
import { positionOffset, type RenameResult } from '../shared/contracts.ts';

export function renameChanges(file: RenameResult['files'][number], current: string) {
  if (current !== file.text) throw new Error('A rename target changed. Retry rename.');
  const changes = file.edits.map(edit => ({ from: positionOffset(current, edit.range.start), to: positionOffset(current, edit.range.end), insert: edit.newText })).sort((a, b) => a.from - b.from);
  for (let i = 0; i < changes.length; i++) if (changes[i].from > changes[i].to || (i > 0 && changes[i].from <= changes[i - 1].to)) throw new Error('Invalid or overlapping rename edits.');
  return changes;
}

function renameDialog(colors?: IntelligenceColors) {
  const dialog = document.createElement('dialog'); dialog.dataset.lspRename = '';
  const palette = colors ?? { surface0: '#ffffff', foreground: '#202124', border: '#c5c7cc', accent: '#3867d6' };
  dialog.style.setProperty('--surface', palette.surface0); dialog.style.setProperty('--foreground', palette.foreground);
  dialog.style.setProperty('--border', palette.border); dialog.style.setProperty('--accent', palette.accent);
  const style = document.createElement('style');
  style.textContent = `
    dialog[data-lsp-rename] { box-sizing:border-box; width:400px; max-width:calc(100vw - 32px); max-height:85vh; overflow:auto; padding:24px; border:1px solid var(--border); border-radius:12px; background:var(--surface); color:var(--foreground); font:14px/1.5 system-ui,sans-serif; box-shadow:0 16px 64px #0005; }
    dialog[data-lsp-rename]::backdrop { background:#0006; }
    dialog[data-lsp-rename] h2 { font-size:18px; line-height:1.4; margin:0 0 20px; }
    dialog[data-lsp-rename] h3 { font-size:14px; overflow-wrap:anywhere; }
    dialog[data-lsp-rename] label { display:block; }
    dialog[data-lsp-rename] input { box-sizing:border-box; display:block; width:100%; margin-top:8px; padding:9px 12px; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--foreground); font:14px/1.5 ui-monospace,monospace; }
    dialog[data-lsp-rename] footer { display:flex; justify-content:flex-end; flex-wrap:wrap; gap:8px; margin-top:24px; }
    dialog[data-lsp-rename] button { padding:8px 14px; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--foreground); font:inherit; cursor:pointer; }
    dialog[data-lsp-rename] button[type=submit], dialog[data-lsp-rename] button[data-primary] { border-color:var(--accent); box-shadow:inset 0 0 0 1px var(--accent); }
    dialog[data-lsp-rename] :is(input,button):focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
  `;
  dialog.append(style); return dialog;
}

export function renameInput(placeholder: string, colors?: IntelligenceColors): { result: Promise<string | null>; cancel(): void } {
  const dialog = renameDialog(colors);
  dialog.setAttribute('aria-label', 'Rename symbol');
  const form = document.createElement('form'); form.method = 'dialog';
  const label = document.createElement('label'); label.textContent = 'New symbol name ';
  const input = document.createElement('input'); input.value = placeholder; input.required = true; input.maxLength = 8000;
  label.append(input);
  const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Rename';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
  const title = document.createElement('h2'); title.textContent = 'Rename symbol';
  const actions = document.createElement('footer'); actions.append(cancel, submit);
  form.append(title, label, actions); dialog.append(form); document.body.append(dialog);
  let finish!: (value: string | null) => void;
  const result = new Promise<string | null>(resolve => { finish = value => { dialog.remove(); resolve(value); }; });
  form.addEventListener('submit', event => { event.preventDefault(); finish(input.value); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
  cancel.addEventListener('click', () => finish(null));
  dialog.showModal(); input.focus(); input.select();
  return { result, cancel: () => finish(null) };
}

export function renameDiff(file: RenameResult['files'][number]) {
  const changes = renameChanges(file, file.text);
  const groups: { from: number; to: number; changes: typeof changes }[] = [];
  for (const change of changes) {
    const from = change.from ? file.text.lastIndexOf('\n', change.from - 1) + 1 : 0;
    const next = file.text.indexOf('\n', change.to);
    const to = next < 0 ? file.text.length : next;
    const group = groups.at(-1);
    if (group && from <= group.to) { group.to = Math.max(group.to, to); group.changes.push(change); }
    else groups.push({ from, to, changes: [change] });
  }
  return groups.map(group => {
    let after = '', offset = group.from;
    for (const change of group.changes) { after += file.text.slice(offset, change.from) + change.insert; offset = change.to; }
    after += file.text.slice(offset, group.to);
    return { line: file.text.slice(0, group.from).split('\n').length, before: file.text.slice(group.from, group.to), after };
  });
}

export function renameReview(files: RenameResult['files'], openDiff: () => void, colors?: IntelligenceColors): { result: Promise<boolean>; cancel(): void } {
  const dialog = renameDialog(colors); dialog.setAttribute('aria-label', 'Review rename changes');
  dialog.style.width = '900px';
  const title = document.createElement('h2'); title.textContent = `Review rename in ${files.length} ${files.length === 1 ? 'file' : 'files'}`;
  const list = document.createElement('div'); list.style.cssText = 'max-height:55vh;overflow:auto';
  for (const file of files) {
    const section = document.createElement('section');
    const heading = document.createElement('h3'); heading.textContent = file.path; section.append(heading);
    for (const hunk of renameDiff(file)) {
      const pre = document.createElement('pre'); pre.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere';
      const location = document.createElement('div'); location.textContent = `Line ${hunk.line}`;
      const before = document.createElement('div'); before.style.color = '#c54242'; before.textContent = hunk.before.split('\n').map(line => `− ${line}`).join('\n');
      const after = document.createElement('div'); after.style.color = '#208249'; after.textContent = hunk.after.split('\n').map(line => `+ ${line}`).join('\n');
      pre.append(location, before, after); section.append(pre);
    }
    list.append(section);
  }
  const open = document.createElement('button'); open.type = 'button'; open.textContent = 'Open diff tab';
  const confirm = document.createElement('button'); confirm.type = 'button'; confirm.textContent = 'Confirm rename';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
  confirm.dataset.primary = '';
  const actions = document.createElement('footer'); actions.append(open, cancel, confirm);
  dialog.append(title, list, actions); document.body.append(dialog);
  let finish!: (value: boolean) => void, finished = false;
  const result = new Promise<boolean>(resolve => { finish = value => { if (finished) return; finished = true; dialog.remove(); resolve(value); }; });
  open.addEventListener('click', () => { dialog.close(); dialog.show(); openDiff(); });
  confirm.addEventListener('click', () => finish(true)); cancel.addEventListener('click', () => finish(false));
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
  dialog.showModal(); cancel.focus();
  return { result, cancel: () => finish(false) };
}
