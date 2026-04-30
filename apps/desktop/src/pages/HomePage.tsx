import {
  buildWeaknessVector,
  type ErrorTagAggregate,
  type SkillProgress,
  type WeaknessVector,
} from '@kana-typing/core';
import { useEffect, useState, type JSX } from 'react';

import {
  aggregateRecentErrorTags,
  getDbInfo,
  listProgress,
  type ProgressDto,
} from '../tauri/invoke';

interface HomeData {
  vector: WeaknessVector;
  itemCount: number;
}

/**
 * Sprint 5 Home page (`#/`). Pulls the current weakness vector + last-week error aggregate
 * and surfaces three things:
 *   - Today's training CTA (links to /today)
 *   - Three weakest skill dimensions
 *   - Top recent error tags
 *
 * If the user hasn't seeded a content pack yet, we route them to the dev-tools page (the
 * proper diagnostic flow lands in v0.7.x).
 */
export function HomePage(): JSX.Element {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const info = await getDbInfo();
        if (info.itemCount === 0) {
          setEmpty(true);
          return;
        }
        const [progressDtos, tagRows] = await Promise.all([
          listProgress({ userId: 'default-user', limit: 200 }),
          aggregateRecentErrorTags({ userId: 'default-user', days: 7, limit: 10 }),
        ]);
        const progressList = progressDtos.map(toProgress);
        const errors: ErrorTagAggregate[] = tagRows.map((r) => ({
          tag: r.tag as ErrorTagAggregate['tag'],
          count: r.count,
        }));
        const vector = buildWeaknessVector(progressList, errors);
        setData({ vector, itemCount: info.itemCount });
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  if (error) {
    return (
      <section style={{ padding: '2rem', maxWidth: '720px', margin: '0 auto' }}>
        <h1>假名打字通</h1>
        <p style={{ color: 'var(--err)' }}>{error}</p>
      </section>
    );
  }
  if (empty) {
    return (
      <section style={{ padding: '2rem', maxWidth: '720px', margin: '0 auto' }}>
        <h1>假名打字通</h1>
        <p style={{ color: 'var(--muted)' }}>
          先在 <a href="#/dev">dev (db)</a> 页面把官方 N5 mini 词库种入数据库，再回到这里。
          完整新手诊断流程在 v0.7.x 上线。
        </p>
      </section>
    );
  }
  if (!data) {
    return (
      <section style={{ padding: '2rem', maxWidth: '720px', margin: '0 auto' }}>
        <p>Loading…</p>
      </section>
    );
  }

  const { vector } = data;
  const weakest = topWeakSkills(vector);

  return (
    <section style={{ padding: '1.5rem', maxWidth: '720px', margin: '0 auto' }}>
      <h1>今日训练</h1>
      <p style={{ color: 'var(--muted)' }}>
        词库已有 {data.itemCount} 个项目。下面是系统按你最近练习给出的弱点摘要。
      </p>

      <section style={{ marginTop: '1.5rem' }}>
        <a
          href="#/today"
          style={{
            display: 'inline-block',
            padding: '0.6rem 1.2rem',
            background: 'var(--accent)',
            color: '#0e0f12',
            borderRadius: 8,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          开始今日训练 →
        </a>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>当前最弱 3 项</h2>
        <ul>
          {weakest.map((s) => (
            <li key={s.label}>
              <code>{s.label}</code> — 弱点指数 <code>{s.value.toFixed(2)}</code>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: '1.5rem' }}>
        <h2>近 7 天高频错误</h2>
        {vector.topErrorTags.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>还没有可统计的错误。先打几局看看。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>tag</th>
                <th>count</th>
              </tr>
            </thead>
            <tbody>
              {vector.topErrorTags.slice(0, 5).map((e) => (
                <tr key={e.tag}>
                  <td>
                    <code>{e.tag}</code>
                  </td>
                  <td>
                    <code>{e.weight}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ marginTop: '1.5rem' }}>
        <h2>其他</h2>
        <ul>
          <li>
            <a href="#/mistakes">错题本</a>
          </li>
          <li>
            <a href="#/library">词条图鉴</a>
          </li>
          <li>
            <a href="#/settings">设置</a>
          </li>
        </ul>
      </section>
    </section>
  );
}

function topWeakSkills(v: WeaknessVector): { label: string; value: number }[] {
  const skills = [
    { label: '汉字读音', value: v.kanjiReading },
    { label: '片假名识别', value: v.katakanaRecognition },
    { label: '假名识别', value: v.kanaRecognition },
    { label: '听辨', value: v.listeningDiscrimination },
    { label: '助词', value: v.particleUsage },
    { label: '语序', value: v.sentenceOrder },
    { label: 'IME 选字', value: v.imeConversion },
    { label: '词义', value: v.meaningRecall },
    { label: '主动输出', value: v.activeOutput },
  ];
  return skills.sort((a, b) => b.value - a.value).slice(0, 3);
}

function toProgress(dto: ProgressDto): SkillProgress {
  return {
    userId: dto.userId,
    itemId: dto.itemId,
    skillDimension: dto.skillDimension,
    state: dto.state as SkillProgress['state'],
    masteryScore: dto.masteryScore,
    stability: dto.stability,
    difficulty: dto.difficulty,
    exposureCount: dto.exposureCount,
    correctCount: dto.correctCount,
    wrongCount: dto.wrongCount,
    streak: dto.streak,
    lapseCount: dto.lapseCount,
    ...(dto.averageReactionTimeMs !== null && { averageReactionTimeMs: dto.averageReactionTimeMs }),
    ...(dto.lastAttemptAt !== null && { lastAttemptAt: dto.lastAttemptAt }),
    ...(dto.nextDueAt !== null && { nextDueAt: dto.nextDueAt }),
    lastErrorTags: dto.lastErrorTags as SkillProgress['lastErrorTags'],
    updatedAt: dto.updatedAt,
  };
}
