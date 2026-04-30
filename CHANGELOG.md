# Changelog

All notable changes to 假名打字通 / Kana Typing are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The 0.x series
covers pre-MVP iterations; the 1.0 release lands when the desktop MVP is judged shippable.

## [Unreleased]

## [0.1.0] - 2026-04-30

Engineering scaffold. Not yet a usable product — the desktop app boots, has a `/dev` page that
seeds a 10-item N5 mini pack into a local SQLite, and reads the items back through Tauri
commands.

### Added

- pnpm workspace with shared TypeScript strict config (`noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, no `any`), ESLint flat config (typed rules limited to source +
  tests), Prettier, Vitest workspace, EditorConfig, `.nvmrc`, and a pinned `rust-toolchain.toml`
  on stable.
- `@kana-typing/core` — type-only domain package: `GameType`, `SkillDimension`, `ErrorTag`,
  `AnswerMode`, `MasteryState`, plus `LearningItem`, `TrainingTask`, `UserAttempt`,
  `EvaluationResult`, `SkillProgress`, `WeaknessVector`, `DailyPlan`, and supporting shapes.
  Severe error tags exported as a closed subset for Sprint 2's scoring rules.
- `@kana-typing/content-schema` — Zod schemas for content packs and a cross-field validator
  that checks duplicate ids, kana-only kana fields, romaji round-trip
  (`toRomaji(toKatakana(romaji)) === toRomaji(kana)`, which handles long vowels and sokuon
  correctly), example target containment, intra-pack confusable references, and audio paths.
  24 unit tests.
- SQL migrations 001–004 (idempotent): content packs + learning items + examples + confusables
  + audio assets; per-skill progress with 4 indexes; sessions + immutable attempt-event log
  with 3 indexes; daily plans + plan tasks. Same SQL is used by both the Rust runner and the
  Node CLI.
- `@kana-typing/content-cli` — `validate-pack` and `import-pack` commands. Idempotent upsert
  into a dev-mode SQLite (`local-data/kana_typing.sqlite`, gitignored). 5 tests.
- `content/official/n5-basic-mini.json` — 10 N5/N4 seed words, including a ビール↔ビル
  confusable pair to seed Sprint 4 cross-game error propagation.
- `apps/desktop` — Vite 6 + React 19 + Tauri 2 desktop app. Hash-based router with a
  `HomePlaceholder` and a `/dev` page. Three Tauri commands (`get_db_info`, `list_items`,
  `seed_test_pack`) backed by a `rusqlite` connection that runs the four migrations on
  startup against the OS user-data directory. App identifier `app.kana-typing.desktop`,
  product name 假名打字通.

### Engineering quality gates passing in CI-equivalent local runs

- `pnpm typecheck` (4 packages, all strict)
- `pnpm test` (34 unit tests across 3 packages)
- `pnpm lint` (0 errors, 0 warnings)
- `pnpm format:check` (Prettier clean)
- `pnpm build` (TS emit + Vite production bundle 199 KB / 62 KB gzip)
- `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`
- `pnpm content:validate content/official/n5-basic-mini.json` reports `OK (10 items)`
- `pnpm content:import content/official/n5-basic-mini.json` writes 10 items + 10 examples + 2
  confusable edges into the dev SQLite

### Notes

- Tauri `tauri:dev` / `tauri:build` and double-platform smoke tests (Windows x64) require a
  user-driven verification pass; this release ships the engineering scaffold that makes those
  runs possible.
- Codex review caught a TOCTOU race in the SQLite migration runner (two simultaneous app
  starts) and a misleading capability description; both fixed before tagging.
