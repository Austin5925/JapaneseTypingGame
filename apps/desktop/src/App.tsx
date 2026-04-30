import { useEffect, useState, type JSX } from 'react';

import { DevPage } from './pages/DevPage';
import { HomePlaceholder } from './pages/HomePlaceholder';
import { InputDevPage } from './pages/InputDevPage';

// Hash-based routing keeps the scaffold dependency-free; we'll swap to a real router in Sprint 3
// when game pages with sessionId params arrive.
type Route = 'home' | 'dev' | 'dev-input';

function getRoute(): Route {
  const hash = globalThis.location.hash;
  if (hash === '#/dev') return 'dev';
  if (hash === '#/dev/input') return 'dev-input';
  return 'home';
}

export function App(): JSX.Element {
  const [route, setRoute] = useState<Route>(getRoute());

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
      </nav>
      {route === 'home' && <HomePlaceholder />}
      {route === 'dev' && <DevPage />}
      {route === 'dev-input' && <InputDevPage />}
    </main>
  );
}
