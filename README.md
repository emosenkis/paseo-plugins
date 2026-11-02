# Paseo plugins

Paseo plugins live under `plugins/`.

## Development

```sh
cd plugins/<plugin>
npm install
npm run typecheck
npm test
paseo plugin install .
```

## Agent keep-awake

`agent-keep-awake` prevents system sleep while any agent turn is running. It uses
`caffeinate` on macOS, `systemd-inhibit` on Linux, and `SetThreadExecutionState` through
PowerShell on Windows.

Install:

```shell
paseo plugin install https://github.com/emosenkis/paseo-plugins.git:plugins/agent-keep-awake
```

## LSP

Native code navigation for Paseo's file editor. See [the plugin overview](plugins/lsp/OVERVIEW.md)
for configuration and supported language servers.

This checkout's `.paseo/lsp.json` uses the language servers pinned in `plugins/lsp`.
Run `npm ci` in `plugins/lsp` to install them before using code navigation here.

Copied from [Covered-Health/paseo-plugins](https://github.com/Covered-Health/paseo-plugins) at
`dbe3e19baec869509690537f3e3cd8fe5adb972f`. Copyright (c) 2026 Protego Health; MIT licensed.

```shell
paseo plugin install https://github.com/emosenkis/paseo-plugins.git:plugins/lsp
```
