import {
  classifyKanaError,
  compareKana,
  normalizeKana,
  toKanaCandidates,
  type EvaluationStrictness,
} from '@kana-typing/core';
import { useState, type JSX } from 'react';

import { ImeInputBox } from '../features/input/ImeInputBox';

const STRICT: EvaluationStrictness = {
  longVowel: 'strict',
  sokuon: 'strict',
  dakuten: 'strict',
  kanjiSurface: 'strict',
  particleReading: 'surface',
};

const READING_MODE: EvaluationStrictness = {
  ...STRICT,
  particleReading: 'pronunciation',
};

interface ProbeRow {
  expected: string;
  actual: string;
  policy: EvaluationStrictness;
  policyName: string;
}

const PROBE_ROWS: ProbeRow[] = [
  { expected: 'ビール', actual: 'ビル', policy: STRICT, policyName: 'strict' },
  { expected: 'きって', actual: 'きて', policy: STRICT, policyName: 'strict' },
  { expected: 'がくせい', actual: 'かくせい', policy: STRICT, policyName: 'strict' },
  { expected: 'やくそく', actual: 'ヤクソク', policy: STRICT, policyName: 'strict' },
  { expected: 'わたしは', actual: 'わたしわ', policy: READING_MODE, policyName: 'reading' },
  { expected: 'わたしは', actual: 'わたしわ', policy: STRICT, policyName: 'strict' },
];

export function InputDevPage(): JSX.Element {
  const [expected, setExpected] = useState('やくそく');
  const [committed, setCommitted] = useState('');

  const candidates = toKanaCandidates(committed, 'mixed');
  const cmp = committed ? compareKana(expected, committed, STRICT) : null;
  const cmpReading = committed ? compareKana(expected, committed, READING_MODE) : null;
  const tags = committed ? classifyKanaError(expected, committed) : [];

  return (
    <section style={{ padding: '1.5rem', maxWidth: '960px', margin: '0 auto' }}>
      <h1>Input + Evaluation Probe</h1>
      <p style={{ color: 'var(--muted)' }}>
        Sprint 1 dev page. Type romaji or hiragana/katakana with your IME on and watch the
        normalisation, candidate kana, and error classification update live.
      </p>

      <section style={{ marginTop: '1.5rem' }}>
        <h2>Expected answer</h2>
        <input
          type="text"
          value={expected}
          onChange={(e) => setExpected(e.target.value)}
          style={{
            padding: '0.4rem 0.7rem',
            background: 'rgba(255,255,255,0.05)',
            color: 'var(--fg)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            font: 'inherit',
          }}
        />
      </section>

      <section style={{ marginTop: '1.5rem' }}>
        <h2>Your input</h2>
        <ImeInputBox
          mode="ime_surface"
          autoSubmitOnEnter
          onCommit={setCommitted}
          placeholder="type here, press Enter to commit"
          showComposeIndicator
        />
        <p style={{ marginTop: '0.5rem', color: 'var(--muted)' }}>
          Last committed: <code>{committed || '—'}</code>
        </p>
      </section>

      {committed && (
        <section style={{ marginTop: '1.5rem' }}>
          <h2>Live analysis</h2>
          <table>
            <tbody>
              <tr>
                <td>normalizeKana()</td>
                <td>
                  <code>{normalizeKana(committed) || '—'}</code>
                </td>
              </tr>
              <tr>
                <td>toKanaCandidates() [mixed]</td>
                <td>
                  <code>{candidates.join(' / ') || '—'}</code>
                </td>
              </tr>
              <tr>
                <td>classifyKanaError(expected, actual)</td>
                <td>
                  <code>{tags.join(', ') || 'no error'}</code>
                </td>
              </tr>
              <tr>
                <td>compareKana — strict</td>
                <td>
                  <code>
                    {cmp
                      ? `exact=${cmp.isExact} acceptable=${cmp.isAcceptable} tags=[${cmp.errorTags.join(', ')}]`
                      : '—'}
                  </code>
                </td>
              </tr>
              <tr>
                <td>compareKana — reading mode</td>
                <td>
                  <code>
                    {cmpReading
                      ? `exact=${cmpReading.isExact} acceptable=${cmpReading.isAcceptable} tags=[${cmpReading.errorTags.join(', ')}]`
                      : '—'}
                  </code>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      <section style={{ marginTop: '1.5rem' }}>
        <h2>Reference probes</h2>
        <table>
          <thead>
            <tr>
              <th>policy</th>
              <th>expected</th>
              <th>actual</th>
              <th>acceptable</th>
              <th>error tags</th>
            </tr>
          </thead>
          <tbody>
            {PROBE_ROWS.map((row, idx) => {
              const r = compareKana(row.expected, row.actual, row.policy);
              return (
                <tr key={idx}>
                  <td>
                    <code>{row.policyName}</code>
                  </td>
                  <td>{row.expected}</td>
                  <td>{row.actual}</td>
                  <td style={{ color: r.isAcceptable ? 'var(--ok)' : 'var(--err)' }}>
                    {String(r.isAcceptable)}
                  </td>
                  <td>
                    <code>{r.errorTags.join(', ') || '(none)'}</code>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </section>
  );
}
