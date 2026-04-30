import type { JSX } from 'react';

export function HomePlaceholder(): JSX.Element {
  return (
    <section style={{ padding: '2rem', maxWidth: '720px', margin: '0 auto' }}>
      <h1>假名打字通</h1>
      <p style={{ color: 'var(--muted)' }}>
        Engineering scaffold (v0.1.0). The real home page lands in Sprint 5.
      </p>
      <p>
        For now, visit the <a href="#/dev">dev tools</a> page to seed a test content pack and verify
        the SQLite round-trip.
      </p>
    </section>
  );
}
