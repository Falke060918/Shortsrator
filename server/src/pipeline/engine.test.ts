import type { EpisodeState } from "@shortsrator/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PipelineEngine, EpisodeNotFoundError } from "./engine.js";
import {
  GATE_AUTO_APPROVE_SETTING,
  GateNotApprovedError,
  GateStateMismatchError,
} from "./gates.js";
import { InvalidTransitionError, isGateState, nextState } from "./state-machine.js";
import { openTestDb, seedEpisode, type TestDb } from "./test-fixtures.js";

let t: TestDb;
let engine: PipelineEngine;
let episodeId: string;

beforeEach(() => {
  t = openTestDb();
  engine = new PipelineEngine(t.dao);
  episodeId = seedEpisode(t.dao).episodeId;
});

afterEach(() => {
  t.close();
});

/** 게이트는 승인 결정으로, 나머지는 advance 로 target 까지 진행 */
function driveTo(target: EpisodeState): void {
  for (let guard = 0; guard < 20; guard++) {
    const state = engine.getEpisode(episodeId).state;
    if (state === target) return;
    if (isGateState(state)) {
      engine.decideGate(episodeId, { gate: state, decision: "approve" });
    } else {
      engine.advance(episodeId);
    }
  }
  throw new Error(`${target} 도달 실패`);
}

describe("advance — 전진 전이", () => {
  it("게이트가 아닌 상태는 한 칸씩 전진하고 DB에 반영된다", () => {
    expect(engine.advance(episodeId)).toBe("SCRIPT");
    expect(engine.advance(episodeId)).toBe("SCRIPT_GATE");
    expect(t.dao.episodes.get(episodeId)?.state).toBe("SCRIPT_GATE");
  });

  it("없는 에피소드는 EpisodeNotFoundError", () => {
    expect(() => engine.advance("ep-없음")).toThrow(EpisodeNotFoundError);
  });

  it("종단(PUBLISHED)에서는 InvalidTransitionError", () => {
    driveTo("PUBLISHED");
    expect(() => engine.advance(episodeId)).toThrow(InvalidTransitionError);
  });
});

describe("게이트 결정", () => {
  it("게이트 대기 상태에서 advance 는 승인 없이는 통과 불가", () => {
    driveTo("SCRIPT_GATE");
    expect(() => engine.advance(episodeId)).toThrow(GateNotApprovedError);
    expect(t.dao.episodes.get(episodeId)?.state).toBe("SCRIPT_GATE");
  });

  it("승인 결정은 기록을 남기고 다음 단계로 전진한다", () => {
    driveTo("SCRIPT_GATE");
    const state = engine.decideGate(episodeId, {
      gate: "SCRIPT_GATE",
      decision: "approve",
      payload: { pick: 1 },
    });
    expect(state).toBe("TTS");
    const decisions = t.dao.gateDecisions.listByEpisode(episodeId);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].gate).toBe("SCRIPT_GATE");
    expect(decisions[0].decision).toBe("approve");
    expect(JSON.parse(decisions[0].payload_json ?? "")).toEqual({ pick: 1 });
  });

  it("반려는 해당 단계 재실행 지점으로 롤백한다 (FRAME_GATE → FRAME_GEN)", () => {
    driveTo("FRAME_GATE");
    const state = engine.decideGate(episodeId, {
      gate: "FRAME_GATE",
      decision: "reject",
      payload: { reason: "이미지 프롬프트가 문제" },
    });
    expect(state).toBe("FRAME_GEN");
  });

  it("대기 중이 아닌 게이트에 결정을 넣으면 GateStateMismatchError", () => {
    driveTo("SCRIPT_GATE");
    // FRAME_GATE 에 도달한 적 없이 GATE2 결정을 밀어넣을 수 없다
    expect(() =>
      engine.decideGate(episodeId, { gate: "FRAME_GATE", decision: "approve" }),
    ).toThrow(GateStateMismatchError);
  });
});

describe("게이트 불가침 — GATE2·GATE3 은 어떤 설정으로도 스킵 불가", () => {
  beforeEach(() => {
    // 4개 게이트 전부 자동 승인하겠다는 (허용되지 않는) 설정
    t.dao.settings.set(
      GATE_AUTO_APPROVE_SETTING,
      JSON.stringify(["SCRIPT_GATE", "FRAME_GATE", "CLIP_GATE", "FINAL_GATE"]),
    );
  });

  it("SCRIPT_GATE(GATE1)는 설정으로 자동 승인되고 auto 결정이 기록된다", () => {
    driveTo("SCRIPT_GATE");
    expect(engine.advance(episodeId)).toBe("TTS");
    const decisions = t.dao.gateDecisions.listByEpisode(episodeId);
    expect(decisions).toHaveLength(1);
    expect(JSON.parse(decisions[0].payload_json ?? "")).toEqual({ auto: true });
  });

  it("FRAME_GATE(GATE2)는 설정이 있어도 advance 가 막힌다", () => {
    driveTo("FRAME_GATE");
    expect(() => engine.advance(episodeId)).toThrow(GateNotApprovedError);
    expect(t.dao.episodes.get(episodeId)?.state).toBe("FRAME_GATE");
  });

  it("CLIP_GATE(GATE3)는 설정이 있어도 advance 가 막힌다", () => {
    driveTo("CLIP_GATE");
    expect(() => engine.advance(episodeId)).toThrow(GateNotApprovedError);
    expect(t.dao.episodes.get(episodeId)?.state).toBe("CLIP_GATE");
  });

  it("FINAL_GATE(GATE4)는 설정으로 자동 승인 가능", () => {
    driveTo("FINAL_GATE");
    expect(engine.advance(episodeId)).toBe("UPLOAD");
  });
});

describe("rollback — 어느 단계에서든 이전 단계로", () => {
  it("멀리 떨어진 이전 단계로도 롤백된다", () => {
    driveTo("CLIP_GATE");
    expect(engine.rollback(episodeId, "SCRIPT")).toBe("SCRIPT");
    expect(t.dao.episodes.get(episodeId)?.state).toBe("SCRIPT");
  });

  it("롤백 후 다시 전진하면 게이트를 전부 다시 거친다", () => {
    driveTo("FRAME_GATE");
    engine.rollback(episodeId, "TOPIC");
    driveTo("SCRIPT_GATE");
    expect(() => engine.advance(episodeId)).toThrow(GateNotApprovedError);
  });

  it("같은 단계·미래 단계로의 롤백은 거부 — 롤백으로 게이트 우회 불가", () => {
    driveTo("FRAME_GEN");
    expect(() => engine.rollback(episodeId, "FRAME_GEN")).toThrow(
      InvalidTransitionError,
    );
    expect(() => engine.rollback(episodeId, "VIDEO_GEN")).toThrow(
      InvalidTransitionError,
    );
    expect(t.dao.episodes.get(episodeId)?.state).toBe("FRAME_GEN");
  });
});

describe("전체 완주", () => {
  it("TOPIC → PUBLISHED 까지 게이트 4곳을 결정으로 통과한다", () => {
    driveTo("PUBLISHED");
    expect(nextState("PUBLISHED")).toBeNull();
    expect(t.dao.gateDecisions.listByEpisode(episodeId)).toHaveLength(4);
  });
});
