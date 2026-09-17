# Paseo plugins

Plugins I write for Paseo live under `plugins/`.

## Development

```sh
cd plugins/agent-keep-awake
npm install
npm run typecheck
npm test
paseo plugin install .
```

`agent-keep-awake` prevents system sleep while any agent turn is running. It uses
`caffeinate` on macOS, `systemd-inhibit` on Linux, and `SetThreadExecutionState` through
PowerShell on Windows.
