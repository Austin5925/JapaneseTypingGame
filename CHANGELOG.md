# Changelog

All notable changes to 假名打字通 / Kana Typing are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The 0.x series
covers pre-MVP iterations; the 1.0 release lands when the desktop MVP is judged shippable.

## [Unreleased]

## [0.7.2] - 2026-05-01 — Bug fixes (LibraryPage 词义 / canvas 变形 / 诊断循环)

### Fixed

- LibraryPage now shows a 意思 column rendering `meaningsZh` for every item.
  The Tauri `list_items` projection grew a `meaningsZh` field (the column was
  always in the DB; only the projection omitted it), and `DevItemRow` on the
  TS side picked it up.
- Mole / SpeedChase prompt + sprite no longer rendered scaled-up and clipped
  on macOS. The `.r-crt` wrapper now flex-centres its child and forces
  `flex-shrink: 0` on descendants; the GameCanvasHost container declares
  `minWidth` / `minHeight` and `flex-shrink: 0` so a flex column ancestor
  can't compress its declared size and confuse Phaser's <canvas> CSS box.
- The diagnostic onboarding redirect on HomePage is now first-touch only.
  HomePage sets a `diagnosticOffered` localStorage marker before navigating
  to `/diagnostic`, so the user can return to home (whether they finished,
  skipped, or bailed) without bouncing back to the diagnostic. The previous
  `diagnosticSkipped`-only flag would loop the user back to diagnostic on
  every empty-progress home visit.

### Changed

- Synchronized package, Tauri, Cargo, shell version metadata to `0.7.2`.

## [0.7.1] - 2026-05-01 — Review hardening

### Fixed

- Restored scheduler bucket priority in `selectKanaTasks`: overdue rows now stay ahead of
  fragile / new / stable rows while preserving per-bucket shuffle and `preferTags` weighting.
- Content-pack enable toggles now affect the actual item source. `get_db_info` and
  `list_items` only count/read rows from enabled packs, so disabled packs are isolated from
  GamePage, DiagnosticPage, and LibraryPage candidates.
- Diagnostic onboarding now writes a real session plus `attempt_events` through
  `recordAttemptResult` instead of directly upserting progress. Initial progress remains
  available immediately while the immutable event log stays replayable.
- Home and Today Training now scan up to 5000 progress rows when building WeaknessVector,
  avoiding route decisions based on only the lowest-mastery 200 rows.
- Tauri renderer CSP is no longer disabled; the app now restricts script/style/object/frame
  sources while retaining Tauri IPC and Vite dev websocket connectivity.
- GitHub Actions now runs the Playwright web-preview smoke after build on the frontend matrix.
- Content CLI now defaults regular imports to `user_imported` and draft packs to
  `needs_review`; reviewed first-party packs can still opt into `--quality official`.

### Changed

- Synchronized package, Tauri, Cargo, shell, README, and lockfile version metadata to `0.7.1`.

## [0.7.0] - 2026-05-01 — MVP candidate (retro shell · diagnostic · packs · 500 words · CI)

### Added — visual identity & shell (P0-1, 9 commits)

- Full design-token system imported from `devdocs/design-handoff/tokens.css`:
  dark / light theme variables (dark default), 6-stop spacing, 4-stop radii,
  motion easing, 9 error-tag colours. Legacy aliases (`--bg/--fg/--muted/--border/
  --ok/--err`) kept as a compatibility layer for ImeInputBox / GameCanvasHost /
  dev pages.
- Inter / JetBrains Mono / VT323 / Press Start 2P / DotGothic16 bundled via
  `@fontsource/*` (offline-friendly; CJK falls back through Hiragino → Yu Gothic
  → Noto Sans CJK).
- `apps/desktop/src/styles/retro.css` — 金山-style admin shell vocabulary
  (`.r-app / .r-titlebar / .r-menubar / .r-toolbar / .r-sidebar / .r-statusbar /
  .r-group / .r-list / .r-btn / .r-input / .r-progress / .r-crt`), Win9x bevel
  + dithered + scanline + CRT vignette helpers.
- `RetroShell` — five-row admin shell: titlebar (KANA-TYPE.EXE branding +
  decorative window controls), menubar (5 cosmetic dropdowns), toolbar (PixIcon
  action buttons), sidebar (3-group nav: 训练 / 学习 / 系统 with active highlight
  derived from the route table), statusbar (version / dev links / locale / live
  clock).
- `errorTagPalette.ts` + `ErrorTagChip.tsx` + `PixIcon.tsx` — palette maps
  every ErrorTag to a CSS variable, the chip renders ErrorTag with colour +
  Chinese label, and PixIcon translates 17 16×16 pixel icons (home / today /
  mistakes / library / settings / play / pause / save / chart / medal / trend /
  user / mole / bolt / help / target / close) into inline SVG with overridable
  fill colour.
- All seven content pages re-skinned: HomePage / TodayTrainingPage /
  MistakesPage / LibraryPage / SettingsPage / ResultPage / GamePage. GamePage
  gains a `.r-crt` bezel + scanline wrapper around the Phaser canvas.

### Added — content & onboarding

- `content/official/daily-life-foundations-500.json` — 503-word hybrid content
  pack across six stages (基础 100 / 家与日常 98 / 饮食 95 / 交通 88 / 购物 97 /
  生活补充 25). Every item carries jlpt + skillTags + an example sentence; all
  items tagged `draft` pending native-speaker review. Wanakana round-trip
  validated end-to-end.
- `#/diagnostic` — five-step onboarding mini quiz (基础假名 / 片假名 /
  汉字读音 / 长音促音 / 日常 IME) that seeds initial SkillProgress rows so
  `buildWeaknessVector` + `selectGameBlocks` have data on day one. HomePage
  redirects new users to `/diagnostic` on first run; skipping sets a
  `diagnosticSkipped` localStorage flag so the gate doesn't loop.
- `#/settings/packs` — ContentPacksPage lists every imported content pack
  (LEFT JOIN learning_items so item_count tracks live row counts) with its
  quality / version / enabled state, exposes a per-pack enable toggle, and
  points at `pnpm content:import` for new imports. In-app file-picker import
  (Tauri dialog plugin + Zod boundary) deferred to v0.7.x.

### Added — IME mode (P0-3)

- Bidirectional `external` channel on `GameBridge` (`emitExternalInput` /
  `onExternalInput`) lets the React layer push IME-finalised values into a
  Phaser scene without the canvas stealing focus. SpeedChaseScene grew an
  `inputSource: 'phaser_keys' | 'external'` init flag; the existing romaji pump
  remains the default. `<GameCanvasHost>` exposes an `externalInputRef` so the
  page can call `current.commit(value)` straight into the active scene.
  `<GamePage>` mounts an `<ImeInputBox>` below the canvas when
  `inputMode='ime_surface'` and tags submitted attempts with
  `inputMethod: 'ime'`. URL routes accept `?inputMode=ime` (alias of
  `ime_surface`).

### Added — CI & E2E (P0-5)

- GitHub Actions workflow (`.github/workflows/ci.yml`) — frontend matrix on
  ubuntu-latest + macos-latest (typecheck / lint / format:check / test /
  build), Rust job on ubuntu-latest with apt-installed GTK + WebKit headers
  (cargo fmt / clippy --all-targets -D warnings / test --lib).
- Playwright web-preview smoke (`tests/e2e/`) — admin shell mounts, every
  primary sidebar nav entry visible, every primary route mounts without
  uncaught JS errors. Web preview only; real Tauri-mode E2E deferred to a
  later sprint.

### Fixed

- Game finish path resilient to dual-trigger races: `GameSessionService.finish`
  short-circuits on both `finished` AND `finishing` (concurrent calls were a
  source of the SpeedChase-stuck bug). GamePage's wall-clock timer and the
  bridge `finishSession` adapter wrap finish() in try/catch and run
  `navigateToResult()` unconditionally afterwards. GamePage now subscribes to
  `onSessionFinished` so the scene's natural completion (queue exhausted)
  also triggers result navigation.
- Canvas clipping: `.r-main` switched from `overflow: hidden` to
  `overflow: auto`; `.r-crt` declares `minWidth: 808` + `flexShrink: 0`. On
  narrow viewports the user gets a horizontal scroll instead of a silently
  truncated 800-wide canvas.
- Dev SQLite path: debug builds prefer `{repo}/local-data/kana_typing.sqlite`
  (walk up from `CARGO_MANIFEST_DIR` looking for `pnpm-workspace.yaml`) so
  `pnpm content:import` (which writes there by default) and `pnpm tauri:dev`
  share a database without `--db <ugly-os-path>`. Release builds unchanged.

### Notes

- v0.7.0 is the MVP candidate. v1.0.0 happens only when the user explicitly
  signals "推 1.0" (CLAUDE.md 工程纪律).
- The 500-word pack is AI-drafted (`draft` tag); a native-speaker review pass
  is required before promoting individual entries to `quality: official`.
- Tauri dialog-plugin import + ContentPacksPage file picker deferred to
  v0.7.x. Real Tauri-mode E2E deferred similarly.

## [0.6.1] - 2026-05-01 — Review fixes

### Fixed (`apps/desktop`)

- Today-training game links now carry `durationMs` and `skillDimension` into the game route, so
  planner blocks such as 90s `katakana_recognition` drills no longer degrade into the default
  60s `kana_typing` Mole configuration.
- Game sessions now load persisted progress before task selection and preserve item
  `tags` / `skillTags` / `acceptedKana` from SQLite. `selectKanaTasks` can therefore prioritise
  overdue / fragile / learning rows and filter queues by the requested skill dimension.
- The Tauri `list_items` projection now returns the metadata needed by the scheduler-facing
  frontend instead of reducing content rows to only id / surface / kana / romaji.

### Fixed (`@kana-typing/core`, `@kana-typing/game-runtime`)

- `selectKanaTasks` filters candidates by skill dimension, including katakana-only Mole drills
  and kanji-reading SpeedChase queues, with regression tests for both paths.
- SpeedChase no longer receives a fixed 7000ms task limit from the page layer; the scene's
  dynamic difficulty timer now drives each task and is mirrored back onto the task for scoring.
- `GameBridgeImpl.emit` isolates throwing listeners with per-handler try/catch so one HUD /
  analytics listener cannot break sibling listeners or the Phaser pump.

### Changed

- Synchronized public package, Tauri, and Cargo version metadata to `0.6.1`.
- Extended `.gitignore` for local Codex / OpenAI agent memory files (`AGENTS.md`, `CODEX.md`,
  `.codex/`, lowercase variants) plus internal handoff docs.

### Verification

- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `PATH=/Users/ausdin/.volta/bin:$PATH pnpm test`
- `PATH=/Users/ausdin/.volta/bin:$PATH pnpm build`
- `cargo fmt --all -- --check`
- `cargo clippy --all-targets -- -D warnings`
- `cargo test`

## [0.6.0] - 2026-05-01 — MVP candidate

Sprint 5 — full user path. The scaffold now backs a complete loop:
home → today → game → result → mistakes → library → settings.

### Added (`@kana-typing/core/planning`)

- `weaknessVector.ts` — `buildWeaknessVector(progressList, recentErrors)` rolls per-skill
  mastery + recent error counts into a WeaknessVector. Skills with no observed items
  default to 0.7 so the planner schedules them rather than skipping; `kana_typing` folds
  into both `kana_recognition` and `katakana_recognition` so a user who only plays mole
  doesn't have permanent 0.7 defaults on those fields. weakestItems sorts by
  `1 - masteryScore/100` desc.
- `dailyPlanService.ts` — `selectGameBlocks(vector, targetDurationMs)` picks the day's
  training blocks: katakana > 0.6 → mole; kanji_reading > 0.5 → speed_chase; long-vowel /
  sokuon / dakuten in topErrorTags → extra mole drill (apple_rescue stand-in until that
  scene ships); empty-state fallback always returns mole + speed-chase.
  fitBlocksToDuration trims to the budget.
- 13 new unit tests across the two files.

### Added (`apps/desktop`)

- Tauri commands `list_progress` (sorted by mastery_score asc) and
  `aggregate_recent_error_tags` (scans attempt_events.error_tags_json over a window).
  Frontend wrappers in invoke.ts.
- `pages/HomePage` (replaces HomePlaceholder) — three weakest skills + top recent error
  tags + CTA to /today. Empty-state routes to /dev for seeding.
- `pages/TodayTrainingPage` — `selectGameBlocks` against the live weakness vector;
  ordered list of game blocks with reason / duration / hash link.
- `pages/MistakesPage` — recent wrong attempts grouped by error tag (30-day window;
  client-side join with up to 1000 most-recent attempts).
- `pages/LibraryPage` — items × (kanji_reading, kana_typing, meaning_recall) mastery
  matrix.
- `pages/SettingsPage` — minimal: DB path + applied migrations + item count + dev link.
- `App.tsx` adds /today, /mistakes, /library, /settings routes; nav reorganised so the
  user-facing routes lead and dev routes are tucked to the right.

### Notes

- Codex backend remained unresponsive; feature-dev:code-reviewer ran the audit. Three
  must-fix items addressed before tagging:
  - App.tsx had silently dropped the new-route registration in earlier passes; the
    Sprint 5 pages were dead until this commit.
  - `kana_typing` fold was incomplete (only into kana_recognition, not katakana_recognition).
  - MistakesPage 200-attempt cap was too low for a 30-day aggregate window; raised to
    1000 with a v0.7 TODO to add a SQL date-range filter.
- Tauri-boundary type validation (Zod parse on invoke results) is documented as v0.7
  work — today no path writes invalid strings, but user-imported content packs will
  expose this gap.
- Real new-user diagnostic flow + content-pack management page + IME preferences land
  in v0.7+. v0.6.0 is the MVP candidate per plan.md §7 — it does NOT auto-promote to
  v1.0.0; the user explicitly drives that decision.

## [0.5.0] - 2026-04-30

Sprint 4 — second Phaser scene + parametrised game page. Visit `#/game/speed-chase` to play
3 minutes of kanji-reading sprint. Cross-game error routing already takes effect through the
Sprint 2 progress / scheduler / selector pipeline (an item that drops to `fragile` after
SpeedChase misses gets surfaced first in the next Mole session via the bucket-1 priority in
`selectKanaTasks`).

### Added (`@kana-typing/game-runtime`)

- `scenes/SpeedChaseScene` — kanji prompt + player + pursuer indicator on a track lane.
  Correct answers nudge the player forward; wrong answers / timeouts close the gap.
  Per-task timer driven by the difficulty curve; `locked` flag wraps commit/timeout so the
  post-submit feedback window can't double-submit (same fix as MoleScene). `update()`
  caps Phaser's delta at 50ms so a throttled WebView can't lurch the pursuer 30x in one
  frame.
- `scenes/speedChaseDifficulty` — pure `getSpeedChaseDifficulty(elapsedMs, accuracy)`
  function isolated from Phaser so unit tests can run under jsdom. 6 tests pin the timer
  ramp + accuracy multiplier + pursuer speed growth.
- `PhaserGameManager.startSpeedChaseScene` + the generic `startScene(key, opts)`. The
  scene-registration array is now the source of truth — Phaser silently no-ops if the key
  isn't registered, so adding a scene without registering it would be invisible at runtime.

### Added (`apps/desktop`)

- `features/game/GameCanvasHost.sceneKey` prop typed as `'MoleScene' | 'SpeedChaseScene'`.
  The effect now depends on `[sessionId, sceneKey]` so scene swaps tear down + re-mount.
- `pages/GamePage.mode` prop with `'mole' | 'speed-chase'`. MODE_CONFIG holds the per-mode
  duration / scene key / answer mode / skill dimension / task count / time limit.
- `App.tsx` route `#/game/speed-chase`.
- Tauri command `list_attempts_by_session(sessionId)` and matching invoke wrapper.
  ResultPage now uses it directly instead of filtering listRecentAttempts client-side
  (that client-side filter would silently drop attempts past its 500-row limit once
  Sprint 5 starts accumulating MistakesPage history).

### Notes

- Codex backend hung again at the broker layer; feature-dev:code-reviewer ran the audit
  instead. Findings: (a) SpeedChaseScene was registered as a startScene method but missing
  from PhaserGameManager's `scene: [...]` array — silent no-op until fixed; (b) ResultPage
  client-side filter would break with accumulated history; (c) pursuer integration needed
  delta clamping. All three addressed before tagging.
- Real OS-IME via ImeInputBox alongside the canvas, multi-reading kanji enforcement at
  pack-validation time, and Boss-style game-over remain Sprint 5+ items.

## [0.4.0] - 2026-04-30

Sprint 3 — the Phaser game runtime + MoleScene MVP. Visit `#/dev` to seed the N5 mini pack,
then `#/game/mole` to play 60 seconds of whack-a-mole, then land on `#/result/<sessionId>`
for a session summary. attempt_events + item_skill_progress are populated by the same
transactional record_attempt_result Tauri command shipped in v0.3.0.

### Added (`@kana-typing/game-runtime` — new package)

- `bridge/GameBridge` — discriminated GameRuntimeEvent union + GameBridgeImpl with set-of-
  listeners-per-type, snapshot-during-emit so a mid-emit unsubscribe doesn't break siblings,
  per-handler try/catch so a throwing listener doesn't break the pump.
- `scenes/BaseTrainingScene` — abstract Phaser.Scene with the task pump (loadNextTask →
  spawnTask → submitAttempt → loadNextTask). Subclasses implement createBackground /
  createHudLayer / spawnTask / showFeedback. busy/finished flags prevent double submit/finish.
- `scenes/MoleScene` — whack-a-mole. Single mole at a time, 64px kana on a rounded-rectangle
  pillar, romaji-only keyboard buffer (a-zA-Z plus apostrophe + hyphen, Backspace, Enter),
  Phaser-driven 6s task timeout. A `locked` flag wraps commit/timeout end-to-end so the
  800ms post-submit feedback window can't double-submit.
- `PhaserGameManager` — singleton lifecycle. `startMoleScene(opts)` plus a generic
  `startScene(key, opts)` for Sprint 4's SpeedChaseScene.
- 4 unit tests on GameBridgeImpl (jsdom).

### Added (`@kana-typing/core`)

- `planning/kanaTaskSelector` — `selectKanaTasks(input)` builds a fixed-length task queue
  bucketed by scheduler urgency (overdue → fragile/learning → seen/new → stable/fluent),
  shuffled with an injectable RNG. SelectedTaskQueue exposes next() / remaining() /
  pushFront() so MoleScene can route a severe-error attempt back to the head of the queue
  for in-session retry. 7 unit tests.

### Added (`apps/desktop`)

- `features/game/GameCanvasHost` — mounts a single PhaserGameManager + GameBridgeImpl per
  session. Adapter is held in a ref so prop changes don't tear Phaser down.
- `features/game/GameHud` — React-side overlay with remaining-time + accuracy.
- `pages/GamePage` (`#/game/mole`) — 60-second mole training. Bufferless persistence
  (record_attempt_result transactional Tauri command), severe-error pushFront retry,
  60-second React timer auto-finishes + redirects to result.
- `pages/ResultPage` (`#/result/:sessionId`) — accuracy / avg reaction / top error tags /
  5 slowest attempts. Reads list_recent_attempts and filters client-side; per-session API
  arrives in Sprint 4.

### Notes

- Codex review caught two must-fix items (MoleScene 800ms race, emit listener-exception
  isolation) — both addressed before tagging.
- Real-keyboard / IME / focus verification on macOS is the user-driven step.

## [0.3.0] - 2026-04-30

Sprint 2 — the evaluation/scoring/mastery/scheduler layer plus the SQLite-backed session and
attempt persistence. The `/dev/eval` route exercises the entire pipeline live: pick an item,
type an answer, see the EvaluationResult, the persisted attempt row, and the updated progress
record.

### Added (`@kana-typing/core`)

- `evaluation/scoring.ts` — `scoreAttempt(input)` returns
  `{raw, accuracy, speed, penalty, quality}`. Speed clamped 0..1.2 against a 300ms reaction
  floor; severe Japanese errors (long_vowel/sokuon/dakuten/particle/meaning/ime) cap quality
  regardless of raw speed; using a hint caps quality at 3.
- `evaluation/crossGameEffects.ts` — `buildCrossGameEffects(evaluation)` maps each ErrorTag to
  forwarded `{targetGameType, skillDimension, priorityBoost, reason}` routing entries with
  dedupe.
- `evaluation/answerEvaluator.ts` — `evaluate(task, attempt)` dispatch table over AnswerMode.
  Per-mode evaluators for romaji_to_kana, kana_input, kanji_to_reading, meaning_to_surface,
  ime_surface, audio_to_surface, plus a not-implemented stub for sentence_chunk_order so
  generic Sprint 3 dispatch flows don't crash before V1's river-jump evaluator ships.
- `mastery/scheduler.ts` — `scheduleNext / shouldRepeatImmediately / getDuePriority`. Severe
  errors → +10 minutes (immediate repeat); non-severe miss → +1 day; correct intervals scale
  with state (new/seen=1d / learning=2d / fragile=3d / stable=7d / fluent=21d / cooldown=30d).
- `mastery/masteryService.ts` — `updateProgress(old, evaluation, options)` with state-aware
  delta (bigger steps in early states, smaller once stable; severe errors hurt 2x). Streak
  resets on miss; lapse only increments when a previously non-zero streak breaks. nextDueAt
  routed through scheduler.
- `util/math.ts` — `clamp / addDays / addMinutes / ewma` shared helpers.

### Added (`apps/desktop`)

- `src-tauri/src/commands.rs` — Sprint 2 commands `create_session / finish_session /
  insert_attempt_event / get_progress / upsert_progress / record_attempt_result /
  list_recent_attempts`. Frontend supplies row IDs (crypto.randomUUID) so Rust doesn't pull
  in a uuid crate. `record_attempt_result` writes the attempt event + progress upsert in a
  single SQLite transaction, used by `GameSessionService.flush()`.
- `src/features/session/GameSessionService.ts` — owns one game session: `create()` opens it,
  `submitAttempt(task, attempt)` runs `evaluate()` + `updateProgress()` and persists both,
  `finish()` flushes the buffer + closes. In-flight submits are tracked in a Set so
  `finish()` awaits them before closing — no race on unmount. `bufferAttempts=true` defers
  the SQLite write until `flush()` (used by Sprint 3 game scenes that don't want DB chatter
  at 60 fps).
- `src/pages/EvaluatorDevPage.tsx` (`#/dev/eval`) — operator probe: pick item + answer mode,
  type via ImeInputBox, see live EvaluationResult / progress / recent-attempts panels.

### Changed

- `EvaluationStrictness` already included `handakuten` and `youon` axes from the v0.2.0
  fixes; `isAcceptableUnderPolicy` now uses an explicit switch with default-reject so each
  tag's policy is unambiguous.

### Tests

49 new unit tests across 4 files: `evaluation/scoring.test.ts` (8),
`evaluation/answerEvaluator.test.ts` (16), `mastery/scheduler.test.ts` (16),
`mastery/masteryService.test.ts` (9). 165 total in core (was 116).

### Notes

- Codex review of Sprint 2 caught four must-fix items (atomic flush, session unmount race,
  sentence_chunk_order hard-crash, romaji_to_kana failure diagnostic) — all addressed before
  tagging.
- `pnpm tauri dev` and walking `#/dev/eval` end-to-end is still a user-driven verification
  step; the scaffold makes that possible.

## [0.2.0] - 2026-04-30

The Japanese language layer. `@kana-typing/core/japanese` is the single point every game and
evaluator goes through; pure functions, no React or DB dependency.

### Added

- `@kana-typing/core/japanese/charTables` — closed dakuten / handakuten / youon / sokuon /
  long-vowel lookup tables, plus per-character vowel data so the classifier can detect
  `ばあ` → `ば` long-vowel collapses without owning a regex zoo.
- `@kana-typing/core/japanese/normalizeKana` — `normalizeRawInput`, `normalizeKana(opts)`,
  `expandLongVowelMark`. The katakana → hiragana step is implemented inline (codepoint
  offset 0x60) rather than via `wanakana.toHiragana` so ー survives the conversion;
  `expandLongVowel` is the explicit opt-in to expand it.
- `@kana-typing/core/japanese/romaji` — `toKanaCandidates`, `toRomajiCandidates`,
  `buildAcceptedKanaSet` over wanakana. Accepts shi/si, chi/ti, tsu/tu, fu/hu, ji/zi,
  sha/sya, double-letter sokuon, ん via nn / n+vowel / n'.
- `@kana-typing/core/japanese/errorClassifier` — vowel-aware `removeLongVowel` (handles
  `ー`, doubled-vowel pairs, AND canonical orthographic long vowels お+う / え+い),
  `removeSokuon`, `stripDakuten`, `stripHandakuten`, `normalizeYouon`, `classifyKanaError`,
  `hasSevereError`. Detects long_vowel / sokuon / dakuten / handakuten / youon / n_error /
  katakana_shape / hiragana_shape errors.
- `@kana-typing/core/japanese/particles` — は/へ/を ↔ わ/え/お rewrite used by reading-mode
  strictness; documented as deliberately position-blind so callers stay symmetric.
- `@kana-typing/core/japanese/ime` — `isLikelyImeComposing` predicate combining
  `isComposing`, `keyCode === 229`, and `key === 'Process'` so Chrome / Safari / Firefox /
  Tauri WebView all classify correctly.
- `@kana-typing/core/japanese/japaneseInputService` — `createJapaneseInputService()` façade.
  `compareKana(expected, actual, EvaluationStrictness)` honours per-axis policies (longVowel /
  sokuon / dakuten = strict|warn|ignore, particleReading = surface|pronunciation|both).
  `compareSurface` handles `acceptedSurfaces` for items with multiple legitimate surface
  forms (会う / 逢う).
- `apps/desktop/src/features/input/useImeInputController` — React hook wired to
  `compositionstart` / `compositionupdate` / `compositionend` plus the shared
  `isLikelyImeComposing`. Enter is suppressed mid-composition; modes: `romaji` (no IME
  guard) vs `ime_surface` (full IME).
- `apps/desktop/src/features/input/ImeInputBox` — styled controlled input wrapping the hook,
  with an optional compose indicator for tester verification.
- `apps/desktop/src/pages/InputDevPage` (`#/dev/input`) — operator-facing live evaluation
  probe: type into an IME-aware field, see `normalizeKana`, `toKanaCandidates`,
  `classifyKanaError`, and `compareKana` under both `strict` and `reading` policies update
  live. Includes a fixed probe table for ビール/ビル, きって/きて, がくせい/かくせい,
  ヤクソク script equivalence, and わたしは/わたしわ particle reading.

### Tests

108 unit tests across 7 files (normalizeKana, romaji, errorClassifier, minimalPairs,
particles, ime, japaneseInputService). Real Japanese data — minimal pairs include シ/ツ,
ソ/ン, ク/ケ, ワ/ウ, ヌ/ス. Severity tests cover きって/きて, ビル/ビール, おばさん/おばあさん,
かき/がき.

### Notes

- `removeLongVowel` is intentionally lossy: お+う collapses to お, so a theoretical
  `こうこう` vs `ここ` minimal pair would falsely match. These pairs aren't realistic
  typing-error pairs in practice.
- The IME hook's macOS / Windows real-keyboard pass remains a manual verification step;
  Sprint 4 is the hard deadline for cross-platform IME smoke testing.

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
