import { useEffect, useState, type JSX } from 'react';

import { DevPage } from './pages/DevPage';
import { EvaluatorDevPage } from './pages/EvaluatorDevPage';
import { GamePage } from './pages/GamePage';
import { HomePlaceholder } from './pages/HomePlaceholder';
import { InputDevPage } from './pages/InputDevPage';
import { ResultPage } from './pages/ResultPage';

// Hash-based routing keeps the scaffold dependency-free. Sprint 5 will introduce a proper
// router; for now we discriminate on `kind` so result/:sessionId can carry a parameter.
type Route =
  | { kind: 'home' }
  | { kind: 'dev' }
  | { kind: 'dev-input' }
  | { kind: 'dev-eval' }
  | { kind: 'game-mole' }
  | { kind: 'game-speed-chase' }
  | { kind: 'result'; sessionId: string };

function getRoute(): Route {
  const hash = globalThis.location.hash;
  if (hash === '#/dev') return { kind: 'dev' };
  if (hash === '#/dev/input') return { kind: 'dev-input' };
  if (hash === '#/dev/eval') return { kind: 'dev-eval' };
  if (hash === '#/game/mole') return { kind: 'game-mole' };
  if (hash === '#/game/speed-chase') return { kind: 'game-speed-chase' };
  const resultMatch = hash.match(/^#\/result\/(.+)$/u);
  if (resultMatch) return { kind: 'result', sessionId: resultMatch[1]! };
  return { kind: 'home' };
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
        <a href="#/dev">dev (db)</a>
        <a href="#/dev/input">dev (input)</a>
        <a href="#/dev/eval">dev (eval)</a>
        <a href="#/game/mole">game (mole)</a>
        <a href="#/game/speed-chase">game (speed-chase)</a>
      </nav>
      {route.kind === 'home' && <HomePlaceholder />}
      {route.kind === 'dev' && <DevPage />}
      {route.kind === 'dev-input' && <InputDevPage />}
      {route.kind === 'dev-eval' && <EvaluatorDevPage />}
      {route.kind === 'game-mole' && <GamePage mode="mole" />}
      {route.kind === 'game-speed-chase' && <GamePage mode="speed-chase" />}
      {route.kind === 'result' && <ResultPage sessionId={route.sessionId} />}
    </main>
  );
}
