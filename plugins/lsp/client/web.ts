import { Platform } from 'react-native';
import { renameDialog } from './rename.ts';

let dismissApproval: (() => void) | undefined;
export function cancelDiffCommands() { dismissApproval?.(); }

export async function confirmDiffCommands(workspace: string, snapshot: string): Promise<boolean> {
  if (Platform.OS !== 'web') return false;
  cancelDiffCommands();
  const tooltip = document.querySelector<HTMLElement>('[data-lsp-tooltip]');
  const colors = tooltip ? getComputedStyle(tooltip) : undefined;
  const dialog = renameDialog(colors ? { surface0: colors.backgroundColor, foreground: colors.color, border: colors.borderColor, accent: colors.color } : undefined);
  dialog.dataset.lspApproval = '';
  dialog.setAttribute('aria-label', 'Approve LSP commands for diffs');
  dialog.style.cssText += ';width:760px;display:flex;flex-direction:column;overflow:hidden';
  const title = document.createElement('h2'); title.textContent = `Allow working-diff language support in ${workspace}?`;
  title.style.flexShrink = '0';
  const warning = document.createElement('p');
  warning.textContent = 'These configured programs will run on the daemon host with access to its files and credentials. Only approve commands you trust. Approval expires when the plugin reloads or the configuration changes.';
  warning.style.cssText = 'margin:0 0 16px;flex-shrink:0';
  const commands = document.createElement('pre'); commands.textContent = JSON.stringify(JSON.parse(snapshot), null, 2);
  commands.style.cssText = 'overflow:auto;min-height:0;white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font:12px/1.5 ui-monospace,monospace';
  commands.tabIndex = 0; commands.setAttribute('aria-label', 'Language server commands and configuration');
  const actions = document.createElement('footer'); actions.style.flexShrink = '0';
  const cancel = document.createElement('button'); cancel.textContent = 'Cancel'; cancel.type = 'button';
  const approve = document.createElement('button'); approve.textContent = 'Approve commands'; approve.type = 'button'; approve.dataset.primary = '';
  actions.append(cancel, approve); dialog.append(title, warning, commands, actions); document.body.append(dialog);
  return new Promise<boolean>(resolve => {
    let finished = false;
    const finish = (approved: boolean) => {
      if (finished) return;
      finished = true; dialog.remove(); dismissApproval = undefined; resolve(approved);
    };
    dismissApproval = () => finish(false);
    cancel.addEventListener('click', () => finish(false));
    approve.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
    dialog.showModal(); cancel.focus();
  });
}
