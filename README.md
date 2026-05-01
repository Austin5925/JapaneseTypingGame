# 假名打字通 / Kana Typing

A Japanese input reflex trainer built as a Tauri desktop app (React + Phaser + SQLite).

> Status: pre-alpha (`v0.7.1`). Desktop MVP candidate is in active hardening.

## Development

Requirements:

- Node.js >= 20.10 (`.nvmrc` pinned)
- pnpm >= 10
- Rust stable (`rust-toolchain.toml` pinned)

Setup:

```bash
pnpm install
```

Common scripts:

```bash
pnpm typecheck          # type-check every workspace package
pnpm lint               # ESLint flat config, 0-warning policy
pnpm format:check       # Prettier
pnpm test               # Vitest across all packages
pnpm build              # build all TS packages
pnpm tauri:dev          # run desktop app in dev mode
pnpm tauri:build        # build desktop app for the current platform
pnpm content:validate <path/to/pack.json>
pnpm content:import   <path/to/pack.json>
```

`content:import` defaults regular packs to `user_imported` quality and draft-tagged packs to
`needs_review`. Pass `--quality official` only for reviewed first-party packs.

## License

MIT
