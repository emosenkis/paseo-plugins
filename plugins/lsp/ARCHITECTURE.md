# Native editor navigation through an injected adapter

## Decision

Use Paseo’s existing file editor, file browser and native file tabs. The separate replacement editor has been deleted. Lack of a supported plugin API is a maintenance constraint, not evidence that injection is impossible.

The earlier read-only and replacement-editor prototypes were removed. The plugin now uses the directory and installation ID `lsp`; it adds a Navigation results panel and leaves editing, saving and file tabs to Paseo.

## What the live app proved

On the installed macOS Paseo 0.11.2 application, a temporary probe loaded through the real plugin client:

1. Traversed a native DOM element’s React fiber ancestors to find the existing pane context, including host/workspace identity, file target and `openFileInWorkspace`.
2. Called that native function to open `tests/fixtures/usage.py` as a real Paseo file tab.
3. Recovered the live editable CodeMirror view and cursor using `EditorView.findFromDOM`. This worked across the plugin’s separately bundled CodeMirror and the app’s own instance.
4. Dispatched F12 through the injected DOM listener. basedpyright returned one definition; the plugin called native file opening and selected `greet` inside the native `symbol.py` tab.
5. Dispatched Shift+F12 there. basedpyright returned two usages, including the call in `usage.py`.

The probe and its logging RPC were removed afterwards. Production code contains no hard-coded workspace ID and does not open sample files automatically.

## End-to-end flow

- A sidebar contribution mounts one adapter for the selected host. It renders no separate UI. API updates update that adapter without restarting it on ordinary React re-renders.
- Document-level capture listeners handle F12, Shift+F12, Cmd/Ctrl-click only inside native `file-source-editor` elements with a matching host, file pane and editable CodeMirror view. No CodeMirror extensions or state objects from the plugin are installed in the host instance.
- The adapter reads the native cursor and all mounted native buffers in that host/workspace. Duplicate source buffers use the focused source text. Conflicting copies of another file fail explicitly rather than silently choosing an unsaved version.
- Validated plugin RPC resolves the workspace on the daemon and reads `.paseo/lsp.json` and selects the most specific directory-scoped stdio language server profile by extension. Persistent sessions synchronize didOpen/didChange/didClose and document versions. TypeScript’s syntax-only fallback is disabled so navigation uses semantic project analysis.
- Microsoft vscode-jsonrpc handles framing and correlation. Both supported language servers use UTF-16 coordinates. Server-originated edits are rejected.
- Definition and LocationLink results become workspace-relative paths and exact ranges. Results, progress and errors publish to an in-memory store keyed by host/workspace. A supported workspace panel registered at `locations: ["explorer"]` renders the Navigation tab in the right sidebar; `client.openPanel` reveals it only for multiple results. A single result opens directly. Empty results and errors use Paseo’s supported toast/butter-bar API without selecting the panel. Result clicks retain native file navigation. There is no floating results UI or custom context menu.
- The adapter calls the pane’s native `openFileInWorkspace` with the target and line range. It waits for the destination editor, then dispatches a plain selection transaction and focuses it. Existing native file-opening paths continue to work unchanged.
- Pane lookup checks private shapes at runtime. Unknown editors/hosts are not intercepted. Disposal removes DOM listeners and workspace results, cancels pending destination waits and releases language sessions. Request deadlines, idle eviction and plugin shutdown terminate server processes; POSIX process groups include children.

## Diagnostics

`client/intelligence.ts` observes mounted native editors every 250 ms, debounces changed documents for 350 ms and refreshes diagnostics at most once per second per visible pane. Each scope keeps its own persistent session; background intelligence uses a separate editor ID from explicit navigation so closing a navigation surface cannot race its overlays. All sibling buffers are synchronized, and a response is discarded if any supplied buffer changed while it was running. DOM ranges are rebuilt after viewport DOM changes/scrolls, and diagnostics are cleared immediately on document changes.

The bridge handles `publishDiagnostics` (filtering explicit stale document versions) and pull diagnostics when advertised. A server that omits diagnostic versions cannot provide the same stale-report guarantee. Invalid reports are discarded. CSS Custom Highlights draw wavy error/warning underlines without injecting foreign CodeMirror state fields or changing native text/history. Mouseovers use text-only tooltips; no server-provided HTML is executed. Missing workspace config and uncovered extensions do not produce repeated background toasts. Cleanup removes highlights/tooltips/listeners and releases processes. Closed files are not proactively analyzed.

Hover uses `textDocument/hover` after a 250 ms pointer pause and checks the advertised capability. LSP MarkedString/MarkupContent forms become bounded text/code blocks, preserving fenced language information. Standalone Lezer parsers color Python and TypeScript/JavaScript code without installing extensions into Paseo’s CodeMirror. Tooltips inherit the native editor’s font and use theme-adjusted syntax colors. Prose and unknown languages remain plain text; all markup is constructed from text nodes and token spans. Pointer movement, scrolling, keystrokes, buffer changes and disposal invalidate outstanding responses. Diagnostic messages take precedence when hovering over a squiggle.

Signature help uses `textDocument/signatureHelp` after a focused caret/document change settles for 250 ms, or on Ctrl+Shift+Space. The server selects the call/overload; the client highlights the active parameter using LSP UTF-16 label offsets (or a string label). It renders signature labels with syntax coloring and preserves active-parameter emphasis; signature and parameter documentation remain plain text. Old caret/document/focus generations cannot reopen a tooltip, and Escape keeps it dismissed until the context changes or it is explicitly invoked. Unavailable hover/signature support returns an empty result without tearing down a healthy diagnostic session.

## Alternatives revisited

| Approach | Outcome |
| --- | --- |
| Supported native editor API | Still absent in SDK 0.11.2. Desirable future replacement for the adapter. |
| Inject listeners and use private native pane context | Chosen and proven in the actual app. Keeps native tabs, saves, history and browser; updates may break private structures. |
| Hijack file-opening callbacks to a custom renderer | Unnecessary now that native CodeMirror can be used directly. Adds more private coupling and would replace functionality Paseo already provides. |
| Replacement CodeMirror workbench | Implemented previously, then removed because separate tabs/browser do not meet the user’s requirements. |
| Monaco / VS Code service integration | Viable for a replacement IDE, but unnecessary for navigation in the existing editor. Host language servers already reuse VS Code-derived language intelligence. |

## Python

The workspace Python profile runs `basedpyright-langserver --stdio` for `.py` and `.pyi`. It has real multi-file definition/reference and unsaved-buffer tests. Configuration lives only in the workspace file; the former settings screen and migration code have been removed.

## Workspace configuration

See [configuration examples](OVERVIEW.md). Profiles have an optional workspace-relative directory `path`, defaulting to the workspace root. Canonical directories enforce containment and detect equal-scope extension conflicts. Deepest matching directory wins independently of declaration order. The process CWD and LSP root/folder use that directory, while result containment and relative paths use the entire workspace. Buffer overlays are filtered through the same winning-profile selection.

Each lookup reads a bounded UTF-8 JSON file and validates all profiles before selecting a session. Comparing parsed, resolved profiles avoids restarts for whitespace-only edits. Any profile change closes all sessions for that workspace, since adding/removing a deeper override changes existing buffer assignments too. Invalid/missing configuration also closes sessions and fails explicitly. No filesystem watcher is needed: changes apply at the next navigation request. Other workspaces retain their sessions.

A ty profile may use `command: "ty"`, `args: ["server"]`, and `languages: { "py": "python", "pyi": "python" }`. It is configurable but has not been tested; basedpyright satisfies the required Python backend. basedpyright was installed on the local daemon via `uv tool install basedpyright`.

## Scope and limits

Private coupling is isolated in `client/native.ts`: the `__reactFiber$` DOM key, native source selector, pane-context shape and native file-open request shape. No Paseo application checkout was modified. This was tested on 0.11.2; future updates may require changes. The plugin's sidebar item mounts the host-scoped adapter, so its selected host and visibility affect activation.

Paseo owns dirty-buffer retention. The plugin supplies mounted buffers; other files come from the server’s disk view. Servers requiring client-driven file watchers are not supported yet. Workspace-external locations are omitted, with no traversal or reading of those targets. Limits: 30 buffers, 2 MiB per buffer, 8 MiB total, 500 unique targets, 30-second request deadline and five-minute idle eviction. Windows lacks the POSIX process-group termination behavior. Mobile is not supported.

## Reproduce verification

`npm run typecheck` and `npm test` run the host checks, including real TypeScript and basedpyright sessions, scope/CWD/root verification, buffer isolation and config reload/failure behavior. `npm run browser-harness -- <workspace-id>` starts a development-only loopback fixture host. At its printed URL, run `await window.proof.runChecks()` to exercise the adapter through React-owned native-shaped panes and live daemon RPCs. The browser fixture validates opening callbacks, target selections, Python usages and unsaved buffers, Cmd-click handling, native context-menu preservation, panel opening, empty/error states, unknown-editor guards and listener cleanup. Diagnostics, hover and signature checks are exposed separately as `window.proof.diagnosticsChecks()`, `hoverChecks()` and `signatureChecks()`. The automated webview is in the background, so signature checks simulate document focus while exercising real LSP requests and cursor behavior. This harness does not replace the separate live-app navigation proof described above.

The local HTTP harness is not shipped, validates its HTTP origin/workspace, and exposes only this plugin's lookup/inspect/release RPCs. The installed plugin needs no HTTP service.

## References

- https://paseo.sh/docs/plugins/reference.md and SDK 0.11.2: plugin lifecycle, sidebar host identity, RPC/settings.
- Paseo source `panels/pane-context.tsx`, `file-pane/editor/view.web.tsx`, `screens/workspace/workspace-panel-host.tsx`: private pane context, CodeMirror view and retained mounted tabs.
- https://github.com/codemirror/view: DOM-to-view lookup and plain transaction dispatch.
- https://docs.basedpyright.com/latest/installation/command-line-and-language-server/
- https://docs.astral.sh/ty/editors/
- https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/
