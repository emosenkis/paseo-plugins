# Native code navigation

Adds go-to-definition and find-usages to Paseo’s existing desktop/web file editor. Open files normally using Paseo’s file browser or file links. Use F12 for definition, Shift+F12 for usages, or Cmd/Ctrl-click for definition. Multiple results select a Refs tab in the right-hand Explorer sidebar. Click a result to open Paseo’s native file tab with the symbol range selected. A single definition or usage opens directly without selecting Navigation. No results and errors show a brief butter bar; details remain available in Navigation. The normal editor context menu is left untouched.

Open file editors show LSP error/warning squiggles with mouseover messages. Unsaved buffers sync after a short pause; diagnostics refresh approximately once per second. Squiggles require the CSS Custom Highlight API available in current desktop browsers and Paseo Electron. Hovering over other symbols shows their type/signature and documentation when the server supports hover. Tooltips inherit the editor’s monospace font and syntax-highlight Python and TypeScript/JavaScript code blocks and signatures. Prose and other languages remain plain text; server HTML is never executed; Inside a call, pausing the caret shows the active function signature and highlights the current argument. Ctrl+Shift+Space invokes signature help explicitly; Escape dismisses tooltips. Autocomplete is not included. They do not modify editor text or undo history. Only mounted buffers are supplied; closed files are not checked proactively.

This plugin injects navigation listeners into the native editor using private React pane context. It does not create an editor, file browser, or file-tab system, and it does not save files. Paseo continues to own editing, undo, saving, conflicts, tabs and file opening. The plugin directory and installation ID are `lsp`.

Configure each workspace in **`.paseo/lsp.json`**; there is no plugin settings screen or host-wide fallback. This checkout's file contains TypeScript and basedpyright profiles copied from its previous settings. Other workspaces need their own file:

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

Tested against Paseo 0.11.2 on macOS, including native Python file-tab navigation. The adapter depends on private React DOM keys, native editor selectors and pane context. A Paseo update can break it and require an adapter update. It checks shapes and host/workspace identity; unrelated editors are left untouched. Mobile is unsupported. The adapter is mounted through the plugin’s sidebar contribution on its selected host; hiding that contribution or selecting a different plugin host can disable its listeners.

Workspace-external dependency locations are omitted and counted. A navigation request allows up to 30 buffers, 2 MiB per file and 8 MiB total, and returns up to 500 results. Lookups time out after 30 seconds; sessions expire after five idle minutes. Only basedpyright and TypeScript have been verified. Configured server executables are trusted host programs, and this plugin does not sandbox them.

Definition and usage jumps retain per-host/workspace browser-style history in Refs. Alt+Left goes back; Alt+Right goes forward while focus is in an editor. On macOS, Ctrl+- and Ctrl+Shift+- do the same. The mouse back and forward buttons work while the pointer is over an editor. Click any history location to revisit it. New jumps after going back replace the forward trail. Successful jumps preserve the source selection; failed or empty lookups add no history. History lasts until the plugin disconnects/reloads. Locations are line/column snapshots, so edits can move their meaning or make them unavailable.
