import { ALL_SKILL_DIMENSIONS, type SkillDimension } from '@kana-typing/core';
import { useEffect, useState, type JSX } from 'react';

import { DevPage } from './pages/DevPage';
import { EvaluatorDevPage } from './pages/EvaluatorDevPage';
import { GamePage, type GameRouteOverrides } from './pages/GamePage';
import { HomePage } from './pages/HomePage';
import { InputDevPage } from './pages/InputDevPage';
import { LibraryPage } from './pages/LibraryPage';
import { MistakesPage } from './pages/MistakesPage';
import { ResultPage } from './pages/ResultPage';
import { SettingsPage } from './pages/SettingsPage';
import { TodayTrainingPage } from './pages/TodayTrainingPage';

// Hash-based routing — Sprint 5 keeps it dependency-free; v0.7+ may swap in a real router
// once the workflow stabilises.
type Route =
  | { kind: 'home' }
  | { kind: 'today' }
  | { kind: 'mistakes' }
  | { kind: 'library' }
  | { kind: 'settings' }
  | { kind: 'dev' }
  | { kind: 'dev-input' }
  | { kind: 'dev-eval' }
  | { kind: 'game-mole'; overrides?: GameRouteOverrides }
  | { kind: 'game-speed-chase'; overrides?: GameRouteOverrides }
  | { kind: 'result'; sessionId: string };

function getRoute(): Route {
  const hash = globalThis.location.hash;
  if (hash === '#/today') return { kind: 'today' };
  if (hash === '#/mistakes') return { kind: 'mistakes' };
  if (hash === '#/library') return { kind: 'library' };
  if (hash === '#/settings') return { kind: 'settings' };
  if (hash === '#/dev') return { kind: 'dev' };
  if (hash === '#/dev/input') return { kind: 'dev-input' };
  if (hash === '#/dev/eval') return { kind: 'dev-eval' };
  if (hash === '#/game/mole' || hash.startsWith('#/game/mole?')) {
    return { kind: 'game-mole', ...withOverrides(hash) };
  }
  if (hash === '#/game/speed-chase' || hash.startsWith('#/game/speed-chase?')) {
    return { kind: 'game-speed-chase', ...withOverrides(hash) };
  }
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
  return Object.keys(overrides).length > 0 ? { overrides } : {};
}

function isSkillDimension(value: string | null): value is SkillDimension {
  return value !== null && ALL_SKILL_DIMENSIONS.includes(value as SkillDimension);
}

export function App(): JSX.Element {
  const [route, setRoute] = useState<Route>(getRoute);

  useEffect(() => {
    const onHashChange = (): void => setRoute(getRoute());
    globalThis.addEventListener('hashchange', onHashChange);
    return () => globalThis.removeEventListener('hashchange', onHashChange);
  }, []);

  return (
    <main>
      <nav
        style={{
          padding: '0.75rem 1.5rem',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          gap: '1.25rem',
          alignItems: 'center',
        }}
      >
        <strong>假名打字通</strong>
        <a href="#/">home</a>
        <a href="#/today">今日训练</a>
        <a href="#/mistakes">错题本</a>
        <a href="#/library">图鉴</a>
        <a href="#/settings">设置</a>
        <span style={{ flex: 1 }} />
        <a href="#/dev" style={{ color: 'var(--muted)' }}>
          dev
        </a>
        <a href="#/dev/input" style={{ color: 'var(--muted)' }}>
          dev/input
        </a>
        <a href="#/dev/eval" style={{ color: 'var(--muted)' }}>
          dev/eval
        </a>
      </nav>
      {route.kind === 'home' && <HomePage />}
      {route.kind === 'today' && <TodayTrainingPage />}
      {route.kind === 'mistakes' && <MistakesPage />}
      {route.kind === 'library' && <LibraryPage />}
      {route.kind === 'settings' && <SettingsPage />}
      {route.kind === 'dev' && <DevPage />}
      {route.kind === 'dev-input' && <InputDevPage />}
      {route.kind === 'dev-eval' && <EvaluatorDevPage />}
      {route.kind === 'game-mole' && (
        <GamePage
          key={`mole-${JSON.stringify(route.overrides ?? {})}`}
          mode="mole"
          overrides={route.overrides}
        />
      )}
      {route.kind === 'game-speed-chase' && (
        <GamePage
          key={`speed-chase-${JSON.stringify(route.overrides ?? {})}`}
          mode="speed-chase"
          overrides={route.overrides}
        />
      )}
      {route.kind === 'result' && <ResultPage sessionId={route.sessionId} />}
    </main>
  );
}
