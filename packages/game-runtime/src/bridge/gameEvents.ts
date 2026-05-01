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

/**
 * App→Scene reverse channel. The default GameBridge surface (GameRuntimeEvent) is one-way
 * Scene→App; this complementary union lets the React layer push externally-sourced input
 * (e.g. the IME-finalised string from `<ImeInputBox>`) back into a Scene without the Scene
 * needing to know who produced it. Keeping it as a separate union — instead of folding into
 * GameRuntimeEvent — preserves the Scene→App semantic of the original channel.
 */
export type ExternalInputEvent =
  | { type: 'external.commit'; value: string }
  | { type: 'external.cancel' };

export type ExternalInputHandler = (event: ExternalInputEvent) => void;
