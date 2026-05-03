# Changelog

All notable changes to 假名打字通 / Kana Typing are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The 0.x series
covers pre-MVP iterations; the 1.0 release lands when the desktop MVP is judged shippable.

## [Unreleased]

## [0.9.2] - 2026-05-03 — v0.9 audit fixes: corpus tags, immutable attempts, full scan

### Fixed

- Rust 内置 phase1 seed 现在与 TS content-schema 使用同一套核心 tag 归一规则:
  `kanji-reading` / `meaning-recall` 等 hyphen 写法入库前统一转为 core 的
  `kanji_reading` / `meaning_recall`,且 `particle-misuse` 归并为既有
  `particle_error`。这修复了正式桌面启动路径下选择器、弱点聚合和 error chip
  读不到 0.9 语料核心 tag 的问题。
- v0.9 seed 不再删除 v0.8 legacy pack 的 `attempt_events`。旧 pack 只会被置为
  disabled,旧 item 继续作为不可变 attempt 日志的外键锚点; 新 phase1 pack 仍会用稳定
  item id 原地 upsert 可复用词条。
- Runtime 页面读取词库的窗口从 1000 项扩到 5000 项,避免 0.9 的 1654 项 phase1 语料被
  静默截断。覆盖 Mole / SpeedChase / AppleRescue / SpaceBattle / RiverJump / Boss /
  Diagnostic / Library / Result 的共用 `listItems` 路径。
- Today Training 传给游戏 hash 的 `durationMs` 现在会被 Mole / SpeedChase /
  AppleRescue / SpaceBattle / RiverJump 实际使用,不再出现计划页显示 90s、进入游戏仍跑
  默认 60s 的偏差。
- Study 卡片页切换 pack 或 mode 时会清空旧 items/progress/error 并把 index 复位到 0;
  若 localStorage 里的 resume index 超出新列表长度,也会落回 0,避免停在永久 loading。
- HomePage `ModeBlock` 卡片里的中文 `name`(「鼹鼠的故事」「Boss 关」等)和英文 `sub`
  (`MOLE.EXE` / `BOSS.EXE` 等)在 v0.9.1 缩小尺寸后没有任何视觉间隔,挤在一起难以区分。
  给 `name` 加 `lineHeight: 1.1`、给 `sub` 加 `marginTop: 3` + `lineHeight: 1.1`,
  使两行有约 3 px 呼吸空间,不放大整体卡片高度。
- 明亮模式(`[data-theme='light']`)下顶部 menubar / toolbar / 底部 statusbar 一直
  显示成纯黑色横条 — 这些 class 在 retro.css 里硬编码了 `#0e1414` / `#0c1313` /
  `#0d1313`,base 暗色被 light vars 覆盖前都会漏出来。补 light theme 覆盖:
  menubar 浅灰绿(`#d8e3df`)、toolbar/statusbar 浅薄荷(`#cee0db`)、titlebar 下边框
  改成 `#1f3e38`,顶部三条不再是黑墙。
- 明亮模式下 `r-btn` / `r-btn.primary` / `r-btn.danger` / `r-btn:hover` / `r-btn:active`
  之前继承的还是暗灰按钮(`#1c2c29` 等),光面背景对比刺眼。改为浅色凸起样式
  (`#cfdcd8` 普通态、深绿 primary、浅红 danger),配合 bevel 变量自动生效。
- 明亮模式下侧栏 `.r-sidebar .nav.active` / `.nav:hover` / `.r-progress` 全部补 light
  覆盖;SettingsPage「分类」列表项不再用 inline `linear-gradient(#1f4a42…)`,改走
  `.nav.active` class,使两个主题分别用各自的 active 样式渲染。
- SettingsPage 训练参数 6 行游戏时长全部按真实代码值对齐: 鼹鼠 60s/单题 6s · 生死时速
  最长 80s · 激流勇进 90s/单题 18s · 太空大战 60s × 14 题 · 拯救苹果 60s · Boss 180s
  (旧文案声称"5 个游戏均为 60s、Boss 90s",已偏差)。
- HomePage 9 个 ModeBlock 卡片描述同步更新,每张卡片显示真实会话时长(60s / 80s /
  90s / 60s + 14 题 / 60s / 180s)而不是只放风味描述。

### Changed

- SettingsPage「关于 / 版本」面板从 3 行单句扩成 5 段:产品定位(反射训练器、目标用户、
  闭环叙事)、技术架构(Tauri + React + Phaser + 离线 SQLite)、发布节奏(0.x 试错 /
  1.0 MVP / public repo + CI gate)、致谢(JLPT 词表 + wanakana + 8-bit SFX)。
- SettingsPage 鼹鼠难度行从「3 个跳游戏的链接」改为「3 个保存偏好的按钮」: 点击只
  写 localStorage(`kana-mole-difficulty`)+ 高亮 active,不再跳转。GamePage 进入鼹鼠
  时如果 url override 没指定 `?difficulty=`,fallback 到 localStorage 偏好,再
  fallback 到 `'normal'`。新增 `apps/desktop/src/features/preferences.ts` 集中管理。

### Tests

- 新增 Rust tests 覆盖 legacy pack 退役时保留 attempt log、phase1 seed 入库后的
  core vocab tag 必须为 canonical snake_case。
- 新增 content-schema 测试: 所有 11 个 `official-phase1-*.json` pack 都进入 gate,
  并断言验证后的 core vocab tag 不含 hyphen / `particle_misuse`。

## [0.9.1] - 2026-05-03 — 首页全游戏入口 + ModeBlock 缩小

### Added

- HomePage「模式选择」grid 扩到 9 个入口,3 × 3 布局,涵盖所有现有去处:
  - **学习模式**(accent 高亮 — 强调 v0.9.0 的"先学后练"叙事)
  - **开始训练**(`#/today`,直接进调度任务)
  - 鼹鼠的故事 / 生死时速 / 激流勇进 / 太空大战 / 拯救苹果(5 个游戏)
  - Boss 关
  - 题库浏览
- `ModeBlock` 新增 `accent` 属性 — 不放大尺寸,仅给主推卡片加 1px accent 边框 + 文字
  着色,保持网格视觉对齐。

### Changed

- `ModeBlock` 整体尺寸缩小以适应 3 列布局: padding 10 → 8, icon 24 → 20 → 18,
  name 字号 11 → 10, desc 字号 13 → 11, desc minHeight 36 → 28。
- 模式名超出宽度时 ellipsis 截断,避免长名(「鼹鼠的故事」「拯救苹果」)挤压 icon。

## [0.9.0] - 2026-05-03 — 学习模式(Study mode):非游戏卡片浏览 + 进度跟踪

The previous 0.8.x line treated the 5 games as the entire learning surface, which assumed the
user already recognised every kanji and word. With the v0.9.0 phase1 corpus topping 1500+
items, that assumption broke for anyone below comfortable N4. This release adds a **dedicated
non-game study surface** so users can read the items first, then practise them in the games.

### Added

- **`#/study` 词包选择页** — lists every enabled content pack with: name, description, JLPT
  distribution chips, "X / total" studied counter, gradient progress bar. Sorted by
  "still-to-learn" descending, so the most-relevant pack is always on top.
- **`#/study?pack=<id>[&mode=reviewed]` 卡片浏览页** — single-card view rendering surface,
  kana, romaji, pos / jlpt / tag chips, 中文意思 panel, and an examples panel (ja + kana + zh
  for each example). Header shows `current / total + pack id + mode`; footer has 上一个 /
  下一个 / 标记已学(toggle) / 退出 buttons.
- **键盘控制**: `← / →` 翻页, `Space / Enter` toggle 已掌握, `Esc / Q` 退出. Keyboard
  handler ignores events when focus is in `<input>` / `<textarea>` / contentEditable.
- **混合"已学"判定**: stays on a card ≥ 2 s → SQLite `view_count++` (auto "已学过");
  user can additionally hit ✓ to set the durable `marked = 1` flag (撤销 也支持).
- **复习模式** (`?mode=reviewed`): filters items where `view_count >= 1 OR marked = 1` and
  orders by `last_viewed_at ASC` so the longest-unseen surfaces first.
- **断点续学**: current card index is mirrored to localStorage per `(packId, mode)` so
  reopening the same pack resumes where you left off. Durable progress (view counts, marked
  flags) lives in SQLite.
- **导航**: 学习模式 nav 出现在左侧栏「学习」分组首位 (`NEW` badge); 主页 hero 增加学习模式
  primary CTA, 替代之前的 "继续训练" 主按钮位置 (训练 / 错题 button 仍保留).
- **migration 006_study_progress.sql**: new `study_progress (user_id, item_id, view_count,
  marked, first_viewed_at, last_viewed_at)` table with `ON DELETE CASCADE` from
  `learning_items` so legacy-pack cleanup also clears study rows.
- **4 new Tauri commands**:
  - `list_study_packs(userId)` — LEFT JOIN aggregates total / studied counts + JLPT histogram
    per pack.
  - `list_study_items(packId, userId, filter)` — `'all'`/`'new'`/`'reviewed'`; default order
    is JLPT ascending (N5 first), reviewed mode orders by `last_viewed_at`.
  - `record_study_view(userId, itemId)` — `INSERT … ON CONFLICT DO UPDATE` increments
    `view_count`, sets `last_viewed_at`, preserves `first_viewed_at`.
  - `toggle_study_marked(userId, itemId, marked)` — same upsert pattern, flips `marked`.
- **Rust unit tests** (4 new): view increments, mark toggle round-trip, filter splits new vs
  reviewed buckets, pack summary reports correct studied count + JLPT order.

### Changed

- `RetroShell.RetroActiveKey` extended with `'study'` and `'study-pack'`.
- HomePage CTA row now leads with 「学习模式」 followed by 「继续训练」 + 「从错题开始」.
- `apps/desktop/src/features/version.ts` — APP_VERSION 0.8.10 → 0.9.0 (also catches up the
  one missed bump from the 0.8.11 release).

### Notes

- Study mode is intentionally **decoupled from game scheduling** in this release. Whether a
  card has been studied does not influence which items the games select for tasks. A future
  release (v0.10+) may layer "games prefer studied items" on top.
- `study_progress` rows only persist for items still in `learning_items`. v0.9.2 changed legacy
  pack retirement to disable old packs instead of deleting item rows, so old attempts keep valid
  item anchors.

## [0.8.11] - 2026-05-03 — Meaning column + Mole in-game meaning + SpeedChase race redesign

### Added

- **Result page wrong-list now shows 意思** for every game. New `buildMeaningLookup`
  helper joins `listItems(limit:1000)` into the existing attempt rows so each row shows
  its first Chinese meaning (or the sentence's `zhPrompt` for sentence rows) next to
  the item id.
- **MoleScene shows the Chinese meaning under the kana pillar** while the user is typing.
  Auto-wraps to keep multi-glyph words readable; hides itself when `expected.meaningZh`
  is empty so kana-only drills stay clean.
- **`expected.meaningZh` is now populated by `selectKanaTasks` and
  `selectSentenceOrderTasks`** (the field was already in the domain type but never set).
  MoleScene + ResultPage consume it; SpeedChase / Choice scenes inherit the wiring.

### Changed

- **SpeedChase: race-to-finish redesign** per user spec.
  - Player starts at the canvas centre (X = 400), pursuer at the far left (X = 40),
    finish line at the right edge (X ≈ widthPx × 0.92).
  - Pursuer marches at a constant speed: `PURSUER_BASE_TIME_MS = 35_000` means an idle
    player gets caught in ~35 seconds. Each correct answer pushes the player +60px ahead;
    a fast streak crosses the finish line in ~30 seconds, a steady one ~60-80 seconds.
  - Two real outcomes:
    - **Won**: `playerX ≥ finishLineX` → green "GOAL!" splash + `perfect` sfx, then
      `finishSession('completed')`.
    - **Caught**: `pursuerX ≥ playerX` → red "GAME OVER" splash + `wrong` sfx + camera
      shake, then `finishSession('timeout')`.
  - Wrong-answer pursuer setback no longer clamps at -60px from the player; the next
    `update` tick is the single owner of catch detection (no more silent clamp + cap).
  - `normalizeTrackPositions` (the v0.8.x recenter hack) is removed — the race uses
    absolute world coordinates with a real finish-line ribbon.
  - `GamePage` `SESSION_DURATION_MS` for `speed-chase` raised to 80s as a wall-clock
    safety net; actual races resolve via the won/caught conditions long before that.

### Fixed

- Boss selector defaults now match the v0.8.10 rebalance math: 3 segments × 4 focused
  items, 6s word/choice tasks, and 18s RiverJump tasks. The 180s Boss cap now has real
  headroom even when two sentence segments are selected.
- Today Training now budgets RiverJump blocks as 90s, matching the shipped RiverJump page
  instead of undercounting the daily route by 30s.
- Visible release labels in README, Settings, and game footers now use the shared
  `APP_VERSION` constant instead of stale `v0.8.9` strings.

### Notes

- Synchronized package, Tauri, Cargo, shell version metadata to `0.8.11`.

## [0.8.10] - 2026-05-03 — Session/task rebalance + toast hoist + sentence import

### Changed

- **Session timing rebalanced** so taskCount actually drains within the wall clock:
  - **RiverJump**: 90s session, 18s per-task limit, 6 tasks per queue. Sentence chunk
    selection + reading input is the longest per-task budget of the v0.8.x games, so the
    session is now the only standard mode longer than 60s.
  - **SpaceBattle**: 60s session unchanged; task time limit lowered to 6s (was 8s);
    explicit taskCount = 14 leaves a small buffer for `shouldRepeatImmediately` re-pushes.
  - **AppleRescue**: 60s session unchanged; task time limit lowered to 6s (was 8s);
    taskCount auto-fits to floor(60/6)+1 = 11.
- **Boss session balanced** to 180s with 3 segments × 4 items (was v0.8.9's 90s × 4 × 5,
  which couldn't possibly drain a single RiverJump segment within the cap). Worst-case math:
  one RiverJump segment (4 × 18s = 72s) + two word/choice segments (≈24s each) + transition
  overhead = ~126s, fits comfortably.

### Added

- **PerfectFinale localStorage LRU cleanup** (Q2). `markPerfectShown` now enforces a max of
  50 stored `kana-typing.perfect-shown.*` markers, pruning oldest first by ISO timestamp.
  Previously every perfect session left a key behind forever; long-time users would
  accumulate hundreds. New `prunePerfectShownMarkers` helper + 5 unit tests.
- **`SceneErrorToastProvider`** mounted once in App.tsx; `useReportSceneError()` hook makes
  any component (chiefly `GameCanvasHost`) push a toast without per-page boilerplate. The 5
  game pages dropped their per-page `useSceneErrorToast()` setup + `onSceneError` props —
  net code reduction across pages, single source of truth for toast rendering.
- **Boss empty-path classification** (Q4). Three buckets: foundations packs not imported,
  foundations packs imported but all disabled, packs enabled but no error history yet. The
  panel now points the user at the right fix (#/dev seed vs #/settings/packs vs play a
  session first) instead of repeating the same generic "go seed" message.
- **content-cli accepts SentencePack imports** (B1). `pnpm content:import` now recognises
  `{sentences: []}` packs, validates them via `validateSentencePack`, translates each
  sentence into a sentence-typed `learning_items` row with `extras_json` carrying
  `{chunks, acceptedOrders, zhPrompt}`. Mirrors the Rust seed translation byte-for-byte so
  RiverJump consumes CLI-imported sentences and `seed_test_pack` ones via the same row
  shape. Idempotent across re-runs. 3 new unit tests cover translation correctness, idempotent
  re-import, and round-trip rejection.

### Fixed

- **ComboBadge layout** (Q5). On narrow CRT widths the badge could be clipped off the right
  edge. The HUD row now wraps + the badge gets `flexShrink: 0` and `minWidth: 96` so a high
  combo (e.g. "COMBO ×12") drops to a second line instead of being truncated.

### Changed

- Synchronized package, Tauri, Cargo, shell version metadata to `0.8.10`.

## [0.8.9] - 2026-05-03 — Game feel pass + fixed session lengths

### Added

- Mole now exposes Easy / Normal / Hard modes via the game route, with 8.0s / 6.0s / 4.5s
  per-task limits while preserving routed `skillDimension`.
- SpaceBattle now renders proper player/enemy ship silhouettes, muzzle flash, bullet travel,
  hit bursts, and a short correct-target hint after wrong shots.
- AppleRescue now uses three falling apples, includes a center lane, and supports ↓ / Space
  drop acceleration once the basket is in position.
- Settings now opens the training, theme, and about panels instead of leaving those sections
  disabled; theme choice persists to `localStorage` and applies through `data-theme`.

### Fixed

- SpeedChase scene restarts now reset avatar/input/accuracy state and unbind stale keyboard
  listeners, preventing the chase dots from getting stuck after close contact.
- AppleRescue no longer pushes wrong tasks back to the front of the same session, and the
  choice selector can build no-repeat queues so a 60s Apple run does not repeat the same item.

### Changed

- Standard games are fixed to 60s sessions; Boss is fixed to 90s.
- SpeedChase's dynamic timer/pursuer curve is retuned for the 60s standard session.
- Today Training block durations now follow the 60s standard game rule.
- Synchronized package, Tauri, Cargo, shell version metadata to `0.8.9`.

## [0.8.8] - 2026-05-03 — First-run hardening + Boss polish

### Added

- Tauri startup now runs an idempotent `ensure_seed` path for the four foundations packs, so a
  fresh desktop install has Mole / SpeedChase / SpaceBattle / AppleRescue / RiverJump content
  without visiting `#/dev` first.
- Empty game boot panels now expose a "seed foundations" recovery button instead of leaving the
  user stranded on an error.
- Boss rounds can fall back to lowest-mastery clean progress and general warm-up content when
  weak/error history is not enough to fill the run. Warm-up segments are marked separately in
  the Boss title.
- Boss segment switches now show a short transition overlay while the next Phaser scene mounts.
- Game pages now surface non-fatal `scene.error` events as a toast and mirror live combo streaks
  in the React HUD.
- ResultPage now gates the perfect finale per session and shows multi-game breakdown rows for
  Boss sessions.

### Fixed

- Mole kana pillars now size dynamically from grapheme length, preventing long kana prompts from
  clipping inside the pillar.
- SpeedChase wrong-answer pursuer movement now respects a 60px minimum player gap and no longer
  fights the update loop with a competing position tween.

### Changed

- Synchronized package, Tauri, Cargo, shell version metadata to `0.8.8`.

## [0.8.7] - 2026-05-02 — Boss routing + result insight hardening

### Fixed

- ResultPage / MistakesPage cross-game recommendation links now preserve
  the routed `skillDimension` in the hash query. A `particle_error`
  recommendation opens RiverJump in `particle_usage`; katakana shape
  mistakes open Mole in `katakana_recognition` instead of falling back to
  generic drills.
- ResultPage "新掌握" now matches attempts and progress by
  `(itemId, skillDimension)` and requires the latest same-skill session
  attempt to be correct. Stable progress from an unrelated skill no longer
  lights up as newly mastered after a different skill was touched.
- `AttemptEventRow` now exposes `gameType` and `skillDimension` from the
  immutable attempt log so result and mistakes views can reason about
  skill-specific outcomes without guessing from item ids.
- BaseTrainingScene isolates non-critical feedback failures. Exceptions
  from scene feedback, combo bubbles, or sfx now emit `scene.error` +
  console diagnostics but no longer block the persisted attempt from
  advancing to the next task.
- Boss selector now buckets by `(gameType, skillDimension)` and carries
  CrossGameEffect's exact skill into each segment. Katakana and particle
  routes no longer collapse into `kana_typing` / `sentence_order`.
- Boss choice segments now add support items for distractors while keeping
  `taskCount` focused on the weak target items, and BossPage drops any
  segment that still cannot generate playable tasks.
- Selector bucket priority treats rows with `lastErrorTags` as weak even
  if their mastery state is currently stable, keeping recent slips ahead
  of fresh filler items in Boss and regular task queues.

### Changed

- BossPage now builds its learning pool from all non-sentence items, not
  only rows typed exactly as `word`, so kana / phrase / minimal-pair
  progress can participate in Boss segments.
- Synchronized package, Tauri, Cargo, shell version metadata to `0.8.7`.

## [0.8.6] - 2026-05-02 — Boss 关 + 完美 finale + 失败戏剧

### Added

- **Boss page (`#/game/boss`)** — multi-segment cross-game gauntlet
  built dynamically from the user's recent weakness. Each Boss session
  picks up to 4 segments, each routed to the GameType that best matches
  the user's dominant error tags (long_vowel → AppleRescue + Mole,
  same_sound → SpaceBattle, word_order → RiverJump, etc.). Segments
  unmount + remount in sequence; the **ComboBus is shared across
  segments** so the streak survives game-type switches. The whole run
  persists as one `attempt_events` session with `gameType='boss_round'`,
  individual attempts keep their per-segment GameType so cross-game
  routing stays accurate.
- **`selectBossSession`** in `@kana-typing/core/planning`. Pure function:
  filters fragile/learning progress rows + rows with non-empty
  lastErrorTags, buckets by recommended GameType (via
  buildCrossGameEffects on each row's tags), weights buckets by
  `lapseCount + wrongCount`, returns the top N segments with their
  reasons + content (LearningItem[] for word/choice/listening games,
  SentenceItem[] for RiverJump). Empty-history fallback returns
  `weakCandidateCount: 0` so the page can render a friendly "数据不够"
  panel. **8 unit tests** cover empty cases, routing, sort order,
  segment-count cap, content fallbacks.
- **`'boss_round'` GameType** in core enums + every exhaustive
  `Record<GameType, …>` lookup updated (TodayTrainingPage labels,
  MistakesPage / ResultPage recommendation labels, BossSessionSelector
  skill table).
- **`crown` PixIcon** (16×16 amber crown) and a "Boss 关" entry in the
  RetroShell training nav at `#/game/boss`.
- **PerfectFinale overlay** on ResultPage — when accuracy hits 100%, a
  full-screen phosphor radial gradient flashes "完璧 PERFECT" for ~2s
  and fires the v0.8.5 `perfect` sfx cue once. Pointer-events stay
  disabled so the underlying page is interactive while the banner runs.
- **MoleScene 砸头 drama** — wrong answer now spawns a red "BAM!"
  splat tween over the mole and triggers a 180ms camera shake.
  ~30 lines added; no new sprites.
- **SpeedChaseScene 追兵瞬移** — wrong answer's pursuer setback is now a
  cinematic tween (Cubic.easeOut, 200ms) instead of a `setX` snap, plus
  a brief camera shake to make the threat feel closer. The setback
  amount still comes from the difficulty curve so the regression-prone
  "how much closer" math stays in one place.

### Changed

- `GameCanvasHost` accepts optional `combo?: ComboBus` and `sfx?: Sfx`
  props. When supplied, the host forwards them to scene init instead of
  minting fresh instances — the mechanism BossPage uses to keep one
  ComboBus alive across segment scene mounts.
- `BossSegment` carries its target `gameType` + `skillDimension` +
  weighted reasons + recommended `timeLimitMs` + `taskCount`, then the
  desktop layer attaches the actual `TrainingTask[]` per segment using
  the matching selector (Mole/SpeedChase → kana selector;
  SpaceBattle/AppleRescue → choice selector with audio prompt for
  AppleRescue; RiverJump → sentence-order selector).
- Synchronized package, Tauri, Cargo, shell version metadata to `0.8.6`.

### Notes / known gaps

- **Boss session needs prior data**. A first-launch user with no error
  history sees the "还没有错题数据 — 先去 …" empty panel rather than a
  hollow Boss. This is by design: the segment quality scales with the
  attempt log.
- **Segment scene-mount churn** — switching segments tears down +
  rebuilds the Phaser game (sceneKey changes via React `key`). On
  macOS / Windows WebView this is fast (~200ms); on Linux WebKit GTK it
  may flash briefly. Not a blocker, just a polish item for v0.8.7.
- **PerfectFinale sfx replay** — the cue plays once on ResultPage mount.
  Navigating away and back replays it. If that proves annoying, gate on
  a `localStorage` `perfectShownForSession` marker.
- **Real-time combo HUD** — the v0.8.5 `combo.changed` bridge event is
  available, but the HUD currently only surfaces the final peak via
  ResultPage. A live "COMBO ×3" badge in the React HUD lands when the
  Boss screen design crystallises in v0.8.7+.

## [0.8.5] - 2026-05-02 — 连击 + sfx + session insights + cross-game 推荐

### Added

- **`ComboBus`** in `@kana-typing/game-runtime/feedback/comboBus`. Pure
  state + tiny event emitter — every consecutive correct increments
  `count`, any wrong resets it; `peak` is monotonic for the bus's
  lifetime. Level threshold = 5 (count=5 → level 1, count=10 → level 2,
  …). Subscribers receive `{type: 'increment'|'reset', count, level,
  surge}` events; `surge=true` only on the boundary that crosses an
  upward level. Production scenes get one bus per session via
  `BaseSceneInit.combo`.
- **`createBrowserSfx` + `createNoopSfx`** in
  `@kana-typing/game-runtime/audio/sfx`. Synthesises five 8-bit cues
  through Web Audio (no asset bundle): `correct` (two-tone square pluck),
  `wrong` (sawtooth descending sweep), `tick` (high square, for the
  countdown last 5s), `combo(level)` (3-note ascending arpeggio whose
  base scales with level), `perfect` (4-note victory motif). One
  AudioContext per Sfx instance, lazy-resumed on first play to satisfy
  the browser user-gesture policy. Test stub fakes
  `globalThis.AudioContext` so the path runs under jsdom.
- **`BaseTrainingScene` combo + sfx wiring**: `submitAttemptAndAdvance`
  now calls `combo.record(isCorrect)` after evaluation, fires the matching
  sfx (`correct` always, `combo` on surge, `wrong` on reset), emits a new
  `combo.changed` GameRuntimeEvent on the bridge, and renders a default
  in-canvas "COMBO ×N" tween bubble (subclasses can override
  `showComboBubble` for game-specific styling). Every scene inherits
  this for free — no per-scene rewire required.
- **`combo.changed` GameRuntimeEvent** carrying `{count, peak, level,
  surge}` so the React HUD (and a future Boss-round shell) can react to
  combo state without owning the bus directly.
- **`computeSessionInsights`** pure function in
  `apps/desktop/src/features/result/sessionInsights.ts`. Inputs: this
  session's attempts + the user's full progress map. Outputs:
  `newMistakeItemIds` (unique wrong items), `newlyMasteredItemIds`
  (items now stable/fluent that were touched this session), and
  `crossGameRecommendations` aggregated from `buildCrossGameEffects` over
  every wrong attempt's errorTags (deduped by gameType+reason, sorted by
  weight). 9 unit tests cover dedup, weight aggregation, sort order, and
  the no-routing tags (timeout/misclick/unknown).
- **`comboRecord`** localStorage helper (`features/result/comboRecord.ts`).
  Reads / merges / persists `{peakCombo, peakKpm, updatedAt}` under
  `kana-typing.combo-record`; `maybeUpdateComboRecord` returns
  per-axis "broke record?" flags. 8 unit tests cover read fallbacks,
  merge semantics, and the no-op path. Works around `localStorage`
  via dependency injection so the tests stay browser-free.
- **ResultPage upgrades**:
  - Two new SCORE stat cells: 最高连击 (peak streak this session) and
    KPM 速率 (rough chars/min). Both compare against the localStorage
    record and render a "破纪录" badge when this session beats it; the
    `subtitle` slot shows the historical peak when no record was broken.
  - "▌ 本次提升" insights group beneath SCORE, with three rows:
    新进错题 (item-id chips, danger colour), 新掌握 (accent colour),
    推荐继续练 (cross-game chips that deep-link into the next game).
- **MistakesPage 推荐 column**: per row, up to two "去 [game type] →"
  chips computed from `buildCrossGameEffects(row.errorTags)`. Hover
  title surfaces the originating ErrorTag in Chinese for context.

### Changed

- `BaseSceneInit` grew optional `combo` + `sfx` fields. Subclasses don't
  need to wire anything; the new params are forwarded through
  `super.init(params)` and the production `GameCanvasHost` injects a
  `createBrowserSfx()` + `createComboBus()` per session mount.
- `GameCanvasHost` exposes an optional `comboRef` so a host page can
  read the combo bus state outside the bridge events (currently unused
  — wired in advance for the v0.8.6 Boss HUD).
- `PhaserGameManager.StartSessionOptions` gained matching `sfx` + `combo`
  fields; the old call sites still compile because both are optional.
- Synchronized package, Tauri, Cargo, shell version metadata to `0.8.5`.

### Notes / known gaps

- **Combo record is per-browser-profile, not per-user.** Wiping
  localStorage clears the all-time peak. SQLite-backed profile records
  land if/when accounts arrive.
- **KPM is a coarse estimate** — 1 attempt ≈ 1 keystroke, which
  understates Mole / SpeedChase (multi-key answers) and overstates
  ChoiceTask scenes (one-key answers). The "破纪录" badge is therefore
  best read as "fastest you've ever played this kind of session", not
  as a typing-speed benchmark.
- **Failure-side polish (Mole 头上砸 / SpeedChase 追兵瞬移 / 完美片尾
  闪光) is deferred to v0.8.6** along with Boss / mixed-session work,
  per the v0.8.5 scope agreed on the proposal review.
- ResultPage's `progress` state is hydrated but only consumed by the
  insights computation. Future stat panels (mastery delta over time,
  weakness drift charts) can read it directly without another RPC.

## [0.8.4] - 2026-05-02 — v0.8.x audit fixes + daily-route closure

### Fixed

- **RiverJump accepted alternate orders are playable now.** The scene no
  longer hard-fails on the first non-canonical chunk when that chunk starts a
  declared `acceptedChunkOrders` path. Order viability is handled by a pure
  `riverJumpOrder` helper with tests, and canonical order remains preferred
  when duplicate readings make several chunks match.
- **Sentence chunk attempts must include every expected chunk input.**
  `evaluateSentenceChunkOrder` now rejects missing, duplicate, or unknown
  chunk entries instead of passing a damaged attempt on `chunkOrder` alone.
- **RiverJump particle readings use natural pronunciation.** The page now
  runs with `particleReading: 'pronunciation'`, so chunks like `私は`, `学校へ`,
  and `お茶を` accept `watashiwa`, `gakkoue`, and `ochao` while still keeping
  strict long-vowel / sokuon / dakuten checks.
- **AppleRescue no longer leaks the spoken kana in the prompt when audio is
  available.** The scene shows a neutral listening prompt during TTS playback
  and only falls back to visible kana when no audio engine is available.
- **Kana drills no longer ingest sentence rows after v0.8.3 SQLite seeding.**
  `GamePage` uses the shared row-to-domain converter and `selectKanaTasks`
  excludes `sentence` / `grammar_pattern` rows from kana-recognition drills.

### Changed

- **Today Training routes all shipped v0.8 games.** Long-vowel / sokuon /
  dakuten / near-sound errors now generate `apple_rescue`, particle /
  word-order weakness generates `river_jump`, and meaning / same-sound
  confusion generates `space_battle` instead of falling back to Mole.
- **Today links preserve block parameters for the new game pages.** Hash
  routes with `durationMs` / `skillDimension` queries now parse for
  RiverJump, SpaceBattle, and AppleRescue. RiverJump uses the supplied skill
  dimension (`sentence_order` or `particle_usage`); all three pages scale task
  count from the supplied duration.
- Synchronized package, Tauri, Cargo, README, shell, and lockfile version
  metadata to `0.8.4`.

## [0.8.3] - 2026-05-02 — 持久化重构(RiverJump / SpaceBattle / AppleRescue 全部接入 SQLite)

### Added

- **Migration 005 (`migrations/005_extras.sql`)** — adds a nullable
  `extras_json TEXT` column to `learning_items`. Sentence-typed rows now
  carry their chunk structure / `acceptedOrders` / `zhPrompt` here as a
  serialised blob, so RiverJump's content can ride on the existing
  learning_items table without needing a sibling `sentence_items` schema.
- **Migration runner upgrade** in `apps/desktop/src-tauri/src/db.rs`. The
  loop now skips migrations whose name is already in `schema_migrations`
  rather than re-executing them every boot. Required because
  `ALTER TABLE ADD COLUMN` is not idempotent in SQLite, and 005 cannot be
  written CREATE-IF-NOT-EXISTS-style. Existing CREATE-IF-NOT-EXISTS
  migrations (001-004) are unaffected.
- **`extras_json` projection** in the `list_items` Tauri command + the
  `DevItemRow` struct. The TS DTO grew the matching `extrasJson: string |
  null` field plus `type`, `errorTags`, `confusableItemIds`, and
  `sourcePackId` so the client can drive selectors directly off SQLite
  without an extra round-trip. Confusables are joined in a single
  follow-up query rather than N+1 lookups.
- **Multi-pack `seed_test_pack`** — the Tauri command now seeds all four
  foundations packs in a single transaction (n5-basic-mini,
  confusables-foundations, audio-discrim-foundations, sentences-foundations).
  Sentence packs go through a translation pass that flattens each
  SentenceItem into a `learning_items` row (type='sentence', surface=full
  sentence, kana=concatenated chunks, romaji=concatenated romaji,
  extras_json={chunks, acceptedOrders, zhPrompt}). Result shape grew to
  include `packsUpserted: 4`.
- **Shared row→domain conversions** in
  `apps/desktop/src/features/db/rowConversions.ts`: `rowToLearningItem`,
  `rowToSentenceItem` (reverses the seed translation, tolerant of malformed
  extras_json), `buildProgressMap`, `progressKey`. Used by all three
  v0.8.x game pages now.

### Changed

- **`RiverJumpPage`, `SpaceBattlePage`, `AppleRescuePage` are no longer
  ephemeral.** All three now boot via `listItems` + `listProgress`, route
  through `GameSessionService`, and persist `attempt_events` +
  `item_skill_progress`. The cross-game scheduler / mistakes book / future
  progress UIs all see these outcomes from this release on. Footer hint
  updated from "attempt 暂未持久化" to "attempt 写入 SQLite".
- Synchronized package, Tauri, Cargo, shell version metadata to `0.8.3`.

### Removed

- The build-time-bundled in-memory data loaders that v0.8.0–0.8.2 used as
  the ephemeral stop-gap:
  `apps/desktop/src/features/sentences/sentencesData.ts`,
  `apps/desktop/src/features/confusables/confusablesData.ts`,
  `apps/desktop/src/features/audio-discrim/audioDiscrimData.ts`. SQLite
  is the only source of truth now; visiting `#/dev` and clicking "Seed
  test pack" loads every foundations pack into the dev DB in one go.

### Notes / known gaps

- **Existing DB migration**: a v0.8.2-or-earlier dev database has 001–004
  applied but not 005. On first launch under v0.8.3 the runner runs 005
  exactly once (ALTER TABLE ADD COLUMN succeeds because the column does
  not yet exist), records it in `schema_migrations`, and subsequent
  launches skip. If a developer hand-edited the dev DB to add the column
  manually, 005 will fail on first launch — drop the column or wipe
  `local-data/kana_typing.sqlite` and re-seed.
- The `*-foundations.json` files still live under `content/official/`
  (they are the source of truth for `seed_test_pack` via `include_str!`),
  but they're no longer parsed at runtime by the desktop app.
- `content-cli` does not yet handle SentencePack imports — only
  LearningItem packs. Custom sentence-pack import lands in v0.8.x once the
  CLI grows a sentence translation step parallel to the Rust seed.

## [0.8.2] - 2026-05-02 — 拯救苹果 + 听辨 minimal-pair + TTS 管线

### Added

- **AppleRescue training scene (`#/game/apple-rescue`)** — the third new
  game in the v0.8.x series and the first audio-driven mode. Each task
  spawns 3-4 falling apples (one per option, fixed lanes); the user moves
  a basket left/right with arrow keys to catch the one whose surface
  matches the spoken kana. `R` replays the audio at normal speed, `S`
  replays at slow speed (rate 0.7). Catch correct → green tween + advance.
  Catch wrong → red shatter + screen shake + advance with the option's
  `errorTagIfChosen`. All apples escape → `['timeout']` attempt.
- **`createBrowserJapaneseTts` + `createNoopJapaneseTts`** in
  `@kana-typing/game-runtime/audio/japaneseTts`. Wraps the Web Speech API
  `SpeechSynthesis`: prefers any voice whose `lang` starts with `ja`, sets
  `utterance.lang = 'ja-JP'`, normal/slow rate (1.0 / 0.7), bounded await
  on the `voiceschanged` event so a slow-loading voice list doesn't
  deadlock the scene. Test stub uses a fake `speechSynthesis` global so
  the path is exercised under jsdom.
- **`'audio'` ChoicePromptKind** in `selectChoiceTasks`. Emits
  `prompt.kind = 'audio'`, carries the kana on `prompt.text` for TTS, and
  forwards `prompt.audioRef` if the LearningItem ships a real audio
  asset. SpaceBattle stays on `meaning_zh`; AppleRescue defaults to
  `audio`.
- **`content/official/audio-discrim-foundations.json`** — 24 minimal-pair
  words (12 pairs) covering long vowel (ビル/ビール、おばさん/おばあさん、
  ゆき/ゆうき、ここ/こうこう), sokuon (きて/きって、かこ/かっこ、
  ねこ/ねっこ、いた/いった), and dakuten (かき/がき、たいがく/だいがく、
  ふた/ぶた、てんき/でんき). Each pair is互相 confusable, and every item
  carries a single domain-meaningful errorTag (long_vowel/sokuon/dakuten)
  so wrong picks classify themselves automatically.
- **`apple` PixIcon** (16×16 red apple + phosphor leaf) and a "拯救苹果"
  entry in the RetroShell training nav at `#/game/apple-rescue`.

### Changed

- Synchronized package, Tauri, Cargo, shell version metadata to `0.8.2`.
- AppleRescue's `distractorCount` is fixed at 1 (binary minimal-pair
  choice) — the strongest training signal for long/sokuon/dakuten
  discrimination. SpaceBattle remains 3 (4 ships).

### Notes / known gaps

- **AppleRescue session is ephemeral** — same trade-off as RiverJump and
  SpaceBattle. The audio-discrim pack is build-time bundled and attempts
  go through `evaluate()` in memory, no SQLite. v0.8.x will fold the
  three `*-foundations` packs into the dev seed simultaneously and switch
  all three modes to listItems-driven boot.
- **TTS quality varies by platform**. macOS WebKit has high-quality
  ja-JP voices (Kyoko, Otoya); Windows WebView2 ships Haruka/Sayaka.
  Linux WebKit GTK ships none by default, falling back to engine
  best-effort with `lang='ja-JP'` set on the utterance. Real recorded
  audio assets remain a v1.x consideration.
- **TTS replay throttle missing**. Rapidly hitting R several times will
  cancel and restart the utterance, but the engine sometimes mutes the
  next utterance for ~200ms after a cancel on macOS. Consider a 250ms
  debounce in v0.8.3 polish.
- AppleRescue's basket catch detection samples Phaser tween positions
  in `update()`. With 60fps that's tight enough but not perfect — a
  fast-moving basket can clip past an apple by a frame. Enlarging the
  catch tolerance (`CATCH_TOLERANCE_Y`) is the simplest knob if user
  testing flags this.

## [0.8.1] - 2026-05-02 — 太空大战 + 同音/近形/中文误导词辨析

### Added

- **SpaceBattle training scene (`#/game/space-battle`)** — the second new
  game type in the v0.8.x series. Each task is one ChoiceTrainingTask: 3-4
  enemy frigates spawn at the top of the screen, each labelled with a
  distractor word, and the user fires with number keys (1-4). Correct hit
  → green explosion + advance. Wrong hit → red flash + screen shake +
  the option's `errorTagIfChosen` surfaces. Timeout (8s) → ships
  "escape" and submit a `['timeout']` attempt.
- **`option_select` AnswerMode + `evaluateOptionSelect`** evaluator in
  `@kana-typing/core`. Compares `attempt.selectedOptionId` vs
  `task.expected.optionId` directly; on a wrong pick, surfaces the chosen
  option's `errorTagIfChosen` (defaults to `meaning_confusion`) so the
  scheduler / cross-game effects classify the mistake. Edge cases:
  absent selection → `['timeout']`; option id not in task.options →
  `['misclick']`.
- **`selectChoiceTasks`** selector (`@kana-typing/core/planning`).
  Distractor strategy: pull from the correct item's `confusableItemIds`
  first (this is what makes the task an actual *辨析*, not a random
  multi-choice), top up from the global pool with mild topical bias when
  the explicit list is short. Items lacking enough viable distractors are
  skipped at the eligibility step rather than producing degenerate tasks.
- **`content/official/confusables-foundations.json`** — 40 confusable
  words across four buckets: same-sound (はし/かみ/あめ/はな/くも),
  near-shape kanji (入/人/八、王/玉、土/士、大/犬/太), near-meaning
  verbs (見る/観る、聞く/効く、会う/合う、早い/速い), and zh-misleading
  vocabulary (手紙/大丈夫/勉強/床/切手/怪我/邪魔/娘/新聞/留守). Each item
  declares `confusableItemIds` referencing its bucket peers so SpaceBattle
  pulls authentic distractors. Marked `quality: draft` (description
  field) — needs a native-speaker pass before promotion.
- **`rocket` PixIcon** (16×16 cyan rocket + flame trail) and a "太空大战"
  entry in the RetroShell training nav at `#/game/space-battle`.

### Changed

- Synchronized package, Tauri, Cargo, shell version metadata to `0.8.1`.
- `EvaluatorDevPage` now maps `option_select` → `meaning_recall` so the
  exhaustiveness check on `Record<AnswerMode, SkillDimension>` stays
  green when ChoiceTask shows up in a debug session.

### Notes / known gaps

- **SpaceBattle training is ephemeral in v0.8.1** — same trade-off as
  RiverJump v0.8.0. The confusables pack is bundled at build time and the
  boot path goes JSON → selector → scene without touching SQLite, so
  `attempt_events` and `item_skill_progress` are not written. v0.8.x will
  fold the pack into the dev seed (`seed_test_pack`) and switch
  SpaceBattle to listItems-driven boot like Mole/SpeedChase, at which
  point attempts persist normally.
- Distractor count is fixed at 3 (4 ships per task). Audio cues, combo
  visuals, mini-boss long-prompt encounters, and animated explosion
  sprites all sit on the v0.8.3 polish pass per handoff §6.
- The 40-word pack is a draft. Some near-shape kanji entries
  (大/犬/太, 太=ふと alone is uncommon as a standalone word) trade
  vocabulary purity for visual training value; treat this set as a
  format-soak rather than a polished curriculum.

## [0.8.0] - 2026-05-01 — 激流勇进 + sentence-order pipeline

### Added

- **RiverJump training scene (`#/game/river-jump`)** — the first new game type
  since v0.5 (Mole / SpeedChase). One sentence per task, chunks rendered as
  shuffled lily-pads on a river, frog hops onto the right pad as the user
  types each chunk's reading. Wrong-order picks splash and end the sentence;
  unrecognised readings keep the buffer so the user can fix typos. Visual
  cues for splash/sink/canonical-step come from Phaser tweens — no audio yet.
- **`SentenceItemSchema` + `SentencePackSchema`** in `@kana-typing/content-schema`,
  with chunk-id permutation refinements (no duplicates, no extras), a
  `validateSentencePack` flow that enforces per-chunk kana validity + romaji
  round-trip, and a `pos` enum covering noun/verb/particle/adjective/etc.
- **`SentenceChunkOrder` evaluator** (`@kana-typing/core`) — replaces the
  v0.x stub. Validates `chunkOrder` against the canonical order plus
  `acceptedChunkOrders[]`, replays per-chunk reading comparisons via the
  attempt's `rawInput` JSON (`SentenceChunkAttemptEntry[]`), and surfaces
  severe per-chunk error tags (long_vowel/sokuon/dakuten) so
  `shouldRepeatImmediately` and the scheduler stay coherent across modes.
- **`selectSentenceOrderTasks`** selector (`@kana-typing/core/planning`) —
  bucket strategy mirrors `selectKanaTasks` (overdue → fragile/learning →
  seen/new → stable) but operates on `SentenceItem[]`. v0.8.0 typically calls
  it without progress data; the empty-progress path lands every sentence in
  the new-exposure bucket and shuffles uniformly.
- **`content/official/sentences-foundations.json`** — 30 N5/N4 sentences
  spanning basic SOV order, particle drills (を/に/で/へ/と/から/まで/が/は),
  past-polite, plain negative, and te-iru progressive. Marked `quality:
  draft` (description field) — needs a native-speaker pass before promotion.
- **`SentenceItem` + `ChunkExpectation` + `SentenceChunkAttemptEntry`** domain
  types in `@kana-typing/core`. The chunk-attempt entry uses
  `attempt.rawInput` as a JSON wire format so v0.8.0 doesn't need an
  attempt_events DTO change for an ephemeral feature.
- **`river` PixIcon** (16×16 phosphor frog-on-pad + waves) and a "激流勇进"
  entry in the RetroShell training nav at `#/game/river-jump`.

### Changed

- Synchronized package, Tauri, Cargo, shell version metadata to `0.8.0`.
- `apps/desktop` now lists `@kana-typing/content-schema` as a workspace dep
  so the `RiverJumpPage` boot path can re-run the validator at module load
  (defence-in-depth — bad pack → loud throw, not silent bad tasks).

### Notes / known gaps

- **Sentence training is ephemeral in v0.8.0**: RiverJump tasks do not
  persist `attempt_events` or `item_skill_progress` because both tables hold
  a `FOREIGN KEY (item_id) REFERENCES learning_items` that sentence ids do
  not satisfy. The whole loop runs in memory; ResultPage is bypassed (the
  page returns to home after finish). v0.8.x will add migration 005
  (`sentence_items` table) and reroute to a sentence-aware result view.
- The 30-sentence pack is a draft. Multi-answer `acceptedOrders` are
  intentionally empty for v0.8.0 — only the canonical order is accepted —
  so the gate stays narrow while the format soaks. Future drops will
  populate alternates for sentences with legitimate SOV/OSV freedom.
- IME-mode for RiverJump is wired (`inputSource: 'external'`) but the
  desktop shell currently boots it in romaji-only mode. IME pass scheduled
  for v0.8.x once the sentence chunk recognition is verified on macOS +
  Windows webview.

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
- CI `pnpm/action-setup@v4` no longer pins a `version: 10` input — the
  `packageManager` field in `package.json` already declares
  `pnpm@10.32.0`, and the action errors out if both sources are present
  with different values. Single source of truth restored.

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
