import { useEffect, useState, type JSX } from 'react';

import { DevPage } from './pages/DevPage';
import { HomePlaceholder } from './pages/HomePlaceholder';

// Hash-based routing keeps the scaffold dependency-free; we'll swap to a real router in Sprint 3
// when game pages with sessionId params arrive.
function getRoute(): 'home' | 'dev' {
  return globalThis.location.hash === '#/dev' ? 'dev' : 'home';
}

export function App(): JSX.Element {
  const [route, setRoute] = useState<'home' | 'dev'>(getRoute());

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
        <a href="#/dev">dev</a>
      </nav>
      {route === 'home' ? <HomePlaceholder /> : <DevPage />}
    </main>
  );
}
