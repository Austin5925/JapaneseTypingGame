import type { EvaluationResult, TrainingTask, UserAttempt } from '@kana-typing/core';

/**
 * Events on the GameBridge are the *only* outward surface a Phaser Scene exposes. Scenes
 * never call into the React store or the DB directly — see CLAUDE.md "三态分层".
 */
export type GameRuntimeEvent =
  | { type: 'scene.ready'; sceneId: string }
  | { type: 'task.spawned'; task: TrainingTask }
  | { type: 'attempt.submitted'; attempt: UserAttempt }
  | { type: 'attempt.evaluated'; result: EvaluationResult }
  | { type: 'feedback.shown'; result: EvaluationResult }
  | { type: 'session.finished'; reason: SessionFinishReason }
  | { type: 'scene.error'; error: { message: string; stack?: string } };

export type SessionFinishReason = 'completed' | 'timeout' | 'quit';

export type GameEventHandler<T extends GameRuntimeEvent['type']> = (
  event: Extract<GameRuntimeEvent, { type: T }>,
) => void;

export type Unsubscribe = () => void;
