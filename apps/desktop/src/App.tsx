import { ALL_SKILL_DIMENSIONS, type SkillDimension } from '@kana-typing/core';
import { useEffect, useState, type JSX } from 'react';

import { RetroShell, type RetroActiveKey } from './features/shell/RetroShell';
import { AppleRescuePage } from './pages/AppleRescuePage';
import { ContentPacksPage } from './pages/ContentPacksPage';
import { DevPage } from './pages/DevPage';
import { DiagnosticPage } from './pages/DiagnosticPage';
import { EvaluatorDevPage } from './pages/EvaluatorDevPage';
import { GamePage, type GameInputMode, type GameRouteOverrides } from './pages/GamePage';
import { HomePage } from './pages/HomePage';
import { InputDevPage } from './pages/InputDevPage';
import { LibraryPage } from './pages/LibraryPage';
import { MistakesPage } from './pages/MistakesPage';
import { ResultPage } from './pages/ResultPage';
import { RiverJumpPage } from './pages/RiverJumpPage';
import { SettingsPage } from './pages/SettingsPage';
import { SpaceBattlePage } from './pages/SpaceBattlePage';
import { TodayTrainingPage } from './pages/TodayTrainingPage';

// Hash-based routing — Sprint 5 keeps it dependency-free; v0.7+ may swap in a real router
// once the workflow stabilises.
type Route =
  | { kind: 'home' }
  | { kind: 'today' }
  | { kind: 'mistakes' }
  | { kind: 'library' }
  | { kind: 'settings' }
  | { kind: 'settings-packs' }
  | { kind: 'diagnostic' }
  | { kind: 'dev' }
  | { kind: 'dev-input' }
  | { kind: 'dev-eval' }
  | { kind: 'game-mole'; overrides?: GameRouteOverrides }
  | { kind: 'game-speed-chase'; overrides?: GameRouteOverrides }
  | { kind: 'game-river-jump' }
  | { kind: 'game-space-battle' }
  | { kind: 'game-apple-rescue' }
  | { kind: 'result'; sessionId: string };

function getRoute(): Route {
  const hash = globalThis.location.hash;
  if (hash === '#/today') return { kind: 'today' };
  if (hash === '#/mistakes') return { kind: 'mistakes' };
  if (hash === '#/library') return { kind: 'library' };
  if (hash === '#/settings/packs') return { kind: 'settings-packs' };
  if (hash === '#/settings') return { kind: 'settings' };
  if (hash === '#/diagnostic') return { kind: 'diagnostic' };
  if (hash === '#/dev') return { kind: 'dev' };
  if (hash === '#/dev/input') return { kind: 'dev-input' };
  if (hash === '#/dev/eval') return { kind: 'dev-eval' };
  if (hash === '#/game/mole' || hash.startsWith('#/game/mole?')) {
    return { kind: 'game-mole', ...withOverrides(hash) };
  }
  if (hash === '#/game/speed-chase' || hash.startsWith('#/game/speed-chase?')) {
    return { kind: 'game-speed-chase', ...withOverrides(hash) };
  }
  if (hash === '#/game/river-jump') return { kind: 'game-river-jump' };
  if (hash === '#/game/space-battle') return { kind: 'game-space-battle' };
  if (hash === '#/game/apple-rescue') return { kind: 'game-apple-rescue' };
  const resultMatch = hash.match(/^#\/result\/(.+)$/u);
  if (resultMatch) return { kind: 'result', sessionId: resultMatch[1]! };
  return { kind: 'home' };
}

function withOverrides(hash: string): { overrides?: GameRouteOverrides } {
  const query = hash.split('?')[1];
  if (!query) return {};
  const params = new URLSearchParams(query);
  const overrides: GameRouteOverrides = {};
  const durationMs = Number(params.get('durationMs'));
  if (Number.isFinite(durationMs) && durationMs > 0) {
    overrides.durationMs = Math.round(durationMs);
  }
  const skillDimension = params.get('skillDimension');
  if (isSkillDimension(skillDimension)) {
    overrides.skillDimension = skillDimension;
  }
  const inputMode = parseInputMode(params.get('inputMode'));
  if (inputMode) {
    overrides.inputMode = inputMode;
  }
  return Object.keys(overrides).length > 0 ? { overrides } : {};
}

function isSkillDimension(value: string | null): value is SkillDimension {
  return value !== null && ALL_SKILL_DIMENSIONS.includes(value as SkillDimension);
}

function parseInputMode(value: string | null): GameInputMode | undefined {
  // Accept the canonical `ime_surface` and the shorter `ime` alias for hand-typed URLs.
  if (value === 'ime' || value === 'ime_surface') return 'ime_surface';
  if (value === 'romaji') return 'romaji';
  return undefined;
}

export function App(): JSX.Element {
  const [route, setRoute] = useState<Route>(getRoute);

  useEffect(() => {
    const onHashChange = (): void => setRoute(getRoute());
    globalThis.addEventListener('hashchange', onHashChange);
    return () => globalThis.removeEventListener('hashchange', onHashChange);
  }, []);

  return (
    <RetroShell active={route.kind} title={titleForRoute(route)}>
      {renderRouteContent(route)}
    </RetroShell>
  );
}

function renderRouteContent(route: Route): JSX.Element {
  switch (route.kind) {
    case 'home':
      return <HomePage />;
    case 'today':
      return <TodayTrainingPage />;
    case 'mistakes':
      return <MistakesPage />;
    case 'library':
      return <LibraryPage />;
    case 'settings':
      return <SettingsPage />;
    case 'settings-packs':
      return <ContentPacksPage />;
    case 'diagnostic':
      return <DiagnosticPage />;
    case 'dev':
      return <DevPage />;
    case 'dev-input':
      return <InputDevPage />;
    case 'dev-eval':
      return <EvaluatorDevPage />;
    case 'game-mole':
      return (
        <GamePage
          key={`mole-${JSON.stringify(route.overrides ?? {})}`}
          mode="mole"
          overrides={route.overrides}
        />
      );
    case 'game-speed-chase':
      return (
        <GamePage
          key={`speed-chase-${JSON.stringify(route.overrides ?? {})}`}
          mode="speed-chase"
          overrides={route.overrides}
        />
      );
    case 'game-river-jump':
      return <RiverJumpPage />;
    case 'game-space-battle':
      return <SpaceBattlePage />;
    case 'game-apple-rescue':
      return <AppleRescuePage />;
    case 'result':
      return <ResultPage sessionId={route.sessionId} />;
  }
}

function titleForRoute(route: Route): string {
  // The retro shell shows this in the toolbar's tb-label slot — formatted like
  // a DOS path so it reads as 工作台 breadcrumb rather than a page title.
  switch (route.kind) {
    case 'home':
      return 'C:\\KANA\\HOME';
    case 'today':
      return 'C:\\KANA\\TODAY';
    case 'mistakes':
      return 'C:\\KANA\\MISTAKES.DAT';
    case 'library':
      return 'C:\\KANA\\LIBRARY';
    case 'settings':
      return 'C:\\KANA\\SETUP.EXE';
    case 'settings-packs':
      return 'C:\\KANA\\SETUP\\PACKS';
    case 'diagnostic':
      return 'C:\\KANA\\DIAG.EXE';
    case 'dev':
      return 'C:\\KANA\\DEV';
    case 'dev-input':
      return 'C:\\KANA\\DEV\\INPUT';
    case 'dev-eval':
      return 'C:\\KANA\\DEV\\EVAL';
    case 'game-mole':
      return 'C:\\KANA\\MOLE.EXE';
    case 'game-speed-chase':
      return 'C:\\KANA\\CHASE.EXE';
    case 'game-river-jump':
      return 'C:\\KANA\\RIVER.EXE';
    case 'game-space-battle':
      return 'C:\\KANA\\SPACE.EXE';
    case 'game-apple-rescue':
      return 'C:\\KANA\\APPLE.EXE';
    case 'result':
      return 'C:\\KANA\\RESULT.LOG';
  }
}

// Type assertion: every Route['kind'] value must be assignable to RetroActiveKey
// so the shell can highlight it. If a new route is added without updating
// RetroActiveKey, this line breaks the build — exactly what we want.
const _routeKindIsActiveKey: RetroActiveKey = '' as Route['kind'];
void _routeKindIsActiveKey;
