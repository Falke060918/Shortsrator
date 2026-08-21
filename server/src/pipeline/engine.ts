/**
 * 파이프라인 엔진 — 에피소드 상태 전이의 단일 관문 (issue #8).
 *
 * 게이트 불가침 보장 3축:
 *   1. 전진은 정확히 1칸 (state-machine.assertForwardStep) — 게이트 건너뛰기 불가.
 *   2. 게이트 상태를 벗어나는 유일한 경로는 decideGate(결정 기록 필수).
 *      advance() 는 자동 승인 가능 게이트(GATE1·GATE4, 설정 시)만 auto 결정으로
 *      통과시키고, GATE2·GATE3 은 어떤 설정으로도 GateNotApprovedError 를 던진다.
 *   3. 롤백은 이전 단계로만 (assertRollbackTarget) — 롤백 경로로도 전진 불가.
 *
 * 트랜잭션 주의: 여기서는 db.transaction 을 쓰지 않는다 (bare BEGIN/COMMIT 중첩
 * 불가 — db.ts). 각 DAO 호출은 단문이고 node:sqlite 는 동기라 원자성이 충분하다.
 */

import { randomUUID } from "node:crypto";
import type {
  EpisodeState,
  Gate,
  GateDecisionValue,
} from "@shortsrator/shared";
import type { Dao, EpisodeRow } from "../db/dao.js";
import {
  GATE_AUTO_APPROVE_SETTING,
  GateNotApprovedError,
  GateStateMismatchError,
  isAutoApprovable,
  rejectTargetOf,
} from "./gates.js";
import {
  InvalidTransitionError,
  assertForwardStep,
  assertRollbackTarget,
  isGateState,
  nextState,
} from "./state-machine.js";

export class EpisodeNotFoundError extends Error {
  constructor(readonly episodeId: string) {
    super(`에피소드 없음: ${episodeId}`);
    this.name = "EpisodeNotFoundError";
  }
}

export interface GateDecisionInput {
  gate: Gate;
  decision: GateDecisionValue;
  /** UI 페이로드(반려 사유 등) — gate_decisions.payload_json 으로 영속 */
  payload?: unknown;
}

export class PipelineEngine {
  constructor(private readonly dao: Dao) {}

  getEpisode(episodeId: string): EpisodeRow {
    const episode = this.dao.episodes.get(episodeId);
    if (!episode) throw new EpisodeNotFoundError(episodeId);
    return episode;
  }

  /**
   * 다음 자동 단계로 전진 (POST /api/episodes/:id/advance 의 코어).
   * 게이트 대기 상태에서는 자동 승인 가능(GATE1·GATE4 + 설정)한 경우에만
   * auto 결정을 기록하고 통과한다 — GATE2·GATE3 은 무조건 사용자 결정 대기.
   */
  advance(episodeId: string): EpisodeState {
    const episode = this.getEpisode(episodeId);
    const to = nextState(episode.state);
    if (to === null) {
      throw new InvalidTransitionError(episode.state, null, "이미 종단 상태다");
    }

    if (isGateState(episode.state)) {
      const gate = episode.state;
      const autoSetting = this.dao.settings.get(GATE_AUTO_APPROVE_SETTING);
      if (!isAutoApprovable(gate, autoSetting)) {
        throw new GateNotApprovedError(gate);
      }
      return this.decideGate(episodeId, {
        gate,
        decision: "approve",
        payload: { auto: true },
      });
    }

    assertForwardStep(episode.state, to);
    this.dao.episodes.updateState(episodeId, to);
    return to;
  }

  /**
   * 게이트 결정 (POST /api/episodes/:id/gate 의 코어).
   * 결정은 반드시 gate_decisions 에 기록된 뒤 상태가 움직인다 —
   * 승인 → 다음 단계, 반려 → 해당 단계 재실행 지점으로 롤백.
   */
  decideGate(episodeId: string, input: GateDecisionInput): EpisodeState {
    const episode = this.getEpisode(episodeId);
    if (episode.state !== input.gate) {
      throw new GateStateMismatchError(input.gate, episode.state);
    }

    this.dao.gateDecisions.insert({
      id: randomUUID(),
      episode_id: episodeId,
      gate: input.gate,
      decision: input.decision,
      payload_json:
        input.payload === undefined ? null : JSON.stringify(input.payload),
    });

    const to =
      input.decision === "approve"
        ? nextState(input.gate)
        : rejectTargetOf(input.gate);
    if (to === null) {
      throw new InvalidTransitionError(input.gate, null, "게이트 다음 상태 없음");
    }
    if (input.decision === "approve") {
      assertForwardStep(input.gate, to);
    } else {
      assertRollbackTarget(input.gate, to);
    }
    this.dao.episodes.updateState(episodeId, to);
    return to;
  }

  /**
   * 명시 롤백 (POST /api/episodes/:id/rollback 의 코어) —
   * 어느 단계에서든 이전 단계로만 (01 문서 §2-3).
   */
  rollback(episodeId: string, toState: EpisodeState): EpisodeState {
    const episode = this.getEpisode(episodeId);
    assertRollbackTarget(episode.state, toState);
    this.dao.episodes.updateState(episodeId, toState);
    return toState;
  }
}
