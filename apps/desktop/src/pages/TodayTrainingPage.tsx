import {
  buildWeaknessVector,
  selectGameBlocks,
  type ErrorTagAggregate,
  type GameBlock,
  type SkillProgress,
  type WeaknessVector,
} from '@kana-typing/core';
import { useEffect, useState, type JSX } from 'react';

import { aggregateRecentErrorTags, listProgress, type ProgressDto } from '../tauri/invoke';

const DEFAULT_TARGET_DURATION_MS = 8 * 60 * 1000; // 8 minutes — devdocs §3.1 daily flow

const GAME_TYPE_TO_HASH: Record<string, string> = {
  mole_story: '#/game/mole',
  speed_chase: '#/game/speed-chase',
};

const GAME_TYPE_LABEL: Record<string, string> = {
  mole_story: '鼹鼠的故事',
  speed_chase: '生死时速',
  apple_rescue: '拯救苹果 (V1)',
  river_jump: '激流勇进 (V1)',
  space_battle: '太空大战 (V1)',
  real_input: '实战输入 (V2)',
};

export function TodayTrainingPage(): JSX.Element {
  const [vector, setVector] = useState<WeaknessVector | null>(null);
  const [blocks, setBlocks] = useState<GameBlock[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const [progressDtos, tagRows] = await Promise.all([
          listProgress({ userId: 'default-user', limit: 200 }),
          aggregateRecentErrorTags({ userId: 'default-user', days: 7, limit: 10 }),
        ]);
        const progressList = progressDtos.map(toProgress);
        const errors: ErrorTagAggregate[] = tagRows.map((r) => ({
          tag: r.tag as ErrorTagAggregate['tag'],
          count: r.count,
        }));
        const v = buildWeaknessVector(progressList, errors);
        setVector(v);
        setBlocks(
          selectGameBlocks({
            vector: v,
            targetDurationMs: DEFAULT_TARGET_DURATION_MS,
          }),
        );
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  if (error) {
    return (
      <section style={{ padding: '2rem', maxWidth: '720px', margin: '0 auto' }}>
        <h1>今日训练</h1>
        <p style={{ color: 'var(--err)' }}>{error}</p>
      </section>
    );
  }
  if (!vector) {
    return (
      <section style={{ padding: '2rem', maxWidth: '720px', margin: '0 auto' }}>
        <p>Loading…</p>
      </section>
    );
  }

  const totalMs = blocks.reduce((s, b) => s + b.durationMs, 0);
  return (
    <section style={{ padding: '1.5rem', maxWidth: '720px', margin: '0 auto' }}>
      <h1>今日训练</h1>
      <p style={{ color: 'var(--muted)' }}>
        基于你的进度，今天的推荐路线总时长约 {Math.round(totalMs / 60_000)} 分钟。
        点击对应的游戏开始；每个游戏结束后会跳到结算页，回到这里再开下一项。
      </p>

      <section style={{ marginTop: '1.5rem' }}>
        <h2>路线</h2>
        {blocks.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>没有推荐 — 先在 home 页确认词库已有词条。</p>
        ) : (
          <ol>
            {blocks.map((b, idx) => {
              const href = GAME_TYPE_TO_HASH[b.gameType];
              const label = GAME_TYPE_LABEL[b.gameType] ?? b.gameType;
              const minutes = (b.durationMs / 60_000).toFixed(1);
              return (
                <li key={idx} style={{ marginBottom: '0.75rem' }}>
                  <strong>{label}</strong> — {minutes} 分钟 ·{' '}
                  <span style={{ color: 'var(--muted)' }}>{b.reason}</span>
                  {href ? (
                    <>
                      {' '}
                      <a href={href}>开始 →</a>
                    </>
                  ) : (
                    <span style={{ color: 'var(--muted)' }}>（暂未上线）</span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <p style={{ marginTop: '1.5rem' }}>
        <a href="#/">← 回 home</a>
      </p>
    </section>
  );
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
