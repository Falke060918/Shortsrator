import { describe, expect, it } from "vitest";
import {
  UNSKIPPABLE_GATES,
  isAutoApprovable,
  parseAutoApproveGates,
  rejectTargetOf,
} from "./gates.js";

describe("parseAutoApproveGates — GATE2·GATE3 은 어떤 설정으로도 걸러진다", () => {
  it("불가침 게이트를 명시해도 결과에서 제거된다", () => {
    const raw = JSON.stringify([
      "SCRIPT_GATE",
      "FRAME_GATE",
      "CLIP_GATE",
      "FINAL_GATE",
    ]);
    expect(parseAutoApproveGates(raw)).toEqual(["SCRIPT_GATE", "FINAL_GATE"]);
  });

  it("불가침 게이트만 넣으면 빈 목록", () => {
    expect(parseAutoApproveGates(JSON.stringify(UNSKIPPABLE_GATES))).toEqual([]);
  });

  it("설정 없음·파싱 불가·비배열·잡문자열은 빈 목록", () => {
    expect(parseAutoApproveGates(undefined)).toEqual([]);
    expect(parseAutoApproveGates("깨진 json")).toEqual([]);
    expect(parseAutoApproveGates('"FRAME_GATE"')).toEqual([]);
    expect(parseAutoApproveGates('{"skip":"all"}')).toEqual([]);
    expect(parseAutoApproveGates('["없는게이트", 42]')).toEqual([]);
  });
});

describe("isAutoApprovable", () => {
  const all = JSON.stringify(["SCRIPT_GATE", "FRAME_GATE", "CLIP_GATE", "FINAL_GATE"]);

  it("GATE1·GATE4 는 설정으로 자동 승인 가능", () => {
    expect(isAutoApprovable("SCRIPT_GATE", all)).toBe(true);
    expect(isAutoApprovable("FINAL_GATE", all)).toBe(true);
  });

  it("GATE2·GATE3 은 항상 false", () => {
    expect(isAutoApprovable("FRAME_GATE", all)).toBe(false);
    expect(isAutoApprovable("CLIP_GATE", all)).toBe(false);
  });
});

describe("rejectTargetOf — 반려 시 해당 단계 재실행 지점", () => {
  it("게이트별 재실행 단계 매핑", () => {
    expect(rejectTargetOf("SCRIPT_GATE")).toBe("SCRIPT");
    expect(rejectTargetOf("FRAME_GATE")).toBe("FRAME_GEN");
    expect(rejectTargetOf("CLIP_GATE")).toBe("VIDEO_GEN");
    expect(rejectTargetOf("FINAL_GATE")).toBe("ASSEMBLY");
  });
});
