import {
  evaluate,
  updateProgress,
  type EvaluationResult,
  type EvaluationStrictness,
  type SkillDimension,
  type SkillProgress,
  type TrainingTask,
  type UserAttempt,
} from '@kana-typing/core';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type ReactNode,
} from 'react';

import { ImeInputBox } from '../features/input/ImeInputBox';
import { toProgressDto } from '../features/session/GameSessionService';
import { ErrorTagChip } from '../features/style/ErrorTagChip';
import { PixIcon } from '../features/style/PixIcon';
import { listItems, upsertProgress, type DevItemRow } from '../tauri/invoke';

const STRICT: EvaluationStrictness = {
  longVowel: 'strict',
  sokuon: 'strict',
  dakuten: 'strict',
  handakuten: 'strict',
  youon: 'strict',
  kanjiSurface: 'accepted_variants',
  particleReading: 'surface',
};

interface DiagnosticStep {
  label: string;
  hint: string;
  skillDimension: SkillDimension;
  /** Picks one item from the pack for this step. Falls through to a relaxed pick if nothing matches. */
  pick: (items: DevItemRow[]) => DevItemRow | undefined;
}

const STEPS: DiagnosticStep[] = [
  {
    label: '基础假名',
    hint: '从最基础的假名开始 — 输入下面词的读音',
    skillDimension: 'kana_typing',
    pick: (items) =>
      items.find(
        (it) =>
          (it.tags.includes('greeting') || it.tags.includes('stage_1')) &&
          /^[ぁ-ゖ]+$/u.test(it.kana),
      ),
  },
  {
    label: '片假名识别',
    hint: '外来词通常用片假名 — 输入下面词的读音',
    skillDimension: 'katakana_recognition',
    pick: (items) =>
      items.find((it) => it.tags.includes('katakana') && /^[ァ-ヺー]+$/u.test(it.kana)),
  },
  {
    label: '汉字读音',
    hint: '日语汉字有特定读音 — 输入下面词的假名读音',
    skillDimension: 'kanji_reading',
    pick: (items) =>
      items.find(
        (it) =>
          it.jlpt === 'N5' &&
          /[一-鿿]/u.test(it.surface) &&
          !it.tags.includes('long_vowel') &&
          !it.tags.includes('sokuon'),
      ),
  },
  {
    label: '长音 / 促音',
    hint: '注意长音 (ー / ぅ) 和促音 (っ) — 输入下面词的读音',
    skillDimension: 'kanji_reading',
    pick: (items) =>
      items.find(
        (it) =>
          (it.tags.includes('long_vowel') || it.tags.includes('sokuon')) &&
          /[一-鿿]/u.test(it.surface),
      ),
  },
  {
    label: '日常 IME',
    hint: '从生活高频词开始练习 IME 输入 — 输入下面词的假名',
    skillDimension: 'ime_conversion',
    pick: (items) =>
      items.find(
        (it) =>
          it.jlpt === 'N5' &&
          (it.tags.includes('food') || it.tags.includes('shop') || it.tags.includes('transport')) &&
          /[一-鿿ァ-ヺ]/u.test(it.surface),
      ),
  },
];

interface StepResult {
  step: DiagnosticStep;
  item: DevItemRow;
  attemptValue: string;
  evaluation: EvaluationResult;
}

/**
 * v0.7 P0-2 · `#/diagnostic`. Five-step mini quiz that seeds initial
 * SkillProgress rows so buildWeaknessVector + selectGameBlocks have data on
 * day one. Each step picks one item from the pack along a different
 * skill-dimension axis (假名 / 片假名 / 漢字 / 长音促音 / IME), shows the
 * surface, and lets the user type the reading via ImeInputBox.
 *
 * Outcome: regardless of correctness we write a `seen` (or `fragile` on
 * miss) progress row per step. Diagnostic does NOT create a real
 * GameSession row — the data we care about is the per-skill bootstrap, not
 * a session log.
 *
 * After 5 steps the user lands on `#/today` and the Home page weakness
 * vector lights up.
 */
export function DiagnosticPage(): JSX.Element {
  const [items, setItems] = useState<DevItemRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [results, setResults] = useState<StepResult[]>([]);
  const [feedback, setFeedback] = useState<EvaluationResult | null>(null);
  const [stepStartAt, setStepStartAt] = useState<number>(() => Date.now());
  const [savingDone, setSavingDone] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const rows = await listItems({ limit: 1000 });
        if (rows.length === 0) {
          setError('词库为空 — 先到首页种入内容包再回到诊断。');
          return;
        }
        setItems(rows);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  // Reset stepStartAt on every step transition so reactionTime is per-step.
  useEffect(() => {
    setStepStartAt(Date.now());
    setFeedback(null);
  }, [step]);

  const selectedItems = useMemo(() => (items ? selectStepItems(items) : null), [items]);

  if (error) {
    return <ErrorPanel message={error} />;
  }
  if (!items || !selectedItems) {
    return <LoadingPanel />;
  }
  if (savingDone) {
    return <DonePanel results={results} />;
  }

  const currentStep = STEPS[step];
  if (!currentStep) {
    // Defensive: should never reach this because savingDone gates after step 5.
    return <LoadingPanel />;
  }
  const currentItem = selectedItems[step];
  if (!currentItem) {
    return <ErrorPanel message={`Step ${step + 1} 找不到合适的词条 — 内容包可能太薄。`} />;
  }

  const onCommit = (value: string): void => {
    if (submittingRef.current || feedback) return;
    submittingRef.current = true;
    try {
      const reactionMs = Math.max(300, Date.now() - stepStartAt);
      const task = makeTask(currentItem, currentStep, reactionMs);
      const attempt = makeAttempt(task, value, stepStartAt, reactionMs);
      const evalResult = evaluate(task, attempt);
      setFeedback(evalResult);
      setResults((prev) => [
        ...prev,
        { step: currentStep, item: currentItem, attemptValue: value, evaluation: evalResult },
      ]);
      // Pause briefly so the user sees the feedback, then advance or finish.
      globalThis.setTimeout(() => {
        submittingRef.current = false;
        if (step + 1 >= STEPS.length) {
          void persistAndNavigate(
            [
              ...results,
              { step: currentStep, item: currentItem, attemptValue: value, evaluation: evalResult },
            ],
            setSavingDone,
            setError,
          );
        } else {
          setStep(step + 1);
        }
      }, 1100);
    } catch (err) {
      submittingRef.current = false;
      setError((err as Error).message);
    }
  };

  const skip = (): void => {
    // Persist whatever results the user did answer (could be 0), set a
    // localStorage flag so HomePage won't keep redirecting them, and bounce
    // to today's training. The flag stays set until the user makes real
    // progress (a real attempt populates the progress table, so the home
    // gate's primary check — `progressDtos.length === 0` — fails naturally).
    void (async (): Promise<void> => {
      setSavingDone(true);
      try {
        await persistResults(results);
      } catch (err) {
        setError(`保存进度失败:${(err as Error).message}`);
        return;
      }
      globalThis.localStorage?.setItem('diagnosticSkipped', '1');
      globalThis.location.hash = '#/today';
    })();
  };

  return (
    <div style={pageGrid}>
      <Group title={`▌ 诊断 · STEP ${step + 1}/${STEPS.length} · ${currentStep.label}`}>
        <ProgressBar pct={(step / STEPS.length) * 100} />

        <div style={{ marginTop: 18, marginBottom: 6, fontSize: 13, color: 'var(--kt2-fg-dim)' }}>
          {currentStep.hint}
        </div>

        <div
          style={{
            textAlign: 'center',
            margin: '24px 0 18px',
            fontFamily: 'var(--pix-cjk)',
            fontSize: 64,
            color: 'var(--kt2-fg-bright)',
            textShadow: '0 0 8px rgba(126,231,135,0.25)',
          }}
        >
          {currentItem.surface}
        </div>

        <div
          style={{
            textAlign: 'center',
            color: 'var(--kt2-fg-dim)',
            fontSize: 14,
            marginBottom: 18,
          }}
        >
          {currentItem.jlpt ? `[${currentItem.jlpt}] ` : ''}意思:暂不显示 — 凭读音
        </div>

        <ImeInputBox
          mode="ime_surface"
          autoSubmitOnEnter
          placeholder=">>> 输入读音 + Enter"
          showComposeIndicator
          onCommit={onCommit}
        />

        {feedback && (
          <div
            className={`kt-banner kt-banner--${feedback.isCorrect ? 'ok' : 'err'}`}
            style={{ marginTop: 14 }}
          >
            <span className="kt-banner__glyph">{feedback.isCorrect ? '✓' : '✗'}</span>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {feedback.isCorrect ? '正确' : `期待:${feedback.expectedDisplay}`}
              </div>
              {feedback.errorTags.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {feedback.errorTags.map((t) => (
                    <ErrorTagChip key={t} tag={t} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div style={{ marginTop: 18, display: 'flex', gap: 8 }}>
          <button type="button" className="r-btn" onClick={skip} disabled={submittingRef.current}>
            <PixIcon name="close" /> 跳过诊断
          </button>
          <span style={{ flex: 1 }} />
          <span className="r-label" style={{ fontSize: 8, alignSelf: 'center' }}>
            完成后会写入初始 progress
          </span>
        </div>
      </Group>

      <Group title="▌ 进度">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {STEPS.map((s, i) => (
            <div
              key={s.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                color:
                  i < step
                    ? 'var(--kt2-accent)'
                    : i === step
                      ? 'var(--kt2-fg-bright)'
                      : 'var(--kt2-fg-dim)',
              }}
            >
              <span
                className="r-chk"
                style={{
                  width: 12,
                  height: 12,
                  background:
                    i < step
                      ? 'var(--kt2-accent)'
                      : i === step
                        ? 'var(--kt2-accent-soft)'
                        : 'var(--kt2-sunken)',
                }}
              />
              <span>{s.label}</span>
            </div>
          ))}
        </div>
        <div className="r-label" style={{ marginTop: 14 }}>
          预计时长 · 1-2 分钟
        </div>
      </Group>
    </div>
  );
}

function selectStepItems(items: DevItemRow[]): (DevItemRow | undefined)[] {
  const used = new Set<string>();
  return STEPS.map((step) => {
    const pool = items.filter((it) => !used.has(it.id));
    let pick = step.pick(pool);
    pick ??= pool.find((it) => /[一-鿿]/u.test(it.surface)) ?? pool[0];
    if (pick) used.add(pick.id);
    return pick;
  });
}

function makeTask(item: DevItemRow, step: DiagnosticStep, _reactionMs: number): TrainingTask {
  return {
    id: `diag-${step.label}-${item.id}`,
    sessionId: 'diag-session',
    itemId: item.id,
    gameType: 'mole_story',
    answerMode: 'romaji_to_kana',
    skillDimension: step.skillDimension,
    prompt: { kind: 'text', text: item.surface },
    expected: { surface: item.surface, kana: item.kana },
    difficulty: 0.4,
    timeLimitMs: 30_000,
    allowHints: false,
    strictness: STRICT,
    createdAt: new Date().toISOString(),
  };
}

function makeAttempt(
  task: TrainingTask,
  value: string,
  startedAt: number,
  reactionMs: number,
): UserAttempt {
  return {
    id: `diag-att-${task.id}-${Date.now()}`,
    sessionId: task.sessionId,
    taskId: task.id,
    itemId: task.itemId,
    gameType: task.gameType,
    rawInput: value,
    committedInput: value,
    startedAt: new Date(startedAt).toISOString(),
    submittedAt: new Date(startedAt + reactionMs).toISOString(),
    reactionTimeMs: reactionMs,
    usedHint: false,
    inputMethod: 'ime',
  };
}

async function persistAndNavigate(
  results: StepResult[],
  setSavingDone: (b: boolean) => void,
  setError: (s: string | null) => void,
): Promise<void> {
  setSavingDone(true);
  try {
    await persistResults(results);
  } catch (err) {
    setError(`保存进度失败:${(err as Error).message}`);
    return;
  }
  // Brief pause so user sees the done panel before redirect.
  globalThis.setTimeout(() => {
    globalThis.location.hash = '#/today';
  }, 1500);
}

async function persistResults(results: StepResult[]): Promise<void> {
  // For each step result, seed a SkillProgress row so the WeaknessVector has
  // data immediately. We start from a null prior (first exposure), apply the
  // mastery delta from the diagnostic attempt, then upsert.
  const userId = 'default-user';
  for (const r of results) {
    const newProgress: SkillProgress = updateProgress(null, r.evaluation, { userId });
    await upsertProgress(toProgressDto(newProgress));
  }
}

const pageGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 280px',
  gap: 10,
  padding: 10,
  height: '100%',
};

function Group({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="r-group" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="title">{title}</div>
      {children}
    </div>
  );
}

function ProgressBar({ pct }: { pct: number }): JSX.Element {
  return (
    <div className="r-progress" style={{ height: 14 }}>
      <div className="fill" style={{ width: `${pct}%` }} />
      <div className="text">{pct.toFixed(0)}%</div>
    </div>
  );
}

function LoadingPanel(): JSX.Element {
  return (
    <div style={pageGrid}>
      <Group title="▌ 诊断">
        <div style={{ color: 'var(--kt2-fg-dim)' }}>加载词条...</div>
      </Group>
      <Group title="▌ 进度">
        <div className="kt-skel" style={{ width: '100%', height: 14 }} />
      </Group>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }): JSX.Element {
  return (
    <div style={pageGrid}>
      <Group title="▌ ERR · 诊断">
        <div className="kt-banner kt-banner--err">
          <span className="kt-banner__glyph">!</span>
          <div style={{ fontSize: 13 }}>{message}</div>
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <a href="#/" className="r-btn" style={{ textDecoration: 'none' }}>
            回首页
          </a>
        </div>
      </Group>
      <Group title="▌ 进度">
        <div className="r-label">build</div>
        <div
          style={{
            fontFamily: 'var(--pix-display)',
            fontSize: 14,
            color: 'var(--kt2-danger)',
            marginTop: 4,
          }}
        >
          ERROR
        </div>
      </Group>
    </div>
  );
}

function DonePanel({ results }: { results: StepResult[] }): JSX.Element {
  const correct = results.filter((r) => r.evaluation.isCorrect).length;
  return (
    <div style={pageGrid}>
      <Group title="▌ 诊断完成">
        <div style={{ textAlign: 'center', padding: 16 }}>
          <PixIcon name="medal" size={64} />
          <div
            style={{
              fontFamily: 'var(--pix-display)',
              fontSize: 22,
              color: 'var(--kt2-accent)',
              marginTop: 12,
              textShadow: '0 0 10px var(--kt2-accent)',
            }}
          >
            {correct} / {STEPS.length} 题正确
          </div>
          <div className="r-label" style={{ marginTop: 6 }}>
            初始进度已写入,正在跳转到今日训练...
          </div>
        </div>
        <div className="r-progress" style={{ height: 14, marginTop: 16 }}>
          <div className="fill" style={{ width: '100%' }} />
          <div className="text">100%</div>
        </div>
      </Group>
      <Group title="▌ 各题结果">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          {results.map((r, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: r.evaluation.isCorrect ? 'var(--kt2-accent)' : 'var(--kt2-danger)',
              }}
            >
              <span style={{ minWidth: 70 }}>{r.step.label}</span>
              <span className="r-cjk" style={{ flex: 1 }}>
                {r.item.surface}
              </span>
              <span style={{ fontFamily: 'var(--pix-display)', fontSize: 9 }}>
                {r.evaluation.isCorrect ? '✓' : '✗'}
              </span>
            </div>
          ))}
        </div>
      </Group>
    </div>
  );
}
