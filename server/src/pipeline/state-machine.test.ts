import { EPISODE_STATES, GATES } from "@shortsrator/shared";
import { describe, expect, it } from "vitest";
import {
  InvalidTransitionError,
  assertForwardStep,
  assertRollbackTarget,
  isGateState,
  nextState,
  stateIndex,
} from "./state-machine.js";

describe("stateIndex / nextState", () => {
  it("상태 순서는 §2-3 문자열 목록 그대로다", () => {
    for (const [index, state] of EPISODE_STATES.entries()) {
      expect(stateIndex(state)).toBe(index);
    }
  });

  it("nextState 는 정확히 다음 상태를 준다", () => {
    expect(nextState("TOPIC")).toBe("SCRIPT");
    expect(nextState("SCRIPT_GATE")).toBe("TTS");
    expect(nextState("CLIP_GATE")).toBe("ASSEMBLY");
    expect(nextState("UPLOAD")).toBe("PUBLISHED");
  });

  it("종단(PUBLISHED)의 nextState 는 null", () => {
    expect(nextState("PUBLISHED")).toBeNull();
  });
});

describe("isGateState", () => {
  it("게이트 4곳만 참", () => {
    for (const state of EPISODE_STATES) {
      expect(isGateState(state)).toBe((GATES as readonly string[]).includes(state));
    }
  });
});

describe("assertForwardStep — 전진은 한 번에 한 단계", () => {
  it("정상 한 칸 전진은 통과", () => {
    expect(() => assertForwardStep("TOPIC", "SCRIPT")).not.toThrow();
    expect(() => assertForwardStep("FRAME_GATE", "VIDEO_GEN")).not.toThrow();
  });

  it("게이트 건너뛰기(2칸 이상)는 거부", () => {
    // FRAME_GEN → VIDEO_GEN 은 FRAME_GATE(GATE2)를 건너뛴다
    expect(() => assertForwardStep("FRAME_GEN", "VIDEO_GEN")).toThrow(
      InvalidTransitionError,
    );
    expect(() => assertForwardStep("TOPIC", "TTS")).toThrow(InvalidTransitionError);
  });

  it("뒤로 가는 전진·제자리 전진은 거부", () => {
    expect(() => assertForwardStep("TTS", "SCRIPT")).toThrow(InvalidTransitionError);
    expect(() => assertForwardStep("TTS", "TTS")).toThrow(InvalidTransitionError);
  });

  it("종단에서의 전진은 거부", () => {
    expect(() => assertForwardStep("PUBLISHED", "TOPIC")).toThrow(
      InvalidTransitionError,
    );
  });
});

describe("assertRollbackTarget — 어느 단계에서든 이전 단계로만", () => {
  it("임의의 이전 단계로 롤백 가능 (바로 앞이 아니어도)", () => {
    expect(() => assertRollbackTarget("CLIP_GATE", "SCRIPT")).not.toThrow();
    expect(() => assertRollbackTarget("PUBLISHED", "TOPIC")).not.toThrow();
    expect(() => assertRollbackTarget("FRAME_GATE", "FRAME_GEN")).not.toThrow();
  });

  it("같은 단계·미래 단계로의 롤백은 거부 — 롤백으로 게이트 우회 불가", () => {
    expect(() => assertRollbackTarget("TTS", "TTS")).toThrow(InvalidTransitionError);
    // FRAME_GEN 에서 VIDEO_GEN 으로 "롤백"하면 GATE2 를 우회하게 된다
    expect(() => assertRollbackTarget("FRAME_GEN", "VIDEO_GEN")).toThrow(
      InvalidTransitionError,
    );
  });
});
