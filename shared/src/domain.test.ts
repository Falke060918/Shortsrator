import { describe, expect, it } from "vitest";
import { EPISODE_STATES, GATES, TRANSITION_TYPES } from "./domain.js";

describe("에피소드 상태머신", () => {
  it("TOPIC에서 시작해 PUBLISHED로 끝나는 14개 상태다", () => {
    expect(EPISODE_STATES).toHaveLength(14);
    expect(EPISODE_STATES[0]).toBe("TOPIC");
    expect(EPISODE_STATES[EPISODE_STATES.length - 1]).toBe("PUBLISHED");
  });

  it("게이트 4곳이 상태머신 안에 순서대로 존재한다", () => {
    const gateIndices = GATES.map((gate) => EPISODE_STATES.indexOf(gate));
    expect(gateIndices.every((i) => i >= 0)).toBe(true);
    expect([...gateIndices].sort((a, b) => a - b)).toEqual(gateIndices);
  });
});

describe("START_END 전환 강등 체인", () => {
  it("frames → edit_splice → manual 순서다", () => {
    expect(TRANSITION_TYPES).toEqual(["frames", "edit_splice", "manual"]);
  });
});
