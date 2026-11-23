# Language support for the native editor

Adds code navigation, diagnostics, hover information, signature help, autocomplete, and symbol rename to Paseo’s desktop/web file editor. Open files normally using Paseo’s file browser or file links. Use F12 for definition, Shift+F12 for references, or Cmd/Ctrl-click for definition. Multiple results open the Refs tab in the Explorer sidebar, showing the queried symbol and source location separately from jump history. Click a result to open its file with the symbol range selected. A single result opens directly. Empty results and errors show a brief notification; details remain available in Refs.

Open file editors show LSP error/warning squiggles with mouseover messages. Unsaved buffers sync after a short pause; diagnostics refresh approximately once per second. Squiggles require the CSS Custom Highlight API available in current desktop browsers and Paseo Electron. Hovering over other symbols shows their type/signature and documentation when the server supports hover. Tooltips inherit the editor’s monospace font and syntax-highlight Python and TypeScript/JavaScript code blocks and signatures. Prose and other languages remain plain text; server HTML is never executed. Inside a call, pausing the caret shows the active function signature and highlights the current argument. Ctrl+Shift+Space invokes signature help explicitly; Escape dismisses tooltips. Completion suggestions appear while typing or with Ctrl+Space; use arrow keys and Enter or Tab to accept, or Escape to dismiss. Completion edits participate in normal editor undo. Suggestions requiring snippets, extra edits, or commands are omitted. Only mounted buffers are supplied; closed files are not checked proactively.

Press **F2** in a native editor to rename a symbol. Enter the new name or cancel with Escape. Rename opens affected files in native tabs and checks their current buffers. For changes across files, review the proposed diffs in a confirmation dialog or open the diff tab before confirming or canceling. Confirmed edits enter the native editor buffers. Saving follows Paseo’s normal behavior, including autosave when enabled; undo is per file. External targets, file operations, conflicting panes, stale buffers and invalid edits fail before applying changes. Rename is limited to 30 affected files and the existing buffer limits.

This plugin injects navigation listeners into the native editor using private React pane context. It does not create an editor, file browser, or file-tab system, and it does not save files. Paseo continues to own editing, undo, saving, conflicts, tabs and file opening. The plugin directory and installation ID are `lsp`.

To restart the current workspace’s language servers, open the Command Center (Cmd/Ctrl+K) and choose **Restart LSP servers**. Sessions stop and start fresh on the next editor request, using the current config and unsaved buffers. Other workspaces are unaffected.

Requires Paseo 0.11.2 or later and language servers installed on the daemon host. Configure each workspace in **`.paseo/lsp.json`**; there is no plugin settings screen or host-wide fallback. For example:

```json
{
  "servers": {
    "python": {
      "command": "basedpyright-langserver",
      "args": ["--stdio"],
      "languages": { "py": "python", "pyi": "python" }
    },
    "backend-python": {
      "path": "backend",
      "command": "./.venv/bin/basedpyright-langserver",
      "args": ["--stdio"],
      "languages": { "py": "python", "pyi": "python" }
    },
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "languages": { "ts": "typescript", "tsx": "typescriptreact", "js": "javascript", "jsx": "javascriptreact" },
      "initializationOptions": { "tsserver": { "useSyntaxServer": "never" } }
    }
  }
}
```

Omit `path` to cover the workspace root. A specified path must be an existing directory inside the workspace. For each extension, the deepest matching directory wins: `backend` covers its descendants but not `backend-other`. Multiple servers for the same language are supported; overlapping extension mappings at the same canonical directory are rejected. Each process launches with its scoped directory as **CWD**, LSP `rootUri`, and workspace folder. Relative executable paths and arguments are interpreted from that directory. Unsaved buffers are sent only to their winning profile; returned targets can still point anywhere inside the workspace.

The config is read and validated on every navigation lookup. Saved changes take effect on the **next lookup**, without a plugin reload. Changes to parsed profiles restart that workspace's sessions, including buffer assignments. Invalid or missing config stops old sessions and reports an error; it never falls back to stale settings. JSON whitespace changes alone do not restart servers. The file is limited to 256 KiB.

Python is verified with **basedpyright**. Install it on the daemon host, for example with `uv tool install basedpyright`, or use a project-local executable as above. A ty profile uses `"command": "ty"`, `"args": ["server"]`, and the same Python language mapping; ty itself is not yet verified. JavaScript/TypeScript needs `typescript-language-server` and `typescript` on the daemon PATH. Remove the example `backend-python` entry unless that directory and executable exist.

Language servers run on the workspace host over stdio. LSP requests send text from mounted native editor buffers in the same host/workspace, including unsaved edits. Paseo retains modified native tabs; unmounted files are read by the language server from disk. The plugin uses Paseo’s existing RPC connection and opens no additional network service. Different unsaved versions of the same non-source file in multiple panes must be reconciled before navigation.

Verified on Paseo 0.15.0 on Linux with Python navigation, references, diagnostics, hover, signature help, autocomplete, rename, and server restart. The adapter depends on private React DOM keys, native editor selectors, CodeMirror DOM tiles, and Metro module loading for autocomplete. A Paseo update can break it and require an adapter update. It checks shapes and host/workspace identity; unrelated editors are left untouched. Mobile is unsupported. The adapter is mounted through the plugin’s sidebar contribution on its selected host; hiding that contribution or selecting a different plugin host can disable its listeners.

Workspace-external dependency locations are omitted and counted. A navigation request allows up to 30 buffers, 2 MiB per file and 8 MiB total, and returns up to 500 results. Lookups time out after 30 seconds; sessions expire after five idle minutes. Only basedpyright and TypeScript have been verified. Configured server executables are trusted host programs, and this plugin does not sandbox them.

Definition and usage jumps retain per-host/workspace browser-style history in Refs. On macOS, Ctrl+- goes back and Ctrl+Shift+- goes forward while focus is in an editor. The mouse back and forward buttons work while the pointer is over an editor. Click any history location to revisit it. New jumps after going back replace the forward trail. Successful jumps preserve the source selection; failed or empty lookups add no history. History lasts until the plugin disconnects/reloads. Locations are line/column snapshots, so edits can move their meaning or make them unavailable.

Working diffs support symbol type/documentation hover on the new side (the right side in split layout). Click a symbol, then use F12 for its definition or Shift+F12 for references; Cmd/Ctrl-click opens its definition directly. Pausing after a click shows call signatures when available; Ctrl+Shift+Space requests signature help. Results open native file tabs or the Refs panel. The queried diff line must match the current workspace file or its open unsaved buffer; refresh stale diffs before navigating. Historical commit diffs and deleted lines are excluded.

Pausing the editor caret on a symbol, or clicking one in a working diff, subtly highlights its occurrences in that file using LSP document highlights. Shadowed symbols with the same spelling are distinguished by the language server. Only new-side occurrences present in the diff are highlighted. This requires document-highlight support from the configured language server; there is no text-matching fallback. Moving the caret or clicking another symbol updates the highlights. Escape clears diff highlights.

Navigation started in a working diff stays in its tab when the target’s new-side line is present, including targets in other files and collapsed sections. Targets outside the displayed hunks open in an editor. Reference-result clicks use the same rule and can return to the originating diff tab.
