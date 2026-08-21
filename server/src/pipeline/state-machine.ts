/**
 * 에피소드 상태머신 — 기준 문서: docs/01_솔루션_개발명세.md §2-3,
 * docs/03-architecture.md "되돌리기 어려운 결정" 3.
 *
 * 상태 문자열 목록은 shared/src/domain.ts 의 EPISODE_STATES 가 원천이다 —
 * 여기서는 순서 인덱스와 전이 규칙만 정의한다.
 * - 전진: 한 번에 정확히 다음 상태로만 (건너뛰기 불가 — 게이트 불가침의 1차 방어).
 * - 롤백: 어느 단계에서든 "이전" 단계로만 (§2-3 "어느 단계에서든 이전 단계로 반려 가능").
 *   앞으로 가는 롤백은 없다 — 롤백 경로로 게이트를 우회할 수 없다.
 */

import { EPISODE_STATES, GATES, type EpisodeState, type Gate } from "@shortsrator/shared";

/** 알 수 없는/불법 상태 전이 */
export class InvalidTransitionError extends Error {
  constructor(
    readonly from: EpisodeState,
    readonly to: EpisodeState | null,
    reason: string,
  ) {
    super(`상태 전이 불가 (${from} → ${to ?? "∅"}): ${reason}`);
    this.name = "InvalidTransitionError";
  }
}

const STATE_INDEX = new Map<EpisodeState, number>(
  EPISODE_STATES.map((state, index) => [state, index]),
);

/** 상태 순서 인덱스 (0-base). 알 수 없는 문자열이면 throw. */
export function stateIndex(state: EpisodeState): number {
  const index = STATE_INDEX.get(state);
  if (index === undefined) {
    throw new Error(`알 수 없는 에피소드 상태: ${String(state)}`);
  }
  return index;
}

/** 다음 상태 — 종단(PUBLISHED)이면 null */
export function nextState(state: EpisodeState): EpisodeState | null {
  const index = stateIndex(state);
  return index + 1 < EPISODE_STATES.length ? EPISODE_STATES[index + 1] : null;
}

/** 게이트 대기 상태인가 (SCRIPT_GATE/FRAME_GATE/CLIP_GATE/FINAL_GATE) */
export function isGateState(state: EpisodeState): state is Gate {
  return (GATES as readonly string[]).includes(state);
}

/** 전진 전이 검증 — 정확히 다음 상태 1칸만 허용 */
export function assertForwardStep(from: EpisodeState, to: EpisodeState): void {
  const expected = nextState(from);
  if (expected === null) {
    throw new InvalidTransitionError(from, to, "종단 상태에서는 전진할 수 없다");
  }
  if (to !== expected) {
    throw new InvalidTransitionError(
      from,
      to,
      `전진은 한 번에 한 단계만 — 다음 상태는 ${expected}`,
    );
  }
}

/** 롤백 대상 검증 — 현재보다 앞(이전) 단계만 허용, 같은 단계·미래 단계 불가 */
export function assertRollbackTarget(from: EpisodeState, to: EpisodeState): void {
  if (stateIndex(to) >= stateIndex(from)) {
    throw new InvalidTransitionError(
      from,
      to,
      "롤백은 이전 단계로만 가능하다 (앞으로 가는 롤백 없음)",
    );
  }
}
