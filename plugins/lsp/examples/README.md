# Example configurations

Copy [typescript.json](typescript.json) to `.paseo/lsp.json` in your workspace,
or merge its `servers` entry into your existing config.

Install pnpm on the daemon host to provide `pnpx`. On first use, pnpx downloads
the latest TypeScript language server and the latest TypeScript 6 release.
TypeScript 7 no longer ships the `tsserver` this language server requires.
The explicit `tsserver.path` resolves the executable from pnpx's environment.
