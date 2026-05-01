import React from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

// UI font (Inter) — used by .kt-* dashboard classes for Latin/Latin-numeric
// content. CJK glyphs fall back through var(--font-cjk) (Hiragino → Yu Gothic
// → Noto Sans CJK → system-ui) and are intentionally NOT bundled (CJK fonts
// are tens of MB; system fonts render Japanese / Chinese acceptably).
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
// Mono font for numeric / code / tabular displays.
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';

import './styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('root element missing in index.html');
}
createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
