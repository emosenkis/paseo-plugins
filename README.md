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
See [example configurations](plugins/lsp/examples/README.md) for a ready-to-use TypeScript setup.

This checkout's `.paseo/lsp.json` launches the latest TypeScript and Python language servers
through `pnpx`. Install pnpm on the daemon host; pnpx downloads the packages on first use.
The TypeScript server uses the latest TypeScript 6 release because TypeScript 7 no longer
ships the `tsserver` it requires. The explicit `tsserver` path resolves from pnpx's environment.

Copied from [Covered-Health/paseo-plugins](https://github.com/Covered-Health/paseo-plugins) at
`dbe3e19baec869509690537f3e3cd8fe5adb972f`. Copyright (c) 2026 Protego Health; MIT licensed.

```shell
paseo plugin install https://github.com/emosenkis/paseo-plugins.git:plugins/lsp
```
